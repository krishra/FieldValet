const { TableClient } = require("@azure/data-tables");

const TABLE = "locations";
const PARTITION = "site";

function rowKey(name) {
  return Buffer.from(name, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

module.exports = async function (context, req) {
  const conn = process.env.STORAGE_CONNECTION;
  if (!conn) {
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { error: "STORAGE_CONNECTION app setting is not configured." },
    };
    return;
  }

  const body = req.body;
  if (!body || !body.name || !body.name.trim()) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { error: "name is required." },
    };
    return;
  }

  try {
    const client = TableClient.fromConnectionString(conn, TABLE);
    await client.createTable();

    const entity = {
      partitionKey: PARTITION,
      rowKey: rowKey(body.name.trim()),
      // Basic Info
      name: body.name.trim(),
      locationId: body.locationId || "",
      // Address
      address: body.address || "",
      address2: body.address2 || "",
      city: body.city || "",
      state: body.state || "",
      zip: body.zip || "",
      country: body.country || "",
      timezone: body.timezone || "",
      // Breaks – default settings
      breakLength: body.breakLength || "",
      breakStatus: body.breakStatus || "",
      breakPaid: body.breakPaid === true || body.breakPaid === "true",
      breakMandatory: body.breakMandatory === true || body.breakMandatory === "true",
      // Breaks – per-type entries (stored as JSON string; Table Storage has no array type)
      breakEntries: JSON.stringify(Array.isArray(body.breakEntries) ? body.breakEntries : []),
      // Geofence
      geofenceEnabled: body.geofenceEnabled === true || body.geofenceEnabled === "true",
      // Security
      securityInfo: body.securityInfo || "",
      // Cleaning Instructions
      instructionLanguage: body.instructionLanguage || "",
      cleaningInstructions: body.cleaningInstructions || "",
    };

    await client.upsertEntity(entity, "Replace");

    context.res = {
      status: 201,
      headers: { "Content-Type": "application/json" },
      body: { success: true, name: entity.name },
    };
  } catch (err) {
    context.log.error("CreateLocation failed", err);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { error: String((err && err.message) || err) },
    };
  }
};
