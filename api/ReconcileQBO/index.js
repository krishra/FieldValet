// FieldValet — nightly backstop for the QBO webhook. Webhook delivery isn't
// guaranteed (Intuit can drop or delay events), so this polls QBO's Change
// Data Capture endpoint for anything changed since the last run and feeds it
// through the same processEstimateUpdate/processPaymentUpdate logic the
// webhook uses, so the two delivery paths can't drift on what a change means.
//
// Azure Static Web Apps' managed Functions API only supports HTTP-triggered
// functions (no timerTrigger) — so this is an HTTP endpoint gated by a shared
// secret, driven on a schedule by a GitHub Actions cron workflow instead of a
// native Functions timer trigger.
const { json } = require("../shared/auth");
const { listAllConnections, updateConnectionLastReconciled, qboFetch } = require("../shared/qboClient");
const { processEstimateUpdate, processPaymentUpdate } = require("../shared/qboSync");

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

module.exports = async function (context, req) {
  const expected = process.env.RECONCILE_SECRET;
  const provided = req.headers && req.headers["x-reconcile-secret"];
  if (!expected || provided !== expected) {
    json(context, 401, { error: "Missing or invalid x-reconcile-secret header." });
    return;
  }

  const connections = await listAllConnections();
  const results = [];

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
      results.push({ tenantId, since, status: "ok" });
    } catch (err) {
      context.log.error(`ReconcileQBO: failed for tenant ${tenantId}`, err);
      results.push({ tenantId, since, status: "error", error: String((err && err.message) || err) });
    }
  }

  json(context, 200, { tenantsProcessed: results.length, results });
};
