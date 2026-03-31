// ============================================================
//  PRINT CALCULATOR — REDESIGNED UI
//  The UPS Store #4979
//  All calculation, PDF, and email logic preserved intact.
//  Only the presentation layer has been replaced.
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";
import BookletMaker, { BookletIcon } from "./BookletMaker.jsx";
import DataMerge, { DataMergeIcon } from "./DataMerge.jsx";

// ─── CONSTANTS ──────────────────────────────────────────────

const DPI = 96;
const DEFAULT_MARGIN_IN  = 0.125;
const DEFAULT_SPACING_IN = 0.0625;

const PRESET_SHEETS = {
  "4x6":    [4,  6],
  "5x7":    [5,  7],
  "8.5x11": [8.5,11],
  "11x17":  [11, 17],
  "12x18":  [12, 18],
  "13x19":  [13, 19],
  "custom": null,
};

const DEFAULT_PAPER_TYPES = [
  { key:"20lb_bond",     label:"20lb Bond",         sheets:["8.5x11","11x17"] },
  { key:"24lb_premium",  label:"24lb Premium Bond",  sheets:["8.5x11","11x17","12x18"] },
  { key:"cardstock_80",  label:"Cardstock 80lb",     sheets:["8.5x11","11x17"] },
  { key:"cardstock_100", label:"Cardstock 100lb",    sheets:["8.5x11"] },
  { key:"photo_glossy",  label:"Photo Glossy",       sheets:["4x6","5x7","8.5x11"] },
  { key:"photo_matte",   label:"Photo Matte",        sheets:["4x6","5x7","8.5x11"] },
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
  pts.forEach((pt) => { m[pt.key] = pt.sheets || Object.keys(PRESET_SHEETS).filter(k => k !== "custom"); });
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

const pdfFileToPngFile = async (file, pageNum=1, scale=2) => {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("pdf.js not loaded");
  const ab = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: ab }).promise;
  const safePage = Math.min(Math.max(1, pageNum), pdf.numPages || 1);
  const page = await pdf.getPage(safePage);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png", 1));
  return new File([blob], file.name.replace(/\.pdf$/i,"")+"-p1.png", { type:"image/png" });
};

const pdfFileToAllPages = async (file, scale=2) => {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("pdf.js not loaded");
  const ab = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: ab }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
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

const normalizeUpload = async (file) => isPdfFile(file) ? await pdfFileToPngFile(file,1,2) : file;

const canvasToCompressedJpeg = (canvas, { maxDim=1600, quality=0.75 }={}) => {
  let w = canvas.width, h = canvas.height;
  if (Math.max(w,h) > maxDim) {
    const r = maxDim / Math.max(w,h);
    w = Math.round(w*r); h = Math.round(h*r);
  }
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  tmp.getContext("2d").drawImage(canvas, 0, 0, w, h);
  return tmp.toDataURL("image/jpeg", quality);
};

const getJsPDF = () => {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  if (window.jsPDF) return window.jsPDF;
  throw new Error("jsPDF not loaded");
};

const normRot = (deg) => ((Number(deg)||0) % 360 + 360) % 360;

const getFileExt = (name="") => (name.split(".").pop()||"").toUpperCase().slice(0,4) || "IMG";

const computeBestFit = (printW, printH, sheetW, sheetH, marginIn, spacingIn, bleed) => {
  const bleedAdd = bleed ? 0.125 : 0;
  const pw = (printW||0) + bleedAdd*2;
  const ph = (printH||0) + bleedAdd*2;
  if (!pw || !ph) return { cols:1, rows:1, count:1, printRotated:false, sheetOrientation:"portrait" };
  let best = null;
  [false, true].forEach((printRotated) => {
    ["portrait","landscape"].forEach((sheetOrientation) => {
      const sw = sheetOrientation==="landscape" ? Math.max(sheetW,sheetH) : Math.min(sheetW,sheetH);
      const sh = sheetOrientation==="landscape" ? Math.min(sheetW,sheetH) : Math.max(sheetW,sheetH);
      const aw = printRotated ? ph : pw;
      const ah = printRotated ? pw : ph;
      const m = marginIn;
      const sp = spacingIn;
      const usableW = sw - 2*m + sp;
      const usableH = sh - 2*m + sp;
      const cols = Math.max(1, Math.floor(usableW / (aw+sp)));
      const rows = Math.max(1, Math.floor(usableH / (ah+sp)));
      const count = cols * rows;
      const candidate = { cols, rows, count, printRotated, sheetOrientation };
      if (!best || count > best.count) best = candidate;
      else if (count === best.count) {
        if (best.printRotated && !candidate.printRotated) best = candidate;
      }
    });
  });
  return best || { cols:1, rows:1, count:1, printRotated:false, sheetOrientation:"portrait" };
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

  // SKU / Job ID barcode-style identifier
  if (details.find(d => d.label === "Paper:")) {
    y += 0.15;
    const skuVal = details.find(d => d.label === "SKU:")?.value || "";
    if (skuVal) {
      doc.setFontSize(8); doc.setFont("Courier", "bold"); doc.setTextColor(0,0,0);
      doc.text(`SKU: ${skuVal}`, ml, y);
      y += 0.14;
      // Simple barcode-style representation using Code39-like pattern
      doc.setFontSize(24); doc.setFont("Courier", "bold");
      doc.text(`*${skuVal}*`, ml, y);
    }
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

function PriceBar({ metrics, onDownload, onOrder, accentClass="price-bar-teal", totalClass="is-total" }) {
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
          <Icon.Download /> Download PDF
        </button>
        <button className="pc-btn pc-btn-success" onClick={onOrder}>
          <Icon.Send /> Place Order
        </button>
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

// ─── MAIN APP ───────────────────────────────────────────────

function PriceCalculatorApp() {
  // ── Tab / view state ──
  const [activeTab, setActiveTab]   = useState(() => { try { return localStorage.getItem("activeTab") || "paper"; } catch { return "paper"; }});
  const [viewMode, setViewMode]     = useState("tool"); // "tool" | "quote"
  const [showAdmin, setShowAdmin]   = useState(false);
  const [isAdmin, setIsAdmin]       = useState(false);

  useEffect(() => { try { localStorage.setItem("activeTab", activeTab); } catch {} }, [activeTab]);

  // ── Paper/Sheet state ──
  const [paperTypes, setPaperTypes] = useState(loadPaperTypes);
  const [sheetKeysForPaper, setSheetKeysForPaper] = useState(() => loadSheetKeysForPaper(loadPaperTypes()));
  const [paperKey, setPaperKey]     = useState(() => { const pts = loadPaperTypes(); return pts[0]?.key || DEFAULT_PAPER_TYPES[0].key; });
  const [sheetKey, setSheetKey]     = useState("8.5x11");
  const [customSize, setCustomSize] = useState({ w:8.5, h:11 });
  const [orientation, setOrientation] = useState("portrait");
  const [frontColorMode, setFrontColorMode] = useState("color");
  const [backColorMode, setBackColorMode]   = useState("bw");
  const [showBack, setShowBack]     = useState(false);
  const [showBleed, setShowBleed]   = useState(false);
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
  const [quantityDiscounts, setQuantityDiscounts]   = useState([{ minSheets:0, discountPercent:0 }]);
  const [lfQuantityDiscounts, setLfQuantityDiscounts] = useState([{ minSqFt:0, discountPercent:0 }]);
  const [backSideFactor, setBackSideFactor] = useState(0.5);
  const [lfAddonPricing, setLfAddonPricing] = useState({ grommetEach:1.50, foamCore:12 });
  const [bpPricing, setBpPricing]     = useState(buildInitialBlueprintPricing);

  useEffect(() => { try { localStorage.setItem(LS.PRICING, JSON.stringify(pricing)); } catch {} }, [pricing]);
  useEffect(() => { try { localStorage.setItem(LS.LF_PRICING, JSON.stringify(lfPricing)); } catch {} }, [lfPricing]);
  useEffect(() => { try { localStorage.setItem(LS.QTY_DISCOUNTS, JSON.stringify(quantityDiscounts)); } catch {} }, [quantityDiscounts]);
  useEffect(() => { try { localStorage.setItem(LS.BP_PRICING, JSON.stringify(bpPricing)); } catch {} }, [bpPricing]);

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
      } catch {}
    })();
  }, []);

  // ── Derived: sheet dimensions ──
  const getPresetSheetKeys = () => Object.keys(PRESET_SHEETS).filter(k => k !== "custom");
  const sheetDims = sheetKey === "custom" ? [customSize.w, customSize.h] : (PRESET_SHEETS[sheetKey] || [8.5,11]);
  const orientedWIn = orientation==="landscape" ? Math.max(...sheetDims) : Math.min(...sheetDims);
  const orientedHIn = orientation==="landscape" ? Math.min(...sheetDims) : Math.max(...sheetDims);

  // ── Best fit calculation ──
  const frontSlotInfo = computeBestFit(prints.width, prints.height, orientedWIn, orientedHIn, previewMargin, previewSpacing, showBleed);
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
        if (sk==="custom") return;
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
  const drawSheet = useCallback((canvas, imageInput, rotDeg, pageIndex=0, placementsRef=null) => {
    return new Promise((resolve) => {
      if (!canvas) return resolve();
      const ctx = canvas.getContext("2d");
      const wPx = inchesToPx(orientedWIn);
      const hPx = inchesToPx(orientedHIn);
      canvas.width = wPx; canvas.height = hPx;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0,0,wPx,hPx);

      let items = [];
      if (Array.isArray(imageInput)) {
        items = imageInput.filter(Boolean).map((it,idx) => it?.file
          ? { id:String(it.id??`f_${idx}`), file:it.file, name:it.name??it.file?.name??`File ${idx+1}`, rotation:Number(it.rotation)||0, qty:Math.max(0,Number(it.qty)||0) }
          : { id:`legacy_${idx}`, file:it, name:it?.name??`File ${idx+1}`, rotation:0, qty:0 }
        );
      } else if (imageInput) {
        items = [{ id:"single", file:imageInput, name:imageInput?.name??"Image", rotation:0, qty:Math.max(0,Number(prints.quantity)||0) }];
      }

      if (!items.length) { if (placementsRef) placementsRef.current=[]; return resolve(); }

      const marginPx  = inchesToPx(previewMargin);
      const spacingPx = inchesToPx(previewSpacing);
      const bleedPx   = showBleed ? inchesToPx(0.125) : 0;
      const { cols, rows, printRotated, sheetOrientation } = frontSlotInfo || { cols:1, rows:1, printRotated:false, sheetOrientation:"portrait" };
      const actualOriented = sheetOrientation==="landscape"
        ? { w: Math.max(wPx,hPx), h: Math.min(wPx,hPx) }
        : { w: Math.min(wPx,hPx), h: Math.max(wPx,hPx) };

      let printWPx = printRotated
        ? inchesToPx(prints.height) + bleedPx*2
        : inchesToPx(prints.width)  + bleedPx*2;
      let printHPx = printRotated
        ? inchesToPx(prints.width)  + bleedPx*2
        : inchesToPx(prints.height) + bleedPx*2;

      const gridW = cols*(printWPx+spacingPx) - spacingPx;
      const gridH = rows*(printHPx+spacingPx) - spacingPx;
      const startX = Math.round((actualOriented.w - gridW)/2);
      const startY = Math.round((actualOriented.h - gridH)/2);

      const totalSlots = cols * rows;
      const cap = totalSlots;

      let workList = [];
      items.forEach(it => { const q = it.qty || 0; if (q>0) for (let i=0;i<q;i++) workList.push(it); else workList.push(it); });
      const startIdx = pageIndex * cap;
      const pageItems = workList.slice(startIdx, startIdx+cap);
      if (!pageItems.length) pageItems.push(...items.slice(0,1));

      const pagePlacements = [];
      const loadedMap = new Map();
      const toLoad = [...new Set(pageItems.map(it => it.file).filter(Boolean))];

      Promise.all(toLoad.map(f => new Promise(res => {
        const url = URL.createObjectURL(f);
        const img = new Image();
        img.onload = () => { loadedMap.set(f, { img, url, width:img.naturalWidth, height:img.naturalHeight }); res(); };
        img.onerror = () => res();
        img.src = url;
      }))).then(() => {
        for (let row=0; row<rows; row++) {
          for (let col=0; col<cols; col++) {
            const slotIdx = row*cols+col;
            const it = pageItems[slotIdx % pageItems.length];
            if (!it) continue;
            const x = startX + col*(printWPx+spacingPx);
            const y = startY + row*(printHPx+spacingPx);
            const chosen = it.file ? loadedMap.get(it.file) : null;
            pagePlacements.push({ col, row, x, y, w:printWPx, h:printHPx, itemId:it.id, itemName:it.name, slotIndex:slotIdx });

            ctx.save();
            if (showBleed && bleedPx>0) {
              ctx.fillStyle = "#f0f0f0"; ctx.fillRect(x,y,printWPx,printHPx);
            }
            const contentX = x+bleedPx, contentY = y+bleedPx;
            const contentW = printWPx-bleedPx*2, contentH = printHPx-bleedPx*2;
            if (chosen?.img) {
              ctx.save();
              ctx.translate(contentX+contentW/2, contentY+contentH/2);
              ctx.beginPath(); ctx.rect(-contentW/2,-contentH/2,contentW,contentH); ctx.clip();
              const rad = (((Number(rotDeg)||0)+(Number(it.rotation)||0))*Math.PI)/180;
              ctx.rotate(rad);
              const perFileRot = normRot(it.rotation);
              let drawW, drawH;
              if (perFileRot!==0) {
                const swap = perFileRot===90||perFileRot===270;
                drawW = swap ? contentH : contentW; drawH = swap ? contentW : contentH;
              } else {
                drawW = contentW; drawH = (chosen.height/chosen.width)*contentW;
                if (drawH<contentH) { drawH=contentH; drawW=(chosen.width/chosen.height)*contentH; }
              }
              ctx.drawImage(chosen.img,-drawW/2,-drawH/2,drawW,drawH);
              ctx.restore();
            } else {
              ctx.fillStyle = "#e5e7eb"; ctx.fillRect(contentX,contentY,contentW,contentH);
              ctx.fillStyle = "#9ca3af"; ctx.font = `${Math.min(contentW*0.12,14)}px sans-serif`;
              ctx.textAlign="center"; ctx.textBaseline="middle";
              ctx.fillText(it.name||"Image", contentX+contentW/2, contentY+contentH/2);
            }
            if (showCutLines) {
              ctx.strokeStyle = "rgba(100,100,100,0.35)"; ctx.lineWidth = 0.5; ctx.setLineDash([3,3]);
              ctx.strokeRect(contentX, contentY, contentW, contentH); ctx.setLineDash([]);
            }
            if (showGuides && marginPx>0) {
              ctx.strokeStyle = "rgba(0,129,152,0.2)"; ctx.lineWidth = 0.5; ctx.setLineDash([2,4]);
              ctx.strokeRect(marginPx, marginPx, wPx-marginPx*2, hPx-marginPx*2); ctx.setLineDash([]);
            }
            ctx.restore();
          }
        }
        if (placementsRef) placementsRef.current = pagePlacements;
        for (const v of loadedMap.values()) { try { URL.revokeObjectURL(v.url); } catch {} }
        resolve({ placements: pagePlacements });
      });
    });
  }, [orientedWIn, orientedHIn, prints, frontSlotInfo, showBleed, showCutLines, showGuides, previewMargin, previewSpacing]);

  useEffect(() => {
    drawSheet(frontRef.current, frontFiles.length ? frontFiles : frontImage, frontRotation, frontPreviewPage, frontPlacementsRef);
  }, [frontFiles, frontImage, frontRotation, frontPreviewPage, sheetKey, orientation, customSize, prints, showBleed, showCutLines, showGuides, drawSheet]);

  useEffect(() => {
    if (showBack) drawSheet(backRef.current, backImage, backRotation, 0, null);
  }, [backImage, backRotation, sheetKey, orientation, customSize, prints, showBleed, showCutLines, showGuides, showBack, drawSheet]);

  // ── LF Canvas ──
  useEffect(() => {
    const canvas = lfRef.current; if (!canvas || !lfImage) return;
    const ctx = canvas.getContext("2d");
    const wPx = inchesToPx(lfWidth); const hPx = inchesToPx(lfHeight);
    canvas.width=wPx; canvas.height=hPx;
    ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,wPx,hPx);
    const url = URL.createObjectURL(lfImage);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(wPx/img.width, hPx/img.height);
      const dw = img.width*scale, dh = img.height*scale;
      ctx.drawImage(img,(wPx-dw)/2,(hPx-dh)/2,dw,dh);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [lfImage, lfWidth, lfHeight]);

  // ── Blueprint Canvas ──
  useEffect(() => {
    const canvas = bpRef.current; if (!canvas) return;
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
    } else {
      const url = URL.createObjectURL(bpFile);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(wPx/img.width, hPx/img.height);
        const dw=img.width*scale, dh=img.height*scale;
        ctx.drawImage(img,(wPx-dw)/2,(hPx-dh)/2,dw,dh);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    }
  }, [bpFile, bpWidth, bpHeight]);

  // ─── FILE HANDLERS ──────────────────────────────────────

const handleFrontFiles = async (files) => {
    const newItems = [];
    for (const f of files) {
      if (isPdfFile(f)) {
        // Extract ALL pages from the PDF as individual items
        const pages = await pdfFileToAllPages(f, 2);
        for (const pg of pages) {
          newItems.push({ id:`f_${Date.now()}_${Math.random()}`, file:pg, name:pg.name, rotation:0, qty:copiesPerFile });
        }
      } else {
        newItems.push({ id:`f_${Date.now()}_${Math.random()}`, file:f, name:f.name, rotation:0, qty:copiesPerFile });
      }
    }
    setFrontFiles(prev => [...prev, ...newItems]);
    if (newItems[0]) setSelectedFrontId(newItems[0].id);
  };

  const handleBackFile = async (files) => {
    if (!files[0]) return;
    const normalized = await normalizeUpload(files[0]);
    setBackImage(normalized);
  };

  const handleLfFile = async (files) => {
    if (!files[0]) return;
    const normalized = await normalizeUpload(files[0]);
    setLfImage(normalized);
  };

  const handleBpFile = async (files) => {
    if (!files[0]) return;
    const normalized = await normalizeUpload(files[0]);
    setBpFile(normalized);
  };

  const removeFile = (id) => setFrontFiles(prev => prev.filter(f => f.id!==id));
  const updateFileQty = (id, qty) => setFrontFiles(prev => prev.map(f => f.id===id ? {...f, qty:Math.max(0,qty)} : f));
  const rotateFile = (id) => setFrontFiles(prev => prev.map(f => f.id===id ? {...f, rotation:((f.rotation||0)+90)%360} : f));

  // ─── PDF DOWNLOADS ──────────────────────────────────────

const downloadSheetPDF = async () => {
    if (!frontRef.current) { alert("Upload a front image first."); return; }
    await ensureLogoPdfDataUrl();
    // Order sheet is always portrait letter
    const orderDoc = new (getJsPDF())({ orientation:"portrait", unit:"in", format:"letter" });
    const currentPaper = paperTypes.find(p=>p.key===paperKey)||{label:paperKey};
    const isCustom = sheetKey==="custom";
    const [sw,sh] = isCustom ? [customSize.w,customSize.h] : (PRESET_SHEETS[sheetKey]||[8.5,11]);
    const details = [
      { label:"Paper:", value:currentPaper.label },
      { label:"SKU:", value:paperKey },
      { label:"Sheet size:", value:`${sw}×${sh} in${isCustom?" (custom)":""}` },
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

    // Add ONE preview page showing the layout (not duplicated for every sheet)
    const pdfW=orientedWIn, pdfH=orientedHIn;
    const isLandscape = pdfW>pdfH;
    const exportInput = frontFiles.length ? frontFiles : (frontImage ? [{ id:"single", file:frontImage, name:frontImage.name||"Image", rotation:0, qty:Number(prints.quantity)||1 }] : []);

    // Front preview — just page 0 (one sheet showing the grid layout)
    const c = document.createElement("canvas");
    await drawSheet(c, exportInput, frontRotation, 0, null);
    orderDoc.addPage([pdfW,pdfH], isLandscape?"landscape":"portrait");
    orderDoc.addImage(c.toDataURL("image/png",1.0),"PNG",0,0,pdfW,pdfH);

    // Back preview (if double-sided)
    if (showBack && backImage) {
      const bc = document.createElement("canvas");
      await drawSheet(bc, backImage, backRotation, 0, null);
      orderDoc.addPage([pdfW,pdfH], isLandscape?"landscape":"portrait");
      orderDoc.addImage(bc.toDataURL("image/png",1.0),"PNG",0,0,pdfW,pdfH);
    }

    savePdf(orderDoc, "print_order_sheet.pdf");
  };

  const downloadLfPDF = () => {
    if (!lfRef.current) { alert("Upload a large format image first."); return; }
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
    const pdfW=lfWidth, pdfH=lfHeight, orient=pdfW>=pdfH?"landscape":"portrait";
    orderDoc.addPage([pdfW,pdfH],orient);
    orderDoc.addImage(lfRef.current.toDataURL("image/png",1.0),"PNG",0,0,pdfW,pdfH);
    savePdf(orderDoc, "large_format_with_order_sheet.pdf");
  };

  const downloadBlueprintPDF = () => {
    const orderDoc = new (getJsPDF())({ orientation:"portrait", unit:"in", format:"letter" });
    const details = [
      { label:"Paper:", value:"20lb plain bond" },
      { label:"Blueprint size:", value:bpSizeObj.label },
      { label:"Quantity:", value:bpQty },
      { label:"Orientation:", value:bpWidth>=bpHeight?"landscape":"portrait" },
    ];
    const totals = [{ label:"Estimated total:", value:`$${bpTotal.toFixed(2)}` }];
    addOrderSheetPage(orderDoc, { jobType:"Blueprints", details, totals, files: bpFile?[bpFile.name||"blueprint"]:[] });
    if (bpRef.current) {
      const pdfW=bpWidth, pdfH=bpHeight, orient=pdfW>=pdfH?"landscape":"portrait";
      orderDoc.addPage([pdfW,pdfH],orient);
      orderDoc.addImage(bpRef.current.toDataURL("image/png",1.0),"PNG",0,0,pdfW,pdfH);
    }
    savePdf(orderDoc, "blueprint_with_order_sheet.pdf");
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
          const unit = sheetsNeeded>0 ? totalPrice/sheetsNeeded : totalPrice;
          paperItems.push({ name:"Paper Printing", sku:paperKey, specs:`${sheetKey} • ${paperKey} • ${frontColorMode.toUpperCase()}${showBack?" / "+backColorMode.toUpperCase():""}`, qty:sheetsNeeded, unitPrice:unit, total:totalPrice });
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
      alert("Order sent! We'll receive your job details by email shortly.");
      return true;
    } catch (err) { console.error("sendOrderEmail error:", err); alert("Could not send automatically. Please download and email manually."); return false; }
  };

  const orderSheetJob = async () => {
    if (!frontRef.current) { alert("Please upload a front image first."); return; }
    const pdfW=orientedWIn, pdfH=orientedHIn;
    const doc = new (getJsPDF())({ orientation, unit:"in", format:[pdfW,pdfH] });
    const frontData = canvasToCompressedJpeg(frontRef.current,{maxDim:1600,quality:0.75});
    doc.addImage(frontData,"JPEG",0,0,pdfW,pdfH);
    if (showBack && backRef.current && backImage) { doc.addPage([pdfW,pdfH],orientation); doc.addImage(canvasToCompressedJpeg(backRef.current,{maxDim:1600,quality:0.75}),"JPEG",0,0,pdfW,pdfH); }
    const jobBlob = doc.output("blob");
    await ensureLogoPdfDataUrl();
    const orderDoc = new (getJsPDF())({ orientation:"portrait", unit:"in", format:"letter" });
    const currentPaper = paperTypes.find(p=>p.key===paperKey)||{label:paperKey};
    const isCustom=sheetKey==="custom";
    const [sw,sh] = isCustom?[customSize.w,customSize.h]:(PRESET_SHEETS[sheetKey]||[8.5,11]);
    addOrderSheetPage(orderDoc,{ jobType:"Paper Printing", details:[{label:"Paper:",value:currentPaper.label},{label:"Sheet:",value:`${sw}×${sh} in`},{label:"Print size:",value:`${prints.width}×${prints.height} in`},{label:"Qty:",value:totalPrintQty},{label:"Sheets:",value:sheetsNeeded}], totals:[{label:"Estimated total:",value:`$${totalPrice.toFixed(2)}`}], files:frontImage?[frontImage.name||"front"]:[] });
    await sendOrderEmail("sheets", jobBlob, orderDoc.output("blob"));
  };

  const orderLargeFormatJob = async () => {
    if (!lfRef.current) { alert("Please upload a large format image first."); return; }
    const pdfW=lfWidth, pdfH=lfHeight;
    const doc = new (getJsPDF())({ orientation:pdfW>=pdfH?"landscape":"portrait", unit:"in", format:[pdfW,pdfH] });
    doc.addImage(canvasToCompressedJpeg(lfRef.current,{maxDim:1800,quality:0.72}),"JPEG",0,0,pdfW,pdfH);
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
    const json = { paperTypes, sheetKeysForPaper, lfPaperTypes, sheetPricing:pricing, lfPricing, sheetQtyDiscounts:quantityDiscounts, lfQtyDiscounts:lfQuantityDiscounts, sheetMarkupPerPaper:markupPerPaper, lfMarkupPerPaper, backSideFactor, lfAddonPricing, blueprintPricing:bpPricing, previewMargin, previewSpacing };
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
        if (typeof json.backSideFactor==="number") setBackSideFactor(json.backSideFactor);
        if (json.lfAddonPricing) setLfAddonPricing(json.lfAddonPricing);
        if (json.blueprintPricing){ setBpPricing(json.blueprintPricing); localStorage.setItem(LS.BP_PRICING,JSON.stringify(json.blueprintPricing)); }
        if (typeof json.previewMargin==="number")  setPreviewMargin(json.previewMargin);
        if (typeof json.previewSpacing==="number") setPreviewSpacing(json.previewSpacing);
        alert("Pricing imported successfully.");
      } catch { alert("Invalid pricing.json file."); }
    };
    r.readAsText(file);
  };

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
            <button
              className="pc-btn pc-btn-secondary pc-btn-sm"
              onClick={() => setViewMode(v => v==="quote"?"tool":"quote")}
              style={{ gap:6 }}
            >
              <Icon.Quote />
              Quick Quote
            </button>
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
  { id:"impose",    label:"Impose",          icon:<BookletIcon />,  pill:"📖",  pillBg:"#dcfce7", activeColor:"var(--green)" },
].map(tab => (
              <button
                key={tab.id}
                className={`service-tab ${activeTab===tab.id ? (tab.id==="paper"?"active":tab.id==="large"?"active active-amber":tab.id==="impose"?"active active-green":"active active-blue") : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="tab-icon-pill" style={{ background: activeTab===tab.id ? pillActiveBg(tab.id) : tab.pillBg }}>{tab.pill}</span>
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
            <div className="admin-section-header">⚙️ Admin Pricing Panel</div>
            <div className="admin-section-body">
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
                      display:"flex", alignItems:"center", gap:8, padding:"6px 10px",
                      marginBottom:4, background:"var(--surface-2)", borderRadius:"var(--radius-sm)",
                      border:"1px solid var(--border)", fontSize:12,
                    }}>
                      <div style={{ flex:1 }}>
                        <strong>{pt.label}</strong>
                        <span style={{ color:"var(--text-muted)", marginLeft:8 }}>({pt.key})</span>
                        <span style={{ color:"var(--text-subtle)", marginLeft:8 }}>
                          Sheets: {(sheetKeysForPaper[pt.key]||[]).join(", ")||"none"}
                        </span>
                      </div>
                      {/* Toggle sheet sizes for this paper */}
                      <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
                        {Object.keys(PRESET_SHEETS).filter(k=>k!=="custom").map(sk => {
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
                          if (paperKey===pt.key) setPaperKey(paperTypes[0]?.key||"");
                        }}
                      >✕</button>
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
                      {Object.keys(PRESET_SHEETS).filter(k=>k!=="custom").map(sk => (
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
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════
            PANEL: SHEETS & PHOTOS
        ════════════════════════════════════════ */}
        {activeTab==="paper" && viewMode==="tool" && (
          <>
            {/* Step 1 — Print Setup */}
            <div className="pc-card">
              <CardHeader step="1" title="Print Setup" hint="Sheet size, paper type &amp; color" />
              <div className="pc-card-body">

                {/* Sheet size chips */}
                <div style={{ marginBottom:16 }}>
                  <label className="field-label">Sheet size</label>
                  <div className="chip-group">
                    {Object.keys(PRESET_SHEETS).map(sk => (
                      <Chip key={sk} label={sk==="custom"?"Custom":sk} selected={sheetKey===sk} onClick={()=>setSheetKey(sk)} />
                    ))}
                  </div>
                </div>

                {sheetKey==="custom" && (
                  <div className="grid-2" style={{ marginBottom:16 }}>
                    <div>
                      <label className="field-label">Custom width (in)</label>
                      <input className="pc-input" type="number" value={customSize.w} step="0.25" min="1" onChange={e=>setCustomSize(p=>({...p,w:+e.target.value||1}))} />
                    </div>
                    <div>
                      <label className="field-label">Custom height (in)</label>
                      <input className="pc-input" type="number" value={customSize.h} step="0.25" min="1" onChange={e=>setCustomSize(p=>({...p,h:+e.target.value||1}))} />
                    </div>
                  </div>
                )}

                <div className="grid-auto" style={{ marginBottom:16 }}>
                  <div>
                    <label className="field-label">Paper type</label>
                    <div className="pc-select-wrap">
                      <select className="pc-select" value={paperKey} onChange={e=>setPaperKey(e.target.value)}>
                        {paperTypes.map(pt => <option key={pt.key} value={pt.key}>{pt.label}</option>)}
                      </select>
                    </div>
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
                    <div><div className="toggle-label-text">Full bleed</div><div className="toggle-label-sub">Adds 0.125" on each side</div></div>
                    <Toggle checked={showBleed} onChange={setShowBleed} />
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
                    {frontFiles.map(f => (
                      <div
                        key={f.id}
                        className={`file-row ${selectedFrontId===f.id?"selected":""}`}
                        onClick={()=>setSelectedFrontId(f.id)}
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
                    ))}
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

            {/* Price Bar */}
            <PriceBar
              accentClass="price-bar-teal"
              totalClass="is-total"
              metrics={[
                { label:"Sheets needed", value:sheetsNeeded },
                { label:"Per sheet",     value:`$${perSheetTotal.toFixed(2)}` },
                { label:"Discount",      value:discountFactor<1?`${((1-discountFactor)*100).toFixed(1)}% off`:"—" },
                { label:"Estimated total", value:`$${totalPrice.toFixed(2)}`, big:true },
              ]}
              onDownload={downloadSheetPDF}
              onOrder={orderSheetJob}
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
                  <AddonCard emoji="🔩" name="Grommets" price={`$${(lfAddonPricing.grommetEach||0).toFixed(2)}/ea`} selected={lfGrommets} onToggle={()=>setLfGrommets(v=>!v)} />
                  <AddonCard emoji="🧊" name="Foam Core" price={`+$${lfAddonPricing.foamCore}`} selected={lfFoamCore} onToggle={()=>setLfFoamCore(v=>!v)} />
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
            />
          </>
        )}

        {/* ════════════════════════════════════════
            PANEL: IMPOSE (BOOKLET MAKER)
        ════════════════════════════════════════ */}
        {activeTab==="impose" && viewMode==="tool" && (
  <ImposePanel CardHeader={CardHeader} />
)}

      </div>{/* /content-wrap */}

      <MobileNumberBar open={numBarOpen} onDone={blurActive} onClear={clearActive} onNudge={nudgeActive} />

    </div>
  );
}

// ─── IMPOSE PANEL (sub-tool selector) ──────────────────────
function ImposePanel({ CardHeader }) {
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
      {imposeTool === "booklet" && <BookletMaker CardHeader={CardHeader} />}
      {imposeTool === "datamerge" && <DataMerge CardHeader={CardHeader} />}
    </>
  );
}

// Helper for tab active pill background
function pillActiveBg(id) {
  if (id==="paper")     return "#b3e8f0";
  if (id==="large")     return "#fde68a";
  if (id==="blueprint") return "#bfdbfe";
  if (id==="impose")    return "#bbf7d0";
  return "#e5e7eb";
}

export default PriceCalculatorApp;
