// FieldValet — turn a stored chatMessages entity into the client-facing shape,
// attaching short-lived read-SAS URLs for each photo (thumbnail + full view).
const { readSasUrl } = require("./blob");

function attachmentUrls(e, index, size) {
  return readSasUrl(`${e.tenantId}/${e.locationId}/${e.messageId}/${index}-${size}.jpg`);
}

function serializeMessage(e) {
  let atts = [];
  try {
    atts = JSON.parse(e.attachments || "[]");
  } catch (_) {}
  let reactions = [];
  try {
    reactions = JSON.parse(e.reactionsJson || "[]");
  } catch (_) {}

  return {
    id: e.rowKey, // stable per-message key + paging cursor
    messageId: e.messageId,
    senderId: e.senderId || "",
    senderName: e.senderName || "",
    text: e.bodyText || "",
    detected: e.langDetected || "",
    translated: e.bodyTranslated || "",
    translatedLang: e.langTranslated || "",
    createdAt: e.createdAt || "",
    attachments: atts.map((a) => ({
      index: a.index,
      w: a.w || 0,
      h: a.h || 0,
      thumbUrl: attachmentUrls(e, a.index, "thumb"),
      viewUrl: attachmentUrls(e, a.index, "view"),
    })),
    // [{ emoji, count, userIds:[], userNames:[] }] — client derives "mine" from its user id.
    reactions,
  };
}

module.exports = { serializeMessage };
