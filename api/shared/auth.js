// FieldValet — shared auth primitives for the managed API.
//
// Security model:
//   * Passwords are hashed with scrypt (memory-hard, built into Node — no native
//     deps that could fail on the SWA build). Each hash carries its own params + salt.
//   * Sessions are stateless JWTs (HS256) signed with the JWT_SECRET app setting,
//     delivered to the browser in an HttpOnly + Secure + SameSite=Strict cookie so
//     client-side script (and thus XSS) can never read or exfiltrate the token.
//   * The tenant a request belongs to is ALWAYS taken from the verified token claims,
//     never from anything the client sends in a body or query string.

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const COOKIE_NAME = "fv_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours

// ---- Password hashing (scrypt) ----
const SCRYPT_N = 16384; // CPU/memory cost
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 32;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64"), derived.toString("base64")].join("$");
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const derived = crypto.scryptSync(password, salt, expected.length, { N: +N, r: +r, p: +p });
    // Constant-time comparison to avoid timing side channels.
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch (e) {
    return false;
  }
}

// ---- JWT sessions ----
function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error("JWT_SECRET app setting is missing or too short (need at least 32 characters).");
  }
  return s;
}

function signSession(claims) {
  return jwt.sign(claims, getJwtSecret(), { algorithm: "HS256", expiresIn: SESSION_TTL_SECONDS });
}

function verifySession(token) {
  try {
    return jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] });
  } catch (e) {
    return null;
  }
}

// ---- Cookies ----
function parseCookies(req) {
  const header = (req.headers && (req.headers.cookie || req.headers.Cookie)) || "";
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearedCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

// Returns the verified session claims for a request, or null if unauthenticated.
function getSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  return verifySession(token);
}

// ---- Email normalisation / keys ----
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// Table Storage keys forbid / \ # ? and control chars; base64url is safe.
function emailKey(email) {
  return Buffer.from(normalizeEmail(email), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---- Refresh tokens ----
// Opaque tokens: <UUID>:<64-hex-chars>. Neither component contains ":", so
// a single indexOf(":") split is unambiguous.
const REFRESH_COOKIE_NAME = "fv_refresh";
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function generateToken() {
  const tokenId = crypto.randomUUID();
  const secretHex = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(secretHex).digest("hex");
  return { tokenId, tokenHash, tokenValue: `${tokenId}:${secretHex}` };
}

// Parses both refresh-cookie values and password-reset URL values (same format).
function parseTokenValue(value) {
  const str = String(value || "");
  const idx = str.indexOf(":");
  if (idx === -1) return null;
  const tokenId = str.slice(0, idx);
  const secretHex = str.slice(idx + 1);
  if (!tokenId || secretHex.length !== 64) return null;
  return { tokenId, secretHex };
}

function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest("hex");
}

function refreshCookie(tokenValue) {
  // Path=/api/auth scopes the cookie to auth endpoints only, keeping it off
  // all other API calls (GetLocations, PostMessage, etc.).
  return `${REFRESH_COOKIE_NAME}=${tokenValue}; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=${REFRESH_TTL_SECONDS}`;
}

function clearedRefreshCookie() {
  return `${REFRESH_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=0`;
}

// ---- HTTP helpers ----
function json(context, status, body, extraHeaders) {
  context.res = {
    status,
    headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, extraHeaders || {}),
    body,
  };
}

// Validates the session and returns claims, or writes a 401 and returns null.
function requireSession(context, req) {
  const session = getSession(req);
  if (!session) {
    json(context, 401, { error: "Not authenticated." });
    return null;
  }
  return session;
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_SECONDS,
  REFRESH_COOKIE_NAME,
  REFRESH_TTL_SECONDS,
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  parseCookies,
  sessionCookie,
  clearedCookie,
  getSession,
  requireSession,
  normalizeEmail,
  emailKey,
  json,
  generateToken,
  parseTokenValue,
  hashSecret,
  refreshCookie,
  clearedRefreshCookie,
};
