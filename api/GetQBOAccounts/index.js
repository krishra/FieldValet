const { requireSession, json } = require("../shared/auth");
const { qboFetch } = require("../shared/qboClient");

// Smoke test for the QBO connection: lists the sandbox company's chart of
// accounts. Not used by any UI yet — hit it directly to confirm OAuth worked.
module.exports = async function (context, req) {
  const session = requireSession(context, req);
  if (!session) return;

  try {
    const query = encodeURIComponent("select * from Account");
    const data = await qboFetch(session.tid, `query?query=${query}`, { method: "GET" });
    const accounts = (data.QueryResponse && data.QueryResponse.Account) || [];
    json(context, 200, { count: accounts.length, accounts });
  } catch (err) {
    context.log.error("GetQBOAccounts failed", err);
    json(context, 500, { error: String((err && err.message) || err) });
  }
};
