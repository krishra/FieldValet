// One-time, key-guarded tenant/user seeder.
//
// This endpoint is INERT unless a SETUP_KEY app setting (>= 16 chars) is configured
// AND the caller presents it in the `x-setup-key` header. It only ever CREATES users
// (never overwrites an existing account), so it cannot be used to hijack credentials.
// After seeding, remove the SETUP_KEY app setting to disable it entirely.
const crypto = require("crypto");
const { hashPassword, emailKey, normalizeEmail, json } = require("../shared/auth");
const {
  tableClient,
  TENANTS_TABLE,
  USERS_TABLE,
  LOCATIONS_TABLE,
  USERS_PARTITION,
  TENANTS_PARTITION,
} = require("../shared/storage");

function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function locRowKey(name) {
  return Buffer.from(name, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

module.exports = async function (context, req) {
  const setupKey = process.env.SETUP_KEY;
  // Pretend the route does not exist unless properly configured + authorised.
  if (!setupKey || setupKey.length < 16) {
    json(context, 404, { error: "Not found." });
    return;
  }
  const provided = (req.headers && (req.headers["x-setup-key"] || req.headers["X-Setup-Key"])) || "";
  if (!timingSafeEq(provided, setupKey)) {
    json(context, 404, { error: "Not found." });
    return;
  }

  const body = req.body || {};
  const tenantId = String(body.tenantId || "").trim();
  const tenantName = String(body.tenantName || tenantId).trim();
  const usersIn = Array.isArray(body.users) ? body.users : [];
  if (!tenantId || usersIn.length === 0) {
    json(context, 400, { error: "tenantId and users[] are required." });
    return;
  }

  try {
    const tenants = tableClient(TENANTS_TABLE);
    await tenants.createTable();
    await tenants.upsertEntity(
      { partitionKey: TENANTS_PARTITION, rowKey: tenantId, name: tenantName, createdAt: new Date().toISOString() },
      "Merge"
    );

    const users = tableClient(USERS_TABLE);
    await users.createTable();

    const created = [];
    const skipped = [];
    for (const u of usersIn) {
      const email = normalizeEmail(u.email);
      if (!email || !u.password) {
        skipped.push({ email: email || "(missing)", reason: "missing email or password" });
        continue;
      }
      const rk = emailKey(email);
      let exists = false;
      try {
        await users.getEntity(USERS_PARTITION, rk);
        exists = true;
      } catch (e) {
        if (!(e && e.statusCode === 404)) throw e;
      }
      if (exists) {
        skipped.push({ email, reason: "already exists" });
        continue;
      }
      await users.createEntity({
        partitionKey: USERS_PARTITION,
        rowKey: rk,
        userId: crypto.randomUUID(),
        email,
        fullName: String(u.fullName || "").trim() || email,
        tenantId,
        role: u.role === "admin" ? "admin" : "member",
        passwordHash: hashPassword(String(u.password)),
        createdAt: new Date().toISOString(),
      });
      created.push(email);
    }

    // Optionally seed the tenant's sites from the bundled list so the app has data.
    let locationsSeeded = 0;
    if (body.seedLocations) {
      let seed = [];
      try {
        seed = require("../locations.json");
      } catch (e) {
        seed = [];
      }
      const loc = tableClient(LOCATIONS_TABLE);
      await loc.createTable();
      for (const s of seed) {
        if (!s || !s.name) continue;
        await loc.upsertEntity(
          { partitionKey: tenantId, rowKey: locRowKey(s.name), name: s.name, address: s.address || "" },
          "Replace"
        );
        locationsSeeded++;
      }
    }

    json(context, 200, { tenantId, tenantName, created, skipped, locationsSeeded });
  } catch (err) {
    context.log.error("Bootstrap failed", err);
    json(context, 500, { error: String((err && err.message) || err) });
  }
};
