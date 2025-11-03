#!/usr/bin/env node

/**
 * Build WASM module and copy to wasm directory
 */

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..", "..", "..");

console.log("🔨 Building WASM module...");
try {
  execSync(
    "zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall",
    {
      cwd: rootDir,
      stdio: "inherit",
    }
  );
} catch (error) {
  console.error("❌ Failed to build WASM module");
  process.exit(1);
}

console.log("📦 Copying WASM file...");
execSync("node scripts/copy-wasm.js", {
  cwd: join(__dirname, ".."),
  stdio: "inherit",
});

