// POST /api/auth/reset-password  { token, newPassword }
//
// Verifies the single-use reset token, updates the password, revokes all
// existing refresh tokens for the user (invalidating any stolen sessions),
// then issues a fresh access JWT + refresh token so the user is immediately
// signed in without a separate login step.

const {
  json, parseTokenValue, hashSecret, hashPassword,
  signSession, sessionCookie,
  generateToken, refreshCookie, clearedRefreshCookie, REFRESH_TTL_SECONDS,
  normalizeEmail, emailKey,
} = require("../shared/auth");
const {
  tableClient,
  USERS_TABLE, USERS_PARTITION,
  RESET_TOKENS_TABLE, RESET_TOKENS_PARTITION,
  REFRESH_TOKENS_TABLE, REFRESH_TOKENS_PARTITION,
} = require("../shared/storage");

const MIN_PASSWORD_LENGTH = 8;

module.exports = async function (context, req) {
  const body = req.body || {};
  const tokenValue = String(body.token || "");
  const newPassword = String(body.newPassword || "");

  if (!tokenValue || !newPassword) {
    json(context, 400, { error: "Token and new password are required." });
    return;
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    json(context, 400, { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    return;
  }

  const parsed = parseTokenValue(tokenValue);
  if (!parsed) {
    json(context, 400, { error: "Invalid reset link." });
    return;
  }

  const { tokenId, secretHex } = parsed;

  try {
    const resetTable = tableClient(RESET_TOKENS_TABLE);

    let stored;
    try {
      stored = await resetTable.getEntity(RESET_TOKENS_PARTITION, tokenId);
    } catch (e) {
      if (e && e.statusCode === 404) {
        json(context, 400, { error: "This reset link is invalid or has already been used." });
        return;
      }
      throw e;
    }

    if (new Date() > new Date(stored.expiresAt)) {
      await resetTable.deleteEntity(RESET_TOKENS_PARTITION, tokenId).catch(() => {});
      json(context, 400, { error: "This reset link has expired. Please request a new one." });
      return;
    }

    if (hashSecret(secretHex) !== stored.tokenHash) {
      json(context, 400, { error: "Invalid reset link." });
      return;
    }

    // Fetch user.
    const users = tableClient(USERS_TABLE);
    let user;
    try {
      user = await users.getEntity(USERS_PARTITION, stored.userRowKey);
    } catch (e) {
      json(context, 400, { error: "User account not found." });
      return;
    }

    // Update the password hash.
    await users.updateEntity(
      { partitionKey: USERS_PARTITION, rowKey: stored.userRowKey, passwordHash: hashPassword(newPassword) },
      "Merge"
    );

    // Consume the reset token (single-use).
    await resetTable.deleteEntity(RESET_TOKENS_PARTITION, tokenId).catch(() => {});

    // Revoke ALL existing refresh tokens for this user so that any sessions
    // open with the old password are immediately invalidated.
    const rt = tableClient(REFRESH_TOKENS_TABLE);
    try {
      for await (const t of rt.listEntities({ queryOptions: { filter: `userId eq '${user.userId}'` } })) {
        await rt.deleteEntity(t.partitionKey, t.rowKey).catch(() => {});
      }
    } catch (e) {
      // If the table doesn't exist yet there are no tokens to revoke — fine.
      if (!e || e.statusCode !== 404) context.log.warn("Could not revoke old refresh tokens", e && e.message);
    }

    // Issue fresh session (auto-login after reset).
    const claims = {
      sub: user.userId,
      email: user.email,
      name: user.fullName,
      tid: user.tenantId,
      role: user.role || "member",
    };

    const newRt = generateToken();
    await rt.createEntity({
      partitionKey: REFRESH_TOKENS_PARTITION,
      rowKey: newRt.tokenId,
      userId: user.userId,
      userRowKey: stored.userRowKey,
      tokenHash: newRt.tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    });

    json(
      context,
      200,
      { userId: user.userId, fullName: user.fullName, email: user.email, tenantId: user.tenantId, role: claims.role },
      { "Set-Cookie": [sessionCookie(signSession(claims)), refreshCookie(newRt.tokenValue)] }
    );
  } catch (err) {
    context.log.error("ResetPassword failed", err);
    json(context, 500, { error: "Password reset temporarily unavailable." });
  }
};
