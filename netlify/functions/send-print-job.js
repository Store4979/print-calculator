// netlify/functions/send-print-job.js
exports.handler = async (event) => {
  console.log("send-print-job invoked", { httpMethod: event.httpMethod });

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

  try {
    const bodyText = event.body || "";
    console.log("Raw body length:", bodyText.length);

    let body = {};
    try {
      body = JSON.parse(bodyText || "{}");
    } catch (err) {
      console.error("JSON parse error:", err);
      return {
        statusCode: 400,
        body: "Invalid JSON body",
      };
    }

    console.log("Parsed body keys:", Object.keys(body));

    // Just echo back some info – NO email for now
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        received: {
          subject: body.subject,
          to: body.to,
          jobType: body.jobType,
          hasPdfBase64: !!body.pdfBase64,
          pdfLength: body.pdfBase64 ? body.pdfBase64.length : 0,
        },
      }),
    };
  } catch (err) {
    console.error("Unhandled error in send-print-job:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String(err) }),
    };
  }
};
