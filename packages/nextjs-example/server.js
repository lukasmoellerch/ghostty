#!/usr/bin/env node

/**
 * Custom Next.js server with integrated WebSocket support
 */

import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import pty from "node-pty";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Create HTTP server
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  // Create WebSocket server on the same HTTP server
  const wss = new WebSocketServer({ server, path: "/ws" });
  const terminals = new Map();

  wss.on("connection", (ws) => {
    console.log("WebSocket client connected");

    let ptyProcess = null;
    let terminalId = null;

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === "spawn") {
          const shell = process.env.SHELL || "/bin/bash";
          const cols = data.cols || 80;
          const rows = data.rows || 24;

          console.log(`Spawning PTY: ${shell} (${cols}x${rows})`);

          ptyProcess = pty.spawn(shell, [], {
            name: "xterm-256color",
            cols,
            rows,
            cwd: process.env.HOME,
            env: process.env,
          });

          terminalId = `term-${Date.now()}`;
          terminals.set(terminalId, ptyProcess);

          // Forward PTY output to WebSocket
          ptyProcess.onData((outputData) => {
            if (ws.readyState === 1) {
              // OPEN
              ws.send(
                JSON.stringify({
                  type: "output",
                  data: outputData,
                })
              );
            }
          });

          // Handle PTY exit
          ptyProcess.onExit(({ exitCode, signal }) => {
            console.log(`PTY exited with code ${exitCode}, signal ${signal}`);
            terminals.delete(terminalId);
            if (ws.readyState === 1) {
              ws.send(
                JSON.stringify({
                  type: "exit",
                  exitCode,
                  signal,
                })
              );
            }
          });

          // Send acknowledgment
          ws.send(
            JSON.stringify({
              type: "spawned",
              terminalId,
              cols,
              rows,
            })
          );
        } else if (data.type === "input") {
          if (ptyProcess && data.data) {
            ptyProcess.write(data.data);
          }
        } else if (data.type === "resize") {
          if (ptyProcess && data.cols && data.rows) {
            ptyProcess.resize(data.cols, data.rows);
            console.log(`Resized PTY to ${data.cols}x${data.rows}`);
          }
        }
      } catch (err) {
        console.error("Error handling WebSocket message:", err);
      }
    });

    ws.on("close", () => {
      console.log("WebSocket client disconnected");
      if (ptyProcess) {
        ptyProcess.kill();
        terminals.delete(terminalId);
      }
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  });

  // Start the server
  server.listen(port, () => {
    console.log(`
🚀 Ghostty Terminal Server
═══════════════════════════════════
  HTTP:       http://${hostname}:${port}
  WebSocket:  ws://${hostname}:${port}/ws
  
  Ready for connections!
═══════════════════════════════════
    `);
  });

  // Cleanup on exit
  process.on("SIGTERM", () => {
    console.log("Shutting down...");
    terminals.forEach((term) => term.kill());
    wss.close();
    server.close();
  });
});
