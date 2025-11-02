export interface TerminalIO {
  onInput(data: string): void;
  onResize(cols: number, rows: number): void;
  onReady?(): void;
  destroy?(): void;
}

export interface TerminalConfig {
  fontFamily?: string;
  fontSize?: number;
  backgroundColor?: string;
  foregroundColor?: string;
}

export interface TerminalEventHandlers {
  onTitleChange?: (title: string) => void;
  onError?: (error: Error) => void;
  onReady?: () => void;
}
