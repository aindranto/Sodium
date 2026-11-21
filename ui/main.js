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
  disabled() {
    try { return new Set(JSON.parse(localStorage.getItem("sodium.disabled") || "[]")); }
    catch { return new Set(); }
  },
  saveDisabled(set) { localStorage.setItem("sodium.disabled", JSON.stringify([...set])); },
};

let services = store.load();
let pinned = store.pinned();
let disabled = store.disabled();
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

// Read a user-picked icon image (.jpg/.jpeg/.png/.ico) and return a data
// URL small enough to keep in localStorage. Raster images are downscaled
// to a 96x96 square (cover-crop) as PNG; .ico files are stored as-is
// (they are already tiny icon containers, and canvas cannot reliably
// decode them) with a size cap.
function processIconFile(file) {
  return new Promise((resolve, reject) => {
    const name = (file.name || "").toLowerCase();
    const isIco = name.endsWith(".ico") || file.type.includes("icon");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (isIco) {
        if (dataUrl.length > 700 * 1024) return reject(new Error("File .ico kegedean (maks ~500 KB)."));
        return resolve(dataUrl);
      }
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = 96; c.height = 96;
        const ctx = c.getContext("2d");
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 96, 96);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Gambar nggak bisa dibaca."));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error("File nggak bisa dibaca."));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
function render() {
  nav.innerHTML = "";
  for (const s of services) {
    const b = document.createElement("button");
    b.className = "svc" + (s.id === activeId ? " active" : "") + (disabled.has(s.id) ? " disabled" : "");
    b.title = s.name + (pinned.has(s.id) ? " (pinned - tetap hidup)" : "") + (disabled.has(s.id) ? " (nonaktif — klik untuk mengaktifkan lagi)" : "");
    if (s.img) {
      const im = document.createElement("img");
      im.className = "svcImg"; im.src = s.img; im.alt = "";
      b.appendChild(im);
    } else {
      b.textContent = s.icon || s.name.slice(0, 2);
      if (s.color) b.style.background = s.color;
    }
    if (pinned.has(s.id)) {
      const p = document.createElement("span"); p.className = "pin"; p.textContent = "📌"; b.appendChild(p);
    }
    b.addEventListener("click", async () => {
      if (disabled.has(s.id)) {
        // Disabled services cannot be opened; a click opens the menu
        // where "Aktifkan lagi" lives, so the way back is one click away.
        ctxService = s;
        el("ctxTitle").textContent = s.name;
        el("ctxPin").textContent = pinned.has(s.id) ? "Unpin" : "Pin (tetap hidup buat notif)";
        el("ctxDisable").textContent = "Aktifkan lagi";
        await openPanel(ctxPanel);
        return;
      }
      switchTo(s);
    });
    b.addEventListener("contextmenu", async (e) => {
      e.preventDefault();
      ctxService = s;
      el("ctxTitle").textContent = s.name;
      el("ctxPin").textContent = pinned.has(s.id) ? "Unpin" : "Pin (tetap hidup buat notif)";
      el("ctxDisable").textContent = disabled.has(s.id) ? "Aktifkan lagi" : "Nonaktifkan (matikan total sementara)";
      await openPanel(ctxPanel);
    });
    nav.appendChild(b);
  }
}

async function switchTo(s) {
  if (disabled.has(s.id)) return;
  if (allPanels.some(p => !p.hidden)) await closePanels();
  activeId = s.id; render();
  el("activeName").textContent = s.name;
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
buildPalette(el("customPalette"), (e) => { el("cIcon").value = e; clearCustomImg(); });
let customImg = null;
function clearCustomImg() {
  customImg = null;
  el("cIconPreview").hidden = true;
  el("cIconPreview").removeAttribute("src");
}
el("cUploadBtn").addEventListener("click", () => el("cIconFile").click());
el("cIconPreview").addEventListener("click", clearCustomImg);
el("cIconFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    customImg = await processIconFile(f);
    el("cIconPreview").src = customImg;
    el("cIconPreview").hidden = false;
  } catch { /* unreadable file: keep the text icon */ }
});
el("customAdd").addEventListener("click", async () => {
  const name = el("cName").value.trim();
  let url = el("cUrl").value.trim();
  const icon = el("cIcon").value.trim();
  if (!name || !url) return;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
  const svc = { id, name, url, icon: icon || name.slice(0, 2) };
  if (customImg) svc.img = customImg;
  services.push(svc);
  store.save(services); render();
  el("cName").value = ""; el("cUrl").value = ""; el("cIcon").value = "";
  clearCustomImg();
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
  el("iconMsg").textContent = "";
  refreshIconPanelImg();
  await openPanel(iconPanel);
});

function refreshIconPanelImg() {
  const has = !!(iconTarget && iconTarget.img);
  el("iconPreview").hidden = !has;
  el("iconRemoveImg").hidden = !has;
  if (has) el("iconPreview").src = iconTarget.img;
}
el("ctxDisable").addEventListener("click", async () => {
  if (!ctxService) return;
  const id = ctxService.id;
  if (disabled.has(id)) {
    // Re-enable only: the webview is created on the next click, and the
    // login session is still on disk, so no re-login is needed.
    disabled.delete(id);
  } else {
    // Disable = destroy the webview completely (RAM freed, nothing runs),
    // but keep the profile folder: cookies/session survive on disk.
    disabled.add(id);
    await invoke("close_service", { id });
    if (activeId === id) {
      activeId = null;
      el("activeName").textContent = "Sodium";
      el("welcome").style.display = "block";
    }
  }
  store.saveDisabled(disabled);
  render();
  await closePanels();
});
el("ctxDelete").addEventListener("click", async () => {
  if (!ctxService) return;
  const id = ctxService.id;
  services = services.filter(x => x.id !== id);
  store.save(services);
  if (pinned.has(id)) { pinned.delete(id); store.savePinned(pinned); }
  if (disabled.has(id)) { disabled.delete(id); store.saveDisabled(disabled); }
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
  delete iconTarget.img;
  store.save(services); render();
  await closePanels();
});
el("iconSave").addEventListener("click", async () => {
  if (!iconTarget) return;
  const v = el("iconText").value.trim();
  if (v) { iconTarget.icon = v; delete iconTarget.img; store.save(services); render(); }
  await closePanels();
});
el("iconCancel").addEventListener("click", closePanels);
el("iconUploadBtn").addEventListener("click", () => el("iconFile").click());
el("iconFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f || !iconTarget) return;
  try {
    iconTarget.img = await processIconFile(f);
    store.save(services); render();
    await closePanels();
  } catch (err) {
    el("iconMsg").textContent = String(err && err.message || err);
  }
});
el("iconRemoveImg").addEventListener("click", async () => {
  if (!iconTarget) return;
  delete iconTarget.img;
  store.save(services); render();
  await closePanels();
});

// Keyboard shortcuts: Ctrl/Cmd + 1..9
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
    const s = services[Number(e.key) - 1]; if (s) switchTo(s);
  }
});

// Zoom for the service view (browser-style page zoom), persisted and
// pushed into Rust, which applies it to every service webview and to
// webviews created later.
const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];
let zoomIdx = ZOOM_STEPS.indexOf(parseFloat(localStorage.getItem("sodium.zoom") || "1"));
if (zoomIdx < 0) zoomIdx = ZOOM_STEPS.indexOf(1.0);
function applyZoom() {
  el("zoomLabel").textContent = Math.round(ZOOM_STEPS[zoomIdx] * 100) + "%";
  localStorage.setItem("sodium.zoom", String(ZOOM_STEPS[zoomIdx]));
  invoke("set_zoom_level", { scale: ZOOM_STEPS[zoomIdx] });
}
el("zoomIn").addEventListener("click", () => { if (zoomIdx < ZOOM_STEPS.length - 1) { zoomIdx++; applyZoom(); } });
el("zoomOut").addEventListener("click", () => { if (zoomIdx > 0) { zoomIdx--; applyZoom(); } });
el("zoomLabel").addEventListener("click", () => { zoomIdx = ZOOM_STEPS.indexOf(1.0); applyZoom(); });
applyZoom();

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
