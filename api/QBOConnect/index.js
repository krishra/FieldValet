const { requireSession, json } = require("../shared/auth");
const { signOAuthState, authorizeUrl } = require("../shared/qboClient");

module.exports = async function (context, req) {
  const session = requireSession(context, req);
  if (!session) return;

  if (!process.env.QBO_CLIENT_ID || !process.env.QBO_REDIRECT_URI) {
    json(context, 500, { error: "QBO_CLIENT_ID / QBO_REDIRECT_URI app settings are not configured." });
    return;
  }

  const state = signOAuthState(session.tid);
  context.res = {
    status: 302,
    headers: { Location: authorizeUrl(state) },
  };
};
