// FieldValet — shared Table Storage helpers.
const { TableClient } = require("@azure/data-tables");

const TENANTS_TABLE = "tenants";
const USERS_TABLE = "users";
const LOCATIONS_TABLE = "locations";

// Partition used by the users table — login looks users up by a globally-unique
// email key, so all users share one partition and tenant is stored as a field.
const USERS_PARTITION = "user";
const TENANTS_PARTITION = "tenant";

function tableClient(name) {
  const conn = process.env.STORAGE_CONNECTION;
  if (!conn) throw new Error("STORAGE_CONNECTION app setting is not configured.");
  return TableClient.fromConnectionString(conn, name);
}

module.exports = {
  TENANTS_TABLE,
  USERS_TABLE,
  LOCATIONS_TABLE,
  USERS_PARTITION,
  TENANTS_PARTITION,
  tableClient,
};
