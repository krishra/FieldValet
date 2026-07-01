// FieldValet — Azure Web PubSub helpers for real-time chat delivery.
//
// Clients connect over WebSocket to a per-thread group; the server publishes new
// messages and reaction updates to that group. If WEBPUBSUB_CONNECTION is not set,
// real-time is disabled gracefully — the UI falls back to on-send/refresh loading.
//
// Required app setting: WEBPUBSUB_CONNECTION.
const { WebPubSubServiceClient } = require("@azure/web-pubsub");

const HUB = "chat";

function isConfigured() {
  return Boolean(process.env.WEBPUBSUB_CONNECTION);
}

let _client = null;
function serviceClient() {
  if (!_client) {
    _client = new WebPubSubServiceClient(process.env.WEBPUBSUB_CONNECTION, HUB);
  }
  return _client;
}

// A client-access WebSocket URL pre-joined to the given group. The browser opens
// this URL with the `json.webpubsub.azure.v1` subprotocol and immediately receives
// group messages — no server-side join round-trip needed.
async function clientAccessUrl(group) {
  const token = await serviceClient().getClientAccessToken({
    groups: [group],
    roles: [`webpubsub.sendToGroup.${group}`],
    expirationTimeInMinutes: 60,
  });
  return token.url;
}

// Publish a JSON payload to everyone in a thread's group. Best-effort: never let a
// pub/sub failure break the write path.
async function publishToThread(group, payload) {
  if (!isConfigured()) return;
  try {
    await serviceClient().group(group).sendToAll(payload);
  } catch (e) {
    // swallow — the message is already persisted; realtime is a nicety
  }
}

module.exports = { isConfigured, clientAccessUrl, publishToThread };
