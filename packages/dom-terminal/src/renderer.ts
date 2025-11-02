/**
 * WebGL-based terminal renderer with texture atlas
 */

import type { GhosttyTerminal } from "@ghostty/wasm-api";
import type { TerminalConfig } from "./types.js";
import { TextureAtlasManager } from "./TextureAtlasManager.js";
import { vertexShaderSource, fragmentShaderSource } from "./shaders.js";

/**
 * Renders terminal content using WebGL for maximum performance
 */
export class WebGLRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private pixelRatio: number;
  private renderScheduled = false;

  // Rendering configuration
  private cellWidth: number;
  private cellHeight: number;
  private fontFamily: string;
  private fontSize: number;
  private defaultBgColor: [number, number, number];
  private defaultFgColor: [number, number, number];
  private cursorColor: [number, number, number];

  // Cached rendering state
  private cachedViewportOffset = 0;
  private cachedTotalRows = 24;
  private cachedScrollTop = 0;

  // WebGL resources
  private program: WebGLProgram;
  private atlasManager: TextureAtlasManager;

  // Vertex buffer (reused, never reallocated)
  private vertexBuffer: WebGLBuffer;

  // Textures (recreated on resize)
  private glyphAtlasTexture: WebGLTexture;
  private backgroundTexture: WebGLTexture;
  private foregroundTexture: WebGLTexture;
  private glyphCoordTexture: WebGLTexture; // UV coordinates (16-bit packed)
  private glyphSizeTexture: WebGLTexture; // Width/Height (16-bit packed)

  // Texture data buffers (reused to avoid allocations)
  private backgroundData: Uint8Array | null = null;
  private foregroundData: Uint8Array | null = null;
  private glyphCoordData: Uint8Array | null = null; // UV data
  private glyphSizeData: Uint8Array | null = null; // Width/Height data

  // Current grid size
  private gridCols = 0;
  private gridRows = 0;

  // Debug flag
  private hasLoggedUniforms = false;

  // Performance tracking
  private frameCount = 0;
  private lastPerfLog = 0;
  private perfStats = {
    updateCellData: 0,
    uploadAtlas: 0,
    uploadCellData: 0,
    drawFrame: 0,
    total: 0,
  };

  // Uniforms
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
    config: TerminalConfig = {},
    atlasManager?: TextureAtlasManager
  ) {
    this.cellWidth = config.cellWidth ?? 9;
    this.cellHeight = config.cellHeight ?? 18;
    this.fontFamily =
      config.fontFamily ?? '"Menlo", "Monaco", "Courier New", monospace';
    this.fontSize = config.fontSize ?? 16;

    this.defaultBgColor = this.parseColor(config.backgroundColor ?? "#000000");
    this.defaultFgColor = this.parseColor(config.foregroundColor ?? "#ffffff");
    this.cursorColor = this.parseColor(config.cursorColor ?? "#00ff00");

    this.pixelRatio = window.devicePixelRatio || 1;

    // Create canvas
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

    // Use shared or create new atlas manager
    // Pass pixel ratio and cell size so atlas renders at exact screen resolution
    this.atlasManager =
      atlasManager ??
      new TextureAtlasManager(this.pixelRatio, this.cellWidth, this.cellHeight);

    // Initialize WebGL resources
    this.program = this.createProgram();
    this.vertexBuffer = this.createVertexBuffer();

    // Create textures
    this.glyphAtlasTexture = this.createTexture();
    this.backgroundTexture = this.createTexture();
    this.foregroundTexture = this.createTexture();
    this.glyphCoordTexture = this.createTexture();
    this.glyphSizeTexture = this.createTexture();

    // Get uniform locations
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

    // Update viewport
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // Only reallocate texture data if grid size changed
    if (size.cols !== this.gridCols || size.rows !== this.gridRows) {
      this.gridCols = size.cols;
      this.gridRows = size.rows;

      const cellCount = size.cols * size.rows;
      // Each cell: RGB for bg/fg (3 bytes), RGBA for glyph coords (4 bytes), RGBA for sizes (4 bytes)
      this.backgroundData = new Uint8Array(cellCount * 3);
      this.foregroundData = new Uint8Array(cellCount * 3);
      this.glyphCoordData = new Uint8Array(cellCount * 4);
      this.glyphSizeData = new Uint8Array(cellCount * 4);

      // Initialize textures with new size
      this.initializeDataTextures();
    }
  }

  /**
   * Position the canvas within the scrollable container
   */
  position(scrollTop: number): void {
    if (this.cachedScrollTop !== scrollTop) {
      this.canvas.style.top = `${scrollTop}px`;
      this.cachedScrollTop = scrollTop;
    }
  }

  /**
   * Update cached rendering state for performance
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
      const scheduleTime = performance.now();
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
    const frameStart = performance.now();

    // Ensure canvas is positioned correctly
    this.position(this.container.scrollTop);

    const t_getSize = performance.now();
    const size = this.terminal.getSize();
    const getSizeTime = performance.now() - t_getSize;

    const t_getCells = performance.now();
    const cells = this.terminal.getAllCellsViewport();
    const getCellsTime = performance.now() - t_getCells;

    if (getSizeTime > 1 || getCellsTime > 1) {
      console.log(
        `Terminal API: getSize=${getSizeTime.toFixed(
          2
        )}ms, getCells=${getCellsTime.toFixed(2)}ms`
      );
    }

    if (
      !this.backgroundData ||
      !this.foregroundData ||
      !this.glyphCoordData ||
      !this.glyphSizeData
    ) {
      return;
    }

    // Update texture data from terminal cells (no allocations here)
    let t0 = performance.now();
    this.updateCellData(cells, size);
    const updateTime = performance.now() - t0;

    // Upload atlas if needed
    t0 = performance.now();
    if (this.atlasManager.getNeedsUpload()) {
      this.uploadAtlas();
    }
    const atlasTime = performance.now() - t0;

    // Upload cell data textures
    t0 = performance.now();
    this.uploadCellDataTextures();
    const uploadTime = performance.now() - t0;

    // Render
    t0 = performance.now();
    this.drawFrame();
    const drawTime = performance.now() - t0;

    const totalTime = performance.now() - frameStart;

    // Accumulate stats
    this.perfStats.updateCellData += updateTime;
    this.perfStats.uploadAtlas += atlasTime;
    this.perfStats.uploadCellData += uploadTime;
    this.perfStats.drawFrame += drawTime;
    this.perfStats.total += totalTime;
    this.frameCount++;

    // Log every 10 frames for more frequent feedback
    if (this.frameCount % 10 === 0 && this.frameCount > 0) {
      const now = performance.now();
      if (this.lastPerfLog === 0) {
        this.lastPerfLog = now;
        return;
      }
      const elapsed = now - this.lastPerfLog;
      const fps = (10 / elapsed) * 1000;

      console.log(
        `Performance (10 frames, ${fps.toFixed(1)} fps):\n` +
          `  Update cells: ${(this.perfStats.updateCellData / 10).toFixed(
            2
          )}ms avg\n` +
          `  Upload atlas: ${(this.perfStats.uploadAtlas / 10).toFixed(
            2
          )}ms avg\n` +
          `  Upload data:  ${(this.perfStats.uploadCellData / 10).toFixed(
            2
          )}ms avg\n` +
          `  Draw frame:   ${(this.perfStats.drawFrame / 10).toFixed(
            2
          )}ms avg\n` +
          `  Total:        ${(this.perfStats.total / 10).toFixed(2)}ms avg`
      );

      // Reset stats for next batch
      this.lastPerfLog = now;
      this.perfStats = {
        updateCellData: 0,
        uploadAtlas: 0,
        uploadCellData: 0,
        drawFrame: 0,
        total: 0,
      };
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

  // ========== Private Helper Methods ==========

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

    // Full-screen quad (two triangles)
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

    // Set pixel storage to 1-byte alignment (no padding)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    // Background texture (RGB)
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

    // Foreground texture (RGB)
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

    // Glyph coord texture (RGBA for UV 16-bit)
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

    // Glyph size texture (RGBA for width/height 16-bit)
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
    cells: any[],
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

    for (let y = 0; y < size.rows; y++) {
      for (let x = 0; x < size.cols; x++) {
        const cellIndex = y * size.cols + x;
        const cell = cells[cellIndex];

        const bgIdx = cellIndex * 3;
        const fgIdx = cellIndex * 3;
        const glyphIdx = cellIndex * 4;

        // Check if this is the cursor position
        const isCursor = x === cursor.x && y === viewportCursorY;

        if (cell) {
          // Invert colors at cursor position for visibility
          if (isCursor) {
            // Cursor: swap fg/bg to create inverted block
            this.backgroundData[bgIdx] = cell.fg.r;
            this.backgroundData[bgIdx + 1] = cell.fg.g;
            this.backgroundData[bgIdx + 2] = cell.fg.b;
            this.foregroundData[fgIdx] = cell.bg.r;
            this.foregroundData[fgIdx + 1] = cell.bg.g;
            this.foregroundData[fgIdx + 2] = cell.bg.b;
          } else {
            // Normal cell
            this.backgroundData[bgIdx] = cell.bg.r;
            this.backgroundData[bgIdx + 1] = cell.bg.g;
            this.backgroundData[bgIdx + 2] = cell.bg.b;
            this.foregroundData[fgIdx] = cell.fg.r;
            this.foregroundData[fgIdx + 1] = cell.fg.g;
            this.foregroundData[fgIdx + 2] = cell.fg.b;
          }

          // Glyph data
          if (cell.codepoint && cell.codepoint !== 32) {
            const glyph = this.atlasManager.getGlyph(
              cell.codepoint,
              this.fontSize,
              this.fontFamily,
              cell.bold,
              cell.italic
            );

            // Pack 16-bit coordinates using two textures
            const atlasSize = this.atlasManager.getAtlasSize();
            const pixelU = Math.floor(glyph.u * atlasSize);
            const pixelV = Math.floor(glyph.v * atlasSize);
            const pixelWidth = Math.floor(glyph.width * atlasSize);
            const pixelHeight = Math.floor(glyph.height * atlasSize);

            // Pack UV in glyphCoordData: R=U_high, G=U_low, B=V_high, A=V_low
            this.glyphCoordData[glyphIdx] = (pixelU >> 8) & 0xff;
            this.glyphCoordData[glyphIdx + 1] = pixelU & 0xff;
            this.glyphCoordData[glyphIdx + 2] = (pixelV >> 8) & 0xff;
            this.glyphCoordData[glyphIdx + 3] = pixelV & 0xff;

            // Pack width/height in glyphSizeData: R=W_high, G=W_low, B=H_high, A=H_low
            this.glyphSizeData![glyphIdx] = (pixelWidth >> 8) & 0xff;
            this.glyphSizeData![glyphIdx + 1] = pixelWidth & 0xff;
            this.glyphSizeData![glyphIdx + 2] = (pixelHeight >> 8) & 0xff;
            this.glyphSizeData![glyphIdx + 3] = pixelHeight & 0xff;
          } else {
            // No glyph (space or empty)
            this.glyphCoordData[glyphIdx] = 0;
            this.glyphCoordData[glyphIdx + 1] = 0;
            this.glyphCoordData[glyphIdx + 2] = 0;
            this.glyphCoordData[glyphIdx + 3] = 0;
            this.glyphSizeData![glyphIdx] = 0;
            this.glyphSizeData![glyphIdx + 1] = 0;
            this.glyphSizeData![glyphIdx + 2] = 0;
            this.glyphSizeData![glyphIdx + 3] = 0;
          }
        } else {
          // Empty cell - use defaults
          this.backgroundData[bgIdx] = this.defaultBgColor[0];
          this.backgroundData[bgIdx + 1] = this.defaultBgColor[1];
          this.backgroundData[bgIdx + 2] = this.defaultBgColor[2];

          this.foregroundData[fgIdx] = this.defaultFgColor[0];
          this.foregroundData[fgIdx + 1] = this.defaultFgColor[1];
          this.foregroundData[fgIdx + 2] = this.defaultFgColor[2];

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

    // Use LINEAR filtering for the atlas to preserve anti-aliased text
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

    // Set pixel storage to 1-byte alignment (no padding)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    // Upload background data
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

    // Upload foreground data
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

    // Upload glyph coord data (UV)
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

    // Upload glyph size data (width/height)
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

    // Ensure we have valid grid dimensions
    if (this.gridCols === 0 || this.gridRows === 0) {
      console.warn("Skipping draw: grid not initialized");
      return;
    }

    gl.useProgram(this.program);

    // Set uniforms (all in physical pixels to match canvas dimensions)
    const physicalCellWidth = this.cellWidth * this.pixelRatio;
    const physicalCellHeight = this.cellHeight * this.pixelRatio;

    gl.uniform2f(
      this.uniforms.resolution,
      this.canvas.width,
      this.canvas.height
    );
    gl.uniform2f(this.uniforms.gridSize, this.gridCols, this.gridRows);
    gl.uniform2f(this.uniforms.cellSize, physicalCellWidth, physicalCellHeight);

    // Bind textures
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

    // Set up vertex attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    const positionLoc = gl.getAttribLocation(this.program, "a_position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    // Draw (single draw call!)
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
