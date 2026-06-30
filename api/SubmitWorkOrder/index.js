const { requireSession, json } = require("../shared/auth");
const { getWorkOrder, updateWorkOrder } = require("../shared/workOrders");
const { findOrCreateCustomer } = require("../shared/qboCustomers");
const { buildLineItems } = require("../shared/qboLines");
const { qboFetch } = require("../shared/qboClient");

module.exports = async function (context, req) {
  const session = requireSession(context, req);
  if (!session) return;

  const workOrderId = context.bindingData.id;

  try {
    const workOrder = await getWorkOrder(session.tid, workOrderId);
    if (!workOrder) {
      json(context, 404, { error: "Work order not found." });
      return;
    }
    if (workOrder.status !== "draft") {
      json(context, 400, { error: "This work order has already been submitted to QuickBooks." });
      return;
    }

    const customer = await findOrCreateCustomer(session.tid, {
      name: workOrder.customerName,
      email: workOrder.customerEmail,
    });

    const lineItems = JSON.parse(workOrder.lineItems || "[]");
    const Line = await buildLineItems(session.tid, lineItems);

    const estimate = await qboFetch(session.tid, "estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        CustomerRef: { value: customer.Id, name: customer.DisplayName },
        Line,
      }),
    });

    const updated = await updateWorkOrder(session.tid, workOrderId, {
      status: "submitted",
      qboCustomerId: customer.Id,
      qboEstimateId: estimate.Estimate.Id,
    });

    json(context, 200, {
      success: true,
      qboCustomerId: updated.qboCustomerId,
      qboEstimateId: updated.qboEstimateId,
    });
  } catch (err) {
    context.log.error("SubmitWorkOrder failed", err);
    json(context, 500, { error: String((err && err.message) || err) });
  }
};
