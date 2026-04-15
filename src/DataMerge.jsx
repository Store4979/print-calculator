// ─── DATA MERGE / VARIABLE DATA PRINTING ────────────────────
// Sequential numbering + CSV data merge with click-to-place fields
// Template-based: upload a PDF/image, click to place variable fields
// ─────────────────────────────────────────────────────────────

import { useState, useRef, useCallback, useEffect, useMemo } from "react";

// ── CONSTANTS ──────────────────────────────────────────────

const FIELD_TYPES = [
  { key: "number", label: "Number", desc: "Sequential numbering (tickets, raffle, etc.)" },
  { key: "data", label: "CSV Data", desc: "Merge from spreadsheet column" },
  { key: "static", label: "Static Text", desc: "Same text on every record" },
];

const FONT_OPTIONS = [
  { key: "Helvetica", label: "Helvetica" },
  { key: "Times-Roman", label: "Times Roman" },
  { key: "Courier", label: "Courier" },
  { key: "Arial", label: "Arial" },
  { key: "Georgia", label: "Georgia" },
  { key: "Verdana", label: "Verdana" },
  { key: "Trebuchet MS", label: "Trebuchet MS" },
  { key: "Impact", label: "Impact" },
  { key: "Comic Sans MS", label: "Comic Sans" },
  { key: "Palatino", label: "Palatino" },
  { key: "Garamond", label: "Garamond" },
  { key: "Bookman", label: "Bookman" },
  { key: "Tahoma", label: "Tahoma" },
  { key: "Lucida Console", label: "Lucida Console" },
  { key: "Monaco", label: "Monaco" },
];

const ALIGN_OPTIONS = [
  { key: "left", label: "Left" },
  { key: "center", label: "Center" },
  { key: "right", label: "Right" },
];

const DEFAULT_FIELD = {
  type: "number",
  x: 0.5,        // position in inches from left
  y: 0.5,        // position in inches from top
  fontSize: 12,
  fontFamily: "Helvetica",
  fontWeight: "bold",
  fontStyle: "normal",
  color: "#000000",
  align: "center",
  // Number-specific
  prefix: "",
  suffix: "",
  startNum: 1,
  endNum: 100,
  padding: 3,     // zero-pad to N digits
  // Data-specific
  csvColumn: "",
  // Static-specific
  staticText: "",
};

// ── CSV PARSER ─────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseLine = (line) => {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(l => {
    const vals = parseLine(l);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
    return obj;
  });
  return { headers, rows };
}

// ── TEMPLATE RENDERER ──────────────────────────────────────

async function loadTemplate(file) {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error("PDF.js not loaded");
    const ab = await file.arrayBuffer();
    const doc = await lib.getDocument({ data: ab }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;

    // Get page size in inches (PDF points / 72)
    const baseVp = page.getViewport({ scale: 1 });
    const widthIn = baseVp.width / 72;
    const heightIn = baseVp.height / 72;

    return {
      type: "pdf",
      image: canvas.toDataURL("image/png"),
      widthIn,
      heightIn,
      pxW: vp.width,
      pxH: vp.height,
      doc,
    };
  } else {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Assume 150 DPI for images without metadata
        const dpi = 150;
        resolve({
          type: "image",
          image: img.src,
          widthIn: img.naturalWidth / dpi,
          heightIn: img.naturalHeight / dpi,
          pxW: img.naturalWidth,
          pxH: img.naturalHeight,
          imgEl: img,
        });
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = URL.createObjectURL(file);
    });
  }
}

// ── RECORD GENERATOR ───────────────────────────────────────

function generateRecords(fields, csvData) {
  // Determine record count from fields
  let recordCount = 0;

  const hasNumberField = fields.some(f => f.type === "number");
  const hasDataField = fields.some(f => f.type === "data");

  if (hasDataField && csvData.rows.length > 0) {
    recordCount = csvData.rows.length;
  } else if (hasNumberField) {
    const numField = fields.find(f => f.type === "number");
    if (numField) recordCount = Math.max(1, numField.endNum - numField.startNum + 1);
  }

  if (recordCount === 0) recordCount = 1;

  const records = [];
  for (let i = 0; i < recordCount; i++) {
    const rec = {};
    fields.forEach((field, fIdx) => {
      const key = `field_${fIdx}`;
      if (field.type === "number") {
        const num = field.startNum + (i % (field.endNum - field.startNum + 1));
        rec[key] = field.prefix + String(num).padStart(field.padding, "0") + field.suffix;
      } else if (field.type === "data") {
        const row = csvData.rows[i] || {};
        rec[key] = row[field.csvColumn] || "";
      } else if (field.type === "static") {
        rec[key] = field.staticText || "";
      }
    });
    records.push(rec);
  }
  return records;
}

// ── ICONS ──────────────────────────────────────────────────

const DataMergeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M9 14l2 2 4-4" />
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

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
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

const MoveIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/>
    <polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/>
    <line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>
  </svg>
);

const HashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>
    <line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>
  </svg>
);

const TableIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
    <line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/>
  </svg>
);

// ── FIELD EDITOR PANEL (simplified — font styling is shared) ─

function FieldEditor({ field, index, csvHeaders, onUpdate, onRemove, onSelect, isSelected }) {
  const update = (key, val) => onUpdate(index, { ...field, [key]: val });

  return (
    <div
      onClick={() => onSelect(index)}
      style={{
        padding: "10px 12px", marginBottom: 6,
        background: isSelected ? "var(--green-light, #dcfce7)" : "var(--surface-2)",
        borderRadius: "var(--radius-sm)",
        border: `2px solid ${isSelected ? "var(--green)" : "var(--border)"}`,
        fontSize: 12, transition: "border-color 0.15s", cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 20, height: 20, borderRadius: "50%", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 10,
            fontWeight: 700, background: "var(--green)", color: "white",
          }}>{index + 1}</span>
          <input className="pc-input" type="text" value={field.label || ""}
            placeholder={`Field ${index + 1}`}
            onClick={e => e.stopPropagation()}
            onChange={e => update("label", e.target.value)}
            style={{ width: 130, height: 26, fontSize: 12, fontWeight: 600, padding: "2px 6px" }} />
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {/* Type selector inline */}
          {FIELD_TYPES.map(ft => (
            <button key={ft.key}
              className={`pc-btn pc-btn-xs ${field.type === ft.key ? "pc-btn-primary" : "pc-btn-secondary"}`}
              onClick={e => { e.stopPropagation(); update("type", ft.key); }}
              style={{ fontSize: 10, padding: "2px 6px" }}
            >{ft.label}</button>
          ))}
          <button
            className="pc-btn pc-btn-icon"
            style={{ width: 22, height: 22, padding: 0, background: "transparent", border: "none", color: "#dc2626", marginLeft: 4 }}
            onClick={e => { e.stopPropagation(); onRemove(index); }}
            title="Remove field"
          ><XIcon /></button>
        </div>
      </div>

      {/* Type-specific config */}
      {field.type === "number" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
          <div style={{ flex: 1, minWidth: 55 }}>
            <label className="field-label">Start</label>
            <input className="pc-input" type="number" value={field.startNum} min="0"
              onChange={e => update("startNum", +e.target.value || 0)} style={{ width: "100%", height: 26, fontSize: 11 }} />
          </div>
          <div style={{ flex: 1, minWidth: 55 }}>
            <label className="field-label">End</label>
            <input className="pc-input" type="number" value={field.endNum} min={field.startNum}
              onChange={e => update("endNum", +e.target.value || field.startNum)} style={{ width: "100%", height: 26, fontSize: 11 }} />
          </div>
          <div style={{ flex: 1, minWidth: 45 }}>
            <label className="field-label">Digits</label>
            <input className="pc-input" type="number" value={field.padding} min="1" max="8"
              onChange={e => update("padding", Math.max(1, +e.target.value || 1))} style={{ width: "100%", height: 26, fontSize: 11 }} />
          </div>
          <div style={{ flex: 1, minWidth: 45 }}>
            <label className="field-label">Prefix</label>
            <input className="pc-input" type="text" value={field.prefix} placeholder="#"
              onChange={e => update("prefix", e.target.value)} style={{ width: "100%", height: 26, fontSize: 11 }} />
          </div>
          <div style={{ flex: 1, minWidth: 45 }}>
            <label className="field-label">Suffix</label>
            <input className="pc-input" type="text" value={field.suffix}
              onChange={e => update("suffix", e.target.value)} style={{ width: "100%", height: 26, fontSize: 11 }} />
          </div>
        </div>
      )}

      {field.type === "data" && (
        <div onClick={e => e.stopPropagation()}>
          {csvHeaders.length > 0 ? (
            <select className="pc-select" value={field.csvColumn}
              onChange={e => update("csvColumn", e.target.value)} style={{ width: "100%", height: 28, fontSize: 11 }}>
              <option value="">— Select CSV column —</option>
              {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          ) : (
            <div style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 11 }}>Upload a CSV first</div>
          )}
        </div>
      )}

      {field.type === "static" && (
        <div onClick={e => e.stopPropagation()}>
          <input className="pc-input" type="text" value={field.staticText} placeholder="Enter text..."
            onChange={e => update("staticText", e.target.value)} style={{ width: "100%", height: 26, fontSize: 11 }} />
        </div>
      )}
    </div>
  );
}

// ── MAIN COMPONENT ─────────────────────────────────────────

export default function DataMerge({ CardHeader, pricingProps }) {
  // Pricing props from parent
  const { paperTypes=[], sheetKeysForPaper={}, pricing={}, quantityDiscounts=[], backSideFactor=0.5, getSheetDiscountFactor } = pricingProps || {};
  
  // Template state
  const [templateFile, setTemplateFile] = useState(null);
  const [template, setTemplate] = useState(null); // { image, widthIn, heightIn, pxW, pxH, ... }
  const [loading, setLoading] = useState(false);

  // Fields
  const [fields, setFields] = useState([]);
  const [selectedField, setSelectedField] = useState(null); // index
  const [placingField, setPlacingField] = useState(false);  // click-to-place mode

  // CSV
  const [csvData, setCsvData] = useState({ headers: [], rows: [] });
  const [csvFileName, setCsvFileName] = useState("");

  // Preview
  const [previewRecord, setPreviewRecord] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  
  // Pricing state
  const [selectedPaperKey, setSelectedPaperKey] = useState(() => paperTypes[0]?.key || "");
  const [selectedSheetKey, setSelectedSheetKey] = useState("8.5x11");
  const [colorMode, setColorMode] = useState("color");
  
  // Shared field style (applies to ALL fields uniformly)
  const [fieldStyle, setFieldStyle] = useState({
    fontFamily: "Helvetica",
    fontSize: 12,
    fontWeight: "bold",
    fontStyle: "normal",
    color: "#000000",
    align: "center",
    lineSpacing: 1.4,
  });
  
  // Text frame position & size (single frame holds all fields)
  const [frame, setFrame] = useState({
    x: 0.5,
    y: 0.5,
    width: 3,
  });
  
  const updateStyle = (key, val) => setFieldStyle(prev => ({ ...prev, [key]: val }));
  
  // When shared style changes, update all existing fields
  const applyStyleToAll = useCallback(() => {
    setFields(prev => prev.map(f => ({
      ...f,
      fontFamily: fieldStyle.fontFamily,
      fontSize: fieldStyle.fontSize,
      fontWeight: fieldStyle.fontWeight,
      fontStyle: fieldStyle.fontStyle,
      color: fieldStyle.color,
      align: fieldStyle.align,
    })));
  }, [fieldStyle]);
  
  // Auto-apply when style changes
  useEffect(() => {
    if (fields.length > 0) applyStyleToAll();
  }, [fieldStyle]);

  const previewCanvasRef = useRef(null);
  const templateInputRef = useRef(null);
  const csvInputRef = useRef(null);
  const previewContainerRef = useRef(null);

  // Computed
  const records = useMemo(() => generateRecords(fields, csvData), [fields, csvData]);
  const totalRecords = records.length;
  const hasNumberField = fields.some(f => f.type === "number");
  const hasDataField = fields.some(f => f.type === "data");

  // Pricing calculations
  const availableSheetKeys = sheetKeysForPaper[selectedPaperKey] || [];
  const normalizeEntry = (e = {}) => ({
    priceColor: Number(e.priceColor || 0), priceBW: Number(e.priceBW || 0),
  });
  const selectedEntry = normalizeEntry((pricing[selectedPaperKey] || {})[selectedSheetKey] || {});
  const perSheetPrice = colorMode === "color" ? selectedEntry.priceColor : selectedEntry.priceBW;
  const sheetsNeeded = totalRecords;
  const discountFactor = getSheetDiscountFactor ? getSheetDiscountFactor(sheetsNeeded) : 1;
  const totalPrice = perSheetPrice * sheetsNeeded * discountFactor;
  const hasPricing = paperTypes.length > 0 && perSheetPrice > 0;
  
  // Auto-select first available sheet key when paper changes
  useEffect(() => {
    const keys = sheetKeysForPaper[selectedPaperKey] || [];
    if (keys.length > 0 && !keys.includes(selectedSheetKey)) {
      setSelectedSheetKey(keys[0]);
    }
  }, [selectedPaperKey]);

  // ── Template loading ──
  const handleTemplateFile = useCallback(async (file) => {
    setLoading(true);
    setTemplateFile(file);
    try {
      const tpl = await loadTemplate(file);
      setTemplate(tpl);
      setFields([]);
      setSelectedField(null);
    } catch (err) {
      alert("Failed to load template: " + err.message);
      setTemplateFile(null);
      setTemplate(null);
    }
    setLoading(false);
  }, []);

  // ── CSV loading ──
  const handleCSVFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseCSV(e.target.result);
      setCsvData(parsed);
      setCsvFileName(file.name);
    };
    reader.readAsText(file);
  }, []);

  // ── Field management ──
  const addField = useCallback(() => {
    const newField = {
      ...DEFAULT_FIELD,
      ...fieldStyle,
      label: `Field ${fields.length + 1}`,
      x: template ? template.widthIn / 2 : 2,
      y: template ? 0.5 + fields.length * 0.4 : 2,
    };
    setFields(prev => [...prev, newField]);
    setSelectedField(fields.length);
    setPlacingField(true);
  }, [fields.length, template, fieldStyle]);

  const updateField = useCallback((idx, updated) => {
    setFields(prev => prev.map((f, i) => i === idx ? updated : f));
  }, []);

  const removeField = useCallback((idx) => {
    setFields(prev => prev.filter((_, i) => i !== idx));
    setSelectedField(null);
  }, []);

  // ── Click to place / Drag frame ──
  const draggingRef = useRef(null); // { mode: "move"|"resize", startX, startY, origX, origY, origW }
  
  const getInchesFromEvent = useCallback((e) => {
    if (!template || !previewContainerRef.current) return null;
    const rect = previewContainerRef.current.getBoundingClientRect();
    const scaleX = template.widthIn / rect.width;
    const scaleY = template.heightIn / rect.height;
    return {
      x: +(((e.clientX || e.touches?.[0]?.clientX || 0) - rect.left) * scaleX).toFixed(3),
      y: +(((e.clientY || e.touches?.[0]?.clientY || 0) - rect.top) * scaleY).toFixed(3),
    };
  }, [template]);

  const handlePreviewMouseDown = useCallback((e) => {
    if (!template || !previewContainerRef.current) return;
    const pos = getInchesFromEvent(e);
    if (!pos) return;
    
    // Check if clicking near the resize handle (bottom-right corner of frame)
    const fsPx72 = fieldStyle.fontSize;
    const lineH = fsPx72 * (fieldStyle.lineSpacing || 1.4) / 72;
    const frameLines = fields.length || 1;
    const frameH = frameLines * lineH + fsPx72 / 72 * 0.3;
    const handleX = frame.x + frame.width;
    const handleY = frame.y + frameH;
    
    if (Math.abs(pos.x - handleX) < 0.15 && Math.abs(pos.y - handleY) < 0.15) {
      draggingRef.current = { mode: "resize", startX: pos.x, origW: frame.width };
      e.preventDefault();
      return;
    }
    
    // Check if clicking within the frame area → drag to move
    if (pos.x >= frame.x && pos.x <= frame.x + frame.width &&
        pos.y >= frame.y && pos.y <= frame.y + frameH) {
      draggingRef.current = { mode: "move", startX: pos.x, startY: pos.y, origX: frame.x, origY: frame.y };
      e.preventDefault();
      return;
    }
    
    // Click outside frame → move frame to clicked position
    setFrame(prev => ({ ...prev, x: +pos.x.toFixed(3), y: +pos.y.toFixed(3) }));
  }, [template, fields.length, fieldStyle, frame, getInchesFromEvent]);
  
  const handlePreviewMouseMove = useCallback((e) => {
    if (!draggingRef.current || !template) return;
    const pos = getInchesFromEvent(e);
    if (!pos) return;
    
    if (draggingRef.current.mode === "move") {
      const { startX, startY, origX, origY } = draggingRef.current;
      const dx = pos.x - startX;
      const dy = pos.y - startY;
      setFrame(prev => ({
        ...prev,
        x: +Math.max(0, Math.min(template.widthIn - prev.width, origX + dx)).toFixed(3),
        y: +Math.max(0, origY + dy).toFixed(3),
      }));
    } else if (draggingRef.current.mode === "resize") {
      const { startX, origW } = draggingRef.current;
      const dx = pos.x - startX;
      const newW = Math.max(0.5, origW + dx);
      setFrame(prev => ({ ...prev, width: +Math.min(template.widthIn - prev.x, newW).toFixed(3) }));
    }
  }, [template, getInchesFromEvent]);
  
  const handlePreviewMouseUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  // ── Compute text frame lines for a given record ──
  const getFrameLines = useCallback((recordIdx) => {
    const rec = records[recordIdx] || {};
    return fields.map((field, fIdx) => {
      const key = `field_${fIdx}`;
      const text = rec[key] || (field.type === "number" ? `${field.prefix}${"0".repeat(field.padding)}${field.suffix}` : "");
      return { text, label: field.label || `Field ${fIdx + 1}`, fieldIdx: fIdx };
    }).filter(l => l.text); // skip empty lines
  }, [fields, records]);

  // ── Preview rendering (text frame model) ──
  useEffect(() => {
    if (!template || !previewCanvasRef.current) return;

    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext("2d");
    const DPI = 150;
    const w = Math.round(template.widthIn * DPI);
    const h = Math.round(template.heightIn * DPI);
    canvas.width = w;
    canvas.height = h;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, w, h);

      if (fields.length === 0) return;

      const fsPx = fieldStyle.fontSize * (DPI / 72);
      const lineHeight = fsPx * (fieldStyle.lineSpacing || 1.4);
      const frameXPx = frame.x * DPI;
      const frameYPx = frame.y * DPI;
      const frameWPx = frame.width * DPI;
      const fontStyleStr = fieldStyle.fontStyle === "italic" ? "italic " : "";
      ctx.font = `${fontStyleStr}${fieldStyle.fontWeight} ${Math.round(fsPx)}px ${fieldStyle.fontFamily}, sans-serif`;

      const lines = getFrameLines(previewRecord);

      // Draw frame outline
      const totalH = Math.max(lineHeight, lines.length * lineHeight);
      ctx.save();
      ctx.strokeStyle = "rgba(0, 160, 100, 0.4)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(frameXPx, frameYPx, frameWPx, totalH + fsPx * 0.3);
      ctx.setLineDash([]);

      // Draw resize handle (bottom-right corner)
      ctx.fillStyle = "rgba(0, 160, 100, 0.6)";
      ctx.fillRect(frameXPx + frameWPx - 6, frameYPx + totalH + fsPx * 0.3 - 6, 8, 8);

      // Draw each line
      lines.forEach((line, idx) => {
        const yPx = frameYPx + fsPx * 0.6 + idx * lineHeight;
        let xPx = frameXPx;
        if (fieldStyle.align === "center") xPx = frameXPx + frameWPx / 2;
        else if (fieldStyle.align === "right") xPx = frameXPx + frameWPx;

        ctx.fillStyle = fieldStyle.color;
        ctx.textAlign = fieldStyle.align;
        ctx.textBaseline = "middle";
        
        // Word wrap within frame width
        const words = line.text.split(" ");
        let currentLine = "";
        let subLineIdx = 0;
        for (let wi = 0; wi < words.length; wi++) {
          const testLine = currentLine ? currentLine + " " + words[wi] : words[wi];
          const metrics = ctx.measureText(testLine);
          if (metrics.width > frameWPx && currentLine) {
            ctx.fillText(currentLine, xPx, yPx + subLineIdx * lineHeight);
            currentLine = words[wi];
            subLineIdx++;
          } else {
            currentLine = testLine;
          }
        }
        ctx.fillText(currentLine, xPx, yPx + subLineIdx * lineHeight);

        // Highlight selected field's line
        if (selectedField === line.fieldIdx) {
          const textW = ctx.measureText(line.text).width;
          let hlX = frameXPx;
          if (fieldStyle.align === "center") hlX = frameXPx + (frameWPx - textW) / 2;
          else if (fieldStyle.align === "right") hlX = frameXPx + frameWPx - textW;
          ctx.fillStyle = "rgba(0, 180, 100, 0.1)";
          ctx.fillRect(hlX - 2, yPx - fsPx * 0.5, textW + 4, fsPx);
        }
      });

      ctx.restore();
    };
    img.src = template.image;
  }, [template, fields, records, previewRecord, selectedField, fieldStyle, frame, getFrameLines]);

  // ── PDF Generation (text frame model) ──
  const handleGenerate = useCallback(async () => {
    if (!template || records.length === 0) return;
    setGenerating(true);

    try {
      const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
      if (!jsPDF) throw new Error("jsPDF not loaded");

      const orient = template.widthIn >= template.heightIn ? "landscape" : "portrait";
      const doc = new jsPDF({
        orientation: orient,
        unit: "in",
        format: [template.widthIn, template.heightIn],
      });

      let fontStylePdf = fieldStyle.fontWeight === "bold" ? "bold" : "normal";
      if (fieldStyle.fontStyle === "italic") fontStylePdf = fieldStyle.fontWeight === "bold" ? "bolditalic" : "italic";

      const lineHeightIn = (fieldStyle.fontSize / 72) * (fieldStyle.lineSpacing || 1.4);

      for (let r = 0; r < records.length; r++) {
        if (r > 0) doc.addPage([template.widthIn, template.heightIn], orient);

        // Add template image
        doc.addImage(template.image, "PNG", 0, 0, template.widthIn, template.heightIn);

        // Set font once for all fields
        doc.setFont(fieldStyle.fontFamily, fontStylePdf);
        doc.setFontSize(fieldStyle.fontSize);
        doc.setTextColor(fieldStyle.color);

        // Render each field as a line in the frame
        const rec = records[r];
        let currentY = frame.y + fieldStyle.fontSize / 72 * 0.6;
        
        fields.forEach((field, fIdx) => {
          const key = `field_${fIdx}`;
          const text = rec[key] || "";
          if (!text) return;

          let alignOpt = {};
          let xPos = frame.x;
          if (fieldStyle.align === "center") { xPos = frame.x + frame.width / 2; alignOpt = { align: "center" }; }
          else if (fieldStyle.align === "right") { xPos = frame.x + frame.width; alignOpt = { align: "right" }; }

          // Word wrap within frame width
          const words = text.split(" ");
          let currentLine = "";
          for (let wi = 0; wi < words.length; wi++) {
            const testLine = currentLine ? currentLine + " " + words[wi] : words[wi];
            const testW = doc.getTextWidth(testLine);
            if (testW > frame.width && currentLine) {
              doc.text(currentLine, xPos, currentY, alignOpt);
              currentY += lineHeightIn;
              currentLine = words[wi];
            } else {
              currentLine = testLine;
            }
          }
          doc.text(currentLine, xPos, currentY, alignOpt);
          currentY += lineHeightIn;
        });
      }

      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `data_merge_${records.length}_records.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      alert("Error generating PDF: " + err.message);
    }
    setGenerating(false);
  }, [template, records, fields, fieldStyle, frame]);

  // ── Render ──
  return (
    <>
      {/* Step 1 — Upload Template */}
      <div className="pc-card">
        <CardHeader
          step="1"
          stepClass="step-num-green"
          title="Upload Template"
          hint="Upload a ticket, envelope, badge, or any design as your base template"
        />
        <div className="pc-card-body">
          <input
            ref={templateInputRef}
            type="file"
            accept="application/pdf,image/*"
            style={{ display: "none" }}
            onChange={e => { if (e.target.files?.[0]) handleTemplateFile(e.target.files[0]); e.target.value = ""; }}
          />

          <div
            onClick={() => templateInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault(); setDragOver(false);
              const file = e.dataTransfer?.files?.[0];
              if (file) handleTemplateFile(file);
            }}
            style={{
              border: `2px dashed ${dragOver ? "var(--green)" : template ? "var(--green)" : "var(--border-strong)"}`,
              borderRadius: "var(--radius)", textAlign: "center", cursor: "pointer",
              padding: template ? "14px 18px" : "32px 18px",
              background: dragOver ? "var(--green-light)" : template ? "var(--green-light)" : "var(--surface-2)",
              transition: "all 0.2s",
            }}
          >
            {loading ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading template...</div>
            ) : template ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8, background: "var(--green)", color: "white",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700,
                }}>{template.type === "pdf" ? "PDF" : "IMG"}</div>
                <div style={{ textAlign: "left", flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{templateFile?.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {template.widthIn.toFixed(1)} × {template.heightIn.toFixed(1)}" · {(templateFile?.size / 1024).toFixed(0)} KB
                  </div>
                </div>
                <button className="pc-btn pc-btn-secondary pc-btn-xs" onClick={e => {
                  e.stopPropagation(); setTemplate(null); setTemplateFile(null); setFields([]); setCsvData({ headers: [], rows: [] });
                }}>Change</button>
              </div>
            ) : (
              <>
                <UploadIcon />
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginTop: 8 }}>
                  Drop a template here or click to browse
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  PDF or image · This is the base design that gets repeated for each record
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Step 2 — Paper & Pricing */}
      {template && (
        <div className="pc-card">
          <CardHeader
            step="2"
            stepClass="step-num-green"
            title="Paper & Pricing"
            hint="Select paper type, sheet size, and color mode"
          />
          <div className="pc-card-body">
            {paperTypes.length > 0 ? (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label className="field-label">Paper Type</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {paperTypes.map(pt => (
                      <button
                        key={pt.key}
                        className={`pc-btn pc-btn-sm ${selectedPaperKey === pt.key ? "pc-btn-primary" : "pc-btn-secondary"}`}
                        onClick={() => setSelectedPaperKey(pt.key)}
                      >{pt.label}</button>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label className="field-label">Sheet Size</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {availableSheetKeys.map(sk => (
                      <button
                        key={sk}
                        className={`pc-btn pc-btn-sm ${selectedSheetKey === sk ? "pc-btn-primary" : "pc-btn-secondary"}`}
                        onClick={() => setSelectedSheetKey(sk)}
                      >{sk}</button>
                    ))}
                  </div>
                </div>
                
                <div style={{ marginBottom: 12 }}>
                  <label className="field-label">Color Mode</label>
                  <div style={{ display: "flex", gap: 6 }}>
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
                
                {sheetsNeeded > 0 && (
                  <div style={{
                    display: "flex", gap: 16, flexWrap: "wrap",
                    padding: "10px 14px", background: "var(--surface-3)",
                    borderRadius: "var(--radius-sm)", fontSize: 12,
                  }}>
                    <div><span style={{ color: "var(--text-muted)" }}>Per sheet:</span> <strong>${perSheetPrice.toFixed(2)}</strong></div>
                    <div><span style={{ color: "var(--text-muted)" }}>Records/sheets:</span> <strong>{sheetsNeeded}</strong></div>
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
                <div>No paper types configured. Add pricing in the Admin panel under Sheet Pricing.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 3 — Data Source (CSV) */}
      {template && (
        <div className="pc-card">
          <CardHeader
            step="3"
            stepClass="step-num-green"
            title="Data Source (Optional)"
            hint="Upload a CSV for mail merge, or skip for sequential numbering only"
          />
          <div className="pc-card-body">
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,.tsv,.txt"
              style={{ display: "none" }}
              onChange={e => { if (e.target.files?.[0]) handleCSVFile(e.target.files[0]); e.target.value = ""; }}
            />

            {csvData.headers.length > 0 ? (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <TableIcon />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{csvFileName}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {csvData.headers.length} columns · {csvData.rows.length} rows
                    </div>
                  </div>
                  <button className="pc-btn pc-btn-secondary pc-btn-xs" onClick={() => { setCsvData({ headers: [], rows: [] }); setCsvFileName(""); }}>Remove</button>
                </div>

                {/* Column preview */}
                <div style={{
                  display: "flex", gap: 6, flexWrap: "wrap", padding: "8px 10px",
                  background: "var(--surface-3)", borderRadius: "var(--radius-sm)", fontSize: 11,
                }}>
                  {csvData.headers.map(h => (
                    <span key={h} className="badge badge-green">{h}</span>
                  ))}
                </div>

                {/* Data preview */}
                <div style={{
                  marginTop: 8, maxHeight: 120, overflow: "auto",
                  border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 11,
                }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>{csvData.headers.map(h => (
                        <th key={h} style={{ padding: "4px 8px", background: "var(--surface-3)", textAlign: "left", fontWeight: 600, borderBottom: "1px solid var(--border)" }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {csvData.rows.slice(0, 5).map((row, i) => (
                        <tr key={i}>{csvData.headers.map(h => (
                          <td key={h} style={{ padding: "3px 8px", borderBottom: "1px solid var(--border)" }}>{row[h]}</td>
                        ))}</tr>
                      ))}
                      {csvData.rows.length > 5 && (
                        <tr><td colSpan={csvData.headers.length} style={{ padding: "3px 8px", color: "var(--text-muted)", fontStyle: "italic" }}>
                          ...and {csvData.rows.length - 5} more rows
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <button className="pc-btn pc-btn-secondary" onClick={() => csvInputRef.current?.click()}
                style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TableIcon /> Upload CSV File
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 4 — Place Fields */}
      {template && (
        <div className="pc-card">
          <CardHeader
            step="4"
            stepClass="step-num-green"
            title="Place Variable Fields"
            hint="Configure style, add fields, then click or drag on the preview to position"
          />
          <div className="pc-card-body">

            {/* ── Shared Field Style ── */}
            <div style={{
              padding: "12px 14px", marginBottom: 14,
              background: "var(--surface-3)", borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                Field Style (applies to all fields)
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label className="field-label">Font</label>
                  <select className="pc-select" value={fieldStyle.fontFamily}
                    onChange={e => updateStyle("fontFamily", e.target.value)}
                    style={{ width: "100%", fontFamily: fieldStyle.fontFamily }}>
                    {FONT_OPTIONS.map(f => <option key={f.key} value={f.key} style={{ fontFamily: f.key }}>{f.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 0, minWidth: 60 }}>
                  <label className="field-label">Size (pt)</label>
                  <input className="pc-input" type="number" value={fieldStyle.fontSize} min="4" max="200"
                    onChange={e => updateStyle("fontSize", Math.max(4, +e.target.value || 12))} style={{ width: "100%" }} />
                </div>
                <div style={{ flex: 0, minWidth: 85 }}>
                  <label className="field-label">Style</label>
                  <select className="pc-select" value={`${fieldStyle.fontWeight}${fieldStyle.fontStyle === "italic" ? "-italic" : ""}`}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === "bold-italic") { updateStyle("fontWeight", "bold"); updateStyle("fontStyle", "italic"); }
                      else if (v === "italic") { updateStyle("fontWeight", "normal"); updateStyle("fontStyle", "italic"); }
                      else if (v === "bold") { updateStyle("fontWeight", "bold"); updateStyle("fontStyle", "normal"); }
                      else { updateStyle("fontWeight", "normal"); updateStyle("fontStyle", "normal"); }
                    }} style={{ width: "100%" }}>
                    <option value="normal">Regular</option>
                    <option value="bold">Bold</option>
                    <option value="italic">Italic</option>
                    <option value="bold-italic">Bold Italic</option>
                  </select>
                </div>
                <div style={{ flex: 0, minWidth: 40 }}>
                  <label className="field-label">Color</label>
                  <input type="color" value={fieldStyle.color}
                    onChange={e => updateStyle("color", e.target.value)}
                    style={{ width: 34, height: 34, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }} />
                </div>
                <div style={{ flex: 0, minWidth: 75 }}>
                  <label className="field-label">Align</label>
                  <select className="pc-select" value={fieldStyle.align}
                    onChange={e => updateStyle("align", e.target.value)} style={{ width: "100%" }}>
                    {ALIGN_OPTIONS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 0, minWidth: 60 }}>
                  <label className="field-label">Line spacing</label>
                  <input className="pc-input" type="number" value={fieldStyle.lineSpacing || 1.4} min="0.8" max="4" step="0.1"
                    onChange={e => updateStyle("lineSpacing", Math.max(0.8, +e.target.value || 1.4))} style={{ width: "100%" }} />
                </div>
              </div>
              {/* Live preview */}
              <div style={{
                padding: "8px 12px", background: "white", borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)", textAlign: fieldStyle.align,
                fontFamily: `${fieldStyle.fontFamily}, sans-serif`,
                fontSize: Math.min(fieldStyle.fontSize, 28),
                fontWeight: fieldStyle.fontWeight,
                fontStyle: fieldStyle.fontStyle || "normal",
                color: fieldStyle.color, overflow: "hidden", whiteSpace: "nowrap",
                lineHeight: 1.4,
              }}>
                The quick brown fox jumps over the lazy dog
              </div>
            </div>

            {/* ── Add field + field list ── */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              <button className="pc-btn pc-btn-primary pc-btn-sm" onClick={addField}
                style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <PlusIcon /> Add Field
              </button>
              {placingField && selectedField !== null && (
                <span style={{
                  fontSize: 12, color: "var(--green)", fontWeight: 600,
                  animation: "pulse 1.5s ease-in-out infinite",
                }}>
                  👆 Click on the preview below to place · or drag to reposition
                </span>
              )}
            </div>

            {/* Field editors (compact — no font controls) */}
            {fields.map((field, idx) => (
              <FieldEditor
                key={idx}
                field={field}
                index={idx}
                csvHeaders={csvData.headers}
                onUpdate={updateField}
                onRemove={removeField}
                onSelect={setSelectedField}
                isSelected={selectedField === idx}
              />
            ))}

            {fields.length === 0 && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)", fontSize: 13 }}>
                Click "Add Field" to create a variable field (ticket number, name, address, etc.)
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 5 — Preview & Position */}
      {template && fields.length > 0 && (
        <div className="pc-card">
          <CardHeader
            step="5"
            stepClass="step-num-green"
            title="Preview & Position"
            hint="Drag the text frame to position it · Drag the corner handle to resize width"
          />
          <div className="pc-card-body">

            {/* Record navigator */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 12, gap: 8,
            }}>
              <button className="pc-btn pc-btn-secondary pc-btn-sm pc-btn-icon"
                disabled={previewRecord === 0}
                onClick={() => setPreviewRecord(r => Math.max(0, r - 1))}
              ><ChevronLeft /></button>

              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  Record {previewRecord + 1} of {totalRecords}
                </div>
              </div>

              <button className="pc-btn pc-btn-secondary pc-btn-sm pc-btn-icon"
                disabled={previewRecord >= totalRecords - 1}
                onClick={() => setPreviewRecord(r => Math.min(totalRecords - 1, r + 1))}
              ><ChevronRight /></button>
            </div>

            {/* Frame position controls */}
            <div style={{
              display: "flex", gap: 10, marginBottom: 10, padding: "8px 12px",
              background: "var(--surface-3)", borderRadius: "var(--radius-sm)",
              flexWrap: "wrap", alignItems: "center", fontSize: 12,
            }}>
              <span style={{ fontWeight: 600, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Frame:</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                X: <input className="pc-input" type="number" step="0.05" value={frame.x}
                  onChange={e => setFrame(prev => ({ ...prev, x: +e.target.value || 0 }))}
                  style={{ width: 60, height: 26, fontSize: 11 }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                Y: <input className="pc-input" type="number" step="0.05" value={frame.y}
                  onChange={e => setFrame(prev => ({ ...prev, y: +e.target.value || 0 }))}
                  style={{ width: 60, height: 26, fontSize: 11 }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                W: <input className="pc-input" type="number" step="0.1" min="0.5" value={frame.width}
                  onChange={e => setFrame(prev => ({ ...prev, width: Math.max(0.5, +e.target.value || 1) }))}
                  style={{ width: 60, height: 26, fontSize: 11 }} />
              </div>
              <span style={{ width: 1, height: 16, background: "var(--border)" }} />
              <button className="pc-btn pc-btn-xs pc-btn-secondary"
                onClick={() => {
                  if (!template) return;
                  const cx = (template.widthIn - frame.width) / 2;
                  setFrame(prev => ({ ...prev, x: +cx.toFixed(3) }));
                }}
              >Center H</button>
              <button className="pc-btn pc-btn-xs pc-btn-secondary"
                onClick={() => {
                  if (!template) return;
                  const lineH = fieldStyle.fontSize / 72 * (fieldStyle.lineSpacing || 1.4);
                  const totalH = fields.length * lineH;
                  const cy = (template.heightIn - totalH) / 2;
                  setFrame(prev => ({ ...prev, y: +Math.max(0, cy).toFixed(3) }));
                }}
              >Center V</button>
              <button className="pc-btn pc-btn-xs pc-btn-secondary"
                onClick={() => {
                  if (!template) return;
                  setFrame(prev => ({ ...prev, width: +template.widthIn.toFixed(3), x: 0 }));
                }}
              >Full Width</button>
            </div>

            {/* Preview canvas */}
            <div
              ref={previewContainerRef}
              onMouseDown={handlePreviewMouseDown}
              onMouseMove={handlePreviewMouseMove}
              onMouseUp={handlePreviewMouseUp}
              onMouseLeave={handlePreviewMouseUp}
              onTouchStart={e => { e.preventDefault(); handlePreviewMouseDown(e.touches[0]); }}
              onTouchMove={e => { e.preventDefault(); handlePreviewMouseMove(e.touches[0]); }}
              onTouchEnd={handlePreviewMouseUp}
              style={{
                border: "2px solid var(--border)",
                borderRadius: "var(--radius)", overflow: "hidden",
                cursor: "grab",
                touchAction: "none",
              }}
            >
              <canvas
                ref={previewCanvasRef}
                style={{ width: "100%", height: "auto", display: "block" }}
              />
            </div>

            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              Drag the green frame to reposition · Drag the bottom-right handle to resize · Click outside frame to move it there
            </div>
          </div>
        </div>
      )}

      {/* Action Bar */}
      {template && fields.length > 0 && totalRecords > 0 && (
        <div className="price-bar" style={{ position: "sticky", bottom: 0, zIndex: 50 }}>
          <div className="price-bar-inner price-bar-green" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
              <div className="price-metric">
                <div className="price-metric-label">Records</div>
                <div className="price-metric-val">{totalRecords}</div>
              </div>
              <div className="price-metric">
                <div className="price-metric-label">Paper</div>
                <div className="price-metric-val" style={{ fontSize: 12 }}>
                  {paperTypes.find(p => p.key === selectedPaperKey)?.label || "—"} · {selectedSheetKey}
                </div>
              </div>
              <div className="price-metric">
                <div className="price-metric-label">Per sheet</div>
                <div className="price-metric-val" style={{ fontSize: 12 }}>${perSheetPrice.toFixed(2)}</div>
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
                className="pc-btn pc-btn-success"
                disabled={generating}
                onClick={handleGenerate}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <DownloadIcon />
                {generating ? "Generating..." : `Download ${totalRecords} Records`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { DataMergeIcon };
