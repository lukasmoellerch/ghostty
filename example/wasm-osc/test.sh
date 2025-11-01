#!/bin/bash
# Test script for the WASM OSC parser example

set -e

echo "🔨 Building libghostty-vt WASM module..."
echo ""

# Navigate to repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# Check Zig version
echo "Checking Zig version..."
ZIG_VERSION=$(zig version)pz
echo "Found Zig version: $ZIG_VERSION"
echo ""

# Build WASM module
echo "Building WASM module (this may take a moment)..."
zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall

# Check if build succeeded
if [ -f "zig-out/bin/ghostty-vt.wasm" ]; then
    WASM_SIZE=$(ls -lh zig-out/bin/ghostty-vt.wasm | awk '{print $5}')
    echo "✅ Build successful! WASM module size: $WASM_SIZE"
    echo "   Location: zig-out/bin/ghostty-vt.wasm"
else
    echo "❌ Build failed - ghostty-vt.wasm not found"
    exit 1
fi

echo ""
echo "🌐 Starting local HTTP server..."
echo ""
echo "   Open your browser to:"
echo "   → http://localhost:8000/example/wasm-osc/"
echo ""
echo "   Press Ctrl+C to stop the server"
echo ""

# Start server
python3 -m http.server 8000
