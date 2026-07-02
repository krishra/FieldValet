const { requireSession, json } = require("../shared/auth");
const { tableClient, LOCATIONS_TABLE } = require("../shared/storage");

function rowKey(name) {
  return Buffer.from(name, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

module.exports = async function (context, req) {
  const session = requireSession(context, req);
  if (!session) return;
  const tenantId = session.tid;

  const body = req.body;
  if (!body || !body.name || !body.name.trim()) {
    json(context, 400, { error: "name is required." });
    return;
  }

  try {
    const client = tableClient(LOCATIONS_TABLE);
    await client.createTable();

    const entity = {
      // Tenant isolation: every site is stored under its tenant's partition.
      partitionKey: tenantId,
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
      // GeoJSON string — FeatureCollection with Polygon or Circle geometry
      geofenceBoundary: body.geofenceBoundary || "",
      // Security
      securityInfo: body.securityInfo || "",
      // Cleaning Instructions
      instructionLanguage: body.instructionLanguage || "",
      cleaningInstructions: body.cleaningInstructions || "",
    };

    // Geocode the address so the Dashboard map can render without client-side API calls.
    const geocodeQuery = [body.address, body.city, body.state, body.zip, body.country]
      .filter((s) => s && s.trim())
      .join(", ");
    if (geocodeQuery && process.env.AZURE_MAPS_KEY) {
      try {
        const geoRes = await fetch(
          `https://atlas.microsoft.com/search/address/json?api-version=1.0` +
            `&query=${encodeURIComponent(geocodeQuery)}` +
            `&subscription-key=${encodeURIComponent(process.env.AZURE_MAPS_KEY)}` +
            `&limit=1`
        );
        const geoData = await geoRes.json();
        const pos = geoData.results?.[0]?.position;
        if (pos) {
          entity.lat = pos.lat;
          entity.lng = pos.lon;
        }
      } catch (geoErr) {
        context.log.warn("Geocoding failed for", geocodeQuery, String(geoErr.message || geoErr));
      }
    }

    await client.upsertEntity(entity, "Replace");

    json(context, 201, { success: true, name: entity.name });
  } catch (err) {
    context.log.error("CreateLocation failed", err);
    json(context, 500, { error: String((err && err.message) || err) });
  }
};
