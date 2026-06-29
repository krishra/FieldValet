const { TableClient } = require("@azure/data-tables");
const seed = require("../locations.json");

const TABLE = "locations";
const PARTITION = "site";

function rowKey(name) {
  // Table Storage keys forbid / \ # ? and control chars; base64url is safe.
  return Buffer.from(name, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function seedTable(client) {
  const batchSize = 20;
  for (let i = 0; i < seed.length; i += batchSize) {
    const chunk = seed.slice(i, i + batchSize);
    await Promise.all(
      chunk.map((s) =>
        client.upsertEntity(
          { partitionKey: PARTITION, rowKey: rowKey(s.name), name: s.name, address: s.address },
          "Replace"
        )
      )
    );
  }
}

module.exports = async function (context, req) {
  const conn = process.env.STORAGE_CONNECTION;
  if (!conn) {
    context.res = { status: 500, headers: { "Content-Type": "application/json" }, body: { error: "STORAGE_CONNECTION app setting is not configured." } };
    return;
  }

  try {
    const client = TableClient.fromConnectionString(conn, TABLE);
    await client.createTable(); // no-op if it already exists

    let rows = [];
    for await (const e of client.listEntities()) {
      rows.push({ name: e.name, address: e.address });
    }

    if (rows.length === 0) {
      await seedTable(client);
      rows = seed.map((s) => ({ name: s.name, address: s.address }));
    }

    rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: { count: rows.length, locations: rows },
    };
  } catch (err) {
    context.log.error("GetLocations failed", err);
    context.res = { status: 500, headers: { "Content-Type": "application/json" }, body: { error: String(err && err.message || err) } };
  }
};
