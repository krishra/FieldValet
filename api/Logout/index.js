const {
  clearedCookie, clearedRefreshCookie,
  parseCookies, parseTokenValue, REFRESH_COOKIE_NAME, json,
} = require("../shared/auth");
const { tableClient, REFRESH_TOKENS_TABLE, REFRESH_TOKENS_PARTITION } = require("../shared/storage");

module.exports = async function (context, req) {
  // Best-effort refresh token revocation — delete it from storage so it can
  // never be used again, even if the cookie somehow leaks.
  const parsed = parseTokenValue((parseCookies(req))[REFRESH_COOKIE_NAME]);
  if (parsed) {
    try {
      await tableClient(REFRESH_TOKENS_TABLE).deleteEntity(REFRESH_TOKENS_PARTITION, parsed.tokenId);
    } catch (e) {
      // 404 = already expired/revoked; anything else, log and proceed.
      if (!e || e.statusCode !== 404) {
        context.log.warn("Logout: could not delete refresh token", e && e.message);
      }
    }
  }

  // Clear both cookies.
  json(context, 200, { success: true }, { "Set-Cookie": [clearedCookie(), clearedRefreshCookie()] });
};
