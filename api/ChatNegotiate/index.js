const { requireSession, json } = require("../shared/auth");
const { threadGroup, getLocationName } = require("../shared/chatStorage");
const { isConfigured, clientAccessUrl } = require("../shared/pubsub");

// GET /api/chat/negotiate?location={locationId}
// Returns a Web PubSub client URL pre-joined to the thread's group, so the browser
// can receive live messages/reactions. 503 when Web PubSub isn't provisioned yet —
// the client then runs without real-time and still works on send/refresh.
module.exports = async function (context, req) {
  const session = requireSession(context, req);
  if (!session) return;
  const tenantId = session.tid;

  const locationId = (req.query && req.query.location) || "";
  if (!locationId) {
    json(context, 400, { error: "location is required." });
    return;
  }

  if (!isConfigured()) {
    json(context, 503, { error: "Real-time delivery is not configured." });
    return;
  }

  try {
    const name = await getLocationName(tenantId, locationId);
    if (name === null) {
      json(context, 404, { error: "Location not found." });
      return;
    }
    const url = await clientAccessUrl(threadGroup(tenantId, locationId));
    json(context, 200, { url });
  } catch (err) {
    context.log.error("ChatNegotiate failed", err);
    json(context, 500, { error: String((err && err.message) || err) });
  }
};
