// ============================================================
//  PRINT CALCULATOR — REDESIGNED UI
//  The UPS Store #4979
//  All calculation, PDF, and email logic preserved intact.
//  Only the presentation layer has been replaced.
// ============================================================

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import BookletMaker, { BookletIcon } from "./BookletMaker.jsx";
import DataMerge, { DataMergeIcon } from "./DataMerge.jsx";
import { drawBarcode128 } from "./barcode128.js";
import JobHistory from "./JobHistory.jsx";
import EmployeeLogin from "./components/EmployeeLogin.jsx";
import CommissionDashboard from "./components/CommissionDashboard.jsx";
import MyNumbersPanel from "./components/MyNumbersPanel.jsx";
import SpecialtyTab from "./components/SpecialtyTab.jsx";
import Signs365PricingEditor from "./components/Signs365PricingEditor.jsx";
import TrainingDrawer from "./TrainingDrawer.jsx";
import {
  ensureDbAuthenticated, savePrintJob, isSupabaseConfigured,
  getStoredEmployee, setStoredEmployee,
  listEmployees, createEmployee, setEmployeeActive,
  fetchCommissionSettings, insertTransaction,
} from "./lib/supabase.js";
import {
  computeCommission, saveTransactionWithFallback, drainPendingTransactions,
  loadPendingTransactions,
} from "./lib/commissions.js";

// ─── CONSTANTS ──────────────────────────────────────────────

const DPI = 96;                 // on-screen preview rasterization
const PRINT_DPI_SHEET   = 300;  // output DPI for sheet / photo PDFs
const PRINT_DPI_LF      = 150;  // output DPI for large-format PDFs (prints viewed at distance)
const PRINT_DPI_BP      = 200;  // output DPI for blueprint PDFs
const MAX_OUTPUT_PX     = 8000; // per-dimension cap to avoid browser OOM on huge canvases
const PDF_JPEG_QUALITY  = 0.95; // high-quality JPEG for embedded rasters
const DEFAULT_MARGIN_IN  = 0.125;
const DEFAULT_SPACING_IN = 0.0625;

const PRESET_SHEETS = {
  "8.5x11": [8.5,11],
  "11x17":  [11, 17],
  "12x18":  [12, 18],
};

const DEFAULT_PAPER_TYPES = [
  { key:"20lb_bond",     label:"20lb Bond",         sheets:["8.5x11","11x17"] },
  { key:"24lb_premium",  label:"24lb Premium Bond",  sheets:["8.5x11","11x17","12x18"] },
  { key:"cardstock_80",  label:"Cardstock 80lb",     sheets:["8.5x11","11x17"] },
  { key:"cardstock_100", label:"Cardstock 100lb",    sheets:["8.5x11"] },
  { key:"photo_glossy",  label:"Photo Glossy",       sheets:["8.5x11"] },
  { key:"photo_matte",   label:"Photo Matte",        sheets:["8.5x11"] },
];

const DEFAULT_LF_PAPER_TYPES = [
  { key:"photo_glossy_lf",  label:"Photo Glossy" },
  { key:"photo_satin_lf",   label:"Photo Satin" },
  { key:"vinyl_banner",     label:"Vinyl Banner" },
  { key:"canvas",           label:"Canvas" },
  { key:"trans_bond",       label:"Translucent Bond" },
];

const BLUEPRINT_SIZES = [
  { key:"11x17",  w:11, h:17,  label:"11×17" },
  { key:"12x18",  w:12, h:18,  label:"12×18" },
  { key:"17x22",  w:17, h:22,  label:"17×22" },
  { key:"18x24",  w:18, h:24,  label:"18×24" },
  { key:"22x34",  w:22, h:34,  label:"22×34" },
  { key:"24x36",  w:24, h:36,  label:"24×36" },
  { key:"30x42",  w:30, h:42,  label:"30×42" },
  { key:"34x44",  w:34, h:44,  label:"34×44" },
  { key:"36x48",  w:36, h:48,  label:"36×48" },
];

const UPS_STORE = {
  name:    "The UPS Store #4979",
  address: "4352 Bay Road, Saginaw MI 48603",
  phone:   "989.790.9701",
  email:   "store4979@theupsstore.com",
};

// localStorage keys
const LS = {
  PRICING:          "printcalc_sheet_pricing_v1",
  LF_PRICING:       "printcalc_lf_pricing_v1",
  QTY_DISCOUNTS:    "printcalc_qty_discounts_v1",
  LF_QTY_DISCOUNTS: "printcalc_lf_qty_discounts_v1",
  BACK_FACTOR:      "printcalc_back_factor_v1",
  LF_ADDONS:        "printcalc_lf_addons_v1",
  MARKUP:           "printcalc_markup_per_paper_v1",
  LF_MARKUP:        "printcalc_lf_markup_per_paper_v1",
  BP_PRICING:       "printcalc_blueprint_pricing_v1",
  PAPER_TYPES:      "printcalc_paper_types_v1",
  SHEET_KEYS:       "printcalc_sheet_keys_for_paper_v1",
  LF_PAPER_TYPES:   "printcalc_lf_paper_types_v1",
  PREVIEW_MARGIN:   "printcalc_preview_margin_v1",
  PREVIEW_SPACING:  "printcalc_preview_spacing_v1",
  UPSELL_FLAGS:     "printcalc_upsell_flags_v1",
  SIGNS365:         "signs365Pricing",
};

let UPS_LOGO_DATA_URL = "/ups-logo.png";
let UPS_LOGO_PDF_DATA_URL = null;

// ─── HELPERS ────────────────────────────────────────────────

const inchesToPx = (i) => Math.round(i * DPI);

const normalizeEntry = (e = {}) => ({
  baseCostColor: Number(e.baseCostColor || 0),
  baseCostBW:    Number(e.baseCostBW    || 0),
  priceColor:    Number(e.priceColor    || e.baseCostColor || 0),
  priceBW:       Number(e.priceBW       || e.baseCostBW    || 0),
});

const loadPaperTypes = () => {
  try {
    const s = localStorage.getItem(LS.PAPER_TYPES);
    if (s) { const p = JSON.parse(s); if (Array.isArray(p) && p.length) return p; }
  } catch {}
  return DEFAULT_PAPER_TYPES;
};

const loadLfPaperTypes = () => {
  try {
    const s = localStorage.getItem(LS.LF_PAPER_TYPES);
    if (s) { const p = JSON.parse(s); if (Array.isArray(p) && p.length) return p; }
  } catch {}
  return DEFAULT_LF_PAPER_TYPES;
};

const loadSheetKeysForPaper = (pts) => {
  try {
    const s = localStorage.getItem(LS.SHEET_KEYS);
    if (s) { const m = JSON.parse(s); if (m && typeof m === "object") return m; }
  } catch {}
  const m = {};
  pts.forEach((pt) => { m[pt.key] = pt.sheets || Object.keys(PRESET_SHEETS); });
  return m;
};

const buildInitialPricingFrom = (pts, skfp) => {
  const base = {};
  pts.forEach((pt) => {
    base[pt.key] = {};
    const keys = skfp[pt.key] || [];
    keys.forEach((sk) => {
      base[pt.key][sk] = { baseCostColor:0.08, baseCostBW:0.05, priceColor:0.12, priceBW:0.07 };
    });
  });
  try {
    const s = localStorage.getItem(LS.PRICING);
    if (s) { const p = JSON.parse(s); if (p && typeof p === "object") return p; }
  } catch {}
  return base;
};

const buildInitialLfPricingFrom = (pts) => {
  const base = {};
  pts.forEach((pt) => { base[pt.key] = { baseCostColor:0.04, baseCostBW:0.02, priceColor:0.06, priceBW:0.03 }; });
  try {
    const s = localStorage.getItem(LS.LF_PRICING);
    if (s) { const p = JSON.parse(s); if (p && typeof p === "object") return p; }
  } catch {}
  return base;
};

const buildInitialBlueprintPricing = () => {
  const psfDefaults = [1.13, 0.56, 0.48, 0.41];
  const sizeTierMax = {
    "11x17":[50,150,400,null],"12x18":[50,150,400,null],"17x22":[33,100,266,null],
    "18x24":[33,100,266,null],"22x34":[16,50,133,null],"24x36":[16,50,133,null],
    "30x42":[11,33,88,null],"34x44":[9,27,72,null],"36x48":[8,25,66,null],
  };
  const bp = {};
  BLUEPRINT_SIZES.forEach((s) => {
    const maxes = sizeTierMax[s.key] || [50,150,400,null];
    bp[s.key] = { tiers: psfDefaults.map((psf,i) => ({ maxQty: maxes[i], psf })) };
  });
  try {
    const saved = localStorage.getItem(LS.BP_PRICING);
    if (saved) { const p = JSON.parse(saved); if (p && typeof p === "object") return p; }
  } catch {}
  return bp;
};

const isPdfFile = (f) => f?.type === "application/pdf" || (f?.name||"").toLowerCase().endsWith(".pdf");

// Compute a PDF.js viewport scale that targets a given DPI while capping
// the resulting pixel dimensions to avoid browser OOM on huge source PDFs.
const pdfRasterScale = (page, targetDpi, maxPx) => {
  const base = page.getViewport({ scale: 1 }); // 1 unit = 1 PDF point (72 DPI)
  let scale = targetDpi / 72;
  const biggest = Math.max(base.width, base.height) * scale;
  if (biggest > maxPx) scale = maxPx / Math.max(base.width, base.height);
  return scale;
};

const pdfFileToPngFile = async (file, pageNum=1, { targetDpi=PRINT_DPI_SHEET, maxPx=MAX_OUTPUT_PX }={}) => {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("pdf.js not loaded");
  const ab = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: ab }).promise;
  const safePage = Math.min(Math.max(1, pageNum), pdf.numPages || 1);
  const page = await pdf.getPage(safePage);
  const scale = pdfRasterScale(page, targetDpi, maxPx);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png", 1));
  return new File([blob], file.name.replace(/\.pdf$/i,"")+"-p1.png", { type:"image/png" });
};

const pdfFileToAllPages = async (file, { targetDpi=PRINT_DPI_SHEET, maxPx=MAX_OUTPUT_PX }={}) => {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("pdf.js not loaded");
  const ab = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: ab }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const scale = pdfRasterScale(page, targetDpi, maxPx);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png", 1));
    const baseName = file.name.replace(/\.pdf$/i, "");
    pages.push(new File([blob], `${baseName}-p${p}.png`, { type: "image/png" }));
  }
  return pages;
};

const normalizeUpload = async (file, opts={}) => isPdfFile(file) ? await pdfFileToPngFile(file, 1, opts) : file;

const getJsPDF = () => {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  if (window.jsPDF) return window.jsPDF;
  throw new Error("jsPDF not loaded");
};

// Load a File/Blob as an Image element.
const fileToImage = (fileOrBlob) => new Promise((resolve, reject) => {
  if (!fileOrBlob) return reject(new Error("no file"));
  const url = URL.createObjectURL(fileOrBlob);
  const img = new Image();
  img.onload = () => { setTimeout(() => URL.revokeObjectURL(url), 0); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
  img.src = url;
});

// Rasterize a single image to a canvas sized to `widthIn × heightIn` at the
// requested DPI (capped at MAX_OUTPUT_PX per side). Fill modes:
//   "stretch" → image stretched to EXACTLY fill the box (default for sheets
//               and large format — the user has explicitly specified the
//               target print size, so their image is sized to match it
//               regardless of aspect ratio)
//   "fit"     → aspect preserved, letterboxed, and auto-rotated 90° if the
//               image's natural orientation doesn't match the target (used
//               for blueprints so scale drawings stay to scale)
const renderSingleImageCanvas = (img, widthIn, heightIn, { dpi=PRINT_DPI_SHEET, fill="stretch", background="#ffffff", userRotDeg=0 } = {}) => {
  const baseW = widthIn * dpi;
  const baseH = heightIn * dpi;
  let effDpi = dpi;
  const biggest = Math.max(baseW, baseH);
  if (biggest > MAX_OUTPUT_PX) effDpi = dpi * (MAX_OUTPUT_PX / biggest);
  const wPx = Math.max(1, Math.round(widthIn * effDpi));
  const hPx = Math.max(1, Math.round(heightIn * effDpi));
  const canvas = document.createElement("canvas");
  canvas.width = wPx; canvas.height = hPx;
  const ctx = canvas.getContext("2d");
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, wPx, hPx); }
  if (!img || !img.naturalWidth) return canvas;

  if (fill === "stretch") {
    drawImageFill(ctx, img, wPx/2, hPx/2, wPx, hPx, userRotDeg);
    return canvas;
  }

  // "fit" — aspect preserved, auto-orient 90° if orientations differ.
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const imgLandscape = iw >= ih;
  const boxLandscape = wPx >= hPx;
  const autoRot = imgLandscape === boxLandscape ? 0 : 90;
  const totalRot = (((Number(userRotDeg)||0) + autoRot) % 360 + 360) % 360;
  const swapped = totalRot === 90 || totalRot === 270;
  const effW = swapped ? ih : iw;
  const effH = swapped ? iw : ih;
  const scale = Math.min(wPx / effW, hPx / effH);
  const drawW = iw * scale;
  const drawH = ih * scale;

  ctx.save();
  ctx.translate(wPx/2, hPx/2);
  ctx.rotate((totalRot * Math.PI) / 180);
  ctx.drawImage(img, -drawW/2, -drawH/2, drawW, drawH);
  ctx.restore();
  return canvas;
};

// Serialize a canvas to a JPEG data URL ready to embed in a PDF.
const canvasToPrintJpeg = (canvas, quality=PDF_JPEG_QUALITY) => canvas.toDataURL("image/jpeg", quality);

const getFileExt = (name="") => (name.split(".").pop()||"").toUpperCase().slice(0,4) || "IMG";

// Fit calculator. Honors the supplied sheetW/sheetH orientation (caller picks
// portrait vs landscape). Only the print-rotation is swept to maximize count.
const computeBestFit = (printW, printH, sheetW, sheetH, marginIn, spacingIn) => {
  const pw = (printW||0);
  const ph = (printH||0);
  const sheetOrientation = sheetW >= sheetH ? "landscape" : "portrait";
  if (!pw || !ph) return { cols:1, rows:1, count:1, printRotated:false, sheetOrientation };
  let best = null;
  [false, true].forEach((printRotated) => {
    const aw = printRotated ? ph : pw;
    const ah = printRotated ? pw : ph;
    const m = marginIn;
    const sp = spacingIn;
    const usableW = sheetW - 2*m + sp;
    const usableH = sheetH - 2*m + sp;
    const cols = Math.max(1, Math.floor(usableW / (aw+sp)));
    const rows = Math.max(1, Math.floor(usableH / (ah+sp)));
    const count = cols * rows;
    const candidate = { cols, rows, count, printRotated, sheetOrientation };
    if (!best || count > best.count) best = candidate;
    else if (count === best.count && best.printRotated && !candidate.printRotated) best = candidate;
  });
  return best || { cols:1, rows:1, count:1, printRotated:false, sheetOrientation };
};

// Draw an image centered at (cx, cy) and stretched to EXACTLY fill boxW ×
// boxH. Aspect ratio is NOT preserved — the image ends up at the user's
// requested print size regardless of its natural proportions. `userRotDeg`
// applies an explicit rotation (0/90/180/270). When rotated by 90°/270° the
// draw dimensions are swapped so the image still precisely fills the box
// after rotation, which prevents the old "image disappears after rotate" bug.
const drawImageFill = (ctx, img, cx, cy, boxW, boxH, userRotDeg=0) => {
  if (!img || !img.naturalWidth || !img.naturalHeight) return;
  const rotNorm = (((Number(userRotDeg)||0) % 360) + 360) % 360;
  const swapped = rotNorm === 90 || rotNorm === 270;
  const drawW = swapped ? boxH : boxW;
  const drawH = swapped ? boxW : boxH;
  const rad = (rotNorm * Math.PI) / 180;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);
  ctx.drawImage(img, -drawW/2, -drawH/2, drawW, drawH);
  ctx.restore();
};

// ─── PDF ORDER SHEET ────────────────────────────────────────

const ensureLogoPdfDataUrl = async () => {
  if (UPS_LOGO_PDF_DATA_URL) return;
  try {
    const res = await fetch(UPS_LOGO_DATA_URL, { cache:"no-store" });
    const blob = await res.blob();
    await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => { if (typeof r.result === "string" && r.result.startsWith("data:image")) UPS_LOGO_PDF_DATA_URL = r.result; resolve(); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {}
};

const addOrderSheetPage = (doc, { jobType, details, totals, files=[] }) => {
  const ml=0.5, mt=0.5, cw=7.5;
  let y = mt;
  const line = (extra=0) => { y += 0.02; doc.setDrawColor(220,220,220); doc.line(ml, y, ml+cw, y); y += 0.02+extra; };
if (UPS_LOGO_PDF_DATA_URL) {
    try {
      // Maintain aspect ratio: fit within 1.2" wide × 0.5" tall box
      const logoMaxW = 0.8, logoMaxH = 0.5;
      const img = new Image();
      img.src = UPS_LOGO_PDF_DATA_URL;
      const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1.6;
      let logoW = logoMaxW, logoH = logoW / ratio;
      if (logoH > logoMaxH) { logoH = logoMaxH; logoW = logoH * ratio; }
      doc.addImage(UPS_LOGO_PDF_DATA_URL, "PNG", ml, y, logoW, logoH);
    } catch {}
  }
  doc.setFontSize(9); doc.setTextColor(80,80,80);
  doc.text(UPS_STORE.name, ml+1.4, y+0.15);
  doc.text(UPS_STORE.address, ml+1.4, y+0.28);
  doc.text(`Ph: ${UPS_STORE.phone}  ·  ${UPS_STORE.email}`, ml+1.4, y+0.41);
  y += 0.65;
  line(0.08);
  doc.setFontSize(13); doc.setTextColor(0,0,0);
  doc.setFont(undefined,"bold");
  doc.text(`Print Order — ${jobType}`, ml, y); y += 0.22;
  doc.setFont(undefined,"normal");
  doc.setFontSize(8); doc.setTextColor(100,100,100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, ml, y); y += 0.18;
  line(0.1);
  doc.setFontSize(9.5); doc.setTextColor(0,0,0);
  details.forEach(({ label, value }) => {
    doc.setFont(undefined,"bold"); doc.text(label, ml, y);
    doc.setFont(undefined,"normal"); doc.text(String(value ?? ""), ml+2.2, y);
    y += 0.18;
  });
  y += 0.05; line(0.1);
  totals.forEach(({ label, value }) => {
    const isTotal = label.toLowerCase().includes("total");
    doc.setFontSize(isTotal ? 11 : 9.5);
    doc.setFont(undefined, isTotal ? "bold" : "normal");
    doc.setTextColor(isTotal ? 0 : 60, 60, 60);
    doc.text(label, ml, y); doc.text(value, ml+cw, y, { align:"right" });
    y += isTotal ? 0.22 : 0.18;
  });
if (files.length) {
    y += 0.06; line(0.1);
    doc.setFontSize(9); doc.setFont(undefined,"bold"); doc.text("Files attached:", ml, y); y += 0.18;
    doc.setFont(undefined,"normal"); doc.setTextColor(60,60,60);
    files.forEach((f) => { doc.text(`• ${f}`, ml+0.1, y); y += 0.16; });
  }

// SKU barcode (scannable Code 128)
  const skuVal = details.find(d => d.label === "SKU:")?.value || "";
  if (skuVal) {
    y += 0.25;
    drawBarcode128(doc, skuVal, ml, y, {
      width: 2.2,
      height: 0.45,
      showText: true,
      fontSize: 9,
    });
  }
};

// Multi-job order sheet. Each `jobs` entry carries the per-job display
// strings; `summary` is the ticket-wide totals/discount block. Renders the
// store header, then per-job sections, then the summary, then a barcode
// for the ticket key (or the first job's SKU).
const addTicketOrderSheetPage = (doc, { jobs, summary, barcodeValue }) => {
  const ml = 0.5, mt = 0.5, cw = 7.5;
  let y = mt;
  const hr = (extra = 0) => { y += 0.02; doc.setDrawColor(220,220,220); doc.line(ml, y, ml+cw, y); y += 0.02 + extra; };

  if (UPS_LOGO_PDF_DATA_URL) {
    try {
      const logoMaxW = 0.8, logoMaxH = 0.5;
      const img = new Image(); img.src = UPS_LOGO_PDF_DATA_URL;
      const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth/img.naturalHeight : 1.6;
      let logoW = logoMaxW, logoH = logoW/ratio;
      if (logoH > logoMaxH) { logoH = logoMaxH; logoW = logoH*ratio; }
      doc.addImage(UPS_LOGO_PDF_DATA_URL, "PNG", ml, y, logoW, logoH);
    } catch {}
  }
  doc.setFontSize(9); doc.setTextColor(80,80,80);
  doc.text(UPS_STORE.name, ml+1.4, y+0.15);
  doc.text(UPS_STORE.address, ml+1.4, y+0.28);
  doc.text(`Ph: ${UPS_STORE.phone}  ·  ${UPS_STORE.email}`, ml+1.4, y+0.41);
  y += 0.65;
  hr(0.08);

  doc.setFontSize(13); doc.setTextColor(0,0,0); doc.setFont(undefined, "bold");
  doc.text(`Print Order — Paper Printing (${jobs.length} ${jobs.length===1?"Job":"Jobs"})`, ml, y); y += 0.22;
  doc.setFont(undefined, "normal");
  doc.setFontSize(8); doc.setTextColor(100,100,100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, ml, y); y += 0.18;
  hr(0.1);

  // Per-job sections
  jobs.forEach((job, idx) => {
    if (y > 9.0) { doc.addPage(); y = mt; }
    doc.setFontSize(10.5); doc.setTextColor(0,0,0); doc.setFont(undefined, "bold");
    doc.text(`Job ${idx + 1}`, ml, y);
    doc.setFont(undefined, "normal"); doc.setFontSize(9); doc.setTextColor(120,120,120);
    if (job.subtitle) doc.text(job.subtitle, ml+1.0, y);
    y += 0.16;
    doc.setDrawColor(230,230,230); doc.line(ml, y, ml+cw, y); y += 0.06;

    doc.setFontSize(9.5); doc.setTextColor(0,0,0);
    (job.details || []).forEach(({ label, value }) => {
      doc.setFont(undefined, "bold"); doc.text(label, ml, y);
      doc.setFont(undefined, "normal"); doc.text(String(value ?? ""), ml+2.2, y);
      y += 0.16;
    });
    if (job.files && job.files.length) {
      doc.setFont(undefined, "bold"); doc.text("Files:", ml, y);
      doc.setFont(undefined, "normal");
      const filesText = job.files.join("  ·  ");
      const wrapped = doc.splitTextToSize(filesText, cw - 1.0);
      wrapped.forEach((ln, li) => { doc.text(ln, ml+1.0, y + li*0.14); });
      y += Math.max(0.16, wrapped.length * 0.14);
    }
    if (job.subtotalLabel) {
      doc.setTextColor(60,60,60);
      doc.setFont(undefined, "normal");
      doc.text(job.subtotalLabel, ml, y);
      doc.text(job.subtotalValue, ml+cw, y, { align:"right" });
      y += 0.16;
    }
    y += 0.08;
  });

  // Ticket summary
  if (y > 9.4) { doc.addPage(); y = mt; }
  hr(0.1);
  doc.setFontSize(11); doc.setTextColor(0,0,0); doc.setFont(undefined, "bold");
  doc.text("Ticket Summary", ml, y); y += 0.18;
  doc.setFont(undefined, "normal");
  (summary || []).forEach(({ label, value }) => {
    const isTotal = String(label).toLowerCase().includes("total");
    doc.setFontSize(isTotal ? 11 : 9.5);
    doc.setFont(undefined, isTotal ? "bold" : "normal");
    doc.setTextColor(isTotal ? 0 : 60, 60, 60);
    doc.text(label, ml, y); doc.text(value, ml+cw, y, { align: "right" });
    y += isTotal ? 0.22 : 0.18;
  });

  // Barcode
  if (barcodeValue) {
    y += 0.25;
    drawBarcode128(doc, barcodeValue, ml, y, { width: 2.2, height: 0.45, showText: true, fontSize: 9 });
  }
};

const savePdf = (doc, filename) => {
  try {
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch { try { doc.save(filename); } catch {} }
};

// ─── SVG ICONS ──────────────────────────────────────────────

const Icon = {
  Printer:  () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>,
  Ruler:    () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.3 8.7 8.7 21.3c-1 1-2.5 1-3.4 0l-2.6-2.6c-1-1-1-2.5 0-3.4L15.3 2.7c1-1 2.5-1 3.4 0l2.6 2.6c1 1 1 2.5 0 3.4Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/></svg>,
  Blueprint:() => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>,
  Upload:   () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  Download: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Send:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><polyline points="22 7 12 2 2 7"/><line x1="12" y1="22" x2="12" y2="2"/></svg>,
  X:        () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Rotate:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 1 1-.57-8.38"/></svg>,
  Check:    () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Info:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>,
  Warn:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Admin:    () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>,
  Quote:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  ChevLeft: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
  ChevRight:() => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
};

// ─── SUB-COMPONENTS ─────────────────────────────────────────

function Toggle({ checked, onChange }) {
  return (
    <label className="pc-toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="pc-toggle-track" />
      <span className="pc-toggle-thumb" />
    </label>
  );
}

function Chip({ label, selected, onClick, color="" }) {
  return (
    <button
      type="button"
      className={`pc-chip ${color ? `pc-chip-${color}` : ""} ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function AddonCard({ emoji, name, price, selected, onToggle }) {
  return (
    <div className={`addon-card ${selected ? "selected" : ""}`} onClick={onToggle}>
      <div className="addon-check">{selected && <Icon.Check />}</div>
      <div className="addon-emoji">{emoji}</div>
      <div className="addon-name">{name}</div>
      <div className="addon-price">{price}</div>
    </div>
  );
}

// Small inline pill toggle the employee taps to claim an upsell on a
// flagged item. Tooltip explains the rule. Defaults to off; the
// employee opts in only if they actively suggested the upsell.
function UpsellToggle({ checked, onChange, label = "Upsell", tooltip = "Mark this if you suggested this add-on to the customer." }) {
  return (
    <button
      type="button"
      className={`upsell-toggle ${checked ? "is-on" : ""}`}
      onClick={(e) => { e.stopPropagation?.(); onChange(!checked); }}
      title={tooltip}
      aria-pressed={checked}
    >
      <span className="upsell-toggle-icon" aria-hidden="true">⬆</span>
      <span className="upsell-toggle-label">{label}</span>
    </button>
  );
}

function UploadZone({ hasFile, label, subLabel, types, onFiles, inputRef }) {
  return (
    <div
      className={`upload-zone ${hasFile ? "has-file" : ""}`}
      onClick={() => inputRef?.current?.click()}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); onFiles && onFiles(Array.from(e.dataTransfer.files)); }}
    >
      <div className="upload-icon-wrap">
        <Icon.Upload />
      </div>
      <div className="upload-title" style={hasFile ? { color:"var(--teal)" } : {}}>
        {hasFile ? label : "Drop files here"}
      </div>
      <div className="upload-sub">{subLabel || "or click to browse"}</div>
      <div className="upload-types">
        {(types||["PNG","JPG","PDF"]).map(t => <span key={t} className="upload-type-tag">{t}</span>)}
      </div>
    </div>
  );
}

function PriceBar({ metrics, onDownload, onOrder, onCompleteSale, completeSaleEnabled = false, completeSaleHint = "", accentClass="price-bar-teal", totalClass="is-total" }) {
  return (
    <div className={`price-bar ${accentClass}`}>
      <div className="price-metrics">
        {metrics.map(({ label, value, big }) => (
          <div key={label} className="price-metric">
            <div className="price-metric-label">{label}</div>
            <div className={`price-metric-val ${big ? totalClass : ""}`}>{value}</div>
          </div>
        ))}
      </div>
      <div className="price-bar-actions">
        <button className="pc-btn pc-btn-secondary" onClick={onDownload}>
          <Icon.Download /> Generate Quote
        </button>
        <button className="pc-btn pc-btn-secondary" onClick={onOrder}>
          <Icon.Send /> Email
        </button>
        {onCompleteSale && (
          <button
            type="button"
            className="pc-btn pc-btn-complete-sale"
            onClick={onCompleteSale}
            disabled={!completeSaleEnabled}
            title={completeSaleHint || "Log this as a completed sale"}
          >
            ✓ Complete Sale
          </button>
        )}
      </div>
    </div>
  );
}

function CardHeader({ step, stepClass="", title, hint, right }) {
  return (
    <div className="pc-card-header">
      <div className="pc-card-header-left">
        <div className={`step-num ${stepClass}`}>{step}</div>
        <div>
          <div className="pc-card-title">{title}</div>
          {hint && <div className="pc-card-hint">{hint}</div>}
        </div>
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

function MobileNumberBar({ open, onDone, onClear, onNudge }) {
  if (!open) return null;
  return (
    <div className="mobile-num-bar">
      <div style={{ display:"flex", gap:"8px" }}>
        <button className="mobile-num-btn" type="button" onClick={() => onNudge(-1)}>−</button>
        <button className="mobile-num-btn" type="button" onClick={() => onNudge(+1)}>+</button>
        <button className="mobile-num-btn" type="button" onClick={onClear}>Clear</button>
      </div>
      <button className="mobile-num-btn done" type="button" onClick={onDone}>Done</button>
    </div>
  );
}

// Pure draw routine for a single sheet. All inputs are passed explicitly so
// it can be reused outside the React closure (e.g. when generating a PDF
// that needs to render preview pages for several saved ticket items).
const drawSheetTo = (canvas, {
  imageInput,
  rotDeg = 0,
  pageIndex = 0,
  placementsRef = null,
  orientedWIn,
  orientedHIn,
  prints,
  frontSlotInfo,
  previewMargin,
  previewSpacing,
  showGuides = false,
  showCutLines = false,
  dpi = DPI,
}) => new Promise((resolve) => {
  if (!canvas) return resolve();
  // Generation token so a later call supersedes an in-flight one on the
  // same canvas — prevents stale async draws overwriting fresh content.
  const myGen = (canvas.__drawSheetGen || 0) + 1;
  canvas.__drawSheetGen = myGen;

  const safeDpi = Math.max(1, Number(dpi) || DPI);
  const inchesToPxAt = (i) => Math.round(i * safeDpi);

  const ctx = canvas.getContext("2d");
  const wPx = inchesToPxAt(orientedWIn);
  const hPx = inchesToPxAt(orientedHIn);
  canvas.width = wPx; canvas.height = hPx;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, wPx, hPx);

  let items = [];
  if (Array.isArray(imageInput)) {
    items = imageInput.filter(Boolean).map((it, idx) => it?.file
      ? { id: String(it.id ?? `f_${idx}`), file: it.file, name: it.name ?? it.file?.name ?? `File ${idx+1}`, rotation: Number(it.rotation)||0, qty: Math.max(0, Number(it.qty)||0) }
      : { id: `legacy_${idx}`, file: it, name: it?.name ?? `File ${idx+1}`, rotation: 0, qty: 0 }
    );
  } else if (imageInput) {
    items = [{ id: "single", file: imageInput, name: imageInput?.name ?? "Image", rotation: 0, qty: Math.max(0, Number(prints?.quantity)||0) }];
  }

  if (!items.length) { if (placementsRef) placementsRef.current = []; return resolve(); }

  const marginPx  = inchesToPxAt(previewMargin);
  const spacingPx = inchesToPxAt(previewSpacing);
  const { cols, rows, printRotated } = frontSlotInfo || { cols: 1, rows: 1, printRotated: false };

  const printWPx = printRotated ? inchesToPxAt(prints.height) : inchesToPxAt(prints.width);
  const printHPx = printRotated ? inchesToPxAt(prints.width)  : inchesToPxAt(prints.height);

  const gridW = cols*(printWPx+spacingPx) - spacingPx;
  const gridH = rows*(printHPx+spacingPx) - spacingPx;
  const startX = Math.round((wPx - gridW)/2);
  const startY = Math.round((hPx - gridH)/2);

  const cap = cols * rows;
  const workList = [];
  items.forEach(it => { const q = it.qty || 0; if (q > 0) for (let i = 0; i < q; i++) workList.push(it); else workList.push(it); });
  const startIdx = pageIndex * cap;
  const pageItems = workList.slice(startIdx, startIdx + cap);
  if (!pageItems.length) pageItems.push(...items.slice(0, 1));

  const pagePlacements = [];
  const loadedMap = new Map();
  const toLoad = [...new Set(pageItems.map(it => it.file).filter(Boolean))];

  Promise.all(toLoad.map(f => new Promise(res => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload  = () => { loadedMap.set(f, { img, url, width: img.naturalWidth, height: img.naturalHeight }); res(); };
    img.onerror = () => { URL.revokeObjectURL(url); res(); };
    img.src = url;
  }))).then(() => {
    if (canvas.__drawSheetGen !== myGen) {
      for (const v of loadedMap.values()) { try { URL.revokeObjectURL(v.url); } catch {} }
      return resolve();
    }
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const slotIdx = row * cols + col;
        const it = pageItems[slotIdx % pageItems.length];
        if (!it) continue;
        const x = startX + col*(printWPx+spacingPx);
        const y = startY + row*(printHPx+spacingPx);
        const chosen = it.file ? loadedMap.get(it.file) : null;
        pagePlacements.push({ col, row, x, y, w: printWPx, h: printHPx, itemId: it.id, itemName: it.name, slotIndex: slotIdx });

        ctx.save();
        if (chosen?.img) {
          const userRot = (Number(rotDeg)||0) + (Number(it.rotation)||0) + (printRotated ? 90 : 0);
          drawImageFill(ctx, chosen.img, x+printWPx/2, y+printHPx/2, printWPx, printHPx, userRot);
        } else {
          ctx.fillStyle = "#e5e7eb"; ctx.fillRect(x, y, printWPx, printHPx);
          ctx.fillStyle = "#9ca3af"; ctx.font = `${Math.min(printWPx*0.12, 14)}px sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(it.name||"Image", x+printWPx/2, y+printHPx/2);
        }
        if (showCutLines) {
          ctx.strokeStyle = "rgba(100,100,100,0.35)"; ctx.lineWidth = Math.max(0.5, safeDpi/192); ctx.setLineDash([3,3]);
          ctx.strokeRect(x, y, printWPx, printHPx); ctx.setLineDash([]);
        }
        ctx.restore();
      }
    }
    if (showGuides && marginPx > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(0,129,152,0.2)"; ctx.lineWidth = Math.max(0.5, safeDpi/192); ctx.setLineDash([2,4]);
      ctx.strokeRect(marginPx, marginPx, wPx-marginPx*2, hPx-marginPx*2);
      ctx.setLineDash([]);
      ctx.restore();
    }
    if (placementsRef) placementsRef.current = pagePlacements;
    for (const v of loadedMap.values()) { try { URL.revokeObjectURL(v.url); } catch {} }
    resolve({ placements: pagePlacements });
  });
});

// Default shape of one ticket line item. Same fields the editor mutates,
// plus a stable id and the most recent computed snapshot used by the
// pricing summary while debounced auto-save catches up.
const createEmptyJob = (overrides = {}) => ({
  id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  paperKey: overrides.paperKey ?? "20lb_bond",
  sheetKey: overrides.sheetKey ?? "8.5x11",
  orientation: "portrait",
  frontColorMode: "color",
  backColorMode: "bw",
  showBack: false,
  printWidth: 3.5,
  printHeight: 2,
  printQuantity: 100,
  frontFiles: [],
  backImage: null,
  backRotation: 0,
  frontRotation: 0,
  showCutLines: true,
  showGuides: true,
  // upsell claim (employee sets this if they suggested the paper)
  upsellPaper: false,
  // computed snapshot (kept in sync by auto-save)
  printsPerSheet: 1,
  totalPrintQty: 0,
  sheetsNeeded: 0,
  perSheetTotal: 0,
  ...overrides,
});


// reduced motion. Pieces auto-clean after the animation finishes.
const fireConfetti = () => {
  if (typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const host = document.createElement("div");
  host.className = "pc-confetti-host";
  document.body.appendChild(host);
  const colors = ["#008198", "#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#a855f7"];
  for (let i = 0; i < 36; i++) {
    const piece = document.createElement("div");
    piece.className = "pc-confetti-piece";
    piece.style.left = (Math.random() * 100) + "vw";
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty("--pcx", ((Math.random() - 0.5) * 220) + "px");
    piece.style.animationDelay    = (Math.random() * 0.15) + "s";
    piece.style.animationDuration = (0.85 + Math.random() * 0.4) + "s";
    host.appendChild(piece);
  }
  setTimeout(() => host.remove(), 1500);
};

// ─── MAIN APP ───────────────────────────────────────────────

function PriceCalculatorApp() {
  // ── Tab / view state ──
  const [activeTab, setActiveTab]   = useState(() => { try { return localStorage.getItem("activeTab") || "paper"; } catch { return "paper"; }});
  const [viewMode, setViewMode]     = useState("tool"); // "tool" | "quote"
  const [showAdmin, setShowAdmin]   = useState(false);
  const [adminView, setAdminView]   = useState("pricing"); // "pricing" | "commissions"
  const [showJobHistory, setShowJobHistory] = useState(false);

  // ── Logged-in employee (commission tracking) ──
  // Restored from localStorage so a brief tab refresh doesn't kick the
  // user back to the keypad. Cleared via the badge's "Switch User" link.
  const [currentEmployee, setCurrentEmployee] = useState(() => getStoredEmployee());
  const [showEmployeeLogin, setShowEmployeeLogin] = useState(false);
  const handleEmployeeLogin = (emp) => {
    setCurrentEmployee(emp);
    setShowEmployeeLogin(false);
  };
  const switchEmployee = () => {
    setStoredEmployee(null);
    setCurrentEmployee(null);
    setShowEmployeeLogin(true);
  };
  const [showMyNumbers, setShowMyNumbers] = useState(false);

  // Manual retry of the offline transactions queue. Surfaced via the
  // pending-sync badge in the header. Silent if there's nothing pending.
  const retryPendingTransactions = async () => {
    if (!isSupabaseConfigured) return;
    try {
      const result = await drainPendingTransactions(insertTransaction);
      const remaining = loadPendingTransactions().length;
      setPendingSalesCount(remaining);
      if (result.flushed > 0) {
        setSavedJobToast(`Synced ${result.flushed} pending sale${result.flushed === 1 ? "" : "s"}.`);
        setTimeout(() => setSavedJobToast(""), 3500);
      } else if (remaining > 0) {
        alert("Still can't reach the database — check connection and try again.");
      }
    } catch (e) {
      alert("Retry failed: " + (e?.message || String(e)));
    }
  };
  // pendingSaveJob: { row, jobType, label } — if non-null, the save-to-db
  // confirmation dialog is open. The PDF has already been downloaded.
  const [pendingSaveJob, setPendingSaveJob] = useState(null);
  const [savingJob, setSavingJob] = useState(false);
  const [savedJobToast, setSavedJobToast] = useState("");
  const [isAdmin, setIsAdmin]       = useState(false);

  useEffect(() => { try { localStorage.setItem("activeTab", activeTab); } catch {} }, [activeTab]);

  // ── Job ticket (Sheets & Photos only) ──
  // The editor state below represents the CURRENTLY ACTIVE line item.
  // `ticket` is the array of saved line items. `activeTicketIdx` selects
  // which one the editor is bound to. An auto-save effect copies editor
  // state back into ticket[activeTicketIdx]; while loading a different
  // job into the editor we set isLoadingFromTicketRef so the auto-save
  // skips the redundant write.
  const [ticket, setTicket] = useState(() => [createEmptyJob({
    paperKey: (loadPaperTypes()[0]?.key) || "20lb_bond",
    sheetKey: "8.5x11",
  })]);
  const [activeTicketIdx, setActiveTicketIdx] = useState(0);
  const isLoadingFromTicketRef = useRef(false);

  // ── Paper/Sheet state ──
  const [paperTypes, setPaperTypes] = useState(loadPaperTypes);
  const [sheetKeysForPaper, setSheetKeysForPaper] = useState(() => loadSheetKeysForPaper(loadPaperTypes()));
  const [paperKey, setPaperKey]     = useState(() => { const pts = loadPaperTypes(); return pts[0]?.key || DEFAULT_PAPER_TYPES[0].key; });
  const [sheetKey, setSheetKey]     = useState("8.5x11");
  const [orientation, setOrientation] = useState("portrait");
  const [frontColorMode, setFrontColorMode] = useState("color");
  const [backColorMode, setBackColorMode]   = useState("bw");
  const [showBack, setShowBack]     = useState(false);
  const [showCutLines, setShowCutLines]   = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [prints, setPrints]         = useState({ width:3.5, height:2, quantity:100 });
  const [previewSide, setPreviewSide] = useState("front");
  const [frontPreviewPage, setFrontPreviewPage] = useState(0);
  const [frontRotation, setFrontRotation] = useState(0);
  const [backRotation, setBackRotation]   = useState(0);
  const [frontZoom, setFrontZoom]   = useState(1);
  const ZOOM_MIN=0.5, ZOOM_MAX=2.5;
  const clampZoom = v => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(v)||1));

  // ── Paper files ──
  const [frontImage, setFrontImage] = useState(null);
  const [frontFiles, setFrontFiles] = useState([]);
  const [backImage, setBackImage]   = useState(null);
  const [copiesPerFile, setCopiesPerFile] = useState(1);
  const [autoQtyFromFiles, setAutoQtyFromFiles] = useState(true);
  const [selectedFrontId, setSelectedFrontId] = useState(null);

  const frontInputRef  = useRef(null);
  const backInputRef   = useRef(null);
  const frontRef       = useRef(null);
  const backRef        = useRef(null);
  const frontPlacementsRef = useRef([]);

  // ── Preview layout ──
  const [previewMargin, setPreviewMargin]   = useState(() => { try { const s=localStorage.getItem(LS.PREVIEW_MARGIN); return s ? parseFloat(s) : DEFAULT_MARGIN_IN; } catch { return DEFAULT_MARGIN_IN; }});
  const [previewSpacing, setPreviewSpacing] = useState(() => { try { const s=localStorage.getItem(LS.PREVIEW_SPACING); return s ? parseFloat(s) : DEFAULT_SPACING_IN; } catch { return DEFAULT_SPACING_IN; }});

  useEffect(() => { try { localStorage.setItem(LS.PREVIEW_MARGIN, String(previewMargin)); } catch {} }, [previewMargin]);
  useEffect(() => { try { localStorage.setItem(LS.PREVIEW_SPACING, String(previewSpacing)); } catch {} }, [previewSpacing]);

  // ── Pricing ──
  const [pricing, setPricing]         = useState(() => buildInitialPricingFrom(loadPaperTypes(), loadSheetKeysForPaper(loadPaperTypes())));
  const [lfPricing, setLfPricing]     = useState(() => buildInitialLfPricingFrom(loadLfPaperTypes()));
  const [markupPerPaper, setMarkupPerPaper]   = useState(() => { const i={}; loadPaperTypes().forEach(p => i[p.key]=0); return i; });
  const [lfMarkupPerPaper, setLfMarkupPerPaper] = useState(() => { const i={}; loadLfPaperTypes().forEach(p => i[p.key]=0); return i; });
  const [skuMap, setSkuMap] = useState(() => {
    try { const s = localStorage.getItem("printcalc_sku_map_v1"); if (s) { const m = JSON.parse(s); if (m && typeof m === "object") return m; } } catch {}
    return {};
  });
  const [quantityDiscounts, setQuantityDiscounts]   = useState([{ minSheets:0, discountPercent:0 }]);
  const [lfQuantityDiscounts, setLfQuantityDiscounts] = useState([{ minSqFt:0, discountPercent:0 }]);
  const [backSideFactor, setBackSideFactor] = useState(0.5);
  const [lfAddonPricing, setLfAddonPricing] = useState({ grommetEach:1.50, foamCore:12 });
  const [bpPricing, setBpPricing]     = useState(buildInitialBlueprintPricing);

  useEffect(() => { try { localStorage.setItem(LS.PRICING, JSON.stringify(pricing)); } catch {} }, [pricing]);
  useEffect(() => { try { localStorage.setItem(LS.LF_PRICING, JSON.stringify(lfPricing)); } catch {} }, [lfPricing]);
  useEffect(() => { try { localStorage.setItem(LS.QTY_DISCOUNTS, JSON.stringify(quantityDiscounts)); } catch {} }, [quantityDiscounts]);
  useEffect(() => { try { localStorage.setItem(LS.BP_PRICING, JSON.stringify(bpPricing)); } catch {} }, [bpPricing]);
  useEffect(() => { try { localStorage.setItem("printcalc_sku_map_v1", JSON.stringify(skuMap)); } catch {} }, [skuMap]);

  // ── Large Format state ──
  const [lfPaperTypes, setLfPaperTypes] = useState(loadLfPaperTypes);
  const [lfPaperKey, setLfPaperKey]   = useState(() => { const pts = loadLfPaperTypes(); return pts[0]?.key || "photo_glossy_lf"; });
  const [lfWidth, setLfWidth]   = useState(24);
  const [lfHeight, setLfHeight] = useState(36);
  const [lfColorMode, setLfColorMode] = useState("color");
  const [lfGrommets, setLfGrommets]       = useState(false);
  const [lfGrommetCount, setLfGrommetCount] = useState(4);
  const [lfFoamCore, setLfFoamCore]       = useState(false);
  const [lfImage, setLfImage]   = useState(null);
  const lfRef      = useRef(null);
  const lfInputRef = useRef(null);

  // ── Blueprint state ──
  const [bpSizeKey, setBpSizeKey] = useState("24x36");
  const [bpQty, setBpQty]         = useState(25);
  const bpRef      = useRef(null);
  const bpInputRef = useRef(null);
  const [bpFile, setBpFile]       = useState(null);

  // ── Commission tracking — upsell flags + per-order claims ──
  // upsellFlags drives which items get an "Upsell" toggle in the UI.
  // The toggle itself defaults OFF and the employee opts in if they
  // actually suggested the upsell to the customer.
  const [upsellFlags, setUpsellFlags] = useState(() => {
    try {
      const s = localStorage.getItem(LS.UPSELL_FLAGS);
      if (s) return JSON.parse(s);
    } catch {}
    return { paperTypes: {}, lfPaperTypes: {}, lfAddons: { grommets: false, foamCore: false } };
  });
  useEffect(() => {
    try { localStorage.setItem(LS.UPSELL_FLAGS, JSON.stringify(upsellFlags)); } catch {}
  }, [upsellFlags]);
  // Per-order upsell claims for the LF tab. The Sheets tab's claim
  // lives on each ticket item (item.upsellPaper). Blueprints have no
  // upsell-eligible items today.
  const [lfUpsellPaper, setLfUpsellPaper]       = useState(false);
  const [lfUpsellGrommets, setLfUpsellGrommets] = useState(false);
  const [lfUpsellFoamCore, setLfUpsellFoamCore] = useState(false);
  // Reset LF upsell claims when the underlying choice changes — a new
  // paper / re-toggled add-on shouldn't carry an old "I upsold this".
  useEffect(() => { setLfUpsellPaper(false); }, [lfPaperKey]);
  useEffect(() => { if (!lfGrommets) setLfUpsellGrommets(false); }, [lfGrommets]);
  useEffect(() => { if (!lfFoamCore) setLfUpsellFoamCore(false); }, [lfFoamCore]);
  // Same idea for the Sheets ticket: if a line item's paper isn't
  // upsell-eligible (anymore), drop its upsell claim so the totals
  // stay honest even if the toggle UI isn't visible.
  useEffect(() => {
    setTicket(prev => prev.map(it => (
      it.upsellPaper && !upsellFlags.paperTypes?.[it.paperKey]
        ? { ...it, upsellPaper: false } : it
    )));
  }, [upsellFlags]);

  // Signs365 pricing overrides — partial tree on top of
  // src/data/signs365Pricing.json. Stored under LS.SIGNS365 (which
  // is the "signs365Pricing" key SpecialtyTab also reads). The
  // effect below pushes changes back to localStorage and fires a
  // "signs365PricingUpdated" event so the open SpecialtyTab refreshes.
  const [signs365Overrides, setSigns365Overrides] = useState(() => {
    try {
      const raw = localStorage.getItem(LS.SIGNS365);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  useEffect(() => {
    try {
      const hasAny = signs365Overrides && Object.keys(signs365Overrides).length > 0;
      if (hasAny) localStorage.setItem(LS.SIGNS365, JSON.stringify(signs365Overrides));
      else        localStorage.removeItem(LS.SIGNS365);
      window.dispatchEvent(new Event("signs365PricingUpdated"));
    } catch {}
  }, [signs365Overrides]);

  // Commission settings (rates + monthly bonus thresholds). Lazy-loaded
  // from Supabase on mount so the Complete Sale dialog has live numbers.
  const [commissionSettings, setCommissionSettings] = useState({
    base_rate: 0.02, upsell_rate: 0.08,
    monthly_bonus_threshold: 5000, monthly_bonus_amount: 50,
  });
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    fetchCommissionSettings()
      .then((s) => { if (!cancelled && s) setCommissionSettings(s); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Drain any sales that were queued offline. Tries on mount and again
  // whenever the browser regains network connectivity.
  const [pendingSalesCount, setPendingSalesCount] = useState(() => loadPendingTransactions().length);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const drain = () => {
      drainPendingTransactions(insertTransaction)
        .then(() => setPendingSalesCount(loadPendingTransactions().length))
        .catch(() => {});
    };
    drain();
    window.addEventListener("online", drain);
    return () => window.removeEventListener("online", drain);
  }, []);

  // Complete-sale flow state.
  const [pendingSale, setPendingSale] = useState(null);    // { snapshot, base, upsell, settings }
  const [completingSale, setCompletingSale] = useState(false);

  // ── Quick Quote ──
  const [quoteQty, setQuoteQty]             = useState(100);
  const [quotePrintW, setQuotePrintW]       = useState(3.5);
  const [quotePrintH, setQuotePrintH]       = useState(2);
  const [quotePaperKey, setQuotePaperKey]   = useState(() => loadPaperTypes()[0]?.key || "");
  const [quoteShowAllPapers, setQuoteShowAllPapers] = useState(true);
  const [quoteBackEnabled, setQuoteBackEnabled] = useState(false);
  const [quoteFrontColorMode, setQuoteFrontColorMode] = useState("color");
  const [quoteBackColorMode, setQuoteBackColorMode]   = useState("bw");

  // ── Admin extra ──
  const [newPaperLabel, setNewPaperLabel] = useState("");
  const [newPaperKey, setNewPaperKey]     = useState("");
  const [newPaperSheets, setNewPaperSheets] = useState({});
  const [newLfPaperLabel, setNewLfPaperLabel] = useState("");
  const [newLfPaperKey, setNewLfPaperKey]     = useState("");

  // ── Mobile number bar ──
  const [numBarOpen, setNumBarOpen] = useState(false);
  const lastNumericRef = useRef(null);

  useEffect(() => {
    const isMobile = () => window.matchMedia?.("(max-width:640px)").matches;
    const onFocusIn = (ev) => {
      const el = ev.target;
      if (!(el instanceof HTMLElement)) return;
      const isNum = el.matches?.('input[type="number"]') || (el.matches?.('input') && (el.getAttribute("inputmode")==="decimal" || el.getAttribute("inputmode")==="numeric"));
      if (!isNum || !isMobile()) return;
      el.setAttribute("inputmode","decimal"); el.setAttribute("enterkeyhint","done");
      requestAnimationFrame(() => { try { el.select?.(); } catch {} });
      lastNumericRef.current = el;
      setNumBarOpen(true);
    };
    const onFocusOut = () => { if (isMobile()) setTimeout(() => { if (!document.activeElement?.matches?.('input[type="number"]')) setNumBarOpen(false); }, 150); };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => { document.removeEventListener("focusin", onFocusIn); document.removeEventListener("focusout", onFocusOut); };
  }, []);

  // Wheel-to-increment for focused number inputs. Wheel up = increase by step,
  // wheel down = decrease. Only intercepts when a number input is focused so
  // page scrolling is preserved everywhere else.
  useEffect(() => {
    const onWheel = (e) => {
      const el = document.activeElement;
      if (!el || el.tagName !== "INPUT" || el.type !== "number") return;
      e.preventDefault();
      const step = parseFloat(el.getAttribute("step") || "1") || 1;
      const dir = e.deltaY > 0 ? -1 : 1;
      const min = el.getAttribute("min");
      const max = el.getAttribute("max");
      const curr = parseFloat(el.value) || 0;
      let next = curr + dir * step;
      if (min !== null && next < parseFloat(min)) next = parseFloat(min);
      if (max !== null && next > parseFloat(max)) next = parseFloat(max);
      const dec = (String(step).split(".")[1] || "").length;
      el.value = dec ? next.toFixed(Math.min(4, dec)) : String(Math.round(next));
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  const blurActive  = () => { lastNumericRef.current?.blur?.(); setNumBarOpen(false); };
  const clearActive = () => { if (!lastNumericRef.current) return; lastNumericRef.current.value=""; lastNumericRef.current.dispatchEvent(new Event("input",{bubbles:true})); lastNumericRef.current.dispatchEvent(new Event("change",{bubbles:true})); };
  const nudgeActive = (dir) => {
    const el = lastNumericRef.current; if (!el) return;
    const step = parseFloat(el.getAttribute("step")||"1") || 1;
    const curr = parseFloat(el.value)||0;
    const next = curr + dir*step;
    const dec = (String(step).split(".")[1]||"").length;
    el.value = dec ? next.toFixed(Math.min(4,dec)) : String(Math.round(next));
    el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true}));
  };

// ── Load pricing.json ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/pricing.json", { cache:"no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (json.paperTypes)       { setPaperTypes(json.paperTypes);       localStorage.setItem(LS.PAPER_TYPES, JSON.stringify(json.paperTypes)); }
        if (json.sheetKeysForPaper){ setSheetKeysForPaper(json.sheetKeysForPaper); localStorage.setItem(LS.SHEET_KEYS, JSON.stringify(json.sheetKeysForPaper)); }
        if (json.lfPaperTypes)     { setLfPaperTypes(json.lfPaperTypes);   localStorage.setItem(LS.LF_PAPER_TYPES, JSON.stringify(json.lfPaperTypes)); }
        if (json.sheetPricing)     { setPricing(json.sheetPricing);        localStorage.setItem(LS.PRICING, JSON.stringify(json.sheetPricing)); }
        if (json.lfPricing)        { setLfPricing(json.lfPricing);         localStorage.setItem(LS.LF_PRICING, JSON.stringify(json.lfPricing)); }
        // Support both old and new field names for quantity discounts
        const sheetDisc = json.sheetQtyDiscounts || json.quantityDiscounts;
        if (sheetDisc) setQuantityDiscounts(sheetDisc);
        const lfDisc = json.lfQtyDiscounts || json.lfQuantityDiscounts;
        if (lfDisc) setLfQuantityDiscounts(lfDisc);
        // Load markups (values may be strings in JSON, coerce to numbers)
        if (json.sheetMarkupPerPaper) {
          const m = {};
          Object.entries(json.sheetMarkupPerPaper).forEach(([k,v]) => { m[k] = Number(v) || 0; });
          setMarkupPerPaper(m);
        }
        if (json.lfMarkupPerPaper) {
          const m = {};
          Object.entries(json.lfMarkupPerPaper).forEach(([k,v]) => { m[k] = Number(v) || 0; });
          setLfMarkupPerPaper(m);
        }
        if (typeof json.backSideFactor==="number") setBackSideFactor(json.backSideFactor);
        if (json.lfAddonPricing)   setLfAddonPricing(json.lfAddonPricing);
        if (json.blueprintPricing) { setBpPricing(json.blueprintPricing); localStorage.setItem(LS.BP_PRICING, JSON.stringify(json.blueprintPricing)); }
        if (typeof json.previewMargin==="number")  setPreviewMargin(json.previewMargin);
        if (typeof json.previewSpacing==="number") setPreviewSpacing(json.previewSpacing);
        if (json.upsellFlags && typeof json.upsellFlags === "object") setUpsellFlags(json.upsellFlags);
        if (json.signs365Pricing && typeof json.signs365Pricing === "object") setSigns365Overrides(json.signs365Pricing);
      } catch {}
    })();
  }, []);

  // ── Derived: sheet dimensions ──
  const getPresetSheetKeys = () => Object.keys(PRESET_SHEETS);
  const sheetDims = PRESET_SHEETS[sheetKey] || [8.5,11];
  const orientedWIn = orientation==="landscape" ? Math.max(...sheetDims) : Math.min(...sheetDims);
  const orientedHIn = orientation==="landscape" ? Math.min(...sheetDims) : Math.max(...sheetDims);

  // ── Best fit calculation ──
  const frontSlotInfo = computeBestFit(prints.width, prints.height, orientedWIn, orientedHIn, previewMargin, previewSpacing, false);
  const printsPerSheet = frontSlotInfo?.count || 1;

  const totalPrintQty = frontFiles.length
    ? frontFiles.reduce((s,f) => s + (Number(f.qty)||0), 0)
    : (Number(prints.quantity)||0);

  const sheetsNeeded = Math.ceil(totalPrintQty / Math.max(1, printsPerSheet));

  // ── Pricing calculations: Sheets ──
  const selectedPricing = normalizeEntry((pricing[paperKey]||{})[sheetKey]||{});
  const effectiveFrontPerSheet = frontColorMode==="color" ? selectedPricing.priceColor : selectedPricing.priceBW;
  const effectiveBackPerSheet  = showBack && backSideFactor>0
    ? (backColorMode==="color" ? selectedPricing.priceColor : selectedPricing.priceBW) * backSideFactor
    : 0;
  const perSheetTotal = effectiveFrontPerSheet + effectiveBackPerSheet;

  const getSheetDiscountFactor = (sheets) => {
    let best = 0;
    quantityDiscounts.forEach(t => { if (sheets >= (t.minSheets||0)) best = Math.max(best, Number(t.discountPercent)||0); });
    return 1 - best/100;
  };
  const discountFactor = getSheetDiscountFactor(sheetsNeeded);
  const totalPrice = perSheetTotal * sheetsNeeded * discountFactor;

  // ── Pricing calculations: Large Format ──
  const lfAreaSqFt = (lfWidth * lfHeight) / 144;
  const lfSelectedPricing = normalizeEntry(lfPricing[lfPaperKey]||{});
  const lfBase = lfColorMode==="color" ? lfSelectedPricing.priceColor*lfAreaSqFt : lfSelectedPricing.priceBW*lfAreaSqFt;
  const lfAddonsTotal = (lfGrommets ? (lfAddonPricing.grommetEach||0) * (lfGrommetCount||0) : 0) + (lfFoamCore ? (lfAddonPricing.foamCore||0) : 0);
  const getLfDiscountFactor = (sqft) => { let b=0; lfQuantityDiscounts.forEach(t => { if (sqft>=(t.minSqFt||0)) b=Math.max(b,Number(t.discountPercent)||0); }); return 1-b/100; };
  const lfDiscountFactor = getLfDiscountFactor(lfAreaSqFt);
  const lfTotalWithDiscount = (lfBase + lfAddonsTotal) * lfDiscountFactor;

  // ── Pricing calculations: Blueprints ──
  const bpSizeObj = BLUEPRINT_SIZES.find(s => s.key===bpSizeKey) || BLUEPRINT_SIZES[5];
  const bpWidth   = bpSizeObj.w;
  const bpHeight  = bpSizeObj.h;
  const bpAreaPerSheetSqFt = (bpWidth * bpHeight) / 144;
  const bpTiers = (bpPricing[bpSizeKey]?.tiers) || [];
  const getBpPsf = (qty) => {
    let psf = bpTiers[bpTiers.length-1]?.psf || 0;
    for (const t of bpTiers) { if (t.maxQty===null || qty <= t.maxQty) { psf = t.psf; break; } }
    return psf;
  };
  const bpPsf       = getBpPsf(bpQty);
  const bpPerSheet  = bpPsf * bpAreaPerSheetSqFt;
  const bpTotal     = bpPerSheet * bpQty;
  const bpTotalSqFt = bpAreaPerSheetSqFt * bpQty;

  // ── Quick Quote rows ──
  const quoteRows = (() => {
    const rows = [];
    const pts = quoteShowAllPapers ? paperTypes : paperTypes.filter(p => p.key===quotePaperKey);
    pts.forEach(pt => {
      (sheetKeysForPaper[pt.key]||[]).forEach(sk => {
        const entry = normalizeEntry((pricing[pt.key]||{})[sk]||{});
        if (!entry.priceColor && !entry.priceBW) return;
        const [sw,sh] = PRESET_SHEETS[sk]||[8.5,11];
        const fit = computeBestFit(quotePrintW, quotePrintH, sw, sh, previewMargin, previewSpacing, false);
        const perFront = quoteFrontColorMode==="color" ? entry.priceColor : entry.priceBW;
        const perBack  = quoteBackEnabled ? (quoteBackColorMode==="color" ? entry.priceColor : entry.priceBW) * backSideFactor : 0;
        const sheetsQ  = Math.ceil((quoteQty||0) / Math.max(1, fit?.count||1));
        const dFactor  = getSheetDiscountFactor(sheetsQ);
        const total    = (perFront+perBack) * sheetsQ * dFactor;
        rows.push({ paperLabel:pt.label, paperKey:pt.key, sheetKey:sk, perFront, perBack, printsPer:fit?.count||1, sheets:sheetsQ, total, fit });
      });
    });
    return rows.sort((a,b) => a.total - b.total);
  })();
  const bestQuote = quoteRows[0];

  // ─── DRAW SHEET CANVAS ──────────────────────────────────
  // When `opts.dpi` is set, the canvas is rendered at that DPI (used for
  // high-quality PDF export). Otherwise it uses the on-screen preview DPI.
  // `opts.showGuides` / `opts.showCutLines` can override the UI toggles so
  // PDF output stays free of preview-only guides.
  // Thin wrapper around the pure drawSheetTo, plumbed with the editor's
  // current orientation / slot / margins. PDF generators that need to
  // render non-active jobs call drawSheetTo directly with that job's params.
  const drawSheet = useCallback((canvas, imageInput, rotDeg, pageIndex=0, placementsRef=null, opts={}) => {
    return drawSheetTo(canvas, {
      imageInput,
      rotDeg,
      pageIndex,
      placementsRef,
      orientedWIn,
      orientedHIn,
      prints,
      frontSlotInfo,
      previewMargin,
      previewSpacing,
      showGuides:   opts.showGuides   ?? showGuides,
      showCutLines: opts.showCutLines ?? showCutLines,
      dpi:          opts.dpi || DPI,
    });
  }, [orientedWIn, orientedHIn, prints, frontSlotInfo, showCutLines, showGuides, previewMargin, previewSpacing]);

  useEffect(() => {
    drawSheet(frontRef.current, frontFiles.length ? frontFiles : frontImage, frontRotation, frontPreviewPage, frontPlacementsRef);
  }, [frontFiles, frontImage, frontRotation, frontPreviewPage, sheetKey, orientation, prints, showCutLines, showGuides, drawSheet]);

  useEffect(() => {
    if (showBack) drawSheet(backRef.current, backImage, backRotation, 0, null);
  }, [backImage, backRotation, sheetKey, orientation, prints, showCutLines, showGuides, showBack, drawSheet]);

  // ── LF Canvas ──
  // Stretch-to-fill at the user's requested lfWidth × lfHeight so the preview
  // matches what will print. Auto-orients the artwork 90° when its natural
  // orientation disagrees with the target, but still fills the full area
  // regardless of aspect.
  useEffect(() => {
    const canvas = lfRef.current; if (!canvas || !lfImage) return;
    let cancelled = false;
    const ctx = canvas.getContext("2d");
    const wPx = inchesToPx(lfWidth); const hPx = inchesToPx(lfHeight);
    canvas.width=wPx; canvas.height=hPx;
    ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,wPx,hPx);
    const url = URL.createObjectURL(lfImage);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      drawImageFill(ctx, img, wPx/2, hPx/2, wPx, hPx, 0);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); };
    img.src = url;
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [lfImage, lfWidth, lfHeight]);

  // ── Blueprint Canvas ──
  // Blueprints are drawn to-scale, so we keep "fit" (letterbox) to preserve
  // the uploaded page's aspect ratio, but auto-rotate when orientations
  // disagree so the drawing fills the chosen sheet.
  useEffect(() => {
    const canvas = bpRef.current; if (!canvas) return;
    let cancelled = false;
    const ctx = canvas.getContext("2d");
    const wPx = inchesToPx(bpWidth); const hPx = inchesToPx(bpHeight);
    canvas.width=wPx; canvas.height=hPx;
    ctx.fillStyle="#dbeafe"; ctx.fillRect(0,0,wPx,hPx);
    ctx.strokeStyle="#2563eb"; ctx.lineWidth=2;
    ctx.strokeRect(inchesToPx(0.5),inchesToPx(0.5),wPx-inchesToPx(1),hPx-inchesToPx(1));
    if (!bpFile) {
      ctx.fillStyle="#93c5fd"; ctx.font=`bold ${Math.min(wPx*0.08,18)}px sans-serif`;
      ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(`${bpWidth}″ × ${bpHeight}″`, wPx/2, hPx/2);
      return;
    }
    const url = URL.createObjectURL(bpFile);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const imgLandscape = img.naturalWidth >= img.naturalHeight;
      const boxLandscape = wPx >= hPx;
      const autoRot = imgLandscape === boxLandscape ? 0 : 90;
      const swapped = autoRot === 90;
      const effW = swapped ? img.naturalHeight : img.naturalWidth;
      const effH = swapped ? img.naturalWidth  : img.naturalHeight;
      const s = Math.min(wPx/effW, hPx/effH); // FIT for blueprints
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.save();
      ctx.translate(wPx/2, hPx/2);
      ctx.rotate((autoRot * Math.PI) / 180);
      ctx.drawImage(img, -dw/2, -dh/2, dw, dh);
      ctx.restore();
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); };
    img.src = url;
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [bpFile, bpWidth, bpHeight]);

  // ─── FILE HANDLERS ──────────────────────────────────────
  // While PDF rasterization is in flight we expose `processingFiles`
  // so the upload zone can show a shimmer skeleton instead of a
  // blank state.
  const [processingFiles, setProcessingFiles] = useState(false);

const handleFrontFiles = async (files) => {
    setProcessingFiles(true);
    try {
      const newItems = [];
      for (const f of files) {
        if (isPdfFile(f)) {
          // Extract ALL pages from the PDF as individual items
          const pages = await pdfFileToAllPages(f);
          for (const pg of pages) {
            newItems.push({ id:`f_${Date.now()}_${Math.random()}`, file:pg, name:pg.name, rotation:0, qty:copiesPerFile });
          }
        } else {
          newItems.push({ id:`f_${Date.now()}_${Math.random()}`, file:f, name:f.name, rotation:0, qty:copiesPerFile });
        }
      }
      setFrontFiles(prev => [...prev, ...newItems]);
      if (newItems[0]) setSelectedFrontId(newItems[0].id);
    } finally {
      setProcessingFiles(false);
    }
  };

  const handleBackFile = async (files) => {
    if (!files[0]) return;
    setProcessingFiles(true);
    try { setBackImage(await normalizeUpload(files[0])); }
    finally { setProcessingFiles(false); }
  };

  const handleLfFile = async (files) => {
    if (!files[0]) return;
    setProcessingFiles(true);
    try { setLfImage(await normalizeUpload(files[0])); }
    finally { setProcessingFiles(false); }
  };

  const handleBpFile = async (files) => {
    if (!files[0]) return;
    setProcessingFiles(true);
    try { setBpFile(await normalizeUpload(files[0])); }
    finally { setProcessingFiles(false); }
  };

  const removeFile = (id) => setFrontFiles(prev => prev.filter(f => f.id!==id));
  const updateFileQty = (id, qty) => setFrontFiles(prev => prev.map(f => f.id===id ? {...f, qty:Math.max(0,qty)} : f));
  const rotateFile = (id) => setFrontFiles(prev => prev.map(f => f.id===id ? {...f, rotation:((f.rotation||0)+90)%360} : f));

  // Drag-and-drop reorder of uploaded files. We track which row id
  // is being dragged so other rows can render an insertion indicator.
  const [dragSourceId, setDragSourceId] = useState(null);
  const [dragOverId, setDragOverId]     = useState(null);
  const reorderFile = (sourceId, targetId) => {
    if (!sourceId || sourceId === targetId) return;
    setFrontFiles(prev => {
      const src = prev.findIndex(f => f.id === sourceId);
      const dst = prev.findIndex(f => f.id === targetId);
      if (src < 0 || dst < 0) return prev;
      const next = prev.slice();
      const [moved] = next.splice(src, 1);
      next.splice(dst, 0, moved);
      return next;
    });
  };

  // ─── TICKET ACTIONS ─────────────────────────────────────
  // Snapshot current editor state into the shape of a ticket line item.
  // Existing ticket entry's id is preserved.
  const packEditorAsItem = () => ({
    ...(ticket[activeTicketIdx] || {}),
    id: ticket[activeTicketIdx]?.id || `item_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    paperKey, sheetKey, orientation, frontColorMode, backColorMode, showBack,
    printWidth: prints.width, printHeight: prints.height, printQuantity: prints.quantity,
    frontFiles, backImage, backRotation, frontRotation,
    showCutLines, showGuides,
    // computed snapshot (used by ticket summaries)
    printsPerSheet, totalPrintQty, sheetsNeeded, perSheetTotal,
  });

  // Push an item's stored state into the editor variables.
  const applyJobToEditor = (item) => {
    if (!item) return;
    setPaperKey(item.paperKey);
    setSheetKey(item.sheetKey);
    setOrientation(item.orientation);
    setFrontColorMode(item.frontColorMode);
    setBackColorMode(item.backColorMode);
    setShowBack(!!item.showBack);
    setPrints({
      width:    Number(item.printWidth)    || 3.5,
      height:   Number(item.printHeight)   || 2,
      quantity: Number(item.printQuantity) || 0,
    });
    setFrontFiles(Array.isArray(item.frontFiles) ? item.frontFiles : []);
    setBackImage(item.backImage || null);
    setBackRotation(Number(item.backRotation) || 0);
    setFrontRotation(Number(item.frontRotation) || 0);
    setShowCutLines(item.showCutLines ?? true);
    setShowGuides(item.showGuides ?? true);
    setSelectedFrontId(null);
    setFrontPreviewPage(0);
  };

  // Auto-save the editor state into the active ticket slot, debounced.
  // Skipped during an applyJobToEditor() so we don't immediately save back
  // the just-loaded values.
  useEffect(() => {
    if (isLoadingFromTicketRef.current) {
      isLoadingFromTicketRef.current = false;
      return;
    }
    const t = setTimeout(() => {
      setTicket(prev => prev.map((it, i) => i === activeTicketIdx ? packEditorAsItem() : it));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    paperKey, sheetKey, orientation, frontColorMode, backColorMode, showBack,
    prints, frontFiles, backImage, backRotation, frontRotation,
    showCutLines, showGuides,
    printsPerSheet, totalPrintQty, sheetsNeeded, perSheetTotal,
    activeTicketIdx,
  ]);

  const switchToTicketIdx = (idx) => {
    if (idx === activeTicketIdx || idx < 0 || idx >= ticket.length) return;
    // 1) immediately persist the outgoing editor state
    const outgoing = packEditorAsItem();
    // 2) load the new job into the editor (skip auto-save once)
    isLoadingFromTicketRef.current = true;
    setTicket(prev => prev.map((it, i) => i === activeTicketIdx ? outgoing : it));
    applyJobToEditor(ticket[idx]);
    setActiveTicketIdx(idx);
  };

  const addJobToTicket = () => {
    const outgoing = packEditorAsItem();
    const fresh = createEmptyJob({
      paperKey: paperTypes[0]?.key || paperKey,
      sheetKey: "8.5x11",
    });
    isLoadingFromTicketRef.current = true;
    setTicket(prev => {
      const next = prev.map((it, i) => i === activeTicketIdx ? outgoing : it);
      next.push(fresh);
      return next;
    });
    applyJobToEditor(fresh);
    setActiveTicketIdx(ticket.length); // current length is the new index
  };

  const removeJobFromTicket = (idx) => {
    if (ticket.length <= 1) return; // ticket always has at least one job
    const next = ticket.filter((_, i) => i !== idx);
    let newActive = activeTicketIdx;
    if (idx === activeTicketIdx) newActive = Math.max(0, idx - 1);
    else if (idx < activeTicketIdx) newActive = activeTicketIdx - 1;
    isLoadingFromTicketRef.current = true;
    setTicket(next);
    applyJobToEditor(next[newActive]);
    setActiveTicketIdx(newActive);
  };

  // ─── TICKET PRICING (grouped discounts) ────────────────
  // Group line items by `paperKey:sheetKey`; each group's totalSheets
  // determines that group's discount factor, which then applies to
  // every line item in the group. The active editor's just-typed values
  // may not yet have flushed to ticket[activeTicketIdx], so for that
  // entry we use the live editor numbers.
  const ticketView = useMemo(() => {
    return ticket.map((it, i) => i === activeTicketIdx
      ? { ...it, paperKey, sheetKey, sheetsNeeded, perSheetTotal, printsPerSheet, totalPrintQty,
          printWidth: prints.width, printHeight: prints.height, frontFiles, backImage, showBack,
          frontColorMode, backColorMode, orientation }
      : it
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket, activeTicketIdx, paperKey, sheetKey, sheetsNeeded, perSheetTotal, printsPerSheet, totalPrintQty, prints, frontFiles, backImage, showBack, frontColorMode, backColorMode, orientation]);

  const ticketGroups = useMemo(() => {
    const g = {};
    ticketView.forEach((it) => {
      const key = `${it.paperKey}:${it.sheetKey}`;
      if (!g[key]) g[key] = { paperKey: it.paperKey, sheetKey: it.sheetKey, totalSheets: 0, items: [] };
      g[key].items.push(it);
      g[key].totalSheets += Number(it.sheetsNeeded) || 0;
    });
    Object.values(g).forEach((group) => {
      group.discountFactor = getSheetDiscountFactor(group.totalSheets);
      group.discountPercent = (1 - group.discountFactor) * 100;
    });
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketView, quantityDiscounts]);

  const ticketLines = useMemo(() => {
    return ticketView.map((it) => {
      const key = `${it.paperKey}:${it.sheetKey}`;
      const group = ticketGroups[key];
      const factor = group?.discountFactor ?? 1;
      const pst = Number(it.perSheetTotal) || 0;
      const sn  = Number(it.sheetsNeeded)  || 0;
      const subtotal = pst * sn;
      return {
        item: it,
        groupKey: key,
        appliedDiscountFactor: factor,
        appliedDiscountPercent: (1 - factor) * 100,
        subtotal,
        lineTotal: subtotal * factor,
        discountAmount: subtotal * (1 - factor),
      };
    });
  }, [ticketView, ticketGroups]);

  const ticketTotal       = ticketLines.reduce((s, l) => s + l.lineTotal, 0);
  const ticketSubtotal    = ticketLines.reduce((s, l) => s + l.subtotal,  0);
  const ticketDiscountAmt = ticketLines.reduce((s, l) => s + l.discountAmount, 0);
  const ticketTotalSheets = ticketLines.reduce((s, l) => s + (Number(l.item.sheetsNeeded)||0), 0);
  const activeLine        = ticketLines[activeTicketIdx];
  const activeGroup       = activeLine ? ticketGroups[activeLine.groupKey] : null;

  // ─── SAVE-TO-DB ROW BUILDERS ────────────────────────────
  // After a PDF download, we offer to persist a snapshot of the
  // job to Supabase. Each download function builds the row and
  // hands it to requestSaveJob, which opens the confirmation
  // modal (and password prompt if needed).
  const requestSaveJob = (row, label) => {
    if (!isSupabaseConfigured) return; // silently skip if env vars missing
    setPendingSaveJob({ row, label });
  };

  const buildSheetJobRow = () => {
    // For multi-job tickets we still produce a single row (one DB entry per
    // ticket), but we collapse the line items into the row's columns and
    // capture the full ticket snapshot in job_details for later lookup.
    const liveTicket = ticket.map((it, i) => i === activeTicketIdx ? packEditorAsItem() : it);
    const fileNamesAll = liveTicket.flatMap(it => (it.frontFiles||[]).map(f => f.name));

    if (liveTicket.length === 1) {
      const currentPaper = paperTypes.find(p=>p.key===paperKey)||{label:paperKey};
      const [sw,sh] = PRESET_SHEETS[sheetKey] || [8.5,11];
      const discPct = Math.max(0,(1-(discountFactor||1))*100);
      return {
        job_type: "sheets",
        paper_type: currentPaper.label,
        paper_key: paperKey,
        sheet_size: sheetKey,
        sku: skuMap[`${paperKey}:${sheetKey}`] || null,
        print_size: `${prints.width}x${prints.height}`,
        orientation,
        color_mode: frontColorMode,
        quantity: totalPrintQty || null,
        sheets_needed: sheetsNeeded || null,
        sides: showBack ? "Front + Back" : "Single-sided",
        per_sheet_price: Number(perSheetTotal.toFixed(4)),
        discount_percent: Number(discPct.toFixed(3)),
        total_price: Number(totalPrice.toFixed(2)),
        file_names: fileNamesAll,
        job_details: {
          sheetSize: { w: sw, h: sh },
          prints: { width: prints.width, height: prints.height, quantity: prints.quantity },
          backColorMode: showBack ? backColorMode : null,
          printsPerSheet,
          gridCols: frontSlotInfo?.cols,
          gridRows: frontSlotInfo?.rows,
          printRotated: !!frontSlotInfo?.printRotated,
          files: frontFiles.map(f => ({ name: f.name, qty: f.qty, rotation: f.rotation })),
        },
      };
    }

    // Multi-job snapshot — re-derive grouped totals from liveTicket.
    const groups = {};
    liveTicket.forEach(it => {
      const k = `${it.paperKey}:${it.sheetKey}`;
      if (!groups[k]) groups[k] = { totalSheets: 0 };
      groups[k].totalSheets += Number(it.sheetsNeeded) || 0;
    });
    Object.values(groups).forEach(g => { g.factor = getSheetDiscountFactor(g.totalSheets); });
    const sub = liveTicket.reduce((s, it) => s + (it.perSheetTotal||0)*(it.sheetsNeeded||0), 0);
    const total = liveTicket.reduce((s, it) => s + (it.perSheetTotal||0)*(it.sheetsNeeded||0)*groups[`${it.paperKey}:${it.sheetKey}`].factor, 0);
    const totalSheetsAll = liveTicket.reduce((s, it) => s + (it.sheetsNeeded||0), 0);
    const totalQtyAll    = liveTicket.reduce((s, it) => s + (it.totalPrintQty||0), 0);
    const overallDiscPct = sub > 0 ? Math.max(0, (1 - total/sub) * 100) : 0;
    const first = liveTicket[0];
    const firstPaper = paperTypes.find(p=>p.key===first.paperKey)?.label || first.paperKey;

    return {
      job_type: "sheets",
      paper_type: `Ticket: ${liveTicket.length} jobs`,
      paper_key: first.paperKey, // first job's key as a representative
      sheet_size: first.sheetKey,
      sku: skuMap[`${first.paperKey}:${first.sheetKey}`] || first.paperKey,
      print_size: `${first.printWidth}x${first.printHeight}`,
      orientation: first.orientation,
      color_mode: first.frontColorMode,
      quantity: totalQtyAll || null,
      sheets_needed: totalSheetsAll || null,
      sides: liveTicket.some(it => it.showBack) ? "Mixed" : "Single-sided",
      per_sheet_price: null,
      discount_percent: Number(overallDiscPct.toFixed(3)),
      total_price: Number(total.toFixed(2)),
      file_names: fileNamesAll,
      job_details: {
        ticket: liveTicket.map((it, i) => {
          const k = `${it.paperKey}:${it.sheetKey}`;
          const factor = groups[k].factor;
          const subt = (it.perSheetTotal||0)*(it.sheetsNeeded||0);
          return {
            jobNumber: i + 1,
            paperKey: it.paperKey,
            paperLabel: paperTypes.find(p=>p.key===it.paperKey)?.label || it.paperKey,
            sheetKey: it.sheetKey,
            orientation: it.orientation,
            printWidth: it.printWidth,
            printHeight: it.printHeight,
            printQuantity: it.printQuantity,
            sheetsNeeded: it.sheetsNeeded,
            printsPerSheet: it.printsPerSheet,
            perSheetPrice: Number((it.perSheetTotal||0).toFixed(4)),
            colorMode: it.frontColorMode,
            backColorMode: it.showBack ? it.backColorMode : null,
            sides: it.showBack ? "Front + Back" : "Single-sided",
            files: (it.frontFiles||[]).map(f => ({ name: f.name, qty: f.qty, rotation: f.rotation })),
            appliedDiscountPercent: Number(((1 - factor) * 100).toFixed(3)),
            subtotal: Number(subt.toFixed(2)),
            lineTotal: Number((subt * factor).toFixed(2)),
          };
        }),
        groups: Object.entries(groups).map(([k, g]) => ({
          group: k,
          totalSheets: g.totalSheets,
          discountPercent: Number(((1 - g.factor) * 100).toFixed(3)),
        })),
        firstPaperLabel: firstPaper,
      },
    };
  };

  const buildLfJobRow = () => {
    const lfPaper = lfPaperTypes.find(p=>p.key===lfPaperKey)||{label:lfPaperKey};
    return {
      job_type: "large-format",
      paper_type: lfPaper.label,
      paper_key: lfPaperKey,
      print_size: `${lfWidth}x${lfHeight}`,
      orientation: lfWidth>=lfHeight ? "landscape" : "portrait",
      color_mode: lfColorMode,
      quantity: 1,
      total_price: Number(lfTotalWithDiscount.toFixed(2)),
      file_names: lfImage ? [lfImage.name||"artwork"] : [],
      addons: {
        grommets: lfGrommets ? { count: lfGrommetCount, eachPrice: lfAddonPricing.grommetEach||0 } : null,
        foamCore: lfFoamCore ? { price: lfAddonPricing.foamCore||0 } : null,
      },
      job_details: {
        widthIn: lfWidth, heightIn: lfHeight,
        areaSqFt: Number(lfAreaSqFt.toFixed(3)),
      },
    };
  };

  const buildBlueprintJobRow = () => ({
    job_type: "blueprints",
    paper_type: "20lb plain bond",
    paper_key: "plain_20lb",
    print_size: bpSizeObj.label,
    orientation: bpWidth>=bpHeight ? "landscape" : "portrait",
    color_mode: "bw",
    quantity: bpQty,
    sheets_needed: bpQty,
    per_sheet_price: Number(bpPerSheet.toFixed(4)),
    total_price: Number(bpTotal.toFixed(2)),
    file_names: bpFile ? [bpFile.name] : [],
    job_details: {
      sizeKey: bpSizeKey,
      widthIn: bpWidth, heightIn: bpHeight,
      psf: Number(bpPsf.toFixed(4)),
      areaPerSheetSqFt: Number(bpAreaPerSheetSqFt.toFixed(3)),
      totalSqFt: Number(bpTotalSqFt.toFixed(3)),
    },
  });

  // ─── PDF DOWNLOADS ──────────────────────────────────────

// How many preview pages a sheet job needs.
  //  • 1 file × N copies            → 1 page (every sheet is identical)
  //  • multiple files, all fit on   → 1 page (each sheet still ends up
  //    one sheet at the same qty       identical because the layout repeats)
  //  • otherwise                    → min(sheetsNeeded, 20). Cap at 20 so a
  //    50-copy shop run doesn't emit a 50-page PDF; the first 20 sheets are
  //    plenty for the press operator to cross-check the layouts.
  const previewPagesFor = (files, printsPerSheetVal, sheetsNeededVal) => {
    const arr = Array.isArray(files) ? files : [];
    if (arr.length <= 1) return 1;
    const firstQty = Number(arr[0].qty) || 0;
    const allSameQty  = arr.every((f) => (Number(f.qty) || 0) === firstQty);
    const allFitOnOne = arr.length <= Math.max(1, Number(printsPerSheetVal) || 1);
    if (allSameQty && allFitOnOne) return 1;
    return Math.min(Math.max(1, Number(sheetsNeededVal) || 1), 20);
  };

// Render a hi-res sheet canvas for print-quality PDF embedding. Uses the
  // same drawSheet logic but at PRINT_DPI_SHEET DPI, and suppresses on-screen-
  // only guides/cut lines so the output PDF is clean.
  const renderHiResSheet = async (imageInput, rotDeg, pageIndex=0) => {
    const c = document.createElement("canvas");
    await drawSheet(c, imageInput, rotDeg, pageIndex, null, {
      dpi: PRINT_DPI_SHEET,
      showGuides: false,
      showCutLines: false,
    });
    return c;
  };

  // Hi-res render of an arbitrary ticket line item (NOT the active editor).
  // Builds the same orientation/slot params drawSheetTo expects from the
  // saved item snapshot.
  const renderHiResForItem = async (item, pageIndex = 0) => {
    const c = document.createElement("canvas");
    const dims = PRESET_SHEETS[item.sheetKey] || [8.5, 11];
    const widthIn  = item.orientation === "landscape" ? Math.max(...dims) : Math.min(...dims);
    const heightIn = item.orientation === "landscape" ? Math.min(...dims) : Math.max(...dims);
    const itemPrints = { width: item.printWidth, height: item.printHeight, quantity: item.printQuantity };
    const fit = computeBestFit(item.printWidth, item.printHeight, widthIn, heightIn, previewMargin, previewSpacing);
    const itemFiles = (Array.isArray(item.frontFiles) && item.frontFiles.length) ? item.frontFiles : null;
    await drawSheetTo(c, {
      imageInput: itemFiles,
      rotDeg: Number(item.frontRotation) || 0,
      pageIndex,
      placementsRef: null,
      orientedWIn: widthIn,
      orientedHIn: heightIn,
      prints: itemPrints,
      frontSlotInfo: fit,
      previewMargin, previewSpacing,
      showGuides: false, showCutLines: false,
      dpi: PRINT_DPI_SHEET,
    });
    return { canvas: c, widthIn, heightIn };
  };

  const downloadSheetPDF = async () => {
    // Make sure the ticket reflects the latest editor edits before we read it.
    const liveTicket = ticket.map((it, i) => i === activeTicketIdx ? packEditorAsItem() : it);
    const hasAnyFiles = liveTicket.some(it => (it.frontFiles||[]).length > 0) || !!frontImage;
    if (!hasAnyFiles) { alert("Upload at least one image before downloading."); return; }
    await ensureLogoPdfDataUrl();
    const orderDoc = new (getJsPDF())({ orientation:"portrait", unit:"in", format:"letter" });

    if (liveTicket.length === 1) {
      // ── SINGLE JOB ── identical to the original behavior.
      const currentPaper = paperTypes.find(p=>p.key===paperKey)||{label:paperKey};
      const [sw,sh] = PRESET_SHEETS[sheetKey] || [8.5,11];
      const details = [
        { label:"Paper:", value:currentPaper.label },
        { label:"SKU:", value:skuMap[`${paperKey}:${sheetKey}`] || paperKey },
        { label:"Sheet size:", value:`${sw}×${sh} in` },
        { label:"Orientation:", value:orientation },
        { label:"Print size:", value:`${prints.width}×${prints.height} in` },
        { label:"Prints/sheet:", value:`${Math.max(1,printsPerSheet)} (${frontSlotInfo?.cols||0}×${frontSlotInfo?.rows||0} grid)` },
        { label:"Total prints:", value:totalPrintQty },
        { label:"Sheets needed:", value:sheetsNeeded },
        { label:"Sides:", value:showBack?"Front + Back":"Single-sided" },
        { label:"Color:", value:showBack?`${frontColorMode.toUpperCase()} / ${backColorMode.toUpperCase()}`:frontColorMode.toUpperCase() },
      ];
      const subtotal = perSheetTotal * sheetsNeeded;
      const discPct  = Math.max(0,(1-(discountFactor||1))*100);
      const discAmt  = Math.max(0, subtotal - totalPrice);
      const totals = [
        { label:"Per-sheet cost:", value:`$${perSheetTotal.toFixed(2)}` },
        { label:"Subtotal:", value:`$${subtotal.toFixed(2)}` },
        ...(discPct>0.0001 ? [{ label:`Qty discount (${discPct.toFixed(1)}%):`, value:`-$${discAmt.toFixed(2)}` }] : []),
        { label:"Estimated total:", value:`$${totalPrice.toFixed(2)}` },
      ];
      const files = frontFiles.length ? frontFiles.map((f,i)=>`${i+1}. ${f.name}  —  qty: ${f.qty}`) : (frontImage ? [frontImage.name||"front"] : []);
      addOrderSheetPage(orderDoc, { jobType:"Paper Printing", details, totals, files });

      const pdfW=orientedWIn, pdfH=orientedHIn;
      const pageOrient = pdfW>pdfH ? "landscape" : "portrait";
      const exportInput = frontFiles.length ? frontFiles : (frontImage ? [{ id:"single", file:frontImage, name:frontImage.name||"Image", rotation:0, qty:Number(prints.quantity)||1 }] : []);

      // Front previews — one page per UNIQUE sheet layout. Single-image
      // jobs and "everything fits on one sheet" jobs need only one page;
      // multi-file jobs that span sheets need one page per sheet so each
      // file actually shows up in the PDF.
      const frontPreviewPages = previewPagesFor(frontFiles, printsPerSheet, sheetsNeeded);
      for (let pageIdx = 0; pageIdx < frontPreviewPages; pageIdx++) {
        const frontCanvas = await renderHiResSheet(exportInput, frontRotation, pageIdx);
        orderDoc.addPage([pdfW,pdfH], pageOrient);
        orderDoc.addImage(canvasToPrintJpeg(frontCanvas), "JPEG", 0, 0, pdfW, pdfH);
      }

      // Back side: one image repeated, so a single preview page is fine.
      if (showBack && backImage) {
        const backCanvas = await renderHiResSheet(backImage, backRotation, 0);
        orderDoc.addPage([pdfW,pdfH], pageOrient);
        orderDoc.addImage(canvasToPrintJpeg(backCanvas), "JPEG", 0, 0, pdfW, pdfH);
      }
    } else {
      // ── MULTI-JOB TICKET ──
      // Build a per-item view from liveTicket so prices reflect current
      // grouping. We re-derive groups locally so the saved ticket array is
      // the single source of truth.
      const groups = {};
      liveTicket.forEach((it) => {
        const k = `${it.paperKey}:${it.sheetKey}`;
        if (!groups[k]) groups[k] = { totalSheets: 0 };
        groups[k].totalSheets += Number(it.sheetsNeeded) || 0;
      });
      Object.values(groups).forEach((g) => { g.factor = getSheetDiscountFactor(g.totalSheets); });

      const jobs = liveTicket.map((it, idx) => {
        const paperLabel = paperTypes.find(p=>p.key===it.paperKey)?.label || it.paperKey;
        const [sw, sh] = PRESET_SHEETS[it.sheetKey] || [8.5, 11];
        const sku = skuMap[`${it.paperKey}:${it.sheetKey}`] || it.paperKey;
        const colorTxt = it.showBack
          ? `${(it.frontColorMode||"").toUpperCase()} / ${(it.backColorMode||"").toUpperCase()}`
          : (it.frontColorMode||"").toUpperCase();
        const sub = (it.perSheetTotal || 0) * (it.sheetsNeeded || 0);
        const factor = groups[`${it.paperKey}:${it.sheetKey}`].factor;
        const lineTotal = sub * factor;
        const fileLabels = (it.frontFiles || []).map(f => `${f.name} (×${f.qty || 0})`);
        return {
          subtitle: `${paperLabel} · ${it.sheetKey}`,
          details: [
            { label:"Paper:",      value: paperLabel },
            { label:"SKU:",        value: sku },
            { label:"Sheet:",      value: `${sw}×${sh} in (${it.orientation})` },
            { label:"Print size:", value: `${it.printWidth}×${it.printHeight} in` },
            { label:"Color:",      value: colorTxt || "—" },
            { label:"Sides:",      value: it.showBack ? "Front + Back" : "Single-sided" },
            { label:"Total prints:", value: it.totalPrintQty || 0 },
            { label:"Sheets:",     value: it.sheetsNeeded || 0 },
            { label:"Per sheet:",  value: `$${(it.perSheetTotal||0).toFixed(2)}` },
          ],
          files: fileLabels,
          subtotalLabel: `Job ${idx + 1} subtotal:`,
          subtotalValue: `$${lineTotal.toFixed(2)}`,
        };
      });

      const subtotal = liveTicket.reduce((s, it) => s + (it.perSheetTotal||0)*(it.sheetsNeeded||0), 0);
      const ticketTotalLocal = liveTicket.reduce((s, it) => {
        const f = groups[`${it.paperKey}:${it.sheetKey}`].factor;
        return s + (it.perSheetTotal||0)*(it.sheetsNeeded||0)*f;
      }, 0);
      const discAmt = Math.max(0, subtotal - ticketTotalLocal);
      const totalSheetsLocal = liveTicket.reduce((s, it) => s + (it.sheetsNeeded||0), 0);

      const summary = [
        { label:"Total sheets (all jobs):", value: String(totalSheetsLocal) },
        { label:"Subtotal:", value: `$${subtotal.toFixed(2)}` },
        ...(discAmt > 0.0001 ? [{ label:"Combined volume discount:", value: `-$${discAmt.toFixed(2)}` }] : []),
        { label:"Ticket total:", value: `$${ticketTotalLocal.toFixed(2)}` },
      ];

      // Group breakdown helps the press operator see why discounts applied.
      Object.entries(groups).forEach(([k, g]) => {
        const pct = (1 - g.factor) * 100;
        if (pct > 0.05) {
          const [pk, sk] = k.split(":");
          const pl = paperTypes.find(p=>p.key===pk)?.label || pk;
          summary.splice(summary.length - 1, 0,
            { label:`  • ${pl} ${sk} (${g.totalSheets} sht)`, value:`${pct.toFixed(1)}% off` });
        }
      });

      const firstSku = skuMap[`${liveTicket[0].paperKey}:${liveTicket[0].sheetKey}`] || liveTicket[0].paperKey;
      addTicketOrderSheetPage(orderDoc, { jobs, summary, barcodeValue: firstSku });

      // Preview pages per job — one page per unique sheet layout, so a
      // multi-file job actually shows every file in the PDF.
      for (let i = 0; i < liveTicket.length; i++) {
        const item = liveTicket[i];
        const pages = previewPagesFor(item.frontFiles, item.printsPerSheet, item.sheetsNeeded);
        for (let pageIdx = 0; pageIdx < pages; pageIdx++) {
          const { canvas, widthIn, heightIn } = await renderHiResForItem(item, pageIdx);
          const orient = widthIn > heightIn ? "landscape" : "portrait";
          orderDoc.addPage([widthIn, heightIn], orient);
          orderDoc.addImage(canvasToPrintJpeg(canvas), "JPEG", 0, 0, widthIn, heightIn);
        }
      }
    }

    savePdf(orderDoc, liveTicket.length > 1 ? "print_order_ticket.pdf" : "print_order_sheet.pdf");
    requestSaveJob(buildSheetJobRow(), liveTicket.length > 1 ? `Ticket (${liveTicket.length} jobs)` : "Sheets / Photos");
  };

  const downloadLfPDF = async () => {
    if (!lfImage) { alert("Upload a large format image first."); return; }
    await ensureLogoPdfDataUrl();
    const orderDoc = new (getJsPDF())({ orientation:"portrait", unit:"in", format:"letter" });
    const lfPaper = lfPaperTypes.find(p=>p.key===lfPaperKey)||{label:lfPaperKey};
    const details = [
      { label:"Paper:", value:lfPaper.label },
      { label:"Size:", value:`${lfWidth}×${lfHeight} in` },
      { label:"Orientation:", value:lfWidth>=lfHeight?"landscape":"portrait" },
      { label:"Color:", value:lfColorMode==="bw"?"B/W":"Color" },
      { label:"Add-ons:", value:[lfGrommets?`Grommets ×${lfGrommetCount} ($${((lfAddonPricing.grommetEach||0)*lfGrommetCount).toFixed(2)})`:null,lfFoamCore?`Foam Core ($${(lfAddonPricing.foamCore||0).toFixed(2)})`:null].filter(Boolean).join(", ")||"None" },
    ];
    const totals = [{ label:"Estimated total:", value:`$${lfTotalWithDiscount.toFixed(2)}` }];
    addOrderSheetPage(orderDoc, { jobType:"Large Format", details, totals, files: lfImage?[lfImage.name||"artwork"]:[] });

    // Render the artwork at LF print DPI, stretched to fill the user's
    // requested lfWidth × lfHeight (aspect preserved only if it already
    // matches — the user has explicitly asked for this size).
    const pdfW=lfWidth, pdfH=lfHeight, orient=pdfW>=pdfH?"landscape":"portrait";
    const img = await fileToImage(lfImage);
    const hiRes = renderSingleImageCanvas(img, pdfW, pdfH, { dpi: PRINT_DPI_LF, fill: "stretch" });
    orderDoc.addPage([pdfW,pdfH],orient);
    orderDoc.addImage(canvasToPrintJpeg(hiRes), "JPEG", 0, 0, pdfW, pdfH);

    savePdf(orderDoc, "large_format_with_order_sheet.pdf");
    requestSaveJob(buildLfJobRow(), "Large Format");
  };

  const downloadBlueprintPDF = async () => {
    await ensureLogoPdfDataUrl();
    const orderDoc = new (getJsPDF())({ orientation:"portrait", unit:"in", format:"letter" });
    const details = [
      { label:"Paper:", value:"20lb plain bond" },
      { label:"Blueprint size:", value:bpSizeObj.label },
      { label:"Quantity:", value:bpQty },
      { label:"Orientation:", value:bpWidth>=bpHeight?"landscape":"portrait" },
    ];
    const totals = [{ label:"Estimated total:", value:`$${bpTotal.toFixed(2)}` }];
    addOrderSheetPage(orderDoc, { jobType:"Blueprints", details, totals, files: bpFile?[bpFile.name||"blueprint"]:[] });
    if (bpFile) {
      const pdfW=bpWidth, pdfH=bpHeight, orient=pdfW>=pdfH?"landscape":"portrait";
      const img = await fileToImage(bpFile);
      // Blueprints: FIT (letterbox) preserves the drawing's aspect/scale
      const hiRes = renderSingleImageCanvas(img, pdfW, pdfH, { dpi: PRINT_DPI_BP, fill: "fit" });
      orderDoc.addPage([pdfW,pdfH],orient);
      orderDoc.addImage(canvasToPrintJpeg(hiRes), "JPEG", 0, 0, pdfW, pdfH);
    }
    savePdf(orderDoc, "blueprint_with_order_sheet.pdf");
    requestSaveJob(buildBlueprintJobRow(), "Blueprints");
  };

  // ─── SAVE-TO-DB CONFIRM ────────────────────────────────
  const confirmSaveJob = async (extra={}) => {
    if (!pendingSaveJob) return;
    if (!ensureDbAuthenticated()) return;
    setSavingJob(true);
    try {
      const merged = { ...pendingSaveJob.row, ...extra };
      const saved = await savePrintJob(merged);
      setPendingSaveJob(null);
      const idShort = saved?.id ? saved.id.slice(0, 8) : "saved";
      setSavedJobToast(`Saved · job ${idShort}`);
      setTimeout(() => setSavedJobToast(""), 3500);
    } catch (e) {
      alert("Could not save job: " + (e?.message || String(e)));
    } finally {
      setSavingJob(false);
    }
  };
  const dismissSaveJob = () => { if (!savingJob) setPendingSaveJob(null); };

  const openJobHistory = () => {
    if (!isSupabaseConfigured) { alert("Supabase isn't configured."); return; }
    if (!ensureDbAuthenticated()) return;
    setShowJobHistory(true);
  };

  // ─── EMAIL ORDER ────────────────────────────────────────

  const sendOrderEmail = async (jobType, jobPdfBlob, orderSheetBlob) => {
    try {
      const blobToB64 = b => new Promise((res,rej) => { const r=new FileReader(); r.onloadend=()=>res(r.result); r.onerror=rej; r.readAsDataURL(b); });
      const prefix = "data:application/pdf;base64,";
      const jobB64Full = await blobToB64(jobPdfBlob);
      const jobPdfBase64 = jobB64Full.startsWith(prefix) ? jobB64Full.slice(prefix.length) : jobB64Full;
      let orderSheetPdfBase64 = null;
      if (orderSheetBlob) { const s = await blobToB64(orderSheetBlob); orderSheetPdfBase64 = s.startsWith(prefix)?s.slice(prefix.length):s; }
      if (jobPdfBase64.length > 10*1024*1024) { alert("PDF too large to send automatically. Please download and email manually."); return false; }
      const name  = window.prompt("Your name (for the order)?") || "";
      const email = window.prompt("Your email (for confirmation)?") || "";
      const phone = window.prompt("Your phone number (optional)?") || "";
      const orderId = `JOB-${Date.now()}`;

      const buildOrder = () => {
        const paperItems=[],largeFormatItems=[],blueprintItems=[];
        if (jobType==="sheets") {
          const liveTicket = ticket.map((it, i) => i === activeTicketIdx ? packEditorAsItem() : it);
          if (liveTicket.length === 1) {
            const unit = sheetsNeeded>0 ? totalPrice/sheetsNeeded : totalPrice;
            paperItems.push({ name:"Paper Printing", sku:paperKey, specs:`${sheetKey} • ${paperKey} • ${frontColorMode.toUpperCase()}${showBack?" / "+backColorMode.toUpperCase():""}`, qty:sheetsNeeded, unitPrice:unit, total:totalPrice });
          } else {
            // One paperItem per ticket line; volume discount is already
            // baked into each line's total via the grouped factor.
            const groups = {};
            liveTicket.forEach(it => {
              const k = `${it.paperKey}:${it.sheetKey}`;
              if (!groups[k]) groups[k] = { totalSheets: 0 };
              groups[k].totalSheets += Number(it.sheetsNeeded) || 0;
            });
            Object.values(groups).forEach(g => { g.factor = getSheetDiscountFactor(g.totalSheets); });
            liveTicket.forEach((it, idx) => {
              const factor = groups[`${it.paperKey}:${it.sheetKey}`].factor;
              const sub = (it.perSheetTotal||0)*(it.sheetsNeeded||0);
              const lineTotal = sub * factor;
              const unit = it.sheetsNeeded>0 ? lineTotal/it.sheetsNeeded : lineTotal;
              const colorTxt = it.showBack
                ? `${(it.frontColorMode||"").toUpperCase()} / ${(it.backColorMode||"").toUpperCase()}`
                : (it.frontColorMode||"").toUpperCase();
              paperItems.push({
                name: `Job ${idx + 1} — Paper Printing`,
                sku: skuMap[`${it.paperKey}:${it.sheetKey}`] || it.paperKey,
                specs: `${it.sheetKey} • ${it.paperKey} • ${it.printWidth}×${it.printHeight} • ${colorTxt}`,
                qty: it.sheetsNeeded || 0,
                unitPrice: unit,
                total: lineTotal,
              });
            });
          }
        }
        if (jobType==="large-format") {
          const addons = [lfGrommets?`Grommets ×${lfGrommetCount}`:null,lfFoamCore?"Foam Core":null].filter(Boolean);
          largeFormatItems.push({ name:"Large Format", sku:lfPaperKey, specs:`${lfWidth}"×${lfHeight}" • ${lfPaperKey} • ${lfColorMode.toUpperCase()}${addons.length?" • "+addons.join(", "):""}`, qty:1, unitPrice:lfTotalWithDiscount, total:lfTotalWithDiscount });
        }
        if (jobType==="blueprints") {
          blueprintItems.push({ name:"Blueprints", sku:"plain_20lb", specs:`${bpSizeObj.label} • ${bpWidth}"×${bpHeight}" • B/W`, qty:bpQty, unitPrice:bpQty>0?bpTotal/bpQty:bpTotal, total:bpTotal });
        }
        const subtotal = [...paperItems,...largeFormatItems,...blueprintItems].reduce((s,i)=>s+(Number(i.total)||0),0);
        return { orderId, customerName:name||"Walk-In", phone, email, dueDate:"ASAP", fulfillment:"Pickup", notes:"", subtotal, discountPct:0, discountAmt:0, total:subtotal, paperItems, largeFormatItems, blueprintItems };
      };

      const order = buildOrder();
      const payload = {
        subject: `Print Order – ${order.customerName} – ${orderId}`,
        to: UPS_STORE.email,
        deepLinkUrl: `${window.location.origin}${window.location.pathname}?job=${encodeURIComponent(orderId)}`,
        order,
        jobType,
        details: { jobType, user:{ name, email, phone }, sheet:{ sheetKey,orientation,prints,paperKey,frontColorMode,backColorMode,showBack,sheetsNeeded,totalPrice:totalPrice.toFixed(2) }, largeFormat:{ width:lfWidth,height:lfHeight,paperKey:lfPaperKey,colorMode:lfColorMode,addons:{grommets:lfGrommets,grommetCount:lfGrommetCount,foamCore:lfFoamCore},lfTotal:lfTotalWithDiscount.toFixed(2) }, blueprints:{ size:bpSizeKey,width:bpWidth,height:bpHeight,qty:bpQty,paperKey:"plain_20lb",colorMode:"bw",psf:bpPsf.toFixed(4),areaPerSheetSqFt:bpAreaPerSheetSqFt.toFixed(3),totalSqFt:bpTotalSqFt.toFixed(3),total:bpTotal.toFixed(2) } },
        jobPdfBase64, orderSheetPdfBase64,
      };
      const resp = await fetch("/.netlify/functions/send-print-job", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
      if (!resp.ok) { console.error("Server error:", resp.status); alert("Could not send automatically. Please download the PDF and email it to "+UPS_STORE.email); return false; }
      fireConfetti();
      alert("Order sent! We'll receive your job details by email shortly.");
      return true;
    } catch (err) { console.error("sendOrderEmail error:", err); alert("Could not send automatically. Please download and email manually."); return false; }
  };

  const orderSheetJob = async () => {
    const liveTicket = ticket.map((it, i) => i === activeTicketIdx ? packEditorAsItem() : it);
    const hasAnyFiles = liveTicket.some(it => (it.frontFiles||[]).length > 0) || !!frontImage;
    if (!hasAnyFiles) { alert("Please upload at least one image first."); return; }

    // Build a single PDF that contains all jobs' preview pages back-to-back.
    // First page sets the format; we add each job's preview at its own dims.
    const firstItem = liveTicket[0];
    const firstDims = PRESET_SHEETS[firstItem.sheetKey] || [8.5, 11];
    const firstW = firstItem.orientation === "landscape" ? Math.max(...firstDims) : Math.min(...firstDims);
    const firstH = firstItem.orientation === "landscape" ? Math.min(...firstDims) : Math.max(...firstDims);
    const doc = new (getJsPDF())({ orientation: firstW>firstH?"landscape":"portrait", unit:"in", format:[firstW, firstH] });

    let placedAny = false;
    for (let i = 0; i < liveTicket.length; i++) {
      const item = liveTicket[i];
      const pages = previewPagesFor(item.frontFiles, item.printsPerSheet, item.sheetsNeeded);
      for (let pageIdx = 0; pageIdx < pages; pageIdx++) {
        const { canvas, widthIn, heightIn } = await renderHiResForItem(item, pageIdx);
        const orient = widthIn > heightIn ? "landscape" : "portrait";
        if (!placedAny) {
          doc.addImage(canvasToPrintJpeg(canvas), "JPEG", 0, 0, widthIn, heightIn);
          placedAny = true;
        } else {
          doc.addPage([widthIn, heightIn], orient);
          doc.addImage(canvasToPrintJpeg(canvas), "JPEG", 0, 0, widthIn, heightIn);
        }
      }
    }
    // Active job's back side (if any) — only the active item carries
    // backImage state. Per-item back support across the ticket would need
    // separate state per item; out of scope for this iteration.
    if (showBack && backImage) {
      const pdfW = orientedWIn, pdfH = orientedHIn;
      const pageOrient = pdfW>pdfH ? "landscape" : "portrait";
      const backCanvas = await renderHiResSheet(backImage, backRotation, 0);
      doc.addPage([pdfW, pdfH], pageOrient);
      doc.addImage(canvasToPrintJpeg(backCanvas), "JPEG", 0, 0, pdfW, pdfH);
    }
    const jobBlob = doc.output("blob");

    await ensureLogoPdfDataUrl();
    const orderDoc = new (getJsPDF())({ orientation:"portrait", unit:"in", format:"letter" });
    if (liveTicket.length === 1) {
      const currentPaper = paperTypes.find(p=>p.key===paperKey)||{label:paperKey};
      const [sw,sh] = PRESET_SHEETS[sheetKey] || [8.5,11];
      addOrderSheetPage(orderDoc, {
        jobType: "Paper Printing",
        details: [
          { label:"Paper:",      value: currentPaper.label },
          { label:"Sheet:",      value: `${sw}×${sh} in` },
          { label:"Print size:", value: `${prints.width}×${prints.height} in` },
          { label:"Qty:",        value: totalPrintQty },
          { label:"Sheets:",     value: sheetsNeeded },
        ],
        totals: [{ label:"Estimated total:", value:`$${totalPrice.toFixed(2)}` }],
        files: frontImage ? [frontImage.name || "front"] : [],
      });
    } else {
      // Reuse the multi-job layout we built for downloads.
      const groups = {};
      liveTicket.forEach(it => {
        const k = `${it.paperKey}:${it.sheetKey}`;
        if (!groups[k]) groups[k] = { totalSheets: 0 };
        groups[k].totalSheets += Number(it.sheetsNeeded) || 0;
      });
      Object.values(groups).forEach(g => { g.factor = getSheetDiscountFactor(g.totalSheets); });
      const jobs = liveTicket.map((it, idx) => {
        const paperLabel = paperTypes.find(p=>p.key===it.paperKey)?.label || it.paperKey;
        const sub = (it.perSheetTotal||0)*(it.sheetsNeeded||0);
        const factor = groups[`${it.paperKey}:${it.sheetKey}`].factor;
        return {
          subtitle: `${paperLabel} · ${it.sheetKey}`,
          details: [
            { label:"Paper:",      value: paperLabel },
            { label:"Sheet:",      value: it.sheetKey },
            { label:"Print size:", value: `${it.printWidth}×${it.printHeight} in` },
            { label:"Total prints:", value: it.totalPrintQty || 0 },
            { label:"Sheets:",     value: it.sheetsNeeded || 0 },
          ],
          files: (it.frontFiles||[]).map(f => `${f.name} (×${f.qty||0})`),
          subtotalLabel: `Job ${idx + 1} subtotal:`,
          subtotalValue: `$${(sub*factor).toFixed(2)}`,
        };
      });
      const sub = liveTicket.reduce((s, it) => s + (it.perSheetTotal||0)*(it.sheetsNeeded||0), 0);
      const total = liveTicket.reduce((s, it) => s + (it.perSheetTotal||0)*(it.sheetsNeeded||0)*groups[`${it.paperKey}:${it.sheetKey}`].factor, 0);
      const discAmt = Math.max(0, sub - total);
      const summary = [
        { label:"Total sheets:", value: String(liveTicket.reduce((s, it) => s + (it.sheetsNeeded||0), 0)) },
        { label:"Subtotal:", value: `$${sub.toFixed(2)}` },
        ...(discAmt > 0.0001 ? [{ label:"Combined volume discount:", value: `-$${discAmt.toFixed(2)}` }] : []),
        { label:"Ticket total:", value: `$${total.toFixed(2)}` },
      ];
      const firstSku = skuMap[`${liveTicket[0].paperKey}:${liveTicket[0].sheetKey}`] || liveTicket[0].paperKey;
      addTicketOrderSheetPage(orderDoc, { jobs, summary, barcodeValue: firstSku });
    }
    await sendOrderEmail("sheets", jobBlob, orderDoc.output("blob"));
  };

  const orderLargeFormatJob = async () => {
    if (!lfImage) { alert("Please upload a large format image first."); return; }
    const pdfW=lfWidth, pdfH=lfHeight;
    const doc = new (getJsPDF())({ orientation:pdfW>=pdfH?"landscape":"portrait", unit:"in", format:[pdfW,pdfH] });
    const img = await fileToImage(lfImage);
    const hiRes = renderSingleImageCanvas(img, pdfW, pdfH, { dpi: PRINT_DPI_LF, fill: "stretch" });
    doc.addImage(canvasToPrintJpeg(hiRes), "JPEG", 0, 0, pdfW, pdfH);
    const jobBlob = doc.output("blob");
    await ensureLogoPdfDataUrl();
    const orderDoc = new (getJsPDF())({ orientation:"portrait", unit:"in", format:"letter" });
    const lfPaper = lfPaperTypes.find(p=>p.key===lfPaperKey)||{label:lfPaperKey};
    addOrderSheetPage(orderDoc,{ jobType:"Large Format", details:[{label:"Paper:",value:lfPaper.label},{label:"Size:",value:`${lfWidth}×${lfHeight} in`},{label:"Color:",value:lfColorMode==="bw"?"B/W":"Color"}], totals:[{label:"Estimated total:",value:`$${lfTotalWithDiscount.toFixed(2)}`}], files:lfImage?[lfImage.name||"artwork"]:[] });
    await sendOrderEmail("large-format", jobBlob, orderDoc.output("blob"));
  };

  const orderBlueprintJob = async () => {
    const orderDoc = new (getJsPDF())({ orientation:"portrait", unit:"in", format:"letter" });
    await ensureLogoPdfDataUrl();
    addOrderSheetPage(orderDoc,{ jobType:"Blueprints", details:[{label:"Size:",value:bpSizeObj.label},{label:"Quantity:",value:bpQty}], totals:[{label:"Estimated total:",value:`$${bpTotal.toFixed(2)}`}], files:bpFile?[bpFile.name]:[] });
    const jobBlob = orderDoc.output("blob");
    await sendOrderEmail("blueprints", jobBlob, null);
  };

  // ─── COMPLETE SALE FLOW ─────────────────────────────────
  // Build a transaction-ready snapshot for the active tab. base / upsell
  // are split per the employee's claim toggles. Returns null for tabs
  // that don't participate (Impose).
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const buildSaleSnapshot = () => {
    if (activeTab === "paper") {
      const liveTicket = ticket.map((it, i) => i === activeTicketIdx ? packEditorAsItem() : it);
      const groups = {};
      liveTicket.forEach(it => {
        const k = `${it.paperKey}:${it.sheetKey}`;
        if (!groups[k]) groups[k] = { totalSheets: 0 };
        groups[k].totalSheets += Number(it.sheetsNeeded) || 0;
      });
      Object.values(groups).forEach(g => { g.factor = getSheetDiscountFactor(g.totalSheets); });
      let base = 0, upsell = 0;
      const lineItems = liveTicket.map((it, idx) => {
        const factor = groups[`${it.paperKey}:${it.sheetKey}`].factor;
        const sub = (it.perSheetTotal || 0) * (it.sheetsNeeded || 0);
        const lineTotal = sub * factor;
        if (it.upsellPaper) upsell += lineTotal; else base += lineTotal;
        const paperLabel = paperTypes.find(p => p.key === it.paperKey)?.label || it.paperKey;
        return {
          kind: "sheet_line",
          jobNumber: idx + 1,
          paperKey: it.paperKey,
          paperLabel,
          sheetKey: it.sheetKey,
          printSize: `${it.printWidth}x${it.printHeight}`,
          orientation: it.orientation,
          colorMode: it.frontColorMode,
          sides: it.showBack ? "Front + Back" : "Single-sided",
          quantity: it.totalPrintQty || 0,
          sheetsNeeded: it.sheetsNeeded || 0,
          perSheet: round2(it.perSheetTotal),
          appliedDiscountPercent: Number(((1 - factor) * 100).toFixed(3)),
          lineTotal: round2(lineTotal),
          upsell: !!it.upsellPaper,
          files: (it.frontFiles || []).map(f => ({ name: f.name, qty: f.qty })),
        };
      });
      return {
        serviceType: "sheets",
        total: round2(base + upsell),
        baseSubtotal: round2(base),
        upsellSubtotal: round2(upsell),
        lineItems,
      };
    }
    if (activeTab === "large") {
      const factor = lfDiscountFactor;
      const paperCost     = lfBase * factor;
      const grommetsCost  = (lfGrommets ? (lfAddonPricing.grommetEach || 0) * (lfGrommetCount || 0) : 0) * factor;
      const foamCoreCost  = (lfFoamCore ? (lfAddonPricing.foamCore || 0) : 0) * factor;
      let base = 0, upsell = 0;
      const lineItems = [];
      lineItems.push({
        kind: "lf_media",
        paperKey: lfPaperKey,
        paperLabel: lfPaperTypes.find(p => p.key === lfPaperKey)?.label || lfPaperKey,
        width: lfWidth, height: lfHeight,
        areaSqFt: Number(lfAreaSqFt.toFixed(3)),
        colorMode: lfColorMode,
        lineTotal: round2(paperCost),
        upsell: !!lfUpsellPaper,
      });
      if (lfUpsellPaper) upsell += paperCost; else base += paperCost;
      if (lfGrommets) {
        lineItems.push({
          kind: "lf_addon", name: "Grommets",
          count: lfGrommetCount, lineTotal: round2(grommetsCost),
          upsell: !!lfUpsellGrommets,
        });
        if (lfUpsellGrommets) upsell += grommetsCost; else base += grommetsCost;
      }
      if (lfFoamCore) {
        lineItems.push({
          kind: "lf_addon", name: "Foam Core",
          lineTotal: round2(foamCoreCost), upsell: !!lfUpsellFoamCore,
        });
        if (lfUpsellFoamCore) upsell += foamCoreCost; else base += foamCoreCost;
      }
      return {
        serviceType: "large_format",
        total: round2(base + upsell),
        baseSubtotal: round2(base),
        upsellSubtotal: round2(upsell),
        lineItems,
      };
    }
    if (activeTab === "blueprint") {
      return {
        serviceType: "blueprints",
        total: round2(bpTotal),
        baseSubtotal: round2(bpTotal),
        upsellSubtotal: 0,
        lineItems: [{
          kind: "blueprint",
          sizeKey: bpSizeKey,
          label: bpSizeObj.label,
          width: bpWidth, height: bpHeight,
          quantity: bpQty,
          perSheet: Number(bpPerSheet.toFixed(4)),
          lineTotal: round2(bpTotal),
          upsell: false,
        }],
      };
    }
    return null;
  };

  const resetActiveTabForNextSale = () => {
    if (activeTab === "paper") {
      const fresh = createEmptyJob({ paperKey: paperTypes[0]?.key || paperKey, sheetKey: "8.5x11" });
      isLoadingFromTicketRef.current = true;
      setTicket([fresh]);
      setActiveTicketIdx(0);
      applyJobToEditor(fresh);
      setFrontImage(null);
      setSelectedFrontId(null);
      setFrontPreviewPage(0);
    } else if (activeTab === "large") {
      setLfImage(null);
      setLfGrommets(false);
      setLfFoamCore(false);
      setLfUpsellPaper(false);
      setLfUpsellGrommets(false);
      setLfUpsellFoamCore(false);
    } else if (activeTab === "blueprint") {
      setBpFile(null);
    }
  };

  const requestCompleteSale = () => {
    if (!isSupabaseConfigured) { alert("Sales database isn't configured."); return; }
    if (!currentEmployee) {
      alert("Sign in with your PIN before completing a sale.");
      setShowEmployeeLogin(true);
      return;
    }
    const snapshot = buildSaleSnapshot();
    if (!snapshot) { alert("This tab can't log sales yet."); return; }
    if (!snapshot.total || snapshot.total <= 0) { alert("Nothing to sell yet — add some prints first."); return; }
    setPendingSale({ snapshot, employee: currentEmployee, settings: commissionSettings });
  };

  const confirmCompleteSale = async (notes = "") => {
    if (!pendingSale || completingSale) return;
    setCompletingSale(true);
    try {
      const { snapshot, employee, settings } = pendingSale;
      const c = computeCommission(snapshot.baseSubtotal, snapshot.upsellSubtotal, settings);
      const row = {
        employee_id: employee.id,
        employee_name: employee.name,
        total: c.total,
        base_subtotal: c.base_subtotal,
        upsell_subtotal: c.upsell_subtotal,
        base_commission: c.base_commission,
        upsell_commission: c.upsell_commission,
        total_commission: c.total_commission,
        line_items: snapshot.lineItems,
        service_type: snapshot.serviceType,
        notes: (notes || "").trim() || null,
      };
      const result = await saveTransactionWithFallback(row, insertTransaction);
      setPendingSale(null);
      if (result.ok) {
        fireConfetti();
        setSavedJobToast(`Sale logged. You earned $${c.total_commission.toFixed(2)} commission.`);
      } else {
        setSavedJobToast("Sale logged locally — will sync when connection returns.");
      }
      setTimeout(() => setSavedJobToast(""), 4000);
      setPendingSalesCount(loadPendingTransactions().length);
      resetActiveTabForNextSale();
    } finally {
      setCompletingSale(false);
    }
  };

  // ─── ADMIN ACTIONS ──────────────────────────────────────

  const handleAdminClick = () => {
    if (!isAdmin) {
      const pwd = window.prompt("Enter admin password");
      if (pwd==="store4979") { setIsAdmin(true); setShowAdmin(true); }
      else alert("Incorrect password.");
    } else {
      setShowAdmin(v => !v);
    }
  };

  const exportPricingJson = () => {
    const json = { paperTypes, sheetKeysForPaper, lfPaperTypes, sheetPricing:pricing, lfPricing, sheetQtyDiscounts:quantityDiscounts, lfQtyDiscounts:lfQuantityDiscounts, sheetMarkupPerPaper:markupPerPaper, lfMarkupPerPaper, skuMap, backSideFactor, lfAddonPricing, blueprintPricing:bpPricing, previewMargin, previewSpacing, upsellFlags, signs365Pricing: signs365Overrides };
    const blob = new Blob([JSON.stringify(json,null,2)],{type:"application/json"});
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download="pricing.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
  };

  const importPricingJson = (file) => {
    const r = new FileReader();
    r.onload = (e) => {
try {
        const json = JSON.parse(e.target.result);
        if (json.paperTypes)       { setPaperTypes(json.paperTypes);       localStorage.setItem(LS.PAPER_TYPES,JSON.stringify(json.paperTypes)); }
        if (json.sheetKeysForPaper){ setSheetKeysForPaper(json.sheetKeysForPaper); localStorage.setItem(LS.SHEET_KEYS,JSON.stringify(json.sheetKeysForPaper)); }
        if (json.lfPaperTypes)     { setLfPaperTypes(json.lfPaperTypes);   localStorage.setItem(LS.LF_PAPER_TYPES,JSON.stringify(json.lfPaperTypes)); }
        if (json.sheetPricing) { setPricing(json.sheetPricing); localStorage.setItem(LS.PRICING,JSON.stringify(json.sheetPricing)); }
        if (json.lfPricing)    { setLfPricing(json.lfPricing);  localStorage.setItem(LS.LF_PRICING,JSON.stringify(json.lfPricing)); }
        const sheetDisc = json.sheetQtyDiscounts || json.quantityDiscounts;
        if (sheetDisc) setQuantityDiscounts(sheetDisc);
        const lfDisc = json.lfQtyDiscounts || json.lfQuantityDiscounts;
        if (lfDisc) setLfQuantityDiscounts(lfDisc);
        if (json.sheetMarkupPerPaper) {
          const m = {}; Object.entries(json.sheetMarkupPerPaper).forEach(([k,v]) => { m[k] = Number(v)||0; });
          setMarkupPerPaper(m);
        }
        if (json.lfMarkupPerPaper) {
          const m = {}; Object.entries(json.lfMarkupPerPaper).forEach(([k,v]) => { m[k] = Number(v)||0; });
          setLfMarkupPerPaper(m);
        }
        if (json.skuMap && typeof json.skuMap === "object") setSkuMap(json.skuMap);
        if (typeof json.backSideFactor==="number") setBackSideFactor(json.backSideFactor);
        if (json.lfAddonPricing) setLfAddonPricing(json.lfAddonPricing);
        if (json.blueprintPricing){ setBpPricing(json.blueprintPricing); localStorage.setItem(LS.BP_PRICING,JSON.stringify(json.blueprintPricing)); }
        if (typeof json.previewMargin==="number")  setPreviewMargin(json.previewMargin);
        if (typeof json.previewSpacing==="number") setPreviewSpacing(json.previewSpacing);
        if (json.upsellFlags && typeof json.upsellFlags === "object") setUpsellFlags(json.upsellFlags);
        if (json.signs365Pricing && typeof json.signs365Pricing === "object") setSigns365Overrides(json.signs365Pricing);
        alert("Pricing imported successfully.");
      } catch { alert("Invalid pricing.json file."); }
    };
    r.readAsText(file);
  };

  // ─── TRAINING DRAWER HOOK ───────────────────────────────
  // Receives a scenario `apply` config from TrainingDrawer.jsx and
  // pre-fills the live calculator. Field names follow the drawer's
  // schema; setter names below were verified against the actual
  // App.jsx state (a few diverged from the integration guide:
  //   colorMode    → setFrontColorMode
  //   backEnabled  → setShowBack
  //   grommetQty   → setLfGrommetCount + setLfGrommets(true)
  //   bpWidth/bpHeight → resolved into setBpSizeKey via BLUEPRINT_SIZES
  // lfQuantity, imposeTool, finishedW/H, totalPages, copies,
  // numberStart are intentionally ignored — those tools own their
  // own internal state per the integration note).
  const applyScenario = useCallback((cfg) => {
    if (!cfg || typeof cfg !== "object") return;

    if (cfg.viewMode) setViewMode(cfg.viewMode);
    if (cfg.tab)      { setActiveTab(cfg.tab); setViewMode("tool"); }

    // Sheets & Photos
    if (cfg.printW != null || cfg.printH != null || cfg.quantity != null) {
      setPrints((prev) => ({
        ...prev,
        ...(cfg.printW   != null ? { width:    Number(cfg.printW)   } : {}),
        ...(cfg.printH   != null ? { height:   Number(cfg.printH)   } : {}),
        ...(cfg.quantity != null ? { quantity: Number(cfg.quantity) } : {}),
      }));
    }
    if (cfg.paperKey)            setPaperKey(cfg.paperKey);
    if (cfg.sheetKey)            setSheetKey(cfg.sheetKey);
    if (cfg.colorMode)           setFrontColorMode(cfg.colorMode);
    if (cfg.backEnabled != null) setShowBack(!!cfg.backEnabled);

    // Large Format
    if (cfg.lfWidth   != null) setLfWidth(Number(cfg.lfWidth));
    if (cfg.lfHeight  != null) setLfHeight(Number(cfg.lfHeight));
    if (cfg.lfPaperKey)        setLfPaperKey(cfg.lfPaperKey);
    if (cfg.grommetQty != null && cfg.grommetQty > 0) {
      setLfGrommets(true);
      setLfGrommetCount(Number(cfg.grommetQty));
    }
    // lfQuantity has no matching state (LF is single-image) — ignored.

    // Blueprints — translate raw W×H into the closest preset size key.
    if (cfg.bpWidth != null && cfg.bpHeight != null) {
      const w = Number(cfg.bpWidth), h = Number(cfg.bpHeight);
      const match =
        BLUEPRINT_SIZES.find((s) => s.w === w && s.h === h) ||
        BLUEPRINT_SIZES.find((s) => Math.min(s.w, s.h) === Math.min(w, h)
                                 && Math.max(s.w, s.h) === Math.max(w, h));
      if (match) setBpSizeKey(match.key);
    }
    if (cfg.bpQty != null) setBpQty(Number(cfg.bpQty));

    // Quick Quote
    if (cfg.quotePrintW         != null) setQuotePrintW(Number(cfg.quotePrintW));
    if (cfg.quotePrintH         != null) setQuotePrintH(Number(cfg.quotePrintH));
    if (cfg.quoteQty            != null) setQuoteQty(Number(cfg.quoteQty));
    if (cfg.quoteFrontColorMode)         setQuoteFrontColorMode(cfg.quoteFrontColorMode);
    if (cfg.quoteBackEnabled    != null) setQuoteBackEnabled(!!cfg.quoteBackEnabled);
    if (cfg.quoteShowAllPapers  != null) setQuoteShowAllPapers(!!cfg.quoteShowAllPapers);

    // Specialty / Signs365 — local state lives inside SpecialtyTab,
    // so we hand the config off via a CustomEvent. SpecialtyTab
    // listens (same pattern it already uses for the admin
    // "signs365PricingUpdated" event) and seeds itself.
    if (cfg.specialty && typeof window !== "undefined") {
      try {
        window.dispatchEvent(new CustomEvent("specialtyApplyScenario", { detail: cfg.specialty }));
      } catch {}
    }

    // Impose / BookletMaker / DataMerge: scenarios just switch tabs;
    // no deeper prefill (those tools own their internal state).
  }, []);

  const currentPaper = paperTypes.find(p=>p.key===paperKey)||{label:paperKey,sheets:[]};
  const comboAllowed = (sheetKeysForPaper[paperKey]||[]).includes(sheetKey);
  const effectiveQty = frontFiles.length ? frontFiles.reduce((s,f)=>s+(Number(f.qty)||0),0) : (Number(prints.quantity)||0);

  // ─── RENDER ─────────────────────────────────────────────

  return (
    <div className="app-shell">

      {/* ── HEADER ──────────────────────────────────────── */}
      <header className="app-header">
        <div className="app-header-inner">
          <div className="header-logo">
            <div className="header-logo-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
              </svg>
            </div>
            <div>
              <div className="header-logo-text-primary">Print Calculator</div>
              <div className="header-logo-text-sub">The UPS Store #4979</div>
            </div>
          </div>
          <div className="header-actions">
            {isSupabaseConfigured && pendingSalesCount > 0 && (
              <button
                type="button"
                className="emp-pending-badge"
                onClick={retryPendingTransactions}
                title="Click to retry syncing"
              >
                ⏳ {pendingSalesCount} pending
              </button>
            )}
            {isSupabaseConfigured && (
              currentEmployee ? (
                <>
                  <span className="emp-badge" title={`Signed in as ${currentEmployee.name}`}>
                    <span className="emp-badge-dot" aria-hidden="true" />
                    <span className="emp-badge-name">{currentEmployee.name}</span>
                    <button type="button" className="emp-badge-switch" onClick={switchEmployee}>
                      Switch
                    </button>
                  </span>
                  <button
                    type="button"
                    className="pc-btn pc-btn-secondary pc-btn-sm"
                    onClick={() => setShowMyNumbers(true)}
                    style={{ gap: 6 }}
                    title="See your sales and commission"
                  >
                    📊 My Numbers
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="emp-badge-empty"
                  onClick={() => setShowEmployeeLogin(true)}
                  title="Sign in with your 4-digit PIN"
                >
                  Sign in
                </button>
              )
            )}
            <button
              className="pc-btn pc-btn-secondary pc-btn-sm"
              onClick={() => setViewMode(v => v==="quote"?"tool":"quote")}
              style={{ gap:6 }}
            >
              <Icon.Quote />
              Quick Quote
            </button>
            {isSupabaseConfigured && (
              <button
                className="pc-btn pc-btn-secondary pc-btn-sm"
                onClick={openJobHistory}
                style={{ gap:6 }}
                title="View saved print jobs"
              >
                📋 Job History
              </button>
            )}
            <button className="pc-btn pc-btn-admin" onClick={handleAdminClick} style={{ display:"flex", alignItems:"center", gap:5 }}>
              <Icon.Admin />
              {isAdmin && showAdmin ? "Close Admin" : "Admin"}
            </button>
          </div>
        </div>
      </header>

      {/* ── SERVICE TABS ────────────────────────────────── */}
      <nav className="service-nav">
        <div className="service-nav-inner">
          <div className="service-nav-label">What are you printing?</div>
          <div className="service-tabs">
            {[
  { id:"paper",     label:"Sheets & Photos", icon:<Icon.Printer />, pill:"🖨",  pillBg:"#e0f4f7", activeColor:"var(--teal)" },
  { id:"large",     label:"Large Format",    icon:<Icon.Ruler />,   pill:"📐",  pillBg:"#fef3c7", activeColor:"var(--amber)" },
  { id:"blueprint", label:"Blueprints",      icon:<Icon.Blueprint/>,pill:"📋",  pillBg:"#dbeafe", activeColor:"var(--blue)"  },
  { id:"specialty", label:"Specialty",       icon:<Icon.Ruler />,   pill:"🪧",  pillBg:"#f3e8ff", activeColor:"var(--purple)" },
  { id:"impose",    label:"Impose",          icon:<BookletIcon />,  pill:"📖",  pillBg:"#dcfce7", activeColor:"var(--green)" },
].map(tab => (
              <button
                key={tab.id}
                className={`service-tab ${activeTab===tab.id ? (tab.id==="paper"?"active":tab.id==="large"?"active active-amber":tab.id==="impose"?"active active-green":tab.id==="specialty"?"active active-purple":"active active-blue") : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="tab-icon-pill" data-tooltip={tab.label} style={{ background: activeTab===tab.id ? pillActiveBg(tab.id) : tab.pillBg }}>{tab.pill}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="content-wrap">

        {/* ════════════════════════════════════════
            QUICK QUOTE VIEW
        ════════════════════════════════════════ */}
        {viewMode==="quote" && (
          <div>
            <div className="pc-card" style={{ marginBottom:16 }}>
              <CardHeader step="?" title="Quick Quote — Sheet Printing" hint="Compare prices across paper types and sheet sizes" />
              <div className="pc-card-body">
                <div className="grid-3" style={{ marginBottom:14 }}>
                  <div>
                    <label className="field-label">Print width (in)</label>
                    <input className="pc-input" type="number" value={quotePrintW} min="0.5" step="0.25" onChange={e=>setQuotePrintW(+e.target.value||0)} />
                  </div>
                  <div>
                    <label className="field-label">Print height (in)</label>
                    <input className="pc-input" type="number" value={quotePrintH} min="0.5" step="0.25" onChange={e=>setQuotePrintH(+e.target.value||0)} />
                  </div>
                  <div>
                    <label className="field-label">Quantity</label>
                    <input className="pc-input" type="number" value={quoteQty} min="1" onChange={e=>setQuoteQty(+e.target.value||0)} />
                  </div>
                </div>
                <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginBottom:14 }}>
                  <div>
                    <label className="field-label">Front color</label>
                    <div className="chip-group">
                      <Chip label="Color" selected={quoteFrontColorMode==="color"} onClick={()=>setQuoteFrontColorMode("color")} />
                      <Chip label="B&W"   selected={quoteFrontColorMode==="bw"}    onClick={()=>setQuoteFrontColorMode("bw")} />
                    </div>
                  </div>
                  <div>
                    <div className="toggle-row" style={{ padding:0, border:0, gap:8 }}>
                      <span className="field-label" style={{ marginBottom:0 }}>Double-sided</span>
                      <Toggle checked={quoteBackEnabled} onChange={setQuoteBackEnabled} />
                    </div>
                  </div>
                  <div>
                    <div className="toggle-row" style={{ padding:0, border:0, gap:8 }}>
                      <span className="field-label" style={{ marginBottom:0 }}>All paper types</span>
                      <Toggle checked={quoteShowAllPapers} onChange={setQuoteShowAllPapers} />
                    </div>
                  </div>
                </div>
                <div style={{ overflowX:"auto", borderRadius:"var(--radius)", border:"1px solid var(--border)" }}>
                  <table className="quote-table">
                    <thead>
                      <tr>
                        <th>Paper</th>
                        <th>Sheet</th>
                        <th>Prints/Sheet</th>
                        <th>Sheets</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quoteRows.length===0 && (
                        <tr><td colSpan={5} style={{ textAlign:"center", padding:"20px", color:"var(--text-subtle)" }}>No pricing data. Check Admin panel.</td></tr>
                      )}
                      {quoteRows.map((row,i) => (
                        <tr key={i} className={row===bestQuote?"best-row":""}>
                          <td>{row.paperLabel} {row===bestQuote && <span className="badge badge-teal" style={{ marginLeft:6 }}>Best</span>}</td>
                          <td>{row.sheetKey}</td>
                          <td style={{ textAlign:"right" }}>{row.printsPer}</td>
                          <td style={{ textAlign:"right" }}>{row.sheets}</td>
                          <td style={{ textAlign:"right", fontWeight:600 }}>${row.total.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════
            ADMIN PANEL
        ════════════════════════════════════════ */}
        {isAdmin && showAdmin && (
          <div className="admin-section" style={{ marginBottom:16 }}>
            <div className="admin-section-header">⚙️ Admin Panel</div>
            <div className="admin-section-body">
              <div className="admin-view-tabs">
                <button
                  type="button"
                  className={`admin-view-tab ${adminView==="pricing" ? "is-active" : ""}`}
                  onClick={() => setAdminView("pricing")}
                >Pricing &amp; Setup</button>
                {isSupabaseConfigured && (
                  <button
                    type="button"
                    className={`admin-view-tab ${adminView==="commissions" ? "is-active" : ""}`}
                    onClick={() => setAdminView("commissions")}
                  >Commissions</button>
                )}
              </div>

              {adminView === "commissions" && isSupabaseConfigured && (
                <CommissionDashboard />
              )}

              {adminView === "pricing" && (<>
              <p style={{ fontSize:12, color:"var(--text-muted)", marginBottom:16 }}>
                Settings are stored in localStorage. Export to <code>pricing.json</code> and place in <code>public/</code> to deploy universally.
              </p>
              <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:16 }}>
                <button className="pc-btn pc-btn-secondary pc-btn-sm" onClick={exportPricingJson}>Export pricing.json</button>
                <label className="pc-btn pc-btn-secondary pc-btn-sm" style={{ cursor:"pointer" }}>
                  Import pricing.json
                  <input type="file" accept="application/json" style={{ display:"none" }} onChange={e=>{ if(e.target.files[0]) importPricingJson(e.target.files[0]); e.target.value=""; }} />
                </label>
              </div>
              <hr className="pc-divider" />

              {/* Upsell items */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Upsell-eligible items</div>
                <p style={{ fontSize:12, color:"var(--text-muted)", marginBottom:10 }}>
                  Items toggled on here will show an "⬆ Upsell" claim button to the employee at sale time. The claim itself defaults OFF — staff opts in only when they actively suggested the upgrade.
                </p>

                <div style={{ fontSize:12, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Sheet papers</div>
                <div className="upsell-flag-list">
                  {paperTypes.map(pt => (
                    <label key={pt.key} className="upsell-flag-row">
                      <input
                        type="checkbox"
                        checked={!!upsellFlags.paperTypes?.[pt.key]}
                        onChange={(e) => setUpsellFlags(prev => ({
                          ...prev,
                          paperTypes: { ...(prev.paperTypes||{}), [pt.key]: e.target.checked },
                        }))}
                      />
                      <span>{pt.label}</span>
                      <span style={{ color:"var(--text-muted)", fontSize:11 }}>({pt.key})</span>
                    </label>
                  ))}
                </div>

                <div style={{ fontSize:12, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"12px 0 6px" }}>Large format media</div>
                <div className="upsell-flag-list">
                  {lfPaperTypes.map(pt => (
                    <label key={pt.key} className="upsell-flag-row">
                      <input
                        type="checkbox"
                        checked={!!upsellFlags.lfPaperTypes?.[pt.key]}
                        onChange={(e) => setUpsellFlags(prev => ({
                          ...prev,
                          lfPaperTypes: { ...(prev.lfPaperTypes||{}), [pt.key]: e.target.checked },
                        }))}
                      />
                      <span>{pt.label}</span>
                      <span style={{ color:"var(--text-muted)", fontSize:11 }}>({pt.key})</span>
                    </label>
                  ))}
                </div>

                <div style={{ fontSize:12, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"12px 0 6px" }}>Large format add-ons</div>
                <div className="upsell-flag-list">
                  <label className="upsell-flag-row">
                    <input
                      type="checkbox"
                      checked={!!upsellFlags.lfAddons?.grommets}
                      onChange={(e) => setUpsellFlags(prev => ({
                        ...prev,
                        lfAddons: { ...(prev.lfAddons||{}), grommets: e.target.checked },
                      }))}
                    />
                    <span>Grommets</span>
                  </label>
                  <label className="upsell-flag-row">
                    <input
                      type="checkbox"
                      checked={!!upsellFlags.lfAddons?.foamCore}
                      onChange={(e) => setUpsellFlags(prev => ({
                        ...prev,
                        lfAddons: { ...(prev.lfAddons||{}), foamCore: e.target.checked },
                      }))}
                    />
                    <span>Foam Core</span>
                  </label>
                </div>
              </div>
              <hr className="pc-divider" />

              {/* Preview Layout Settings */}
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Preview Layout</div>
                <div className="grid-2">
                  <div>
                    <label className="field-label">Margin (in) — default {DEFAULT_MARGIN_IN}"</label>
                    <input className="pc-input" type="number" step="0.0625" min="0" max="1" value={previewMargin} onChange={e=>setPreviewMargin(+e.target.value||0)} />
                  </div>
                  <div>
                    <label className="field-label">Spacing (in) — default {DEFAULT_SPACING_IN}"</label>
                    <input className="pc-input" type="number" step="0.0625" min="0" max="1" value={previewSpacing} onChange={e=>setPreviewSpacing(+e.target.value||0)} />
                  </div>
                </div>
                <button className="pc-btn pc-btn-secondary pc-btn-xs" style={{ marginTop:8 }} onClick={()=>{ setPreviewMargin(DEFAULT_MARGIN_IN); setPreviewSpacing(DEFAULT_SPACING_IN); }}>Reset to defaults</button>
              </div>
              <hr className="pc-divider" />

              {/* Back-side factor */}
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>Back-side Price Factor</div>
                <p style={{ fontSize:12, color:"var(--text-muted)", marginBottom:8 }}>Multiplier for back printing cost. 0.5 = half price of front.</p>
                <input className="pc-input" style={{ width:120 }} type="number" step="0.05" min="0" max="1" value={backSideFactor} onChange={e=>setBackSideFactor(+e.target.value||0)} />
              </div>
              <hr className="pc-divider" />

              {/* Sheet Pricing */}
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Sheet Pricing (per sheet)</div>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                    <thead>
                      <tr style={{ background:"var(--surface-3)" }}>
<th style={{ padding:"6px 10px", textAlign:"left", fontWeight:600, color:"var(--text-muted)", fontSize:11 }}>Paper</th>
                        <th style={{ padding:"6px 10px", textAlign:"left", fontWeight:600, color:"var(--text-muted)", fontSize:11 }}>Sheet</th>
                        <th style={{ padding:"6px 10px", textAlign:"right", fontWeight:600, color:"var(--text-muted)", fontSize:11 }}>Cost Color</th>
                        <th style={{ padding:"6px 10px", textAlign:"right", fontWeight:600, color:"var(--text-muted)", fontSize:11 }}>Cost B&W</th>
                        <th style={{ padding:"6px 10px", textAlign:"right", fontWeight:600, color:"var(--text-muted)", fontSize:11 }}>Sell Color</th>
                        <th style={{ padding:"6px 10px", textAlign:"right", fontWeight:600, color:"var(--text-muted)", fontSize:11 }}>Sell B&W</th>
                        <th style={{ padding:"6px 10px", textAlign:"right", fontWeight:600, color:"var(--text-muted)", fontSize:11 }}>Markup %</th>
                      </tr>
                    </thead>
                    <tbody>
{paperTypes.map(pt => (sheetKeysForPaper[pt.key]||[]).map(sk => {
                        const entry = normalizeEntry((pricing[pt.key]||{})[sk]||{});
                        return (
                          <tr key={`${pt.key}-${sk}`} style={{ borderTop:"1px solid var(--border)" }}>
                            <td style={{ padding:"5px 10px", color:"var(--text-muted)", fontSize:11 }}>{pt.label}</td>
                            <td style={{ padding:"5px 10px", fontWeight:500 }}>{sk}</td>
                            <td style={{ padding:"5px 10px", textAlign:"right" }}>
                              <input className="admin-input" type="number" step="0.0001" style={{ width:70 }} value={entry.baseCostColor}
                                onChange={e=>{ const v=+e.target.value||0; setPricing(prev=>{ const n={...prev}; if(!n[pt.key])n[pt.key]={}; n[pt.key][sk]={...normalizeEntry(n[pt.key][sk]||{}),baseCostColor:v}; return n; }); }} />
                            </td>
                            <td style={{ padding:"5px 10px", textAlign:"right" }}>
                              <input className="admin-input" type="number" step="0.0001" style={{ width:70 }} value={entry.baseCostBW}
                                onChange={e=>{ const v=+e.target.value||0; setPricing(prev=>{ const n={...prev}; if(!n[pt.key])n[pt.key]={}; n[pt.key][sk]={...normalizeEntry(n[pt.key][sk]||{}),baseCostBW:v}; return n; }); }} />
                            </td>
                            <td style={{ padding:"5px 10px", textAlign:"right" }}>
                              <input className="admin-input" type="number" step="0.0001" style={{ width:70 }} value={entry.priceColor}
                                onChange={e=>{ const v=+e.target.value||0; setPricing(prev=>{ const n={...prev}; if(!n[pt.key])n[pt.key]={}; n[pt.key][sk]={...normalizeEntry(n[pt.key][sk]||{}),priceColor:v}; return n; }); }} />
                            </td>
                            <td style={{ padding:"5px 10px", textAlign:"right" }}>
                              <input className="admin-input" type="number" step="0.0001" style={{ width:70 }} value={entry.priceBW}
                                onChange={e=>{ const v=+e.target.value||0; setPricing(prev=>{ const n={...prev}; if(!n[pt.key])n[pt.key]={}; n[pt.key][sk]={...normalizeEntry(n[pt.key][sk]||{}),priceBW:v}; return n; }); }} />
                            </td>
                            <td style={{ padding:"5px 10px", textAlign:"right" }}>
                              <input className="admin-input" type="number" step="1" style={{ width:55 }} value={markupPerPaper[pt.key]||0}
                                onChange={e=>setMarkupPerPaper(prev=>({...prev,[pt.key]:+e.target.value||0}))} />
                            </td>
                          </tr>
                        );
                      }))}
                    </tbody>
                  </table>
                </div>
              </div>
              <hr className="pc-divider" />

              <hr className="pc-divider" />

              {/* Manage Sheet Paper Types */}
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Manage Sheet Paper Types</div>
                
                {/* Existing paper types with delete */}
                <div style={{ marginBottom:12 }}>
{paperTypes.map(pt => (
                    <div key={pt.key} style={{
                      padding:"8px 10px", marginBottom:6,
                      background:"var(--surface-2)", borderRadius:"var(--radius-sm)",
                      border:"1px solid var(--border)", fontSize:12,
                    }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                        <div style={{ flex:1 }}>
                          <strong>{pt.label}</strong>
                          <span style={{ color:"var(--text-muted)", marginLeft:8 }}>({pt.key})</span>
                        </div>
                        {/* Toggle sheet sizes */}
                        <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
                          {Object.keys(PRESET_SHEETS).map(sk => {
                            const active = (sheetKeysForPaper[pt.key]||[]).includes(sk);
                            return (
                              <button key={sk}
                                className={`pc-btn pc-btn-xs ${active ? "pc-btn-primary" : "pc-btn-secondary"}`}
                                style={{ fontSize:10, padding:"2px 6px" }}
                                onClick={()=>{
                                  setSheetKeysForPaper(prev => {
                                    const n = {...prev};
                                    const arr = [...(n[pt.key]||[])];
                                    if (active) { n[pt.key] = arr.filter(s=>s!==sk); }
                                    else { arr.push(sk); n[pt.key] = arr; }
                                    return n;
                                  });
                                }}
                              >{sk}</button>
                            );
                          })}
                        </div>
                        <button
                          className="pc-btn pc-btn-xs"
                          style={{ background:"#fee2e2", color:"#dc2626", border:"none" }}
                          onClick={()=>{
                            if (!window.confirm(`Delete "${pt.label}"? This will remove all pricing for this paper type.`)) return;
                            setPaperTypes(prev => prev.filter(p=>p.key!==pt.key));
                            setSheetKeysForPaper(prev => { const n={...prev}; delete n[pt.key]; return n; });
                            setPricing(prev => { const n={...prev}; delete n[pt.key]; return n; });
                            setMarkupPerPaper(prev => { const n={...prev}; delete n[pt.key]; return n; });
                            setSkuMap(prev => { const n={...prev}; Object.keys(n).filter(k=>k.startsWith(pt.key+":")).forEach(k=>delete n[k]); return n; });
                            if (paperKey===pt.key) setPaperKey(paperTypes[0]?.key||"");
                          }}
                        >✕</button>
                      </div>
                      {/* SKU per sheet size */}
                      {(sheetKeysForPaper[pt.key]||[]).length > 0 && (
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap", paddingLeft:4 }}>
                          {(sheetKeysForPaper[pt.key]||[]).map(sk => {
                            const skuKey = `${pt.key}:${sk}`;
                            return (
                              <div key={sk} style={{ display:"flex", alignItems:"center", gap:4, fontSize:11 }}>
                                <span style={{ color:"var(--text-muted)", minWidth:38 }}>{sk}:</span>
                                <input
                                  className="admin-input"
                                  type="text"
                                  placeholder="SKU #"
                                  value={skuMap[skuKey]||""}
                                  onChange={e=>setSkuMap(prev=>({...prev,[skuKey]:e.target.value}))}
                                  style={{ width:110, fontSize:11, height:26 }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                
                {/* Add new paper type */}
                <div style={{ display:"flex", gap:8, alignItems:"flex-end", flexWrap:"wrap", padding:"10px 12px", background:"var(--surface-3)", borderRadius:"var(--radius-sm)" }}>
                  <div>
                    <label className="field-label">Label</label>
                    <input className="admin-input" type="text" placeholder="e.g. 60lb Offset" value={newPaperLabel}
                      onChange={e=>{ setNewPaperLabel(e.target.value); setNewPaperKey(e.target.value.toLowerCase().replace(/[^a-z0-9]/g,"")); }} style={{ width:160 }} />
                  </div>
                  <div>
                    <label className="field-label">Key</label>
                    <input className="admin-input" type="text" placeholder="e.g. 60offset" value={newPaperKey}
                      onChange={e=>setNewPaperKey(e.target.value.replace(/[^a-z0-9_]/g,""))} style={{ width:120 }} />
                  </div>
                  <div>
                    <label className="field-label">Sheet sizes</label>
                    <div style={{ display:"flex", gap:3 }}>
                      {Object.keys(PRESET_SHEETS).map(sk => (
                        <button key={sk}
                          className={`pc-btn pc-btn-xs ${newPaperSheets[sk] ? "pc-btn-primary" : "pc-btn-secondary"}`}
                          style={{ fontSize:10, padding:"2px 6px" }}
                          onClick={()=>setNewPaperSheets(prev=>({...prev,[sk]:!prev[sk]}))}
                        >{sk}</button>
                      ))}
                    </div>
                  </div>
                  <button className="pc-btn pc-btn-primary pc-btn-xs" disabled={!newPaperKey || !newPaperLabel || paperTypes.some(p=>p.key===newPaperKey)}
                    onClick={()=>{
                      const sheets = Object.keys(newPaperSheets).filter(k=>newPaperSheets[k]);
                      if (!sheets.length) { alert("Select at least one sheet size."); return; }
                      const newPt = { key:newPaperKey, label:newPaperLabel };
                      setPaperTypes(prev => [...prev, newPt]);
                      setSheetKeysForPaper(prev => ({...prev, [newPaperKey]:sheets}));
                      setPricing(prev => {
                        const n = {...prev}; n[newPaperKey] = {};
                        sheets.forEach(sk => { n[newPaperKey][sk] = { baseCostColor:0, baseCostBW:0, priceColor:0, priceBW:0 }; });
                        return n;
                      });
                      setMarkupPerPaper(prev => ({...prev, [newPaperKey]:0}));
                      setNewPaperLabel(""); setNewPaperKey(""); setNewPaperSheets({});
                    }}
                  >+ Add Paper Type</button>
                </div>
              </div>

              {/* LF Pricing */}
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Large Format Pricing (per sq ft)</div>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                    <thead>
                      <tr style={{ background:"var(--surface-3)" }}>
                        <th style={{ padding:"6px 10px", textAlign:"left", fontWeight:600, color:"var(--text-muted)", fontSize:11 }}>Media</th>
                        <th style={{ padding:"6px 10px", textAlign:"right", fontWeight:600, color:"var(--text-muted)", fontSize:11 }}>Color $/sqft</th>
                        <th style={{ padding:"6px 10px", textAlign:"right", fontWeight:600, color:"var(--text-muted)", fontSize:11 }}>B&W $/sqft</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lfPaperTypes.map(pt => {
                        const entry = normalizeEntry(lfPricing[pt.key]||{});
                        return (
                          <tr key={pt.key} style={{ borderTop:"1px solid var(--border)" }}>
                            <td style={{ padding:"5px 10px", fontWeight:500 }}>{pt.label}</td>
                            <td style={{ padding:"5px 10px", textAlign:"right" }}>
                              <input className="admin-input" type="number" step="0.0001" style={{ width:80 }} value={entry.priceColor}
                                onChange={e=>{ const v=+e.target.value||0; setLfPricing(prev=>{ const n={...prev}; n[pt.key]={...normalizeEntry(n[pt.key]||{}),priceColor:v}; return n; }); }} />
                            </td>
                            <td style={{ padding:"5px 10px", textAlign:"right" }}>
                              <input className="admin-input" type="number" step="0.0001" style={{ width:80 }} value={entry.priceBW}
                                onChange={e=>{ const v=+e.target.value||0; setLfPricing(prev=>{ const n={...prev}; n[pt.key]={...normalizeEntry(n[pt.key]||{}),priceBW:v}; return n; }); }} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ display:"flex", gap:10, marginTop:12, flexWrap:"wrap" }}>
                  <div>
                    <label className="field-label">Grommet (per each) $</label>
                    <input className="pc-input" style={{ width:90 }} type="number" step="0.25" value={lfAddonPricing.grommetEach||0} onChange={e=>setLfAddonPricing(p=>({...p,grommetEach:+e.target.value||0}))} />
                  </div>
                  <div>
                    <label className="field-label">Foam Core (flat) $</label>
                    <input className="pc-input" style={{ width:90 }} type="number" step="0.5" value={lfAddonPricing.foamCore} onChange={e=>setLfAddonPricing(p=>({...p,foamCore:+e.target.value||0}))} />
                  </div>
                </div>
              </div>
              <hr className="pc-divider" />

              {/* Manage LF Paper Types */}
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Manage Large Format Media Types</div>
                
                {/* Existing LF paper types with delete */}
                <div style={{ marginBottom:12 }}>
                  {lfPaperTypes.map(pt => (
                    <div key={pt.key} style={{
                      display:"flex", alignItems:"center", gap:8, padding:"6px 10px",
                      marginBottom:4, background:"var(--surface-2)", borderRadius:"var(--radius-sm)",
                      border:"1px solid var(--border)", fontSize:12,
                    }}>
                      <div style={{ flex:1 }}>
                        <strong>{pt.label}</strong>
                        <span style={{ color:"var(--text-muted)", marginLeft:8 }}>({pt.key})</span>
                      </div>
                      <button
                        className="pc-btn pc-btn-xs"
                        style={{ background:"#fee2e2", color:"#dc2626", border:"none" }}
                        onClick={()=>{
                          if (!window.confirm(`Delete "${pt.label}"? This will remove all pricing for this media type.`)) return;
                          setLfPaperTypes(prev => prev.filter(p=>p.key!==pt.key));
                          setLfPricing(prev => { const n={...prev}; delete n[pt.key]; return n; });
                          setLfMarkupPerPaper(prev => { const n={...prev}; delete n[pt.key]; return n; });
                          if (lfPaperKey===pt.key) setLfPaperKey(lfPaperTypes[0]?.key||"");
                        }}
                      >✕</button>
                    </div>
                  ))}
                </div>
                
                {/* Add new LF paper type */}
                <div style={{ display:"flex", gap:8, alignItems:"flex-end", flexWrap:"wrap", padding:"10px 12px", background:"var(--surface-3)", borderRadius:"var(--radius-sm)" }}>
                  <div>
                    <label className="field-label">Label</label>
                    <input className="admin-input" type="text" placeholder="e.g. Matte Vinyl" value={newLfPaperLabel}
                      onChange={e=>{ setNewLfPaperLabel(e.target.value); setNewLfPaperKey(e.target.value.toLowerCase().replace(/[^a-z0-9]/g,"_").replace(/_+/g,"_")); }} style={{ width:200 }} />
                  </div>
                  <div>
                    <label className="field-label">Key</label>
                    <input className="admin-input" type="text" placeholder="e.g. matte_vinyl" value={newLfPaperKey}
                      onChange={e=>setNewLfPaperKey(e.target.value.replace(/[^a-z0-9_]/g,""))} style={{ width:160 }} />
                  </div>
                  <button className="pc-btn pc-btn-primary pc-btn-xs" disabled={!newLfPaperKey || !newLfPaperLabel || lfPaperTypes.some(p=>p.key===newLfPaperKey)}
                    onClick={()=>{
                      const newPt = { key:newLfPaperKey, label:newLfPaperLabel };
                      setLfPaperTypes(prev => [...prev, newPt]);
                      setLfPricing(prev => ({...prev, [newLfPaperKey]:{ baseCostColor:0, baseCostBW:0, priceColor:0, priceBW:0 }}));
                      setLfMarkupPerPaper(prev => ({...prev, [newLfPaperKey]:0}));
                      setNewLfPaperLabel(""); setNewLfPaperKey("");
                    }}
                  >+ Add Media Type</button>
                </div>
              </div>
              <hr className="pc-divider" />

              {/* Blueprint Pricing */}
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Blueprint Pricing ($/sqft by tier)</div>
                {BLUEPRINT_SIZES.map(s => {
                  const tiers = bpPricing[s.key]?.tiers || [];
                  return (
                    <div key={s.key} style={{ marginBottom:10 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:"var(--text-muted)", marginBottom:4 }}>{s.label}</div>
                      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                        {tiers.map((t,i) => (
                          <div key={i} style={{ display:"flex", alignItems:"center", gap:4, fontSize:12 }}>
                            <span style={{ color:"var(--text-muted)" }}>≤{t.maxQty??'∞'}</span>
                            <input className="admin-input" type="number" step="0.01" style={{ width:65 }} value={t.psf}
                              onChange={e=>{ const v=+e.target.value||0; setBpPricing(prev=>{ const n={...prev}; const ts=[...(n[s.key]?.tiers||[])]; ts[i]={...ts[i],psf:v}; n[s.key]={...n[s.key],tiers:ts}; return n; }); }} />
                            <span style={{ color:"var(--text-muted)" }}>/sqft</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <hr className="pc-divider" />

              {/* Quantity Discounts */}
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Sheet Quantity Discounts</div>
                {quantityDiscounts.map((row,idx) => (
                  <div key={idx} style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6, fontSize:12 }}>
                    <span style={{ color:"var(--text-muted)" }}>≥</span>
                    <input className="admin-input" type="number" style={{ width:70 }} value={row.minSheets} onChange={e=>setQuantityDiscounts(prev=>{const c=[...prev];c[idx]={...c[idx],minSheets:+e.target.value||0};return c;})} />
                    <span style={{ color:"var(--text-muted)" }}>sheets →</span>
                    <input className="admin-input" type="number" step="0.1" style={{ width:60 }} value={row.discountPercent} onChange={e=>setQuantityDiscounts(prev=>{const c=[...prev];c[idx]={...c[idx],discountPercent:+e.target.value||0};return c;})} />
                    <span style={{ color:"var(--text-muted)" }}>% off</span>
                    <button className="pc-btn pc-btn-xs" style={{ background:"#fee2e2",color:"#dc2626",border:"none" }} onClick={()=>setQuantityDiscounts(p=>p.filter((_,i)=>i!==idx))}>✕</button>
                  </div>
                ))}
                <button className="pc-btn pc-btn-secondary pc-btn-xs" style={{ marginTop:4 }} onClick={()=>setQuantityDiscounts(p=>[...p,{minSheets:0,discountPercent:0}])}>+ Add tier</button>
              </div>

              <hr className="pc-divider" />

              <Signs365PricingEditor
                overrides={signs365Overrides}
                setOverrides={setSigns365Overrides}
              />
              </>)}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════
            PANEL: SHEETS & PHOTOS
        ════════════════════════════════════════ */}
        {activeTab==="paper" && viewMode==="tool" && (
          <>
            <TicketBar
              ticket={ticket}
              ticketLines={ticketLines}
              ticketGroups={ticketGroups}
              activeTicketIdx={activeTicketIdx}
              ticketTotal={ticketTotal}
              ticketTotalSheets={ticketTotalSheets}
              ticketDiscountAmt={ticketDiscountAmt}
              paperTypes={paperTypes}
              onSwitch={switchToTicketIdx}
              onAdd={addJobToTicket}
              onRemove={removeJobFromTicket}
            />

            {/* Step 1 — Print Setup */}
            <div className="pc-card">
              <CardHeader step="1" title="Print Setup" hint="Sheet size, paper type &amp; color" />
              <div className="pc-card-body">

                {/* Sheet size chips */}
                <div style={{ marginBottom:16 }}>
                  <label className="field-label">Sheet size</label>
                  <div className="chip-group">
                    {Object.keys(PRESET_SHEETS).map(sk => (
                      <Chip key={sk} label={sk} selected={sheetKey===sk} onClick={()=>setSheetKey(sk)} />
                    ))}
                  </div>
                </div>

                <div className="grid-auto" style={{ marginBottom:16 }}>
                  <div>
                    <label className="field-label">Paper type</label>
                    <div className="pc-select-wrap">
                      <select className="pc-select" value={paperKey} onChange={e=>setPaperKey(e.target.value)}>
                        {paperTypes.map(pt => <option key={pt.key} value={pt.key}>{pt.label}</option>)}
                      </select>
                    </div>
                    {upsellFlags.paperTypes?.[paperKey] && (
                      <UpsellToggle
                        checked={!!ticket[activeTicketIdx]?.upsellPaper}
                        onChange={(v) => setTicket(prev => prev.map((it, i) =>
                          i === activeTicketIdx ? { ...it, upsellPaper: v } : it
                        ))}
                        label="Upsell"
                        tooltip="Mark this if you suggested this paper to the customer."
                      />
                    )}
                  </div>
                  <div>
                    <label className="field-label">Orientation</label>
                    <div className="chip-group">
                      <Chip label="Portrait"  selected={orientation==="portrait"}  onClick={()=>setOrientation("portrait")} />
                      <Chip label="Landscape" selected={orientation==="landscape"} onClick={()=>setOrientation("landscape")} />
                    </div>
                  </div>
                </div>

                {!comboAllowed && (
                  <div className="callout callout-warn" style={{ marginBottom:12 }}>
                    <span className="callout-icon"><Icon.Warn /></span>
                    {currentPaper.label} is not typically used on {sheetKey}. Double-check this combination.
                  </div>
                )}

                {/* Color mode */}
                <div style={{ display:"flex", gap:20, flexWrap:"wrap", marginBottom:16 }}>
                  <div>
                    <label className="field-label">Front color</label>
                    <div className="chip-group">
                      <Chip label="Color" selected={frontColorMode==="color"} onClick={()=>setFrontColorMode("color")} />
                      <Chip label="B&W"   selected={frontColorMode==="bw"}    onClick={()=>setFrontColorMode("bw")} />
                    </div>
                  </div>
                  {showBack && (
                    <div>
                      <label className="field-label">Back color</label>
                      <div className="chip-group">
                        <Chip label="Color" selected={backColorMode==="color"} onClick={()=>setBackColorMode("color")} />
                        <Chip label="B&W"   selected={backColorMode==="bw"}    onClick={()=>setBackColorMode("bw")} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Toggles */}
                <div>
                  <div className="toggle-row">
                    <div><div className="toggle-label-text">Double-sided</div><div className="toggle-label-sub">Print on front &amp; back</div></div>
                    <Toggle checked={showBack} onChange={setShowBack} />
                  </div>
                  <div className="toggle-row">
                    <div><div className="toggle-label-text">Show cut lines</div><div className="toggle-label-sub">Visible in preview only</div></div>
                    <Toggle checked={showCutLines} onChange={setShowCutLines} />
                  </div>
                  <div className="toggle-row">
                    <div><div className="toggle-label-text">Show margin guides</div></div>
                    <Toggle checked={showGuides} onChange={setShowGuides} />
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2 — Print Size & Qty */}
            <div className="pc-card">
              <CardHeader step="2" title="Print Size &amp; Quantity" hint="Target size of each individual print" />
              <div className="pc-card-body">
                <div className="grid-auto" style={{ marginBottom:14 }}>
                  <div>
                    <label className="field-label">Print width (in)</label>
                    <input className="pc-input" type="number" value={prints.width} min="0.25" step="0.25" onChange={e=>setPrints(p=>({...p,width:+e.target.value||0}))} />
                  </div>
                  <div>
                    <label className="field-label">Print height (in)</label>
                    <input className="pc-input" type="number" value={prints.height} min="0.25" step="0.25" onChange={e=>setPrints(p=>({...p,height:+e.target.value||0}))} />
                  </div>
                  {!frontFiles.length && (
                    <div>
                      <label className="field-label">Quantity</label>
                      <input className="pc-input" type="number" value={prints.quantity} min="1" onChange={e=>setPrints(p=>({...p,quantity:+e.target.value||0}))} />
                    </div>
                  )}
                  <div>
                    <label className="field-label">Fits per sheet</label>
                    <input className="pc-input pc-input-readonly" type="text" readOnly value={printsPerSheet} />
                  </div>
                  <div>
                    <label className="field-label">Sheets needed</label>
                    <input className="pc-input pc-input-readonly" type="text" readOnly value={sheetsNeeded} />
                  </div>
                </div>
                <div className="callout callout-info">
                  <span className="callout-icon"><Icon.Info /></span>
                  Layout is calculated automatically — we fit as many prints as possible per sheet using a {frontSlotInfo?.cols||0}×{frontSlotInfo?.rows||0} grid.
                </div>
              </div>
            </div>

            {/* Step 3 — Upload */}
            <div className="pc-card">
              <CardHeader
                step="3"
                title="Upload Files"
                hint="Drag &amp; drop images or PDFs"
                right={
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <label className="field-label" style={{ marginBottom:0 }}>Default qty</label>
                    <input
                      className="pc-input"
                      type="number"
                      style={{ width:70, height:34, fontSize:13 }}
                      value={copiesPerFile}
                      min="1"
                      onChange={e=>setCopiesPerFile(Math.max(1,+e.target.value||1))}
                    />
                  </div>
                }
              />
              <div className="pc-card-body">
                <input
                  ref={frontInputRef}
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  style={{ display:"none" }}
                  onChange={e=>{ if(e.target.files.length) handleFrontFiles(Array.from(e.target.files)); e.target.value=""; }}
                />
                <UploadZone
                  hasFile={frontFiles.length>0 || !!frontImage}
                  label={`${frontFiles.length} file${frontFiles.length!==1?"s":""} ready — drop more to add`}
                  subLabel="or click to browse"
                  types={["PNG","JPG","PDF"]}
                  onFiles={handleFrontFiles}
                  inputRef={frontInputRef}
                />

                {frontFiles.length>0 && (
                  <div className="file-list">
                    {frontFiles.map(f => {
                      const classes = [
                        "file-row",
                        selectedFrontId===f.id ? "selected" : "",
                        dragSourceId===f.id ? "is-dragging" : "",
                        dragOverId===f.id && dragSourceId && dragSourceId!==f.id ? "is-drop-target" : "",
                      ].filter(Boolean).join(" ");
                      return (
                      <div
                        key={f.id}
                        className={classes}
                        draggable
                        onDragStart={e => {
                          setDragSourceId(f.id);
                          e.dataTransfer.effectAllowed = "move";
                          try { e.dataTransfer.setData("text/plain", f.id); } catch {}
                        }}
                        onDragOver={e => {
                          if (!dragSourceId || dragSourceId === f.id) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (dragOverId !== f.id) setDragOverId(f.id);
                        }}
                        onDragLeave={() => { if (dragOverId === f.id) setDragOverId(null); }}
                        onDrop={e => {
                          e.preventDefault();
                          const src = dragSourceId || e.dataTransfer.getData("text/plain");
                          reorderFile(src, f.id);
                          setDragSourceId(null);
                          setDragOverId(null);
                        }}
                        onDragEnd={() => { setDragSourceId(null); setDragOverId(null); }}
                        onClick={()=>setSelectedFrontId(f.id)}
                        title="Drag to reorder"
                      >
                        <div className="file-thumb">{getFileExt(f.name)}</div>
                        <div className="file-info">
                          <div className="file-name">{f.name}</div>
                          <div className="file-meta">{f.rotation?`Rotated ${f.rotation}°`:""}</div>
                        </div>
                        <div className="file-qty-wrap">
                          <span className="file-qty-label">Qty</span>
                          <input
                            className="file-qty-input"
                            type="number"
                            value={f.qty}
                            min="0"
                            onClick={e=>e.stopPropagation()}
                            onChange={e=>updateFileQty(f.id, +e.target.value||0)}
                          />
                        </div>
                        <button className="file-action-btn rotate-btn" title="Rotate 90°" onClick={e=>{e.stopPropagation();rotateFile(f.id);}}>
                          <Icon.Rotate />
                        </button>
                        <button className="file-action-btn" title="Remove" onClick={e=>{e.stopPropagation();removeFile(f.id);}}>
                          <Icon.X />
                        </button>
                      </div>
                      );
                    })}
                  </div>
                )}

                {/* Back side upload (shown when double-sided is on) */}
{showBack && (
                  <div style={{ marginTop:16, paddingTop:16, borderTop:"1px solid var(--border)" }}>
                    <label className="field-label">Back side image</label>
                    <input
                      ref={backInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      style={{ display:"none" }}
                      onChange={e=>{ if(e.target.files[0]) handleBackFile([e.target.files[0]]); e.target.value=""; }}
                    />
                    <UploadZone
                      hasFile={!!backImage}
                      label={backImage ? (backImage.name||"Back image loaded") : ""}
                      subLabel="or click to browse"
                      types={["PNG","JPG","PDF"]}
                      onFiles={handleBackFile}
                      inputRef={backInputRef}
                    />
                    {backImage && (
                      <div style={{ display:"flex", gap:8, marginTop:8, alignItems:"center" }}>
                        <button className="pc-btn pc-btn-secondary pc-btn-sm" onClick={()=>setBackRotation(r=>(r+90)%360)} style={{ display:"flex", alignItems:"center", gap:4 }}>
                          <Icon.Rotate /> Rotate 90°
                        </button>
                        <span style={{ fontSize:12, color:"var(--text-muted)" }}>
                          {backRotation > 0 ? `Rotated ${backRotation}°` : "No rotation"}
                        </span>
                        <button className="pc-btn pc-btn-secondary pc-btn-sm" style={{ marginLeft:"auto" }} onClick={()=>{ setBackImage(null); setBackRotation(0); }}>
                          <Icon.X /> Remove
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Step 4 — Preview */}
            <div className="pc-card">
              <CardHeader
                step="4"
                title="Layout Preview"
                hint="Verify placement before ordering"
                right={
                  showBack && (
                    <div style={{ display:"flex", gap:6 }}>
                      <button className={`pc-btn pc-btn-sm ${previewSide==="front"?"pc-btn-primary":"pc-btn-secondary"}`} onClick={()=>setPreviewSide("front")}>Front</button>
                      <button className={`pc-btn pc-btn-sm ${previewSide==="back"?"pc-btn-primary":"pc-btn-secondary"}`} onClick={()=>setPreviewSide("back")}>Back</button>
                    </div>
                  )
                }
              />
              <div className="pc-card-body">
                {/* Page nav for multi-sheet jobs */}
                {frontFiles.length>0 && sheetsNeeded>1 && (
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                    <button className="pc-btn pc-btn-secondary pc-btn-sm pc-btn-icon" disabled={frontPreviewPage===0} onClick={()=>setFrontPreviewPage(p=>Math.max(0,p-1))}>
                      <Icon.ChevLeft />
                    </button>
                    <span style={{ fontSize:12, color:"var(--text-muted)" }}>Sheet {frontPreviewPage+1} of {sheetsNeeded}</span>
                    <button className="pc-btn pc-btn-secondary pc-btn-sm pc-btn-icon" disabled={frontPreviewPage>=sheetsNeeded-1} onClick={()=>setFrontPreviewPage(p=>Math.min(sheetsNeeded-1,p+1))}>
                      <Icon.ChevRight />
                    </button>
                    <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
                      <button className="pc-btn pc-btn-secondary pc-btn-sm" onClick={()=>setFrontZoom(clampZoom(frontZoom-0.2))}>−</button>
                      <span style={{ fontSize:12, color:"var(--text-muted)", lineHeight:"30px", minWidth:40, textAlign:"center" }}>{Math.round(frontZoom*100)}%</span>
                      <button className="pc-btn pc-btn-secondary pc-btn-sm" onClick={()=>setFrontZoom(clampZoom(frontZoom+0.2))}>+</button>
                    </div>
                  </div>
                )}

                <div
                  className="canvas-wrap"
                  style={{ display: (previewSide==="front" || !showBack) ? "block" : "none" }}
                  onClick={e=>{
                    if (!frontPlacementsRef.current?.length) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const canvas = frontRef.current;
                    if (!canvas) return;
                    const scaleX = canvas.width/(rect.width*frontZoom);
                    const scaleY = canvas.height/(rect.height*frontZoom);
                    const cx = (e.clientX-rect.left)*scaleX;
                    const cy = (e.clientY-rect.top)*scaleY;
                    const hit = frontPlacementsRef.current.find(p => cx>=p.x && cx<=p.x+p.w && cy>=p.y && cy<=p.y+p.h);
                    if (hit) setSelectedFrontId(hit.itemId);
                  }}
                >
                  {(frontFiles.length>0 || frontImage) ? (
                    <canvas
                      ref={frontRef}
                      style={{ transform:`scale(${frontZoom})`, transformOrigin:"top left", cursor:"pointer", width:"100%" }}
                    />
                  ) : processingFiles ? (
                    <div className="canvas-skeleton">Processing files…</div>
                  ) : (
                    <div className="preview-pane">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity:0.35 }}>
                        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
                      </svg>
                      <div>Upload a file to see the layout preview</div>
                    </div>
                  )}
                </div>

                {showBack && (
                  <div className="canvas-wrap" style={{ display: previewSide==="back" ? "block" : "none" }}>
                    {backImage ? (
                      <canvas ref={backRef} style={{ width:"100%" }} />
                    ) : (
                      <div className="preview-pane">Upload a back image to preview</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Price Bar — single-job mode keeps the original metrics; multi-job
                shows ticket-wide totals using the grouped discount logic. */}
            <PriceBar
              accentClass="price-bar-teal"
              totalClass="is-total"
              metrics={ticket.length > 1 ? [
                { label:"Jobs",            value: ticket.length },
                { label:"Total sheets",    value: ticketTotalSheets },
                { label:"Combined discount", value: ticketDiscountAmt > 0.005
                    ? `−$${ticketDiscountAmt.toFixed(2)}` : "—" },
                { label:"Ticket total",    value: `$${ticketTotal.toFixed(2)}`, big:true },
              ] : [
                { label:"Sheets needed", value: sheetsNeeded },
                { label:"Per sheet",     value: `$${perSheetTotal.toFixed(2)}` },
                { label:"Discount",      value: (activeLine?.appliedDiscountFactor ?? 1) < 1
                    ? `${((1 - (activeLine?.appliedDiscountFactor ?? 1)) * 100).toFixed(1)}% off` : "—" },
                { label:"Estimated total", value: `$${(activeLine?.lineTotal ?? totalPrice).toFixed(2)}`, big:true },
              ]}
              onDownload={downloadSheetPDF}
              onOrder={orderSheetJob}
              onCompleteSale={requestCompleteSale}
              completeSaleEnabled={!!currentEmployee && (ticketTotal > 0 || totalPrice > 0)}
              completeSaleHint={!currentEmployee ? "Sign in with your PIN first" : "Log this as a completed sale"}
            />
          </>
        )}

        {/* ════════════════════════════════════════
            PANEL: LARGE FORMAT
        ════════════════════════════════════════ */}
        {activeTab==="large" && viewMode==="tool" && (
          <>
            {/* Step 1 — Specifications */}
            <div className="pc-card">
              <CardHeader step="1" stepClass="step-num-amber" title="Print Specifications" hint="Max width: 36 inches" />
              <div className="pc-card-body">
                <div className="grid-auto" style={{ marginBottom:16 }}>
                  <div>
                    <label className="field-label">Width (in)</label>
                    <input className="pc-input" type="number" value={lfWidth} min="1" max="36" step="0.5" onChange={e=>setLfWidth(Math.min(36,Math.max(0.1,+e.target.value||0.1)))} />
                  </div>
                  <div>
                    <label className="field-label">Height (in)</label>
                    <input className="pc-input" type="number" value={lfHeight} min="1" step="0.5" onChange={e=>setLfHeight(Math.max(0.1,+e.target.value||0.1))} />
                  </div>
                  <div>
                    <label className="field-label">Media type</label>
                    <div className="pc-select-wrap">
                      <select className="pc-select" value={lfPaperKey} onChange={e=>setLfPaperKey(e.target.value)}>
                        {lfPaperTypes.map(pt => <option key={pt.key} value={pt.key}>{pt.label}</option>)}
                      </select>
                    </div>
                    {upsellFlags.lfPaperTypes?.[lfPaperKey] && (
                      <UpsellToggle
                        checked={lfUpsellPaper}
                        onChange={setLfUpsellPaper}
                        tooltip="Mark this if you suggested this media to the customer."
                      />
                    )}
                  </div>
                  <div>
                    <label className="field-label">Color mode</label>
                    <div className="chip-group">
                      <Chip label="Color" selected={lfColorMode==="color"} onClick={()=>setLfColorMode("color")} color="amber" />
                      <Chip label="B&W"   selected={lfColorMode==="bw"}    onClick={()=>setLfColorMode("bw")}    color="amber" />
                    </div>
                  </div>
                </div>

                <div style={{ fontSize:12, color:"var(--text-muted)", marginBottom:16, display:"flex", gap:12, flexWrap:"wrap" }}>
                  <span>Area: <strong style={{ color:"var(--text)" }}>{lfAreaSqFt.toFixed(2)} sq ft</strong></span>
                  <span>Orientation: <strong style={{ color:"var(--text)" }}>{lfWidth>=lfHeight?"Landscape":"Portrait"}</strong></span>
                </div>

                {lfWidth>36 && (
                  <div className="callout callout-warn" style={{ marginBottom:14 }}>
                    <span className="callout-icon"><Icon.Warn /></span>
                    Width exceeds the 36" maximum for our large format printer.
                  </div>
                )}

                <hr className="pc-divider" />
                <div style={{ fontSize:12, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10 }}>Add-ons</div>
                <div className="addon-grid">
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    <AddonCard emoji="🔩" name="Grommets" price={`$${(lfAddonPricing.grommetEach||0).toFixed(2)}/ea`} selected={lfGrommets} onToggle={()=>setLfGrommets(v=>!v)} />
                    {lfGrommets && upsellFlags.lfAddons?.grommets && (
                      <UpsellToggle checked={lfUpsellGrommets} onChange={setLfUpsellGrommets} />
                    )}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    <AddonCard emoji="🧊" name="Foam Core" price={`+$${lfAddonPricing.foamCore}`} selected={lfFoamCore} onToggle={()=>setLfFoamCore(v=>!v)} />
                    {lfFoamCore && upsellFlags.lfAddons?.foamCore && (
                      <UpsellToggle checked={lfUpsellFoamCore} onChange={setLfUpsellFoamCore} />
                    )}
                  </div>
                </div>
                {lfGrommets && (
                  <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:10, fontSize:12 }}>
                    <label className="field-label" style={{ marginBottom:0 }}>Number of grommets:</label>
                    <input className="pc-input" type="number" min="1" max="50" value={lfGrommetCount} style={{ width:70, height:34 }}
                      onChange={e=>setLfGrommetCount(Math.max(1,+e.target.value||1))} />
                    <span style={{ color:"var(--text-muted)" }}>
                      = <strong style={{ color:"var(--text)" }}>${((lfAddonPricing.grommetEach||0) * lfGrommetCount).toFixed(2)}</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Step 2 — Upload */}
            <div className="pc-card">
              <CardHeader step="2" stepClass="step-num-amber" title="Upload Artwork" hint="High-res recommended for large prints" />
              <div className="pc-card-body">
                <input ref={lfInputRef} type="file" accept="image/*,application/pdf" style={{ display:"none" }} onChange={e=>{ if(e.target.files[0]) handleLfFile([e.target.files[0]]); e.target.value=""; }} />
                <UploadZone
                  hasFile={!!lfImage}
                  label={lfImage ? (lfImage.name||"Artwork loaded") : ""}
                  types={["PNG","JPG","PDF"]}
                  onFiles={handleLfFile}
                  inputRef={lfInputRef}
                />
                {lfImage && (
                  <div className="canvas-wrap" style={{ marginTop:12 }}>
                    <canvas ref={lfRef} style={{ width:"100%", maxHeight:300, objectFit:"contain" }} />
                  </div>
                )}
                {!lfImage && (
                  <div className="callout callout-warn" style={{ marginTop:12 }}>
                    <span className="callout-icon"><Icon.Warn /></span>
                    For best results at {lfWidth}×{lfHeight}", provide artwork at 150–300 DPI minimum.
                  </div>
                )}
              </div>
            </div>

            {/* Price Bar */}
            <PriceBar
              accentClass="price-bar-amber"
              totalClass="is-total-amber"
              metrics={[
                { label:"Dimensions",      value:`${lfWidth} × ${lfHeight} in` },
                { label:"Area",            value:`${lfAreaSqFt.toFixed(2)} sq ft` },
                { label:"Add-ons",         value:[lfGrommets&&`Grom. ×${lfGrommetCount}`, lfFoamCore&&"Foam Core"].filter(Boolean).join(", ")||"None" },
                { label:"Estimated total", value:`$${lfTotalWithDiscount.toFixed(2)}`, big:true },
              ]}
              onDownload={downloadLfPDF}
              onOrder={orderLargeFormatJob}
              onCompleteSale={requestCompleteSale}
              completeSaleEnabled={!!currentEmployee && lfTotalWithDiscount > 0 && !!lfImage}
              completeSaleHint={!currentEmployee ? "Sign in with your PIN first" : "Log this as a completed sale"}
            />
          </>
        )}

        {/* ════════════════════════════════════════
            PANEL: BLUEPRINTS
        ════════════════════════════════════════ */}
        {activeTab==="blueprint" && viewMode==="tool" && (
          <>
            {/* Step 1 — Size */}
            <div className="pc-card">
              <CardHeader step="1" stepClass="step-num-blue" title="Blueprint Size" hint="20lb plain bond · B&W only" />
              <div className="pc-card-body">
                <div className="bp-size-grid">
                  {BLUEPRINT_SIZES.map(s => {
                    const aspectW = Math.min(30, Math.round(s.w/s.h * 26));
                    const aspectH = Math.min(30, Math.round(s.h/s.w * 26));
                    return (
                      <div key={s.key} className={`bp-size-card ${bpSizeKey===s.key?"selected":""}`} onClick={()=>setBpSizeKey(s.key)}>
                        <div className="bp-size-visual" style={{ width:aspectW, height:aspectH }} />
                        <div className="bp-size-label">{s.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Step 2 — Quantity */}
            <div className="pc-card">
              <CardHeader step="2" stepClass="step-num-blue" title="Quantity" />
              <div className="pc-card-body">
                <div className="grid-2" style={{ marginBottom:14 }}>
                  <div>
                    <label className="field-label">Number of sheets</label>
                    <input className="pc-input" type="number" value={bpQty} min="1" onChange={e=>setBpQty(Math.max(1,+e.target.value||1))} />
                  </div>
                  <div>
                    <label className="field-label">Per sheet cost</label>
                    <input className="pc-input pc-input-readonly" type="text" readOnly value={`$${bpPerSheet.toFixed(2)}`} />
                  </div>
                </div>
                <div className="callout callout-info">
                  <span className="callout-icon"><Icon.Info /></span>
                  Volume discounts apply automatically — pricing tiers kick in at higher quantities.
                </div>
              </div>
            </div>

            {/* Step 3 — Upload */}
            <div className="pc-card">
              <CardHeader step="3" stepClass="step-num-blue" title="Upload Blueprint Files" />
              <div className="pc-card-body">
                <input ref={bpInputRef} type="file" accept="image/*,application/pdf" style={{ display:"none" }} onChange={e=>{ if(e.target.files[0]) handleBpFile([e.target.files[0]]); e.target.value=""; }} />
                <UploadZone
                  hasFile={!!bpFile}
                  label={bpFile ? (bpFile.name||"Blueprint loaded") : ""}
                  types={["PDF","PNG","JPG","DWG"]}
                  onFiles={handleBpFile}
                  inputRef={bpInputRef}
                />
                <div className="canvas-wrap" style={{ marginTop:12 }}>
                  <canvas ref={bpRef} style={{ width:"100%", maxHeight:260 }} />
                </div>
              </div>
            </div>

            {/* Price Bar */}
            <PriceBar
              accentClass="price-bar-blue"
              totalClass="is-total-blue"
              metrics={[
                { label:"Size",            value:`${bpWidth} × ${bpHeight} in` },
                { label:"Sheets",          value:bpQty },
                { label:"Per sheet",       value:`$${bpPerSheet.toFixed(2)}` },
                { label:"Estimated total", value:`$${bpTotal.toFixed(2)}`, big:true },
              ]}
              onDownload={downloadBlueprintPDF}
              onOrder={orderBlueprintJob}
              onCompleteSale={requestCompleteSale}
              completeSaleEnabled={!!currentEmployee && bpTotal > 0}
              completeSaleHint={!currentEmployee ? "Sign in with your PIN first" : "Log this as a completed sale"}
            />
          </>
        )}

        {/* ════════════════════════════════════════
            PANEL: SPECIALTY (Signs365 trade printing)
        ════════════════════════════════════════ */}
        {activeTab==="specialty" && viewMode==="tool" && (
          <SpecialtyTab CardHeader={CardHeader} />
        )}

        {/* ════════════════════════════════════════
            PANEL: IMPOSE (BOOKLET MAKER)
        ════════════════════════════════════════ */}
{activeTab==="impose" && viewMode==="tool" && (
  <ImposePanel CardHeader={CardHeader} pricingProps={{
    paperTypes, sheetKeysForPaper, pricing, quantityDiscounts,
    backSideFactor, getSheetDiscountFactor,
  }} />
)}

      </div>{/* /content-wrap */}

      <MobileNumberBar open={numBarOpen} onDone={blurActive} onClear={clearActive} onNudge={nudgeActive} />

      <TrainingDrawer onApplyScenario={applyScenario} />

      {pendingSaveJob && (
        <SaveJobDialog
          label={pendingSaveJob.label}
          row={pendingSaveJob.row}
          saving={savingJob}
          onCancel={dismissSaveJob}
          onConfirm={confirmSaveJob}
        />
      )}

      {showJobHistory && <JobHistory onClose={() => setShowJobHistory(false)} />}

      {showEmployeeLogin && (
        <EmployeeLogin
          onLogin={handleEmployeeLogin}
          onCancel={() => setShowEmployeeLogin(false)}
        />
      )}

      {pendingSale && (
        <CompleteSaleDialog
          pending={pendingSale}
          busy={completingSale}
          onConfirm={confirmCompleteSale}
          onCancel={() => !completingSale && setPendingSale(null)}
        />
      )}

      {showMyNumbers && currentEmployee && (
        <MyNumbersPanel
          employee={currentEmployee}
          onClose={() => setShowMyNumbers(false)}
        />
      )}

      {savedJobToast && <div className="pc-toast">{savedJobToast}</div>}

    </div>
  );
}

// ─── SAVE-JOB DIALOG ───────────────────────────────────────
// Asks the user whether to persist the current print job, plus
// optional customer fields. Receives the row builder output and
// merges customer fields when the user confirms.
function SaveJobDialog({ label, row, saving, onCancel, onConfirm }) {
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const submit = (e) => {
    e?.preventDefault?.();
    onConfirm({
      customer_name:  name.trim()  || null,
      customer_email: email.trim() || null,
      customer_phone: phone.trim() || null,
      notes:          notes.trim() || null,
    });
  };
  return (
    <div className="pc-dialog-backdrop" role="dialog" aria-modal="true" onClick={() => !saving && onCancel()}>
      <form className="pc-dialog" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className="pc-dialog-title">Save this {label} job to history?</div>
        <div className="pc-dialog-sub">Optional customer info — leave blank if walk-in.</div>
        <div className="pc-dialog-grid">
          <div>
            <label className="field-label">Customer name</label>
            <input className="pc-input" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="field-label">Email</label>
            <input className="pc-input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Phone</label>
            <input className="pc-input" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div style={{ gridColumn:"1 / -1" }}>
            <label className="field-label">Notes</label>
            <input className="pc-input" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="pc-dialog-summary">
          <span>Total: <strong>${Number(row.total_price||0).toFixed(2)}</strong></span>
          <span>{row.print_size || row.sheet_size}</span>
          {row.quantity != null && <span>Qty {row.quantity}</span>}
        </div>
        <div className="pc-dialog-actions">
          <button type="button" className="pc-btn pc-btn-secondary" onClick={onCancel} disabled={saving}>No, skip</button>
          <button type="submit" className="pc-btn pc-btn-success" disabled={saving}>
            {saving ? "Saving…" : "Yes, save job"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── COMPLETE SALE DIALOG ──────────────────────────────────
// Confirmation modal shown when the employee clicks "Complete Sale".
// Re-runs the commission math locally so the displayed numbers always
// match what gets written to the transactions row.
function CompleteSaleDialog({ pending, busy, onConfirm, onCancel }) {
  const [notes, setNotes] = useState("");
  const { snapshot, employee, settings } = pending;
  const c = computeCommission(snapshot.baseSubtotal, snapshot.upsellSubtotal, settings);
  const submit = (e) => { e?.preventDefault?.(); onConfirm(notes); };
  return (
    <div className="pc-dialog-backdrop" role="dialog" aria-modal="true" onClick={() => !busy && onCancel()}>
      <form className="pc-dialog complete-sale-dialog" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className="pc-dialog-title">Complete sale for ${c.total.toFixed(2)}?</div>
        <div className="pc-dialog-sub">
          Logging under <strong>{employee.name}</strong>. This can't be undone from the calculator.
        </div>

        <div className="complete-sale-breakdown">
          <div className="complete-sale-row">
            <span>Base subtotal</span>
            <span>${c.base_subtotal.toFixed(2)}</span>
          </div>
          <div className="complete-sale-row">
            <span>Upsell subtotal</span>
            <span>${c.upsell_subtotal.toFixed(2)}</span>
          </div>
          <hr className="pc-divider" style={{ margin:"6px 0" }} />
          <div className="complete-sale-row">
            <span>Base commission ({(settings.base_rate * 100).toFixed(2)}%)</span>
            <span>${c.base_commission.toFixed(2)}</span>
          </div>
          <div className="complete-sale-row">
            <span>Upsell commission ({(settings.upsell_rate * 100).toFixed(2)}%)</span>
            <span>${c.upsell_commission.toFixed(2)}</span>
          </div>
          <div className="complete-sale-row complete-sale-total">
            <span>You earn</span>
            <span>${c.total_commission.toFixed(2)}</span>
          </div>
        </div>

        <div className="complete-sale-lines">
          <div className="complete-sale-lines-title">Line items ({snapshot.lineItems.length})</div>
          <ul>
            {snapshot.lineItems.map((li, i) => (
              <li key={i}>
                <span>
                  {li.kind === "sheet_line" && `Job ${li.jobNumber}: ${li.quantity}× ${li.printSize} on ${li.paperLabel}`}
                  {li.kind === "lf_media"   && `${li.width}×${li.height} ${li.paperLabel}`}
                  {li.kind === "lf_addon"   && `${li.name}${li.count ? ` ×${li.count}` : ""}`}
                  {li.kind === "blueprint"  && `${li.label} blueprints ×${li.quantity}`}
                </span>
                <span>
                  {li.upsell && <span className="complete-sale-upsell-pill">⬆ upsell</span>}
                  ${Number(li.lineTotal || 0).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ marginTop: 10 }}>
          <label className="field-label">Notes (optional)</label>
          <input
            className="pc-input"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. customer name, special instructions"
            disabled={busy}
          />
        </div>

        <div className="pc-dialog-actions" style={{ marginTop: 14 }}>
          <button type="button" className="pc-btn pc-btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="pc-btn pc-btn-success" disabled={busy}>
            {busy ? "Logging…" : "✓ Confirm Sale"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── TICKET BAR ────────────────────────────────────────────
// Compact list of saved jobs. With one job this is a single inline row
// nudging the user to add another job; with two or more it expands to
// show clickable job cards plus the combined-discount summary.
function TicketBar({
  ticket, ticketLines, ticketGroups, activeTicketIdx,
  ticketTotal, ticketTotalSheets, ticketDiscountAmt,
  paperTypes, onSwitch, onAdd, onRemove,
}) {
  const isMulti = ticket.length > 1;
  const labelOf = (item) => {
    const pt = paperTypes.find(p => p.key === item.paperKey);
    return pt?.label || item.paperKey || "—";
  };

  if (!isMulti) {
    return (
      <div className="ticket-bar ticket-bar-compact">
        <div className="ticket-bar-compact-text">
          Need to combine multiple jobs on one ticket? Add another and they'll share volume discounts when paper + sheet match.
        </div>
        <button type="button" className="pc-btn pc-btn-primary pc-btn-sm" onClick={onAdd}>
          + Add Job
        </button>
      </div>
    );
  }

  // Build a quick lookup of {groupKey -> discountPercent} so each card
  // can show whether it's currently in a discounted group.
  const groupDisc = {};
  Object.entries(ticketGroups).forEach(([k, g]) => { groupDisc[k] = g.discountPercent; });

  return (
    <div className="pc-card ticket-bar">
      <div className="ticket-bar-header">
        <div>
          <div className="ticket-bar-title">📋 Job Ticket</div>
          <div className="ticket-bar-sub">{ticket.length} jobs · {ticketTotalSheets} sheets</div>
        </div>
        <button type="button" className="pc-btn pc-btn-primary pc-btn-sm" onClick={onAdd}>
          + Add Job
        </button>
      </div>

      <div className="ticket-card-list">
        {ticketLines.map((line, i) => {
          const it = line.item;
          const active = i === activeTicketIdx;
          const disc = groupDisc[line.groupKey] || 0;
          return (
            <div
              key={it.id || i}
              className={`ticket-card${active ? " is-active" : ""}`}
              onClick={() => onSwitch(i)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSwitch(i); } }}
            >
              <div className="ticket-card-row">
                <span className="ticket-card-num">Job {i + 1}</span>
                <button
                  type="button"
                  className="ticket-card-remove"
                  title="Remove this job"
                  onClick={(e) => { e.stopPropagation(); onRemove(i); }}
                  disabled={ticket.length <= 1}
                  aria-label={`Remove job ${i + 1}`}
                >×</button>
              </div>
              <div className="ticket-card-line">
                <strong>{it.totalPrintQty || 0}×</strong> {it.printWidth}×{it.printHeight}
              </div>
              <div className="ticket-card-line ticket-card-paper" title={labelOf(it)}>{labelOf(it)}</div>
              <div className="ticket-card-line ticket-card-meta">
                {it.sheetKey} · {(it.sheetsNeeded || 0)} sht
              </div>
              <div className="ticket-card-total">
                ${line.lineTotal.toFixed(2)}
                {disc > 0.0001 && <span className="ticket-card-disc">−{disc.toFixed(0)}%</span>}
              </div>
              {it.upsellPaper && <span className="ticket-card-upsell" title="Marked as upsell">⬆ upsell</span>}
            </div>
          );
        })}
      </div>

      <div className="ticket-bar-summary">
        <div>
          <span className="ticket-summary-label">Ticket total</span>
          <span className="ticket-summary-value">${ticketTotal.toFixed(2)}</span>
        </div>
        {ticketDiscountAmt > 0.005 && (
          <div className="ticket-summary-pill">
            saved ${ticketDiscountAmt.toFixed(2)} via combined discount
          </div>
        )}
      </div>
    </div>
  );
}

// ─── IMPOSE PANEL (sub-tool selector) ──────────────────────
function ImposePanel({ CardHeader, pricingProps }) {
  const [imposeTool, setImposeTool] = useState("booklet");
  return (
    <>
      <div className="pc-card" style={{ marginBottom: 16 }}>
        <div className="pc-card-body" style={{ padding: "12px 20px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Tool:</span>
            <button
              className={`pc-btn pc-btn-sm ${imposeTool === "booklet" ? "pc-btn-primary" : "pc-btn-secondary"}`}
              onClick={() => setImposeTool("booklet")}
            >📖 Booklet Maker</button>
            <button
              className={`pc-btn pc-btn-sm ${imposeTool === "datamerge" ? "pc-btn-primary" : "pc-btn-secondary"}`}
              onClick={() => setImposeTool("datamerge")}
            >🔢 Data Merge</button>
          </div>
        </div>
      </div>
      {imposeTool === "booklet" && <BookletMaker CardHeader={CardHeader} pricingProps={pricingProps} />}
      {imposeTool === "datamerge" && <DataMerge CardHeader={CardHeader} pricingProps={pricingProps} />}
    </>
  );
}

// Helper for tab active pill background
function pillActiveBg(id) {
  if (id==="paper")     return "#b3e8f0";
  if (id==="large")     return "#fde68a";
  if (id==="blueprint") return "#bfdbfe";
  if (id==="impose")    return "#bbf7d0";
  if (id==="specialty") return "#ddd6fe";
  return "#e5e7eb";
}

export default PriceCalculatorApp;
