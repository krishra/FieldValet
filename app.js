// FieldValet — navigation shell.
// Mirrors the wireframe structure. Page bodies are intentionally empty placeholders.

const NAV = [
  { id: "dashboard", label: "Dashboard", subtabs: [] },
  { id: "sales", label: "Sales", subtabs: [] },
  { id: "sites", label: "Sites", subtabs: ["Site info", "Security wall", "Work orders"] },
  { id: "chats", label: "Chats", subtabs: [] },
  { id: "scheduling", label: "Scheduling", subtabs: ["Calendar", "Time clock", "Coverage"] },
  { id: "people", label: "People", subtabs: ["Team", "Hiring"] },
];

const state = { tab: "dashboard", sub: 0 };

// ---- Auth ----
let currentUser = null;

// Single in-flight refresh promise — concurrent 401s share one refresh attempt
// instead of hammering the endpoint.
let _refreshPromise = null;

async function attemptRefresh() {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();
  return _refreshPromise;
}

// Fetch wrapper: on 401 try a silent token refresh before showing the login
// screen, so the 8-hour access token expiry is transparent while a valid
// 30-day refresh token exists.
async function apiFetch(url, opts) {
  const res = await fetch(url, Object.assign({ credentials: "same-origin" }, opts || {}));
  if (res.status === 401) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      currentUser = refreshed;
      const retry = await fetch(url, Object.assign({ credentials: "same-origin" }, opts || {}));
      if (retry.status !== 401) return retry;
    }
    forceLogout();
    throw new Error("Your session has expired. Please sign in again.");
  }
  return res;
}

async function fetchMe() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function renderProfilePill() {
  const pill = document.getElementById("profile-pill");
  if (!pill || !currentUser) return;
  document.getElementById("profile-avatar").textContent = initials(currentUser.fullName);
  document.getElementById("profile-name").textContent = currentUser.fullName;
  document.getElementById("profile-email").textContent = currentUser.email;
  pill.hidden = false;

  const menu = document.getElementById("profile-menu");
  pill.onclick = (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    pill.setAttribute("aria-expanded", String(open));
  };
  // Close the menu when clicking anywhere else.
  document.addEventListener("click", () => {
    if (!menu.hidden) {
      menu.hidden = true;
      pill.setAttribute("aria-expanded", "false");
    }
  });
  document.getElementById("logout-btn").onclick = handleLogout;
}

const EYE_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

// ---- Auth screen panel management ----
// All four panels share the #login-screen container.  Only one is visible
// at a time.  Wiring is done lazily on first showLogin() call.

const AUTH_PANELS = ["login-form", "forgot-panel", "forgot-sent-panel", "reset-panel"];
let _authWired = false;
let _resetToken = null; // set by boot() when /reset-password?token= is in URL

function showAuthPanel(id) {
  AUTH_PANELS.forEach((p) => {
    const el = document.getElementById(p);
    if (el) el.hidden = p !== id;
  });
}

function wireAuthScreens() {
  // Sign-in form
  document.getElementById("login-form").addEventListener("submit", handleLogin);
  const pwInput = document.getElementById("login-password");
  const pwToggle = document.getElementById("pw-toggle");
  pwToggle.innerHTML = EYE_OPEN;
  pwToggle.addEventListener("click", () => {
    const show = pwInput.type === "text";
    pwInput.type = show ? "password" : "text";
    pwToggle.innerHTML = show ? EYE_OPEN : EYE_OFF;
    pwToggle.setAttribute("aria-label", show ? "Show password" : "Hide password");
  });

  // Forgot password link
  document.getElementById("forgot-link").addEventListener("click", () => {
    document.getElementById("forgot-error").hidden = true;
    // Pre-fill with whatever the user typed into the sign-in email field.
    document.getElementById("forgot-email").value = document.getElementById("login-email").value;
    showAuthPanel("forgot-panel");
    document.getElementById("forgot-email").focus();
  });
  document.getElementById("forgot-back").addEventListener("click", () => {
    showAuthPanel("login-form");
    document.getElementById("login-email").focus();
  });
  document.getElementById("forgot-submit").addEventListener("click", handleForgotPassword);

  document.getElementById("forgot-sent-back").addEventListener("click", () => {
    showAuthPanel("login-form");
    document.getElementById("login-email").focus();
  });

  // Reset-password panel (password-toggle + submit)
  const resetPwInput = document.getElementById("reset-password-input");
  const resetPwToggle = document.getElementById("reset-pw-toggle");
  resetPwToggle.innerHTML = EYE_OPEN;
  resetPwToggle.addEventListener("click", () => {
    const show = resetPwInput.type === "text";
    resetPwInput.type = show ? "password" : "text";
    resetPwToggle.innerHTML = show ? EYE_OPEN : EYE_OFF;
    resetPwToggle.setAttribute("aria-label", show ? "Show password" : "Hide password");
  });
  document.getElementById("reset-submit").addEventListener("click", () => {
    if (_resetToken) handleResetPassword(_resetToken);
  });
}

function showLogin() {
  document.body.classList.add("pre-auth");
  document.getElementById("login-screen").hidden = false;
  showAuthPanel("login-form");

  if (!_authWired) {
    _authWired = true;
    wireAuthScreens();
  }

  // Re-mask the password field every time the screen is shown.
  const pwInput = document.getElementById("login-password");
  if (pwInput.type === "text") {
    pwInput.type = "password";
    document.getElementById("pw-toggle").innerHTML = EYE_OPEN;
    document.getElementById("pw-toggle").setAttribute("aria-label", "Show password");
  }
  document.getElementById("login-email").focus();
}

// ---- Forgot password ----
async function handleForgotPassword() {
  const email = document.getElementById("forgot-email").value.trim();
  const errEl = document.getElementById("forgot-error");
  const btn = document.getElementById("forgot-submit");
  errEl.hidden = true;

  if (!email) {
    errEl.textContent = "Please enter your email address.";
    errEl.hidden = false;
    return;
  }

  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errEl.textContent = data.error || "Something went wrong. Please try again.";
      errEl.hidden = false;
      return;
    }
    showAuthPanel("forgot-sent-panel");
  } catch (err) {
    errEl.textContent = "Network error. Please check your connection and try again.";
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Send reset link";
  }
}

// ---- Reset password ----
async function handleResetPassword(token) {
  const newPassword = document.getElementById("reset-password-input").value;
  const confirm = document.getElementById("reset-confirm-input").value;
  const errEl = document.getElementById("reset-error");
  const btn = document.getElementById("reset-submit");
  errEl.hidden = true;

  if (newPassword.length < 8) {
    errEl.textContent = "Password must be at least 8 characters.";
    errEl.hidden = false;
    return;
  }
  if (newPassword !== confirm) {
    errEl.textContent = "Passwords do not match.";
    errEl.hidden = false;
    return;
  }

  btn.disabled = true;
  btn.textContent = "Setting password…";
  try {
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errEl.textContent = data.error || "Something went wrong. Please try again.";
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = "Set new password";
      return;
    }
    // Auto-login: clean up the URL and enter the app.
    currentUser = data;
    history.replaceState({}, "", "/");
    showApp();
    renderProfilePill();
    parseHash();
    render();
  } catch (err) {
    errEl.textContent = "Network error. Please check your connection and try again.";
    errEl.hidden = false;
    btn.disabled = false;
    btn.textContent = "Set new password";
  }
}

function showApp() {
  document.body.classList.remove("pre-auth");
  document.getElementById("login-screen").hidden = true;
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  const btn = document.getElementById("login-submit");
  errEl.hidden = true;

  if (!email || !password) {
    errEl.textContent = "Enter your email and password.";
    errEl.hidden = false;
    return;
  }

  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error("Invalid username or password.");
    if (res.status >= 500) throw new Error("System is not available. Please try again later.");
    if (!res.ok) throw new Error(data.error || `Sign-in failed (HTTP ${res.status}).`);

    currentUser = data;
    document.getElementById("login-password").value = "";
    showApp();
    renderProfilePill();
    parseHash();
    render();
  } catch (err) {
    errEl.textContent = err.name === "TypeError"
      ? "System is not available. Please try again later."
      : err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
}

async function handleLogout() {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch (e) {
    /* ignore — clear client state regardless */
  }
  forceLogout();
}

// Reset to the signed-out state (used on logout and on any 401 from the API).
function forceLogout() {
  currentUser = null;
  _sitesCache = null;
  _refreshPromise = null;
  const pill = document.getElementById("profile-pill");
  if (pill) pill.hidden = true;
  showLogin();
}

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

  // Remove dashboard-specific layout override when navigating away.
  document.getElementById("view").classList.remove("dashboard-view");

  // Close any live chat connection when navigating away from the Chats tab.
  if (tab.id !== "chats" && typeof teardownChats === "function") teardownChats();
  const title = tab.label;
  const where = sub ? `${tab.label} › ${sub}` : tab.label;

  if (tab.id === "dashboard") {
    renderDashboard();
    return;
  }

  if (tab.id === "sites" && sub === "Site info") {
    renderSitesList();
    return;
  }

  if (tab.id === "sales") {
    renderBidCalculator();
    return;
  }

  if (tab.id === "sites" && sub === "Work orders") {
    renderWorkOrdersList();
    return;
  }

  if (tab.id === "people" && sub === "Team") {
    renderTeamList();
    return;
  }

  if (tab.id === "chats" && typeof renderChats === "function") {
    renderChats();
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

// ---- Dashboard map ----
async function renderDashboard() {
  const view = document.getElementById("view");
  view.classList.add("dashboard-view");
  view.innerHTML = `<div id="dashboard-map-card"><div id="dashboard-map"></div><div id="dashboard-spinner"><div class="map-spinner-ring"></div></div></div>`;

  if (!window.atlas) {
    view.classList.remove("dashboard-view");
    view.innerHTML = `<div class="placeholder"><strong>Map unavailable</strong>Azure Maps SDK failed to load.</div>`;
    return;
  }

  let mapsKey, locations;
  try {
    const [cfgRes, locsRes] = await Promise.all([
      apiFetch("/api/config"),
      apiFetch("/api/locations"),
    ]);
    if (!cfgRes.ok) throw new Error(`Config: HTTP ${cfgRes.status}`);
    if (!locsRes.ok) throw new Error(`Locations: HTTP ${locsRes.status}`);
    const cfg = await cfgRes.json();
    const locsData = await locsRes.json();
    mapsKey = cfg.azureMapsKey;
    locations = locsData.locations || [];
  } catch (err) {
    view.classList.remove("dashboard-view");
    view.innerHTML = `<div class="placeholder"><strong>Dashboard unavailable</strong>${escHtml(err.message)}</div>`;
    return;
  }

  if (!mapsKey) {
    view.classList.remove("dashboard-view");
    view.innerHTML = `<div class="placeholder"><strong>Map unavailable</strong>AZURE_MAPS_KEY is not configured in Azure app settings.</div>`;
    return;
  }

  const map = new atlas.Map("dashboard-map", {
    center: [-122.2, 47.5],
    zoom: 9,
    language: "en-US",
    authOptions: { authType: "subscriptionKey", subscriptionKey: mapsKey },
  });

  map.events.add("ready", async () => {
    document.getElementById("dashboard-spinner")?.remove();
    map.resize();

    const datasource = new atlas.source.DataSource();
    map.sources.add(datasource);

    const symbolLayer = new atlas.layer.SymbolLayer(datasource, null, {
      iconOptions: { image: "marker-blue", anchor: "bottom", allowOverlap: true },
    });
    map.layers.add(symbolLayer);

    // Load geocode cache from sessionStorage (fallback for legacy sites without stored coords)
    const CACHE_KEY = "fv-geocache-v1";
    let geocodeCache = {};
    try { geocodeCache = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}"); } catch {}

    const features = [];
    let cacheUpdated = false;
    await Promise.all(
      locations.map(async (loc) => {
        // Prefer coordinates stored at creation time — no API call needed.
        if (loc.lat != null && loc.lng != null) {
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [loc.lng, loc.lat] },
            properties: { name: loc.name, address: loc.address },
          });
          return;
        }

        // Legacy sites without stored coords: fall back to client-side geocoding.
        if (!loc.address) return;
        let coords = geocodeCache[loc.address];
        if (!coords) {
          try {
            const r = await fetch(
              `https://atlas.microsoft.com/search/address/json?api-version=1.0` +
                `&query=${encodeURIComponent(loc.address)}` +
                `&subscription-key=${encodeURIComponent(mapsKey)}` +
                `&limit=1`
            );
            const data = await r.json();
            const pos = data.results?.[0]?.position;
            if (pos) { coords = [pos.lon, pos.lat]; cacheUpdated = true; }
          } catch {}
        }
        if (coords) {
          geocodeCache[loc.address] = coords;
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: coords },
            properties: { name: loc.name, address: loc.address },
          });
        }
      })
    );

    if (cacheUpdated) {
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(geocodeCache)); } catch {}
    }

    datasource.add(features);

    if (features.length > 0) {
      const lons = features.map((f) => f.geometry.coordinates[0]);
      const lats = features.map((f) => f.geometry.coordinates[1]);
      map.setCamera({
        bounds: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
        padding: 60,
      });
    }

    const popup = new atlas.Popup({ closeButton: true, pixelOffset: [0, -20] });
    map.events.add("click", symbolLayer, (e) => {
      if (!e.shapes?.[0]) return;
      const props = e.shapes[0].getProperties();
      popup.setOptions({
        content:
          `<div style="padding:10px 13px;max-width:220px;font-family:inherit">` +
          `<strong style="font-size:13px;display:block">${escHtml(props.name)}</strong>` +
          `<span style="font-size:12px;color:#666">${escHtml(props.address)}</span>` +
          `</div>`,
        position: e.shapes[0].getCoordinates(),
      });
      popup.open(map);
    });

    map.events.add("mouseover", symbolLayer, () => {
      map.getCanvasContainer().style.cursor = "pointer";
    });
    map.events.add("mouseout", symbolLayer, () => {
      map.getCanvasContainer().style.cursor = "";
    });
  });
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
      const res = await apiFetch("/api/locations");
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

  // Build city options from data
  const cities = [...new Set(_sitesCache.map(s => s.city).filter(Boolean))].sort();
  const cityOptions = `<option value="">All cities</option>` + cities.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join("");

  view.innerHTML = `
    <h1 class="page-title">Sites</h1>
    <p class="page-sub">Sites › Site info</p>
    <div class="sites-toolbar">
      <input id="sites-search" class="sites-search" type="search" placeholder="Search by name or address…" />
      <select id="sites-city-filter" class="sites-filter-select">
        ${cityOptions}
      </select>
      <span id="sites-count" class="sites-count"></span>
      <button class="btn-primary" id="new-site-btn">+ New Site</button>
    </div>
    <table class="sites-table">
      <thead>
        <tr>
          <th class="sortable" data-col="name">Name <span class="sort-icon" id="sort-name">↕</span></th>
          <th class="sortable" data-col="address">Address <span class="sort-icon" id="sort-address">↕</span></th>
          <th>City</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody id="sites-tbody"></tbody>
    </table>`;

  let sortCol = "name";
  let sortDir = 1; // 1 = asc, -1 = desc

  function getFiltered() {
    const q = (document.getElementById("sites-search").value || "").toLowerCase().trim();
    const city = (document.getElementById("sites-city-filter").value || "").toLowerCase();
    return _sitesCache.filter(s => {
      const matchQ = !q || s.name.toLowerCase().includes(q) || (s.address || "").toLowerCase().includes(q);
      const matchCity = !city || (s.city || "").toLowerCase() === city;
      return matchQ && matchCity;
    });
  }

  function getSorted(sites) {
    return [...sites].sort((a, b) => {
      const av = (a[sortCol] || "").toLowerCase();
      const bv = (b[sortCol] || "").toLowerCase();
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });
  }

  function updateSortIcons() {
    ["name", "address"].forEach(col => {
      const el = document.getElementById(`sort-${col}`);
      if (!el) return;
      el.textContent = col === sortCol ? (sortDir === 1 ? "↑" : "↓") : "↕";
    });
  }

  function paintRows(sites) {
    const tbody = document.getElementById("sites-tbody");
    const count = document.getElementById("sites-count");
    if (!tbody) return;
    count.textContent = `${sites.length} site${sites.length !== 1 ? "s" : ""}`;
    if (sites.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="sites-empty">No sites match your search.</td></tr>`;
      return;
    }
    tbody.innerHTML = sites
      .map(s => `<tr>
        <td class="site-name">${escHtml(s.name)}</td>
        <td class="site-address">${escHtml(s.address || "")}</td>
        <td>${escHtml(s.city || "")}</td>
        <td>${escHtml(s.state || "")}</td>
      </tr>`)
      .join("");
  }

  function refresh() {
    updateSortIcons();
    paintRows(getSorted(getFiltered()));
  }

  refresh();

  document.getElementById("sites-search").addEventListener("input", refresh);
  document.getElementById("sites-city-filter").addEventListener("change", refresh);

  document.querySelectorAll(".sites-table th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir *= -1;
      } else {
        sortCol = col;
        sortDir = 1;
      }
      refresh();
    });
  });

  document.getElementById("new-site-btn").addEventListener("click", () => openNewSiteDrawer());
}

// ---- Bid calculator (placeholder pricing, pending the real Excel-based one) ----
const BID_SERVICE_TYPES = [
  { key: "dailyJanitorial", label: "Daily Janitorial" },
  { key: "floorCare", label: "Floor Care" },
  { key: "windowCleaning", label: "Window Cleaning" },
  { key: "restroomService", label: "Restroom Service" },
];

function renderBidCalculator() {
  const view = document.getElementById("view");
  view.innerHTML = `
    <h1 class="page-title">Sales</h1>
    <p class="page-sub">Bid Calculator</p>
    <div class="placeholder" style="margin-bottom:16px">
      <strong>Placeholder pricing</strong>
      Using a rule-based stand-in until the real bid calculator is available. Numbers are directional only.
    </div>
    <form id="bid-calc-form" novalidate>
      <fieldset class="form-section">
        <legend>Job details</legend>
        <div class="form-row">
          <label class="form-label required" for="bc-sqft">Square Footage</label>
          <input class="form-input" id="bc-sqft" type="number" min="1" placeholder="e.g. 12000" required />
        </div>
        <div class="form-row">
          <label class="form-label" for="bc-frequency">Frequency</label>
          <select class="form-input" id="bc-frequency">
            <option value="monthly">Monthly</option>
            <option value="biweekly">Biweekly</option>
            <option value="weekly">Weekly</option>
            <option value="daily">Daily</option>
          </select>
        </div>
        <div class="form-row">
          <label class="form-label required">Service Types</label>
          ${BID_SERVICE_TYPES.map(
            (s) => `
            <label class="be-check-label" style="display:block;margin:4px 0">
              <input type="checkbox" class="form-checkbox bc-service" value="${s.key}" /> ${s.label}
            </label>`
          ).join("")}
        </div>
        <div id="bc-error" class="form-error" hidden></div>
        <button type="submit" class="btn-primary" id="bc-submit">Calculate Bid</button>
      </fieldset>
    </form>
    <div id="bc-results"></div>`;

  document.getElementById("bid-calc-form").addEventListener("submit", handleCalculateBid);
}

async function handleCalculateBid(e) {
  e.preventDefault();
  const errEl = document.getElementById("bc-error");
  const resultsEl = document.getElementById("bc-results");
  errEl.hidden = true;
  resultsEl.innerHTML = "";

  const squareFootage = Number(document.getElementById("bc-sqft").value);
  const frequency = document.getElementById("bc-frequency").value;
  const serviceTypes = [...document.querySelectorAll(".bc-service:checked")].map((el) => el.value);

  if (!squareFootage || squareFootage <= 0) {
    errEl.textContent = "Enter a square footage greater than 0.";
    errEl.hidden = false;
    return;
  }
  if (serviceTypes.length === 0) {
    errEl.textContent = "Select at least one service type.";
    errEl.hidden = false;
    return;
  }

  const btn = document.getElementById("bc-submit");
  btn.disabled = true;
  btn.textContent = "Calculating…";

  try {
    const res = await apiFetch("/api/bids/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ squareFootage, frequency, serviceTypes }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    resultsEl.innerHTML = `
      <table class="sites-table">
        <thead><tr><th>Service</th><th>Qty/mo</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>
          ${data.lineItems
            .map(
              (li) => `<tr>
                <td>${escHtml(li.description)}</td>
                <td>${li.qty}</td>
                <td>$${li.rate.toFixed(3)}/sq ft</td>
                <td>$${li.amount.toFixed(2)}</td>
              </tr>`
            )
            .join("")}
        </tbody>
        <tfoot><tr><td colspan="3" style="text-align:right"><strong>Total</strong></td><td><strong>$${data.total.toFixed(
          2
        )}</strong></td></tr></tfoot>
      </table>`;
  } catch (err) {
    errEl.textContent = `Calculation failed: ${err.message}`;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Calculate Bid";
  }
}

// ---- Work orders ----
let _workOrdersCache = null;

async function renderWorkOrdersList() {
  const view = document.getElementById("view");
  view.innerHTML = `
    <h1 class="page-title">Sites</h1>
    <p class="page-sub">Sites › Work orders</p>
    <div class="wo-loading">Loading work orders…</div>`;

  try {
    const res = await apiFetch("/api/workorders");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _workOrdersCache = data.workOrders || [];
  } catch (err) {
    view.innerHTML = `
      <h1 class="page-title">Sites</h1>
      <p class="page-sub">Sites › Work orders</p>
      <div class="placeholder"><strong>Could not load work orders</strong>${err.message}</div>`;
    return;
  }

  view.innerHTML = `
    <h1 class="page-title">Sites</h1>
    <p class="page-sub">Sites › Work orders</p>
    <div class="sites-toolbar">
      <span id="wo-count" class="sites-count">${_workOrdersCache.length} work order${_workOrdersCache.length !== 1 ? "s" : ""}</span>
      <button class="btn-primary" id="new-wo-btn">+ New Work Order</button>
    </div>
    <table class="sites-table">
      <thead><tr><th>Customer</th><th>Location</th><th>Total</th><th>Status</th><th>QBO Estimate</th><th>QBO Invoice</th><th></th></tr></thead>
      <tbody id="wo-tbody"></tbody>
    </table>`;

  paintWorkOrderRows();
  document.getElementById("new-wo-btn").addEventListener("click", () => openNewWorkOrderDrawer());
}

const WO_STATUS_LABELS = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  invoiced: "Invoiced",
  paid: "Paid",
};

function paintWorkOrderRows() {
  const tbody = document.getElementById("wo-tbody");
  if (!tbody) return;
  if (_workOrdersCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="sites-empty">No work orders yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = _workOrdersCache
    .map((wo) => {
      let action = "";
      if (wo.status === "draft") {
        action = `<button class="btn-secondary btn-sm wo-submit-btn" data-id="${escHtml(wo.workOrderId)}">Submit to QuickBooks</button>`;
      } else if (wo.status === "submitted" || wo.status === "approved") {
        action = `<button class="btn-secondary btn-sm wo-invoice-btn" data-id="${escHtml(wo.workOrderId)}">Create Invoice</button>`;
      }
      return `<tr>
        <td>${escHtml(wo.customerName)}</td>
        <td>${escHtml(wo.locationName || "")}</td>
        <td>$${Number(wo.total).toFixed(2)}</td>
        <td>${WO_STATUS_LABELS[wo.status] || wo.status}</td>
        <td>${wo.qboEstimateId ? escHtml(wo.qboEstimateId) : "—"}</td>
        <td>${wo.qboInvoiceId ? escHtml(wo.qboInvoiceId) : "—"}</td>
        <td>${action}</td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".wo-submit-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleSubmitWorkOrder(btn.dataset.id, btn));
  });
  tbody.querySelectorAll(".wo-invoice-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleCreateInvoice(btn.dataset.id, btn));
  });
}

async function handleSubmitWorkOrder(workOrderId, btn) {
  btn.disabled = true;
  btn.textContent = "Submitting…";
  try {
    const res = await apiFetch(`/api/workorders/${encodeURIComponent(workOrderId)}/submit`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const wo = _workOrdersCache.find((w) => w.workOrderId === workOrderId);
    if (wo) {
      wo.status = "submitted";
      wo.qboCustomerId = data.qboCustomerId;
      wo.qboEstimateId = data.qboEstimateId;
    }
    paintWorkOrderRows();
  } catch (err) {
    alert(`Submit failed: ${err.message}`);
    btn.disabled = false;
    btn.textContent = "Submit to QuickBooks";
  }
}

async function handleCreateInvoice(workOrderId, btn) {
  btn.disabled = true;
  btn.textContent = "Creating…";
  try {
    const res = await apiFetch(`/api/workorders/${encodeURIComponent(workOrderId)}/invoice`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const wo = _workOrdersCache.find((w) => w.workOrderId === workOrderId);
    if (wo) {
      wo.status = "invoiced";
      wo.qboInvoiceId = data.qboInvoiceId;
    }
    paintWorkOrderRows();
  } catch (err) {
    alert(`Create Invoice failed: ${err.message}`);
    btn.disabled = false;
    btn.textContent = "Create Invoice";
  }
}

async function openNewWorkOrderDrawer() {
  if (document.getElementById("wo-drawer")) return;

  if (!_sitesCache) {
    try {
      const res = await apiFetch("/api/locations");
      if (res.ok) _sitesCache = (await res.json()).locations || [];
    } catch (e) {
      _sitesCache = _sitesCache || [];
    }
  }

  const overlay = document.createElement("div");
  overlay.id = "wo-drawer-overlay";
  overlay.className = "drawer-overlay";
  overlay.addEventListener("click", closeWorkOrderDrawer);

  const drawer = document.createElement("div");
  drawer.id = "wo-drawer";
  drawer.className = "drawer";
  const locationOptions = (_sitesCache || []).map((s) => `<option>${escHtml(s.name)}</option>`).join("");
  drawer.innerHTML = `
    <div class="drawer-header">
      <h2 class="drawer-title">New Work Order</h2>
      <button class="drawer-close" id="wo-drawer-close-btn" aria-label="Close">✕</button>
    </div>
    <div class="drawer-body">
      <form id="new-wo-form" novalidate>
        <fieldset class="form-section">
          <legend>Customer</legend>
          <div class="form-row">
            <label class="form-label required" for="wo-customer-name">Customer Name</label>
            <input class="form-input" id="wo-customer-name" type="text" required />
          </div>
          <div class="form-row">
            <label class="form-label" for="wo-customer-email">Customer Email</label>
            <input class="form-input" id="wo-customer-email" type="email" placeholder="for the QBO estimate" />
          </div>
          <div class="form-row">
            <label class="form-label" for="wo-location">Location</label>
            <select class="form-input" id="wo-location">
              <option value="">— Select —</option>
              ${locationOptions}
            </select>
          </div>
        </fieldset>
        <fieldset class="form-section">
          <legend>Job details</legend>
          <div class="form-row">
            <label class="form-label required" for="wo-sqft">Square Footage</label>
            <input class="form-input" id="wo-sqft" type="number" min="1" required />
          </div>
          <div class="form-row">
            <label class="form-label" for="wo-frequency">Frequency</label>
            <select class="form-input" id="wo-frequency">
              <option value="monthly">Monthly</option>
              <option value="biweekly">Biweekly</option>
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label required">Service Types</label>
            ${BID_SERVICE_TYPES.map(
              (s) => `
              <label class="be-check-label" style="display:block;margin:4px 0">
                <input type="checkbox" class="form-checkbox wo-service" value="${s.key}" /> ${s.label}
              </label>`
            ).join("")}
          </div>
        </fieldset>
        <div id="wo-form-error" class="form-error" hidden></div>
      </form>
    </div>
    <div class="drawer-footer">
      <button type="button" class="btn-ghost" id="wo-cancel-btn">Cancel</button>
      <button type="button" class="btn-primary" id="wo-save-btn">Save Draft</button>
    </div>`;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);
  requestAnimationFrame(() => {
    overlay.classList.add("open");
    drawer.classList.add("open");
  });

  document.getElementById("wo-drawer-close-btn").addEventListener("click", closeWorkOrderDrawer);
  document.getElementById("wo-cancel-btn").addEventListener("click", closeWorkOrderDrawer);
  document.getElementById("wo-save-btn").addEventListener("click", handleSaveWorkOrder);
}

function closeWorkOrderDrawer() {
  const overlay = document.getElementById("wo-drawer-overlay");
  const drawer = document.getElementById("wo-drawer");
  if (!drawer) return;
  overlay.classList.remove("open");
  drawer.classList.remove("open");
  setTimeout(() => {
    overlay && overlay.remove();
    drawer && drawer.remove();
  }, 280);
}

async function handleSaveWorkOrder() {
  const errEl = document.getElementById("wo-form-error");
  errEl.hidden = true;

  const customerName = document.getElementById("wo-customer-name").value.trim();
  const customerEmail = document.getElementById("wo-customer-email").value.trim();
  const locationName = document.getElementById("wo-location").value;
  const squareFootage = Number(document.getElementById("wo-sqft").value);
  const frequency = document.getElementById("wo-frequency").value;
  const serviceTypes = [...document.querySelectorAll(".wo-service:checked")].map((el) => el.value);

  if (!customerName) {
    errEl.textContent = "Customer Name is required.";
    errEl.hidden = false;
    return;
  }
  if (!squareFootage || squareFootage <= 0) {
    errEl.textContent = "Enter a square footage greater than 0.";
    errEl.hidden = false;
    return;
  }
  if (serviceTypes.length === 0) {
    errEl.textContent = "Select at least one service type.";
    errEl.hidden = false;
    return;
  }

  const saveBtn = document.getElementById("wo-save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    const res = await apiFetch("/api/workorders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerName, customerEmail, locationName, squareFootage, frequency, serviceTypes }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    closeWorkOrderDrawer();
    renderWorkOrdersList();
  } catch (err) {
    errEl.textContent = `Save failed: ${err.message}`;
    errEl.hidden = false;
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Draft";
  }
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
    const res = await apiFetch("/api/config");
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
    const res = await apiFetch("/api/locations", {
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

// ---- People / Team ----

const TEAM_MEMBERS = [
  { name: "Abril Garcia Valentin", jobTitle: "Cleaner" },
  { name: "Aida A. Vasquez", jobTitle: "Cleaner" },
  { name: "Alejandro Garcia Perez", jobTitle: "Cleaner" },
  { name: "Alex Reny Herrera", jobTitle: "Cleaner" },
  { name: "Alfredo Rojas JR", jobTitle: "Cleaner" },
  { name: "Alfredo Acevedo", jobTitle: "Cleaner" },
  { name: "Alfredo Hornelas", jobTitle: "Supervisor" },
  { name: "Alison A. Quintanilla Ramirez", jobTitle: "Cleaner" },
  { name: "All Clean", jobTitle: "Cleaner" },
  { name: "All Clean - Kent", jobTitle: "Cleaner" },
  { name: "Amanda Medina Chávez", jobTitle: "Cleaner" },
  { name: "Ana Carolina Sorto Barahona", jobTitle: "Cleaner" },
  { name: "Ana K. Texoptitlan", jobTitle: "Cleaner" },
  { name: "Angela Lemus Tax", jobTitle: "Cleaner" },
  { name: "Angelina Villa", jobTitle: "Cleaner" },
  { name: "Antonio Cruz", jobTitle: "Supervisor" },
  { name: "April Stutzke", jobTitle: "Cleaner" },
  { name: "Atest Kay", jobTitle: "Cleaner" },
  { name: "Aurora Esquivel Jaime", jobTitle: "Cleaner" },
  { name: "Brenda Mendez Zurita", jobTitle: "Cleaner" },
  { name: "Brenda Veliz Barrera", jobTitle: "Cleaner" },
  { name: "Camila Miller", jobTitle: "Cleaner" },
  { name: "Carlos E. Lopez Sanchez", jobTitle: "Cleaner" },
  { name: "Carlos J. Caprio Trejo", jobTitle: "Cleaner" },
  { name: "Carmen L Martinez Cortes", jobTitle: "Cleaner" },
  { name: "Cecilia Ramírez Salazar", jobTitle: "Cleaner" },
  { name: "Cesar David Oseguera Morales", jobTitle: "Cleaner" },
  { name: "Chris Birkholz", jobTitle: "Cleaner" },
  { name: "Christal Clear Cleaning", jobTitle: "Cleaner" },
  { name: "Diana L Guerra Martinez", jobTitle: "Cleaner" },
  { name: "Diego Armando Torres Tapia", jobTitle: "Cleaner" },
  { name: "Dust n Shine", jobTitle: "Cleaner" },
  { name: "Edgar Y López Mejía", jobTitle: "Cleaner" },
  { name: "Edras Emanuel Mejia Sanchez", jobTitle: "Cleaner" },
  { name: "Elizabeth Lucas Ramos", jobTitle: "Cleaner" },
  { name: "Elizabeth Montalvan", jobTitle: "Supervisor" },
  { name: "Elmer A Castillo Siguenza", jobTitle: "Cleaner" },
  { name: "Elsy Noemi Orellana", jobTitle: "Cleaner" },
  { name: "Elvia Cruz Santiago", jobTitle: "Cleaner" },
  { name: "Elzey Andrews", jobTitle: "Cleaner" },
  { name: "Erik Andersson", jobTitle: "Supervisor" },
  { name: "Erik Vielma", jobTitle: "Cleaner" },
  { name: "Ernesmely L. Monges Garcia", jobTitle: "Cleaner" },
  { name: "Esperanza Suarez Montero", jobTitle: "Cleaner" },
  { name: "Estefania Cantor Hernandez", jobTitle: "Cleaner" },
  { name: "Excelsior Cleaning", jobTitle: "Cleaner" },
  { name: "Ezequiel Sique Aaguilar", jobTitle: "Cleaner" },
  { name: "Felicita Rossana Perez-Mendoza", jobTitle: "Cleaner" },
  { name: "Felipa Ambriz Alvarez", jobTitle: "Cleaner" },
  { name: "Floriseli Ruiz Romero", jobTitle: "Cleaner" },
  { name: "Hilda T. Martinez-Perez", jobTitle: "Cleaner" },
  { name: "Imelda Gonzalez", jobTitle: "Cleaner" },
  { name: "iPro Building Services", jobTitle: "Cleaner" },
  { name: "Irish Barlaan", jobTitle: "Supervisor" },
  { name: "Isaac Alba", jobTitle: "Cleaner" },
  { name: "Jackie Lopez Flores", jobTitle: "Cleaner" },
  { name: "Jenny SL", jobTitle: "Cleaner" },
  { name: "Joan Corona Pineda", jobTitle: "Cleaner" },
  { name: "Joanna Pérez", jobTitle: "Cleaner" },
  { name: "Jose C Lopez Hidalgo", jobTitle: "Cleaner" },
  { name: "Jose I. Reyes Coreas", jobTitle: "Cleaner" },
  { name: "Jovanny Balbuena Guerreo", jobTitle: "Cleaner" },
  { name: "Jovany Medina", jobTitle: "Cleaner" },
  { name: "Juan Carlos Huerta Medina", jobTitle: "Cleaner" },
  { name: "Juana R. Alanis", jobTitle: "Cleaner" },
  { name: "Karla Santos Najarro", jobTitle: "Cleaner" },
  { name: "Katy Y Pineda Jimenez", jobTitle: "Cleaner" },
  { name: "Layla Rojas", jobTitle: "Cleaner" },
  { name: "Leslie Gonzalez", jobTitle: "Cleaner" },
  { name: "Lipsa M Martinez Cortes", jobTitle: "Cleaner" },
  { name: "Lizeth Mayely Flores Quiroz", jobTitle: "Cleaner" },
  { name: "Lucia Saenz", jobTitle: "Cleaner" },
  { name: "Luis Fuentes Vazquez", jobTitle: "Supervisor" },
  { name: "Magdalena Euceda Aguiluz", jobTitle: "Cleaner" },
  { name: "Marbelly Rodriguez", jobTitle: "Cleaner" },
  { name: "María G Meraz Valdominos", jobTitle: "Cleaner" },
  { name: "Maria Irma Torres-Salcedo", jobTitle: "Cleaner" },
  { name: "Maria V. Soto Ruiz", jobTitle: "Cleaner" },
  { name: "Maribel Ibarra Trejo", jobTitle: "Cleaner" },
  { name: "Maribel H. Zapatero", jobTitle: "Cleaner" },
  { name: "Maricela Nieto", jobTitle: "Supervisor" },
  { name: "Mario Duarte Valdo", jobTitle: "Cleaner" },
  { name: "Maurilia Olvera", jobTitle: "Cleaner" },
  { name: "MD Janitorial", jobTitle: "Cleaner" },
  { name: "Merlia Lopez Barragan", jobTitle: "Cleaner" },
  { name: "Mirna Martinez Jimenez", jobTitle: "Cleaner" },
  { name: "MJ Cleaning", jobTitle: "Cleaner" },
  { name: "Nancy Cabrera Capulin", jobTitle: "Cleaner" },
  { name: "Nancy Oviedo", jobTitle: "Supervisor" },
  { name: "Noe Lopez Camacho", jobTitle: "Cleaner" },
  { name: "Noemi Mendoza Gonzalez", jobTitle: "Cleaner" },
  { name: "Olga Menes Serna", jobTitle: "Cleaner" },
  { name: "Osvaldo Margarito", jobTitle: "Cleaner" },
  { name: "Patricia Canales Canada", jobTitle: "Cleaner" },
  { name: "Rocio Garcia Tenorio", jobTitle: "Cleaner" },
  { name: "Ronaldo A Huerta Medina", jobTitle: "Cleaner" },
  { name: "Saidy G Medina", jobTitle: "Cleaner" },
  { name: "Samuel Diaz Ruiz", jobTitle: "Cleaner" },
  { name: "Sharon Arellano Alvarez", jobTitle: "Cleaner" },
  { name: "Sherlyn A. Bautista Leyva", jobTitle: "Cleaner" },
  { name: "Stephanie Ramirez", jobTitle: "Cleaner" },
  { name: "Steven Kearney", jobTitle: "Cleaner" },
  { name: "Steven Ramos", jobTitle: "Cleaner" },
  { name: "Test Test", jobTitle: "Cleaner" },
  { name: "Test - Kevin", jobTitle: "Supervisor" },
  { name: "Test - Krishnan", jobTitle: "Supervisor" },
  { name: "Test - Lily", jobTitle: "Supervisor" },
  { name: "Veronica A. Angueta", jobTitle: "Cleaner" },
  { name: "Vianey Alvarado Martinez", jobTitle: "Cleaner" },
  { name: "Vidal Urzua Chavez", jobTitle: "Cleaner" },
  { name: "Yeraldin Y Romero Dávila", jobTitle: "Cleaner" },
  { name: "Yesica Mánriquez Garcia", jobTitle: "Supervisor" },
];

function renderTeamList() {
  const view = document.getElementById("view");

  const roles = [...new Set(TEAM_MEMBERS.map(m => m.jobTitle).filter(Boolean))].sort();
  const roleOptions = `<option value="">All roles</option>` + roles.map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join("");

  view.innerHTML = `
    <h1 class="page-title">People</h1>
    <p class="page-sub">People › Team</p>
    <div class="sites-toolbar">
      <input id="team-search" class="sites-search" type="search" placeholder="Search by name or role…" />
      <select id="team-role-filter" class="sites-filter-select">${roleOptions}</select>
      <span id="team-count" class="sites-count"></span>
      <button class="btn-primary" id="new-member-btn">+ New Team Member</button>
    </div>
    <table class="sites-table">
      <thead>
        <tr>
          <th class="sortable" data-col="name">Name <span class="sort-icon" id="tsort-name">↕</span></th>
          <th class="sortable" data-col="jobTitle">Role <span class="sort-icon" id="tsort-jobTitle">↑</span></th>
        </tr>
      </thead>
      <tbody id="team-tbody"></tbody>
    </table>`;

  let sortCol = "jobTitle";
  let sortDir = 1;

  function getFiltered() {
    const q = (document.getElementById("team-search").value || "").toLowerCase().trim();
    const role = (document.getElementById("team-role-filter").value || "").toLowerCase();
    return TEAM_MEMBERS.filter(m => {
      const matchQ = !q || m.name.toLowerCase().includes(q) || m.jobTitle.toLowerCase().includes(q);
      const matchRole = !role || m.jobTitle.toLowerCase() === role;
      return matchQ && matchRole;
    });
  }

  function getSorted(members) {
    return [...members].sort((a, b) => {
      const av = (a[sortCol] || "").toLowerCase();
      const bv = (b[sortCol] || "").toLowerCase();
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });
  }

  function updateSortIcons() {
    ["name", "jobTitle"].forEach(col => {
      const el = document.getElementById(`tsort-${col}`);
      if (!el) return;
      el.textContent = col === sortCol ? (sortDir === 1 ? "↑" : "↓") : "↕";
    });
  }

  function paintTeamRows(members) {
    const tbody = document.getElementById("team-tbody");
    const count = document.getElementById("team-count");
    if (!tbody) return;
    count.textContent = `${members.length} member${members.length !== 1 ? "s" : ""}`;
    if (members.length === 0) {
      tbody.innerHTML = `<tr><td colspan="2" class="sites-empty">No members match your search.</td></tr>`;
      return;
    }
    tbody.innerHTML = members
      .map(m => `<tr>
        <td class="site-name">${escHtml(m.name)}</td>
        <td>${escHtml(m.jobTitle)}</td>
      </tr>`)
      .join("");
  }

  function refresh() {
    updateSortIcons();
    paintTeamRows(getSorted(getFiltered()));
  }

  refresh();

  document.getElementById("team-search").addEventListener("input", refresh);
  document.getElementById("team-role-filter").addEventListener("change", refresh);

  document.querySelectorAll(".sites-table th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (sortCol === col) { sortDir *= -1; } else { sortCol = col; sortDir = 1; }
      refresh();
    });
  });

  document.getElementById("new-member-btn").addEventListener("click", () => openNewTeamMemberDrawer());
}

async function openNewTeamMemberDrawer() {
  if (document.getElementById("tm-drawer")) return;

  if (!_sitesCache) {
    try {
      const res = await apiFetch("/api/locations");
      if (res.ok) _sitesCache = (await res.json()).locations || [];
    } catch (e) {
      _sitesCache = _sitesCache || [];
    }
  }

  const overlay = document.createElement("div");
  overlay.id = "tm-drawer-overlay";
  overlay.className = "drawer-overlay";
  overlay.addEventListener("click", closeTeamMemberDrawer);

  const drawer = document.createElement("div");
  drawer.id = "tm-drawer";
  drawer.className = "drawer";

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  const locationCheckboxes = (_sitesCache && _sitesCache.length)
    ? _sitesCache.map((s) =>
        `<label class="be-check-label" style="display:block;margin:2px 0">
          <input type="checkbox" class="form-checkbox tm-loc" value="${escHtml(s.name)}" /> ${escHtml(s.name)}
        </label>`
      ).join("")
    : `<span class="form-hint">No locations loaded.</span>`;

  const availRows = DAYS.map((day, i) =>
    `<tr>
      <td style="padding:6px 8px;font-size:13px">${day}</td>
      <td><input type="time" class="form-input" data-day-idx="${i}" data-avail="start" style="padding:4px 6px;font-size:13px" /></td>
      <td><input type="time" class="form-input" data-day-idx="${i}" data-avail="end" style="padding:4px 6px;font-size:13px" /></td>
      <td style="text-align:center"><input type="checkbox" class="form-checkbox" data-day-idx="${i}" data-avail="unavail" /></td>
    </tr>`
  ).join("");

  drawer.innerHTML = `
    <div class="drawer-header">
      <h2 class="drawer-title">New Team Member</h2>
      <button class="drawer-close" id="tm-drawer-close-btn" aria-label="Close">✕</button>
    </div>
    <div class="drawer-body">
      <form id="new-tm-form" novalidate>

        <fieldset class="form-section">
          <legend>Contact Info</legend>
          <div class="form-row">
            <label class="form-label" for="tm-role">Role</label>
            <select class="form-input" id="tm-role">
              <option value="">— Select —</option>
              <option>Cleaner</option>
              <option>Supervisor</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label" for="tm-employee-id">Employee ID</label>
            <input class="form-input" id="tm-employee-id" type="text" placeholder="e.g. EMP-001" />
          </div>
          <div class="form-row-group">
            <div class="form-row">
              <label class="form-label required" for="tm-first-name">First Name</label>
              <input class="form-input" id="tm-first-name" type="text" required />
            </div>
            <div class="form-row">
              <label class="form-label required" for="tm-last-name">Last Name</label>
              <input class="form-input" id="tm-last-name" type="text" required />
            </div>
          </div>
          <div class="form-row">
            <label class="form-label" for="tm-email">Email</label>
            <input class="form-input" id="tm-email" type="email" placeholder="name@example.com" />
          </div>
          <div class="form-row">
            <label class="form-label" for="tm-phone">Phone Number</label>
            <input class="form-input" id="tm-phone" type="tel" placeholder="e.g. +1 555 000 1234" />
          </div>
          <div class="form-row">
            <label class="form-label" for="tm-address">Address</label>
            <input class="form-input" id="tm-address" type="text" placeholder="Street address" />
          </div>
          <div class="form-row">
            <label class="form-label" for="tm-country">Country</label>
            <input class="form-input" id="tm-country" type="text" placeholder="e.g. US" />
          </div>
          <div class="form-row">
            <label class="form-label" for="tm-timezone">Time Zone</label>
            <select class="form-input" id="tm-timezone">
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
          <div class="form-row">
            <label class="form-label" for="tm-language">Language</label>
            <select class="form-input" id="tm-language">
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
            <label class="form-label" for="tm-pin">Security Pin</label>
            <input class="form-input" id="tm-pin" type="password" placeholder="••••" maxlength="8" autocomplete="new-password" />
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>Employment Information</legend>
          <div class="form-row">
            <label class="form-label" for="tm-employment-type">Employment Type</label>
            <select class="form-input" id="tm-employment-type">
              <option value="">— Select —</option>
              <option>Full time</option>
              <option>Part time</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label" for="tm-reports-to">Reports To</label>
            <input class="form-input" id="tm-reports-to" type="text" placeholder="Supervisor name" />
          </div>
          <div class="form-row">
            <label class="form-label" for="tm-hire-date">Hire Date</label>
            <input class="form-input" id="tm-hire-date" type="date" />
          </div>
          <div class="form-row">
            <label class="form-label" for="tm-override-phone">Override Support Phone No.</label>
            <input class="form-input" id="tm-override-phone" type="tel" placeholder="e.g. +1 555 000 9999" />
          </div>
          <div class="form-row form-row-inline" style="margin-bottom:10px">
            <input class="form-checkbox" id="tm-geofence-disable" type="checkbox" />
            <label class="form-label" for="tm-geofence-disable">Disable Mandatory Geofence Clock In/Out</label>
          </div>
          <div class="form-row form-row-inline" style="margin-bottom:14px">
            <input class="form-checkbox" id="tm-travel-time" type="checkbox" />
            <label class="form-label" for="tm-travel-time">Track Travel Time</label>
          </div>
          <div class="form-row">
            <label class="form-label">Location Assignments</label>
            <p class="form-hint">Check locations to assign this team member</p>
            <div id="tm-location-list" style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:8px">
              ${locationCheckboxes}
            </div>
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>Availability</legend>
          <p class="form-hint">Set available hours per day of week</p>
          <table class="sites-table" style="font-size:13px">
            <thead>
              <tr><th>Day</th><th>Start Time</th><th>End Time</th><th>Unavailable</th></tr>
            </thead>
            <tbody>${availRows}</tbody>
          </table>
        </fieldset>

        <fieldset class="form-section">
          <legend>Notes</legend>
          <div class="break-entries-header">
            <span class="form-hint" style="margin:0">Additional notes</span>
            <button type="button" class="btn-secondary btn-sm" id="tm-add-note-btn">+ Add Note</button>
          </div>
          <div id="tm-notes-list"></div>
        </fieldset>

        <div id="tm-form-error" class="form-error" hidden></div>
      </form>
    </div>
    <div class="drawer-footer">
      <button type="button" class="btn-ghost" id="tm-cancel-btn">Cancel</button>
      <button type="button" class="btn-primary" id="tm-save-btn">Save Team Member</button>
    </div>`;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  requestAnimationFrame(() => {
    overlay.classList.add("open");
    drawer.classList.add("open");
  });

  document.getElementById("tm-drawer-close-btn").addEventListener("click", closeTeamMemberDrawer);
  document.getElementById("tm-cancel-btn").addEventListener("click", closeTeamMemberDrawer);
  document.getElementById("tm-save-btn").addEventListener("click", handleSaveTeamMember);
  document.getElementById("tm-add-note-btn").addEventListener("click", addTeamMemberNoteRow);
}

let _tmNoteCount = 0;

function addTeamMemberNoteRow() {
  _tmNoteCount++;
  const list = document.getElementById("tm-notes-list");
  const row = document.createElement("div");
  row.className = "break-entry-row";
  row.style.alignItems = "flex-start";
  row.innerHTML = `
    <textarea class="form-input tm-note-text" rows="2" placeholder="Enter note…" style="flex:1;resize:vertical"></textarea>
    <button type="button" class="btn-ghost btn-sm be-remove" aria-label="Remove note">✕</button>`;
  row.querySelector(".be-remove").addEventListener("click", () => row.remove());
  list.appendChild(row);
}

function closeTeamMemberDrawer() {
  const overlay = document.getElementById("tm-drawer-overlay");
  const drawer = document.getElementById("tm-drawer");
  if (!drawer) return;
  overlay.classList.remove("open");
  drawer.classList.remove("open");
  setTimeout(() => {
    overlay && overlay.remove();
    drawer && drawer.remove();
  }, 280);
}

function handleSaveTeamMember() {
  const errEl = document.getElementById("tm-form-error");
  errEl.hidden = true;

  const firstName = document.getElementById("tm-first-name").value.trim();
  const lastName = document.getElementById("tm-last-name").value.trim();

  if (!firstName || !lastName) {
    errEl.textContent = "First Name and Last Name are required.";
    errEl.hidden = false;
    return;
  }

  const newMember = {
    name: `${firstName} ${lastName}`,
    jobTitle: document.getElementById("tm-role").value || "Cleaner",
  };

  TEAM_MEMBERS.push(newMember);
  closeTeamMemberDrawer();
  renderTeamList();
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

window.addEventListener("hashchange", () => { if (currentUser) { parseHash(); render(); } });

// ---- Boot: gate the app behind authentication ----
async function boot() {
  initThemeToggle(); // theme toggle works on the login screen too

  // If the URL is /reset-password?token=…, capture the token early.
  const isResetRoute = location.pathname === "/reset-password";
  const resetToken = isResetRoute
    ? new URLSearchParams(location.search).get("token")
    : null;

  let user = await fetchMe();
  if (!user) {
    // Silent refresh: try to exchange a live refresh-token cookie for a new
    // session before falling back to the login screen.
    const refreshed = await attemptRefresh();
    if (refreshed) user = refreshed;
  }

  if (user) {
    currentUser = user;
    if (isResetRoute) history.replaceState({}, "", "/");
    showApp();
    renderProfilePill();
    parseHash();
    render();
  } else if (resetToken) {
    _resetToken = resetToken;
    document.body.classList.add("pre-auth");
    document.getElementById("login-screen").hidden = false;
    if (!_authWired) {
      _authWired = true;
      wireAuthScreens();
    }
    showAuthPanel("reset-panel");
    document.getElementById("reset-password-input").focus();
  } else {
    showLogin();
  }
}

boot();
