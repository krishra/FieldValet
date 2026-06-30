// FieldValet — what a QBO status change means for a work order, regardless of
// whether it arrived via the realtime webhook or the nightly reconciliation
// poll. Both callers pass in just (tenantId, entityId); this module owns the
// QBO fetch + status-transition logic so the two delivery paths can't drift.
const { qboFetch } = require("./qboClient");
const { findWorkOrderByQboField, updateWorkOrder } = require("./workOrders");

async function processEstimateUpdate(tenantId, estimateId, log) {
  const data = await qboFetch(tenantId, `estimate/${estimateId}`, { method: "GET" });
  const estimate = data.Estimate;
  if (!estimate) return;

  const workOrder = await findWorkOrderByQboField(tenantId, "qboEstimateId", estimateId);
  if (!workOrder) return;

  if (estimate.TxnStatus === "Accepted" && workOrder.status === "submitted") {
    await updateWorkOrder(tenantId, workOrder.rowKey, {
      status: "approved",
      estimateApprovedAt: new Date().toISOString(),
    });
    if (log) log(`Work order ${workOrder.rowKey}: estimate ${estimateId} accepted -> approved`);
  }
}

async function processPaymentUpdate(tenantId, paymentId, log) {
  const data = await qboFetch(tenantId, `payment/${paymentId}`, { method: "GET" });
  const payment = data.Payment;
  if (!payment || !Array.isArray(payment.Line)) return;

  for (const line of payment.Line) {
    const linkedInvoices = (line.LinkedTxn || []).filter((t) => t.TxnType === "Invoice");
    for (const linked of linkedInvoices) {
      const workOrder = await findWorkOrderByQboField(tenantId, "qboInvoiceId", linked.TxnId);
      if (!workOrder) continue;
      if (workOrder.status === "invoiced") {
        await updateWorkOrder(tenantId, workOrder.rowKey, {
          status: "paid",
          paidAt: new Date().toISOString(),
        });
        if (log) log(`Work order ${workOrder.rowKey}: invoice ${linked.TxnId} paid -> paid`);
      }
    }
  }
}

module.exports = { processEstimateUpdate, processPaymentUpdate };
