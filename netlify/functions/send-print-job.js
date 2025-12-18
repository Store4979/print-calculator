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

  try {
    console.log("Raw body length:", event.body ? event.body.length : 0);

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch (err) {
      console.error("Failed to parse JSON body", err);
      // This is the ONLY case where we still return 400
      return {
        statusCode: 400,
        body: "Invalid JSON body",
      };
    }

    console.log("Parsed body keys:", Object.keys(body));

    const { subject, to, jobType, details, pdfBase64 } = body;

    // 🔴 DO NOT reject just because pdfBase64 is missing.
    // If it's missing, we send the email without attachment.
    if (!pdfBase64) {
      console.warn(
        "No pdfBase64 provided; email will be sent WITHOUT PDF attachment."
      );
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
${JSON.stringify(details, null, 2)}
`;

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: to || "store4979@theupsstore.com",
      subject: subject || "PRINT JOB",
      text: textSummary,
      attachments: [],
    };

    // Attach PDF only if we actually got base64
    if (pdfBase64) {
      mailOptions.attachments.push({
        filename: "print-job.pdf",
        content: Buffer.from(pdfBase64, "base64"),
        contentType: "application/pdf",
      });
    }

    const info = await transporter.sendMail(mailOptions);
    console.log("Mail sent OK:", info && info.messageId);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Email sent", id: info.messageId }),
    };
  } catch (err) {
    console.error("Unhandled send-print-job error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to send email",
        details: err && err.message ? err.message : String(err),
      }),
    };
  }
};
