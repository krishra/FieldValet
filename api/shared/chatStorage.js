// FieldValet — chat-specific Table Storage helpers.
//
// Data model (see docs/chats-feature-design.md):
//   chatThreads   PK = tenantId               RK = locationId
//   chatMessages  PK = {tenantId}__{locationId}  RK = inverted-ticks (newest first)
//   chatReactions PK = messageId               RK = {emoji}__{userId}
const { tableClient, LOCATIONS_TABLE } = require("./storage");

const CHAT_THREADS_TABLE = "chatThreads";
const CHAT_MESSAGES_TABLE = "chatMessages";
const CHAT_REACTIONS_TABLE = "chatReactions";

// A thread is one site location's conversation. The message partition key bundles
// tenant + location so a thread's whole history is a single fast partition scan and
// so tenant isolation is enforced at the storage layer.
function threadKey(tenantId, locationId) {
  return `${tenantId}__${locationId}`;
}

// Web PubSub group name for a thread. Same shape as the thread key.
function threadGroup(tenantId, locationId) {
  return threadKey(tenantId, locationId);
}

// Newest-first ordering without a secondary index: Table Storage sorts RowKey
// ascending, so we store (MAX - createdAtMs) zero-padded. A short random suffix
// keeps keys unique when two messages land in the same millisecond.
const MAX_MS = 9999999999999; // 13 digits — good until year 2286
function invertedRowKey(createdAtMs) {
  const inverted = String(MAX_MS - createdAtMs).padStart(13, "0");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${inverted}-${suffix}`;
}

// Escape a value for use inside an OData filter string literal.
function odata(value) {
  return String(value).replace(/'/g, "''");
}

// Confirm a location belongs to this tenant and return its display name, or null
// if it doesn't exist. Chat threads may only ever target the caller's own sites.
async function getLocationName(tenantId, locationId) {
  try {
    const loc = await tableClient(LOCATIONS_TABLE).getEntity(tenantId, locationId);
    return loc.name || locationId;
  } catch (e) {
    if (e && e.statusCode === 404) return null;
    throw e;
  }
}

module.exports = {
  CHAT_THREADS_TABLE,
  CHAT_MESSAGES_TABLE,
  CHAT_REACTIONS_TABLE,
  tableClient,
  threadKey,
  threadGroup,
  invertedRowKey,
  odata,
  getLocationName,
};
