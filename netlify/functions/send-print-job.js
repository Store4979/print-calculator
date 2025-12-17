const nodemailer = require("nodemailer");

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const {
      subject,
      to,
      jobType,
      details,
      pdfBase64,
    } = body;

    if (!pdfBase64) {
      return {
        statusCode: 400,
        body: "Missing pdfBase64 in request body",
      };
    }

    // Create SMTP transporter using environment variables
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false, // use STARTTLS on 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const textSummary = `Job Type: ${jobType || "N/A"}

Details:
${JSON.stringify(details, null, 2)}
`;

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: to || "store4979@theupsstore.com",
      subject: subject || "PRINT JOB",
      text: textSummary,
      attachments: [
        {
          filename: "print-job.pdf",
          content: Buffer.from(pdfBase64, "base64"),
          contentType: "application/pdf",
        },
      ],
    });

    console.log("Mail sent:", info.messageId);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Email sent", id: info.messageId }),
    };
  } catch (err) {
    console.error("send-print-job error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to send email",
        details: String(err),
      }),
    };
  }
};
