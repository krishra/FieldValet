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
  document.getElementById("view").innerHTML = `
    <h1 class="page-title">${title}</h1>
    <p class="page-sub">${where}</p>
    <div class="placeholder">
      <strong>${where}</strong>
      This page is intentionally empty for now — navigation shell only.
    </div>`;
}

function render() {
  renderPrimary();
  renderSecondary();
  renderView();
}

window.addEventListener("hashchange", () => { parseHash(); render(); });
parseHash();
render();
