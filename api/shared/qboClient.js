// FieldValet — QuickBooks Online (QBO) API client.
//
// Token lifecycle: access tokens last ~1hr, refresh tokens ~100 days. We store
// both per tenant in Table Storage and refresh on demand in getValidAccessToken.
// A timer-triggered background refresh (so a quiet weekend can't let the refresh
// token go stale) is a later phase, not implemented here.
//
// The OAuth "state" param is a short-lived signed JWT (not a server-side session)
// so the callback can recover which tenant initiated the connection and confirm
// the request actually came from us, without needing sticky session storage.

const jwt = require("jsonwebtoken");
const { tableClient, QBO_CONNECTIONS_TABLE } = require("./storage");

const QBO_ENV = process.env.QBO_ENV || "sandbox";
const QBO_API_BASE =
  QBO_ENV === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
const QBO_OAUTH_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error("JWT_SECRET app setting is missing or too short (need at least 32 characters).");
  }
  return s;
}

function signOAuthState(tenantId) {
  return jwt.sign({ tid: tenantId, purpose: "qbo_oauth" }, getJwtSecret(), { algorithm: "HS256", expiresIn: "10m" });
}

function verifyOAuthState(state) {
  try {
    const claims = jwt.verify(state, getJwtSecret(), { algorithms: ["HS256"] });
    return claims.purpose === "qbo_oauth" ? claims : null;
  } catch (e) {
    return null;
  }
}

function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID || "",
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: process.env.QBO_REDIRECT_URI || "",
    state,
  });
  return `${QBO_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuthHeader() {
  const id = process.env.QBO_CLIENT_ID || "";
  const secret = process.env.QBO_CLIENT_SECRET || "";
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function postTokenRequest(form) {
  const res = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
      Accept: "application/json",
    },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`QBO token endpoint returned HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function exchangeCodeForTokens(code) {
  return postTokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.QBO_REDIRECT_URI || "",
    })
  );
}

function refreshTokens(refreshToken) {
  return postTokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
  );
}

async function saveConnection(tenantId, realmId, tokens) {
  const client = tableClient(QBO_CONNECTIONS_TABLE);
  await client.createTable();
  const now = Date.now();
  await client.upsertEntity(
    {
      partitionKey: tenantId,
      rowKey: "connection",
      realmId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: now + tokens.expires_in * 1000,
      refreshTokenExpiresAt: now + tokens.x_refresh_token_expires_in * 1000,
    },
    "Replace"
  );
}

async function getConnection(tenantId) {
  const client = tableClient(QBO_CONNECTIONS_TABLE);
  try {
    return await client.getEntity(tenantId, "connection");
  } catch (e) {
    if (e.statusCode === 404) return null;
    throw e;
  }
}

// Webhook payloads only carry a realmId, not our tenantId — small-scale full
// scan across connections (one row per tenant) to resolve it.
async function getConnectionByRealmId(realmId) {
  const client = tableClient(QBO_CONNECTIONS_TABLE);
  await client.createTable();
  for await (const e of client.listEntities()) {
    if (e.realmId === realmId) return e;
  }
  return null;
}

async function listAllConnections() {
  const client = tableClient(QBO_CONNECTIONS_TABLE);
  await client.createTable();
  const rows = [];
  for await (const e of client.listEntities()) rows.push(e);
  return rows;
}

async function updateConnectionLastReconciled(tenantId, isoTimestamp) {
  const client = tableClient(QBO_CONNECTIONS_TABLE);
  await client.upsertEntity({ partitionKey: tenantId, rowKey: "connection", lastReconciledAt: isoTimestamp }, "Merge");
}

// Returns { accessToken, realmId } for the tenant, refreshing first if the
// stored access token is expired or about to expire. Returns null if the
// tenant hasn't connected QuickBooks yet.
async function getValidAccessToken(tenantId) {
  const conn = await getConnection(tenantId);
  if (!conn) return null;

  const aboutToExpire = Date.now() > conn.accessTokenExpiresAt - 60 * 1000;
  if (!aboutToExpire) {
    return { accessToken: conn.accessToken, realmId: conn.realmId };
  }

  const tokens = await refreshTokens(conn.refreshToken);
  await saveConnection(tenantId, conn.realmId, tokens);
  return { accessToken: tokens.access_token, realmId: conn.realmId };
}

// Thin wrapper for QBO Accounting API calls — handles base URL, auth header, and errors.
async function qboFetch(tenantId, path, opts) {
  const auth = await getValidAccessToken(tenantId);
  if (!auth) {
    throw new Error("QuickBooks is not connected for this tenant. Visit /api/qbo/connect first.");
  }
  const url = `${QBO_API_BASE}/v3/company/${auth.realmId}/${path}`;
  const res = await fetch(
    url,
    Object.assign({}, opts, {
      headers: Object.assign(
        { Authorization: `Bearer ${auth.accessToken}`, Accept: "application/json" },
        (opts && opts.headers) || {}
      ),
    })
  );
  if (!res.ok) {
    throw new Error(`QBO API request to ${path} failed: HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

module.exports = {
  QBO_ENV,
  signOAuthState,
  verifyOAuthState,
  authorizeUrl,
  exchangeCodeForTokens,
  refreshTokens,
  saveConnection,
  getConnection,
  getConnectionByRealmId,
  listAllConnections,
  updateConnectionLastReconciled,
  getValidAccessToken,
  qboFetch,
};
