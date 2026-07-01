// Sends transactional email via the SendGrid v3 REST API.
// Required app settings: SENDGRID_API_KEY, FROM_EMAIL.
const https = require("https");

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error("SENDGRID_API_KEY app setting is not configured.");

  const from = process.env.FROM_EMAIL || "noreply@fieldvalet.app";
  const payload = JSON.stringify({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from },
    subject,
    content: [{ type: "text/html", value: html }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.sendgrid.com",
        path: "/v3/mail/send",
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          res.resume(); // drain
          resolve();
        } else {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => reject(new Error(`SendGrid ${res.statusCode}: ${body.slice(0, 300)}`)));
        }
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { sendEmail };
