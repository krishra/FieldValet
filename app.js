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
      <button class="btn-primary" id="new-site-btn">+ New Site</button>
    </div>
    <table class="sites-table">
      <thead><tr><th>Name</th><th>Address</th></tr></thead>
      <tbody id="sites-tbody"></tbody>
    </table>`;

  function filterSites(q) {
    const lower = q.toLowerCase();
    return _sitesCache.filter(
      (s) => s.name.toLowerCase().includes(lower) || (s.address || "").toLowerCase().includes(lower)
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
            <td class="site-address">${escHtml(s.address || "")}</td>
          </tr>`
      )
      .join("");
  }

  paintRows(_sitesCache);

  document.getElementById("sites-search").addEventListener("input", (e) => {
    paintRows(filterSites(e.target.value.trim()));
  });

  document.getElementById("new-site-btn").addEventListener("click", () => openNewSiteDrawer());
}

// ---- New Site drawer ----
function openNewSiteDrawer() {
  if (document.getElementById("site-drawer")) return;

  const overlay = document.createElement("div");
  overlay.id = "site-drawer-overlay";
  overlay.className = "drawer-overlay";
  overlay.addEventListener("click", closeDrawer);

  const drawer = document.createElement("div");
  drawer.id = "site-drawer";
  drawer.className = "drawer";
  drawer.innerHTML = `
    <div class="drawer-header">
      <h2 class="drawer-title">New Site</h2>
      <button class="drawer-close" id="drawer-close-btn" aria-label="Close">✕</button>
    </div>
    <div class="drawer-body">
      <form id="new-site-form" novalidate>

        <fieldset class="form-section">
          <legend>Basic Info</legend>
          <div class="form-row">
            <label class="form-label required" for="f-name">Location Name</label>
            <input class="form-input" id="f-name" type="text" required placeholder="e.g. Northgate Medical Center" />
          </div>
          <div class="form-row">
            <label class="form-label" for="f-id">ID</label>
            <input class="form-input" id="f-id" type="text" placeholder="e.g. LOC-0042" />
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>Address</legend>
          <div class="form-row">
            <label class="form-label" for="f-address">Address</label>
            <input class="form-input" id="f-address" type="text" placeholder="Street address" />
          </div>
          <div class="form-row">
            <label class="form-label" for="f-address2">Address 2</label>
            <input class="form-input" id="f-address2" type="text" placeholder="Suite, floor, etc." />
          </div>
          <div class="form-row-group">
            <div class="form-row">
              <label class="form-label" for="f-city">City</label>
              <input class="form-input" id="f-city" type="text" />
            </div>
            <div class="form-row">
              <label class="form-label" for="f-state">State / Province</label>
              <input class="form-input" id="f-state" type="text" />
            </div>
            <div class="form-row">
              <label class="form-label" for="f-zip">ZIP / Postal Code</label>
              <input class="form-input" id="f-zip" type="text" />
            </div>
          </div>
          <div class="form-row-group">
            <div class="form-row">
              <label class="form-label" for="f-country">Country</label>
              <input class="form-input" id="f-country" type="text" placeholder="e.g. US" />
            </div>
            <div class="form-row">
              <label class="form-label" for="f-timezone">Time Zone</label>
              <select class="form-input" id="f-timezone">
                <option value="">— Select —</option>
                <option>America/New_York</option>
                <option>America/Chicago</option>
                <option>America/Denver</option>
                <option>America/Los_Angeles</option>
                <option>America/Anchorage</option>
                <option>Pacific/Honolulu</option>
                <option>America/Phoenix</option>
                <option>UTC</option>
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>Breaks</legend>
          <p class="form-hint">Default break settings for this location</p>
          <div class="form-row-group">
            <div class="form-row">
              <label class="form-label" for="f-break-length">Length (min)</label>
              <input class="form-input" id="f-break-length" type="number" min="0" placeholder="30" />
            </div>
            <div class="form-row">
              <label class="form-label" for="f-break-status">Status</label>
              <select class="form-input" id="f-break-status">
                <option value="">— Select —</option>
                <option>Active</option>
                <option>Inactive</option>
              </select>
            </div>
            <div class="form-row form-row-check">
              <label class="form-label">Paid</label>
              <input class="form-checkbox" id="f-break-paid" type="checkbox" />
            </div>
            <div class="form-row form-row-check">
              <label class="form-label">Mandatory</label>
              <input class="form-checkbox" id="f-break-mandatory" type="checkbox" />
            </div>
          </div>

          <div class="break-entries-header">
            <span class="form-hint" style="margin:0">Break types</span>
            <button type="button" class="btn-secondary btn-sm" id="add-break-btn">+ Add break type</button>
          </div>
          <div id="break-entries-list"></div>
        </fieldset>

        <fieldset class="form-section">
          <legend>Geofence (GPS)</legend>
          <div class="form-row form-row-inline" style="margin-bottom:14px">
            <input class="form-checkbox" id="f-geofence" type="checkbox" />
            <label class="form-label" for="f-geofence">Enable Mandatory GeoFence Clock In/Out</label>
          </div>
          <div id="geofence-map-wrap" class="geofence-map-wrap">
            <div id="geofence-map" class="geofence-map"></div>
            <div class="geofence-hint">
              Use the toolbar on the map to draw a polygon or circle boundary.
              Only the most recently drawn shape is saved.
            </div>
            <div id="geofence-preview" class="geofence-preview" hidden></div>
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>Security Information</legend>
          <div class="form-row">
            <label class="form-label" for="f-security">Security Information</label>
            <div class="rte-toolbar">
              <button type="button" data-cmd="bold"><b>B</b></button>
              <button type="button" data-cmd="italic"><i>I</i></button>
              <button type="button" data-cmd="underline"><u>U</u></button>
              <button type="button" data-cmd="insertUnorderedList">• List</button>
            </div>
            <div class="rte" id="f-security" contenteditable="true" role="textbox" aria-multiline="true"></div>
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>Cleaning Instructions</legend>
          <div class="form-row">
            <label class="form-label" for="f-lang">Instruction Language</label>
            <select class="form-input" id="f-lang">
              <option value="">— Select —</option>
              <option>English</option>
              <option>Spanish</option>
              <option>French</option>
              <option>Portuguese</option>
              <option>Somali</option>
              <option>Vietnamese</option>
              <option>Other</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label" for="f-cleaning">Cleaning Instructions</label>
            <div class="rte-toolbar">
              <button type="button" data-cmd="bold"><b>B</b></button>
              <button type="button" data-cmd="italic"><i>I</i></button>
              <button type="button" data-cmd="underline"><u>U</u></button>
              <button type="button" data-cmd="insertUnorderedList">• List</button>
              <button type="button" data-cmd="insertOrderedList"># List</button>
            </div>
            <div class="rte" id="f-cleaning" contenteditable="true" role="textbox" aria-multiline="true"></div>
          </div>
        </fieldset>

        <div id="form-error" class="form-error" hidden></div>
      </form>
    </div>
    <div class="drawer-footer">
      <button type="button" class="btn-ghost" id="cancel-site-btn">Cancel</button>
      <button type="button" class="btn-primary" id="save-site-btn">Save Site</button>
    </div>`;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  // Animate in
  requestAnimationFrame(() => {
    overlay.classList.add("open");
    drawer.classList.add("open");
  });

  document.getElementById("drawer-close-btn").addEventListener("click", closeDrawer);
  document.getElementById("cancel-site-btn").addEventListener("click", closeDrawer);
  document.getElementById("save-site-btn").addEventListener("click", handleSaveSite);

  // Initialize the Azure Maps geofence editor after the drawer has animated in
  setTimeout(initGeofenceMap, 300);

  // Rich text toolbar wiring
  drawer.querySelectorAll(".rte-toolbar button[data-cmd]").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      document.execCommand(btn.dataset.cmd, false, null);
    });
  });

  // Break entries
  document.getElementById("add-break-btn").addEventListener("click", addBreakEntryRow);
}

// ---- Azure Maps geofence ----
let _geofenceGeoJSON = null;
let _drawingManager = null;

async function initGeofenceMap() {
  const container = document.getElementById("geofence-map");
  if (!container || !window.atlas) return;

  let mapsKey;
  try {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = await res.json();
    mapsKey = cfg.azureMapsKey;
    if (!mapsKey) throw new Error("AZURE_MAPS_KEY is not configured in Azure app settings.");
  } catch (err) {
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center;color:var(--muted);font-size:13px">Map unavailable: ${escHtml(err.message)}</div>`;
    return;
  }

  // Try to centre on the user's current location; fall back to Seattle area
  const startPosition = await new Promise((resolve) => {
    if (!navigator.geolocation) return resolve([-122.2, 47.8]);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.longitude, pos.coords.latitude]),
      () => resolve([-122.2, 47.8]),
      { timeout: 5000 }
    );
  });

  const map = new atlas.Map("geofence-map", {
    center: startPosition,
    zoom: 15,
    language: "en-US",
    authOptions: {
      authType: "subscriptionKey",
      subscriptionKey: mapsKey,
    },
  });

  map.events.add("ready", () => {
    // Force a resize so tiles fill the container correctly
    map.resize();
    const drawingManager = new atlas.drawing.DrawingManager(map, {
      toolbar: new atlas.control.DrawingToolbar({
        buttons: ["draw-polygon", "draw-circle", "erase-geometry"],
        position: "top-right",
        style: "light",
      }),
    });
    _drawingManager = drawingManager;

    map.events.add("drawingcomplete", drawingManager, (shape) => {
      // Convert to GeoJSON and store
      const source = drawingManager.getSource();
      const features = source.toJson().features;

      // Only keep the most recently completed shape
      const geoJSON = {
        type: "FeatureCollection",
        features: features.map((f) => ({
          type: "Feature",
          geometry: f.geometry,
          properties: {},
        })),
      };

      _geofenceGeoJSON = geoJSON;

      const preview = document.getElementById("geofence-preview");
      if (preview) {
        const coords = features[0] && features[0].geometry && features[0].geometry.coordinates;
        const type = features[0] && features[0].geometry && features[0].geometry.type;
        preview.textContent = `Boundary saved: ${type || "shape"} with ${
          type === "Polygon" && coords ? coords[0].length - 1 + " vertices" :
          type === "Point" ? "circle center" : "coordinates"
        }`;
        preview.hidden = false;
      }
    });
  });
}

function closeDrawer() {
  const overlay = document.getElementById("site-drawer-overlay");
  const drawer = document.getElementById("site-drawer");
  if (!drawer) return;
  overlay.classList.remove("open");
  drawer.classList.remove("open");
  _geofenceGeoJSON = null;
  _drawingManager = null;
  setTimeout(() => {
    overlay && overlay.remove();
    drawer && drawer.remove();
  }, 280);
}

let _breakEntryCount = 0;

function addBreakEntryRow() {
  _breakEntryCount++;
  const id = _breakEntryCount;
  const list = document.getElementById("break-entries-list");
  const row = document.createElement("div");
  row.className = "break-entry-row";
  row.dataset.breakId = id;
  row.innerHTML = `
    <select class="form-input be-type" title="Type">
      <option value="">Type</option>
      <option>Meal</option>
      <option>Rest</option>
      <option>Other</option>
    </select>
    <input class="form-input be-length" type="number" min="0" placeholder="Min" title="Length (min)" />
    <select class="form-input be-status" title="Status">
      <option value="">Status</option>
      <option>Active</option>
      <option>Inactive</option>
    </select>
    <label class="be-check-label" title="Paid"><input type="checkbox" class="form-checkbox be-paid" /> Paid</label>
    <label class="be-check-label" title="Mandatory"><input type="checkbox" class="form-checkbox be-mandatory" /> Mand.</label>
    <button type="button" class="btn-ghost btn-sm be-remove" aria-label="Remove">✕</button>`;
  row.querySelector(".be-remove").addEventListener("click", () => row.remove());
  list.appendChild(row);
}

async function handleSaveSite() {
  const nameEl = document.getElementById("f-name");
  const errEl = document.getElementById("form-error");
  errEl.hidden = true;

  if (!nameEl.value.trim()) {
    nameEl.focus();
    errEl.textContent = "Location Name is required.";
    errEl.hidden = false;
    return;
  }

  const breakEntries = [...document.querySelectorAll(".break-entry-row")].map((row) => ({
    type: row.querySelector(".be-type").value,
    length: row.querySelector(".be-length").value,
    status: row.querySelector(".be-status").value,
    paid: row.querySelector(".be-paid").checked,
    mandatory: row.querySelector(".be-mandatory").checked,
  }));

  const payload = {
    name: nameEl.value.trim(),
    locationId: document.getElementById("f-id").value.trim(),
    address: document.getElementById("f-address").value.trim(),
    address2: document.getElementById("f-address2").value.trim(),
    city: document.getElementById("f-city").value.trim(),
    state: document.getElementById("f-state").value.trim(),
    zip: document.getElementById("f-zip").value.trim(),
    country: document.getElementById("f-country").value.trim(),
    timezone: document.getElementById("f-timezone").value,
    breakLength: document.getElementById("f-break-length").value,
    breakStatus: document.getElementById("f-break-status").value,
    breakPaid: document.getElementById("f-break-paid").checked,
    breakMandatory: document.getElementById("f-break-mandatory").checked,
    breakEntries,
    geofenceEnabled: document.getElementById("f-geofence").checked,
    geofenceBoundary: _geofenceGeoJSON ? JSON.stringify(_geofenceGeoJSON) : "",
    securityInfo: document.getElementById("f-security").innerHTML,
    instructionLanguage: document.getElementById("f-lang").value,
    cleaningInstructions: document.getElementById("f-cleaning").innerHTML,
  };

  const saveBtn = document.getElementById("save-site-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    const res = await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    // Add to cache and refresh list
    _sitesCache = null; // force re-fetch to get server-sorted list
    closeDrawer();
    renderSitesList();
  } catch (err) {
    errEl.textContent = `Save failed: ${err.message}`;
    errEl.hidden = false;
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Site";
  }
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
