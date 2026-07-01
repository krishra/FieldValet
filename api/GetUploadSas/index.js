const crypto = require("crypto");
const { requireSession, json } = require("../shared/auth");
const { getLocationName } = require("../shared/chatStorage");
const { ensureContainer, uploadSasUrl } = require("../shared/blob");

const MAX_PHOTOS = 10;

// POST /api/chat/upload-sas  { location, count }
// Mints a messageId and returns short-lived, write-only upload URLs for each photo's
// thumbnail and view blob. The browser resizes locally and PUTs straight to Blob
// Storage; PostMessage is then called with the same messageId.
//
// Blob key: {tenantId}/{locationId}/{messageId}/{index}-{size}.jpg
module.exports = async function (context, req) {
  const session = requireSession(context, req);
  if (!session) return;
  const tenantId = session.tid;

  const body = req.body || {};
  const locationId = body.location || "";
  const count = Math.max(0, Math.min(MAX_PHOTOS, parseInt(body.count, 10) || 0));

  if (!locationId) {
    json(context, 400, { error: "location is required." });
    return;
  }
  if (count === 0) {
    json(context, 400, { error: "count must be between 1 and " + MAX_PHOTOS + "." });
    return;
  }

  try {
    const name = await getLocationName(tenantId, locationId);
    if (name === null) {
      json(context, 404, { error: "Location not found." });
      return;
    }

    await ensureContainer();
    const messageId = crypto.randomUUID();
    const base = `${tenantId}/${locationId}/${messageId}`;

    const uploads = [];
    for (let i = 0; i < count; i++) {
      const thumbName = `${base}/${i}-thumb.jpg`;
      const viewName = `${base}/${i}-view.jpg`;
      uploads.push({
        index: i,
        thumb: { blobName: thumbName, url: uploadSasUrl(thumbName) },
        view: { blobName: viewName, url: uploadSasUrl(viewName) },
      });
    }

    json(context, 200, { messageId, uploads });
  } catch (err) {
    context.log.error("GetUploadSas failed", err);
    json(context, 500, { error: String((err && err.message) || err) });
  }
};
