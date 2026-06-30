const { json } = require("../shared/auth");
const { verifyOAuthState, exchangeCodeForTokens, saveConnection } = require("../shared/qboClient");

// Intuit redirects the browser here after the merchant approves (or denies) the
// connection request. The "state" param — signed in QBOConnect — is what lets us
// recover which tenant this belongs to without a server-side session store.
module.exports = async function (context, req) {
  const { code, state, realmId, error } = req.query;

  if (error) {
    json(context, 400, { error: `QuickBooks authorization was not completed: ${error}` });
    return;
  }

  const claims = verifyOAuthState(state);
  if (!claims) {
    json(context, 400, { error: "Invalid or expired OAuth state. Please retry the connection from FieldValet." });
    return;
  }
  if (!code || !realmId) {
    json(context, 400, { error: "QuickBooks callback was missing code or realmId." });
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveConnection(claims.tid, realmId, tokens);

    context.res = {
      status: 302,
      headers: { Location: "/#/sales" },
    };
  } catch (err) {
    context.log.error("QBOCallback failed", err);
    json(context, 500, { error: String((err && err.message) || err) });
  }
};
