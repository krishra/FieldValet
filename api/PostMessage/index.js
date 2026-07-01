const crypto = require("crypto");
const { requireSession, json } = require("../shared/auth");
const {
  tableClient,
  CHAT_MESSAGES_TABLE,
  CHAT_THREADS_TABLE,
  threadKey,
  threadGroup,
  invertedRowKey,
  getLocationName,
} = require("../shared/chatStorage");
const { toPlainText } = require("../shared/sanitize");
const { translate } = require("../shared/translate");
const { serializeMessage } = require("../shared/chatSerialize");
const { publishToThread } = require("../shared/pubsub");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTOS = 10;

// POST /api/chat/messages
// Body: { location, text, messageId?, attachments?: [{ index, w, h }] }
// messageId is the value returned by /chat/upload-sas when the message has photos;
// omit it for text-only messages.
module.exports = async function (context, req) {
  const session = requireSession(context, req);
  if (!session) return;
  const tenantId = session.tid;
  const senderId = session.sub || "";
  const senderName = session.name || session.email || "Unknown";

  const body = req.body || {};
  const locationId = body.location || "";
  const text = toPlainText(body.text);

  // Attachments — trust only the index; blob names are reconstructed server-side.
  let attachments = Array.isArray(body.attachments) ? body.attachments : [];
  attachments = attachments
    .filter((a) => a && Number.isInteger(a.index) && a.index >= 0 && a.index < MAX_PHOTOS)
    .slice(0, MAX_PHOTOS)
    .map((a) => ({ index: a.index, w: parseInt(a.w, 10) || 0, h: parseInt(a.h, 10) || 0 }));

  if (!locationId) {
    json(context, 400, { error: "location is required." });
    return;
  }
  if (!text && attachments.length === 0) {
    json(context, 400, { error: "A message needs text or at least one photo." });
    return;
  }

  // A photo message must carry the messageId minted by upload-sas so blob keys line up.
  let messageId = body.messageId;
  if (attachments.length > 0) {
    if (!messageId || !UUID_RE.test(String(messageId))) {
      json(context, 400, { error: "Valid messageId is required for photo messages." });
      return;
    }
  } else {
    messageId = crypto.randomUUID();
  }

  try {
    const name = await getLocationName(tenantId, locationId);
    if (name === null) {
      json(context, 404, { error: "Location not found." });
      return;
    }

    // Eager translation on post (detect + translate en<->es).
    const t = await translate(text);

    const now = new Date();
    const entity = {
      partitionKey: threadKey(tenantId, locationId),
      rowKey: invertedRowKey(now.getTime()),
      messageId,
      tenantId, // explicit so blob keys reconstruct unambiguously
      locationId,
      senderId,
      senderName,
      bodyText: text,
      langDetected: t.detected,
      bodyTranslated: t.translatedText,
      langTranslated: t.translatedLang,
      attachments: JSON.stringify(attachments),
      reactionsJson: "[]",
      createdAt: now.toISOString(),
    };

    const messages = tableClient(CHAT_MESSAGES_TABLE);
    await messages.createTable();
    await messages.createEntity(entity);

    // Denormalised thread row for the thread list (last message + timestamp).
    const preview = text ? text.slice(0, 80) : attachments.length ? "📷 Photo" : "";
    const threads = tableClient(CHAT_THREADS_TABLE);
    await threads.createTable();
    await threads.upsertEntity(
      {
        partitionKey: tenantId,
        rowKey: locationId,
        name,
        lastMessageAt: now.toISOString(),
        lastMessagePreview: preview,
      },
      "Merge"
    );

    const serialized = serializeMessage(entity);
    await publishToThread(threadGroup(tenantId, locationId), { type: "message", message: serialized });

    json(context, 201, { message: serialized });
  } catch (err) {
    context.log.error("PostMessage failed", err);
    json(context, 500, { error: String((err && err.message) || err) });
  }
};
