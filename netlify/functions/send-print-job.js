// netlify/functions/send-print-job.js
const nodemailer = require("nodemailer");

exports.handler = async (event) => {
  console.log("send-print-job invoked", { httpMethod: event.httpMethod });

  // Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

  let body = {};
  let rawBody = event.body || "";

  try {
    console.log("Raw body length:", rawBody.length);
    if (rawBody) {
      body = JSON.parse(rawBody);
    } else {
      console.warn("Empty body received");
      body = {};
    }
  } catch (err) {
    console.error("JSON parse failed:", err);
    // 🔵 IMPORTANT: do NOT return 400 here anymore.
    // Just continue with an empty body so we can still test email.
    body = {};
  }

  console.log("Parsed body keys:", Object.keys(body));

  const { subject, to, jobType, details, pdfBase64, jobPdfBase64, orderSheetPdfBase64 } = body;

  
  const mainPdfB64 = pdfBase64 || jobPdfBase64;
if (!pdfBase64) {
    console.warn(
      "No pdfBase64 provided; email will be sent WITHOUT PDF attachment."
    );
  } else {
    console.log("pdfBase64 length:", pdfBase64.length);
  }

  // Check SMTP env vars
  const missingEnv = [];
  ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"].forEach((key) => {
    if (!process.env[key]) missingEnv.push(key);
  });

  if (missingEnv.length) {
    console.error("Missing SMTP env vars:", missingEnv.join(", "));
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "SMTP not configured on server",
        missingEnv,
      }),
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false, // STARTTLS on 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const textSummary = `Job Type: ${jobType || "N/A"}

Details:
${JSON.stringify(details || {}, null, 2)}
`;

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: to || "store4979@theupsstore.com",
      subject: subject || "PRINT JOB",
      text: textSummary,
      attachments: [],
    };

    if (mainPdfB64) {
      mailOptions.attachments.push({
        filename: "print-ready.pdf",
        content: Buffer.from(mainPdfB64, "base64"),
        contentType: "application/pdf",
      });
    }

    if (orderSheetPdfBase64) {
      mailOptions.attachments.push({
        filename: "print-order-sheet.pdf",
        content: Buffer.from(orderSheetPdfBase64, "base64"),
        contentType: "application/pdf",
      });
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
