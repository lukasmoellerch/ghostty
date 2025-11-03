/**
 * Global type declarations for WASM imports
 */

declare module "*.wasm" {
  const wasmUrl: string;
  export default wasmUrl;
}


