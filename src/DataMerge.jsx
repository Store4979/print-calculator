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

// ── FIELD EDITOR PANEL ─────────────────────────────────────

function FieldEditor({ field, index, csvHeaders, onUpdate, onRemove }) {
  const update = (key, val) => onUpdate(index, { ...field, [key]: val });

  return (
    <div style={{
      padding: "12px 14px", marginBottom: 8,
      background: "var(--surface-2)", borderRadius: "var(--radius-sm)",
      border: `2px solid ${field._selected ? "var(--green)" : "var(--border)"}`,
      fontSize: 12, transition: "border-color 0.15s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 20, height: 20, borderRadius: "50%", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 10,
            fontWeight: 700, background: "var(--green)", color: "white",
          }}>{index + 1}</span>
          <strong style={{ fontSize: 13 }}>{field.label || `Field ${index + 1}`}</strong>
        </div>
        <button
          className="pc-btn pc-btn-icon"
          style={{ width: 24, height: 24, padding: 0, background: "transparent", border: "none", color: "var(--text-muted)" }}
          onClick={() => onRemove(index)}
          title="Remove field"
        ><XIcon /></button>
      </div>

      {/* Field type */}
      <div style={{ marginBottom: 8 }}>
        <label className="field-label">Type</label>
        <div className="chip-group" style={{ display: "flex", gap: 4 }}>
          {FIELD_TYPES.map(ft => (
            <button
              key={ft.key}
              className={`pc-btn pc-btn-xs ${field.type === ft.key ? "pc-btn-primary" : "pc-btn-secondary"}`}
              onClick={() => update("type", ft.key)}
            >{ft.label}</button>
          ))}
        </div>
      </div>

      {/* Label */}
      <div style={{ marginBottom: 8 }}>
        <label className="field-label">Label</label>
        <input className="pc-input" type="text" value={field.label || ""} placeholder="e.g. Ticket #, Name, Address"
          onChange={e => update("label", e.target.value)} style={{ width: "100%" }} />
      </div>

      {/* Number config */}
      {field.type === "number" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 60 }}>
            <label className="field-label">Start</label>
            <input className="pc-input" type="number" value={field.startNum} min="0"
              onChange={e => update("startNum", +e.target.value || 0)} style={{ width: "100%" }} />
          </div>
          <div style={{ flex: 1, minWidth: 60 }}>
            <label className="field-label">End</label>
            <input className="pc-input" type="number" value={field.endNum} min={field.startNum}
              onChange={e => update("endNum", +e.target.value || field.startNum)} style={{ width: "100%" }} />
          </div>
          <div style={{ flex: 1, minWidth: 50 }}>
            <label className="field-label">Digits</label>
            <input className="pc-input" type="number" value={field.padding} min="1" max="8"
              onChange={e => update("padding", Math.max(1, +e.target.value || 1))} style={{ width: "100%" }} />
          </div>
          <div style={{ flex: 1, minWidth: 50 }}>
            <label className="field-label">Prefix</label>
            <input className="pc-input" type="text" value={field.prefix} placeholder="#"
              onChange={e => update("prefix", e.target.value)} style={{ width: "100%" }} />
          </div>
          <div style={{ flex: 1, minWidth: 50 }}>
            <label className="field-label">Suffix</label>
            <input className="pc-input" type="text" value={field.suffix} placeholder=""
              onChange={e => update("suffix", e.target.value)} style={{ width: "100%" }} />
          </div>
        </div>
      )}

      {/* CSV column picker */}
      {field.type === "data" && (
        <div style={{ marginBottom: 8 }}>
          <label className="field-label">CSV Column</label>
          {csvHeaders.length > 0 ? (
            <select className="pc-select" value={field.csvColumn}
              onChange={e => update("csvColumn", e.target.value)} style={{ width: "100%" }}>
              <option value="">— Select column —</option>
              {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          ) : (
            <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Upload a CSV first</div>
          )}
        </div>
      )}

      {/* Static text */}
      {field.type === "static" && (
        <div style={{ marginBottom: 8 }}>
          <label className="field-label">Text</label>
          <input className="pc-input" type="text" value={field.staticText} placeholder="Enter text..."
            onChange={e => update("staticText", e.target.value)} style={{ width: "100%" }} />
        </div>
      )}

      {/* Font / style */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 90 }}>
          <label className="field-label">Font</label>
          <select className="pc-select" value={field.fontFamily}
            onChange={e => update("fontFamily", e.target.value)} style={{ width: "100%" }}>
            {FONT_OPTIONS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
        <div style={{ flex: 0, minWidth: 55 }}>
          <label className="field-label">Size</label>
          <input className="pc-input" type="number" value={field.fontSize} min="4" max="120"
            onChange={e => update("fontSize", Math.max(4, +e.target.value || 12))} style={{ width: "100%" }} />
        </div>
        <div style={{ flex: 0, minWidth: 55 }}>
          <label className="field-label">Weight</label>
          <select className="pc-select" value={field.fontWeight}
            onChange={e => update("fontWeight", e.target.value)} style={{ width: "100%" }}>
            <option value="normal">Normal</option>
            <option value="bold">Bold</option>
          </select>
        </div>
        <div style={{ flex: 0, minWidth: 40 }}>
          <label className="field-label">Color</label>
          <input type="color" value={field.color}
            onChange={e => update("color", e.target.value)}
            style={{ width: 34, height: 34, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }} />
        </div>
        <div style={{ flex: 0, minWidth: 70 }}>
          <label className="field-label">Align</label>
          <select className="pc-select" value={field.align}
            onChange={e => update("align", e.target.value)} style={{ width: "100%" }}>
            {ALIGN_OPTIONS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </div>
      </div>

      {/* Position (manual fine-tune) */}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label className="field-label">X (inches)</label>
          <input className="pc-input" type="number" step="0.05" value={field.x}
            onChange={e => update("x", +e.target.value || 0)} style={{ width: "100%" }} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Y (inches)</label>
          <input className="pc-input" type="number" step="0.05" value={field.y}
            onChange={e => update("y", +e.target.value || 0)} style={{ width: "100%" }} />
        </div>
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ─────────────────────────────────────────

export default function DataMerge({ CardHeader }) {
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

  const previewCanvasRef = useRef(null);
  const templateInputRef = useRef(null);
  const csvInputRef = useRef(null);
  const previewContainerRef = useRef(null);

  // Computed
  const records = useMemo(() => generateRecords(fields, csvData), [fields, csvData]);
  const totalRecords = records.length;
  const hasNumberField = fields.some(f => f.type === "number");
  const hasDataField = fields.some(f => f.type === "data");

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
      label: `Field ${fields.length + 1}`,
      x: template ? template.widthIn / 2 : 2,
      y: template ? template.heightIn / 2 : 2,
    };
    setFields(prev => [...prev, newField]);
    setSelectedField(fields.length);
    setPlacingField(true);
  }, [fields.length, template]);

  const updateField = useCallback((idx, updated) => {
    setFields(prev => prev.map((f, i) => i === idx ? updated : f));
  }, []);

  const removeField = useCallback((idx) => {
    setFields(prev => prev.filter((_, i) => i !== idx));
    setSelectedField(null);
  }, []);

  // ── Click to place ──
  const handlePreviewClick = useCallback((e) => {
    if (!template || !previewContainerRef.current) return;
    const targetIdx = placingField && selectedField !== null ? selectedField : selectedField;
    if (targetIdx === null) return;

    const rect = previewContainerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const scaleX = template.widthIn / rect.width;
    const scaleY = template.heightIn / rect.height;
    const xIn = clickX * scaleX;
    const yIn = clickY * scaleY;

    setFields(prev => prev.map((f, i) => i === targetIdx ? { ...f, x: +xIn.toFixed(3), y: +yIn.toFixed(3) } : f));
    setPlacingField(false);
  }, [template, placingField, selectedField]);

  // ── Preview rendering ──
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

      // Render fields for current record
      const rec = records[previewRecord] || {};
      fields.forEach((field, fIdx) => {
        const key = `field_${fIdx}`;
        const text = rec[key] || (field.type === "number" ? `${field.prefix}${"0".repeat(field.padding)}${field.suffix}` : "[empty]");
        const xPx = field.x * DPI;
        const yPx = field.y * DPI;
        const fsPx = field.fontSize * (DPI / 72);

        ctx.save();
        ctx.font = `${field.fontWeight} ${Math.round(fsPx)}px ${field.fontFamily}, sans-serif`;
        ctx.fillStyle = field.color;
        ctx.textAlign = field.align;
        ctx.textBaseline = "middle";
        ctx.fillText(text, xPx, yPx);

        // Selection indicator
        if (selectedField === fIdx) {
          const metrics = ctx.measureText(text);
          let boxX = xPx;
          if (field.align === "center") boxX -= metrics.width / 2;
          else if (field.align === "right") boxX -= metrics.width;
          ctx.strokeStyle = "var(--green)";
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(boxX - 4, yPx - fsPx / 2 - 4, metrics.width + 8, fsPx + 8);
          ctx.setLineDash([]);
        }
        ctx.restore();
      });
    };
    img.src = template.image;
  }, [template, fields, records, previewRecord, selectedField]);

  // ── PDF Generation ──
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

      for (let r = 0; r < records.length; r++) {
        if (r > 0) doc.addPage([template.widthIn, template.heightIn], orient);

        // Add template image
        doc.addImage(template.image, "PNG", 0, 0, template.widthIn, template.heightIn);

        // Add fields
        const rec = records[r];
        fields.forEach((field, fIdx) => {
          const key = `field_${fIdx}`;
          const text = rec[key] || "";
          if (!text) return;

          doc.setFont(field.fontFamily, field.fontWeight === "bold" ? "bold" : "normal");
          doc.setFontSize(field.fontSize);
          doc.setTextColor(field.color);

          let alignOpt = {};
          if (field.align === "center") alignOpt = { align: "center" };
          else if (field.align === "right") alignOpt = { align: "right" };

          doc.text(text, field.x, field.y, alignOpt);
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
  }, [template, records, fields]);

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

      {/* Step 2 — Data Source (CSV) */}
      {template && (
        <div className="pc-card">
          <CardHeader
            step="2"
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

      {/* Step 3 — Place Fields */}
      {template && (
        <div className="pc-card">
          <CardHeader
            step="3"
            stepClass="step-num-green"
            title="Place Variable Fields"
            hint="Add fields and click on the template preview to position them"
          />
          <div className="pc-card-body">
            <div style={{ display: "flex", gap: 16, flexDirection: "column" }}>

              {/* Add field button */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="pc-btn pc-btn-primary pc-btn-sm" onClick={addField}
                  style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <PlusIcon /> Add Field
                </button>
                {placingField && selectedField !== null && (
                  <span style={{
                    fontSize: 12, color: "var(--green)", fontWeight: 600,
                    animation: "pulse 1.5s ease-in-out infinite",
                  }}>
                    👆 Click on the preview below to place this field
                  </span>
                )}
              </div>

              {/* Field editors */}
              {fields.map((field, idx) => (
                <FieldEditor
                  key={idx}
                  field={{ ...field, _selected: selectedField === idx }}
                  index={idx}
                  csvHeaders={csvData.headers}
                  onUpdate={updateField}
                  onRemove={removeField}
                />
              ))}

              {fields.length === 0 && (
                <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)", fontSize: 13 }}>
                  Click "Add Field" to create a variable field (ticket number, name, address, etc.)
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 4 — Preview */}
      {template && fields.length > 0 && (
        <div className="pc-card">
          <CardHeader
            step="4"
            stepClass="step-num-green"
            title="Preview"
            hint={`${totalRecords} record${totalRecords !== 1 ? "s" : ""} — click the template to reposition selected field`}
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
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {fields.map((f, i) => {
                    const key = `field_${i}`;
                    const val = records[previewRecord]?.[key] || "";
                    return `${f.label || "Field"}: ${val}`;
                  }).join(" · ")}
                </div>
              </div>

              <button className="pc-btn pc-btn-secondary pc-btn-sm pc-btn-icon"
                disabled={previewRecord >= totalRecords - 1}
                onClick={() => setPreviewRecord(r => Math.min(totalRecords - 1, r + 1))}
              ><ChevronRight /></button>
            </div>

            {/* Field selector chips */}
            <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
              {fields.map((f, i) => (
                <button key={i}
                  className={`pc-btn pc-btn-xs ${selectedField === i ? "pc-btn-primary" : "pc-btn-secondary"}`}
                  onClick={() => { setSelectedField(i); setPlacingField(true); }}
                >
                  {f.label || `Field ${i + 1}`}
                  {selectedField === i && " 📍"}
                </button>
              ))}
            </div>

            {/* Preview canvas */}
            <div
              ref={previewContainerRef}
              onClick={handlePreviewClick}
              style={{
                border: `2px solid ${placingField ? "var(--green)" : "var(--border)"}`,
                borderRadius: "var(--radius)", overflow: "hidden",
                cursor: placingField ? "crosshair" : "default",
                transition: "border-color 0.2s",
              }}
            >
              <canvas
                ref={previewCanvasRef}
                style={{ width: "100%", height: "auto", display: "block" }}
              />
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
                <div className="price-metric-label">Fields</div>
                <div className="price-metric-val">{fields.length}</div>
              </div>
              <div className="price-metric">
                <div className="price-metric-label">Template</div>
                <div className="price-metric-val" style={{ fontSize: 12 }}>{template.widthIn.toFixed(1)}×{template.heightIn.toFixed(1)}"</div>
              </div>
              <div className="price-metric">
                <div className="price-metric-label">Source</div>
                <div className="price-metric-val" style={{ fontSize: 12 }}>
                  {hasDataField ? `CSV (${csvData.rows.length} rows)` : hasNumberField ? "Numbering" : "Static"}
                </div>
              </div>
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
