// netlify/functions/send-print-job.js
const nodemailer = require("nodemailer");

const money = (n) =>
  Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

const esc = (s) =>
  String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

/**
 * Normalize incoming payload into a single `order` shape.
 * Supports BOTH:
 *  - New payload: { order, deepLinkUrl, ... }
 *  - Old payload: { jobType, details, ... } (we infer line items)
 */
function normalizeOrder(body) {
  const deepLinkUrl = body.deepLinkUrl || "";
  const provided = body.order && typeof body.order === "object" ? body.order : null;

  if (provided) {
    return { order: provided, deepLinkUrl };
  }

  const { jobType, details = {} } = body;
  const user = (details && details.user) || {};
  const sheet = (details && details.sheet) || {};
  const lf = (details && details.largeFormat) || {};
  const bp = (details && details.blueprints) || {};

  const orderId = `JOB-${Date.now()}`;
  const paperItems = [];
  const largeFormatItems = [];
  const blueprintItems = [];

  if (jobType === "sheets" || jobType === "sheet" || jobType === "paper") {
    const total = Number(sheet.totalPrice || 0);
    const qty = Number(sheet.sheetsNeeded || 0);
    paperItems.push({
      name: "Paper Printing",
      sku: sheet.paperKey || "",
      specs: `${sheet.sheetKey || ""} • ${sheet.paperKey || ""} • ${(sheet.frontColorMode || "").toUpperCase()}${sheet.showBack ? " / " + String(sheet.backColorMode || "").toUpperCase() : ""}`,
      qty,
      unitPrice: qty > 0 ? total / qty : total,
      total
    });
  }

  if (jobType === "large-format" || jobType === "largeFormat") {
    const total = Number(lf.lfTotal || 0);
    const addons = lf.addons || {};
    const addonList = [
      addons.grommets ? "Grommets" : null,
      addons.foamCore ? "Foam Core" : null,
      addons.coroSign ? "Coro Sign" : null,
    ].filter(Boolean);

    largeFormatItems.push({
      name: "Large Format",
      sku: lf.paperKey || "",
      specs: `${Number(lf.width) || 0}" × ${Number(lf.height) || 0}" • ${lf.paperKey || ""} • ${String(lf.colorMode || "").toUpperCase()}${addonList.length ? " • " + addonList.join(", ") : ""}`,
      qty: 1,
      unitPrice: total,
      total
    });
  }

  if (jobType === "blueprints" || jobType === "blueprint") {
    const total = Number(bp.total || 0);
    const qty = Number(bp.qty || 0);
    blueprintItems.push({
      name: "Blueprints",
      sku: bp.paperKey || "plain_20lb",
      specs: `${bp.size || ""} • ${Number(bp.width) || 0}" × ${Number(bp.height) || 0}" • ${(bp.colorMode || "bw").toUpperCase()}`,
      qty,
      unitPrice: qty > 0 ? total / qty : total,
      total
    });
  }

  const subtotal =
    paperItems.reduce((s, i) => s + (Number(i.total) || 0), 0) +
    largeFormatItems.reduce((s, i) => s + (Number(i.total) || 0), 0) +
    blueprintItems.reduce((s, i) => s + (Number(i.total) || 0), 0);

  const order = {
    orderId,
    customerName: user.name || "Walk-In",
    phone: user.phone || "",
    email: user.email || "",
    dueDate: "ASAP",
    fulfillment: "Pickup",
    notes: "",
    subtotal,
    discountPct: 0,
    discountAmt: 0,
    total: subtotal,
    paperItems,
    largeFormatItems,
    blueprintItems
  };

  return { order, deepLinkUrl };
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
          ${items.map((it) => `
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
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function buildInternalEmail({ order, deepLinkUrl, store }) {
  const paperItems = order.paperItems || [];
  const largeFormatItems = order.largeFormatItems || [];
  const blueprintItems = order.blueprintItems || [];

  const subtotal = Number(order.subtotal || 0);
  const discountPct = Number(order.discountPct || 0);
  const discountAmt = Number(order.discountAmt || 0);
  const total = Number(order.total || (subtotal - discountAmt));

  const headerTitle = `${store.name} – Print Order`;
  const orderId = order.orderId || "";

  const button = deepLinkUrl
    ? `<a href="${esc(deepLinkUrl)}" style="display:inline-block;margin-top:10px;background:#008198;color:#FFFFFF;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:800;">Open Job in App</a>`
    : "";

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#FFFFFF;padding:18px;">
    <div style="max-width:860px;margin:0 auto;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;">
      <div style="background:#008198;padding:16px 18px;">
        <div style="font-size:18px;font-weight:900;color:#FFFFFF;">${esc(headerTitle)}</div>
        <div style="font-size:13px;color:#FFFFFF;opacity:.95;margin-top:4px;">
          ${orderId ? `Order ID: <b style="background:#FFD100;color:#000000;padding:2px 8px;border-radius:999px;">${esc(orderId)}</b> • ` : ""}
          ${esc(store.address)}
        </div>
        ${button}
      </div>

      <div style="padding:18px;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:280px;border:1px solid #E5E7EB;border-radius:12px;">
            <div style="padding:10px 12px;background:#FFD100;font-weight:900;color:#000000;border-bottom:1px solid #E5E7EB;">
              Order Summary
            </div>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:6px 10px;font-weight:700;">Customer</td><td style="padding:6px 10px;">${esc(order.customerName || "")}</td></tr>
              ${order.phone ? `<tr><td style="padding:6px 10px;font-weight:700;">Phone</td><td style="padding:6px 10px;">${esc(order.phone)}</td></tr>` : ""}
              ${order.email ? `<tr><td style="padding:6px 10px;font-weight:700;">Email</td><td style="padding:6px 10px;">${esc(order.email)}</td></tr>` : ""}
              ${order.dueDate ? `<tr><td style="padding:6px 10px;font-weight:700;">Due</td><td style="padding:6px 10px;">${esc(order.dueDate)}</td></tr>` : ""}
              ${order.fulfillment ? `<tr><td style="padding:6px 10px;font-weight:700;">Pickup/Delivery</td><td style="padding:6px 10px;">${esc(order.fulfillment)}</td></tr>` : ""}
              ${order.notes ? `<tr><td style="padding:6px 10px;font-weight:700;">Notes</td><td style="padding:6px 10px;">${esc(order.notes)}</td></tr>` : ""}
            </table>
          </div>

          <div style="flex:1;min-width:280px;border:1px solid #E5E7EB;border-radius:12px;">
            <div style="padding:10px 12px;background:#F8FAFC;font-weight:900;color:#000000;border-bottom:1px solid #E5E7EB;">
              Pricing
            </div>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px 12px;font-weight:700;">Subtotal</td><td style="padding:8px 12px;text-align:right;">${money(subtotal)}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:700;">Discount ${discountPct ? `(${discountPct}%)` : ""}</td><td style="padding:8px 12px;text-align:right;">-${money(discountAmt)}</td></tr>
              <tr><td style="padding:10px 12px;font-weight:900;border-top:1px solid #E5E7EB;">Total</td><td style="padding:10px 12px;text-align:right;font-weight:900;border-top:1px solid #E5E7EB;">${money(total)}</td></tr>
            </table>
          </div>
        </div>

        ${renderItemsTable("Paper Printing", paperItems)}
        ${renderItemsTable("Large Format", largeFormatItems)}
        ${renderItemsTable("Blueprints", blueprintItems)}

        <div style="margin-top:18px;border-top:1px solid #E5E7EB;padding-top:14px;">
          <div style="font-size:14px;font-weight:900;color:#000000;margin-bottom:6px;">Attachments</div>
          <ul style="margin:0;padding-left:18px;color:#111827;">
            <li>Print Order Sheet (PDF)</li>
          </ul>
          <div style="font-size:12px;color:#374151;margin-top:10px;">
            Store phone: ${esc(store.phone)} • Email: ${esc(store.email)}
          </div>
        </div>
      </div>
    </div>
  </div>`;
  const text =
`PRINT ORDER
Order ID: ${orderId}
Customer: ${order.customerName || ""}
Phone: ${order.phone || ""}
Email: ${order.email || ""}

Subtotal: ${money(subtotal)}
Discount: -${money(discountAmt)}${discountPct ? ` (${discountPct}%)` : ""}
Total: ${money(total)}

Paper items: ${paperItems.length}
Large format items: ${largeFormatItems.length}
Blueprint items: ${blueprintItems.length}

Attachment: Print Order Sheet (PDF)
${deepLinkUrl ? `Open Job: ${deepLinkUrl}` : ""}`;
  return { html, text };
}

exports.handler = async (event) => {
  console.log("send-print-job invoked", { httpMethod: event.httpMethod });

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body = {};
  const rawBody = event.body || "";
  try {
    console.log("Raw body length:", rawBody.length);
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch (err) {
    console.error("JSON parse failed:", err);
    body = {};
  }

  console.log("Parsed body keys:", Object.keys(body));

  const { subject, to, pdfBase64, jobPdfBase64, orderSheetPdfBase64 } = body;

  // SMTP env vars
  const missingEnv = [];
  ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"].forEach((key) => {
    if (!process.env[key]) missingEnv.push(key);
  });
  if (missingEnv.length) {
    console.error("Missing SMTP env vars:", missingEnv.join(", "));
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "SMTP not configured on server", missingEnv }),
    };
  }

  // Normalize order
  const STORE = {
    name: process.env.STORE_NAME || "The UPS Store",
    address: process.env.STORE_ADDRESS || "4352 Bay Road, Saginaw MI 48603",
    phone: process.env.STORE_PHONE || "989.790.9701",
    email: process.env.STORE_EMAIL || "store4979@theupsstore.com",
  };

  const { order, deepLinkUrl } = normalizeOrder(body);
  const { html, text } = buildInternalEmail({ order, deepLinkUrl, store: STORE });

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: to || STORE.email,
      subject: subject || `Print Order – ${order.orderId || ""}`,
      html,
      text,
      attachments: [],
    };

    // Attach PDFs (job file + order sheet). Support legacy pdfBase64 as the job PDF.
    const jobRawSrc = jobPdfBase64 || pdfBase64;
    if (jobRawSrc) {
      const raw = String(jobRawSrc).replace(/^data:application\/pdf;base64,/, "");
      mailOptions.attachments.push({
        filename: `Print-Ready-${order.orderId || "job"}.pdf`,
        content: Buffer.from(raw, "base64"),
        contentType: "application/pdf",
      });
      console.log("Job PDF attachment bytes:", Buffer.byteLength(raw, "base64"));
    } else {
      console.warn("No job PDF provided; sending email without print-ready attachment.");
    }

    if (orderSheetPdfBase64) {
      const raw2 = String(orderSheetPdfBase64).replace(/^data:application\/pdf;base64,/, "");
      mailOptions.attachments.push({
        filename: `Print-Order-Sheet-${order.orderId || "job"}.pdf`,
        content: Buffer.from(raw2, "base64"),
        contentType: "application/pdf",
      });
      console.log("Order sheet PDF attachment bytes:", Buffer.byteLength(raw2, "base64"));
    } else {
      console.warn("No orderSheetPdfBase64 provided; sending email without order sheet attachment.");
    }

    const info = await transporter.sendMail(mailOptions);
    console.log("Mail sent OK:", info && info.messageId);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, message: "Email sent", id: info.messageId }),
    };
  } catch (err) {
    console.error("Unhandled send-print-job error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: "Failed to send email",
        details: err && err.message ? err.message : String(err),
      }),
    };
  }
};
