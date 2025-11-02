#!/usr/bin/env node

/**
 * Copy WASM file to wasm directory
 */

import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const wasmSource = join(
  __dirname,
  "..",
  "..",
  "..",
  "zig-out",
  "bin",
  "ghostty-vt.wasm"
);
const wasmDest = join(__dirname, "..", "wasm", "ghostty-vt.wasm");

if (!existsSync(wasmSource)) {
  console.error("❌ WASM file not found at:", wasmSource);
  console.error(
    "   Build it first with: zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall"
  );
  process.exit(1);
}

const destDir = dirname(wasmDest);
if (!existsSync(destDir)) {
  mkdirSync(destDir, { recursive: true });
}

copyFileSync(wasmSource, wasmDest);
console.log("✅ WASM copied to wasm/ghostty-vt.wasm");
