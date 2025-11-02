export const vertexShaderSource = `
precision mediump float;

attribute vec2 a_position; // Vertex position (0-1 for quad)

uniform vec2 u_resolution;  // Canvas size in pixels
uniform vec2 u_gridSize;    // Terminal grid size (cols, rows)
uniform vec2 u_cellSize;    // Cell size in pixels

varying vec2 v_cellCoord;   // Cell coordinates (0-gridSize)
varying vec2 v_pixelCoord;  // Pixel coordinate within cell (0-cellSize)

void main() {
  // Convert from 0-1 to clip space (-1 to 1)
  vec2 clipSpace = a_position * 2.0 - 1.0;
  gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
  
  // Calculate cell coordinates for fragment shader
  vec2 pixelPos = a_position * u_resolution;
  v_cellCoord = pixelPos / u_cellSize;
  v_pixelCoord = mod(pixelPos, u_cellSize);
}
`;

export const fragmentShaderSource = `
precision mediump float;

uniform sampler2D u_glyphAtlas;      // Texture atlas with glyphs
uniform sampler2D u_backgroundTex;   // Background colors (RGB)
uniform sampler2D u_foregroundTex;   // Foreground colors (RGB)
uniform sampler2D u_glyphCoordTex;   // Glyph UV coords (16-bit: R=U_hi, G=U_lo, B=V_hi, A=V_lo)
uniform sampler2D u_glyphSizeTex;    // Glyph size (16-bit: R=W_hi, G=W_lo, B=H_hi, A=H_lo)

uniform vec2 u_gridSize;             // Terminal grid size (cols, rows)
uniform vec2 u_cellSize;             // Cell size in pixels

varying vec2 v_cellCoord;            // Cell coordinates (0-gridSize)
varying vec2 v_pixelCoord;           // Pixel coordinate within cell (0-cellSize)

void main() {
  // Determine which cell we're in
  vec2 cellIndex = floor(v_cellCoord);
  
  // Check bounds
  if (cellIndex.x >= u_gridSize.x || cellIndex.y >= u_gridSize.y) {
    discard;
    return;
  }
  
  // Calculate texture coordinate for cell data (0-1)
  vec2 cellTexCoord = (cellIndex + 0.5) / u_gridSize;
  
  // Sample cell data
  vec3 bgColor = texture2D(u_backgroundTex, cellTexCoord).rgb;
  vec3 fgColor = texture2D(u_foregroundTex, cellTexCoord).rgb;
  vec4 glyphCoordData = texture2D(u_glyphCoordTex, cellTexCoord);
  vec4 glyphSizeData = texture2D(u_glyphSizeTex, cellTexCoord);
  
  // Decode 16-bit values from two 8-bit channels
  const float atlasSize = 2048.0;
  
  // UV: R=U_high, G=U_low, B=V_high, A=V_low
  float pixelU = glyphCoordData.r * 255.0 * 256.0 + glyphCoordData.g * 255.0;
  float pixelV = glyphCoordData.b * 255.0 * 256.0 + glyphCoordData.a * 255.0;
  vec2 glyphUV = vec2(pixelU, pixelV) / atlasSize;
  
  // Size: R=W_high, G=W_low, B=H_high, A=H_low
  float pixelWidth = glyphSizeData.r * 255.0 * 256.0 + glyphSizeData.g * 255.0;
  float pixelHeight = glyphSizeData.b * 255.0 * 256.0 + glyphSizeData.a * 255.0;
  vec2 glyphSize = vec2(pixelWidth, pixelHeight) / atlasSize;
  
  // If no glyph (check if width/height are 0)
  if (pixelWidth == 0.0 || pixelHeight == 0.0) {
    gl_FragColor = vec4(bgColor, 1.0);
    return;
  }
  
  // Calculate position within the cell (0-1)
  // Use fractional part of cell coordinate
  vec2 posInCell = fract(v_cellCoord);
  
  // Map to glyph atlas coordinates
  vec2 atlasCoord = glyphUV + posInCell * glyphSize;
  
  // Sample glyph alpha from atlas
  vec4 atlasSample = texture2D(u_glyphAtlas, atlasCoord);
  float glyphAlpha = atlasSample.a;
  
  // Blend foreground over background using glyph as alpha
  vec3 finalColor = mix(bgColor, fgColor, glyphAlpha);
  
  gl_FragColor = vec4(finalColor, 1.0);
}
`;
