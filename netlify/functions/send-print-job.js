// netlify/functions/send-print-job.js
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

// ============================================================
//  SECURITY (Release 1, 2026-09-10)
//
//  This endpoint sends mail FROM the store's own SMTP identity with
//  caller-supplied PDF attachments. Before this change it honoured a
//  caller-supplied `to`, which made it an open relay wearing the store's
//  return address: anyone who could POST here could mail anyone, from the
//  store, with any attachment.
//
//  The recipient is now resolved SERVER-SIDE and the request body can no
//  longer influence it. `to` is not read. The store comes from server
//  configuration, never from the body — the same rule the enrollment work
//  in Release 2 will formalise (server derives the store from enrollment,
//  never from a storeSlug in the request).
//
//  Authentication is NOT part of this release. Until staff sessions and
//  device enrollment land, this stays a public endpoint, so it is
//  constrained instead: fixed recipient, attachment count and byte caps,
//  field length caps, and a per-IP rate limit. That converts "mail anyone
//  anything" into "flood the store's own inbox, slowly" — a nuisance, not
//  a compromise.
// ============================================================

export const LIMITS = Object.freeze({
  MAX_ATTACHMENTS: 2,            // job PDF + order sheet, nothing else
  MAX_ATTACHMENT_BYTES: 8 * 1024 * 1024,
  MAX_TOTAL_ATTACHMENT_BYTES: 12 * 1024 * 1024,
  MAX_BODY_BYTES: 20 * 1024 * 1024,
  MAX_SUBJECT_CHARS: 200,
  RATE_MAX: 5,                   // sends per IP per window
  RATE_WINDOW_MS: 60 * 1000,
});

// Base64 -> decoded byte count, without allocating the buffer.
export const b64Bytes = (s) => {
  const raw = String(s || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!raw) return 0;
  const pad = raw.endsWith("==") ? 2 : raw.endsWith("=") ? 1 : 0;
  return Math.floor((raw.length * 3) / 4) - pad;
};

// Pure: everything about the request that can be rejected without sending.
// Returns null when acceptable, or { code, error } to return verbatim.
export const enforceLimits = ({ rawBodyLength = 0, pdfBase64, orderSheetPdfBase64 }) => {
  if (rawBodyLength > LIMITS.MAX_BODY_BYTES)
    return { code: 413, error: "Request too large." };

  const parts = [pdfBase64, orderSheetPdfBase64].filter(Boolean);
  if (parts.length > LIMITS.MAX_ATTACHMENTS)
    return { code: 400, error: "Too many attachments." };

  let total = 0;
  for (const part of parts) {
    const n = b64Bytes(part);
    if (n > LIMITS.MAX_ATTACHMENT_BYTES)
      return { code: 413, error: "Attachment too large." };
    total += n;
  }
  if (total > LIMITS.MAX_TOTAL_ATTACHMENT_BYTES)
    return { code: 413, error: "Attachments too large." };
  return null;
};

// Per-IP sliding window. Netlify function instances are ephemeral, so this
// is best-effort: a cold start resets it and concurrent instances each keep
// their own counter. It raises the cost of abuse; it is not a guarantee.
// A durable limit needs shared state and is deliberately deferred to
// Release 2 rather than smuggled in as a migration here.
const rateState = new Map();
export const checkRate = (key, now = Date.now(), state = rateState) => {
  const hits = (state.get(key) || []).filter((t) => now - t < LIMITS.RATE_WINDOW_MS);
  if (hits.length >= LIMITS.RATE_MAX) return false;
  hits.push(now);
  state.set(key, hits);
  return true;
};

// The recipient. Resolved from the store record via service_role, falling
// back to the compiled-in store address. Both sources are server-controlled;
// neither can be influenced by the request. Never reads the body.
export const resolveRecipient = async ({ supabase, slug, fallback }) => {
  if (!supabase) return { to: fallback, source: "fallback:no-db" };
  try {
    const { data, error } = await supabase
      .from("stores").select("email").eq("slug", slug).maybeSingle();
    if (error || !data?.email) return { to: fallback, source: "fallback:lookup-miss" };
    return { to: data.email, source: "store:" + slug };
  } catch {
    return { to: fallback, source: "fallback:threw" };
  }
};

// Swappable so tests can assert denial and recipient binding without a
// network transport. Production always uses the real nodemailer transport.
let _transportFactory = (cfg) => nodemailer.createTransport(cfg);
export const __setTransportFactory = (fn) => { _transportFactory = fn; };
export const __resetTransportFactory = () => { _transportFactory = (cfg) => nodemailer.createTransport(cfg); };


const UPS_STORE = {
  name: "The UPS Store #4979",
  address: "4352 Bay Road, Saginaw MI 48603",
  phone: "989.790.9701",
  email: "store4979@theupsstore.com",
};

const money = (n) =>
  Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

const esc = (s) =>
  String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

/**
 * Build a clean, "only what was selected" email from the legacy frontend payload:
 * { jobType, details, pdfBase64, orderSheetPdfBase64 }
 */
function normalizeFromDetails(details = {}) {
  const jobType = details.jobType || "";
  const jobId = details.jobId || "";

  const user = details.user || {};
  const customerName = user.name || "";
  const customerEmail = user.email || "";
  const customerPhone = user.phone || "";

  const paperItems = [];
  const largeFormatItems = [];
  const blueprintItems = [];

  let subtotal = 0;
  let discountAmt = 0;
  let discountPct = 0;
  let total = 0;

  if (jobType === "sheets" && details.sheet) {
    const s = details.sheet;
    const qty = Number(s.sheetsNeeded || 0) || 0;
    total = Number(s.totalPrice || 0) || 0;
    subtotal = total;
    const unit = qty > 0 ? total / qty : total;

    paperItems.push({
      name: "Paper Printing",
      sku: s.paperKey || "",
      specs: `${s.sheetKey || ""} • ${(s.paperKey || "").toString()} • ${String(s.frontColorMode || "").toUpperCase()}`,
      qty: qty || 0,
      unitPrice: unit,
      total,
    });
  }

  if (jobType === "large-format" && details.largeFormat) {
    const lf = details.largeFormat;
    total = Number(lf.lfTotal || 0) || 0;
    subtotal = total;

    largeFormatItems.push({
      name: "Large Format",
      sku: lf.paperKey || "",
      specs: `${lf.width || ""}×${lf.height || ""} in • ${lf.paperKey || ""} • ${String(lf.colorMode || "").toUpperCase()}`,
      qty: 1,
      unitPrice: total,
      total,
    });
  }

  if (jobType === "blueprints" && details.blueprints) {
    const bp = details.blueprints;
    const qty = Number(bp.qty || 0) || 0;
    total = Number(bp.total || 0) || 0;
    subtotal = total;
    const unit = qty > 0 ? total / qty : total;

    blueprintItems.push({
      name: "Blueprints",
      sku: bp.size || "",
      specs: `${bp.width || ""}×${bp.height || ""} in • B/W`,
      qty,
      unitPrice: unit,
      total,
    });
  }

  return {
    orderId: jobId,
    customerName,
    phone: customerPhone,
    email: customerEmail,
    dueDate: "ASAP",
    fulfillment: "Pickup",
    subtotal,
    discountPct,
    discountAmt,
    total,
    paperItems,
    largeFormatItems,
    blueprintItems,
  };
}

function renderItemsTable(title, items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `
    <div style="margin-top:18px;">
      <div style="font-size:15px;font-weight:900;color:#000000;margin:0 0 8px 0;">${esc(title)}</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;">
        <thead>
          <tr style="background:#F8FAFC;">
            <th style="text-align:left;padding:10px;border-bottom:1px solid #E5E7EB;">Item</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid #E5E7EB;">Specs</th>
            <th style="text-align:right;padding:10px;border-bottom:1px solid #E5E7EB;">Qty</th>
            <th style="text-align:right;padding:10px;border-bottom:1px solid #E5E7EB;">Unit</th>
            <th style="text-align:right;padding:10px;border-bottom:1px solid #E5E7EB;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (it) => `
            <tr>
              <td style="padding:10px;border-bottom:1px solid #E5E7EB;">
                <div style="font-weight:800;color:#000000;">${esc(it.name || "")}</div>
                ${it.sku ? `<div style="font-size:12px;color:#374151;">SKU: ${esc(it.sku)}</div>` : ""}
              </td>
              <td style="padding:10px;border-bottom:1px solid #E5E7EB;color:#111827;">${esc(it.specs || "")}</td>
              <td style="padding:10px;border-bottom:1px solid #E5E7EB;text-align:right;">${esc(it.qty)}</td>
              <td style="padding:10px;border-bottom:1px solid #E5E7EB;text-align:right;">${money(it.unitPrice)}</td>
              <td style="padding:10px;border-bottom:1px solid #E5E7EB;text-align:right;font-weight:900;">${money(it.total)}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function buildEmailHtml(order) {
  const orderId = order.orderId || "";
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#FFFFFF;padding:18px;">
    <div style="max-width:820px;margin:0 auto;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;">
      <div style="background:#008198;padding:16px 18px;">
        <div style="font-size:18px;font-weight:900;color:#FFFFFF;">The UPS Store – Print Order</div>
        <div style="font-size:13px;color:#FFFFFF;opacity:.95;margin-top:4px;">
          ${orderId ? `Order ID: <b>${esc(orderId)}</b> • ` : ""}${esc(UPS_STORE.address)}
        </div>
      </div>

      <div style="padding:18px;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:260px;border:1px solid #E5E7EB;border-radius:12px;">
            <div style="padding:10px 12px;background:#FFD100;font-weight:900;color:#000000;border-bottom:1px solid #E5E7EB;">
              Order Summary
            </div>
            <table style="width:100%;border-collapse:collapse;">
              ${order.customerName ? `<tr><td style="padding:6px 10px;font-weight:700;">Customer</td><td style="padding:6px 10px;">${esc(order.customerName)}</td></tr>` : ""}
              ${order.phone ? `<tr><td style="padding:6px 10px;font-weight:700;">Phone</td><td style="padding:6px 10px;">${esc(order.phone)}</td></tr>` : ""}
              ${order.email ? `<tr><td style="padding:6px 10px;font-weight:700;">Email</td><td style="padding:6px 10px;">${esc(order.email)}</td></tr>` : ""}
              <tr><td style="padding:6px 10px;font-weight:700;">Due</td><td style="padding:6px 10px;">${esc(order.dueDate || "ASAP")}</td></tr>
              <tr><td style="padding:6px 10px;font-weight:700;">Pickup/Delivery</td><td style="padding:6px 10px;">${esc(order.fulfillment || "Pickup")}</td></tr>
            </table>
          </div>

          <div style="flex:1;min-width:260px;border:1px solid #E5E7EB;border-radius:12px;">
            <div style="padding:10px 12px;background:#F8FAFC;font-weight:900;color:#000000;border-bottom:1px solid #E5E7EB;">
              Pricing
            </div>
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:8px 12px;color:#000000;font-weight:700;">Subtotal</td>
                <td style="padding:8px 12px;text-align:right;">${money(order.subtotal)}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;color:#000000;font-weight:700;">Discount ${order.discountPct ? `(${Number(order.discountPct).toFixed(0)}%)` : ""}</td>
                <td style="padding:8px 12px;text-align:right;">-${money(order.discountAmt)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;color:#000000;font-weight:900;border-top:1px solid #E5E7EB;">Total</td>
                <td style="padding:10px 12px;text-align:right;font-weight:900;border-top:1px solid #E5E7EB;">${money(order.total)}</td>
              </tr>
            </table>
          </div>
        </div>

        ${renderItemsTable("Paper Printing", order.paperItems)}
        ${renderItemsTable("Large Format", order.largeFormatItems)}
        ${renderItemsTable("Blueprints", order.blueprintItems)}

        <div style="margin-top:18px;border-top:1px solid #E5E7EB;padding-top:14px;">
          <div style="font-size:14px;font-weight:900;color:#000000;margin-bottom:6px;">Attachments</div>
          <ul style="margin:0;padding-left:18px;color:#111827;">
            <li>Print-Ready Job File (PDF)</li>
            <li>Print Order Sheet (PDF)</li>
          </ul>
          <div style="font-size:12px;color:#374151;margin-top:10px;">
            Store phone: ${esc(UPS_STORE.phone)} • Email: ${esc(UPS_STORE.email)}
          </div>
        </div>
      </div>
    </div>
  </div>`;
  return html;
}

function buildEmailText(order) {
  const lines = [];
  lines.push("The UPS Store – Print Order");
  if (order.orderId) lines.push(`Order ID: ${order.orderId}`);
  lines.push(`Store: ${UPS_STORE.address}`);
  lines.push("");
  lines.push("ORDER SUMMARY");
  if (order.customerName) lines.push(`Customer: ${order.customerName}`);
  if (order.phone) lines.push(`Phone: ${order.phone}`);
  if (order.email) lines.push(`Email: ${order.email}`);
  lines.push(`Due: ${order.dueDate || "ASAP"}`);
  lines.push(`Pickup/Delivery: ${order.fulfillment || "Pickup"}`);
  lines.push("");
  lines.push("PRICING");
  lines.push(`Subtotal: ${money(order.subtotal)}`);
  lines.push(`Discount: -${money(order.discountAmt)}`);
  lines.push(`Total: ${money(order.total)}`);
  lines.push("");
  const dumpItems = (title, items) => {
    if (!items || !items.length) return;
    lines.push(title.toUpperCase());
    items.forEach((it) =>
      lines.push(`- ${it.name} | ${it.specs} | Qty ${it.qty} | Unit ${money(it.unitPrice)} | Total ${money(it.total)}`)
    );
    lines.push("");
  };
  dumpItems("Paper Printing", order.paperItems);
  dumpItems("Large Format", order.largeFormatItems);
  dumpItems("Blueprints", order.blueprintItems);
  lines.push("ATTACHMENTS");
  lines.push("- Print-Ready Job File (PDF)");
  lines.push("- Print Order Sheet (PDF)");
  return lines.join("\n");
}

export const handler = async (event) => {
  console.log("send-print-job invoked", { httpMethod: event.httpMethod });

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const rawBody = event.body || "";
  console.log("Raw body length:", rawBody.length);

  let body = {};
  try {
    body = JSON.parse(rawBody || "{}");
  } catch (e) {
    console.error("JSON parse error:", e);
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Invalid JSON" }) };
  }

  console.log("Parsed body keys:", Object.keys(body || {}));

  // `to` is deliberately NOT destructured. A caller-supplied recipient is
  // ignored entirely; it is logged only so abuse attempts are visible.
  const { subject, details, pdfBase64, orderSheetPdfBase64 } = body || {};
  if (body && body.to) {
    console.warn("send-print-job: ignoring caller-supplied recipient", { attempted: String(body.to).slice(0, 120) });
  }

  const limitFailure = enforceLimits({ rawBodyLength: rawBody.length, pdfBase64, orderSheetPdfBase64 });
  if (limitFailure) {
    return { statusCode: limitFailure.code, body: JSON.stringify({ ok: false, error: limitFailure.error }) };
  }

  const clientIp =
    (event.headers?.["x-nf-client-connection-ip"] ||
     String(event.headers?.["x-forwarded-for"] || "").split(",")[0].trim() ||
     "unknown");
  if (!checkRate(clientIp)) {
    return { statusCode: 429, body: JSON.stringify({ ok: false, error: "Too many requests. Please try again in a minute." }) };
  }

  const order = normalizeFromDetails(details || {});
  const jobId = order.orderId || `JOB-${Date.now()}`;
  order.orderId = jobId;

  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("Missing SMTP env vars:", missing);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: "SMTP not configured", missing }) };
  }

  const transporter = _transportFactory({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  // Server-side recipient. The body cannot reach this value.
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let sb = null;
  if (SB_URL && SB_KEY) {
    try { sb = createClient(String(SB_URL).trim(), String(SB_KEY).trim(), { auth: { persistSession: false } }); }
    catch { sb = null; }
  }
  const { to: recipient, source: recipientSource } = await resolveRecipient({
    supabase: sb,
    slug: String(process.env.STORE_SLUG || "store4979").trim(),
    fallback: UPS_STORE.email,
  });
  console.log("send-print-job recipient resolved", { recipientSource });

  const mail = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipient,
    subject: String(subject || "PRINT JOB").slice(0, LIMITS.MAX_SUBJECT_CHARS),
    html: buildEmailHtml(order),
    text: buildEmailText(order),
    attachments: [],
  };

  if (pdfBase64) {
    const jobBuf = Buffer.from(String(pdfBase64).replace(/^data:application\/pdf;base64,/, ""), "base64");
    console.log("Job PDF attachment bytes:", jobBuf.length);
    mail.attachments.push({
      filename: `Print-Ready-${jobId}.pdf`,
      content: jobBuf,
      contentType: "application/pdf",
    });
  } else {
    console.warn("No pdfBase64 provided.");
  }

  if (orderSheetPdfBase64) {
    const sheetBuf = Buffer.from(String(orderSheetPdfBase64).replace(/^data:application\/pdf;base64,/, ""), "base64");
    console.log("Order sheet PDF attachment bytes:", sheetBuf.length);
    mail.attachments.push({
      filename: `Print-Order-Sheet-${jobId}.pdf`,
      content: sheetBuf,
      contentType: "application/pdf",
    });
  } else {
    console.warn("No orderSheetPdfBase64 provided; sending email without order sheet attachment.");
  }

  try {
    const info = await transporter.sendMail(mail);
    console.log("Mail sent OK:", info.messageId);
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: info.messageId, jobId }) };
  } catch (err) {
    console.error("Email send failed:", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
