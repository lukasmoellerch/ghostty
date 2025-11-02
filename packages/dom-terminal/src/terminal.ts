/**
 * Main DOM terminal implementation
 */

import type { GhosttyWasmExports } from "@ghostty/wasm-api";
import { GhosttyTerminal } from "@ghostty/wasm-api";
import type {
  TerminalConfig,
  TerminalIO,
  TerminalEventHandlers,
} from "./types.js";
import { CanvasRenderer } from "./renderer.js";
import { InputHandler } from "./input.js";

/**
 * DOM-based terminal using Ghostty WASM for rendering
 */
export class DOMTerminal {
  private terminal: GhosttyTerminal;
  private renderer: CanvasRenderer;
  private inputHandler: InputHandler;
  private container: HTMLElement;
  private spacer: HTMLDivElement;

  private scrollMode: "auto" | "pinned" = "auto";
  private cellWidth: number;
  private cellHeight: number;

  constructor(
    containerElement: HTMLElement,
    wasmExports: GhosttyWasmExports,
    io: TerminalIO,
    config: TerminalConfig = {},
    handlers: TerminalEventHandlers = {}
  ) {
    this.container = containerElement;
    this.cellWidth = config.cellWidth ?? 9;
    this.cellHeight = config.cellHeight ?? 18;

    // Setup container
    this.container.style.position = "relative";
    this.container.style.overflow = "auto";

    // Create scrollback spacer
    this.spacer = document.createElement("div");
    this.spacer.id = "ghostty-scrollback-spacer";
    this.spacer.style.width = "1px";
    this.spacer.style.pointerEvents = "none";
    this.container.appendChild(this.spacer);

    // Calculate terminal size
    const { cols, rows } = this.calculateSize(config);

    // Create terminal instance
    this.terminal = new GhosttyTerminal(wasmExports, cols, rows);

    // Create renderer
    this.renderer = new CanvasRenderer(this.container, this.terminal, config);

    // Setup input handling
    this.inputHandler = new InputHandler(this.container, (data) => {
      io.onInput(data);
    });

    // Setup I/O
    io.onOutput((data) => {
      this.handleOutput(data);
    });

    // Setup event handlers
    this.setupScrollHandler();
    this.setupResizeHandler(io);

    // Initial render
    this.updateScrollback();
    this.renderer.scheduleRender();

    // Notify ready
    if (handlers.onReady) {
      handlers.onReady();
    }
    if (io.onReady) {
      io.onReady();
    }

    this.inputHandler.focus();
  }

  private calculateSize(config: TerminalConfig): {
    cols: number;
    rows: number;
  } {
    if (config.cols && config.rows) {
      return { cols: config.cols, rows: config.rows };
    }

    const viewportWidth = this.container.clientWidth || window.innerWidth;
    const viewportHeight = this.container.clientHeight || window.innerHeight;

    const cols = Math.max(20, Math.floor(viewportWidth / this.cellWidth));
    const rows = Math.max(5, Math.floor(viewportHeight / this.cellHeight));

    return { cols, rows };
  }

  private handleOutput(data: string): void {
    this.terminal.write(data);
    this.updateScrollback();

    if (this.scrollMode === "auto") {
      this.scrollToBottom();
    } else {
      // In pinned mode, just position the canvas
      this.renderer.position(this.container.scrollTop);
    }

    this.renderer.scheduleRender();
  }

  private updateScrollback(): void {
    const scrollback = this.terminal.getScrollback();
    const size = this.terminal.getSize();

    // Update renderer's cached state
    this.renderer.updateScrollState(
      scrollback.viewportOffset,
      scrollback.totalRows
    );

    // Update spacer height
    const contentHeight = scrollback.totalRows * this.cellHeight;
    const containerHeight = this.container.clientHeight;
    const terminalHeight = size.rows * this.cellHeight;
    const extraPadding = containerHeight - terminalHeight;
    const spacerHeight = contentHeight + Math.max(0, extraPadding);
    this.spacer.style.height = `${spacerHeight}px`;
  }

  private scrollToBottom(): void {
    this.container.scrollTop = this.container.scrollHeight;
    this.scrollMode = "auto";

    // Get current scrollback and set viewport to bottom
    const scrollback = this.terminal.getScrollback();
    const size = this.terminal.getSize();
    const activeAreaOffset = Math.max(0, scrollback.totalRows - size.rows);
    this.terminal.setViewportOffset(activeAreaOffset);

    // Update renderer state
    this.renderer.updateScrollState(activeAreaOffset, scrollback.totalRows);
    this.renderer.position(this.container.scrollTop);
  }

  private setupScrollHandler(): void {
    this.container.addEventListener("scroll", () => {
      const scrollTop = this.container.scrollTop;
      const size = this.terminal.getSize();
      const scrollback = this.terminal.getScrollback();

      // Calculate row offset
      const maxOffset = Math.max(0, scrollback.totalRows - size.rows);
      const rawOffset = Math.floor(scrollTop / this.cellHeight);
      const rowOffset = Math.min(maxOffset, Math.max(0, rawOffset));

      // Check if at bottom
      const isAtBottom =
        scrollTop + this.container.clientHeight >=
        this.container.scrollHeight - 10;

      this.scrollMode = isAtBottom ? "auto" : "pinned";
      this.terminal.setViewportOffset(rowOffset);

      // Update renderer's cached state immediately for smooth rendering
      this.renderer.updateScrollState(rowOffset, scrollback.totalRows);
      this.renderer.position(scrollTop);
      this.renderer.scheduleRender();
    });
  }

  private setupResizeHandler(io: TerminalIO): void {
    let resizeTimeout: number;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(() => {
        this.handleResize(io);
      }, 150);
    });
  }

  private handleResize(io: TerminalIO): void {
    const oldSize = this.terminal.getSize();
    const { cols, rows } = this.calculateSize({});

    if (oldSize.cols === cols && oldSize.rows === rows) {
      return;
    }

    this.terminal.resize(cols, rows);
    this.renderer.resize();
    this.updateScrollback();
    io.onResize(cols, rows);
    this.renderer.scheduleRender();
  }

  /**
   * Get the terminal title
   */
  getTitle(): string {
    return this.terminal.getTitle();
  }

  /**
   * Focus the terminal input
   */
  focus(): void {
    this.inputHandler.focus();
  }

  /**
   * Get terminal size
   */
  getSize(): { cols: number; rows: number } {
    return this.terminal.getSize();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.renderer.destroy();
    this.inputHandler.destroy();
    this.terminal.destroy();
    this.spacer.remove();
  }
}
