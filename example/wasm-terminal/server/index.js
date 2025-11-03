const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const pty = require("node-pty");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from repository root (to access zig-out) and public directory
const repoRoot = path.join(__dirname, "../../..");
app.use("/zig-out", express.static(path.join(repoRoot, "zig-out")));
app.use(express.static(path.join(__dirname, "../public")));

// Serve the main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Track active terminals
const terminals = new Map();

wss.on("connection", (ws) => {
  console.log("Client connected");

  let ptyProcess = null;
  let terminalId = null;

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "spawn") {
        // Spawn a new PTY
        const shell = process.env.SHELL || "/bin/bash";
        const cols = data.cols || 80;
        const rows = data.rows || 24;

        console.log(`Spawning PTY: ${shell} (${cols}x${rows})`);

        ptyProcess = pty.spawn(shell, [], {
          name: "xterm-256color",
          cols: cols,
          rows: rows,
          cwd: process.env.HOME,
          env: process.env,
        });

        terminalId = `term-${Date.now()}`;
        terminals.set(terminalId, ptyProcess);

        // Forward PTY output to WebSocket
        ptyProcess.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "output",
                data: data,
              })
            );
          }
        });

        // Handle PTY exit
        ptyProcess.onExit(({ exitCode, signal }) => {
          console.log(`PTY exited with code ${exitCode}, signal ${signal}`);
          terminals.delete(terminalId);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "exit",
                exitCode: exitCode,
                signal: signal,
              })
            );
          }
        });

        // Send acknowledgment
        ws.send(
          JSON.stringify({
            type: "spawned",
            terminalId: terminalId,
            cols: cols,
            rows: rows,
          })
        );
      } else if (data.type === "input") {
        // Forward input to PTY
        if (ptyProcess) {
          ptyProcess.write(data.data);
        }
      } else if (data.type === "resize") {
        // Resize PTY
        if (ptyProcess) {
          ptyProcess.resize(data.cols, data.rows);
          console.log(`Resized PTY to ${data.cols}x${data.rows}`);
        }
      }
    } catch (err) {
      console.error("Error handling message:", err);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    if (ptyProcess) {
      ptyProcess.kill();
      terminals.delete(terminalId);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
🚀 Ghostty WASM Terminal Server
═══════════════════════════════════
  Server running on: http://localhost:${PORT}
  WebSocket ready for connections
  
  Open your browser to start terminal session
═══════════════════════════════════
  `);
});

// Cleanup on exit
process.on("SIGTERM", () => {
  console.log("Shutting down...");
  terminals.forEach((term) => term.kill());
  server.close();
});
