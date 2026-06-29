const { requireSession, json } = require("../shared/auth");
const { tableClient, LOCATIONS_TABLE } = require("../shared/storage");

module.exports = async function (context, req) {
  const session = requireSession(context, req);
  if (!session) return;
  const tenantId = session.tid;

  try {
    const client = tableClient(LOCATIONS_TABLE);
    await client.createTable(); // no-op if it already exists

    // Tenant isolation: only ever list rows in this tenant's partition.
    const rows = [];
    const iter = client.listEntities({
      queryOptions: { filter: `PartitionKey eq '${tenantId.replace(/'/g, "''")}'` },
    });
    for await (const e of iter) {
      rows.push({ name: e.name, address: e.address || "" });
    }

    rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    json(context, 200, { count: rows.length, locations: rows }, { "Cache-Control": "no-cache" });
  } catch (err) {
    context.log.error("GetLocations failed", err);
    json(context, 500, { error: String((err && err.message) || err) });
  }
};
