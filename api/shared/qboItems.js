// FieldValet — find-or-create a QBO (Service) Item, so re-submitting work
// orders with the same service types doesn't create duplicate items.
const { qboFetch } = require("./qboClient");

function escapeQboString(s) {
  return String(s).replace(/'/g, "\\'");
}

async function findItemByName(tenantId, name) {
  const query = encodeURIComponent(`select * from Item where Name = '${escapeQboString(name)}'`);
  const data = await qboFetch(tenantId, `query?query=${query}`, { method: "GET" });
  const items = (data.QueryResponse && data.QueryResponse.Item) || [];
  return items[0] || null;
}

async function createItem(tenantId, { name, incomeAccountId }) {
  if (!incomeAccountId) {
    throw new Error("QBO_INCOME_ACCOUNT_ID app setting is not configured — required to create new QBO Items.");
  }
  const body = {
    Name: name,
    Type: "Service",
    IncomeAccountRef: { value: incomeAccountId },
  };

  const data = await qboFetch(tenantId, "item", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return data.Item;
}

async function findOrCreateItem(tenantId, { name, incomeAccountId }) {
  const existing = await findItemByName(tenantId, name);
  if (existing) return existing;
  return createItem(tenantId, { name, incomeAccountId });
}

module.exports = { findItemByName, createItem, findOrCreateItem };
