import type { GhosttyTerminal } from "@ghostty/wasm-api";
import type { TerminalConfig } from "./types.js";
import { TextureAtlasManager } from "./TextureAtlasManager.js";
import { vertexShaderSource, fragmentShaderSource } from "./shaders.js";

export class WebGLRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private pixelRatio: number;
  private renderScheduled = false;

  private cellWidth: number;
  private cellHeight: number;
  private fontFamily: string;
  private fontSize: number;
  private defaultBgColor: [number, number, number];
  private defaultFgColor: [number, number, number];

  private cachedViewportOffset = 0;
  private cachedTotalRows = 24;
  private cachedScrollTop = 0;

  private program: WebGLProgram;
  private atlasManager: TextureAtlasManager;
  private vertexBuffer: WebGLBuffer;

  private glyphAtlasTexture: WebGLTexture;
  private backgroundTexture: WebGLTexture;
  private foregroundTexture: WebGLTexture;
  private glyphCoordTexture: WebGLTexture;
  private glyphSizeTexture: WebGLTexture;

  private backgroundData: Uint8Array | null = null;
  private foregroundData: Uint8Array | null = null;
  private glyphCoordData: Uint8Array | null = null;
  private glyphSizeData: Uint8Array | null = null;

  private gridCols = 0;
  private gridRows = 0;

  private uniforms: {
    resolution: WebGLUniformLocation | null;
    gridSize: WebGLUniformLocation | null;
    cellSize: WebGLUniformLocation | null;
    glyphAtlas: WebGLUniformLocation | null;
    backgroundTex: WebGLUniformLocation | null;
    foregroundTex: WebGLUniformLocation | null;
    glyphCoordTex: WebGLUniformLocation | null;
    glyphSizeTex: WebGLUniformLocation | null;
  };

  constructor(
    private container: HTMLElement,
    private terminal: GhosttyTerminal,
    cellWidth: number,
    cellHeight: number,
    config: TerminalConfig = {},
    atlasManager?: TextureAtlasManager
  ) {
    this.cellWidth = cellWidth;
    this.cellHeight = cellHeight;
    this.fontFamily =
      config.fontFamily ?? '"Menlo", "Monaco", "Courier New", monospace';
    this.fontSize = config.fontSize ?? 16;

    this.defaultBgColor = this.parseColor(config.backgroundColor ?? "#000000");
    this.defaultFgColor = this.parseColor(config.foregroundColor ?? "#ffffff");

    this.pixelRatio = window.devicePixelRatio || 1;

    this.canvas = document.createElement("canvas");
    this.canvas.id = "ghostty-canvas";
    this.canvas.style.position = "absolute";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";

    const gl = this.canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      throw new Error("Failed to get WebGL context");
    }
    this.gl = gl;

    this.atlasManager =
      atlasManager ??
      new TextureAtlasManager(this.pixelRatio, this.cellWidth, this.cellHeight);

    this.program = this.createProgram();
    this.vertexBuffer = this.createVertexBuffer();

    this.glyphAtlasTexture = this.createTexture();
    this.backgroundTexture = this.createTexture();
    this.foregroundTexture = this.createTexture();
    this.glyphCoordTexture = this.createTexture();
    this.glyphSizeTexture = this.createTexture();

    this.uniforms = {
      resolution: gl.getUniformLocation(this.program, "u_resolution"),
      gridSize: gl.getUniformLocation(this.program, "u_gridSize"),
      cellSize: gl.getUniformLocation(this.program, "u_cellSize"),
      glyphAtlas: gl.getUniformLocation(this.program, "u_glyphAtlas"),
      backgroundTex: gl.getUniformLocation(this.program, "u_backgroundTex"),
      foregroundTex: gl.getUniformLocation(this.program, "u_foregroundTex"),
      glyphCoordTex: gl.getUniformLocation(this.program, "u_glyphCoordTex"),
      glyphSizeTex: gl.getUniformLocation(this.program, "u_glyphSizeTex"),
    };

    this.container.appendChild(this.canvas);
    this.resize();
  }

  resize(): void {
    const size = this.terminal.getSize();
    const logicalWidth = size.cols * this.cellWidth;
    const logicalHeight = size.rows * this.cellHeight;

    this.canvas.style.width = `${logicalWidth}px`;
    this.canvas.style.height = `${logicalHeight}px`;

    this.canvas.width = logicalWidth * this.pixelRatio;
    this.canvas.height = logicalHeight * this.pixelRatio;

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    if (size.cols !== this.gridCols || size.rows !== this.gridRows) {
      this.gridCols = size.cols;
      this.gridRows = size.rows;

      const cellCount = size.cols * size.rows;
      this.backgroundData = new Uint8Array(cellCount * 3);
      this.foregroundData = new Uint8Array(cellCount * 3);
      this.glyphCoordData = new Uint8Array(cellCount * 4);
      this.glyphSizeData = new Uint8Array(cellCount * 4);

      this.initializeDataTextures();
    }
  }

  position(scrollTop: number): void {
    if (this.cachedScrollTop !== scrollTop) {
      this.canvas.style.top = `${scrollTop}px`;
      this.cachedScrollTop = scrollTop;
    }
  }

  updateScrollState(viewportOffset: number, totalRows: number): void {
    this.cachedViewportOffset = viewportOffset;
    this.cachedTotalRows = totalRows;
  }

  scheduleRender(): void {
    if (!this.renderScheduled) {
      this.renderScheduled = true;
      requestAnimationFrame(() => {
        this.renderScheduled = false;
        this.render();
      });
    }
  }

  render(): void {
    const startTime = performance.now();

    this.position(this.container.scrollTop);

    const size = this.terminal.getSize();
    const cellBuffer = this.terminal.getAllCellsViewport();

    if (
      !cellBuffer ||
      !this.backgroundData ||
      !this.foregroundData ||
      !this.glyphCoordData ||
      !this.glyphSizeData
    ) {
      return;
    }

    this.updateCellData(cellBuffer, size);

    if (this.atlasManager.getNeedsUpload()) {
      this.uploadAtlas();
    }

    this.uploadCellDataTextures();
    this.drawFrame();

    const renderTime = performance.now() - startTime;
    console.log(`Frame rendered in ${renderTime.toFixed(2)}ms`);
  }

  getCellSize(): { width: number; height: number } {
    return {
      width: this.cellWidth,
      height: this.cellHeight,
    };
  }

  destroy(): void {
    const gl = this.gl;

    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteTexture(this.glyphAtlasTexture);
    gl.deleteTexture(this.backgroundTexture);
    gl.deleteTexture(this.foregroundTexture);
    gl.deleteTexture(this.glyphCoordTexture);
    gl.deleteTexture(this.glyphSizeTexture);
    gl.deleteProgram(this.program);

    this.canvas.remove();
  }

  private parseColor(color: string): [number, number, number] {
    const hex = color.replace("#", "");
    return [
      parseInt(hex.substr(0, 2), 16),
      parseInt(hex.substr(2, 2), 16),
      parseInt(hex.substr(4, 2), 16),
    ];
  }

  private createProgram(): WebGLProgram {
    const gl = this.gl;

    const vertexShader = this.compileShader(
      gl.VERTEX_SHADER,
      vertexShaderSource
    );
    const fragmentShader = this.compileShader(
      gl.FRAGMENT_SHADER,
      fragmentShaderSource
    );

    const program = gl.createProgram();
    if (!program) {
      throw new Error("Failed to create program");
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      throw new Error(`Failed to link program: ${info}`);
    }

    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error("Failed to create shader");
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      throw new Error(`Failed to compile shader: ${info}`);
    }

    return shader;
  }

  private createVertexBuffer(): WebGLBuffer {
    const gl = this.gl;
    const vertices = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);

    const buffer = gl.createBuffer();
    if (!buffer) {
      throw new Error("Failed to create vertex buffer");
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    return buffer;
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error("Failed to create texture");
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    return texture;
  }

  private initializeDataTextures(): void {
    const gl = this.gl;

    if (
      !this.backgroundData ||
      !this.foregroundData ||
      !this.glyphCoordData ||
      !this.glyphSizeData
    ) {
      console.error("Cannot initialize textures: data buffers are null");
      return;
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    gl.bindTexture(gl.TEXTURE_2D, this.backgroundTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB,
      this.gridCols,
      this.gridRows,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      this.backgroundData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.foregroundTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB,
      this.gridCols,
      this.gridRows,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      this.foregroundData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.glyphCoordTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.gridCols,
      this.gridRows,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.glyphCoordData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.glyphSizeTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.gridCols,
      this.gridRows,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.glyphSizeData
    );
  }

  private updateCellData(
    cellBuffer: Uint8Array,
    size: { cols: number; rows: number }
  ): void {
    if (
      !this.backgroundData ||
      !this.foregroundData ||
      !this.glyphCoordData ||
      !this.glyphSizeData
    ) {
      return;
    }

    const cursor = this.terminal.getCursor();
    const activeAreaStart = this.cachedTotalRows - size.rows;
    const cursorAbsoluteRow = activeAreaStart + cursor.y;
    const viewportCursorY = cursorAbsoluteRow - this.cachedViewportOffset;

    const dataView = new DataView(
      cellBuffer.buffer,
      cellBuffer.byteOffset,
      cellBuffer.byteLength
    );
    const cellSize = 14;

    for (let y = 0; y < size.rows; y++) {
      for (let x = 0; x < size.cols; x++) {
        const cellIndex = y * size.cols + x;
        const bufferOffset = cellIndex * cellSize;

        const codepoint = dataView.getUint32(bufferOffset, true);
        const fgR = cellBuffer[bufferOffset + 4];
        const fgG = cellBuffer[bufferOffset + 5];
        const fgB = cellBuffer[bufferOffset + 6];
        const bgR = cellBuffer[bufferOffset + 7];
        const bgG = cellBuffer[bufferOffset + 8];
        const bgB = cellBuffer[bufferOffset + 9];
        const bold = cellBuffer[bufferOffset + 10] !== 0;
        const italic = cellBuffer[bufferOffset + 11] !== 0;

        const bgIdx = cellIndex * 3;
        const fgIdx = cellIndex * 3;
        const glyphIdx = cellIndex * 4;

        const isCursor = x === cursor.x && y === viewportCursorY;

        if (isCursor) {
          this.backgroundData[bgIdx] = fgR;
          this.backgroundData[bgIdx + 1] = fgG;
          this.backgroundData[bgIdx + 2] = fgB;
          this.foregroundData[fgIdx] = bgR;
          this.foregroundData[fgIdx + 1] = bgG;
          this.foregroundData[fgIdx + 2] = bgB;
        } else {
          this.backgroundData[bgIdx] = bgR;
          this.backgroundData[bgIdx + 1] = bgG;
          this.backgroundData[bgIdx + 2] = bgB;
          this.foregroundData[fgIdx] = fgR;
          this.foregroundData[fgIdx + 1] = fgG;
          this.foregroundData[fgIdx + 2] = fgB;
        }

        if (codepoint && codepoint !== 32) {
          const glyph = this.atlasManager.getGlyph(
            codepoint,
            this.fontSize,
            this.fontFamily,
            bold,
            italic
          );

          const atlasSize = this.atlasManager.getAtlasSize();
          const pixelU = Math.floor(glyph.u * atlasSize);
          const pixelV = Math.floor(glyph.v * atlasSize);
          const pixelWidth = Math.floor(glyph.width * atlasSize);
          const pixelHeight = Math.floor(glyph.height * atlasSize);

          this.glyphCoordData[glyphIdx] = (pixelU >> 8) & 0xff;
          this.glyphCoordData[glyphIdx + 1] = pixelU & 0xff;
          this.glyphCoordData[glyphIdx + 2] = (pixelV >> 8) & 0xff;
          this.glyphCoordData[glyphIdx + 3] = pixelV & 0xff;

          this.glyphSizeData![glyphIdx] = (pixelWidth >> 8) & 0xff;
          this.glyphSizeData![glyphIdx + 1] = pixelWidth & 0xff;
          this.glyphSizeData![glyphIdx + 2] = (pixelHeight >> 8) & 0xff;
          this.glyphSizeData![glyphIdx + 3] = pixelHeight & 0xff;
        } else {
          this.glyphCoordData[glyphIdx] = 0;
          this.glyphCoordData[glyphIdx + 1] = 0;
          this.glyphCoordData[glyphIdx + 2] = 0;
          this.glyphCoordData[glyphIdx + 3] = 0;
          this.glyphSizeData![glyphIdx] = 0;
          this.glyphSizeData![glyphIdx + 1] = 0;
          this.glyphSizeData![glyphIdx + 2] = 0;
          this.glyphSizeData![glyphIdx + 3] = 0;
        }
      }
    }
  }

  private uploadAtlas(): void {
    const gl = this.gl;
    const atlasCanvas = this.atlasManager.getAtlasCanvas();

    gl.bindTexture(gl.TEXTURE_2D, this.glyphAtlasTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      atlasCanvas
    );

    this.atlasManager.clearNeedsUpload();
  }

  private uploadCellDataTextures(): void {
    const gl = this.gl;

    if (
      !this.backgroundData ||
      !this.foregroundData ||
      !this.glyphCoordData ||
      !this.glyphSizeData
    ) {
      return;
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    gl.bindTexture(gl.TEXTURE_2D, this.backgroundTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.gridCols,
      this.gridRows,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      this.backgroundData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.foregroundTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.gridCols,
      this.gridRows,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      this.foregroundData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.glyphCoordTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.gridCols,
      this.gridRows,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.glyphCoordData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.glyphSizeTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.gridCols,
      this.gridRows,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.glyphSizeData
    );
  }

  private drawFrame(): void {
    const gl = this.gl;

    if (this.gridCols === 0 || this.gridRows === 0) {
      console.warn("Skipping draw: grid not initialized");
      return;
    }

    gl.useProgram(this.program);

    const physicalCellWidth = this.cellWidth * this.pixelRatio;
    const physicalCellHeight = this.cellHeight * this.pixelRatio;

    gl.uniform2f(
      this.uniforms.resolution,
      this.canvas.width,
      this.canvas.height
    );
    gl.uniform2f(this.uniforms.gridSize, this.gridCols, this.gridRows);
    gl.uniform2f(this.uniforms.cellSize, physicalCellWidth, physicalCellHeight);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.glyphAtlasTexture);
    gl.uniform1i(this.uniforms.glyphAtlas, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backgroundTexture);
    gl.uniform1i(this.uniforms.backgroundTex, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.foregroundTexture);
    gl.uniform1i(this.uniforms.foregroundTex, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.glyphCoordTexture);
    gl.uniform1i(this.uniforms.glyphCoordTex, 3);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.glyphSizeTexture);
    gl.uniform1i(this.uniforms.glyphSizeTex, 4);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    const positionLoc = gl.getAttribLocation(this.program, "a_position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
