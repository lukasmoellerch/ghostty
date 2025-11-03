/**
 * Type definitions for libghostty-vt WASM API
 */

/**
 * WASM exports from the libghostty-vt module
 */
export interface GhosttyWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;

  // Memory allocation helpers
  ghostty_wasm_alloc_opaque(): number;
  ghostty_wasm_free_opaque(ptr: number): void;
  ghostty_wasm_alloc_u8(): number;
  ghostty_wasm_free_u8(ptr: number): void;
  ghostty_wasm_alloc_u16(): number;
  ghostty_wasm_free_u16(ptr: number): void;
  ghostty_wasm_alloc_u32(): number;
  ghostty_wasm_free_u32(ptr: number): void;
  ghostty_wasm_alloc_usize(): number;
  ghostty_wasm_free_usize(ptr: number): void;
  ghostty_wasm_alloc_u8_array(size: number): number;
  ghostty_wasm_free_u8_array(ptr: number): void;
  ghostty_wasm_alloc_u16_array(size: number): number;
  ghostty_wasm_free_u16_array(ptr: number): void;

  // Terminal API
  ghostty_terminal_new(
    allocator: number,
    cols: number,
    rows: number,
    outPtr: number
  ): number;
  ghostty_terminal_free(terminal: number): void;
  ghostty_terminal_write(terminal: number, data: number, len: number): number;
  ghostty_terminal_resize(terminal: number, cols: number, rows: number): number;
  ghostty_terminal_clear(terminal: number): void;
  ghostty_terminal_reset(terminal: number): void;
  ghostty_terminal_get_size(
    terminal: number,
    colsPtr: number,
    rowsPtr: number
  ): void;
  ghostty_terminal_get_cursor(
    terminal: number,
    xPtr: number,
    yPtr: number
  ): void;
  ghostty_terminal_get_cursor_visible(terminal: number): boolean;
  ghostty_terminal_get_cell_viewport(
    terminal: number,
    x: number,
    y: number,
    codepointPtr: number,
    fgRPtr: number,
    fgGPtr: number,
    fgBPtr: number,
    bgRPtr: number,
    bgGPtr: number,
    bgBPtr: number,
    boldPtr: number,
    italicPtr: number,
    underlinePtr: number
  ): number;
  ghostty_terminal_get_all_cells_viewport(
    terminal: number,
    buffer: number
  ): number;
  ghostty_terminal_get_title(
    terminal: number,
    titlePtrPtr: number,
    titleLenPtr: number
  ): void;
  ghostty_terminal_get_scrollback(
    terminal: number,
    totalRowsPtr: number,
    viewportOffsetPtr: number,
    visibleRowsPtr: number
  ): void;
  ghostty_terminal_set_viewport_offset(terminal: number, offset: number): void;
}

/**
 * Terminal cell data
 */
export interface TerminalCell {
  codepoint: number;
  fg: { r: number; g: number; b: number };
  bg: { r: number; g: number; b: number };
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/**
 * Terminal cursor position
 */
export interface CursorPosition {
  x: number;
  y: number;
}

/**
 * Terminal size
 */
export interface TerminalSize {
  cols: number;
  rows: number;
}

/**
 * Scrollback information
 */
export interface ScrollbackInfo {
  totalRows: number;
  viewportOffset: number;
  visibleRows: number;
}

