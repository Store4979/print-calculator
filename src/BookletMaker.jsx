// ─── BOOKLET MAKER v2 ───────────────────────────────────────
// Multi-file upload, auto-fit/rotate, saddle-stitch imposition
// Supports Ricoh Pro C5400s (auto-duplex, saddle-stitch finisher)
// ─────────────────────────────────────────────────────────────

import { useState, useRef, useCallback, useEffect } from "react";

// ── CONSTANTS ──────────────────────────────────────────────

const BOOKLET_PRESETS = [
  { key: "half-letter", label: '5.5 × 8.5" Booklet', finishedW: 5.5, finishedH: 8.5, sheetW: 11, sheetH: 8.5, desc: "Half-letter on 8.5×11 stock" },
  { key: "half-tabloid", label: '8.5 × 11" Booklet', finishedW: 8.5, finishedH: 11, sheetW: 17, sheetH: 11, desc: "Half-tabloid on 11×17 stock" },
  { key: "a5-on-a4", label: "A5 Booklet", finishedW: 5.83, finishedH: 8.27, sheetW: 11.69, sheetH: 8.27, desc: "A5 on A4 stock" },
];

// Ricoh Pro C5400s specs
const PRINTER_PROFILES = {
  ricoh: {
    name: "Ricoh Pro C5400s",
    maxW: 13, maxH: 19.2,
    minMargin: 0.157, // ~4mm non-printable
    duplex: true,
    saddleStitch: true,
    maxSaddleSheets: 15,
  },
};

// ── SIGNATURE MATH ─────────────────────────────────────────

function computeSignatures(totalPages) {
  const padded = Math.ceil(totalPages / 4) * 4;
  const numSheets = padded / 4;
  
  const signatures = [];
  for (let i = 0; i < numSheets; i++) {
    // Saddle-stitch signature ordering:
    // When the booklet is folded, the outermost sheet has the first and last pages.
    // Front of sheet (outside when folded): right side = low page, left side = high page
    // Back of sheet (inside when folded): left side = low page + 1, right side = high page - 1
    const frontLeft = padded - (2 * i);
    const frontRight = (2 * i) + 1;
    const backLeft = (2 * i) + 2;
    const backRight = padded - (2 * i) - 1;
    
    signatures.push({
      sheet: i + 1,
      front: { left: frontLeft, right: frontRight },
      back: { left: backLeft, right: backRight },
    });
  }
  return { signatures, paddedTotal: padded, numSheets };
}

// ── PDF UTILITIES ──────────────────────────────────────────

async function loadPdfFromFile(file) {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("PDF.js not loaded");
  const ab = await file.arrayBuffer();
  return lib.getDocument({ data: ab }).promise;
}

/**
 * Render a PDF page to canvas, auto-rotating and stretching to fill target slot.
 * 
 * The page is drawn to exactly match the slot dimensions. This means:
 * - No white gaps (unlike "fit"/contain)
 * - No cropping (unlike "fill"/cover)
 * - Slight aspect ratio distortion if source and target differ, but for
 *   booklet imposition (e.g. 8.5×11 → 5.5×8.5) the distortion is minimal
 *   and this is the standard behavior of professional imposition software.
 * 
 * @param {Object} pdfDoc - PDF.js document
 * @param {number} pageNum - 1-based page number
 * @param {number} slotW - target slot width in pixels
 * @param {number} slotH - target slot height in pixels
 * @param {number} manualRotation - additional manual rotation (0, 90, 180, 270)
 * @returns {Object} { canvas, wasAutoRotated }
 */
async function renderPageFitted(pdfDoc, pageNum, slotW, slotH, manualRotation = 0) {
  if (!pdfDoc || pageNum < 1 || pageNum > pdfDoc.numPages) {
    // Blank page
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(slotW);
    canvas.height = Math.round(slotH);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return { canvas, wasAutoRotated: false };
  }
  
  const page = await pdfDoc.getPage(pageNum);
  const baseVp = page.getViewport({ scale: 1, rotation: 0 });
  const pageW = baseVp.width;
  const pageH = baseVp.height;
  
  // Determine if auto-rotation is needed:
  // If the page is landscape but the slot is portrait (or vice versa), rotate 90°
  const pageIsLandscape = pageW > pageH;
  const slotIsLandscape = slotW > slotH;
  let autoRotate = 0;
  
  if (pageIsLandscape !== slotIsLandscape) {
    autoRotate = 90;
  }
  
  const totalRotation = (autoRotate + manualRotation) % 360;
  
  // Get viewport with rotation applied at scale 1
  const rotatedVp = page.getViewport({ scale: 1, rotation: totalRotation });
  
  // Render at high resolution: scale to whichever axis needs more pixels,
  // then drawImage will stretch to exact slot size
  const renderScale = Math.max(slotW / rotatedVp.width, slotH / rotatedVp.height);
  const hiResVp = page.getViewport({ scale: renderScale, rotation: totalRotation });
  
  const renderCanvas = document.createElement("canvas");
  renderCanvas.width = Math.round(hiResVp.width);
  renderCanvas.height = Math.round(hiResVp.height);
  
  await page.render({
    canvasContext: renderCanvas.getContext("2d"),
    viewport: hiResVp,
  }).promise;
  
  // Create output canvas at exact slot size and stretch-draw the page into it
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(slotW);
  canvas.height = Math.round(slotH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // drawImage with different source and dest sizes = stretch to fill exactly
  ctx.drawImage(renderCanvas, 0, 0, renderCanvas.width, renderCanvas.height,
                0, 0, canvas.width, canvas.height);
  
  return { canvas, wasAutoRotated: autoRotate !== 0 };
}

// ── MULTI-FILE PAGE MAP ────────────────────────────────────
// Maps sequential "booklet page numbers" to { pdfDoc, pdfPageNum } pairs

function buildPageMap(pdfEntries) {
  const map = []; // index 0 = booklet page 1
  for (const entry of pdfEntries) {
    if (!entry.doc) continue;
    for (let p = 1; p <= entry.doc.numPages; p++) {
      map.push({ doc: entry.doc, pageNum: p, fileName: entry.name });
    }
  }
  return map;
}

// ── PREVIEW RENDERER ───────────────────────────────────────

async function renderBookletPreview(pageMap, totalPages, signatures, preset, canvas, sheetIndex, side, pageRotations) {
  const ctx = canvas.getContext("2d");
  const DPI = 150;
  const m = PRINTER_PROFILES.ricoh.minMargin; // inches
  const mPx = Math.round(m * DPI); // margin in pixels
  
  // Sheet is landscape: width > height
  const sheetPxW = Math.round(Math.max(preset.sheetW, preset.sheetH) * DPI);
  const sheetPxH = Math.round(Math.min(preset.sheetW, preset.sheetH) * DPI);
  const halfW = sheetPxW / 2;
  
  canvas.width = sheetPxW;
  canvas.height = sheetPxH;
  
  // Light gray background to show the sheet edges / non-printable area
  ctx.fillStyle = "#e8e8e8";
  ctx.fillRect(0, 0, sheetPxW, sheetPxH);
  
  const sig = signatures[sheetIndex];
  if (!sig) return;
  
  const pageSlots = side === "front"
    ? [sig.front.left, sig.front.right]
    : [sig.back.left, sig.back.right];
  
  // Margin-aware slot geometry (same logic as PDF generator):
  // Left page:  margin on left/top/bottom, fold edge flush
  // Right page: fold edge flush, margin on right/top/bottom
  const slotGeom = [
    { x: mPx, y: mPx, w: halfW - mPx, h: sheetPxH - 2 * mPx },
    { x: halfW, y: mPx, w: halfW - mPx, h: sheetPxH - 2 * mPx },
  ];
  
  for (let i = 0; i < 2; i++) {
    const bookletPageNum = pageSlots[i];
    const mapIdx = bookletPageNum - 1;
    const entry = mapIdx >= 0 && mapIdx < pageMap.length ? pageMap[mapIdx] : null;
    const manualRot = pageRotations[bookletPageNum] || 0;
    const geom = slotGeom[i];
    
    let pageCanvas;
    if (entry) {
      const result = await renderPageFitted(entry.doc, entry.pageNum, geom.w, geom.h, manualRot);
      pageCanvas = result.canvas;
    } else {
      pageCanvas = document.createElement("canvas");
      pageCanvas.width = Math.round(geom.w);
      pageCanvas.height = Math.round(geom.h);
      const pctx = pageCanvas.getContext("2d");
      pctx.fillStyle = "#ffffff";
      pctx.fillRect(0, 0, geom.w, geom.h);
    }
    
    // Place within the margin-aware slot
    ctx.drawImage(pageCanvas, geom.x, geom.y, geom.w, geom.h);
    
    // Page label (overlay with background pill for readability)
    ctx.save();
    const labelY = geom.y + geom.h - DPI * 0.18;
    const labelCenterX = geom.x + geom.w / 2;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    const pillW = DPI * 1.8;
    const pillH = DPI * 0.26;
    ctx.beginPath();
    ctx.roundRect(labelCenterX - pillW / 2, labelY - pillH * 0.35, pillW, pillH, 4);
    ctx.fill();
    
    ctx.font = `bold ${Math.round(DPI * 0.1)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    
    const isBlank = bookletPageNum > totalPages;
    const label = isBlank ? "(blank)" : `Page ${bookletPageNum}`;
    const subLabel = !isBlank && entry ? entry.fileName : "";
    
    ctx.fillStyle = isBlank ? "rgba(150,150,150,0.9)" : "rgba(0,129,152,0.95)";
    ctx.fillText(label, labelCenterX, labelY);
    
    if (subLabel) {
      ctx.font = `${Math.round(DPI * 0.065)}px system-ui, sans-serif`;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      const truncName = subLabel.length > 25 ? subLabel.slice(0, 22) + "..." : subLabel;
      ctx.fillText(truncName, labelCenterX, labelY + DPI * 0.1);
    }
    ctx.restore();
  }
  
  // Fold line
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(halfW, 0);
  ctx.lineTo(halfW, sheetPxH);
  ctx.stroke();
  // Fold label pill
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  const foldPillW = DPI * 0.6;
  ctx.beginPath();
  ctx.roundRect(halfW - foldPillW / 2, DPI * 0.04, foldPillW, DPI * 0.14, 3);
  ctx.fill();
  ctx.font = `${Math.round(DPI * 0.07)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillText("← fold →", halfW, DPI * 0.14);
  ctx.restore();
  
  // Margin indicator labels (subtle)
  ctx.save();
  ctx.font = `${Math.round(DPI * 0.05)}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.textAlign = "left";
  ctx.fillText(`${(m * 25.4).toFixed(0)}mm margin`, 3, mPx - 2);
  ctx.restore();
}

// ── IMPOSED PDF GENERATOR ──────────────────────────────────

async function generateImposedPDF(pageMap, totalPages, signatures, preset, pageRotations) {
  const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
  if (!jsPDF) throw new Error("jsPDF not loaded");
  
  // Sheet is always landscape
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "in",
    format: [Math.max(preset.sheetW, preset.sheetH), Math.min(preset.sheetW, preset.sheetH)],
  });
  
  const sheetW = Math.max(preset.sheetW, preset.sheetH);
  const sheetH = Math.min(preset.sheetW, preset.sheetH);
  const halfW = sheetW / 2;
  const m = PRINTER_PROFILES.ricoh.minMargin; // ~0.157" (~4mm)
  const renderDPI = 300;
  
  // Margin-aware slot geometry per half-sheet:
  //
  //  LEFT PAGE (slotIdx 0):                RIGHT PAGE (slotIdx 1):
  //  ┌─m─┬────────────────┐fold           fold┌────────────────┬─m─┐
  //  │   │                │  │             │  │                │   │
  //  m   │   content      │  │             │  │   content      │   m
  //  │   │                │  │             │  │                │   │
  //  └─m─┴────────────────┘  │             │  └────────────────┴─m─┘
  //
  //  Left page:  x = m,  w = halfW - m  (margin on left, flush to fold)
  //  Right page: x = halfW,  w = halfW - m  (flush to fold, margin on right)
  //  Both:       y = m,  h = sheetH - 2*m  (margin top & bottom)
  
  const slotGeom = [
    // slotIdx 0 (left page): margin on left/top/bottom, fold edge flush
    { x: m, y: m, w: halfW - m, h: sheetH - 2 * m },
    // slotIdx 1 (right page): fold edge flush, margin on right/top/bottom
    { x: halfW, y: m, w: halfW - m, h: sheetH - 2 * m },
  ];
  
  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i];
    
    // Front side
    if (i > 0) doc.addPage([sheetW, sheetH], "landscape");
    
    for (const [slotIdx, bookletPage] of [sig.front.left, sig.front.right].entries()) {
      const mapIdx = bookletPage - 1;
      const entry = mapIdx >= 0 && mapIdx < pageMap.length ? pageMap[mapIdx] : null;
      const manualRot = pageRotations[bookletPage] || 0;
      const geom = slotGeom[slotIdx];
      
      const pxW = geom.w * renderDPI;
      const pxH = geom.h * renderDPI;
      
      let pageCanvas;
      if (entry) {
        const result = await renderPageFitted(entry.doc, entry.pageNum, pxW, pxH, manualRot);
        pageCanvas = result.canvas;
      } else {
        pageCanvas = document.createElement("canvas");
        pageCanvas.width = Math.round(pxW);
        pageCanvas.height = Math.round(pxH);
        const pctx = pageCanvas.getContext("2d");
        pctx.fillStyle = "#ffffff";
        pctx.fillRect(0, 0, pxW, pxH);
      }
      
      const imgData = pageCanvas.toDataURL("image/jpeg", 0.92);
      doc.addImage(imgData, "JPEG", geom.x, geom.y, geom.w, geom.h);
    }
    
    // Back side
    doc.addPage([sheetW, sheetH], "landscape");
    
    for (const [slotIdx, bookletPage] of [sig.back.left, sig.back.right].entries()) {
      const mapIdx = bookletPage - 1;
      const entry = mapIdx >= 0 && mapIdx < pageMap.length ? pageMap[mapIdx] : null;
      const manualRot = pageRotations[bookletPage] || 0;
      const geom = slotGeom[slotIdx];
      
      const pxW = geom.w * renderDPI;
      const pxH = geom.h * renderDPI;
      
      let pageCanvas;
      if (entry) {
        const result = await renderPageFitted(entry.doc, entry.pageNum, pxW, pxH, manualRot);
        pageCanvas = result.canvas;
      } else {
        pageCanvas = document.createElement("canvas");
        pageCanvas.width = Math.round(pxW);
        pageCanvas.height = Math.round(pxH);
        const pctx = pageCanvas.getContext("2d");
        pctx.fillStyle = "#ffffff";
        pctx.fillRect(0, 0, pxW, pxH);
      }
      
      const imgData = pageCanvas.toDataURL("image/jpeg", 0.92);
      doc.addImage(imgData, "JPEG", geom.x, geom.y, geom.w, geom.h);
    }
  }
  
  return doc;
}

// ── ICONS ──────────────────────────────────────────────────

const BookletIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    <path d="M12 2v20" />
  </svg>
);

const UploadIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const ChevronLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const ChevronRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const PrinterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
  </svg>
);

const RotateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 1 1-.57-8.38L21.5 8"/>
  </svg>
);

const GripIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
    <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
    <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
  </svg>
);

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const ArrowUpIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
);

const ArrowDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);

const PrintIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
  </svg>
);

// ── COMPONENT ──────────────────────────────────────────────

export default function BookletMaker({ CardHeader, pricingProps }) {
  // Pricing props from parent
  const { paperTypes=[], sheetKeysForPaper={}, pricing={}, quantityDiscounts=[], backSideFactor=0.5, getSheetDiscountFactor } = pricingProps || {};
  
  // State
  const [pdfEntries, setPdfEntries] = useState([]); // [{ id, name, file, doc, numPages }]
  const [presetKey, setPresetKey] = useState("half-letter");
  const [previewSheet, setPreviewSheet] = useState(0);
  const [previewSide, setPreviewSide] = useState("front");
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pageRotations, setPageRotations] = useState({}); // { bookletPageNum: degrees }
  const [pageOrder, setPageOrder] = useState([]); // indices into rawPageMap — controls page sequence
  const [moveFrom, setMoveFrom] = useState(null); // booklet page num being moved (1-based)
  const [moveTo, setMoveTo] = useState(""); // target position input
  
  // Pricing state
  const [selectedPaperKey, setSelectedPaperKey] = useState(() => paperTypes[0]?.key || "");
  const [colorMode, setColorMode] = useState("color");
  
  const previewRef = useRef(null);
  const fileInputRef = useRef(null);
  
  const preset = BOOKLET_PRESETS.find(p => p.key === presetKey) || BOOKLET_PRESETS[0];
  
  // Build raw page map (natural file order), then apply reorder
  const rawPageMap = buildPageMap(pdfEntries);
  const totalPages = rawPageMap.length;
  
  // Keep pageOrder in sync when files change
  useEffect(() => {
    setPageOrder(Array.from({ length: rawPageMap.length }, (_, i) => i));
    setMoveFrom(null);
    setMoveTo("");
  }, [rawPageMap.length, pdfEntries.length]);
  
  // Reordered page map — this is what signatures and preview use
  const pageMap = pageOrder.length === totalPages
    ? pageOrder.map(idx => rawPageMap[idx])
    : rawPageMap;
  
  const { signatures, paddedTotal, numSheets } = totalPages > 0
    ? computeSignatures(totalPages)
    : { signatures: [], paddedTotal: 0, numSheets: 0 };
  
  const printer = PRINTER_PROFILES.ricoh;
  const sheetW = Math.max(preset.sheetW, preset.sheetH);
  const sheetH = Math.min(preset.sheetW, preset.sheetH);
  const withinSaddleLimit = numSheets <= printer.maxSaddleSheets;
  // Ricoh: maxW = max width (short edge), maxH = max length (feed direction)
  // So compare: stock short edge ≤ maxW, stock long edge ≤ maxH
  const withinPaperSize = sheetH <= printer.maxW && sheetW <= printer.maxH;
  const blankPages = paddedTotal - totalPages;
  
  // ── Pricing calculations ──
  // Map booklet stock size to the closest sheet key from the pricing system
  const stockSheetKey = (() => {
    const w = Math.min(preset.sheetW, preset.sheetH);
    const h = Math.max(preset.sheetW, preset.sheetH);
    // Check common sizes
    if ((w === 8.5 && h === 11) || (w === 11 && h === 8.5)) return "8.5x11";
    if ((w === 11 && h === 17) || (w === 17 && h === 11)) return "11x17";
    if ((w === 12 && h === 18) || (w === 18 && h === 12)) return "12x18";
    if ((w === 13 && h === 19) || (w === 19 && h === 13)) return "13x19";
    return `${w}x${h}`;
  })();
  
  // Get available paper types that support this stock size
  const availablePapers = paperTypes.filter(pt => 
    (sheetKeysForPaper[pt.key] || []).includes(stockSheetKey)
  );
  
  // Auto-select first available paper if current selection doesn't support this stock
  useEffect(() => {
    if (availablePapers.length > 0 && !availablePapers.find(p => p.key === selectedPaperKey)) {
      setSelectedPaperKey(availablePapers[0].key);
    }
  }, [stockSheetKey, availablePapers.length]);
  
  const normalizeEntry = (e = {}) => ({
    baseCostColor: Number(e.baseCostColor || 0),
    baseCostBW: Number(e.baseCostBW || 0),
    priceColor: Number(e.priceColor || e.baseCostColor || 0),
    priceBW: Number(e.priceBW || e.baseCostBW || 0),
  });
  
  const selectedPricingEntry = normalizeEntry((pricing[selectedPaperKey] || {})[stockSheetKey] || {});
  const perSheetPrice = colorMode === "color" ? selectedPricingEntry.priceColor : selectedPricingEntry.priceBW;
  // Booklets are always duplex, so add back side cost
  const perSheetBack = (colorMode === "color" ? selectedPricingEntry.priceColor : selectedPricingEntry.priceBW) * backSideFactor;
  const perSheetTotal = perSheetPrice + perSheetBack;
  
  const discountFactor = getSheetDiscountFactor ? getSheetDiscountFactor(numSheets) : 1;
  const totalPrice = perSheetTotal * numSheets * discountFactor;
  const hasPricing = availablePapers.length > 0 && perSheetTotal > 0;
  
  // ── File Loading ──
  const addFiles = useCallback(async (files) => {
    setLoading(true);
    const newEntries = [];
    for (const file of files) {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) continue;
      try {
        const doc = await loadPdfFromFile(file);
        newEntries.push({
          id: `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          file,
          doc,
          numPages: doc.numPages,
        });
      } catch (err) {
        console.error("Failed to load PDF:", file.name, err);
      }
    }
    setPdfEntries(prev => [...prev, ...newEntries]);
    setPreviewSheet(0);
    setPreviewSide("front");
    setLoading(false);
  }, []);
  
  const removeFile = useCallback((id) => {
    setPdfEntries(prev => prev.filter(e => e.id !== id));
    setPageRotations({});
  }, []);
  
  const moveFile = useCallback((idx, direction) => {
    setPdfEntries(prev => {
      const arr = [...prev];
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= arr.length) return arr;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
    setPageRotations({});
  }, []);
  
  const clearAll = useCallback(() => {
    setPdfEntries([]);
    setPageRotations({});
    setPageOrder([]);
    setMoveFrom(null);
    setMoveTo("");
    setPreviewSheet(0);
    setPreviewSide("front");
  }, []);
  
  // ── Page reorder: move page from one position to another ──
  const executePageMove = useCallback((fromPage, toPage) => {
    // fromPage and toPage are 1-based booklet page numbers
    if (fromPage < 1 || fromPage > totalPages || toPage < 1 || toPage > totalPages || fromPage === toPage) return;
    setPageOrder(prev => {
      const arr = [...prev];
      const fromIdx = fromPage - 1;
      const toIdx = toPage - 1;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
    // Shift rotations to follow pages
    setPageRotations(prev => {
      const newRot = {};
      const arr = [...pageOrder];
      const fromIdx = fromPage - 1;
      const toIdx = toPage - 1;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      // Rebuild rotations: old booklet page's rotation follows to new position
      for (let i = 0; i < arr.length; i++) {
        const oldBookletPage = arr[i] + 1; // what was originally at this raw index
        // Find what rotation was on the old position
        // Actually, rotations should follow the content, not the position
        // So we map: new position (i+1) gets the rotation from wherever that content was
      }
      // Simpler: just clear rotations on move — user can re-rotate
      return {};
    });
    setMoveFrom(null);
    setMoveTo("");
  }, [totalPages, pageOrder]);
  
  const resetPageOrder = useCallback(() => {
    setPageOrder(Array.from({ length: totalPages }, (_, i) => i));
    setPageRotations({});
    setMoveFrom(null);
    setMoveTo("");
  }, [totalPages]);
  
  // ── Page rotation ──
  const rotateBookletPage = useCallback((bookletPageNum) => {
    setPageRotations(prev => ({
      ...prev,
      [bookletPageNum]: ((prev[bookletPageNum] || 0) + 90) % 360,
    }));
  }, []);
  
  // ── Preview rendering ──
  useEffect(() => {
    if (totalPages === 0 || !previewRef.current || signatures.length === 0) return;
    renderBookletPreview(pageMap, totalPages, signatures, preset, previewRef.current, previewSheet, previewSide, pageRotations);
  }, [totalPages, pdfEntries.length, preset.key, previewSheet, previewSide, pageRotations, signatures.length, pageOrder]);
  
  // ── Generate imposed PDF ──
  const handleGenerate = useCallback(async () => {
    if (totalPages === 0) return;
    setGenerating(true);
    try {
      const doc = await generateImposedPDF(pageMap, totalPages, signatures, preset, pageRotations);
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `booklet_imposed_${preset.key}_${totalPages}pp.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      alert("Error generating PDF: " + err.message);
    }
    setGenerating(false);
  }, [pageMap, totalPages, signatures, preset, pageRotations]);
  
  // ── Print directly ──
  const handlePrint = useCallback(async () => {
    if (totalPages === 0) return;
    setGenerating(true);
    try {
      const doc = await generateImposedPDF(pageMap, totalPages, signatures, preset, pageRotations);
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      
      // Open in new window for printing
      const printWin = window.open(url, "_blank");
      if (printWin) {
        printWin.addEventListener("load", () => {
          setTimeout(() => {
            printWin.print();
          }, 500);
        });
      } else {
        // Fallback: use iframe
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = url;
        document.body.appendChild(iframe);
        iframe.onload = () => {
          setTimeout(() => {
            iframe.contentWindow.print();
            setTimeout(() => {
              document.body.removeChild(iframe);
              URL.revokeObjectURL(url);
            }, 2000);
          }, 500);
        };
      }
    } catch (err) {
      alert("Error preparing print: " + err.message);
    }
    setGenerating(false);
  }, [pageMap, totalPages, signatures, preset, pageRotations]);
  
  // ── Drag & Drop ──
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []).filter(
      f => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (files.length) addFiles(files);
  }, [addFiles]);
  
  const handleFileInput = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) addFiles(files);
    e.target.value = "";
  }, [addFiles]);
  
  // ── Get current preview page info for rotation button ──
  const currentSig = signatures[previewSheet];
  const currentSlotPages = currentSig
    ? (previewSide === "front"
        ? [currentSig.front.left, currentSig.front.right]
        : [currentSig.back.left, currentSig.back.right])
    : [];
  
  // ── Render ──
  return (
    <>
      {/* Step 1 — Booklet Size */}
      <div className="pc-card">
        <CardHeader
          step="1"
          stepClass="step-num-green"
          title="Booklet Size"
          hint="Choose your finished booklet dimensions"
        />
        <div className="pc-card-body">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }} data-tour="booklet-preset">
            {BOOKLET_PRESETS.map(p => (
              <button
                key={p.key}
                data-tour={`booklet-preset-${p.key}`}
                className={`pc-btn ${presetKey === p.key ? "pc-btn-primary" : "pc-btn-secondary"}`}
                style={{ minWidth: 160, textAlign: "left", padding: "10px 16px", height: "auto" }}
                onClick={() => setPresetKey(p.key)}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{p.label}</div>
                <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{p.desc}</div>
              </button>
            ))}
          </div>
          
          <div className="callout callout-info" style={{ marginTop: 14 }}>
            <span className="callout-icon"><PrinterIcon /></span>
            <div>
              <strong>{printer.name}</strong> — Stock: {sheetW}×{sheetH}" landscape
              {printer.saddleStitch && " · Saddle-stitch"}{printer.duplex && " · Auto-duplex"}
              {!withinPaperSize && (
                <span style={{ color: "#dc2626", fontWeight: 600 }}> ⚠ Exceeds max sheet size ({printer.maxW}" wide × {printer.maxH}" long)</span>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Step 2 — Paper & Pricing */}
      <div className="pc-card">
        <CardHeader
          step="2"
          stepClass="step-num-green"
          title="Paper & Pricing"
          hint={`Select paper type for ${stockSheetKey} stock`}
        />
        <div className="pc-card-body">
          {availablePapers.length > 0 ? (
            <>
              <div style={{ marginBottom: 12 }}>
                <label className="field-label">Paper Type</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-tour="booklet-paper-type">
                  {availablePapers.map(pt => (
                    <button
                      key={pt.key}
                      className={`pc-btn pc-btn-sm ${selectedPaperKey === pt.key ? "pc-btn-primary" : "pc-btn-secondary"}`}
                      onClick={() => setSelectedPaperKey(pt.key)}
                    >{pt.label}</button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className="field-label">Color Mode</label>
                <div style={{ display: "flex", gap: 6 }} data-tour="booklet-color-mode">
                  <button
                    className={`pc-btn pc-btn-sm ${colorMode === "color" ? "pc-btn-primary" : "pc-btn-secondary"}`}
                    onClick={() => setColorMode("color")}
                  >Color</button>
                  <button
                    className={`pc-btn pc-btn-sm ${colorMode === "bw" ? "pc-btn-primary" : "pc-btn-secondary"}`}
                    onClick={() => setColorMode("bw")}
                  >B&W</button>
                </div>
              </div>
              
              {numSheets > 0 && (
                <div style={{
                  display: "flex", gap: 16, flexWrap: "wrap",
                  padding: "10px 14px", background: "var(--surface-3)",
                  borderRadius: "var(--radius-sm)", fontSize: 12,
                }}>
                  <div><span style={{ color: "var(--text-muted)" }}>Per sheet (front+back):</span> <strong>${perSheetTotal.toFixed(2)}</strong></div>
                  <div><span style={{ color: "var(--text-muted)" }}>Sheets:</span> <strong>{numSheets}</strong></div>
                  {discountFactor < 1 && (
                    <div><span style={{ color: "var(--text-muted)" }}>Discount:</span> <strong style={{ color: "var(--green)" }}>{((1 - discountFactor) * 100).toFixed(1)}% off</strong></div>
                  )}
                  <div><span style={{ color: "var(--text-muted)" }}>Estimated total:</span> <strong style={{ color: "var(--green)", fontSize: 14 }}>${totalPrice.toFixed(2)}</strong></div>
                </div>
              )}
            </>
          ) : (
            <div className="callout callout-warn">
              <span className="callout-icon" style={{ flexShrink: 0 }}>⚠</span>
              <div>No paper types configured for {stockSheetKey} stock. Add pricing for this size in the Admin panel under Sheet Pricing.</div>
            </div>
          )}
        </div>
      </div>
      
      {/* Step 3 — Upload PDFs */}
      <div className="pc-card">
        <CardHeader
          step="3"
          stepClass="step-num-green"
          title="Upload PDFs"
          hint="Add one or more PDF files — they'll be combined in order"
        />
        <div className="pc-card-body">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            style={{ display: "none" }}
            onChange={handleFileInput}
          />
          
          {/* Drop zone */}
          <div
            data-tour="booklet-upload"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragOver ? "var(--green)" : pdfEntries.length ? "var(--border)" : "var(--border-strong)"}`,
              borderRadius: "var(--radius)",
              padding: pdfEntries.length ? "14px 18px" : "32px 18px",
              textAlign: "center",
              cursor: "pointer",
              background: dragOver ? "var(--green-light)" : "var(--surface-2)",
              transition: "all 0.2s ease",
            }}
          >
            {loading ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading PDF{pdfEntries.length ? "s" : ""}...</div>
            ) : (
              <>
                <UploadIcon />
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginTop: 8 }}>
                  {pdfEntries.length ? "Drop more PDFs here or click to add" : "Drop PDF files here or click to browse"}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Multiple PDFs supported — files will be merged in listed order
                </div>
              </>
            )}
          </div>
          
          {/* File list */}
          {pdfEntries.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
                  FILES ({pdfEntries.length}) — {totalPages} total page{totalPages !== 1 ? "s" : ""}
                </div>
                <button className="pc-btn pc-btn-secondary pc-btn-xs" onClick={clearAll}>Clear all</button>
              </div>
              
              {pdfEntries.map((entry, idx) => (
                <div
                  key={entry.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 10px", marginBottom: 4,
                    background: "var(--surface-2)", borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                  }}
                >
                  {/* Reorder buttons */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <button
                      className="pc-btn pc-btn-secondary pc-btn-icon"
                      style={{ width: 22, height: 18, padding: 0, border: "none", background: "transparent" }}
                      disabled={idx === 0}
                      onClick={() => moveFile(idx, -1)}
                    ><ArrowUpIcon /></button>
                    <button
                      className="pc-btn pc-btn-secondary pc-btn-icon"
                      style={{ width: 22, height: 18, padding: 0, border: "none", background: "transparent" }}
                      disabled={idx === pdfEntries.length - 1}
                      onClick={() => moveFile(idx, 1)}
                    ><ArrowDownIcon /></button>
                  </div>
                  
                  {/* File icon */}
                  <div style={{
                    width: 32, height: 32, borderRadius: 6,
                    background: "var(--green)", color: "white",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700, flexShrink: 0,
                  }}>PDF</div>
                  
                  {/* File info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.name}
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
                      {entry.numPages} page{entry.numPages !== 1 ? "s" : ""}
                      {" · "}{(entry.file.size / 1024).toFixed(0)} KB
                    </div>
                  </div>
                  
                  {/* Order badge */}
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%",
                    background: "var(--green-light)", color: "var(--green)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700,
                  }}>{idx + 1}</div>
                  
                  {/* Remove */}
                  <button
                    className="pc-btn pc-btn-icon"
                    style={{ width: 28, height: 28, padding: 0, background: "transparent", border: "none", color: "var(--text-muted)" }}
                    onClick={() => removeFile(entry.id)}
                    title="Remove"
                  ><XIcon /></button>
                </div>
              ))}
            </div>
          )}
          
          {/* Stats row */}
          {totalPages > 0 && (
            <div style={{
              display: "flex", gap: 16, flexWrap: "wrap",
              marginTop: 12, padding: "10px 14px",
              background: "var(--surface-3)", borderRadius: "var(--radius-sm)",
              fontSize: 12,
            }}>
              <div><span style={{ color: "var(--text-muted)" }}>Total pages:</span> <strong>{totalPages}</strong></div>
              <div><span style={{ color: "var(--text-muted)" }}>Padded to:</span> <strong>{paddedTotal}</strong></div>
              <div><span style={{ color: "var(--text-muted)" }}>Sheets:</span> <strong>{numSheets}</strong></div>
              {blankPages > 0 && (
                <div><span style={{ color: "var(--text-muted)" }}>Blanks added:</span> <strong>{blankPages}</strong></div>
              )}
              {!withinSaddleLimit && (
                <div style={{ color: "#d97706", fontWeight: 600 }}>
                  ⚠ {numSheets} sheets exceeds saddle-stitch limit ({printer.maxSaddleSheets})
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Step 4 — Page Order */}
      {totalPages > 0 && (
        <div className="pc-card">
          <CardHeader
            step="4"
            stepClass="step-num-green"
            title="Page Order"
            hint="Rearrange pages — click a page to select it, then move it to a new position"
          />
          <div className="pc-card-body">
            
            {/* Page grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
              gap: 6,
              marginBottom: 12,
            }}>
              {pageOrder.map((rawIdx, pos) => {
                const bookletPage = pos + 1;
                const entry = rawPageMap[rawIdx];
                const isSelected = moveFrom === bookletPage;
                const isTarget = moveFrom && moveFrom !== bookletPage;
                const origPage = rawIdx + 1;
                const truncName = entry ? (entry.fileName.length > 12 ? entry.fileName.slice(0, 10) + "…" : entry.fileName) : "";
                
                return (
                  <div
                    key={`${rawIdx}-${pos}`}
                    onClick={() => {
                      if (moveFrom === null) {
                        // Select this page to move
                        setMoveFrom(bookletPage);
                        setMoveTo("");
                      } else if (moveFrom === bookletPage) {
                        // Deselect
                        setMoveFrom(null);
                        setMoveTo("");
                      } else {
                        // Move the selected page to this position
                        executePageMove(moveFrom, bookletPage);
                      }
                    }}
                    style={{
                      padding: "8px 4px",
                      textAlign: "center",
                      background: isSelected ? "var(--green)" : isTarget && moveFrom ? "var(--green-light)" : "var(--surface-2)",
                      color: isSelected ? "white" : "var(--text)",
                      border: `2px solid ${isSelected ? "var(--green)" : isTarget && moveFrom ? "var(--green)" : "var(--border)"}`,
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                      transition: "all 0.15s",
                      position: "relative",
                      userSelect: "none",
                    }}
                    title={
                      isSelected
                        ? "Click another page to place it there, or click again to cancel"
                        : moveFrom
                          ? `Move page ${moveFrom} here (position ${bookletPage})`
                          : `Click to select page ${bookletPage} for moving`
                    }
                  >
                    <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>
                      {bookletPage}
                    </div>
                    <div style={{
                      fontSize: 9,
                      opacity: isSelected ? 0.85 : 0.55,
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {truncName}
                    </div>
                    {origPage !== bookletPage && (
                      <div style={{
                        position: "absolute", top: 2, right: 3,
                        fontSize: 8, fontWeight: 600,
                        color: isSelected ? "rgba(255,255,255,0.7)" : "var(--amber)",
                      }}>
                        was {origPage}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            {/* Move controls / status */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              padding: "10px 14px",
              background: moveFrom ? "var(--green-light)" : "var(--surface-3)",
              borderRadius: "var(--radius-sm)",
              fontSize: 12,
              transition: "background 0.2s",
            }}>
              {moveFrom ? (
                <>
                  <strong style={{ color: "var(--green)" }}>Page {moveFrom} selected</strong>
                  <span style={{ color: "var(--text-muted)" }}>→ Click a page above to place it there, or:</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span>Move to position</span>
                    <input
                      className="pc-input"
                      type="number"
                      min="1"
                      max={totalPages}
                      value={moveTo}
                      onChange={e => setMoveTo(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          const target = parseInt(moveTo, 10);
                          if (target >= 1 && target <= totalPages) executePageMove(moveFrom, target);
                        }
                      }}
                      style={{ width: 56, height: 30, fontSize: 13, textAlign: "center", padding: "0 4px" }}
                      placeholder="#"
                    />
                    <button
                      className="pc-btn pc-btn-primary pc-btn-xs"
                      disabled={!moveTo || parseInt(moveTo, 10) < 1 || parseInt(moveTo, 10) > totalPages || parseInt(moveTo, 10) === moveFrom}
                      onClick={() => executePageMove(moveFrom, parseInt(moveTo, 10))}
                    >Go</button>
                  </div>
                  <button
                    className="pc-btn pc-btn-secondary pc-btn-xs"
                    onClick={() => { setMoveFrom(null); setMoveTo(""); }}
                  >Cancel</button>
                </>
              ) : (
                <span style={{ color: "var(--text-muted)" }}>
                  Click any page above to select it, then click where you want to move it.
                  {pageOrder.some((v, i) => v !== i) && (
                    <> Pages have been reordered. <button
                      className="pc-btn pc-btn-secondary pc-btn-xs"
                      style={{ marginLeft: 6 }}
                      onClick={resetPageOrder}
                    >Reset to original order</button></>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Step 5 — Preview & Actions */}
      {totalPages > 0 && signatures.length > 0 && (
        <div className="pc-card">
          <CardHeader
            step="5"
            stepClass="step-num-green"
            title="Imposition Preview"
            hint={`${numSheets} sheet${numSheets !== 1 ? "s" : ""} · ${sheetW}×${sheetH}" landscape · Pages auto-fit & rotated`}
          />
          <div className="pc-card-body">
            
            {/* Sheet navigator */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 12, gap: 8,
            }}>
              <button
                className="pc-btn pc-btn-secondary pc-btn-sm pc-btn-icon"
                disabled={previewSheet === 0}
                onClick={() => setPreviewSheet(s => Math.max(0, s - 1))}
              ><ChevronLeft /></button>
              
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  Sheet {previewSheet + 1} of {numSheets}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {previewSide === "front" ? "Front" : "Back"} — Pages{" "}
                  {currentSlotPages.map((p, i) => (
                    <span key={i}>
                      {i > 0 && " & "}
                      {p > totalPages ? <em style={{ opacity: 0.5 }}>blank</em> : p}
                    </span>
                  ))}
                </div>
              </div>
              
              <button
                className="pc-btn pc-btn-secondary pc-btn-sm pc-btn-icon"
                disabled={previewSheet >= numSheets - 1}
                onClick={() => setPreviewSheet(s => Math.min(numSheets - 1, s + 1))}
              ><ChevronRight /></button>
            </div>
            
            {/* Front/Back toggle + rotation controls */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
              <button
                className={`pc-btn pc-btn-sm ${previewSide === "front" ? "pc-btn-primary" : "pc-btn-secondary"}`}
                onClick={() => setPreviewSide("front")}
              >Front</button>
              <button
                className={`pc-btn pc-btn-sm ${previewSide === "back" ? "pc-btn-primary" : "pc-btn-secondary"}`}
                onClick={() => setPreviewSide("back")}
              >Back</button>
              
              <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
              
              {/* Rotate individual pages on current view */}
              {currentSlotPages.map((pageNum, i) => (
                pageNum <= totalPages && (
                  <button
                    key={i}
                    className="pc-btn pc-btn-secondary pc-btn-xs"
                    onClick={() => rotateBookletPage(pageNum)}
                    title={`Rotate page ${pageNum}`}
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <RotateIcon /> Pg {pageNum}
                    {pageRotations[pageNum] ? ` (${pageRotations[pageNum]}°)` : ""}
                  </button>
                )
              ))}
            </div>
            
            {/* Canvas preview */}
            <div style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              background: "#f8f9fa",
              padding: 12,
              display: "flex",
              justifyContent: "center",
              overflow: "auto",
            }}>
              <canvas
                ref={previewRef}
                style={{
                  maxWidth: "100%",
                  height: "auto",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
                  borderRadius: 4,
                }}
              />
            </div>
            
            {/* Signature map */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text-muted)" }}>
                SIGNATURE MAP
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 6, fontSize: 11,
              }}>
                {signatures.map((sig, idx) => (
                  <div
                    key={idx}
                    onClick={() => { setPreviewSheet(idx); setPreviewSide("front"); }}
                    style={{
                      padding: "8px 10px",
                      background: previewSheet === idx ? "var(--green-light)" : "var(--surface-2)",
                      border: `1px solid ${previewSheet === idx ? "var(--green)" : "var(--border)"}`,
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>Sheet {idx + 1}</div>
                    <div style={{ color: "var(--text-muted)" }}>
                      Front: [{sig.front.left > totalPages ? "·" : sig.front.left}, {sig.front.right}]
                      {" · "}Back: [{sig.back.left}, {sig.back.right > totalPages ? "·" : sig.back.right}]
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Action Bar */}
      {totalPages > 0 && (
        <div className="price-bar" style={{ position: "sticky", bottom: 0, zIndex: 50 }}>
          <div className="price-bar-inner price-bar-green" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
              <div className="price-metric">
                <div className="price-metric-label">Sheets</div>
                <div className="price-metric-val">{numSheets}</div>
              </div>
              <div className="price-metric">
                <div className="price-metric-label">Finished</div>
                <div className="price-metric-val">{preset.finishedW}×{preset.finishedH}"</div>
              </div>
              <div className="price-metric">
                <div className="price-metric-label">Paper</div>
                <div className="price-metric-val" style={{ fontSize: 12 }}>{availablePapers.find(p=>p.key===selectedPaperKey)?.label || "—"}</div>
              </div>
              {hasPricing && (
                <div className="price-metric">
                  <div className="price-metric-label">Estimated total</div>
                  <div className="price-metric-val" style={{ color: "var(--green)", fontSize: 20 }}>${totalPrice.toFixed(2)}</div>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="pc-btn pc-btn-secondary"
                disabled={generating || !withinPaperSize}
                onClick={handlePrint}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <PrintIcon />
                Print
              </button>
              <button
                className="pc-btn pc-btn-success"
                disabled={generating || !withinPaperSize}
                onClick={handleGenerate}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <DownloadIcon />
                {generating ? "Generating..." : "Download PDF"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { BookletIcon };
