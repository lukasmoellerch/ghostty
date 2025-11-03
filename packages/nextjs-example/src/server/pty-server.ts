/**
 * WebSocket PTY server
 */

import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { IncomingMessage } from "http";

interface PtyMessage {
  type: "spawn" | "input" | "resize";
  data?: string;
  cols?: number;
  rows?: number;
}

interface PtyResponse {
  type: "spawned" | "output" | "exit";
  data?: string;
  terminalId?: string;
  cols?: number;
  rows?: number;
  exitCode?: number;
  signal?: number;
}

export class PtyServer {
  private wss: WebSocketServer;
  private terminals = new Map<string, pty.IPty>();

  constructor(port: number = 3001) {
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    console.log(`PTY WebSocket server listening on port ${port}`);
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    console.log("Client connected");

    let ptyProcess: pty.IPty | null = null;
    let terminalId: string | null = null;

    ws.on("message", (message: Buffer) => {
      try {
        const data: PtyMessage = JSON.parse(message.toString());

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
            env: process.env as { [key: string]: string },
          });

          terminalId = `term-${Date.now()}`;
          this.terminals.set(terminalId, ptyProcess);

          // Forward PTY output to WebSocket
          ptyProcess.onData((outputData: string) => {
            if (ws.readyState === WebSocket.OPEN) {
              const response: PtyResponse = {
                type: "output",
                data: outputData,
              };
              ws.send(JSON.stringify(response));
            }
          });

          // Handle PTY exit
          ptyProcess.onExit(({ exitCode, signal }) => {
            console.log(`PTY exited with code ${exitCode}, signal ${signal}`);
            if (terminalId) {
              this.terminals.delete(terminalId);
            }
            if (ws.readyState === WebSocket.OPEN) {
              const response: PtyResponse = {
                type: "exit",
                exitCode,
                signal,
              };
              ws.send(JSON.stringify(response));
            }
          });

          // Send acknowledgment
          const response: PtyResponse = {
            type: "spawned",
            terminalId,
            cols,
            rows,
          };
          ws.send(JSON.stringify(response));
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
        console.error("Error handling message:", err);
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected");
      if (ptyProcess) {
        ptyProcess.kill();
        if (terminalId) {
          this.terminals.delete(terminalId);
        }
      }
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  }

  close(): void {
    this.terminals.forEach((term) => term.kill());
    this.wss.close();
  }
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  new PtyServer(3001);
}

