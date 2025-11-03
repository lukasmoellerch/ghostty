# @ghostty/wasm-api

TypeScript wrapper for the libghostty-vt WebAssembly API.

This package provides a thin, type-safe wrapper around the raw WASM exports from libghostty-vt. It handles memory management and provides a clean TypeScript API for terminal emulation.

## Installation

```bash
npm install @ghostty/wasm-api
```

## Usage

The WASM module is bundled with this package - no need to manage the WASM file separately!

```typescript
import {
  loadWasmModule,
  getWasmExports,
  GhosttyTerminal,
} from "@ghostty/wasm-api";

// Load the bundled WASM module (no URL needed!)
const instance = await loadWasmModule({
  onLog: (msg) => console.log(msg),
});

const exports = getWasmExports(instance);

// Create a terminal
const terminal = new GhosttyTerminal(exports, 80, 24);

// Write data
terminal.write("Hello, World!\n");

// Get cursor position
const cursor = terminal.getCursor();
console.log(`Cursor at (${cursor.x}, ${cursor.y})`);

// Get cell data
const cell = terminal.getCellViewport(0, 0);
if (cell) {
  console.log(`Character: ${String.fromCodePoint(cell.codepoint)}`);
}

// Clean up
terminal.destroy();
```

### Using a Custom WASM File

If you need to use a different WASM file:

```typescript
// Load from custom URL
const instance = await loadWasmModule({
  wasmUrl: '/path/to/ghostty-vt.wasm',
  onLog: (msg) => console.log(msg)
});

// Or from an ArrayBuffer
const wasmBytes = new Uint8Array([...]).buffer;
const instance = await loadWasmModule({
  wasmUrl: wasmBytes,
});
```

## API

### `loadWasmModule(options?)`

Load and instantiate the Ghostty WASM module.

**Options:**

- `wasmUrl` (optional): URL, path, or ArrayBuffer containing the WASM file. If omitted, uses the bundled WASM module.
- `onLog` (optional): Callback for WASM log messages

### `GhosttyTerminal`

High-level terminal API wrapper.

**Methods:**

- `write(data)`: Write text or bytes to the terminal
- `resize(cols, rows)`: Resize the terminal
- `getCursor()`: Get current cursor position
- `getCellViewport(x, y)`: Get cell data at viewport coordinates
- `getTitle()`: Get terminal title
- `getScrollback()`: Get scrollback information
- `setViewportOffset(offset)`: Set viewport scroll offset
- `clear()`: Clear the terminal
- `reset()`: Reset the terminal
- `destroy()`: Free resources

## Building

To build this package from source:

```bash
# First, build the WASM module
cd /path/to/ghostty
zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall

# Then build the TypeScript package
cd packages/wasm-api
npm run build
```

The build process will:

1. Copy the WASM file from `zig-out/bin/ghostty-vt.wasm` to `wasm/ghostty-vt.wasm`
2. Compile TypeScript to JavaScript
3. Publish both `dist/` (JavaScript) and `wasm/` (WASM file) together

The WASM file is kept in a separate `wasm/` directory and imported as a module by the bundler.

## License

MIT - Copyright Anysphere Inc.
