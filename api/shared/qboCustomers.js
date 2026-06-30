// FieldValet — find-or-create a QBO Customer, so re-submitting work orders for
// the same customer doesn't create duplicates in QuickBooks.
const { qboFetch } = require("./qboClient");

function escapeQboString(s) {
  return String(s).replace(/'/g, "\\'");
}

async function findCustomerByName(tenantId, name) {
  const query = encodeURIComponent(`select * from Customer where DisplayName = '${escapeQboString(name)}'`);
  const data = await qboFetch(tenantId, `query?query=${query}`, { method: "GET" });
  const customers = (data.QueryResponse && data.QueryResponse.Customer) || [];
  return customers[0] || null;
}

async function createCustomer(tenantId, { name, email }) {
  const body = { DisplayName: name };
  if (email) body.PrimaryEmailAddr = { Address: email };

  const data = await qboFetch(tenantId, "customer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return data.Customer;
}

async function findOrCreateCustomer(tenantId, { name, email }) {
  const existing = await findCustomerByName(tenantId, name);
  if (existing) return existing;
  return createCustomer(tenantId, { name, email });
}

module.exports = { findCustomerByName, createCustomer, findOrCreateCustomer };
