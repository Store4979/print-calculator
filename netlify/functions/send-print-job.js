// netlify/functions/send-print-job.js
// Professional internal + optional customer confirmation email with branding, deep link, and (optional) inline logo.
// Drop-in replacement for your existing function.

const nodemailer = require("nodemailer");

// ---------- helpers ----------
const money = (n) =>
  Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

const esc = (s) =>
  String(s ?? "").replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])
  );

// Accept either a raw base64 string OR a data URL like "data:image/png;base64,...."
function normalizeBase64Image(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (m) return { mime: m[1], b64: m[2] };
  // Heuristic default to png if no data-url header
  return { mime: "image/png", b64: s.replace(/\s/g, "") };
}

function normalizePdfBase64(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/^data:application\/pdf;base64,(.+)$/);
  return (m ? m[1] : s).replace(/\s/g, "");
}

function renderItemsTable(title, items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `
    <div style="margin-top:18px;">
      <div style="font-size:15px;font-weight:900;color:#000000;margin:0 0 8px 0;">
        ${esc(title)}
      </div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
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
                <div style="font-weight:800;color:#000000;">${esc(it.name || "Item")}</div>
                ${
                  it.sku
                    ? `<div style="font-size:12px;color:#374151;">SKU: ${esc(
                        it.sku
                      )}</div>`
                    : ""
                }
              </td>
              <td style="padding:10px;border-bottom:1px solid #E5E7EB;color:#111827;">
                ${esc(it.specs || "")}
              </td>
              <td style="padding:10px;border-bottom:1px solid #E5E7EB;text-align:right;">${esc(
                it.qty ?? ""
              )}</td>
              <td style="padding:10px;border-bottom:1px solid #E5E7EB;text-align:right;">${money(
                it.unitPrice
              )}</td>
              <td style="padding:10px;border-bottom:1px solid #E5E7EB;text-align:right;font-weight:900;">${money(
                it.total
              )}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- templates ----------
function buildInternalEmail({ store, order, deepLinkUrl, logoCid }) {
  const paperItems = order.paperItems || [];
  const largeFormatItems = order.largeFormatItems || [];
  const blueprintItems = order.blueprintItems || [];

  const subtotal = Number(order.subtotal || 0);
  const discountPct = Number(order.discountPct || 0);
  const discountAmt = Number(order.discountAmt || 0);
  const total = Number(order.total || subtotal - discountAmt);

  const headerTitle = `${store?.name || "The UPS Store"} – Print Order`;
  const orderId = order.orderId || order.jobId || "";

  const logoHtml = logoCid
    ? `<img src="cid:${esc(
        logoCid
      )}" alt="Logo" style="height:34px; width:auto; display:block;" />`
    : "";

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#FFFFFF;padding:18px;">
    <div style="max-width:820px;margin:0 auto;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;">

      <!-- Brand Header -->
      <div style="background:#008198;padding:16px 18px;">
        <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;">
          <div>
            <div style="font-size:18px;font-weight:900;color:#FFFFFF;">${esc(
              headerTitle
            )}</div>
            <div style="font-size:13px;color:#FFFFFF;opacity:.95;margin-top:4px;">
              ${
                orderId
                  ? `Order ID: <b>${esc(orderId)}</b>`
                  : `Order ID: <b>N/A</b>`
              }
              ${
                store?.storeId ? ` • Store: <b>${esc(store.storeId)}</b>` : ""
              }
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            ${logoHtml}
          </div>
        </div>
      </div>

      <div style="padding:18px;">
        <!-- Big ID pill -->
        <div style="display:inline-block;background:#FFD100;color:#000000;font-weight:900;padding:8px 12px;border-radius:999px;margin-bottom:12px;">
          ${orderId ? `JOB: ${esc(orderId)}` : "JOB: N/A"}
        </div>

        <!-- Summary -->
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:260px;border:1px solid #E5E7EB;border-radius:12px;">
            <div style="padding:10px 12px;background:#FFD100;font-weight:900;color:#000000;border-bottom:1px solid #E5E7EB;">
              Order Summary
            </div>
            <table style="width:100%;border-collapse:collapse;">
              ${order.customerName ? `<tr><td style="padding:6px 10px;font-weight:700;">Customer</td><td style="padding:6px 10px;">${esc(order.customerName)}</td></tr>` : ""}
              ${order.company ? `<tr><td style="padding:6px 10px;font-weight:700;">Company</td><td style="padding:6px 10px;">${esc(order.company)}</td></tr>` : ""}
              ${order.phone ? `<tr><td style="padding:6px 10px;font-weight:700;">Phone</td><td style="padding:6px 10px;">${esc(order.phone)}</td></tr>` : ""}
              ${order.email ? `<tr><td style="padding:6px 10px;font-weight:700;">Email</td><td style="padding:6px 10px;">${esc(order.email)}</td></tr>` : ""}
              ${order.dueDate ? `<tr><td style="padding:6px 10px;font-weight:700;">Due</td><td style="padding:6px 10px;">${esc(order.dueDate)}</td></tr>` : ""}
              ${order.fulfillment ? `<tr><td style="padding:6px 10px;font-weight:700;">Pickup/Delivery</td><td style="padding:6px 10px;">${esc(order.fulfillment)}</td></tr>` : ""}
              ${order.notes ? `<tr><td style="padding:6px 10px;font-weight:700;">Notes</td><td style="padding:6px 10px;">${esc(order.notes)}</td></tr>` : ""}
            </table>
          </div>

          <div style="flex:1;min-width:260px;border:1px solid #E5E7EB;border-radius:12px;">
            <div style="padding:10px 12px;background:#F8FAFC;font-weight:900;color:#000000;border-bottom:1px solid #E5E7EB;">
              Pricing
            </div>
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:8px 12px;color:#000000;font-weight:700;">Subtotal</td>
                <td style="padding:8px 12px;text-align:right;">${money(subtotal)}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;color:#000000;font-weight:700;">
                  Discount ${discountPct ? `(${Number(discountPct).toFixed(0)}%)` : ""}
                </td>
                <td style="padding:8px 12px;text-align:right;">-${money(discountAmt)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;color:#000000;font-weight:900;border-top:1px solid #E5E7EB;">Total</td>
                <td style="padding:10px 12px;text-align:right;font-weight:900;border-top:1px solid #E5E7EB;">${money(total)}</td>
              </tr>
            </table>

            ${
              deepLinkUrl
                ? `<div style="padding:10px 12px;border-top:1px solid #E5E7EB;">
                    <a href="${esc(
                      deepLinkUrl
                    )}" style="display:inline-block;background:#008198;color:#FFFFFF;text-decoration:none;font-weight:900;padding:10px 12px;border-radius:10px;">
                      Open Job in App
                    </a>
                  </div>`
                : ""
            }
          </div>
        </div>

        <!-- Line Items (only include what was selected) -->
        ${renderItemsTable("Paper Printing", paperItems)}
        ${renderItemsTable("Large Format", largeFormatItems)}
        ${renderItemsTable("Blueprints", blueprintItems)}

        <!-- Attachments -->
        <div style="margin-top:18px;border-top:1px solid #E5E7EB;padding-top:14px;">
          <div style="font-size:14px;font-weight:900;color:#000000;margin-bottom:6px;">Attachments</div>
          <ul style="margin:0;padding-left:18px;color:#111827;">
            <li>Print Order Sheet (PDF)</li>
          </ul>
          <div style="font-size:12px;color:#374151;margin-top:10px;">
            If anything looks off, reply to this email or call the store at ${esc(
              store?.phone || ""
            )}.
          </div>
        </div>
      </div>
    </div>

    <div style="max-width:820px;margin:10px auto 0;color:#6B7280;font-size:11px;line-height:1.4;">
      Internal print job notification generated by the Print App.
    </div>
  </div>
  `;

  const text = [
    `${store?.name || "The UPS Store"} – Print Order`,
    orderId ? `Order ID: ${orderId}` : "Order ID: N/A",
    store?.storeId ? `Store: ${store.storeId}` : "",
    "",
    "ORDER SUMMARY",
    order.customerName ? `Customer: ${order.customerName}` : "",
    order.company ? `Company: ${order.company}` : "",
    order.phone ? `Phone: ${order.phone}` : "",
    order.email ? `Email: ${order.email}` : "",
    order.dueDate ? `Due: ${order.dueDate}` : "",
    order.fulfillment ? `Pickup/Delivery: ${order.fulfillment}` : "",
    order.notes ? `Notes: ${order.notes}` : "",
    "",
    "PRICING",
    `Subtotal: ${money(subtotal)}`,
    `Discount: -${money(discountAmt)}${discountPct ? ` (${Number(discountPct).toFixed(0)}%)` : ""}`,
    `Total: ${money(total)}`,
    deepLinkUrl ? `\nOpen Job: ${deepLinkUrl}` : "",
    "",
    "ATTACHMENTS",
    "- Print Order Sheet (PDF)",
  ]
    .filter(Boolean)
    .join("\n");

  return { html, text };
}

function buildCustomerEmail({ store, order, deepLinkUrl, logoCid }) {
  const paperItems = order.paperItems || [];
  const largeFormatItems = order.largeFormatItems || [];
  const blueprintItems = order.blueprintItems || [];

  const subtotal = Number(order.subtotal || 0);
  const discountAmt = Number(order.discountAmt || 0);
  const total = Number(order.total || subtotal - discountAmt);

  const orderId = order.orderId || order.jobId || "";

  const logoHtml = logoCid
    ? `<img src="cid:${esc(
        logoCid
      )}" alt="Logo" style="height:32px; width:auto; display:block;" />`
    : "";

  const allItems = [...paperItems, ...largeFormatItems, ...blueprintItems];

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#FFFFFF;padding:18px;">
    <div style="max-width:820px;margin:0 auto;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;">
      <div style="background:#008198;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div style="color:#FFFFFF;">
          <div style="font-size:18px;font-weight:900;margin:0;">${esc(
            store?.name || "The UPS Store"
          )}</div>
          <div style="font-size:13px;opacity:.95;margin-top:4px;">Your print request has been received.</div>
        </div>
        ${logoHtml}
      </div>

      <div style="padding:18px;">
        <div style="display:inline-block;background:#FFD100;color:#000000;font-weight:900;padding:8px 12px;border-radius:999px;margin-bottom:12px;">
          ${orderId ? `Order ID: ${esc(orderId)}` : "Order Received"}
        </div>

        <div style="font-size:14px;color:#111827;line-height:1.5;">
          Hi${order.customerName ? ` ${esc(order.customerName)}` : ""},<br/>
          Thanks for your order! Below is a summary of your print request.
        </div>

        <div style="margin-top:14px;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
          <div style="padding:10px 12px;background:#F8FAFC;font-weight:900;color:#000000;border-bottom:1px solid #E5E7EB;">
            Summary
          </div>
          <div style="padding:12px;">
            ${order.dueDate ? `<div><b>Due:</b> ${esc(order.dueDate)}</div>` : ""}
            ${order.fulfillment ? `<div><b>Pickup/Delivery:</b> ${esc(order.fulfillment)}</div>` : ""}
            ${store?.phone ? `<div><b>Store phone:</b> ${esc(store.phone)}</div>` : ""}
            <div style="margin-top:10px;"><b>Total:</b> ${money(total)}</div>
            ${discountAmt ? `<div style="color:#374151;">Includes discount: -${money(discountAmt)}</div>` : ""}
          </div>
        </div>

        ${renderItemsTable("Your Items", allItems)}

        ${
          deepLinkUrl
            ? `<div style="margin-top:16px;">
                <a href="${esc(
                  deepLinkUrl
                )}" style="display:inline-block;background:#008198;color:#FFFFFF;text-decoration:none;font-weight:900;padding:10px 12px;border-radius:10px;">
                  View Order
                </a>
              </div>`
            : ""
        }

        <div style="margin-top:18px;border-top:1px solid #E5E7EB;padding-top:14px;font-size:12px;color:#374151;line-height:1.5;">
          We’ll contact you if we have any questions. If you need to update your order, reply to this email or call the store.
        </div>
      </div>
    </div>
  </div>
  `;

  const text = [
    `${store?.name || "The UPS Store"}`,
    "Your print request has been received.",
    orderId ? `Order ID: ${orderId}` : "",
    order.dueDate ? `Due: ${order.dueDate}` : "",
    order.fulfillment ? `Pickup/Delivery: ${order.fulfillment}` : "",
    store?.phone ? `Store phone: ${store.phone}` : "",
    "",
    `Total: ${money(total)}`,
    discountAmt ? `Discount: -${money(discountAmt)}` : "",
    "",
    "Items:",
    ...allItems.map(
      (it) =>
        `- ${it.name || "Item"} | ${it.specs || ""} | Qty ${it.qty ?? ""} | Total ${money(
          it.total
        )}`
    ),
    deepLinkUrl ? `\nView Order: ${deepLinkUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { html, text };
}

// ---------- main handler ----------
exports.handler = async (event) => {
  console.log("send-print-job invoked", { httpMethod: event.httpMethod });

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (err) {
    console.error("JSON parse failed:", err);
    body = {};
  }

  // Backwards compatibility with your old payload:
  // { subject, to, jobType, details, pdfBase64 }
  // New payload:
  // { subject, to, order, pdfBase64, deepLinkUrl, sendCustomerConfirmation, customerTo, emailLogoBase64, store }
  const {
    subject,
    to,
    jobType,
    details,
    order: orderIn,
    pdfBase64,
    deepLinkUrl,
    sendCustomerConfirmation,
    customerTo,
    emailLogoBase64,
    store: storeIn,
  } = body;

  const store = {
    name: storeIn?.name || process.env.STORE_NAME || "The UPS Store",
    storeId: storeIn?.storeId || process.env.STORE_ID || "4979",
    phone: storeIn?.phone || process.env.STORE_PHONE || "",
    addressLine: storeIn?.addressLine || process.env.STORE_ADDRESS || "",
  };

  const order =
    orderIn && typeof orderIn === "object"
      ? orderIn
      : {
          orderId: details?.orderId || details?.jobId || "",
          customerName: details?.customerName || details?.name || "",
          company: details?.company || "",
          phone: details?.phone || "",
          email: details?.email || "",
          dueDate: details?.dueDate || "",
          fulfillment: details?.fulfillment || "",
          notes: details?.notes || "",
          subtotal: details?.subtotal || 0,
          discountPct: details?.discountPct || 0,
          discountAmt: details?.discountAmt || 0,
          total: details?.total || 0,
          paperItems: details?.paperItems || [],
          largeFormatItems: details?.largeFormatItems || [],
          blueprintItems: details?.blueprintItems || [],
          jobType: jobType || details?.jobType || "",
        };

  // Check SMTP env vars
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

  const logo = normalizeBase64Image(emailLogoBase64 || process.env.EMAIL_LOGO_BASE64);
  const logoCid = logo ? "storelogo@printapp" : null;
  const pdfB64 = normalizePdfBase64(pdfBase64);

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const orderId = order.orderId || order.jobId || "";
    const internalSubject =
      subject ||
      `Print Order – ${order.customerName || "Walk-In"}${orderId ? ` – ${orderId}` : ""} – Store ${store.storeId}`;

    // INTERNAL email
    const internalTpl = buildInternalEmail({ store, order, deepLinkUrl, logoCid });

    const internalMail = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: to || "store4979@theupsstore.com",
      subject: internalSubject,
      html: internalTpl.html,
      text: internalTpl.text,
      attachments: [],
    };

    if (logo && logoCid) {
      internalMail.attachments.push({
        filename: "logo.png",
        content: Buffer.from(logo.b64, "base64"),
        contentType: logo.mime,
        cid: logoCid,
      });
    }

    if (pdfB64) {
      internalMail.attachments.push({
        filename: `Print-Order-${orderId || "job"}.pdf`,
        content: Buffer.from(pdfB64, "base64"),
        contentType: "application/pdf",
      });
    }

    const internalInfo = await transporter.sendMail(internalMail);
    console.log("Internal mail sent OK:", internalInfo && internalInfo.messageId);

    // Optional CUSTOMER email
    let customerResult = null;
    const shouldSendCustomer =
      Boolean(sendCustomerConfirmation) && Boolean(customerTo || order.email);

    if (shouldSendCustomer) {
      const custRecipient = customerTo || order.email;

      const customerTpl = buildCustomerEmail({ store, order, deepLinkUrl, logoCid });

      const customerMail = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: custRecipient,
        subject: `Order Confirmation${orderId ? ` – ${orderId}` : ""} – ${store.name}`,
        html: customerTpl.html,
        text: customerTpl.text,
        attachments: [],
      };

      if (logo && logoCid) {
        customerMail.attachments.push({
          filename: "logo.png",
          content: Buffer.from(logo.b64, "base64"),
          contentType: logo.mime,
          cid: logoCid,
        });
      }

      // Optional: attach the PDF to customer as well IF you want.
      // Turn this on by setting SEND_CUSTOMER_PDF=true in Netlify env.
      if (process.env.SEND_CUSTOMER_PDF === "true" && pdfB64) {
        customerMail.attachments.push({
          filename: `Order-Summary-${orderId || "job"}.pdf`,
          content: Buffer.from(pdfB64, "base64"),
          contentType: "application/pdf",
        });
      }

      const customerInfo = await transporter.sendMail(customerMail);
      console.log("Customer mail sent OK:", customerInfo && customerInfo.messageId);

      customerResult = { ok: true, id: customerInfo.messageId, to: custRecipient };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        message: "Email(s) sent",
        internal: { id: internalInfo.messageId, to: internalMail.to },
        customer: customerResult,
      }),
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
