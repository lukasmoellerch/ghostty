/**
 * Canvas-based terminal renderer
 */

import type { GhosttyTerminal } from "@ghostty/wasm-api";
import type { TerminalConfig } from "./types.js";

/**
 * Renders terminal content to a canvas
 */
export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private pixelRatio: number;
  private renderScheduled = false;

  // Rendering configuration
  private cellWidth: number;
  private cellHeight: number;
  private fontFamily: string;
  private fontSize: number;
  private backgroundColor: string;
  private foregroundColor: string;
  private cursorColor: string;

  // Cached rendering state (updated by parent for performance)
  private cachedViewportOffset = 0;
  private cachedTotalRows = 24;

  constructor(
    private container: HTMLElement,
    private terminal: GhosttyTerminal,
    config: TerminalConfig = {}
  ) {
    this.cellWidth = config.cellWidth ?? 9;
    this.cellHeight = config.cellHeight ?? 18;
    this.fontFamily =
      config.fontFamily ?? '"Menlo", "Monaco", "Courier New", monospace';
    this.fontSize = config.fontSize ?? 16;
    this.backgroundColor = config.backgroundColor ?? "#000000";
    this.foregroundColor = config.foregroundColor ?? "#ffffff";
    this.cursorColor = config.cursorColor ?? "#00ff00";

    this.pixelRatio = window.devicePixelRatio || 1;

    // Create canvas
    this.canvas = document.createElement("canvas");
    this.canvas.id = "ghostty-canvas";
    this.canvas.style.position = "absolute";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.imageRendering = "pixelated";

    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("Failed to get 2D context");
    }
    this.ctx = ctx;

    this.container.appendChild(this.canvas);
    this.resize();
  }

  /**
   * Resize canvas to match terminal size
   */
  resize(): void {
    const size = this.terminal.getSize();
    const logicalWidth = size.cols * this.cellWidth;
    const logicalHeight = size.rows * this.cellHeight;

    // Set CSS size (logical pixels)
    this.canvas.style.width = `${logicalWidth}px`;
    this.canvas.style.height = `${logicalHeight}px`;

    // Set canvas internal size (physical pixels)
    this.canvas.width = logicalWidth * this.pixelRatio;
    this.canvas.height = logicalHeight * this.pixelRatio;

    // Scale context for high-DPI
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.pixelRatio, this.pixelRatio);

    // Set font
    this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
    this.ctx.textBaseline = "top";
  }

  /**
   * Position the canvas within the scrollable container
   */
  position(scrollTop: number): void {
    this.canvas.style.top = `${scrollTop}px`;
  }

  /**
   * Update cached rendering state for performance
   * Called by parent when scrollback state changes
   */
  updateScrollState(viewportOffset: number, totalRows: number): void {
    this.cachedViewportOffset = viewportOffset;
    this.cachedTotalRows = totalRows;
  }

  /**
   * Schedule a render on the next animation frame
   */
  scheduleRender(): void {
    if (!this.renderScheduled) {
      this.renderScheduled = true;
      requestAnimationFrame(() => {
        this.renderScheduled = false;
        this.render();
      });
    }
  }

  /**
   * Render the terminal content
   */
  render(): void {
    // Ensure canvas is positioned correctly before rendering
    this.position(this.container.scrollTop);

    const size = this.terminal.getSize();

    // Clear canvas
    this.ctx.fillStyle = this.backgroundColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Get all cells in a single API call
    const cells = this.terminal.getAllCellsViewport();
    if (cells.length === 0) {
      this.renderCursor();
      return;
    }

    // Render backgrounds first, merging adjacent cells with the same color on x-axis
    for (let y = 0; y < size.rows; y++) {
      let x = 0;
      while (x < size.cols) {
        const cellIndex = y * size.cols + x;
        const cell = cells[cellIndex];
        if (!cell) {
          x++;
          continue;
        }

        // Skip default background (black)
        if (cell.bg.r === 0 && cell.bg.g === 0 && cell.bg.b === 0) {
          x++;
          continue;
        }

        // Find the extent of cells with the same background color
        const bgColor = `${cell.bg.r},${cell.bg.g},${cell.bg.b}`;
        let endX = x + 1;
        while (endX < size.cols) {
          const nextCellIndex = y * size.cols + endX;
          const nextCell = cells[nextCellIndex];
          if (!nextCell) break;
          const nextBgColor = `${nextCell.bg.r},${nextCell.bg.g},${nextCell.bg.b}`;
          if (nextBgColor !== bgColor) break;
          endX++;
        }

        // Draw merged background rectangle
        const px = x * this.cellWidth;
        const py = y * this.cellHeight;
        const width = (endX - x) * this.cellWidth;
        this.ctx.fillStyle = `rgb(${bgColor})`;
        this.ctx.fillRect(px, py, width, this.cellHeight);

        x = endX;
      }
    }

    // Render text on top of backgrounds
    for (let y = 0; y < size.rows; y++) {
      for (let x = 0; x < size.cols; x++) {
        const cellIndex = y * size.cols + x;
        const cell = cells[cellIndex];
        if (!cell) continue;

        const px = x * this.cellWidth;
        const py = y * this.cellHeight;

        // Draw character
        if (cell.codepoint && cell.codepoint !== 32) {
          // 32 is space
          this.ctx.fillStyle = `rgb(${cell.fg.r}, ${cell.fg.g}, ${cell.fg.b})`;
          const fontStyle = cell.bold ? "bold " : "";
          const fontVariant = cell.italic ? "italic " : "";
          this.ctx.font = `${fontVariant}${fontStyle}${this.fontSize}px ${this.fontFamily}`;
          const char = String.fromCodePoint(cell.codepoint);
          this.ctx.fillText(char, px + 1, py + 1);
        }
      }
    }

    // Draw cursor
    this.renderCursor();
  }

  private renderCursor(): void {
    const cursor = this.terminal.getCursor();
    const size = this.terminal.getSize();

    // Use cached values for performance
    const activeAreaStart = this.cachedTotalRows - size.rows;
    const cursorAbsoluteRow = activeAreaStart + cursor.y;
    const viewportCursorY = cursorAbsoluteRow - this.cachedViewportOffset;

    // Only draw if cursor is visible
    if (viewportCursorY >= 0 && viewportCursorY < size.rows) {
      const px = cursor.x * this.cellWidth;
      const py = viewportCursorY * this.cellHeight;
      this.ctx.fillStyle = this.cursorColor;
      this.ctx.fillRect(px, py + this.cellHeight - 2, this.cellWidth, 2);
    }
  }

  /**
   * Get cell dimensions
   */
  getCellSize(): { width: number; height: number } {
    return {
      width: this.cellWidth,
      height: this.cellHeight,
    };
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.canvas.remove();
  }
}
