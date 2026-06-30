// One-off local seed script — not deployed, not referenced by any function.
// Creates a test login so you can exercise the app against Azurite locally.
process.env.STORAGE_CONNECTION = "UseDevelopmentStorage=true";

const { hashPassword, emailKey } = require("./shared/auth");
const { tableClient, USERS_TABLE, USERS_PARTITION } = require("./shared/storage");

async function main() {
  const email = "test@fieldvalet.local";
  const password = "TestPass123!";
  const tenantId = "demo-tenant";

  const client = tableClient(USERS_TABLE);
  await client.createTable();

  await client.upsertEntity(
    {
      partitionKey: USERS_PARTITION,
      rowKey: emailKey(email),
      userId: "demo-user-1",
      email,
      fullName: "Test User",
      tenantId,
      role: "owner",
      passwordHash: hashPassword(password),
    },
    "Replace"
  );

  console.log(`Seeded user: ${email} / ${password} (tenant: ${tenantId})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
