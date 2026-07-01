const {
  hashPassword, verifyPassword, signSession, sessionCookie,
  emailKey, normalizeEmail, json,
  generateToken, refreshCookie, REFRESH_TTL_SECONDS,
} = require("../shared/auth");
const {
  tableClient, USERS_TABLE, USERS_PARTITION,
  REFRESH_TOKENS_TABLE, REFRESH_TOKENS_PARTITION, ensureTable,
} = require("../shared/storage");

// A dummy hash to verify against when the user does not exist, so that a missing
// user and a wrong password take the same amount of time (no user enumeration).
const DUMMY_HASH = hashPassword("fieldvalet-dummy-password");

module.exports = async function (context, req) {
  const body = req.body || {};
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");

  if (!email || !password) {
    json(context, 400, { error: "Email and password are required." });
    return;
  }

  try {
    const users = tableClient(USERS_TABLE);

    let user = null;
    try {
      user = await users.getEntity(USERS_PARTITION, emailKey(email));
    } catch (e) {
      if (!(e && e.statusCode === 404)) throw e;
    }

    const ok = user
      ? verifyPassword(password, user.passwordHash)
      : (verifyPassword(password, DUMMY_HASH), false);

    if (!user || !ok) {
      // Identical generic message for both cases.
      json(context, 401, { error: "Invalid email or password." });
      return;
    }

    const claims = {
      sub: user.userId,
      email: user.email,
      name: user.fullName,
      tid: user.tenantId,
      role: user.role || "member",
    };
    const accessToken = signSession(claims);

    // Issue a long-lived refresh token stored server-side so it can be revoked.
    await ensureTable(REFRESH_TOKENS_TABLE);
    const rt = generateToken();
    await tableClient(REFRESH_TOKENS_TABLE).createEntity({
      partitionKey: REFRESH_TOKENS_PARTITION,
      rowKey: rt.tokenId,
      userId: user.userId,
      userRowKey: emailKey(user.email),
      tokenHash: rt.tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    });

    json(
      context,
      200,
      { userId: user.userId, fullName: user.fullName, email: user.email, tenantId: user.tenantId, role: claims.role },
      { "Set-Cookie": [sessionCookie(accessToken), refreshCookie(rt.tokenValue)] }
    );
  } catch (err) {
    context.log.error("Login failed", err);
    json(context, 500, { error: "Sign-in is temporarily unavailable." });
  }
};
