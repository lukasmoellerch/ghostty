interface GlyphKey {
  codepoint: number;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
}

interface GlyphInfo {
  u: number;
  v: number;
  width: number;
  height: number;
}

export class TextureAtlasManager {
  private atlas: HTMLCanvasElement;
  private atlasCtx: CanvasRenderingContext2D;
  private glyphCache = new Map<string, GlyphInfo>();

  private atlasSize = 2048;
  private currentX = 0;
  private currentY = 0;
  private currentRowHeight = 0;

  private readonly paddingX = 4;
  private readonly paddingY = 4;

  private allocatedCellWidth = 0;
  private allocatedCellHeight = 0;
  private renderableCellWidth = 0;
  private renderableCellHeight = 0;
  private cellBaseline = 0;

  private needsUpload = false;
  private pixelRatio: number;

  constructor(
    pixelRatio: number = 1,
    logicalCellWidth?: number,
    logicalCellHeight?: number
  ) {
    this.pixelRatio = pixelRatio;

    if (logicalCellWidth && logicalCellHeight) {
      const physicalWidth = Math.ceil(logicalCellWidth * pixelRatio);
      const physicalHeight = Math.ceil(logicalCellHeight * pixelRatio);

      this.renderableCellWidth = physicalWidth;
      this.renderableCellHeight = physicalHeight;
      this.allocatedCellWidth = physicalWidth + this.paddingX;
      this.allocatedCellHeight = physicalHeight + this.paddingY;
      this.cellBaseline = Math.ceil(physicalHeight * 0.8) + this.paddingY / 2;
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

    this.atlasCtx.imageSmoothingEnabled = true;
    this.atlasCtx.imageSmoothingQuality = "high";
    this.atlasCtx.textRendering = "optimizeLegibility";
    (this.atlasCtx as any).fontSmooth = "always";
    (this.atlasCtx as any).webkitFontSmoothing = "antialiased";

    this.atlasCtx.clearRect(0, 0, this.atlasSize, this.atlasSize);
  }

  getGlyph(
    codepoint: number,
    fontSize: number,
    fontFamily: string,
    bold: boolean = false,
    italic: boolean = false
  ): GlyphInfo {
    const key = this.makeKey(codepoint, fontSize, fontFamily, bold, italic);

    const cached = this.glyphCache.get(key);
    if (cached) {
      return cached;
    }

    if (this.allocatedCellWidth === 0) {
      this.measureCellDimensions(fontSize, fontFamily, bold, italic);
    }

    return this.renderGlyph(codepoint, fontSize, fontFamily, bold, italic);
  }

  private measureCellDimensions(
    fontSize: number,
    fontFamily: string,
    bold: boolean,
    italic: boolean
  ): void {
    const physicalFontSize = fontSize * this.pixelRatio;

    const fontStyle = italic ? "italic " : "";
    const fontWeight = bold ? "bold " : "";
    this.atlasCtx.font = `${fontStyle}${fontWeight}${physicalFontSize}px ${fontFamily}`;
    this.atlasCtx.textBaseline = "alphabetic";

    const metrics = this.atlasCtx.measureText("M");
    const actualAscent = metrics.actualBoundingBoxAscent || physicalFontSize;
    const actualDescent =
      metrics.actualBoundingBoxDescent || physicalFontSize * 0.3;

    this.renderableCellWidth = Math.ceil(metrics.width);
    this.renderableCellHeight = Math.ceil(actualAscent + actualDescent);

    this.allocatedCellWidth = this.renderableCellWidth + this.paddingX;
    this.allocatedCellHeight = this.renderableCellHeight + this.paddingY;

    this.cellBaseline = Math.ceil(actualAscent) + this.paddingY / 2;
  }

  getNeedsUpload(): boolean {
    return this.needsUpload;
  }

  clearNeedsUpload(): void {
    this.needsUpload = false;
  }

  getAtlasCanvas(): HTMLCanvasElement {
    return this.atlas;
  }

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
    const physicalFontSize = fontSize * this.pixelRatio;
    const fontStyle = italic ? "italic " : "";
    const fontWeight = bold ? "bold " : "";
    this.atlasCtx.font = `${fontStyle}${fontWeight}${physicalFontSize}px ${fontFamily}`;
    this.atlasCtx.textBaseline = "alphabetic";
    this.atlasCtx.fillStyle = "white";

    const char = String.fromCodePoint(codepoint);
    const allocWidth = this.allocatedCellWidth;
    const allocHeight = this.allocatedCellHeight;

    if (this.currentX + allocWidth > this.atlasSize) {
      this.currentX = 0;
      this.currentY += this.currentRowHeight;
      this.currentRowHeight = 0;
    }

    if (this.currentY + allocHeight > this.atlasSize) {
      console.warn("Atlas full, clearing and starting over");
      this.atlasCtx.clearRect(0, 0, this.atlasSize, this.atlasSize);
      this.currentX = 0;
      this.currentY = 0;
      this.currentRowHeight = 0;
      this.allocatedCellWidth = 0;
      this.allocatedCellHeight = 0;
      this.renderableCellWidth = 0;
      this.renderableCellHeight = 0;
      this.cellBaseline = 0;
      this.glyphCache.clear();
      this.needsUpload = true;
    }

    const allocX = this.currentX;
    const allocY = this.currentY;

    this.atlasCtx.clearRect(allocX, allocY, allocWidth, allocHeight);

    this.atlasCtx.save();
    this.atlasCtx.beginPath();
    this.atlasCtx.rect(allocX, allocY, allocWidth, allocHeight);
    this.atlasCtx.clip();

    const glyphX = Math.floor(allocX + this.paddingX / 2);
    const glyphY = Math.floor(allocY + this.cellBaseline);
    this.atlasCtx.fillText(char, glyphX, glyphY);

    this.atlasCtx.restore();

    const renderableX = allocX + this.paddingX / 2;
    const renderableY = allocY + this.paddingY / 2;

    const info: GlyphInfo = {
      u: renderableX / this.atlasSize,
      v: renderableY / this.atlasSize,
      width: this.renderableCellWidth / this.atlasSize,
      height: this.renderableCellHeight / this.atlasSize,
    };

    this.currentX += allocWidth;
    this.currentRowHeight = Math.max(this.currentRowHeight, allocHeight);

    const key = this.makeKey(codepoint, fontSize, fontFamily, bold, italic);
    this.glyphCache.set(key, info);
    this.needsUpload = true;

    return info;
  }

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
