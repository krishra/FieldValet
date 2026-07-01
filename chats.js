// FieldValet — Chats tab.
//
// One conversation per site location. Rich text + emoji, photo uploads (resized in
// the browser, uploaded straight to Blob Storage via SAS), emoji reactions, and an
// original+translated block per message. Live updates arrive over Azure Web PubSub;
// if that isn't provisioned the UI still works on send/refresh.
//
// Shares global scope with app.js — uses currentUser, apiFetch, escHtml, initials.

const chatState = {
  locationId: "",
  locationName: "",
  messages: [],
  ids: new Set(), // known message ids (rowKeys) — dedupes the sender's own WS echo
  nextBefore: "",
  loadingOlder: false,
  ws: null,
  wsUrl: "",
  reconnectTimer: null,
  closing: false,
};

const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "👏", "✅", "👀", "🙏"];
const COMPOSER_EMOJIS = ["😀", "😂", "👍", "🙏", "🎉", "✅", "❤️", "👀", "🧹", "🚮", "⚠️", "📷", "🔑", "🕐"];
const TRUNCATE_AT = 280;

// ---------- lifecycle ----------

function teardownChats() {
  chatState.closing = true;
  if (chatState.reconnectTimer) clearTimeout(chatState.reconnectTimer);
  chatState.reconnectTimer = null;
  if (chatState.ws) {
    try { chatState.ws.close(); } catch (e) {}
  }
  chatState.ws = null;
}

async function renderChats() {
  chatState.closing = false;
  const view = document.getElementById("view");
  view.innerHTML = `
    <div class="chat-shell">
      <aside class="chat-threads" id="chat-threads">
        <div class="chat-threads-head">Sites</div>
        <div class="chat-threads-list" id="chat-threads-list">Loading sites…</div>
      </aside>
      <section class="chat-main" id="chat-main">
        <div class="chat-empty">Select a site to open its conversation.</div>
      </section>
    </div>`;

  // Reuse the sites cache the rest of the app maintains.
  if (!_sitesCache) {
    try {
      const res = await apiFetch("/api/locations");
      if (res.ok) _sitesCache = (await res.json()).locations || [];
    } catch (e) {
      _sitesCache = _sitesCache || [];
    }
  }
  paintThreadList();

  // Re-open the previously active thread after a re-render.
  if (chatState.locationId) {
    const still = (_sitesCache || []).some((s) => s.id === chatState.locationId);
    if (still) selectThread(chatState.locationId, chatState.locationName);
  }
}

function paintThreadList() {
  const list = document.getElementById("chat-threads-list");
  if (!list) return;
  const sites = _sitesCache || [];
  if (sites.length === 0) {
    list.innerHTML = `<div class="chat-threads-empty">No sites yet. Add a site first.</div>`;
    return;
  }
  list.innerHTML = sites
    .map(
      (s) => `
      <button class="chat-thread${s.id === chatState.locationId ? " active" : ""}" data-id="${escHtml(s.id)}" data-name="${escHtml(s.name)}">
        <span class="chat-thread-avatar">${escHtml(initials(s.name))}</span>
        <span class="chat-thread-meta">
          <span class="chat-thread-name">${escHtml(s.name)}</span>
          <span class="chat-thread-sub">${escHtml(s.address || "")}</span>
        </span>
      </button>`
    )
    .join("");
  list.querySelectorAll(".chat-thread").forEach((btn) => {
    btn.addEventListener("click", () => selectThread(btn.dataset.id, btn.dataset.name));
  });
}

// ---------- thread ----------

async function selectThread(locationId, locationName) {
  // Switching threads: drop the old live connection and state.
  if (chatState.locationId !== locationId) teardownChats();
  chatState.closing = false;
  chatState.locationId = locationId;
  chatState.locationName = locationName;
  chatState.messages = [];
  chatState.ids = new Set();
  chatState.nextBefore = "";

  paintThreadList();

  const main = document.getElementById("chat-main");
  main.innerHTML = `
    <header class="chat-head">
      <span class="chat-head-avatar">${escHtml(initials(locationName))}</span>
      <div class="chat-head-meta">
        <div class="chat-head-name">${escHtml(locationName)}</div>
        <div class="chat-head-sub" id="chat-head-sub">Loading…</div>
      </div>
    </header>
    <div class="chat-scroll" id="chat-scroll">
      <div class="chat-loading">Loading messages…</div>
    </div>
    ${composerHtml()}`;

  wireComposer();
  await loadMessages(true);
  connectRealtime(locationId);
}

async function loadMessages(initial) {
  try {
    const q = new URLSearchParams({ location: chatState.locationId });
    if (!initial && chatState.nextBefore) q.set("before", chatState.nextBefore);
    const res = await apiFetch("/api/chat/messages?" + q.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const incoming = (data.messages || []).filter((m) => !chatState.ids.has(m.id));
    incoming.forEach((m) => chatState.ids.add(m.id));

    if (initial) {
      chatState.messages = incoming;
    } else {
      // Older page — prepend, preserving scroll position.
      chatState.messages = incoming.concat(chatState.messages);
    }
    chatState.nextBefore = data.nextBefore || "";

    const sub = document.getElementById("chat-head-sub");
    if (sub) sub.textContent = chatState.messages.length ? `${chatState.messages.length} message${chatState.messages.length !== 1 ? "s" : ""} shown` : "No messages yet — say hello 👋";

    paintMessages(initial);
  } catch (err) {
    const scroll = document.getElementById("chat-scroll");
    if (scroll) scroll.innerHTML = `<div class="chat-loading">Could not load messages: ${escHtml(err.message)}</div>`;
  }
}

function paintMessages(scrollToBottom) {
  const scroll = document.getElementById("chat-scroll");
  if (!scroll) return;
  const prevHeight = scroll.scrollHeight;
  const prevTop = scroll.scrollTop;

  let html = "";
  if (chatState.nextBefore) {
    html += `<button class="chat-load-older" id="chat-load-older">Load older messages</button>`;
  }
  if (chatState.messages.length === 0) {
    html += `<div class="chat-loading">No messages yet — say hello 👋</div>`;
  } else {
    html += chatState.messages.map(renderMessage).join("");
  }
  scroll.innerHTML = html;

  wireMessageInteractions(scroll);

  const older = document.getElementById("chat-load-older");
  if (older) {
    older.addEventListener("click", async () => {
      if (chatState.loadingOlder) return;
      chatState.loadingOlder = true;
      older.textContent = "Loading…";
      await loadMessages(false);
      chatState.loadingOlder = false;
    });
  }

  if (scrollToBottom) {
    scroll.scrollTop = scroll.scrollHeight;
  } else {
    // Keep the viewport anchored after prepending older messages.
    scroll.scrollTop = scroll.scrollHeight - prevHeight + prevTop;
  }
}

// ---------- message rendering ----------

function renderMessage(m) {
  const mine = m.senderId && currentUser && m.senderId === currentUser.userId;
  const when = formatTime(m.createdAt);
  const bodyBlock = m.text ? renderBodyBlock(m) : "";
  const photos = renderPhotos(m);
  const reactions = renderReactions(m);

  return `
    <div class="chat-msg${mine ? " mine" : ""}" data-mid="${escHtml(m.messageId)}" data-id="${escHtml(m.id)}">
      <div class="chat-msg-avatar">${escHtml(initials(m.senderName || "?"))}</div>
      <div class="chat-msg-body">
        <div class="chat-msg-head">
          <span class="chat-msg-name">${escHtml(m.senderName || "Unknown")}</span>
          <span class="chat-msg-time">${escHtml(when)}</span>
        </div>
        ${bodyBlock}
        ${photos}
        ${reactions}
      </div>
    </div>`;
}

// Original + translated in a single block. Both are independently truncated.
function renderBodyBlock(m) {
  let html = `<div class="chat-bubble">${renderText(m.text)}`;
  if (m.translated) {
    const tag = (m.translatedLang || "").toUpperCase();
    html += `
      <div class="chat-translated">
        <span class="chat-translated-tag">Translated${tag ? " · " + escHtml(tag) : ""}</span>
        ${renderText(m.translated)}
      </div>`;
  }
  html += `</div>`;
  return html;
}

// HTML-escape, apply a tiny safe markdown subset, truncate long text with Show more.
function renderText(text) {
  const full = richInline(text);
  if (text.length <= TRUNCATE_AT) {
    return `<div class="chat-text">${full}</div>`;
  }
  const short = richInline(text.slice(0, TRUNCATE_AT).replace(/\s+\S*$/, "")) + "…";
  return `
    <div class="chat-text is-truncated">
      <span class="chat-text-short">${short} <a href="#" class="chat-more" data-act="more">Show more</a></span>
      <span class="chat-text-full" hidden>${full} <a href="#" class="chat-more" data-act="less">Show less</a></span>
    </div>`;
}

// Escape first, then re-introduce **bold**, *italic*, links, and line breaks.
function richInline(text) {
  let s = escHtml(text);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/\b(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  s = s.replace(/\n/g, "<br>");
  return s;
}

function renderPhotos(m) {
  const atts = m.attachments || [];
  if (atts.length === 0) return "";
  const shown = atts.slice(0, 4);
  const extra = atts.length - 4;
  const cells = shown
    .map((a, i) => {
      const overlay = i === 3 && extra > 0 ? `<span class="chat-photo-more">+${extra}</span>` : "";
      return `<button class="chat-photo" data-idx="${i}" style="background-image:url('${escAttr(a.thumbUrl)}')">${overlay}</button>`;
    })
    .join("");
  return `<div class="chat-photos grid-${Math.min(shown.length, 4)}" data-mid="${escHtml(m.messageId)}">${cells}</div>`;
}

function renderReactions(m) {
  const list = m.reactions || [];
  const chips = list
    .map((r) => {
      const mine = currentUser && (r.userIds || []).includes(currentUser.userId);
      const who = (r.userNames || []).join(", ");
      return `<button class="chat-react-chip${mine ? " mine" : ""}" data-emoji="${escAttr(r.emoji)}" title="${escAttr(who)}">${r.emoji} ${r.count}</button>`;
    })
    .join("");
  return `
    <div class="chat-reactions" data-mid="${escHtml(m.messageId)}">
      ${chips}
      <button class="chat-react-add" data-act="react" title="Add reaction">☺+</button>
    </div>`;
}

function wireMessageInteractions(root) {
  // Show more / less.
  root.querySelectorAll(".chat-more").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const wrap = a.closest(".chat-text");
      if (!wrap) return;
      const short = wrap.querySelector(".chat-text-short");
      const fullEl = wrap.querySelector(".chat-text-full");
      const showFull = a.dataset.act === "more";
      short.hidden = showFull;
      fullEl.hidden = !showFull;
    });
  });

  // Photo grid → modal.
  root.querySelectorAll(".chat-photos").forEach((grid) => {
    grid.querySelectorAll(".chat-photo").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = chatState.messages.find((x) => x.messageId === grid.dataset.mid);
        if (m) openPhotoModal(m.attachments, parseInt(btn.dataset.idx, 10) || 0);
      });
    });
  });

  // Reactions.
  root.querySelectorAll(".chat-reactions").forEach((row) => {
    const mid = row.dataset.mid;
    row.querySelectorAll(".chat-react-chip").forEach((chip) => {
      chip.addEventListener("click", () => toggleReaction(mid, chip.dataset.emoji));
    });
    const add = row.querySelector(".chat-react-add");
    if (add) add.addEventListener("click", () => openReactionPicker(add, mid));
  });
}

// ---------- reactions ----------

function openReactionPicker(anchor, messageId) {
  closeFloaters();
  const pop = document.createElement("div");
  pop.className = "chat-emoji-pop";
  pop.innerHTML = REACTION_EMOJIS.map((e) => `<button class="chat-emoji-opt" data-emoji="${escAttr(e)}">${e}</button>`).join("");
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${window.scrollY + r.bottom + 6}px`;
  pop.style.left = `${window.scrollX + r.left}px`;
  pop.querySelectorAll(".chat-emoji-opt").forEach((b) => {
    b.addEventListener("click", () => {
      toggleReaction(messageId, b.dataset.emoji);
      closeFloaters();
    });
  });
  setTimeout(() => document.addEventListener("click", closeFloatersOnce, { once: true }), 0);
}

function closeFloatersOnce() { closeFloaters(); }
function closeFloaters() {
  document.querySelectorAll(".chat-emoji-pop").forEach((el) => el.remove());
}

async function toggleReaction(messageId, emoji) {
  try {
    const res = await apiFetch("/api/chat/reaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: chatState.locationId, messageId, emoji }),
    });
    if (!res.ok) return;
    const data = await res.json();
    applyReactionUpdate(messageId, data.reactions || []);
  } catch (e) {}
}

function applyReactionUpdate(messageId, reactions) {
  const m = chatState.messages.find((x) => x.messageId === messageId);
  if (!m) return;
  m.reactions = reactions;
  const row = document.querySelector(`.chat-reactions[data-mid="${cssEsc(messageId)}"]`);
  if (row) {
    const tmp = document.createElement("div");
    tmp.innerHTML = renderReactions(m);
    row.replaceWith(tmp.firstElementChild);
    const scroll = document.getElementById("chat-scroll");
    if (scroll) wireMessageInteractions(scroll);
  }
}

// ---------- composer ----------

function composerHtml() {
  return `
    <div class="chat-composer">
      <div class="chat-attach-preview" id="chat-attach-preview" hidden></div>
      <div class="chat-composer-row">
        <button class="chat-icon-btn" id="chat-emoji-btn" title="Emoji" type="button">☺</button>
        <button class="chat-icon-btn" id="chat-photo-btn" title="Add photos" type="button">📷</button>
        <input type="file" id="chat-photo-input" accept="image/*" multiple hidden />
        <textarea id="chat-input" class="chat-input" rows="1" maxlength="2000"
          placeholder="Message… (**bold**, *italic*)"></textarea>
        <button class="btn-primary chat-send" id="chat-send" type="button">Send</button>
      </div>
      <div class="chat-composer-hint" id="chat-composer-hint"></div>
    </div>`;
}

let pendingPhotos = []; // File[]

function wireComposer() {
  pendingPhotos = [];
  const input = document.getElementById("chat-input");
  const send = document.getElementById("chat-send");
  const photoBtn = document.getElementById("chat-photo-btn");
  const photoInput = document.getElementById("chat-photo-input");
  const emojiBtn = document.getElementById("chat-emoji-btn");

  // Auto-grow textarea.
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  });
  // Enter to send, Shift+Enter for newline.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  send.addEventListener("click", sendMessage);
  photoBtn.addEventListener("click", () => photoInput.click());
  photoInput.addEventListener("change", () => {
    const files = Array.from(photoInput.files || []).filter((f) => f.type.startsWith("image/"));
    pendingPhotos = pendingPhotos.concat(files).slice(0, 10);
    photoInput.value = "";
    paintAttachPreview();
  });

  emojiBtn.addEventListener("click", () => openComposerEmoji(emojiBtn, input));
}

function paintAttachPreview() {
  const box = document.getElementById("chat-attach-preview");
  if (!box) return;
  if (pendingPhotos.length === 0) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.innerHTML = pendingPhotos
    .map((f, i) => `<span class="chat-attach-chip">${escHtml(shorten(f.name, 18))}<button data-i="${i}" title="Remove">×</button></span>`)
    .join("");
  box.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      pendingPhotos.splice(parseInt(b.dataset.i, 10), 1);
      paintAttachPreview();
    });
  });
}

function openComposerEmoji(anchor, input) {
  closeFloaters();
  const pop = document.createElement("div");
  pop.className = "chat-emoji-pop";
  pop.innerHTML = COMPOSER_EMOJIS.map((e) => `<button class="chat-emoji-opt" data-emoji="${escAttr(e)}">${e}</button>`).join("");
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${window.scrollY + r.top - 8 - 44}px`;
  pop.style.left = `${window.scrollX + r.left}px`;
  pop.querySelectorAll(".chat-emoji-opt").forEach((b) => {
    b.addEventListener("click", () => {
      insertAtCursor(input, b.dataset.emoji);
      closeFloaters();
      input.focus();
    });
  });
  setTimeout(() => document.addEventListener("click", closeFloatersOnce, { once: true }), 0);
}

function insertAtCursor(input, text) {
  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + text.length;
}

async function sendMessage() {
  const input = document.getElementById("chat-input");
  const send = document.getElementById("chat-send");
  const hint = document.getElementById("chat-composer-hint");
  const text = (input.value || "").trim();
  const photos = pendingPhotos.slice();

  if (!text && photos.length === 0) return;

  send.disabled = true;
  send.textContent = "Sending…";
  try {
    let messageId = null;
    let attachments = [];

    if (photos.length > 0) {
      if (hint) hint.textContent = "Uploading photos…";
      const sasRes = await apiFetch("/api/chat/upload-sas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: chatState.locationId, count: photos.length }),
      });
      if (!sasRes.ok) throw new Error("Could not get upload URLs.");
      const sas = await sasRes.json();
      messageId = sas.messageId;

      for (let i = 0; i < photos.length; i++) {
        const slot = sas.uploads[i];
        const thumb = await resizeImage(photos[i], 320, 0.72);
        const view = await resizeImage(photos[i], 1280, 0.82);
        await uploadBlob(slot.thumb.url, thumb.blob);
        await uploadBlob(slot.view.url, view.blob);
        attachments.push({ index: i, w: view.w, h: view.h });
      }
    }

    if (hint) hint.textContent = "";
    const res = await apiFetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: chatState.locationId, text, messageId, attachments }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();

    // Optimistically append; the Web PubSub echo of our own message is deduped.
    appendMessage(data.message);

    input.value = "";
    input.style.height = "auto";
    pendingPhotos = [];
    paintAttachPreview();
  } catch (err) {
    if (hint) hint.textContent = "Could not send: " + err.message;
  } finally {
    send.disabled = false;
    send.textContent = "Send";
  }
}

// Append a message if we haven't already seen it (id = rowKey).
function appendMessage(m) {
  if (!m || chatState.ids.has(m.id)) return;
  chatState.ids.add(m.id);
  chatState.messages.push(m);
  const scroll = document.getElementById("chat-scroll");
  if (!scroll) return;
  const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120;
  paintMessages(nearBottom);
}

// ---------- photo helpers ----------

// Resize a File to a JPEG Blob whose longest edge <= maxEdge. Returns { blob, w, h }.
function resizeImage(file, maxEdge, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => (blob ? resolve({ blob, w, h }) : reject(new Error("Image encode failed"))),
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

function uploadBlob(sasUrl, blob) {
  return fetch(sasUrl, {
    method: "PUT",
    headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "image/jpeg" },
    body: blob,
  }).then((r) => {
    if (!r.ok) throw new Error("Photo upload failed (" + r.status + ")");
  });
}

// ---------- photo modal ----------

function openPhotoModal(attachments, startIndex) {
  let idx = startIndex || 0;
  const overlay = document.createElement("div");
  overlay.className = "chat-modal";
  overlay.innerHTML = `
    <button class="chat-modal-close" title="Close">×</button>
    <button class="chat-modal-nav prev" title="Previous">‹</button>
    <img class="chat-modal-img" alt="Photo" />
    <button class="chat-modal-nav next" title="Next">›</button>
    <div class="chat-modal-count"></div>`;
  document.body.appendChild(overlay);

  const img = overlay.querySelector(".chat-modal-img");
  const count = overlay.querySelector(".chat-modal-count");
  const show = () => {
    img.src = attachments[idx].viewUrl;
    count.textContent = `${idx + 1} / ${attachments.length}`;
    overlay.querySelector(".prev").style.visibility = attachments.length > 1 ? "visible" : "hidden";
    overlay.querySelector(".next").style.visibility = attachments.length > 1 ? "visible" : "hidden";
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const prev = () => { idx = (idx - 1 + attachments.length) % attachments.length; show(); };
  const next = () => { idx = (idx + 1) % attachments.length; show(); };
  const onKey = (e) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") prev();
    else if (e.key === "ArrowRight") next();
  };

  overlay.querySelector(".chat-modal-close").addEventListener("click", close);
  overlay.querySelector(".prev").addEventListener("click", prev);
  overlay.querySelector(".next").addEventListener("click", next);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  show();
}

// ---------- realtime (Web PubSub) ----------

async function connectRealtime(locationId) {
  try {
    const res = await apiFetch("/api/chat/negotiate?location=" + encodeURIComponent(locationId));
    if (res.status === 503) return; // not provisioned — silent fallback
    if (!res.ok) return;
    const { url } = await res.json();
    if (!url || chatState.closing || chatState.locationId !== locationId) return;
    openSocket(url, locationId);
  } catch (e) {
    // no realtime; send/refresh still works
  }
}

function openSocket(url, locationId) {
  chatState.wsUrl = url;
  const ws = new WebSocket(url, "json.webpubsub.azure.v1");
  chatState.ws = ws;

  ws.addEventListener("message", (ev) => {
    let frame;
    try { frame = JSON.parse(ev.data); } catch (e) { return; }
    if (frame.type !== "message" || !frame.data) return;
    const payload = frame.data;
    if (payload.type === "message" && payload.message) {
      appendMessage(payload.message);
    } else if (payload.type === "reaction" && payload.messageId) {
      applyReactionUpdate(payload.messageId, payload.reactions || []);
    }
  });

  ws.addEventListener("close", () => {
    if (chatState.closing || chatState.locationId !== locationId) return;
    // Reconnect with a small backoff while the thread stays open.
    chatState.reconnectTimer = setTimeout(() => connectRealtime(locationId), 3000);
  });
}

// ---------- small utils ----------

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

function shorten(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Escape for use inside an HTML attribute value.
function escAttr(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Escape a value for use inside a CSS attribute selector.
function cssEsc(s) {
  return String(s).replace(/["\\]/g, "\\$&");
}
