// POST /api/auth/forgot-password  { email }
//
// Security notes:
//   • Always returns 200 with the same message regardless of whether the
//     email exists — no user enumeration possible via this endpoint.
//   • Reset tokens are opaque; only the SHA-256 hash is stored.
//   • Tokens expire after 1 hour and are single-use (deleted on redemption).
//   • Required app settings: SENDGRID_API_KEY, FROM_EMAIL, SITE_URL.

const { normalizeEmail, emailKey, json, generateToken, hashSecret } = require("../shared/auth");
const {
  tableClient, USERS_TABLE, USERS_PARTITION,
  RESET_TOKENS_TABLE, RESET_TOKENS_PARTITION, ensureTable,
} = require("../shared/storage");
const { sendEmail } = require("../shared/email");

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const SUCCESS_MSG = "If an account exists with that email address, a reset link has been sent. Check your inbox (and spam folder).";

module.exports = async function (context, req) {
  const email = normalizeEmail((req.body || {}).email);
  if (!email) {
    json(context, 400, { error: "Email address is required." });
    return;
  }

  try {
    // Look up user — but do NOT reveal the result to the caller.
    const users = tableClient(USERS_TABLE);
    let user = null;
    try {
      user = await users.getEntity(USERS_PARTITION, emailKey(email));
    } catch (e) {
      if (e && e.statusCode !== 404) throw e;
    }

    if (!user) {
      json(context, 200, { message: SUCCESS_MSG });
      return;
    }

    // Create and store the reset token.
    await ensureTable(RESET_TOKENS_TABLE);
    const token = generateToken();
    await tableClient(RESET_TOKENS_TABLE).createEntity({
      partitionKey: RESET_TOKENS_PARTITION,
      rowKey: token.tokenId,
      userRowKey: emailKey(user.email),
      tokenHash: token.tokenHash,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    });

    const siteUrl = (process.env.SITE_URL || "").replace(/\/$/, "");
    const resetLink = `${siteUrl}/reset-password?token=${encodeURIComponent(token.tokenValue)}`;

    await sendEmail({
      to: user.email,
      subject: "Reset your FieldValet password",
      html: buildEmailHtml(user.fullName || user.email, resetLink),
    });

    json(context, 200, { message: SUCCESS_MSG });
  } catch (err) {
    context.log.error("ForgotPassword failed", err);
    // Surface a 500 only for misconfiguration (email service down, etc.) so
    // operators know to fix it — but still without leaking user existence.
    json(context, 500, { error: "Unable to send reset email. Please try again later." });
  }
};

function buildEmailHtml(name, resetLink) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:40px;color:#1a1a2e">
        <tr><td style="padding-bottom:24px;border-bottom:1px solid #e8e8e8">
          <span style="font-size:18px;font-weight:700;color:#4f6ef7">FV</span>
          <span style="font-size:16px;font-weight:600;margin-left:8px">FieldValet</span>
        </td></tr>
        <tr><td style="padding-top:28px">
          <h2 style="margin:0 0 16px;font-size:22px">Reset your password</h2>
          <p style="margin:0 0 12px;color:#444">Hi ${esc(name)},</p>
          <p style="margin:0 0 28px;color:#444">We received a request to reset the password for your FieldValet account. Click the button below to choose a new password.</p>
          <p style="margin:0 0 28px">
            <a href="${resetLink}" style="display:inline-block;background:#4f6ef7;color:#fff;text-decoration:none;padding:13px 28px;border-radius:6px;font-weight:600;font-size:15px">Reset password</a>
          </p>
          <p style="margin:0 0 12px;color:#666;font-size:13px">This link expires in <strong>1 hour</strong>. If you didn't request a password reset you can safely ignore this email — your password will not change.</p>
          <p style="margin:0;color:#888;font-size:12px">If the button doesn't work, copy and paste this URL into your browser:<br/>
            <a href="${resetLink}" style="color:#4f6ef7;word-break:break-all">${resetLink}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
