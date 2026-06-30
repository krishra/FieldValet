// FieldValet — QBO webhook receiver. Intuit POSTs here when subscribed
// entities (Estimate, Invoice, Payment) change in a connected company.
//
// Always acks with 200 quickly, even on internal processing failures, to
// avoid Intuit's retry storm — failures are logged, not surfaced back to
// Intuit. Known limitation: no dead-lettering this round; the nightly
// reconciliation job is the backstop for anything dropped here.
const crypto = require("crypto");
const { getConnectionByRealmId } = require("../shared/qboClient");
const { processEstimateUpdate, processPaymentUpdate } = require("../shared/qboSync");

function isValidSignature(rawBody, signatureHeader) {
  const token = process.env.QBO_WEBHOOK_VERIFIER_TOKEN;
  if (!token || !signatureHeader) return false;
  const expected = crypto.createHmac("sha256", token).update(rawBody || "", "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function (context, req) {
  const rawBody = req.rawBody || "";
  const signature = req.headers && (req.headers["intuit-signature"] || req.headers["Intuit-Signature"]);

  if (!isValidSignature(rawBody, signature)) {
    context.log.error("QBOWebhook: invalid or missing intuit-signature header.");
    context.res = { status: 401, body: "" };
    return;
  }

  // Ack immediately; process after responding isn't possible in the
  // function-app HTTP model, so we process inline but never let a failure
  // here turn into a non-200 — log and move on.
  context.res = { status: 200, body: "" };

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    context.log.error("QBOWebhook: could not parse payload", e);
    return;
  }

  const notifications = payload.eventNotifications || [];
  for (const notif of notifications) {
    try {
      const connection = await getConnectionByRealmId(notif.realmId);
      if (!connection) {
        context.log.warn(`QBOWebhook: no FieldValet tenant connected for realmId ${notif.realmId}`);
        continue;
      }
      const tenantId = connection.partitionKey;
      const entities = (notif.dataChangeEvent && notif.dataChangeEvent.entities) || [];

      for (const entity of entities) {
        try {
          if (entity.name === "Estimate") {
            await processEstimateUpdate(tenantId, entity.id, (msg) => context.log(msg));
          } else if (entity.name === "Payment") {
            await processPaymentUpdate(tenantId, entity.id, (msg) => context.log(msg));
          }
        } catch (err) {
          context.log.error(`QBOWebhook: failed processing ${entity.name} ${entity.id}`, err);
        }
      }
    } catch (err) {
      context.log.error("QBOWebhook: failed processing notification", err);
    }
  }
};
