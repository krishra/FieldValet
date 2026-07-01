const { requireSession, json } = require("../shared/auth");
const {
  tableClient,
  CHAT_MESSAGES_TABLE,
  threadKey,
  odata,
  getLocationName,
} = require("../shared/chatStorage");
const { serializeMessage } = require("../shared/chatSerialize");

const PAGE_SIZE = 50;

// GET /api/chat/messages?location={locationId}&before={cursor}
// Returns up to PAGE_SIZE messages in chronological order (oldest first) plus a
// `nextBefore` cursor for loading older history. RowKeys are inverted ticks, so
// Table Storage's ascending order is newest-first; we page with RowKey gt cursor.
module.exports = async function (context, req) {
  const session = requireSession(context, req);
  if (!session) return;
  const tenantId = session.tid;

  const locationId = (req.query && req.query.location) || "";
  const before = (req.query && req.query.before) || "";
  if (!locationId) {
    json(context, 400, { error: "location is required." });
    return;
  }

  try {
    const name = await getLocationName(tenantId, locationId);
    if (name === null) {
      json(context, 404, { error: "Location not found." });
      return;
    }

    const pk = threadKey(tenantId, locationId);
    let filter = `PartitionKey eq '${odata(pk)}'`;
    if (before) filter += ` and RowKey gt '${odata(before)}'`;

    const client = tableClient(CHAT_MESSAGES_TABLE);
    await client.createTable();

    const page = [];
    const iter = client.listEntities({ queryOptions: { filter } });
    for await (const e of iter) {
      page.push(e);
      if (page.length >= PAGE_SIZE) break;
    }

    // page is newest-first (ascending inverted RowKey). Cursor for older = the
    // largest RowKey we saw (the oldest message on this page).
    const nextBefore = page.length >= PAGE_SIZE ? page[page.length - 1].rowKey : "";

    const messages = page.map(serializeMessage).reverse(); // chronological for display

    json(context, 200, { locationName: name, messages, nextBefore }, { "Cache-Control": "no-cache" });
  } catch (err) {
    context.log.error("GetMessages failed", err);
    json(context, 500, { error: String((err && err.message) || err) });
  }
};
