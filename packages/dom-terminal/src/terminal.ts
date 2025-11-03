import type { GhosttyWasmExports } from "@ghostty/wasm-api";
import { GhosttyTerminal } from "@ghostty/wasm-api";
import type {
  TerminalConfig,
  TerminalIO,
  TerminalEventHandlers,
} from "./types.js";
import { WebGLRenderer } from "./renderer.js";
import { InputHandler } from "./input.js";

export class DOMTerminal {
  private terminal: GhosttyTerminal;
  private renderer: WebGLRenderer;
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

    const measured = this.measureCellDimensions(config);
    this.cellWidth = measured.width;
    this.cellHeight = measured.height;

    this.container.style.position = "relative";
    this.container.style.overflow = "auto";

    this.spacer = document.createElement("div");
    this.spacer.id = "ghostty-scrollback-spacer";
    this.spacer.style.width = "1px";
    this.spacer.style.pointerEvents = "none";
    this.container.appendChild(this.spacer);

    const { cols, rows } = this.calculateSize();
    this.terminal = new GhosttyTerminal(wasmExports, cols, rows);
    this.renderer = new WebGLRenderer(
      this.container,
      this.terminal,
      this.cellWidth,
      this.cellHeight,
      config
    );

    this.inputHandler = new InputHandler(this.container, (data) => {
      io.onInput(data);
    });

    this.setupScrollHandler();
    this.setupResizeHandler(io);

    this.updateScrollback();
    this.renderer.scheduleRender();

    if (handlers.onReady) {
      handlers.onReady();
    }
    if (io.onReady) {
      io.onReady();
    }

    this.inputHandler.focus();
  }

  private measureCellDimensions(config: TerminalConfig): {
    width: number;
    height: number;
  } {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to create canvas context for font measurement");
    }

    const fontSize = config.fontSize ?? 16;
    const fontFamily =
      config.fontFamily ?? '"Menlo", "Monaco", "Courier New", monospace';
    const pixelRatio = window.devicePixelRatio || 1;
    const physicalFontSize = fontSize * pixelRatio;

    ctx.font = `${physicalFontSize}px ${fontFamily}`;
    ctx.textBaseline = "alphabetic";

    const metrics = ctx.measureText("M");
    const actualAscent = metrics.actualBoundingBoxAscent || physicalFontSize;
    const actualDescent =
      metrics.actualBoundingBoxDescent || physicalFontSize * 0.3;

    return {
      width: Math.ceil(metrics.width / pixelRatio),
      height: Math.ceil((actualAscent + actualDescent) / pixelRatio),
    };
  }

  private calculateSize(): { cols: number; rows: number } {
    const viewportWidth = this.container.clientWidth || window.innerWidth;
    const viewportHeight = this.container.clientHeight || window.innerHeight;

    const cols = Math.max(20, Math.floor(viewportWidth / this.cellWidth));
    const rows = Math.max(5, Math.floor(viewportHeight / this.cellHeight));

    return { cols, rows };
  }

  handleOutput(data: string): void {
    this.terminal.write(data);
    this.updateScrollback();

    if (this.scrollMode === "auto") {
      this.scrollToBottom();
    } else {
      this.renderer.position(this.container.scrollTop);
    }

    this.renderer.scheduleRender();
  }

  private updateScrollback(): void {
    const scrollback = this.terminal.getScrollback();
    const size = this.terminal.getSize();

    this.renderer.updateScrollState(
      scrollback.viewportOffset,
      scrollback.totalRows
    );

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

    const scrollback = this.terminal.getScrollback();
    const size = this.terminal.getSize();
    const activeAreaOffset = Math.max(0, scrollback.totalRows - size.rows);
    this.terminal.setViewportOffset(activeAreaOffset);

    this.renderer.updateScrollState(activeAreaOffset, scrollback.totalRows);
    this.renderer.position(this.container.scrollTop);
  }

  private setupScrollHandler(): void {
    this.container.addEventListener("scroll", () => {
      const scrollTop = this.container.scrollTop;
      const size = this.terminal.getSize();
      const scrollback = this.terminal.getScrollback();

      const maxOffset = Math.max(0, scrollback.totalRows - size.rows);
      const rawOffset = Math.floor(scrollTop / this.cellHeight);
      const rowOffset = Math.min(maxOffset, Math.max(0, rawOffset));

      const isAtBottom =
        scrollTop + this.container.clientHeight >=
        this.container.scrollHeight - 10;

      this.scrollMode = isAtBottom ? "auto" : "pinned";
      this.terminal.setViewportOffset(rowOffset);

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
    const { cols, rows } = this.calculateSize();

    if (oldSize.cols === cols && oldSize.rows === rows) {
      return;
    }

    this.terminal.resize(cols, rows);
    this.renderer.resize();
    this.updateScrollback();
    io.onResize(cols, rows);
    this.renderer.scheduleRender();
  }

  getTitle(): string {
    return this.terminal.getTitle();
  }

  focus(): void {
    this.inputHandler.focus();
  }

  getSize(): { cols: number; rows: number } {
    return this.terminal.getSize();
  }

  destroy(): void {
    this.renderer.destroy();
    this.inputHandler.destroy();
    this.terminal.destroy();
    this.spacer.remove();
  }
}
