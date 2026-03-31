// ─── CODE 128 BARCODE GENERATOR FOR jsPDF ───────────────────
// Generates real scannable Code 128B barcodes directly on PDF pages.
// No external libraries needed — pure bar-width encoding.
// ─────────────────────────────────────────────────────────────

// Code 128B encoding patterns (bar/space widths: 1-4 units each, 6 elements per symbol)
const CODE128B_PATTERNS = [
  [2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],[1,2,1,3,2,2],
  [1,3,1,2,2,2],[1,2,2,2,1,3],[1,2,2,3,1,2],[1,3,2,2,1,2],[2,2,1,2,1,3],
  [2,2,1,3,1,2],[2,3,1,2,1,2],[1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],
  [1,1,3,2,2,2],[1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
  [2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],[3,1,1,2,2,2],
  [3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],[3,2,2,1,1,2],[3,2,2,2,1,1],
  [2,1,2,1,2,3],[2,1,2,3,2,1],[2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],
  [1,3,1,3,2,1],[1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
  [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,2,1,3,3],[1,1,2,3,3,1],[1,3,2,1,3,1],
  [1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],[3,1,3,1,2,1],[2,1,1,3,3,1],
  [2,3,1,1,3,1],[2,1,3,1,1,3],[2,1,3,3,1,1],[2,1,3,1,3,1],[3,1,1,1,2,3],
  [3,1,1,3,2,1],[3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
  [3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],[1,1,1,4,2,2],
  [1,2,1,1,2,4],[1,2,1,4,2,1],[1,4,1,1,2,2],[1,4,1,2,2,1],[1,1,2,2,1,4],
  [1,1,2,4,1,2],[1,2,2,1,1,4],[1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],
  [2,4,1,2,1,1],[2,2,1,1,1,4],[4,1,3,1,1,1],[2,4,1,1,1,2],[1,3,4,1,1,1],
  [1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],[1,2,4,1,1,2],
  [1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],[4,2,1,2,1,1],[2,1,2,1,4,1],
  [2,1,4,1,2,1],[4,1,2,1,2,1],[1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],
  [1,1,4,1,1,3],[1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],
  [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],[2,1,1,4,1,2],[2,1,1,2,1,4],
  [2,1,1,2,3,2],[2,3,3,1,1,1,2],
];

// Start code B = 104, Stop = 106
const START_B = 104;
const STOP = 106;
const STOP_PATTERN = [2,3,3,1,1,1,2]; // 7 elements for stop

/**
 * Encode a string as Code 128B bar widths
 * @param {string} text - ASCII text to encode
 * @returns {number[]} - Array of bar/space widths (alternating bar, space, bar, space...)
 */
function encodeCode128B(text) {
  const codes = [START_B];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) - 32;
    if (code < 0 || code > 95) continue; // Skip non-printable
    codes.push(code);
  }
  
  // Calculate checksum
  let checksum = codes[0]; // Start code value
  for (let i = 1; i < codes.length; i++) {
    checksum += codes[i] * i;
  }
  checksum = checksum % 103;
  codes.push(checksum);
  codes.push(STOP);
  
  // Convert codes to bar widths
  const widths = [];
  for (const code of codes) {
    const pattern = code === STOP ? STOP_PATTERN : CODE128B_PATTERNS[code];
    if (pattern) widths.push(...pattern);
  }
  
  return widths;
}

/**
 * Draw a Code 128 barcode on a jsPDF document
 * @param {Object} doc - jsPDF document instance
 * @param {string} text - Text to encode
 * @param {number} x - X position in document units (inches)
 * @param {number} y - Y position in document units (inches)
 * @param {Object} options - { width, height, showText, fontSize }
 */
export function drawBarcode128(doc, text, x, y, options = {}) {
  const {
    width = 2.5,     // Total barcode width in inches
    height = 0.5,    // Bar height in inches
    showText = true,  // Show text below barcode
    fontSize = 9,     // Font size for text
  } = options;
  
  if (!text || !text.trim()) return;
  
  const widths = encodeCode128B(text);
  const totalUnits = widths.reduce((s, w) => s + w, 0);
  const unitWidth = width / totalUnits;
  
  // Draw bars
  let currentX = x;
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i] * unitWidth;
    if (i % 2 === 0) {
      // Even index = bar (black)
      doc.setFillColor(0, 0, 0);
      doc.rect(currentX, y, w, height, 'F');
    }
    // Odd index = space (white, no drawing needed)
    currentX += w;
  }
  
  // Draw text below
  if (showText) {
    doc.setFontSize(fontSize);
    doc.setFont("Courier", "normal");
    doc.setTextColor(0, 0, 0);
    doc.text(text, x + width / 2, y + height + 0.14, { align: "center" });
  }
}

export default drawBarcode128;
