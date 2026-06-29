// FieldValet — navigation shell.
// Mirrors the wireframe structure. Page bodies are intentionally empty placeholders.

const NAV = [
  { id: "dashboard", label: "Dashboard", subtabs: [] },
  { id: "sales", label: "Sales", subtabs: ["Leads", "Bids", "Proposals", "Pipeline"] },
  { id: "sites", label: "Sites", subtabs: ["Site info", "Security wall", "Work orders"] },
  { id: "chats", label: "Chats", subtabs: [] },
  { id: "scheduling", label: "Scheduling", subtabs: ["Calendar", "Time clock", "Coverage"] },
  { id: "hiring", label: "Hiring", subtabs: [] },
];

const state = { tab: "dashboard", sub: 0 };

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseHash() {
  const raw = (location.hash || "#/dashboard").replace(/^#\//, "");
  const [tabId, subSlug] = raw.split("/");
  const tab = NAV.find((t) => t.id === tabId) || NAV[0];
  let sub = 0;
  if (subSlug) {
    const idx = tab.subtabs.findIndex((s) => slug(s) === subSlug);
    if (idx >= 0) sub = idx;
  }
  state.tab = tab.id;
  state.sub = sub;
}

function setHash() {
  const tab = NAV.find((t) => t.id === state.tab);
  const base = `#/${tab.id}`;
  location.hash = tab.subtabs.length ? `${base}/${slug(tab.subtabs[state.sub])}` : base;
}

function renderPrimary() {
  const el = document.getElementById("primary-nav");
  el.innerHTML = "";
  NAV.forEach((t) => {
    const b = document.createElement("button");
    b.className = "tab" + (t.id === state.tab ? " active" : "");
    b.textContent = t.label;
    b.onclick = () => { state.tab = t.id; state.sub = 0; setHash(); };
    el.appendChild(b);
  });
}

function renderSecondary() {
  const el = document.getElementById("secondary-nav");
  el.innerHTML = "";
  const tab = NAV.find((t) => t.id === state.tab);
  tab.subtabs.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "subtab" + (i === state.sub ? " active" : "");
    b.textContent = s;
    b.onclick = () => { state.sub = i; setHash(); };
    el.appendChild(b);
  });
}

function renderView() {
  const tab = NAV.find((t) => t.id === state.tab);
  const sub = tab.subtabs[state.sub];
  const title = tab.label;
  const where = sub ? `${tab.label} › ${sub}` : tab.label;

  if (tab.id === "sites" && sub === "Site info") {
    renderSitesList();
    return;
  }

  document.getElementById("view").innerHTML = `
    <h1 class="page-title">${title}</h1>
    <p class="page-sub">${where}</p>
    <div class="placeholder">
      <strong>${where}</strong>
      This page is intentionally empty for now — navigation shell only.
    </div>`;
}

// ---- Sites list ----
let _sitesCache = null;

async function renderSitesList() {
  const view = document.getElementById("view");
  view.innerHTML = `
    <h1 class="page-title">Sites</h1>
    <p class="page-sub">Sites › Site info</p>
    <div class="sites-loading">Loading sites…</div>`;

  if (!_sitesCache) {
    try {
      const res = await fetch("/api/locations");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      _sitesCache = data.locations || [];
    } catch (err) {
      view.innerHTML = `
        <h1 class="page-title">Sites</h1>
        <p class="page-sub">Sites › Site info</p>
        <div class="placeholder"><strong>Could not load sites</strong>${err.message}</div>`;
      return;
    }
  }

  view.innerHTML = `
    <h1 class="page-title">Sites</h1>
    <p class="page-sub">Sites › Site info</p>
    <div class="sites-toolbar">
      <input id="sites-search" class="sites-search" type="search" placeholder="Search by name or address…" />
      <span id="sites-count" class="sites-count"></span>
    </div>
    <table class="sites-table">
      <thead><tr><th>Name</th><th>Address</th></tr></thead>
      <tbody id="sites-tbody"></tbody>
    </table>`;

  function filterSites(q) {
    const lower = q.toLowerCase();
    return _sitesCache.filter(
      (s) => s.name.toLowerCase().includes(lower) || s.address.toLowerCase().includes(lower)
    );
  }

  function paintRows(sites) {
    const tbody = document.getElementById("sites-tbody");
    const count = document.getElementById("sites-count");
    if (!tbody) return;
    count.textContent = `${sites.length} site${sites.length !== 1 ? "s" : ""}`;
    if (sites.length === 0) {
      tbody.innerHTML = `<tr><td colspan="2" class="sites-empty">No sites match your search.</td></tr>`;
      return;
    }
    tbody.innerHTML = sites
      .map(
        (s) =>
          `<tr>
            <td class="site-name">${escHtml(s.name)}</td>
            <td class="site-address">${escHtml(s.address)}</td>
          </tr>`
      )
      .join("");
  }

  paintRows(_sitesCache);

  document.getElementById("sites-search").addEventListener("input", (e) => {
    paintRows(filterSites(e.target.value.trim()));
  });
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function render() {
  renderPrimary();
  renderSecondary();
  renderView();
}

// ---- Theme toggle (light/dark) ----
// The initial theme is applied in index.html before paint to avoid a flash.
// This wires the sidebar toggle button and persists the choice to localStorage.
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("fv-theme", theme); } catch (e) {}
  updateThemeToggle();
}

function updateThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const dark = currentTheme() === "dark";
  btn.textContent = dark ? "☀️" : "🌙";
  btn.setAttribute("title", dark ? "Switch to light theme" : "Switch to dark theme");
  btn.setAttribute("aria-pressed", String(dark));
}

function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    setTheme(currentTheme() === "dark" ? "light" : "dark");
  });
  updateThemeToggle();
}

window.addEventListener("hashchange", () => { parseHash(); render(); });
parseHash();
render();
initThemeToggle();
