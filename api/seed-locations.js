// One-off local seed script — not deployed, not referenced by any function.
// Loads the real Armstrong site list from locations.json into Azurite so the
// Sites list and Chats sidebar have data to exercise locally.
process.env.STORAGE_CONNECTION = "UseDevelopmentStorage=true";

const fs = require("fs");
const path = require("path");
const { tableClient, LOCATIONS_TABLE } = require("./shared/storage");

const TENANT_ID = "demo-tenant";

function rowKey(name) {
  return Buffer.from(name, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// A few addresses we can confidently place, so the City filter has real options.
// Everything else is left city-blank; all are Washington (WA).
const CITY_BY_ADDRESS_HINT = [
  [/Everett Mall Way/i, "Everett"],
  [/Colby Ave/i, "Everett"],
  [/6th Ave SE/i, "Everett"],
  [/Alderwood Mall Blvd/i, "Lynnwood"],
  [/219th St SW/i, "Mountlake Terrace"],
  [/Bothell Everett Hwy/i, "Mill Creek"],
  [/Dayton St/i, "Edmonds"],
  [/3rd Ave S/i, "Edmonds"],
];

function cityFor(address) {
  for (const [re, city] of CITY_BY_ADDRESS_HINT) if (re.test(address || "")) return city;
  return "";
}

async function main() {
  const locations = JSON.parse(
    fs.readFileSync(path.join(__dirname, "locations.json"), "utf8")
  );

  const client = tableClient(LOCATIONS_TABLE);
  await client.createTable();

  let n = 0;
  for (const loc of locations) {
    const name = String(loc.name || "").trim();
    if (!name) continue;
    await client.upsertEntity(
      {
        partitionKey: TENANT_ID,
        rowKey: rowKey(name),
        name,
        address: loc.address || "",
        city: cityFor(loc.address),
        state: "WA",
      },
      "Merge"
    );
    n++;
  }

  console.log(`Seeded ${n} locations into tenant ${TENANT_ID}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
