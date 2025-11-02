/**
 * Terminal input handling
 */

/**
 * Handle keyboard events and convert them to terminal sequences
 */
export class InputHandler {
  private inputElement: HTMLTextAreaElement;

  constructor(
    container: HTMLElement,
    private onData: (data: string) => void
  ) {
    // Create hidden input element
    this.inputElement = document.createElement("textarea");
    this.inputElement.id = "ghostty-input-capture";
    this.inputElement.style.position = "absolute";
    this.inputElement.style.top = "-9999px";
    this.inputElement.style.left = "-9999px";
    this.inputElement.style.opacity = "0";
    this.inputElement.setAttribute("autocomplete", "off");
    this.inputElement.setAttribute("autocorrect", "off");
    this.inputElement.setAttribute("autocapitalize", "off");
    this.inputElement.setAttribute("spellcheck", "false");

    document.body.appendChild(this.inputElement);

    this.setupEventHandlers(container);
  }

  private setupEventHandlers(container: HTMLElement): void {
    // Focus input when clicking in terminal
    container.addEventListener("click", () => {
      this.focus();
    });

    // Handle keyboard input
    this.inputElement.addEventListener("keydown", (e) => {
      let data: string | null = null;

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
      } else if (e.key === "PageUp") {
        data = "\x1b[5~";
        e.preventDefault();
      } else if (e.key === "PageDown") {
        data = "\x1b[6~";
        e.preventDefault();
      } else if (e.key === "Delete") {
        data = "\x1b[3~";
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
      } else if (e.ctrlKey && e.key === "z") {
        data = "\x1a";
        e.preventDefault();
      }

      if (data) {
        this.onData(data);
      }
    });

    // Handle text input
    this.inputElement.addEventListener("input", (e) => {
      const event = e as InputEvent;
      if (event.data) {
        this.onData(event.data);
      }
      this.inputElement.value = "";
    });

    // Prevent losing focus
    this.inputElement.addEventListener("blur", () => {
      setTimeout(() => this.focus(), 100);
    });
  }

  /**
   * Focus the input element
   */
  focus(): void {
    this.inputElement.focus();
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.inputElement.remove();
  }
}

