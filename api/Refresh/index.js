// POST /api/auth/refresh
//
// Rotates a valid refresh token: verifies the stored hash, issues a fresh
// access JWT + new refresh token, then deletes the old one.  Any request
// that supplies an invalid or expired token receives a 401 and a cleared
// refresh cookie — the client must prompt for credentials.
//
// Security notes:
//   • Refresh tokens are opaque; only a SHA-256 hash is persisted server-side.
//   • Every successful refresh rotates the token (old is deleted immediately
//     after the new one is written), limiting the replay window to near-zero.
//   • The cookie is scoped to Path=/api/auth so it is never sent to other
//     API endpoints (GetLocations, PostMessage, etc.).

const {
  parseCookies, parseTokenValue, hashSecret,
  signSession, sessionCookie,
  generateToken, refreshCookie, clearedRefreshCookie,
  json, REFRESH_COOKIE_NAME, REFRESH_TTL_SECONDS,
} = require("../shared/auth");
const {
  tableClient,
  REFRESH_TOKENS_TABLE, REFRESH_TOKENS_PARTITION,
  USERS_TABLE, USERS_PARTITION,
} = require("../shared/storage");

module.exports = async function (context, req) {
  const parsed = parseTokenValue((parseCookies(req))[REFRESH_COOKIE_NAME]);
  if (!parsed) {
    json(context, 401, { error: "No refresh token." });
    return;
  }

  const { tokenId, secretHex } = parsed;

  try {
    const rt = tableClient(REFRESH_TOKENS_TABLE);

    // Look up the token record.
    let stored;
    try {
      stored = await rt.getEntity(REFRESH_TOKENS_PARTITION, tokenId);
    } catch (e) {
      if (e && e.statusCode === 404) {
        // Already rotated or expired — clear the stale cookie.
        json(context, 401, { error: "Refresh token not found." }, { "Set-Cookie": clearedRefreshCookie() });
        return;
      }
      throw e;
    }

    // Reject expired tokens (Azure Table Storage has no native TTL).
    if (new Date() > new Date(stored.expiresAt)) {
      await rt.deleteEntity(REFRESH_TOKENS_PARTITION, tokenId).catch(() => {});
      json(context, 401, { error: "Refresh token expired." }, { "Set-Cookie": clearedRefreshCookie() });
      return;
    }

    // Reject wrong secret — could indicate a leaked/forged token value.
    if (hashSecret(secretHex) !== stored.tokenHash) {
      await rt.deleteEntity(REFRESH_TOKENS_PARTITION, tokenId).catch(() => {});
      json(context, 401, { error: "Refresh token invalid." }, { "Set-Cookie": clearedRefreshCookie() });
      return;
    }

    // Fetch the user to build fresh claims (catches deleted/suspended accounts).
    const users = tableClient(USERS_TABLE);
    let user;
    try {
      user = await users.getEntity(USERS_PARTITION, stored.userRowKey);
    } catch (e) {
      await rt.deleteEntity(REFRESH_TOKENS_PARTITION, tokenId).catch(() => {});
      json(context, 401, { error: "User account not found." }, { "Set-Cookie": clearedRefreshCookie() });
      return;
    }

    // Rotate: write new token first, then delete old one.
    // Writing first means a transient deletion failure leaves the user with
    // a new valid cookie rather than no cookie at all.
    const newRt = generateToken();
    await rt.createEntity({
      partitionKey: REFRESH_TOKENS_PARTITION,
      rowKey: newRt.tokenId,
      userId: user.userId,
      userRowKey: stored.userRowKey,
      tokenHash: newRt.tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    });
    await rt.deleteEntity(REFRESH_TOKENS_PARTITION, tokenId).catch(() => {});

    const claims = {
      sub: user.userId,
      email: user.email,
      name: user.fullName,
      tid: user.tenantId,
      role: user.role || "member",
    };

    json(
      context,
      200,
      { userId: user.userId, fullName: user.fullName, email: user.email, tenantId: user.tenantId, role: claims.role },
      { "Set-Cookie": [sessionCookie(signSession(claims)), refreshCookie(newRt.tokenValue)] }
    );
  } catch (err) {
    context.log.error("Token refresh failed", err);
    json(context, 500, { error: "Token refresh temporarily unavailable." });
  }
};
