"use client";

import { useEffect, useRef, useState } from "react";
import { loadWasmModule, getWasmExports } from "@ghostty/wasm-api";
import { DOMTerminal, TerminalIO } from "@ghostty/dom-terminal";

interface TerminalProps {
  wsUrl?: string;
}

export function Terminal({ wsUrl }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<DOMTerminal | null>(null);
  const [status, setStatus] = useState<string>("Loading...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Prevent duplicate initialization
    if (terminalRef.current) return;

    let terminal: DOMTerminal | null = null;
    let ws: WebSocket | null = null;
    let mounted = true;

    async function init() {
      try {
        if (!containerRef.current || !mounted) return;

        setStatus("Loading WASM module...");

        // Load bundled WASM from wasm-api package
        const instance = await loadWasmModule({
          onLog: (msg) => console.log(msg),
        });

        if (!mounted) return;
        const exports = getWasmExports(instance);

        setStatus("Connecting to server...");

        // Setup WebSocket - use relative URL for same-origin connection
        const wsUrl_ =
          wsUrl ||
          `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${
            window.location.host
          }/ws`;
        ws = new WebSocket(wsUrl_);

        // Wait for WebSocket connection first
        await new Promise<void>((resolve, reject) => {
          ws!.onopen = () => {
            if (!mounted) return;
            setStatus("Connected");
            resolve();
          };
          ws!.onerror = (err) => {
            if (!mounted) return;
            reject(new Error("WebSocket connection failed"));
          };
          ws!.onclose = () => {
            if (!mounted) return;
            setStatus("Disconnected");
          };
        });

        if (!mounted) return;

        const io: TerminalIO = {
          onInput: (data) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "input", data }));
            }
          },
          onResize: (cols, rows) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "resize", cols, rows }));
            }
          },
        };

        terminal = new DOMTerminal(containerRef.current, exports, io);
        terminalRef.current = terminal;

        const { cols, rows } = terminal.getSize();
        ws.send(
          JSON.stringify({
            type: "spawn",
            cols,
            rows,
          })
        );

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.type === "output") {
              terminal!.handleOutput(message.data);
            } else if (message.type === "spawned") {
              console.log("PTY spawned:", message);
            } else if (message.type === "exit") {
              console.log("PTY exited:", message);
            }
          } catch (err) {
            console.error("Error handling message:", err);
          }
        };

        setError(null);
      } catch (err) {
        if (!mounted) return;
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
        setStatus("Error");
        console.error("Terminal initialization error:", err);
      }
    }

    init();

    // Cleanup
    return () => {
      mounted = false;
      if (terminal) {
        terminal.destroy();
        terminalRef.current = null;
      }
      if (ws) {
        ws.close();
      }
    };
  }, []);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      {error && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            background: "#ff0000",
            color: "#fff",
            padding: "10px",
            zIndex: 1000,
          }}
        >
          Error: {error}
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          width: "100vw",
          height: "100vh",
          background: "#000",
        }}
      />
    </div>
  );
}
