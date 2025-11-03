#!/bin/bash
# Start script for Ghostty WASM Terminal

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "🚀 Ghostty WASM Terminal - Startup"
echo "═══════════════════════════════════════"
echo ""

# Check if WASM module exists
if [ ! -f "$REPO_ROOT/zig-out/bin/ghostty-vt.wasm" ]; then
    echo "❌ WASM module not found!"
    echo ""
    echo "Building WASM module..."
    cd "$REPO_ROOT"
    zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
    echo ""
    echo "✅ WASM module built successfully"
    echo ""
fi

# Check if node_modules exists
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "📦 Installing dependencies..."
    cd "$SCRIPT_DIR"
    npm install
    echo ""
    echo "✅ Dependencies installed"
    echo ""
fi

# Start server
echo "🌐 Starting server..."
echo ""
cd "$SCRIPT_DIR"
npm start


