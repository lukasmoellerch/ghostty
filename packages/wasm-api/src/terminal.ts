/**
 * TypeScript wrapper for the Ghostty Terminal WASM API
 */

import type {
  GhosttyWasmExports,
  TerminalCell,
  CursorPosition,
  TerminalSize,
  ScrollbackInfo,
} from "./types.js";
import { WasmMemoryManager } from "./memory.js";

/**
 * High-level wrapper for the Ghostty Terminal WASM API
 */
export class GhosttyTerminal {
  private terminalPtr: number;
  private memory: WasmMemoryManager;
  private _cols: number;
  private _rows: number;

  constructor(
    private exports: GhosttyWasmExports,
    cols: number,
    rows: number
  ) {
    this.memory = new WasmMemoryManager(exports);
    this._cols = cols;
    this._rows = rows;

    // Create terminal instance
    const termPtrPtr = this.memory.allocOpaque();
    const result = this.exports.ghostty_terminal_new(0, cols, rows, termPtrPtr);

    if (result !== 0) {
      this.memory.freeOpaque(termPtrPtr);
      throw new Error(`Failed to create terminal: error code ${result}`);
    }

    this.terminalPtr = this.memory.readU32(termPtrPtr);
    this.memory.freeOpaque(termPtrPtr);
  }

  /**
   * Get the terminal pointer (for advanced use cases)
   */
  getPtr(): number {
    return this.terminalPtr;
  }

  /**
   * Get the memory manager (for advanced use cases)
   */
  getMemory(): WasmMemoryManager {
    return this.memory;
  }

  /**
   * Get the current terminal size
   */
  getSize(): TerminalSize {
    return {
      cols: this._cols,
      rows: this._rows,
    };
  }

  /**
   * Write data to the terminal
   */
  write(data: string | Uint8Array): void {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;

    const dataPtr = this.memory.allocU8Array(bytes.length);
    this.memory.copyToMemory(dataPtr, bytes);

    const result = this.exports.ghostty_terminal_write(
      this.terminalPtr,
      dataPtr,
      bytes.length
    );

    this.memory.freeU8Array(dataPtr);

    if (result !== 0) {
      throw new Error(`Terminal write failed: error code ${result}`);
    }
  }

  /**
   * Resize the terminal
   */
  resize(cols: number, rows: number): void {
    const result = this.exports.ghostty_terminal_resize(
      this.terminalPtr,
      cols,
      rows
    );

    if (result !== 0) {
      throw new Error(`Terminal resize failed: error code ${result}`);
    }

    this._cols = cols;
    this._rows = rows;
  }

  /**
   * Clear the terminal
   */
  clear(): void {
    this.exports.ghostty_terminal_clear(this.terminalPtr);
  }

  /**
   * Reset the terminal
   */
  reset(): void {
    this.exports.ghostty_terminal_reset(this.terminalPtr);
  }

  /**
   * Get cursor position
   */
  getCursor(): CursorPosition {
    const xPtr = this.memory.allocU16();
    const yPtr = this.memory.allocU16();

    this.exports.ghostty_terminal_get_cursor(this.terminalPtr, xPtr, yPtr);

    const x = this.memory.readU16(xPtr);
    const y = this.memory.readU16(yPtr);

    this.memory.freeU16(xPtr);
    this.memory.freeU16(yPtr);

    return { x, y };
  }

  /**
   * Get cell data at viewport coordinates
   */
  getCellViewport(x: number, y: number): TerminalCell | null {
    const codepointPtr = this.memory.allocU32();
    const fgRPtr = this.memory.allocU8();
    const fgGPtr = this.memory.allocU8();
    const fgBPtr = this.memory.allocU8();
    const bgRPtr = this.memory.allocU8();
    const bgGPtr = this.memory.allocU8();
    const bgBPtr = this.memory.allocU8();
    const boldPtr = this.memory.allocU8();
    const italicPtr = this.memory.allocU8();
    const underlinePtr = this.memory.allocU8();

    const hasCell = this.exports.ghostty_terminal_get_cell_viewport(
      this.terminalPtr,
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

    if (!hasCell) {
      this.memory.freeU32(codepointPtr);
      this.memory.freeU8(fgRPtr);
      this.memory.freeU8(fgGPtr);
      this.memory.freeU8(fgBPtr);
      this.memory.freeU8(bgRPtr);
      this.memory.freeU8(bgGPtr);
      this.memory.freeU8(bgBPtr);
      this.memory.freeU8(boldPtr);
      this.memory.freeU8(italicPtr);
      this.memory.freeU8(underlinePtr);
      return null;
    }

    const cell: TerminalCell = {
      codepoint: this.memory.readU32(codepointPtr),
      fg: {
        r: this.memory.readU8(fgRPtr),
        g: this.memory.readU8(fgGPtr),
        b: this.memory.readU8(fgBPtr),
      },
      bg: {
        r: this.memory.readU8(bgRPtr),
        g: this.memory.readU8(bgGPtr),
        b: this.memory.readU8(bgBPtr),
      },
      bold: this.memory.readU8(boldPtr) !== 0,
      italic: this.memory.readU8(italicPtr) !== 0,
      underline: this.memory.readU8(underlinePtr) !== 0,
    };

    this.memory.freeU32(codepointPtr);
    this.memory.freeU8(fgRPtr);
    this.memory.freeU8(fgGPtr);
    this.memory.freeU8(fgBPtr);
    this.memory.freeU8(bgRPtr);
    this.memory.freeU8(bgGPtr);
    this.memory.freeU8(bgBPtr);
    this.memory.freeU8(boldPtr);
    this.memory.freeU8(italicPtr);
    this.memory.freeU8(underlinePtr);

    return cell;
  }

  /**
   * Get all cells in the viewport at once.
   * Returns an array of TerminalCell objects in row-major order.
   */
  getAllCellsViewport(): TerminalCell[] {
    const size = this.getSize();
    const totalCells = size.cols * size.rows;
    const cellSize = 14; // bytes per cell
    const bufferSize = totalCells * cellSize;

    // Allocate buffer in WASM memory
    const bufferPtr = this.memory.allocU8Array(bufferSize);

    const success = this.exports.ghostty_terminal_get_all_cells_viewport(
      this.terminalPtr,
      bufferPtr
    );

    if (!success) {
      this.memory.freeU8Array(bufferPtr);
      return [];
    }

    // Read cell data from buffer
    const buffer = this.memory.copyFromMemory(bufferPtr, bufferSize);
    const dataView = new DataView(buffer.buffer, buffer.byteOffset, bufferSize);
    const cells: TerminalCell[] = [];

    for (let i = 0; i < totalCells; i++) {
      const offset = i * cellSize;
      const codepoint = dataView.getUint32(offset, true); // true = little endian
      const fgR = buffer[offset + 4];
      const fgG = buffer[offset + 5];
      const fgB = buffer[offset + 6];
      const bgR = buffer[offset + 7];
      const bgG = buffer[offset + 8];
      const bgB = buffer[offset + 9];
      const bold = buffer[offset + 10] !== 0;
      const italic = buffer[offset + 11] !== 0;
      const underline = buffer[offset + 12] !== 0;

      cells.push({
        codepoint,
        fg: { r: fgR, g: fgG, b: fgB },
        bg: { r: bgR, g: bgG, b: bgB },
        bold,
        italic,
        underline,
      });
    }

    this.memory.freeU8Array(bufferPtr);
    return cells;
  }

  /**
   * Get terminal title
   */
  getTitle(): string {
    const titlePtrPtr = this.memory.allocOpaque();
    const titleLenPtr = this.memory.allocUsize();

    this.exports.ghostty_terminal_get_title(
      this.terminalPtr,
      titlePtrPtr,
      titleLenPtr
    );

    const titlePtr = this.memory.readU32(titlePtrPtr);
    const titleLen = this.memory.readUsize(titleLenPtr);

    this.memory.freeOpaque(titlePtrPtr);
    this.memory.freeUsize(titleLenPtr);

    if (titleLen === 0) {
      return "";
    }

    return this.memory.readString(titlePtr, titleLen);
  }

  /**
   * Get scrollback information
   */
  getScrollback(): ScrollbackInfo {
    const totalRowsPtr = this.memory.allocUsize();
    const viewportOffsetPtr = this.memory.allocUsize();
    const visibleRowsPtr = this.memory.allocUsize();

    this.exports.ghostty_terminal_get_scrollback(
      this.terminalPtr,
      totalRowsPtr,
      viewportOffsetPtr,
      visibleRowsPtr
    );

    const info: ScrollbackInfo = {
      totalRows: this.memory.readUsize(totalRowsPtr),
      viewportOffset: this.memory.readUsize(viewportOffsetPtr),
      visibleRows: this.memory.readUsize(visibleRowsPtr),
    };

    this.memory.freeUsize(totalRowsPtr);
    this.memory.freeUsize(viewportOffsetPtr);
    this.memory.freeUsize(visibleRowsPtr);

    return info;
  }

  /**
   * Set viewport offset for scrollback
   */
  setViewportOffset(offset: number): void {
    this.exports.ghostty_terminal_set_viewport_offset(this.terminalPtr, offset);
  }

  /**
   * Free the terminal
   */
  destroy(): void {
    if (this.terminalPtr) {
      this.exports.ghostty_terminal_free(this.terminalPtr);
      this.terminalPtr = 0;
    }
  }
}

