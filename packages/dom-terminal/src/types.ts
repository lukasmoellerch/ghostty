/**
 * Type definitions for DOM terminal
 */

/**
 * Terminal I/O interface
 * Implementations provide the connection to the actual terminal backend (PTY, WebSocket, etc.)
 */
export interface TerminalIO {
  /**
   * Called when the terminal wants to send input
   */
  onInput(data: string): void;

  /**
   * Called when the terminal is resized
   */
  onResize(cols: number, rows: number): void;

  /**
   * Register a callback for when output is received
   */
  onOutput(callback: (data: string) => void): void;

  /**
   * Called when the terminal is ready
   */
  onReady?(): void;

  /**
   * Clean up resources
   */
  destroy?(): void;
}

/**
 * Terminal renderer configuration
 */
export interface TerminalConfig {
  /**
   * Cell width in pixels
   */
  cellWidth?: number;

  /**
   * Cell height in pixels
   */
  cellHeight?: number;

  /**
   * Font family
   */
  fontFamily?: string;

  /**
   * Font size
   */
  fontSize?: number;

  /**
   * Background color
   */
  backgroundColor?: string;

  /**
   * Foreground color
   */
  foregroundColor?: string;

  /**
   * Cursor color
   */
  cursorColor?: string;

  /**
   * Initial columns (if not auto-calculated)
   */
  cols?: number;

  /**
   * Initial rows (if not auto-calculated)
   */
  rows?: number;
}

/**
 * Terminal event handlers
 */
export interface TerminalEventHandlers {
  /**
   * Called when terminal title changes
   */
  onTitleChange?: (title: string) => void;

  /**
   * Called on terminal errors
   */
  onError?: (error: Error) => void;

  /**
   * Called when terminal is ready
   */
  onReady?: () => void;
}

