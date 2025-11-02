/**
 * Manages a shared texture atlas for rendering glyphs across multiple terminals
 */

interface GlyphKey {
  codepoint: number;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
}

interface GlyphInfo {
  u: number; // UV coordinates in atlas (0-1), excluding padding
  v: number;
  width: number; // Glyph width in atlas (0-1), excluding padding
  height: number;
}

export class TextureAtlasManager {
  private atlas: HTMLCanvasElement;
  private atlasCtx: CanvasRenderingContext2D;
  private glyphCache = new Map<string, GlyphInfo>();

  // Atlas packing state
  private atlasSize = 2048; // 2048x2048 atlas for good capacity
  private currentX = 0;
  private currentY = 0;
  private currentRowHeight = 0;

  // Padding around glyphs (in physical pixels) to prevent bleeding
  private readonly paddingX = 4; // Left + right padding
  private readonly paddingY = 4; // Top + bottom padding

  // Monospace font cell dimensions (measured once from reference glyph)
  // These include padding for allocation, but we return UVs excluding padding
  private allocatedCellWidth = 0; // Width with padding
  private allocatedCellHeight = 0; // Height with padding
  private renderableCellWidth = 0; // Width without padding
  private renderableCellHeight = 0; // Height without padding
  private cellBaseline = 0; // Baseline position from top (within padded cell)

  private needsUpload = false;
  private pixelRatio: number;

  constructor(
    pixelRatio: number = 1,
    logicalCellWidth?: number,
    logicalCellHeight?: number
  ) {
    this.pixelRatio = pixelRatio;

    // If cell dimensions provided, use them directly (no need to measure)
    if (logicalCellWidth && logicalCellHeight) {
      const physicalWidth = Math.ceil(logicalCellWidth * pixelRatio);
      const physicalHeight = Math.ceil(logicalCellHeight * pixelRatio);

      this.renderableCellWidth = physicalWidth;
      this.renderableCellHeight = physicalHeight;
      this.allocatedCellWidth = physicalWidth + this.paddingX;
      this.allocatedCellHeight = physicalHeight + this.paddingY;
      this.cellBaseline = Math.ceil(physicalHeight * 0.8) + this.paddingY / 2; // Approximate baseline
    }

    this.atlas = document.createElement("canvas");
    this.atlas.width = this.atlasSize;
    this.atlas.height = this.atlasSize;

    const ctx = this.atlas.getContext("2d", {
      alpha: true,
      willReadFrequently: false,
    });
    if (!ctx) {
      throw new Error("Failed to create atlas context");
    }
    this.atlasCtx = ctx;

    // Enable high-quality text rendering
    this.atlasCtx.imageSmoothingEnabled = true;
    this.atlasCtx.imageSmoothingQuality = "high";

    // Enable font smoothing hints (browser-specific)
    this.atlasCtx.textRendering = "optimizeLegibility";
    (this.atlasCtx as any).fontSmooth = "always"; // For browsers that support it
    (this.atlasCtx as any).webkitFontSmoothing = "antialiased"; // Webkit-specific

    // Clear to transparent black
    this.atlasCtx.clearRect(0, 0, this.atlasSize, this.atlasSize);
  }

  /**
   * Get or render a glyph into the atlas
   */
  getGlyph(
    codepoint: number,
    fontSize: number,
    fontFamily: string,
    bold: boolean = false,
    italic: boolean = false
  ): GlyphInfo {
    const key = this.makeKey(codepoint, fontSize, fontFamily, bold, italic);

    // Return cached glyph if available
    const cached = this.glyphCache.get(key);
    if (cached) {
      return cached;
    }

    // Measure cell dimensions if not yet set (using "M" as reference)
    // This happens when no cell dimensions were provided in constructor
    if (this.allocatedCellWidth === 0) {
      this.measureCellDimensions(fontSize, fontFamily, bold, italic);
    }

    // Render new glyph
    return this.renderGlyph(codepoint, fontSize, fontFamily, bold, italic);
  }

  /**
   * Measure consistent cell dimensions for monospace font
   * Renders at physical pixel size to match screen DPI
   */
  private measureCellDimensions(
    fontSize: number,
    fontFamily: string,
    bold: boolean,
    italic: boolean
  ): void {
    // Render at physical pixel size for crisp rendering
    const physicalFontSize = fontSize * this.pixelRatio;

    const fontStyle = italic ? "italic " : "";
    const fontWeight = bold ? "bold " : "";
    this.atlasCtx.font = `${fontStyle}${fontWeight}${physicalFontSize}px ${fontFamily}`;
    this.atlasCtx.textBaseline = "alphabetic";

    // Measure "M" as reference (typically widest character in monospace)
    const metrics = this.atlasCtx.measureText("M");
    const actualAscent = metrics.actualBoundingBoxAscent || physicalFontSize;
    const actualDescent =
      metrics.actualBoundingBoxDescent || physicalFontSize * 0.3;

    // Store renderable dimensions (without padding)
    this.renderableCellWidth = Math.ceil(metrics.width);
    this.renderableCellHeight = Math.ceil(actualAscent + actualDescent);

    // Store allocated dimensions (with padding to prevent bleeding)
    this.allocatedCellWidth = this.renderableCellWidth + this.paddingX;
    this.allocatedCellHeight = this.renderableCellHeight + this.paddingY;

    // Baseline position from top (within padded cell)
    this.cellBaseline = Math.ceil(actualAscent) + this.paddingY / 2;
  }

  /**
   * Check if atlas texture needs to be uploaded to GPU
   */
  getNeedsUpload(): boolean {
    return this.needsUpload;
  }

  /**
   * Mark atlas as uploaded
   */
  clearNeedsUpload(): void {
    this.needsUpload = false;
  }

  /**
   * Get the atlas canvas for uploading to WebGL
   */
  getAtlasCanvas(): HTMLCanvasElement {
    return this.atlas;
  }

  /**
   * Get atlas dimensions
   */
  getAtlasSize(): number {
    return this.atlasSize;
  }

  private makeKey(
    codepoint: number,
    fontSize: number,
    fontFamily: string,
    bold: boolean,
    italic: boolean
  ): string {
    return `${codepoint}:${fontSize}:${fontFamily}:${bold ? "b" : ""}:${
      italic ? "i" : ""
    }`;
  }

  private renderGlyph(
    codepoint: number,
    fontSize: number,
    fontFamily: string,
    bold: boolean,
    italic: boolean
  ): GlyphInfo {
    // Setup font at physical pixel size
    const physicalFontSize = fontSize * this.pixelRatio;
    const fontStyle = italic ? "italic " : "";
    const fontWeight = bold ? "bold " : "";
    this.atlasCtx.font = `${fontStyle}${fontWeight}${physicalFontSize}px ${fontFamily}`;
    this.atlasCtx.textBaseline = "alphabetic";
    this.atlasCtx.fillStyle = "white";

    // Use fixed allocated dimensions for all glyphs (includes padding)
    const char = String.fromCodePoint(codepoint);
    const allocWidth = this.allocatedCellWidth;
    const allocHeight = this.allocatedCellHeight;

    // Check if we need a new row
    if (this.currentX + allocWidth > this.atlasSize) {
      this.currentX = 0;
      this.currentY += this.currentRowHeight;
      this.currentRowHeight = 0;
    }

    // Check if atlas is full
    if (this.currentY + allocHeight > this.atlasSize) {
      // Atlas is full, clear it and start over
      console.warn("Atlas full, clearing and starting over");
      this.atlasCtx.clearRect(0, 0, this.atlasSize, this.atlasSize);
      this.currentX = 0;
      this.currentY = 0;
      this.currentRowHeight = 0;
      this.allocatedCellWidth = 0; // Reset so dimensions are remeasured
      this.allocatedCellHeight = 0;
      this.renderableCellWidth = 0;
      this.renderableCellHeight = 0;
      this.cellBaseline = 0;
      this.glyphCache.clear();
      this.needsUpload = true; // Force GPU upload of cleared atlas
    }

    // Render glyph to atlas (with padding)
    const allocX = this.currentX;
    const allocY = this.currentY;

    // Clear the entire allocated cell (including padding)
    this.atlasCtx.clearRect(allocX, allocY, allocWidth, allocHeight);

    // Set up clipping region to ensure glyph doesn't exceed bounds
    this.atlasCtx.save();
    this.atlasCtx.beginPath();
    this.atlasCtx.rect(allocX, allocY, allocWidth, allocHeight);
    this.atlasCtx.clip();

    // Draw the glyph at fixed baseline (centered in padding)
    // Use integer coordinates to ensure pixel-aligned rendering
    const glyphX = Math.floor(allocX + this.paddingX / 2);
    const glyphY = Math.floor(allocY + this.cellBaseline);
    this.atlasCtx.fillText(char, glyphX, glyphY);

    this.atlasCtx.restore();

    // Calculate UV coordinates (0-1 range) EXCLUDING padding
    // This ensures the renderer only sees the renderable area, making glyphs fill cells
    const renderableX = allocX + this.paddingX / 2;
    const renderableY = allocY + this.paddingY / 2;

    const info: GlyphInfo = {
      u: renderableX / this.atlasSize,
      v: renderableY / this.atlasSize,
      width: this.renderableCellWidth / this.atlasSize,
      height: this.renderableCellHeight / this.atlasSize,
    };

    // Update packing state (using allocated dimensions)
    this.currentX += allocWidth;
    this.currentRowHeight = Math.max(this.currentRowHeight, allocHeight);

    // Cache and mark for upload
    const key = this.makeKey(codepoint, fontSize, fontFamily, bold, italic);
    this.glyphCache.set(key, info);
    this.needsUpload = true;

    return info;
  }

  /**
   * Clear the entire atlas (useful for font changes)
   */
  clear(): void {
    this.atlasCtx.clearRect(0, 0, this.atlasSize, this.atlasSize);
    this.glyphCache.clear();
    this.currentX = 0;
    this.currentY = 0;
    this.currentRowHeight = 0;
    this.allocatedCellWidth = 0;
    this.allocatedCellHeight = 0;
    this.renderableCellWidth = 0;
    this.renderableCellHeight = 0;
    this.cellBaseline = 0;
    this.needsUpload = true;
  }
}
