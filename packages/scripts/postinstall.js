#!/usr/bin/env node

/**
 * Post-install script for Ghostty packages
 * Builds WASM and TypeScript packages
 */

import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = new URL(".", import.meta.url).pathname;
const rootDir = join(__dirname, "..");
const wasmSource = join(rootDir, "..", "zig-out", "bin", "ghostty-vt.wasm");

console.log("🔧 Ghostty packages post-install");

// Check if WASM exists, build if needed
if (!existsSync(wasmSource)) {
  console.log("⚙️  WASM not found, building...");
  try {
    execFileSync(
      "zig",
      [
        "build",
        "lib-vt",
        "-Dtarget=wasm32-freestanding",
        "-Doptimize=ReleaseSmall",
      ],
      {
        cwd: join(rootDir, ".."),
        stdio: "inherit",
      }
    );
    console.log("✅ WASM built successfully");
  } catch (error) {
    console.error(
      "❌ Failed to build WASM. Install Zig and run: npm run build-wasm"
    );
    console.error("   Get Zig from: https://ziglang.org/download/");
    process.exit(0); // Don't fail the install
  }
}

// Build TypeScript packages (this will also copy WASM to wasm-api/dist)
console.log("📦 Building TypeScript packages...");
try {
  execFileSync("npm", ["run", "build", "--workspaces", "--if-present"], {
    cwd: rootDir,
    stdio: "inherit",
  });
  console.log("✅ TypeScript packages built");
} catch (error) {
  console.error("⚠️  Failed to build TypeScript packages");
  process.exit(0);
}

console.log(
  "\n✨ Setup complete! Run 'npm run dev:example' to start the demo.\n"
);
