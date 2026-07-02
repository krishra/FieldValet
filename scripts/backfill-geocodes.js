#!/usr/bin/env node
// Geocode backfill — constrained to Washington state.
//
// Run from the repo root:
//   node scripts/backfill-geocodes.js
//
// Reads STORAGE_CONNECTION and AZURE_MAPS_KEY from api/local.settings.json
// when running locally; falls back to process.env for CI / production use.
//
// Strategy:
//   1. Geocode with a WA bounding-box bias + countrySet=US.
//   2. Validate the returned position is within WA bounds.
//   3. If outside WA, retry with ", Washington" appended to the query.
//   4. Re-geocodes ALL rows (not just those missing coords) so bad results
//      from the previous unconstrained run are corrected.

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
const CONCURRENCY = 10;

// Washington state bounding box (approximate).
const WA_BOUNDS = { north: 49.002, south: 45.543, west: -124.848, east: -116.916 };

function inWashington({ lat, lng }) {
  return lat >= WA_BOUNDS.south && lat <= WA_BOUNDS.north &&
         lng >= WA_BOUNDS.west  && lng <= WA_BOUNDS.east;
}

function makeClient() {
  if (!process.env.STORAGE_CONNECTION) throw new Error("STORAGE_CONNECTION is not set.");
  return TableClient.fromConnectionString(process.env.STORAGE_CONNECTION, LOCATIONS_TABLE);
}

async function geocodeQuery(query) {
  const key = process.env.AZURE_MAPS_KEY;
  if (!key) throw new Error("AZURE_MAPS_KEY is not set.");
  const url =
    `https://atlas.microsoft.com/search/address/json?api-version=1.0` +
    `&query=${encodeURIComponent(query)}` +
    `&subscription-key=${encodeURIComponent(key)}` +
    `&countrySet=US` +
    `&topLeft=${WA_BOUNDS.north},${WA_BOUNDS.west}` +
    `&btmRight=${WA_BOUNDS.south},${WA_BOUNDS.east}` +
    `&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Azure Maps returned HTTP ${res.status}`);
  const data = await res.json();
  const pos = data.results?.[0]?.position;
  return pos ? { lat: pos.lat, lng: pos.lon } : null;
}

async function geocode(baseQuery) {
  // First attempt: bare query with WA bounding-box bias.
  let coords = await geocodeQuery(baseQuery);
  if (coords && inWashington(coords)) return coords;

  // Second attempt: append ", Washington" to anchor ambiguous street-only addresses.
  if (!baseQuery.toLowerCase().includes("washington")) {
    coords = await geocodeQuery(`${baseQuery}, Washington`);
    if (coords && inWashington(coords)) return coords;
  }

  return null; // couldn't place within WA
}

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

  // Build address queries for all rows that have any address data.
  const pending = all
    .map((e) => ({
      entity: e,
      query: [e.address, e.city, e.state, e.zip, e.country]
        .filter((s) => s && s.trim())
        .join(", "),
    }))
    .filter(({ query }) => query);

  const noAddress = all.length - pending.length;
  console.log(
    `Re-geocoding all ${pending.length} rows with addresses` +
      (noAddress ? ` (${noAddress} skipped — no address).` : ".")
  );

  let done = 0;
  let outsideWA = 0;
  let failed = 0;

  await runConcurrent(pending, CONCURRENCY, async ({ entity: e, query }) => {
    try {
      const coords = await geocode(query);
      if (coords) {
        await client.updateEntity(
          { partitionKey: e.partitionKey, rowKey: e.rowKey, lat: coords.lat, lng: coords.lng },
          "Merge"
        );
        done++;
        console.log(`  ✓ [${done + outsideWA + failed}/${pending.length}] ${e.name}`);
      } else {
        outsideWA++;
        console.warn(`  ⚠ [${done + outsideWA + failed}/${pending.length}] outside WA or no result: "${query}" (${e.name})`);
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ [${done + outsideWA + failed}/${pending.length}] ${e.name}: ${err.message}`);
    }
  });

  console.log(`\nDone — ${done} updated, ${outsideWA} outside WA / no result, ${failed} errors.`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
