/**
 * @ghostty/wasm-api
 *
 * TypeScript wrapper for the libghostty-vt WebAssembly API
 */

export * from "./types.js";
export * from "./memory.js";
export * from "./wasm-loader.js";
export * from "./terminal.js";

// Export the WASM file URL for direct import
// Users can import this in their bundler: import ghosttyWasm from '@ghostty/wasm-api/wasm/ghostty-vt.wasm'
export const WASM_PATH = "../wasm/ghostty-vt.wasm";
