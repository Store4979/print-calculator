// ============================================================
//  TRADE PRINT ORDER SHEET (Signs365)
//
//  Single-page letter portrait PDF. Staff use this as the source of
//  truth for transcribing the order onto signs365.com — every option
//  and dimension is spelled out, the barcode keys it back to the
//  shop's records, and the internal cost block (clearly marked) is
//  for shop-floor reference only.
//
//  jsPDF is loaded via CDN at index.html (window.jspdf.jsPDF) — do
//  not import it as a module.
// ============================================================

import { drawBarcode128 } from "../barcode128.js";

const STORE = {
  name:    "The UPS Store #4979",
  address: "4352 Bay Road, Saginaw MI 48603",
  phone:   "989.790.9701",
  email:   "store4979@theupsstore.com",
};

const LOGO_URL = "/ups-logo.png";
let LOGO_DATA_URL = null;

const ensureLogo = async () => {
  if (LOGO_DATA_URL) return LOGO_DATA_URL;
  try {
    const res = await fetch(LOGO_URL, { cache: "no-store" });
    const blob = await res.blob();
    LOGO_DATA_URL = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        if (typeof r.result === "string" && r.result.startsWith("data:image")) resolve(r.result);
        else reject(new Error("logo not an image"));
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return LOGO_DATA_URL;
  } catch {
    return null;
  }
};

const getJsPDF = () => {
  if (typeof window === "undefined") throw new Error("PDF generation requires a browser");
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  if (window.jsPDF) return window.jsPDF;
  throw new Error("jsPDF not loaded — check the script tag in index.html");
};

const fmtMoney = (n) => `$${(Number(n) || 0).toFixed(2)}`;

const formatOptionValue = (opt, value) => {
  if (!opt) return String(value ?? "");
  if (opt.type === "checkbox") return value ? "Yes" : "No";
  if (opt.type === "select") {
    const choice = (opt.choices || []).find((c) => c.value === value);
    return choice ? choice.label : String(value ?? "");
  }
  if (opt.type === "perEachAddon") return `${Number(value) || 0}`;
  return String(value ?? "");
};

const formatDimensions = (orderData) => {
  const d = orderData?.dimensions;
  if (!d) return "—";
  if (d.kind === "perSqFt") {
    const min = d.minApplied ? `, ${d.minSqFt} sq ft min applied` : "";
    return `${d.width}" × ${d.height}"  (${d.sqFt.toFixed(2)} sq ft${min})`;
  }
  if (d.kind === "perPieceCustom") {
    return `${d.width}" × ${d.height}"  (custom, ${d.sqFt.toFixed(2)} sq ft)`;
  }
  if (d.kind === "perPiece") {
    return d.sizeLabel || d.sizeKey || "—";
  }
  return "—";
};

const formatTier = (tier) => {
  if (!tier) return "—";
  return `${tier.multiplier}× (${tier.label})`;
};

const formatQtyDiscount = (qd) => {
  if (!qd) return "—";
  if (!qd.discount) return `0% (${qd.label})`;
  return `${(qd.discount * 100).toFixed(0)}% off (${qd.label})`;
};

const newOrderId = () => `SP-${Date.now()}`;

const savePdf = (doc, filename) => {
  try {
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch {
    try { doc.save(filename); } catch {}
  }
};

/**
 * Generate and download the Signs365 trade-print order sheet.
 * @param {object} orderData
 *   - orderId            optional — auto-generated SP-{timestamp} otherwise
 *   - category           { key, label }
 *   - product            { key, label, pricingModel }
 *   - dimensions         { kind, width?, height?, sqFt?, minApplied?, sizeLabel?, … }
 *   - quantity           number
 *   - options            { [key]: rawValue }    — current selections
 *   - optionMeta         { [key]: optionDef }   — definition (label/type/choices)
 *   - pricing            { baseCost, postDiscountCost, customerPrice, margin,
 *                          marginPct, appliedTier, appliedDiscount, … }
 *   - customer           { name, phone, email }
 *   - staffInitials      string
 *   - notes              string (optional pre-filled notes)
 * @returns {Promise<{ orderId, filename }>}
 */
export async function generateTradeOrderPDF(orderData = {}) {
  const jsPDF = getJsPDF();
  const doc = new jsPDF({ orientation: "portrait", unit: "in", format: "letter" });
  const orderId = orderData.orderId || newOrderId();

  // Page geometry — match the existing print order sheet for visual
  // consistency: 0.5" margins, 7.5" content column, label col at +1.6".
  const ml = 0.5, mt = 0.5, cw = 7.5;
  const labelW = 1.6;
  let y = mt;

  const hr = (extra = 0) => {
    y += 0.04;
    doc.setDrawColor(220, 220, 220);
    doc.line(ml, y, ml + cw, y);
    y += 0.04 + extra;
  };

  const drawLabelValue = (label, value, opts = {}) => {
    const size = opts.size || 10;
    const valueColor = opts.valueColor;
    doc.setFontSize(size); doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, "bold");
    doc.text(label, ml, y);
    doc.setFont(undefined, "normal");
    if (valueColor) doc.setTextColor(...valueColor);
    const wrapped = doc.splitTextToSize(String(value ?? "—"), cw - labelW);
    wrapped.forEach((line, i) => doc.text(line, ml + labelW, y + i * 0.16));
    if (valueColor) doc.setTextColor(0, 0, 0);
    y += Math.max(0.18, wrapped.length * 0.16 + 0.02);
  };

  // ── Header (logo + store info) ──
  // Logo is fit within an 0.8" × 0.5" box with aspect preserved — same
  // treatment used by addOrderSheetPage, fixed previously to avoid
  // squashing on wide logos.
  const logo = await ensureLogo();
  if (logo) {
    try {
      const logoMaxW = 0.8, logoMaxH = 0.5;
      const img = new Image();
      img.src = logo;
      const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1.6;
      let lw = logoMaxW, lh = lw / ratio;
      if (lh > logoMaxH) { lh = logoMaxH; lw = lh * ratio; }
      doc.addImage(logo, "PNG", ml, y, lw, lh);
    } catch {}
  }
  doc.setFontSize(9); doc.setTextColor(80, 80, 80);
  doc.text(STORE.name,    ml + 1.4, y + 0.15);
  doc.text(STORE.address, ml + 1.4, y + 0.28);
  doc.text(`Ph: ${STORE.phone}  ·  ${STORE.email}`, ml + 1.4, y + 0.41);
  y += 0.62;
  hr(0.06);

  // ── Title + meta ──
  doc.setFontSize(13); doc.setTextColor(0, 0, 0); doc.setFont(undefined, "bold");
  doc.text("Trade Print Order — Signs365", ml, y);
  doc.setFont(undefined, "normal");
  doc.setFontSize(8); doc.setTextColor(100, 100, 100);
  doc.text(`Order: ${orderId}    Generated: ${new Date().toLocaleString()}`, ml, y + 0.18);
  y += 0.34;
  hr(0.08);

  // ── Job specs ──
  doc.setFontSize(11); doc.setTextColor(0, 0, 0); doc.setFont(undefined, "bold");
  doc.text("JOB SPECS", ml, y);
  y += 0.18;
  doc.setFont(undefined, "normal");

  drawLabelValue("Category:",   orderData.category?.label || "—");
  drawLabelValue("Product:",    orderData.product?.label  || "—");
  drawLabelValue("Dimensions:", formatDimensions(orderData));
  drawLabelValue("Quantity:",   String(orderData.quantity || 1));

  // Options — every selected option spelled out, one per line. This is
  // the part staff transcribe to signs365.com so we keep it explicit
  // (no "default" omissions; "Hemming: Yes" is more useful than blank).
  const opts    = orderData.options    || {};
  const optMeta = orderData.optionMeta || {};
  const optKeys = Object.keys(optMeta);
  if (optKeys.length) {
    y += 0.04;
    doc.setFont(undefined, "bold"); doc.setFontSize(10);
    doc.text("Options:", ml, y);
    doc.setFont(undefined, "normal");
    y += 0.16;
    optKeys.forEach((k) => {
      const opt    = optMeta[k];
      const valStr = formatOptionValue(opt, opts[k]);
      const line = `${opt.label}: ${valStr}`;
      const wrapped = doc.splitTextToSize(line, cw - 0.2);
      wrapped.forEach((ln, i) => {
        doc.text(`${i === 0 ? "•" : " "} ${ln}`, ml + 0.05, y);
        y += 0.15;
      });
    });
  }

  hr(0.08);

  // ── Customer ──
  const cust = orderData.customer || {};
  if (cust.name || cust.phone || cust.email) {
    doc.setFontSize(11); doc.setFont(undefined, "bold"); doc.setTextColor(0, 0, 0);
    doc.text("CUSTOMER", ml, y);
    y += 0.18;
    doc.setFont(undefined, "normal");
    drawLabelValue("Name:",  cust.name  || "—");
    drawLabelValue("Phone:", cust.phone || "—");
    drawLabelValue("Email:", cust.email || "—");
    hr(0.08);
  }

  // ── Internal cost tracking (clearly fenced off) ──
  doc.setFontSize(10); doc.setFont(undefined, "bold"); doc.setTextColor(180, 0, 0);
  doc.text("INTERNAL ONLY — DO NOT GIVE TO CUSTOMER", ml, y);
  doc.setTextColor(0, 0, 0); doc.setFont(undefined, "normal");
  y += 0.2;

  const p = orderData.pricing;
  if (p) {
    drawLabelValue("Signs365 base cost:", fmtMoney(p.baseCost));
    drawLabelValue("Qty discount:",        formatQtyDiscount(p.appliedDiscount));
    drawLabelValue("Post-discount cost:", fmtMoney(p.postDiscountCost));
    drawLabelValue("Markup tier:",        formatTier(p.appliedTier));
    drawLabelValue("Customer price:",     fmtMoney(p.customerPrice));
    drawLabelValue("Margin:",             `${fmtMoney(p.margin)} (${(p.marginPct || 0).toFixed(1)}%)`);
  }

  hr(0.08);

  // ── Notes ──
  doc.setFontSize(11); doc.setFont(undefined, "bold");
  doc.text("NOTES", ml, y);
  doc.setFont(undefined, "normal");
  y += 0.18;
  if (orderData.notes && String(orderData.notes).trim()) {
    doc.setFontSize(10);
    const wrapped = doc.splitTextToSize(String(orderData.notes), cw);
    wrapped.forEach((line) => { doc.text(line, ml, y); y += 0.16; });
    y += 0.04;
  }
  // Lined area for handwritten notes — fill remaining vertical space
  // up to roughly y = 9.7" (leaving room for barcode + footer below).
  const NOTES_BOTTOM = 9.55;
  while (y < NOTES_BOTTOM) {
    doc.setDrawColor(200, 200, 200);
    doc.line(ml, y, ml + cw, y);
    y += 0.28;
  }

  // ── Barcode + footer ──
  // Barcode keyed on the order ID so the shop can scan back into the
  // app's records. Drawn at a fixed y so it doesn't shift if the
  // notes section grew.
  drawBarcode128(doc, orderId, ml, 9.85, {
    width: 2.4,
    height: 0.45,
    showText: true,
    fontSize: 9,
  });

  doc.setFontSize(9); doc.setTextColor(80, 80, 80);
  const initials = (orderData.staffInitials || "").trim() || "_______";
  const dateStr  = new Date().toLocaleDateString();
  doc.text(`Order placed on signs365.com by ${initials} on _______`, ml, 10.55);
  doc.text(dateStr, ml + cw, 10.55, { align: "right" });

  const filename = `signs365_${orderId}.pdf`;
  savePdf(doc, filename);
  return { orderId, filename };
}
