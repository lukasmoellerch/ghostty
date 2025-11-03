# @ghostty/nextjs-example

Example Next.js application demonstrating how to use the Ghostty terminal packages.

This example shows how to:

- Load the Ghostty WASM module
- Create a terminal using `@ghostty/dom-terminal`
- Connect the terminal to a WebSocket PTY server
- Handle input, output, and resizing

## Getting Started

### Quick Start

From the `packages` directory (parent of this directory):

```bash
npm install  # or pnpm install
```

This automatically:

- Installs all dependencies
- Builds the WASM module (if Zig is available)
- Copies WASM to `@ghostty/wasm-api/wasm/` directory
- Builds TypeScript packages

Then from this directory:

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

The custom server runs both Next.js and WebSocket on the same port (3000)!

### Manual Setup

If you need to set up manually:

1. **Build WASM** (requires Zig):

   ```bash
   cd ../.. && zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
   ```

2. **Install and build packages**:

   ```bash
   cd packages
   npm install
   npm run build
   ```

3. **Run the example**:
   ```bash
   cd nextjs-example
   npm run dev
   ```

## Project Structure

```
src/
├── app/
│   ├── layout.tsx      # Root layout
│   └── page.tsx        # Home page
├── components/
│   └── Terminal.tsx    # Terminal component
└── server/
    └── pty-server.ts   # WebSocket PTY server
```

## How It Works

1. **Custom Server**: Uses a custom Next.js server (`server.js`) that runs both HTTP and WebSocket on the same port
2. **WASM Loading**: The terminal component loads the Ghostty WASM module using `@ghostty/wasm-api`
3. **WebSocket Connection**: Connects to `/ws` endpoint on the same server
4. **I/O Interface**: Implements the `TerminalIO` interface to bridge the terminal and WebSocket
5. **Rendering**: Uses `@ghostty/dom-terminal` to render the terminal in the DOM
6. **PTY Integration**: The WebSocket handler spawns PTYs and bridges them to clients

### Architecture

```
Custom Server (port 3000)
├── Next.js App (HTTP)
│   └── Terminal Component
└── WebSocket Server (/ws)
    └── PTY Integration
```

## Customization

You can customize the terminal appearance and behavior by passing options to the `DOMTerminal` constructor:

```typescript
new DOMTerminal(container, exports, io, {
  cellWidth: 9,
  cellHeight: 18,
  fontFamily: '"Menlo", "Monaco", monospace',
  fontSize: 16,
  backgroundColor: "#000000",
  foregroundColor: "#ffffff",
  cursorColor: "#00ff00",
});
```

## Production

For production use, you'll need to:

1. Build the Next.js app: `npm run build`
2. Start the production server: `npm start`
3. Run the PTY server separately (or integrate it into your backend)
4. Consider security implications of running PTYs server-side

## License

MIT - Copyright Anysphere Inc.
