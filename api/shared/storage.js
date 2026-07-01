// FieldValet — shared Table Storage helpers.
const { TableClient } = require("@azure/data-tables");

const TENANTS_TABLE = "tenants";
const USERS_TABLE = "users";
const LOCATIONS_TABLE = "locations";
const QBO_CONNECTIONS_TABLE = "qboConnections";
const WORK_ORDERS_TABLE = "workOrders";
const REFRESH_TOKENS_TABLE = "refreshTokens";
const RESET_TOKENS_TABLE = "passwordResets";

// Partition used by the users table — login looks users up by a globally-unique
// email key, so all users share one partition and tenant is stored as a field.
const USERS_PARTITION = "user";
const TENANTS_PARTITION = "tenant";
// Single partitions for the small auth-token tables (O(1) row lookup by rowKey).
const REFRESH_TOKENS_PARTITION = "rt";
const RESET_TOKENS_PARTITION = "pr";

function tableClient(name) {
  const conn = process.env.STORAGE_CONNECTION;
  if (!conn) throw new Error("STORAGE_CONNECTION app setting is not configured.");
  return TableClient.fromConnectionString(conn, name);
}

// Creates the table if it does not yet exist. Safe to call on every cold start;
// the 409 Conflict response (table already exists) is silently swallowed.
async function ensureTable(name) {
  try {
    await tableClient(name).createTable();
  } catch (e) {
    if (!e || e.statusCode !== 409) throw e;
  }
}

module.exports = {
  TENANTS_TABLE,
  USERS_TABLE,
  LOCATIONS_TABLE,
  QBO_CONNECTIONS_TABLE,
  WORK_ORDERS_TABLE,
  REFRESH_TOKENS_TABLE,
  RESET_TOKENS_TABLE,
  USERS_PARTITION,
  TENANTS_PARTITION,
  REFRESH_TOKENS_PARTITION,
  RESET_TOKENS_PARTITION,
  tableClient,
  ensureTable,
};
