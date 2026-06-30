const { requireSession, json } = require("../shared/auth");
const { getWorkOrder, updateWorkOrder } = require("../shared/workOrders");
const { buildLineItems } = require("../shared/qboLines");
const { qboFetch } = require("../shared/qboClient");

const INVOICEABLE_STATUSES = ["submitted", "approved"];

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
    if (!INVOICEABLE_STATUSES.includes(workOrder.status)) {
      json(context, 400, {
        error: `Cannot invoice a work order with status "${workOrder.status}". It must have a QBO Estimate first (status submitted or approved) and not already be invoiced.`,
      });
      return;
    }

    const lineItems = JSON.parse(workOrder.lineItems || "[]");
    const Line = await buildLineItems(session.tid, lineItems);

    const invoice = await qboFetch(session.tid, "invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        CustomerRef: { value: workOrder.qboCustomerId },
        Line,
        LinkedTxn: [{ TxnId: workOrder.qboEstimateId, TxnType: "Estimate" }],
      }),
    });

    const updated = await updateWorkOrder(session.tid, workOrderId, {
      status: "invoiced",
      qboInvoiceId: invoice.Invoice.Id,
      invoicedAt: new Date().toISOString(),
    });

    json(context, 200, { success: true, qboInvoiceId: updated.qboInvoiceId });
  } catch (err) {
    context.log.error("CreateInvoice failed", err);
    json(context, 500, { error: String((err && err.message) || err) });
  }
};
