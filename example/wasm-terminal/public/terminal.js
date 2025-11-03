// Ghostty WASM Terminal Emulator
// Uses the full libghostty-vt Terminal API for proper VT sequence parsing

class GhosttyTerminal {
  constructor() {
    this.wasmInstance = null;
    this.wasmMemory = null;
    this.ws = null;
    this.canvas = null;
    this.ctx = null;
    this.container = null;
    this.spacer = null;
    this.terminal = null; // WASM terminal instance

    // Terminal state - will be calculated based on window size
    this.cols = 80;
    this.rows = 24;
    this.cellWidth = 7;
    this.cellHeight = 14;

    // Scrollback state
    this.totalRows = 24;
    this.viewportOffset = 0;
    this.scrollMode = "auto"; // "auto" or "pinned"

    // Colors (simplified xterm-256)
    this.colors = {
      bg: "#000000",
      fg: "#ffffff",
      cursor: "#00ff00",
    };

    // Rendering state
    this.isDirty = false;
    this.renderScheduled = false;

    this.init();
  }

  async init() {
    try {
      await this.loadWasm();
      this.calculateDimensions(); // Calculate initial dimensions
      this.setupContainer();
      this.setupCanvas();
      this.initTerminal();
      this.setupWebSocket();
      this.setupInput();
      this.setupResizeHandler();
      this.setupScrollHandler();
      this.startRenderLoop();
      this.hideLoading();
    } catch (error) {
      this.showError(error.message);
    }
  }

  calculateDimensions() {
    // Get available viewport size
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate how many columns and rows fit
    this.cols = Math.floor(viewportWidth / this.cellWidth);
    this.rows = Math.floor(viewportHeight / this.cellHeight);

    // Ensure minimum size
    this.cols = Math.max(20, this.cols);
    this.rows = Math.max(5, this.rows);

    console.log(`Calculated terminal size: ${this.cols}x${this.rows}`);
  }

  async loadWasm() {
    this.updateStatus("Loading WASM module...");

    try {
      const response = await fetch("/zig-out/bin/ghostty-vt.wasm");
      if (!response.ok) {
        throw new Error(
          "Failed to fetch WASM module. Did you build it? Run: zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall"
        );
      }

      const wasmBytes = await response.arrayBuffer();
      const wasmModule = await WebAssembly.instantiate(wasmBytes, {
        env: {
          log: (ptr, len) => {
            const bytes = new Uint8Array(
              wasmModule.instance.exports.memory.buffer,
              ptr,
              len
            );
            const text = new TextDecoder().decode(bytes);
            console.log("[wasm]", text);
          },
        },
      });

      this.wasmInstance = wasmModule.instance;
      this.wasmMemory = this.wasmInstance.exports.memory;

      console.log("✅ WASM module loaded successfully");
    } catch (error) {
      throw new Error(`WASM loading failed: ${error.message}`);
    }
  }

  initTerminal() {
    // Create terminal instance using ghostty Terminal API
    const termPtrPtr = this.wasmInstance.exports.ghostty_wasm_alloc_opaque();
    const result = this.wasmInstance.exports.ghostty_terminal_new(
      0, // allocator (null = use default)
      this.cols,
      this.rows,
      termPtrPtr
    );

    if (result !== 0) {
      throw new Error(`Failed to create terminal: ${result}`);
    }

    this.terminal = new DataView(this.getBuffer()).getUint32(termPtrPtr, true);

    // Initialize scrollback info
    this.updateScrollbackInfo();

    // Position canvas initially
    this.positionCanvas();

    console.log("✅ Terminal initialized via libghostty-vt");
  }

  setupContainer() {
    this.container = document.getElementById("terminal-container");
    this.spacer = document.getElementById("scrollback-spacer");

    // Container height is set to 100vh in CSS
    // Initialize spacer to create scrollable area
    // This will be updated when we get scrollback info
    const containerHeight = this.container.clientHeight;
    this.spacer.style.height = `${containerHeight}px`;

    console.log(`✅ Container initialized`);
  }

  setupCanvas() {
    this.canvas = document.getElementById("terminal");
    this.ctx = this.canvas.getContext("2d", { alpha: false });

    // Get device pixel ratio for high-DPI screens
    this.pixelRatio = window.devicePixelRatio || 1;

    // Calculate logical (CSS) size
    const logicalWidth = this.cols * this.cellWidth;
    const logicalHeight = this.rows * this.cellHeight;

    // Set CSS size (logical pixels)
    this.canvas.style.width = `${logicalWidth}px`;
    this.canvas.style.height = `${logicalHeight}px`;

    // Set canvas internal size (physical pixels)
    this.canvas.width = logicalWidth * this.pixelRatio;
    this.canvas.height = logicalHeight * this.pixelRatio;

    // Scale the context to account for high-DPI
    this.ctx.scale(this.pixelRatio, this.pixelRatio);

    // Set up font
    this.ctx.font = '12px "Menlo", "Monaco", "Courier New", monospace';
    this.ctx.textBaseline = "top";

    console.log(
      `✅ Canvas initialized: ${this.cols}x${this.rows} (DPI: ${this.pixelRatio}x)`
    );
  }

  setupWebSocket() {
    this.updateStatus("Connecting to server...");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("✅ WebSocket connected");
      this.updateStatus("Connected", true);

      // Spawn PTY
      this.ws.send(
        JSON.stringify({
          type: "spawn",
          cols: this.cols,
          rows: this.rows,
        })
      );
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleServerMessage(message);
      } catch (error) {
        console.error("Error handling message:", error);
      }
    };

    this.ws.onclose = () => {
      console.log("WebSocket disconnected");
      this.updateStatus("Disconnected");
      this.showError("Connection lost. Please refresh the page.");
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      this.showError("WebSocket connection failed");
    };
  }

  handleServerMessage(message) {
    switch (message.type) {
      case "spawned":
        console.log("✅ PTY spawned:", message);
        this.focusInput();
        break;

      case "output":
        this.processOutput(message.data);
        break;

      case "exit":
        console.log("PTY exited:", message);
        break;
    }
  }

  processOutput(data) {
    // Use ghostty's Terminal API to parse VT sequences
    // Convert string to UTF-8 bytes
    const encoder = new TextEncoder();
    const bytes = encoder.encode(data);

    // Allocate memory in WASM for the data
    const dataPtr = this.wasmInstance.exports.ghostty_wasm_alloc_u8_array(
      bytes.length
    );
    const dataView = new Uint8Array(this.getBuffer(), dataPtr, bytes.length);
    dataView.set(bytes);

    // Feed data to terminal
    const result = this.wasmInstance.exports.ghostty_terminal_write(
      this.terminal,
      dataPtr,
      bytes.length
    );

    // Free the temporary buffer
    this.wasmInstance.exports.ghostty_wasm_free_u8_array(dataPtr);

    if (result !== 0) {
      console.error("Terminal write failed:", result);
    }

    // Update scrollback info
    this.updateScrollbackInfo();

    // Auto-scroll to bottom if in auto mode
    if (this.scrollMode === "auto") {
      this.scrollToBottom();
    } else {
      // In pinned mode, adjust scroll position to keep viewing the same content
      // The container height may have grown, so we need to maintain our position
      this.positionCanvas();
    }

    // Mark terminal as dirty and schedule a render
    this.scheduleRender();
  }

  scrollToBottom() {
    // Scroll container to the bottom
    this.container.scrollTop = this.container.scrollHeight;

    // Tell libghostty we're viewing the active area (bottom)
    // Active area starts at (totalRows - rows)
    const activeAreaOffset = Math.max(0, this.totalRows - this.rows);
    this.wasmInstance.exports.ghostty_terminal_set_viewport_offset(
      this.terminal,
      activeAreaOffset
    );

    // Position canvas to be visible
    this.positionCanvas();

    // Ensure we're in auto mode
    this.scrollMode = "auto";
  }

  setupInput() {
    const inputElement = document.getElementById("input-capture");
    const container = document.body;

    // Focus input when clicking anywhere in terminal
    container.addEventListener("click", () => {
      this.focusInput();
    });

    // Handle keyboard input
    inputElement.addEventListener("keydown", (e) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      let data = null;

      // Handle special keys
      if (e.key === "Enter") {
        data = "\r";
        e.preventDefault();
      } else if (e.key === "Backspace") {
        data = "\x7f";
        e.preventDefault();
      } else if (e.key === "Tab") {
        data = "\t";
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        data = "\x1b[A";
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        data = "\x1b[B";
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        data = "\x1b[C";
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        data = "\x1b[D";
        e.preventDefault();
      } else if (e.key === "Home") {
        data = "\x1b[H";
        e.preventDefault();
      } else if (e.key === "End") {
        data = "\x1b[F";
        e.preventDefault();
      } else if (e.ctrlKey && e.key === "c") {
        data = "\x03";
        e.preventDefault();
      } else if (e.ctrlKey && e.key === "d") {
        data = "\x04";
        e.preventDefault();
      } else if (e.ctrlKey && e.key === "l") {
        data = "\x0c";
        e.preventDefault();
      } else if (e.ctrlKey && e.key === "x") {
        data = "\x18";
        e.preventDefault();
      }

      if (data) {
        this.sendInput(data);
      }
    });

    // Handle text input
    inputElement.addEventListener("input", (e) => {
      if (e.data && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendInput(e.data);
      }
      inputElement.value = "";
    });

    // Prevent losing focus
    inputElement.addEventListener("blur", () => {
      setTimeout(() => this.focusInput(), 100);
    });
  }

  focusInput() {
    const inputElement = document.getElementById("input-capture");
    inputElement.focus();
  }

  setupResizeHandler() {
    let resizeTimeout;
    window.addEventListener("resize", () => {
      // Debounce resize events
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.handleResize();
      }, 150);
    });
  }

  setupScrollHandler() {
    this.container.addEventListener("scroll", () => {
      this.handleScroll();
    });
  }

  handleScroll() {
    const scrollTop = this.container.scrollTop;

    // Calculate row offset from scroll position
    // Clamp to valid range [0, totalRows - rows] since the active area
    // is the bottom 'rows' rows and starts at (totalRows - rows)
    const maxOffset = Math.max(0, this.totalRows - this.rows);
    const rawOffset = Math.floor(scrollTop / this.cellHeight);
    const rowOffset = Math.min(maxOffset, Math.max(0, rawOffset));

    // Check if we're at the bottom
    const isAtBottom =
      scrollTop + this.container.clientHeight >=
      this.container.scrollHeight - 10;

    // Update scroll mode
    if (isAtBottom) {
      this.scrollMode = "auto";
    } else {
      this.scrollMode = "pinned";
    }

    // Update viewport offset in libghostty
    this.wasmInstance.exports.ghostty_terminal_set_viewport_offset(
      this.terminal,
      rowOffset
    );

    // IMPORTANT: Update our cached viewport offset immediately
    // Otherwise rendering will use the stale offset from the last output
    this.viewportOffset = rowOffset;

    // Position canvas to be visible in viewport
    this.positionCanvas();

    // Trigger a re-render
    this.scheduleRender();
  }

  positionCanvas() {
    // Position canvas to always be visible at the top of the viewport
    this.canvas.style.top = `${this.container.scrollTop}px`;
  }

  updateScrollbackInfo() {
    // Get current scrollback state from terminal
    const totalRowsPtr = this.wasmInstance.exports.ghostty_wasm_alloc_usize();
    const viewportOffsetPtr =
      this.wasmInstance.exports.ghostty_wasm_alloc_usize();
    const visibleRowsPtr = this.wasmInstance.exports.ghostty_wasm_alloc_usize();

    this.wasmInstance.exports.ghostty_terminal_get_scrollback(
      this.terminal,
      totalRowsPtr,
      viewportOffsetPtr,
      visibleRowsPtr
    );

    const totalRows = new Uint32Array(this.getBuffer(), totalRowsPtr, 1)[0];
    const viewportOffset = new Uint32Array(
      this.getBuffer(),
      viewportOffsetPtr,
      1
    )[0];
    const visibleRows = new Uint32Array(this.getBuffer(), visibleRowsPtr, 1)[0];

    this.wasmInstance.exports.ghostty_wasm_free_usize(totalRowsPtr);
    this.wasmInstance.exports.ghostty_wasm_free_usize(viewportOffsetPtr);
    this.wasmInstance.exports.ghostty_wasm_free_usize(visibleRowsPtr);

    // Update spacer height if total rows changed to create scrollable area
    if (totalRows !== this.totalRows) {
      this.totalRows = totalRows;
      const contentHeight = totalRows * this.cellHeight;
      const containerHeight = this.container.clientHeight;
      const terminalHeight = this.rows * this.cellHeight;
      // Add spacing below to allow scrolling the last line to the top of viewport
      const extraPadding = containerHeight - terminalHeight;
      const spacerHeight = contentHeight + Math.max(0, extraPadding);
      this.spacer.style.height = `${spacerHeight}px`;
    }

    this.viewportOffset = viewportOffset;
  }

  handleResize() {
    const oldCols = this.cols;
    const oldRows = this.rows;

    // Calculate new dimensions
    this.calculateDimensions();

    // Only resize if dimensions actually changed
    if (oldCols === this.cols && oldRows === this.rows) {
      return;
    }

    console.log(
      `Resizing terminal from ${oldCols}x${oldRows} to ${this.cols}x${this.rows}`
    );

    // Resize the WASM terminal
    const result = this.wasmInstance.exports.ghostty_terminal_resize(
      this.terminal,
      this.cols,
      this.rows
    );

    if (result !== 0) {
      console.error("Terminal resize failed:", result);
      return;
    }

    // Resize the canvas
    this.resizeCanvas();

    // Update scrollback info (terminal size affects scrollback calculations)
    this.updateScrollbackInfo();

    // Notify the server
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "resize",
          cols: this.cols,
          rows: this.rows,
        })
      );
    }

    // Trigger a re-render
    this.scheduleRender();
  }

  resizeCanvas() {
    // Calculate logical (CSS) size
    const logicalWidth = this.cols * this.cellWidth;
    const logicalHeight = this.rows * this.cellHeight;

    // Set CSS size (logical pixels)
    this.canvas.style.width = `${logicalWidth}px`;
    this.canvas.style.height = `${logicalHeight}px`;

    // Set canvas internal size (physical pixels)
    this.canvas.width = logicalWidth * this.pixelRatio;
    this.canvas.height = logicalHeight * this.pixelRatio;

    // Re-apply scaling for high-DPI
    this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    this.ctx.scale(this.pixelRatio, this.pixelRatio);

    // Re-apply font settings
    this.ctx.font = '12px "Menlo", "Monaco", "Courier New", monospace';
    this.ctx.textBaseline = "top";

    console.log(`Canvas resized to ${this.cols}x${this.rows}`);
  }

  sendInput(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "input",
          data: data,
        })
      );
    }
  }

  render() {
    // Ensure canvas is positioned correctly before rendering
    this.positionCanvas();

    // Clear canvas
    this.ctx.fillStyle = this.colors.bg;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Update document title from terminal
    this.updateDocumentTitle();

    // Get cursor position from terminal (in active area coordinates)
    const cursorXPtr = this.wasmInstance.exports.ghostty_wasm_alloc_u16();
    const cursorYPtr = this.wasmInstance.exports.ghostty_wasm_alloc_u16();
    this.wasmInstance.exports.ghostty_terminal_get_cursor(
      this.terminal,
      cursorXPtr,
      cursorYPtr
    );
    const cursorX = new Uint16Array(this.getBuffer(), cursorXPtr, 1)[0];
    const cursorY = new Uint16Array(this.getBuffer(), cursorYPtr, 1)[0];
    this.wasmInstance.exports.ghostty_wasm_free_u16(cursorXPtr);
    this.wasmInstance.exports.ghostty_wasm_free_u16(cursorYPtr);

    // Allocate buffers for cell data
    const codepointPtr = this.wasmInstance.exports.ghostty_wasm_alloc_u32();
    const fgRPtr = this.wasmInstance.exports.ghostty_wasm_alloc_u8();
    const fgGPtr = this.wasmInstance.exports.ghostty_wasm_alloc_u8();
    const fgBPtr = this.wasmInstance.exports.ghostty_wasm_alloc_u8();
    const bgRPtr = this.wasmInstance.exports.ghostty_wasm_alloc_u8();
    const bgGPtr = this.wasmInstance.exports.ghostty_wasm_alloc_u8();
    const bgBPtr = this.wasmInstance.exports.ghostty_wasm_alloc_u8();
    const boldPtr = this.wasmInstance.exports.ghostty_wasm_alloc_u8();
    const italicPtr = this.wasmInstance.exports.ghostty_wasm_alloc_u8();
    const underlinePtr = this.wasmInstance.exports.ghostty_wasm_alloc_u8();

    // Render all cells in the viewport
    // getCellViewport uses viewport coordinates where (0,0) is top-left of visible area
    // This respects the current scroll position
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const hasCell =
          this.wasmInstance.exports.ghostty_terminal_get_cell_viewport(
            this.terminal,
            x,
            y,
            codepointPtr,
            fgRPtr,
            fgGPtr,
            fgBPtr,
            bgRPtr,
            bgGPtr,
            bgBPtr,
            boldPtr,
            italicPtr,
            underlinePtr
          );

        if (!hasCell) continue;

        const px = x * this.cellWidth;
        const py = y * this.cellHeight;

        // Get cell data
        const codepoint = new Uint32Array(this.getBuffer(), codepointPtr, 1)[0];
        const fgR = new Uint8Array(this.getBuffer(), fgRPtr, 1)[0];
        const fgG = new Uint8Array(this.getBuffer(), fgGPtr, 1)[0];
        const fgB = new Uint8Array(this.getBuffer(), fgBPtr, 1)[0];
        const bgR = new Uint8Array(this.getBuffer(), bgRPtr, 1)[0];
        const bgG = new Uint8Array(this.getBuffer(), bgGPtr, 1)[0];
        const bgB = new Uint8Array(this.getBuffer(), bgBPtr, 1)[0];
        const bold = new Uint8Array(this.getBuffer(), boldPtr, 1)[0];
        const italic = new Uint8Array(this.getBuffer(), italicPtr, 1)[0];

        // Draw background if not default
        if (bgR !== 0 || bgG !== 0 || bgB !== 0) {
          this.ctx.fillStyle = `rgb(${bgR}, ${bgG}, ${bgB})`;
          this.ctx.fillRect(px, py, this.cellWidth, this.cellHeight);
        }

        // Draw character
        if (codepoint && codepoint !== 32) {
          // 32 is space
          this.ctx.fillStyle = `rgb(${fgR}, ${fgG}, ${fgB})`;
          const fontStyle = bold ? "bold " : "";
          const fontVariant = italic ? "italic " : "";
          this.ctx.font = `${fontVariant}${fontStyle}12px "Menlo", "Monaco", "Courier New", monospace`;
          const char = String.fromCodePoint(codepoint);
          this.ctx.fillText(char, px + 1, py + 1);
        }
      }
    }

    // Free buffers
    this.wasmInstance.exports.ghostty_wasm_free_u32(codepointPtr);
    this.wasmInstance.exports.ghostty_wasm_free_u8(fgRPtr);
    this.wasmInstance.exports.ghostty_wasm_free_u8(fgGPtr);
    this.wasmInstance.exports.ghostty_wasm_free_u8(fgBPtr);
    this.wasmInstance.exports.ghostty_wasm_free_u8(bgRPtr);
    this.wasmInstance.exports.ghostty_wasm_free_u8(bgGPtr);
    this.wasmInstance.exports.ghostty_wasm_free_u8(bgBPtr);
    this.wasmInstance.exports.ghostty_wasm_free_u8(boldPtr);
    this.wasmInstance.exports.ghostty_wasm_free_u8(italicPtr);
    this.wasmInstance.exports.ghostty_wasm_free_u8(underlinePtr);

    // Draw cursor if it's visible in the current viewport
    // Cursor coordinates are in active area coordinates (0,0 = top-left of active area)
    // Active area is the bottom 'rows' rows of the scrollback where the cursor lives
    const activeAreaStart = this.totalRows - this.rows;

    // Convert cursor from active area coordinates to absolute scrollback coordinates
    const cursorAbsoluteRow = activeAreaStart + cursorY;

    // Convert to viewport coordinates (viewport shows rows viewportOffset to viewportOffset+rows-1)
    const viewportCursorY = cursorAbsoluteRow - this.viewportOffset;

    // Only draw if cursor is within visible viewport
    if (viewportCursorY >= 0 && viewportCursorY < this.rows) {
      const px = cursorX * this.cellWidth;
      const py = viewportCursorY * this.cellHeight;
      this.ctx.fillStyle = this.colors.cursor;
      this.ctx.fillRect(px, py + this.cellHeight - 2, this.cellWidth, 2);
    }
  }

  scheduleRender() {
    if (!this.renderScheduled) {
      this.renderScheduled = true;
      requestAnimationFrame(() => {
        this.renderScheduled = false;
        this.render();
      });
    }
  }

  startRenderLoop() {
    // Initial render
    this.scheduleRender();
  }

  getBuffer() {
    return this.wasmMemory.buffer;
  }

  updateDocumentTitle() {
    // Allocate pointers for title data
    const titlePtrPtr = this.wasmInstance.exports.ghostty_wasm_alloc_opaque();
    const titleLenPtr = this.wasmInstance.exports.ghostty_wasm_alloc_usize();

    // Get title from terminal
    this.wasmInstance.exports.ghostty_terminal_get_title(
      this.terminal,
      titlePtrPtr,
      titleLenPtr
    );

    // Read the pointer and length
    const titlePtr = new Uint32Array(this.getBuffer(), titlePtrPtr, 1)[0];
    const titleLen = new Uint32Array(this.getBuffer(), titleLenPtr, 1)[0];

    // Free the pointer storage
    this.wasmInstance.exports.ghostty_wasm_free_opaque(titlePtrPtr);
    this.wasmInstance.exports.ghostty_wasm_free_usize(titleLenPtr);

    // Update document title if we have one
    if (titleLen > 0) {
      const titleBytes = new Uint8Array(this.getBuffer(), titlePtr, titleLen);
      const title = new TextDecoder().decode(titleBytes);
      document.title = title;
    } else {
      document.title = "Ghostty WASM Terminal";
    }
  }

  updateStatus(text, connected = false) {
    const statusEl = document.getElementById("status");
    const statusText = document.getElementById("status-text");

    if (statusText) {
      statusText.textContent = text;
    }

    if (statusEl) {
      if (connected) {
        statusEl.classList.add("connected");
      } else {
        statusEl.classList.remove("connected");
      }
    }
  }

  hideLoading() {
    const loading = document.getElementById("loading");
    if (loading) {
      loading.style.display = "none";
    }
  }

  showError(message) {
    console.error("Terminal Error:", message);
    this.updateStatus("Error");
  }
}

// Initialize terminal when DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  new GhosttyTerminal();
});
