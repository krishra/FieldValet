const { requireSession, json } = require("../shared/auth");
const { listWorkOrders } = require("../shared/workOrders");

module.exports = async function (context, req) {
  const session = requireSession(context, req);
  if (!session) return;

  try {
    const rows = await listWorkOrders(session.tid);
    const workOrders = rows.map((r) => ({
      workOrderId: r.workOrderId,
      locationName: r.locationName,
      customerName: r.customerName,
      customerEmail: r.customerEmail,
      squareFootage: r.squareFootage,
      frequency: r.frequency,
      serviceTypes: JSON.parse(r.serviceTypes || "[]"),
      lineItems: JSON.parse(r.lineItems || "[]"),
      total: r.total,
      status: r.status,
      qboCustomerId: r.qboCustomerId,
      qboEstimateId: r.qboEstimateId,
      qboInvoiceId: r.qboInvoiceId,
      estimateApprovedAt: r.estimateApprovedAt,
      invoicedAt: r.invoicedAt,
      paidAt: r.paidAt,
      createdAt: r.createdAt,
    }));
    json(context, 200, { count: workOrders.length, workOrders });
  } catch (err) {
    context.log.error("GetWorkOrders failed", err);
    json(context, 500, { error: String((err && err.message) || err) });
  }
};
