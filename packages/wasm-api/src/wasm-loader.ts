/**
 * WASM module loading utilities
 */

import type { GhosttyWasmExports } from "./types.js";

/**
 * Options for loading the WASM module
 */
export interface LoadWasmOptions {
  /**
   * URL, path, or ArrayBuffer containing the WASM file.
   * If omitted, will attempt to load the bundled WASM file.
   */
  wasmUrl?: string | ArrayBuffer;

  /**
   * Optional callback for logging
   */
  onLog?: (message: string) => void;
}

/**
 * Load and instantiate the Ghostty WASM module
 */
export async function loadWasmModule(
  options: LoadWasmOptions = {}
): Promise<WebAssembly.Instance> {
  const { wasmUrl, onLog } = options;

  let wasmBytes: ArrayBuffer;

  if (!wasmUrl) {
    // Load bundled WASM file - import it directly and let the bundler handle it
    const wasmModule = await import("../wasm/ghostty-vt.wasm");
    // The bundler will turn this into a URL we can fetch
    const wasmPath = wasmModule.default;
    const response = await fetch(wasmPath);
    wasmBytes = await response.arrayBuffer();
  } else if (wasmUrl instanceof ArrayBuffer) {
    // Use provided ArrayBuffer directly
    wasmBytes = wasmUrl;
  } else {
    // Fetch from provided URL
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch WASM module from ${wasmUrl}: ${response.statusText}`
      );
    }
    wasmBytes = await response.arrayBuffer();
  }

  const wasmModule = await WebAssembly.instantiate(wasmBytes, {
    env: {
      log: (ptr: number, len: number) => {
        if (onLog) {
          // We need to get the memory from the instance, but it's not available yet
          // This callback will be set up after instantiation
          onLog(`[wasm] log callback (ptr=${ptr}, len=${len})`);
        }
      },
    },
  });

  // Set up the log callback properly now that we have the instance
  if (onLog) {
    const memory = (wasmModule.instance.exports as GhosttyWasmExports).memory;
    const originalLog = (wasmModule.instance.exports as any).log;
    if (originalLog) {
      (wasmModule.instance.exports as any).log = (ptr: number, len: number) => {
        const bytes = new Uint8Array(memory.buffer, ptr, len);
        const text = new TextDecoder().decode(bytes);
        onLog(`[wasm] ${text}`);
      };
    }
  }

  return wasmModule.instance;
}

/**
 * Get typed exports from a WASM instance
 */
export function getWasmExports(
  instance: WebAssembly.Instance
): GhosttyWasmExports {
  return instance.exports as GhosttyWasmExports;
}
