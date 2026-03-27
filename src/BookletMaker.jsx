// ─── BOOKLET MAKER ──────────────────────────────────────────
// Imposition tool: upload a PDF, generate saddle-stitch booklet
// Supports Ricoh Pro C5400s (auto-duplex, saddle-stitch finisher)
// ─────────────────────────────────────────────────────────────

import { useState, useRef, useCallback, useEffect } from "react";

// ── CONSTANTS ──────────────────────────────────────────────

const BOOKLET_PRESETS = [
  { key: "half-letter", label: '5.5 × 8.5" Booklet', finishedW: 5.5, finishedH: 8.5, sheetW: 8.5, sheetH: 11, desc: "Half-letter on 8.5×11 stock" },
  { key: "half-tabloid", label: '8.5 × 11" Booklet', finishedW: 8.5, finishedH: 11, sheetW: 11, sheetH: 17, desc: "Half-tabloid on 11×17 stock" },
  { key: "a5-on-a4", label: "A5 Booklet", finishedW: 5.83, finishedH: 8.27, sheetW: 8.27, sheetH: 11.69, desc: "A5 on A4 stock" },
];

// Ricoh Pro C5400s specs
const PRINTER_PROFILES = {
  ricoh: {
    name: "Ricoh Pro C5400s",
    maxW: 13, maxH: 19.2,
    minMargin: 0.157, // ~4mm non-printable
    duplex: true,
    saddleStitch: true,
    maxSaddleSheets: 15, // max sheets for saddle-stitch
  },
};

// ── SIGNATURE MATH ─────────────────────────────────────────

/**
 * For a saddle-stitch booklet, pages must be arranged in "signature" order.
 * A signature is one physical sheet with 4 page positions (front-left, front-right, back-left, back-right).
 * 
 * For N pages (padded to multiple of 4):
 * Sheet 1 front: [N, 1]  |  Sheet 1 back: [2, N-1]
 * Sheet 2 front: [N-2, 3]  |  Sheet 2 back: [4, N-3]
 * etc.
 * 
 * When folded and nested, pages read sequentially.
 */
function computeSignatures(totalPages) {
  // Pad to multiple of 4
  const padded = Math.ceil(totalPages / 4) * 4;
  const sheets = padded / 2; // each sheet holds 2 pages per side
  const numSheets = padded / 4;
  
  const signatures = [];
  for (let i = 0; i < numSheets; i++) {
    const frontLeft = padded - (2 * i);       // outside left (becomes right when folded)
    const frontRight = (2 * i) + 1;           // outside right (becomes left when folded)
    const backLeft = (2 * i) + 2;             // inside left
    const backRight = padded - (2 * i) - 1;   // inside right
    
    signatures.push({
      sheet: i + 1,
      front: { left: frontLeft, right: frontRight },
      back: { left: backLeft, right: backRight },
    });
  }
  return { signatures, paddedTotal: padded, numSheets };
}

// ── PDF PAGE RENDERER ──────────────────────────────────────

async function renderPdfPage(pdfDoc, pageNum, targetW, targetH) {
  if (pageNum > pdfDoc.numPages || pageNum < 1) {
    // Return blank canvas for padding pages
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(targetW);
    canvas.height = Math.round(targetH);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }
  
  const page = await pdfDoc.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  
  // Scale to fit target dimensions
  const scaleX = targetW / vp.width;
  const scaleY = targetH / vp.height;
  const scale = Math.min(scaleX, scaleY);
  
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  
  await page.render({
    canvasContext: canvas.getContext("2d"),
    viewport,
  }).promise;
  
  return canvas;
}

// ── BOOKLET PREVIEW RENDERER ───────────────────────────────

async function renderBookletPreview(pdfDoc, signatures, preset, previewCanvas, sheetIndex, side) {
  const ctx = previewCanvas.getContext("2d");
  const DPI = 150;
  const sheetPxW = Math.round(preset.sheetW * DPI);
  const sheetPxH = Math.round(preset.sheetH * DPI);
  const halfW = sheetPxW / 2;
  
  previewCanvas.width = sheetPxW;
  previewCanvas.height = sheetPxH;
  
  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sheetPxW, sheetPxH);
  
  const sig = signatures[sheetIndex];
  if (!sig) return;
  
  const pageSlots = side === "front"
    ? [sig.front.left, sig.front.right]
    : [sig.back.left, sig.back.right];
  
  // Render each half
  for (let i = 0; i < 2; i++) {
    const pageNum = pageSlots[i];
    const pagePxW = halfW - 4; // small gap
    const pagePxH = sheetPxH - 4;
    
    const pageCanvas = await renderPdfPage(pdfDoc, pageNum, pagePxW, pagePxH);
    
    // Center the rendered page in its half
    const offsetX = i * halfW + (halfW - pageCanvas.width) / 2;
    const offsetY = (sheetPxH - pageCanvas.height) / 2;
    
    ctx.drawImage(pageCanvas, offsetX, offsetY);
    
    // Draw page number label
    ctx.save();
    ctx.font = `bold ${Math.round(DPI * 0.12)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = pageNum > pdfDoc.numPages ? "rgba(200,200,200,0.6)" : "rgba(0,129,152,0.7)";
    ctx.fillText(
      pageNum > pdfDoc.numPages ? `(blank)` : `Page ${pageNum}`,
      i * halfW + halfW / 2,
      sheetPxH - DPI * 0.08
    );
    ctx.restore();
  }
  
  // Center fold line
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(halfW, 0);
  ctx.lineTo(halfW, sheetPxH);
  ctx.stroke();
  
  // Fold label
  ctx.font = `${Math.round(DPI * 0.08)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillText("← fold →", halfW, DPI * 0.15);
  ctx.restore();
}

// ── IMPOSED PDF GENERATOR ──────────────────────────────────

async function generateImposedPDF(pdfDoc, signatures, preset) {
  const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
  if (!jsPDF) throw new Error("jsPDF not loaded");
  
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "in",
    format: [preset.sheetW, preset.sheetH],
  });
  
  const halfW = preset.sheetW / 2;
  const margin = PRINTER_PROFILES.ricoh.minMargin;
  const renderScale = 300; // DPI for output
  
  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i];
    
    // Front side
    if (i > 0) doc.addPage([preset.sheetW, preset.sheetH], "landscape");
    
    for (const [slotIdx, pageNum] of [sig.front.left, sig.front.right].entries()) {
      const pagePxW = (halfW - margin * 2) * renderScale;
      const pagePxH = (preset.sheetH - margin * 2) * renderScale;
      const pageCanvas = await renderPdfPage(pdfDoc, pageNum, pagePxW, pagePxH);
      
      const x = slotIdx * halfW + margin;
      const y = margin;
      const w = halfW - margin * 2;
      const h = preset.sheetH - margin * 2;
      
      const imgData = pageCanvas.toDataURL("image/jpeg", 0.92);
      doc.addImage(imgData, "JPEG", x, y, w, h);
    }
    
    // Back side
    doc.addPage([preset.sheetW, preset.sheetH], "landscape");
    
    for (const [slotIdx, pageNum] of [sig.back.left, sig.back.right].entries()) {
      const pagePxW = (halfW - margin * 2) * renderScale;
      const pagePxH = (preset.sheetH - margin * 2) * renderScale;
      const pageCanvas = await renderPdfPage(pdfDoc, pageNum, pagePxW, pagePxH);
      
      const x = slotIdx * halfW + margin;
      const y = margin;
      const w = halfW - margin * 2;
      const h = preset.sheetH - margin * 2;
      
      const imgData = pageCanvas.toDataURL("image/jpeg", 0.92);
      doc.addImage(imgData, "JPEG", x, y, w, h);
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

const InfoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const PrinterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
  </svg>
);

// ── COMPONENT ──────────────────────────────────────────────

export default function BookletMaker({ CardHeader }) {
  // State
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [presetKey, setPresetKey] = useState("half-letter");
  const [previewSheet, setPreviewSheet] = useState(0);
  const [previewSide, setPreviewSide] = useState("front");
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showCropMarks, setShowCropMarks] = useState(false);
  
  const previewRef = useRef(null);
  const fileInputRef = useRef(null);
  
  const preset = BOOKLET_PRESETS.find(p => p.key === presetKey) || BOOKLET_PRESETS[0];
  const { signatures, paddedTotal, numSheets } = pageCount > 0
    ? computeSignatures(pageCount)
    : { signatures: [], paddedTotal: 0, numSheets: 0 };
  
  const printer = PRINTER_PROFILES.ricoh;
  const withinSaddleLimit = numSheets <= printer.maxSaddleSheets;
  const withinPaperSize = preset.sheetW <= printer.maxW && preset.sheetH <= printer.maxH;
  const blankPages = paddedTotal - pageCount;
  
  // ── PDF Loading ──
  const loadPdf = useCallback(async (file) => {
    setLoading(true);
    setPdfFile(file);
    try {
      const lib = window.pdfjsLib;
      if (!lib) throw new Error("PDF.js not loaded");
      const ab = await file.arrayBuffer();
      const doc = await lib.getDocument({ data: ab }).promise;
      setPdfDoc(doc);
      setPageCount(doc.numPages);
      setPreviewSheet(0);
      setPreviewSide("front");
    } catch (err) {
      alert("Could not load PDF: " + err.message);
      setPdfFile(null);
      setPdfDoc(null);
      setPageCount(0);
    }
    setLoading(false);
  }, []);
  
  // ── Preview rendering ──
  useEffect(() => {
    if (!pdfDoc || !previewRef.current || signatures.length === 0) return;
    renderBookletPreview(pdfDoc, signatures, preset, previewRef.current, previewSheet, previewSide);
  }, [pdfDoc, signatures.length, preset.key, previewSheet, previewSide]);
  
  // ── Generate imposed PDF ──
  const handleGenerate = useCallback(async () => {
    if (!pdfDoc) return;
    setGenerating(true);
    try {
      const doc = await generateImposedPDF(pdfDoc, signatures, preset);
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `booklet_imposed_${preset.key}_${pageCount}pp.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      alert("Error generating PDF: " + err.message);
    }
    setGenerating(false);
  }, [pdfDoc, signatures, preset, pageCount]);
  
  // ── Drag & Drop ──
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
      loadPdf(file);
    }
  }, [loadPdf]);
  
  const handleFileInput = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) loadPdf(file);
    e.target.value = "";
  }, [loadPdf]);
  
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
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {BOOKLET_PRESETS.map(p => (
              <button
                key={p.key}
                className={`pc-btn ${presetKey === p.key ? "pc-btn-primary" : "pc-btn-secondary"}`}
                style={{ minWidth: 160, textAlign: "left", padding: "10px 16px", height: "auto" }}
                onClick={() => setPresetKey(p.key)}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{p.label}</div>
                <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{p.desc}</div>
              </button>
            ))}
          </div>
          
          {/* Printer compatibility info */}
          <div className="callout callout-info" style={{ marginTop: 14 }}>
            <span className="callout-icon"><PrinterIcon /></span>
            <div>
              <strong>{printer.name}</strong> — Stock size: {preset.sheetW}×{preset.sheetH}" (landscape)
              {printer.saddleStitch && " · Saddle-stitch ready"}
              {printer.duplex && " · Auto-duplex"}
              {!withinPaperSize && (
                <span style={{ color: "#dc2626", fontWeight: 600 }}> ⚠ Stock exceeds printer max ({printer.maxW}×{printer.maxH}")</span>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Step 2 — Upload PDF */}
      <div className="pc-card">
        <CardHeader
          step="2"
          stepClass="step-num-green"
          title="Upload PDF"
          hint="Drop your document to impose for booklet printing"
        />
        <div className="pc-card-body">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={handleFileInput}
          />
          
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragOver ? "var(--green)" : pdfFile ? "var(--green)" : "var(--border-strong)"}`,
              borderRadius: "var(--radius)",
              padding: pdfFile ? "14px 18px" : "32px 18px",
              textAlign: "center",
              cursor: "pointer",
              background: dragOver ? "var(--green-light)" : pdfFile ? "var(--green-light)" : "var(--surface-2)",
              transition: "all 0.2s ease",
            }}
          >
            {loading ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading PDF...</div>
            ) : pdfFile ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: "var(--green)", color: "white",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700,
                }}>PDF</div>
                <div style={{ textAlign: "left", flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{pdfFile.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {pageCount} page{pageCount !== 1 ? "s" : ""} · {(pdfFile.size / 1024).toFixed(0)} KB
                  </div>
                </div>
                <button
                  className="pc-btn pc-btn-secondary pc-btn-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPdfFile(null); setPdfDoc(null); setPageCount(0);
                  }}
                >Change</button>
              </div>
            ) : (
              <>
                <UploadIcon />
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginTop: 8 }}>
                  Drop a PDF here or click to browse
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  PDF files only · Multi-page documents supported
                </div>
              </>
            )}
          </div>
          
          {/* Stats row */}
          {pageCount > 0 && (
            <div style={{
              display: "flex", gap: 16, flexWrap: "wrap",
              marginTop: 14, padding: "10px 14px",
              background: "var(--surface-3)", borderRadius: "var(--radius-sm)",
              fontSize: 12,
            }}>
              <div><span style={{ color: "var(--text-muted)" }}>Pages:</span> <strong>{pageCount}</strong></div>
              <div><span style={{ color: "var(--text-muted)" }}>Padded to:</span> <strong>{paddedTotal}</strong></div>
              <div><span style={{ color: "var(--text-muted)" }}>Physical sheets:</span> <strong>{numSheets}</strong></div>
              <div><span style={{ color: "var(--text-muted)" }}>Blank pages added:</span> <strong>{blankPages}</strong></div>
              {!withinSaddleLimit && (
                <div style={{ color: "#d97706", fontWeight: 600 }}>
                  ⚠ Exceeds saddle-stitch limit ({printer.maxSaddleSheets} sheets) — consider perfect binding
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Step 3 — Preview & Download */}
      {pdfDoc && signatures.length > 0 && (
        <div className="pc-card">
          <CardHeader
            step="3"
            stepClass="step-num-green"
            title="Imposition Preview"
            hint={`${numSheets} sheet${numSheets !== 1 ? "s" : ""}, front & back — ${preset.sheetW}×${preset.sheetH}" landscape`}
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
                  {previewSide === "front"
                    ? `${signatures[previewSheet].front.left}${signatures[previewSheet].front.left > pageCount ? " (blank)" : ""} & ${signatures[previewSheet].front.right}`
                    : `${signatures[previewSheet].back.left} & ${signatures[previewSheet].back.right}${signatures[previewSheet].back.right > pageCount ? " (blank)" : ""}`
                  }
                </div>
              </div>
              
              <button
                className="pc-btn pc-btn-secondary pc-btn-sm pc-btn-icon"
                disabled={previewSheet >= numSheets - 1}
                onClick={() => setPreviewSheet(s => Math.min(numSheets - 1, s + 1))}
              ><ChevronRight /></button>
            </div>
            
            {/* Front/Back toggle */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12, justifyContent: "center" }}>
              <button
                className={`pc-btn pc-btn-sm ${previewSide === "front" ? "pc-btn-primary" : "pc-btn-secondary"}`}
                onClick={() => setPreviewSide("front")}
              >Front</button>
              <button
                className={`pc-btn pc-btn-sm ${previewSide === "back" ? "pc-btn-primary" : "pc-btn-secondary"}`}
                onClick={() => setPreviewSide("back")}
              >Back</button>
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
                gap: 6,
                fontSize: 11,
              }}>
                {signatures.map((sig, idx) => (
                  <div
                    key={idx}
                    onClick={() => { setPreviewSheet(idx); setPreviewSide("front"); }}
                    style={{
                      padding: "8px 10px",
                      background: previewSheet === idx ? "var(--teal-light)" : "var(--surface-2)",
                      border: `1px solid ${previewSheet === idx ? "var(--teal)" : "var(--border)"}`,
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>Sheet {idx + 1}</div>
                    <div style={{ color: "var(--text-muted)" }}>
                      Front: [{sig.front.left}, {sig.front.right}] · Back: [{sig.back.left}, {sig.back.right}]
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Generate Button / Info Bar */}
      {pdfDoc && (
        <div className="price-bar" style={{ position: "sticky", bottom: 0, zIndex: 50 }}>
          <div className="price-bar-inner price-bar-green" style={{ justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
              <div className="price-metric">
                <div className="price-metric-label">Sheets</div>
                <div className="price-metric-val">{numSheets}</div>
              </div>
              <div className="price-metric">
                <div className="price-metric-label">Finished size</div>
                <div className="price-metric-val">{preset.finishedW}×{preset.finishedH}"</div>
              </div>
              <div className="price-metric">
                <div className="price-metric-label">Stock</div>
                <div className="price-metric-val">{preset.sheetW}×{preset.sheetH}"</div>
              </div>
              <div className="price-metric">
                <div className="price-metric-label">Printer</div>
                <div className="price-metric-val" style={{ fontSize: 12 }}>Ricoh C5400s</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="pc-btn pc-btn-success"
                disabled={generating || !withinPaperSize}
                onClick={handleGenerate}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <DownloadIcon />
                {generating ? "Generating..." : "Download Imposed PDF"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Also export the icon for the tab bar
export { BookletIcon };
