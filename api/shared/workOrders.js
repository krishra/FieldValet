// FieldValet — Table Storage helpers for work orders.
const crypto = require("crypto");
const { tableClient, WORK_ORDERS_TABLE } = require("./storage");

function newWorkOrderId() {
  return crypto.randomUUID();
}

async function createWorkOrder(tenantId, data) {
  const client = tableClient(WORK_ORDERS_TABLE);
  await client.createTable();

  const workOrderId = newWorkOrderId();
  const entity = {
    partitionKey: tenantId,
    rowKey: workOrderId,
    workOrderId,
    locationName: data.locationName || "",
    customerName: data.customerName,
    customerEmail: data.customerEmail || "",
    squareFootage: data.squareFootage,
    frequency: data.frequency,
    serviceTypes: JSON.stringify(data.serviceTypes),
    lineItems: JSON.stringify(data.lineItems),
    total: data.total,
    status: "draft",
    qboCustomerId: "",
    qboEstimateId: "",
    qboInvoiceId: "",
    estimateApprovedAt: "",
    invoicedAt: "",
    paidAt: "",
    createdAt: new Date().toISOString(),
  };

  await client.upsertEntity(entity, "Replace");
  return entity;
}

async function listWorkOrders(tenantId) {
  const client = tableClient(WORK_ORDERS_TABLE);
  await client.createTable();

  const rows = [];
  const iter = client.listEntities({
    queryOptions: { filter: `PartitionKey eq '${tenantId.replace(/'/g, "''")}'` },
  });
  for await (const e of iter) rows.push(e);
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return rows;
}

async function getWorkOrder(tenantId, workOrderId) {
  const client = tableClient(WORK_ORDERS_TABLE);
  try {
    return await client.getEntity(tenantId, workOrderId);
  } catch (e) {
    if (e.statusCode === 404) return null;
    throw e;
  }
}

async function updateWorkOrder(tenantId, workOrderId, patch) {
  const client = tableClient(WORK_ORDERS_TABLE);
  const existing = await getWorkOrder(tenantId, workOrderId);
  if (!existing) throw new Error("Work order not found.");
  const updated = Object.assign({}, existing, patch);
  await client.upsertEntity(updated, "Merge");
  return updated;
}

// Looks up a work order within a tenant's partition by a non-key field
// (e.g. qboEstimateId, qboInvoiceId) — used by the webhook/reconciliation
// handlers, which only know the QBO-side id of the entity that changed.
async function findWorkOrderByQboField(tenantId, field, value) {
  const client = tableClient(WORK_ORDERS_TABLE);
  const safeValue = String(value).replace(/'/g, "''");
  const iter = client.listEntities({
    queryOptions: {
      filter: `PartitionKey eq '${tenantId.replace(/'/g, "''")}' and ${field} eq '${safeValue}'`,
    },
  });
  for await (const e of iter) return e;
  return null;
}

module.exports = {
  createWorkOrder,
  listWorkOrders,
  getWorkOrder,
  updateWorkOrder,
  findWorkOrderByQboField,
};
