// Sodium UI - no framework, no bundler. Sidebar + service picker.
// The heavy lifting (creating / destroying webviews) happens in Rust:
// see src-tauri/src/lib.rs -> switch_service()

// Catalog of popular services with their official web apps, shown in the
// picker (first run, and whenever "+" is clicked). Icons are emoji on a
// brand-coloured tile: no image files to bundle, stays feather-light.
const CATALOG = [
  { id: "whatsapp",  name: "WhatsApp",        url: "https://web.whatsapp.com/",        icon: "💬", color: "#1faa55" },
  { id: "telegram",  name: "Telegram",        url: "https://web.telegram.org/k/",      icon: "✈️", color: "#229ed9" },
  { id: "instagram", name: "Instagram",       url: "https://www.instagram.com/",       icon: "📸", color: "#c13584" },
  { id: "messenger", name: "Messenger",       url: "https://www.messenger.com/",       icon: "⚡", color: "#0084ff" },
  { id: "discord",   name: "Discord",         url: "https://discord.com/channels/@me", icon: "🎮", color: "#5865f2" },
  { id: "gmail",     name: "Gmail",           url: "https://mail.google.com/",         icon: "✉️", color: "#d93025" },
  { id: "facebook",  name: "Facebook",        url: "https://www.facebook.com/",        icon: "👍", color: "#1877f2" },
  { id: "tiktok",    name: "TikTok",          url: "https://www.tiktok.com/",          icon: "🎵", color: "#161823" },
  { id: "youtube",   name: "YouTube",         url: "https://www.youtube.com/",         icon: "▶️", color: "#ff0000" },
  { id: "twitter",   name: "X (Twitter)",     url: "https://x.com/",                   icon: "🐦", color: "#14171a" },
  { id: "slack",     name: "Slack",           url: "https://app.slack.com/client",     icon: "#️⃣", color: "#611f69" },
  { id: "teams",     name: "Microsoft Teams", url: "https://teams.microsoft.com/",     icon: "👥", color: "#4b53bc" },
  { id: "gcal",      name: "Google Calendar", url: "https://calendar.google.com/",     icon: "📅", color: "#4285f4" },
  { id: "spotify",   name: "Spotify",         url: "https://open.spotify.com/",        icon: "🎧", color: "#1db954" },
  { id: "github",    name: "GitHub",          url: "https://github.com/",              icon: "🐙", color: "#24292e" },
  { id: "linkedin",  name: "LinkedIn",        url: "https://www.linkedin.com/",        icon: "💼", color: "#0a66c2" },
  { id: "reddit",    name: "Reddit",          url: "https://www.reddit.com/",          icon: "🤖", color: "#ff4500" },
  { id: "pinterest", name: "Pinterest",       url: "https://www.pinterest.com/",       icon: "📌", color: "#e60023" },
  { id: "netflix",   name: "Netflix",         url: "https://www.netflix.com/",         icon: "🎬", color: "#b20710" },
  { id: "tokopedia", name: "Tokopedia",       url: "https://www.tokopedia.com/",       icon: "🦉", color: "#42b549" },
  { id: "shopee",    name: "Shopee",          url: "https://shopee.co.id/",            icon: "🛍️", color: "#ee4d2d" },
];

const ICON_PALETTE = ["💬","✈️","📸","🎮","✉️","🎵","📺","👍","🎧","🐙","💼","🤖","📌","🎬","🛍️","⭐","❤️","🔥","✅","📅","👥","🌐","💡","🚀"];

const DEFAULT_SERVICES = [
  // Agung's daily driver, pre-added. Everything else comes from the picker.
  { id: "whatsapp", name: "WhatsApp", url: "https://web.whatsapp.com/", icon: "💬", color: "#1faa55" },
];

const store = {
  load() {
    try { return JSON.parse(localStorage.getItem("sodium.services")) || structuredClone(DEFAULT_SERVICES); }
    catch { return structuredClone(DEFAULT_SERVICES); }
  },
  save(list) { localStorage.setItem("sodium.services", JSON.stringify(list)); },
  pinned() {
    try { return new Set(JSON.parse(localStorage.getItem("sodium.pinned") || "[]")); }
    catch { return new Set(); }
  },
  savePinned(set) { localStorage.setItem("sodium.pinned", JSON.stringify([...set])); },
};

let services = store.load();
let pinned = store.pinned();
let activeId = null;

const nav = document.getElementById("services");
const { invoke } = window.__TAURI__.core;
const el = (id) => document.getElementById(id);

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// One-time migration: services added before v0.2.0 have letter icons and no
// colour. If their URL matches a catalog entry, adopt its emoji + colour
// (only when the icon is still the auto-generated 1-2 letters).
(function migrate() {
  let changed = false;
  for (const s of services) {
    const cat = CATALOG.find(c => hostOf(c.url) === hostOf(s.url));
    if (!cat) continue;
    if (!s.color) { s.color = cat.color; changed = true; }
    if (!s.icon || /^[A-Za-z]{1,2}$/.test(s.icon)) { s.icon = cat.icon; changed = true; }
  }
  if (changed) store.save(services);
})();

// ---------------------------------------------------------------------------
// Panels (service picker / right-click menu / icon changer)
//
// Service webviews are NATIVE controls layered on top of this UI webview,
// so any panel rendered here would sit *behind* e.g. the WhatsApp webview
// and look like the button does nothing. While a panel is open we ask Rust
// to hide the service webviews (hide, not destroy: sessions stay alive).
// ---------------------------------------------------------------------------
const pickerPanel = el("pickerPanel");
const ctxPanel = el("ctxPanel");
const iconPanel = el("iconPanel");
const allPanels = [pickerPanel, ctxPanel, iconPanel];
let ctxService = null;
let iconTarget = null;

async function openPanel(panel) {
  for (const p of allPanels) p.hidden = true;
  await invoke("set_services_visible", { visible: false });
  panel.hidden = false;
}

async function closePanels() {
  for (const p of allPanels) p.hidden = true;
  await invoke("set_services_visible", { visible: true });
}

function buildPalette(container, onPick) {
  container.innerHTML = "";
  for (const e of ICON_PALETTE) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = e;
    b.addEventListener("click", () => onPick(e));
    container.appendChild(b);
  }
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
function render() {
  nav.innerHTML = "";
  for (const s of services) {
    const b = document.createElement("button");
    b.className = "svc" + (s.id === activeId ? " active" : "");
    b.title = s.name + (pinned.has(s.id) ? " (pinned - tetap hidup)" : "");
    b.textContent = s.icon || s.name.slice(0, 2);
    if (s.color) b.style.background = s.color;
    if (pinned.has(s.id)) {
      const p = document.createElement("span"); p.className = "pin"; p.textContent = "📌"; b.appendChild(p);
    }
    b.addEventListener("click", () => switchTo(s));
    b.addEventListener("contextmenu", async (e) => {
      e.preventDefault();
      ctxService = s;
      el("ctxTitle").textContent = s.name;
      el("ctxPin").textContent = pinned.has(s.id) ? "Unpin" : "Pin (tetap hidup buat notif)";
      await openPanel(ctxPanel);
    });
    nav.appendChild(b);
  }
}

async function switchTo(s) {
  if (allPanels.some(p => !p.hidden)) await closePanels();
  activeId = s.id; render();
  el("welcome").style.display = "none";
  try {
    await invoke("switch_service", { id: s.id, url: s.url });
    const alive = await invoke("alive_services");
    el("ramNote").textContent = "";
    console.log("Sodium alive webviews:", alive);
  } catch (err) {
    el("welcome").style.display = "block";
    el("ramNote").textContent = "Gagal membuka " + s.name + ": " + err;
  }
}

// ---------------------------------------------------------------------------
// Service picker (first run + "+" button)
// ---------------------------------------------------------------------------
const grid = el("pickerGrid");
const searchInput = el("pickerSearch");
const addSelectedBtn = el("addSelected");
let selected = new Set();

function isAdded(cat) {
  return services.some(s => s.id === cat.id || hostOf(s.url) === hostOf(cat.url));
}

function updateAddBtn() {
  addSelectedBtn.textContent = `Tambah (${selected.size})`;
  addSelectedBtn.disabled = selected.size === 0;
}

function renderPicker() {
  const q = searchInput.value.trim().toLowerCase();
  grid.innerHTML = "";
  for (const cat of CATALOG) {
    if (q && !cat.name.toLowerCase().includes(q)) continue;
    const added = isAdded(cat);
    const t = document.createElement("button");
    t.type = "button";
    t.className = "tile" + (added ? " added" : "") + (selected.has(cat.id) ? " selected" : "");
    const ic = document.createElement("span");
    ic.className = "tileIcon"; ic.style.background = cat.color; ic.textContent = cat.icon;
    const nm = document.createElement("span");
    nm.className = "tileName"; nm.textContent = cat.name;
    t.append(ic, nm);
    if (added) {
      const badge = document.createElement("span");
      badge.className = "tileBadge"; badge.textContent = "Sudah ada";
      t.appendChild(badge);
      t.disabled = true;
    } else {
      t.addEventListener("click", () => {
        if (selected.has(cat.id)) selected.delete(cat.id); else selected.add(cat.id);
        renderPicker();
      });
    }
    grid.appendChild(t);
  }
  updateAddBtn();
}

function markOnboarded() { localStorage.setItem("sodium.onboarded", "1"); }

async function openPicker() {
  selected.clear();
  searchInput.value = "";
  renderPicker();
  await openPanel(pickerPanel);
  searchInput.focus();
}

el("addBtn").addEventListener("click", openPicker);
searchInput.addEventListener("input", renderPicker);
el("pickerSkip").addEventListener("click", async () => { markOnboarded(); await closePanels(); });
addSelectedBtn.addEventListener("click", async () => {
  for (const cat of CATALOG) {
    if (selected.has(cat.id) && !isAdded(cat)) services.push({ ...cat });
  }
  store.save(services); render();
  selected.clear();
  markOnboarded();
  await closePanels();
});

// Custom URL form inside the picker
buildPalette(el("customPalette"), (e) => { el("cIcon").value = e; });
el("customAdd").addEventListener("click", async () => {
  const name = el("cName").value.trim();
  let url = el("cUrl").value.trim();
  const icon = el("cIcon").value.trim();
  if (!name || !url) return;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
  services.push({ id, name, url, icon: icon || name.slice(0, 2) });
  store.save(services); render();
  el("cName").value = ""; el("cUrl").value = ""; el("cIcon").value = "";
  markOnboarded();
  await closePanels();
});

// ---------------------------------------------------------------------------
// Right-click panel: pin / change icon / delete
// ---------------------------------------------------------------------------
el("ctxPin").addEventListener("click", async () => {
  if (!ctxService) return;
  const nowPinned = !pinned.has(ctxService.id);
  if (nowPinned) pinned.add(ctxService.id); else pinned.delete(ctxService.id);
  store.savePinned(pinned);
  invoke("set_pinned", { id: ctxService.id, pinned: nowPinned });
  render();
  await closePanels();
});
el("ctxIcon").addEventListener("click", async () => {
  if (!ctxService) return;
  iconTarget = ctxService;
  el("iconTitle").textContent = "Ganti ikon — " + ctxService.name;
  el("iconText").value = "";
  await openPanel(iconPanel);
});
el("ctxDelete").addEventListener("click", async () => {
  if (!ctxService) return;
  const id = ctxService.id;
  services = services.filter(x => x.id !== id);
  store.save(services);
  if (pinned.has(id)) { pinned.delete(id); store.savePinned(pinned); }
  if (activeId === id) activeId = null;
  await invoke("close_service", { id });
  render();
  await closePanels();
});
el("ctxClose").addEventListener("click", closePanels);

// Icon changer panel
buildPalette(el("iconPalette"), async (e) => {
  if (!iconTarget) return;
  iconTarget.icon = e;
  store.save(services); render();
  await closePanels();
});
el("iconSave").addEventListener("click", async () => {
  if (!iconTarget) return;
  const v = el("iconText").value.trim();
  if (v) { iconTarget.icon = v; store.save(services); render(); }
  await closePanels();
});
el("iconCancel").addEventListener("click", closePanels);

// Keyboard shortcuts: Ctrl/Cmd + 1..9
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
    const s = services[Number(e.key) - 1]; if (s) switchTo(s);
  }
});

// "Hidup bareng" setting: how many non-pinned services may stay alive.
// Stored locally, pushed into the Rust side on startup and on change.
const maxAliveSel = el("maxAlive");
const savedMax = localStorage.getItem("sodium.maxAlive") || "1";
maxAliveSel.value = savedMax;
invoke("set_max_alive", { max: Number(savedMax) });
maxAliveSel.addEventListener("change", () => {
  localStorage.setItem("sodium.maxAlive", maxAliveSel.value);
  invoke("set_max_alive", { max: Number(maxAliveSel.value) });
});

// Restore pinned flags into the Rust side on startup
for (const id of pinned) invoke("set_pinned", { id, pinned: true });
render();

// First run (or first run of v0.2.0+): show the service picker once.
if (!localStorage.getItem("sodium.onboarded")) openPicker();
