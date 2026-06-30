// FieldValet — nightly backstop for the QBO webhook. Webhook delivery isn't
// guaranteed (Intuit can drop or delay events), so this polls QBO's Change
// Data Capture endpoint for anything changed since the last run and feeds it
// through the same processEstimateUpdate/processPaymentUpdate logic the
// webhook uses, so the two delivery paths can't drift on what a change means.
const { listAllConnections, updateConnectionLastReconciled, qboFetch } = require("../shared/qboClient");
const { processEstimateUpdate, processPaymentUpdate } = require("../shared/qboSync");

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

module.exports = async function (context, myTimer) {
  const connections = await listAllConnections();

  for (const conn of connections) {
    const tenantId = conn.partitionKey;
    const since = conn.lastReconciledAt || new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString();
    const now = new Date().toISOString();

    try {
      const query = `cdc?entities=Estimate,Invoice,Payment&changedSince=${encodeURIComponent(since)}`;
      const data = await qboFetch(tenantId, query, { method: "GET" });

      const responses = (data.CDCResponse && data.CDCResponse[0] && data.CDCResponse[0].QueryResponse) || [];
      for (const group of responses) {
        for (const estimate of group.Estimate || []) {
          await processEstimateUpdate(tenantId, estimate.Id, (msg) => context.log(`[reconcile] ${msg}`));
        }
        for (const payment of group.Payment || []) {
          await processPaymentUpdate(tenantId, payment.Id, (msg) => context.log(`[reconcile] ${msg}`));
        }
      }

      await updateConnectionLastReconciled(tenantId, now);
      context.log(`ReconcileQBO: tenant ${tenantId} reconciled since ${since}`);
    } catch (err) {
      context.log.error(`ReconcileQBO: failed for tenant ${tenantId}`, err);
    }
  }
};
