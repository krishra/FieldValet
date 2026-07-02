#!/usr/bin/env node
// One-time backfill: add lat/lng to every location row in Azure Table Storage
// that is missing them.
//
// Run from the repo root:
//   node scripts/backfill-geocodes.js
//
// Reads STORAGE_CONNECTION and AZURE_MAPS_KEY from api/local.settings.json
// when running locally; falls back to process.env for CI / production use.

const fs = require("fs");
const path = require("path");

const settingsPath = path.join(__dirname, "../api/local.settings.json");
if (fs.existsSync(settingsPath)) {
  try {
    const { Values } = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    Object.assign(process.env, Values);
  } catch {}
}

const { TableClient } = require("../api/node_modules/@azure/data-tables");

const LOCATIONS_TABLE = "locations";
const CONCURRENCY = 10; // parallel geocoding calls

function makeClient() {
  if (!process.env.STORAGE_CONNECTION) throw new Error("STORAGE_CONNECTION is not set.");
  return TableClient.fromConnectionString(process.env.STORAGE_CONNECTION, LOCATIONS_TABLE);
}

async function geocode(query) {
  const key = process.env.AZURE_MAPS_KEY;
  if (!key) throw new Error("AZURE_MAPS_KEY is not set.");
  const url =
    `https://atlas.microsoft.com/search/address/json?api-version=1.0` +
    `&query=${encodeURIComponent(query)}` +
    `&subscription-key=${encodeURIComponent(key)}` +
    `&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Azure Maps returned HTTP ${res.status}`);
  const data = await res.json();
  const pos = data.results?.[0]?.position;
  return pos ? { lat: pos.lat, lng: pos.lon } : null;
}

// Process `items` in batches of `n` parallel tasks.
async function runConcurrent(items, n, fn) {
  for (let i = 0; i < items.length; i += n) {
    await Promise.all(items.slice(i, i + n).map(fn));
  }
}

async function main() {
  const client = makeClient();

  process.stdout.write("Loading locations from Table Storage…");
  const all = [];
  for await (const e of client.listEntities()) all.push(e);
  console.log(` ${all.length} rows found.`);

  // Build a combined address query using all stored fields.
  const pending = all
    .map((e) => ({
      entity: e,
      query: [e.address, e.city, e.state, e.zip, e.country]
        .filter((s) => s && s.trim())
        .join(", "),
    }))
    .filter(({ entity: e, query }) => query && (e.lat == null || e.lng == null));

  const skipped = all.length - pending.length;
  console.log(
    `${pending.length} need geocoding` +
      (skipped ? `, ${skipped} already have coordinates or have no address.` : ".")
  );

  if (!pending.length) {
    console.log("Nothing to do.");
    return;
  }

  let done = 0;
  let failed = 0;

  await runConcurrent(pending, CONCURRENCY, async ({ entity: e, query }) => {
    try {
      const coords = await geocode(query);
      if (coords) {
        await client.updateEntity(
          {
            partitionKey: e.partitionKey,
            rowKey: e.rowKey,
            lat: coords.lat,
            lng: coords.lng,
          },
          "Merge"
        );
        done++;
        console.log(`  ✓ [${done + failed}/${pending.length}] ${e.name}`);
      } else {
        failed++;
        console.warn(`  ⚠ [${done + failed}/${pending.length}] no result for "${query}" (${e.name})`);
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ [${done + failed}/${pending.length}] ${e.name}: ${err.message}`);
    }
  });

  console.log(`\nDone — ${done} updated, ${failed} failed/skipped.`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
