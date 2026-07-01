# FieldValet — Chats Feature Design

> Design notes for the per-location chat feature. Captured before implementation so the
> recommendation survives across sessions. Status: **design approved, not yet built.**

## Scope (what the feature must do)

- **One chat thread per site location.** Crew asks questions, posts post-cleaning photos, and
  communicates during cleaning.
- **Clear attribution** Every message is associated with the current user who posted the message. Display the name of the user next to the message.
- **30-day history minimum**, including all uploaded photos.
- **Rich text + emoji** messages, **photo uploads**, and **emoji reactions** on messages.
- **Auto-translation per message**: detect language, translate English↔Spanish so every
  participant reads in their language. Display both the original message and the translated message in a single block
- Max message length is 2000 characters. Truncate after 280 characters with a Show more link within the message. Translation can be truncated as well.
- Multiple photos can be posted in a single message. Display a 2x2 grid of 4 photos, if there are more than 4 photos just display +X in the last position of the 2x2 grid. When clicking the +x, all photos in the message are displayed on a modal (responsive) with the ability to scroll left and right

---

## Recommendation summary

### Photo storage — Azure Blob + SAS + resize + CDN + lifecycle

**Do NOT** store images in Table Storage / DB, proxy uploads through Functions, or serve
full-res originals into the chat list. Those are the cost/perf traps.

1. **Azure Blob Storage**, one container. Blob key: `{tenantId}/{locationId}/{messageId}/{size}.jpg`.
2. **Direct-to-blob upload via short-lived write-only SAS.** A Function mints a SAS scoped to
   one blob; the client uploads straight to Blob Storage. Functions never touch the bytes
   (saves compute + egress).
3. **Resize on ingest** → ~30 KB thumbnail + ~600 KB "view" image. Chat list renders
   thumbnails; full-res only on tap. **Single biggest cost/perf lever.**
4. **Azure CDN / Front Door** in front of the container, long cache TTLs.
5. **Lifecycle policy:** Hot → Cool at 30 days → delete (or Archive) at retention limit.
   Maps directly onto the "30-day minimum" requirement.

**Cost model** (per tenant, ~100 locations × ~22 cleanings/mo × 10 photos = ~22k photos/mo,
~630 KB each → ~14 GB/mo new):
- Hot storage ~14 GB → **~$0.25/mo**; writes (~44k ops) → **~$0.30/mo**.
- Reads/egress is the only real variable — thumbnails + CDN caching crush it.
- **Bottom line: single-digit $/tenant/mo** if you resize + CDN. ~few hundred $/mo at 100
  tenants, dominated by egress not storage. The "expensive" scenario only happens if you
  serve 3–5 MB originals repeatedly.

### Translation — Azure AI Translator (default), Claude Haiku (optional quality lane)

- **Azure AI Translator (recommended default).** Built-in language auto-detection (covers
  "detect then translate" in one call), purpose-built, fast, already on Azure.
  Pricing: **first 2M chars/mo free**, then **$10 / 1M chars** (S1).
  ~22k msgs/mo × ~100 chars ≈ 2.2M chars → **~free, or ~$2/mo per tenant**.
- **Claude Haiku 4.5 (optional).** Better on slang / cleaning-industry jargon / emoji-aware
  translation. Pricing: **$1 / 1M input, $5 / 1M output tokens**. ~25 in + ~25 out per msg,
  with prompt caching → **low single-digit $/mo per tenant**. Higher quality, modestly higher cost.
- **Decision:** Start with **Azure Translator** for all messages (cheapest, auto-detect, keeps
  translation independent of LLM spend). Add **Haiku as a "high-quality" lane** only if
  Translator mangles jargon. Cost isn't the constraint either way — correctness + latency are,
  and Translator wins both for short transactional messages.

---

## Data model

### Blob Storage (photos)

```
container: chat-media
blob key:  {tenantId}/{locationId}/{messageId}/{size}.jpg
           size ∈ { thumb (~30KB), view (~600KB) }   # originals optional, archive/cool tier
```

### Table Storage

All tables use `tenantId` somewhere in the partition key so a tenant's data is always
co-located and tenant isolation is enforced at the storage layer (PK derived from the
verified JWT `tid`, never from client input — consistent with existing auth model).

**`threads`** — one row per location (the thread itself).
| Field | Notes |
|---|---|
| PartitionKey | `tenantId` |
| RowKey | `locationId` |
| lastMessageAt | for sorting thread list / unread badges |
| lastMessagePreview | denormalized snippet for the thread list |
| messageCount | optional, for UI |

**`messages`** — one row per message. Partitioned by thread so a thread's history is a single
fast partition scan.
| Field | Notes |
|---|---|
| PartitionKey | `{tenantId}__{locationId}` (the thread key) |
| RowKey | **inverted ticks** = `(DateTime.MaxValue.Ticks - createdAt.Ticks)` zero-padded → newest-first natural order in Table Storage |
| messageId | stable GUID (used in blob keys; RowKey is order-only) |
| senderId / senderName | from session claims |
| bodyHtml | sanitized rich-text HTML (emoji are just Unicode in the text) |
| bodyText | plain-text fallback / source for translation |
| langDetected | e.g. `en` / `es` (from Translator) |
| bodyTranslated | translated text |
| langTranslated | target lang |
| attachments | JSON array: `[{ messageId, blobBase, w, h, thumbKey, viewKey }]` |
| createdAt | ISO timestamp (RowKey is order-only, keep the real value too) |

**`reactions`** — separate table (NOT embedded in the message) to avoid read-modify-write
contention and make toggling clean.
| Field | Notes |
|---|---|
| PartitionKey | `messageId` |
| RowKey | `{emoji}__{userId}` |
| userName | for tooltips |
| createdAt | |

Reaction counts are aggregated by querying the `messageId` partition (small), or denormalized
onto the message later if it becomes hot.

### Why these choices
- **Inverted-ticks RowKey** gives newest-first paging without a sort or secondary index —
  Table Storage sorts RowKey ascending lexically.
- **Reactions as their own table** = toggle = single insert/delete keyed by `{emoji}__{userId}`;
  no optimistic-concurrency loops on the message entity.
- **Thread key in the message PK** = a thread's 30 days of history is one partition scan.
- **30-day retention**: a scheduled cleanup (Timer Function) deletes `messages` rows older than
  retention and the Blob lifecycle policy ages out the media in parallel.

---

## Resolved decisions (implemented)
- **Real-time delivery: Azure Web PubSub** (hub `chat`, group = thread key). Clients get a
  pre-joined client-access URL from `/api/chat/negotiate` and connect over the
  `json.webpubsub.azure.v1` subprotocol. If `WEBPUBSUB_CONNECTION` is unset the endpoint
  returns 503 and the UI degrades gracefully to send/refresh (no polling).
- **Rich-text sanitization: store plain text, not HTML.** `shared/sanitize.js` strips tags and
  clamps to 2000 chars; the client applies a tiny safe markdown subset (`**bold**`, `*italic*`,
  autolinks) over HTML-escaped text at render time — no stored-HTML/XSS surface.
- **Translation: eager-on-post.** `PostMessage` calls Azure Translator once and stores both the
  detected language and the en↔es translation on the message row.

## Status: **implemented** (2026-06-30)
- API: `ChatNegotiate`, `GetMessages`, `PostMessage`, `GetUploadSas`, `ToggleReaction`;
  shared `chatStorage/blob/translate/pubsub/sanitize/chatSerialize`. Tables `chatThreads`,
  `chatMessages`, `chatReactions`; blob container `chat-media` (private, read via short-lived SAS).
- Frontend: `chats.js` + Chats-tab hook in `app.js`, styles in `styles.css`.
- **Required app settings for full function:** `WEBPUBSUB_CONNECTION` (real-time),
  `TRANSLATOR_KEY` + `TRANSLATOR_REGION` (translation), optional `CHAT_CDN_BASE` (serve reads via
  CDN). `STORAGE_CONNECTION` (already set) powers Tables + Blob. Feature runs without the optional
  ones — just loses that capability.
