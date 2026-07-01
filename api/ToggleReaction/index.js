const { requireSession, json } = require("../shared/auth");
const {
  tableClient,
  CHAT_MESSAGES_TABLE,
  CHAT_REACTIONS_TABLE,
  threadKey,
  threadGroup,
  odata,
  getLocationName,
} = require("../shared/chatStorage");
const { publishToThread } = require("../shared/pubsub");

// Fixed reaction palette — keeps RowKeys well-behaved and the UI focused.
const ALLOWED = ["👍", "❤️", "😂", "🎉", "👏", "✅", "👀", "🙏"];

// POST /api/chat/reaction  { location, messageId, emoji }
// Toggles the caller's reaction on a message, recomputes the denormalised summary,
// and publishes the update to the thread group.
module.exports = async function (context, req) {
  const session = requireSession(context, req);
  if (!session) return;
  const tenantId = session.tid;
  const userId = session.sub || session.email || "";
  const userName = session.name || session.email || "Unknown";

  const body = req.body || {};
  const locationId = body.location || "";
  const messageId = body.messageId || "";
  const emoji = body.emoji || "";

  if (!locationId || !messageId) {
    json(context, 400, { error: "location and messageId are required." });
    return;
  }
  if (!ALLOWED.includes(emoji)) {
    json(context, 400, { error: "Unsupported reaction." });
    return;
  }

  try {
    const name = await getLocationName(tenantId, locationId);
    if (name === null) {
      json(context, 404, { error: "Location not found." });
      return;
    }

    // Locate the message within this tenant's thread (guards cross-tenant access).
    const pk = threadKey(tenantId, locationId);
    const messages = tableClient(CHAT_MESSAGES_TABLE);
    let msg = null;
    const iter = messages.listEntities({
      queryOptions: { filter: `PartitionKey eq '${odata(pk)}' and messageId eq '${odata(messageId)}'` },
    });
    for await (const e of iter) {
      msg = e;
      break;
    }
    if (!msg) {
      json(context, 404, { error: "Message not found." });
      return;
    }

    const reactions = tableClient(CHAT_REACTIONS_TABLE);
    await reactions.createTable();
    const rk = `${emoji}__${userId}`;

    // Toggle: remove if present, add if not.
    let existed = false;
    try {
      await reactions.getEntity(messageId, rk);
      existed = true;
    } catch (e) {
      if (!(e && e.statusCode === 404)) throw e;
    }
    if (existed) {
      await reactions.deleteEntity(messageId, rk);
    } else {
      await reactions.createEntity({
        partitionKey: messageId,
        rowKey: rk,
        emoji,
        userId,
        userName,
        createdAt: new Date().toISOString(),
      });
    }

    // Recompute the summary from the (small) messageId partition.
    const byEmoji = new Map();
    const all = reactions.listEntities({
      queryOptions: { filter: `PartitionKey eq '${odata(messageId)}'` },
    });
    for await (const r of all) {
      if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, { emoji: r.emoji, count: 0, userIds: [], userNames: [] });
      const agg = byEmoji.get(r.emoji);
      agg.count += 1;
      agg.userIds.push(r.userId);
      agg.userNames.push(r.userName);
    }
    // Stable order following the palette.
    const summary = ALLOWED.filter((e) => byEmoji.has(e)).map((e) => byEmoji.get(e));

    // Persist the summary back onto the message for fast reads.
    await messages.updateEntity(
      { partitionKey: pk, rowKey: msg.rowKey, reactionsJson: JSON.stringify(summary) },
      "Merge"
    );

    await publishToThread(threadGroup(tenantId, locationId), {
      type: "reaction",
      messageId,
      reactions: summary,
    });

    json(context, 200, { messageId, reactions: summary });
  } catch (err) {
    context.log.error("ToggleReaction failed", err);
    json(context, 500, { error: String((err && err.message) || err) });
  }
};
