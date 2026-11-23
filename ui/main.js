// Sodium UI - no framework, no bundler. Sidebar + service picker.
// The heavy lifting (creating / destroying webviews) happens in Rust:
// see src-tauri/src/lib.rs -> switch_service()

// Catalog of popular services with their official web apps, shown in the
// picker (first run, and whenever "+" is clicked). "slug" points into
// ICON_PATHS (icons.js, Simple Icons paths): the service renders as the
// real brand logo, drawn in the service's iconColor on its colour tile.
// Tokopedia has no Simple Icons entry, so it keeps its emoji icon.
const CATALOG = [
  { id: "whatsapp",  name: "WhatsApp",        url: "https://web.whatsapp.com/",        icon: "💬", color: "#1faa55" , slug: "whatsapp" },
  { id: "telegram",  name: "Telegram",        url: "https://web.telegram.org/k/",      icon: "✈️", color: "#229ed9" , slug: "telegram" },
  { id: "instagram", name: "Instagram",       url: "https://www.instagram.com/",       icon: "📸", color: "#c13584" , slug: "instagram" },
  { id: "messenger", name: "Messenger",       url: "https://www.messenger.com/",       icon: "M", color: "#0084ff" , slug: "messenger" },
  { id: "discord",   name: "Discord",         url: "https://discord.com/channels/@me", icon: "🎮", color: "#5865f2" , slug: "discord" },
  { id: "gmail",     name: "Gmail",           url: "https://mail.google.com/",         icon: "✉️", color: "#d93025" , slug: "gmail" },
  { id: "facebook",  name: "Facebook",        url: "https://www.facebook.com/",        icon: "👍", color: "#1877f2" , slug: "facebook" },
  { id: "tiktok",    name: "TikTok",          url: "https://www.tiktok.com/",          icon: "🎵", color: "#161823" , slug: "tiktok" },
  { id: "youtube",   name: "YouTube",         url: "https://www.youtube.com/",         icon: "▶️", color: "#ff0000" , slug: "youtube" },
  { id: "twitter",   name: "X (Twitter)",     url: "https://x.com/",                   icon: "X", color: "#14171a" , slug: "x" },
  { id: "slack",     name: "Slack",           url: "https://app.slack.com/client",     icon: "#️⃣", color: "#611f69" , slug: "slack" },
  { id: "teams",     name: "Microsoft Teams", url: "https://teams.microsoft.com/",     icon: "👥", color: "#4b53bc" , slug: "microsoftteams" },
  { id: "gcal",      name: "Google Calendar", url: "https://calendar.google.com/",     icon: "📅", color: "#4285f4" , slug: "googlecalendar" },
  { id: "spotify",   name: "Spotify",         url: "https://open.spotify.com/",        icon: "🎧", color: "#1db954" , slug: "spotify" },
  { id: "github",    name: "GitHub",          url: "https://github.com/",              icon: "🐙", color: "#24292e" , slug: "github" },
  { id: "linkedin",  name: "LinkedIn",        url: "https://www.linkedin.com/",        icon: "💼", color: "#0a66c2" , slug: "linkedin" },
  { id: "reddit",    name: "Reddit",          url: "https://www.reddit.com/",          icon: "🤖", color: "#ff4500" , slug: "reddit" },
  { id: "pinterest", name: "Pinterest",       url: "https://www.pinterest.com/",       icon: "📌", color: "#e60023" , slug: "pinterest" },
  { id: "netflix",   name: "Netflix",         url: "https://www.netflix.com/",         icon: "🎬", color: "#b20710" , slug: "netflix" },
  { id: "tokopedia", name: "Tokopedia",       url: "https://www.tokopedia.com/",       icon: "🦉", color: "#42b549" },
  { id: "shopee",    name: "Shopee",          url: "https://shopee.co.id/",            icon: "🛍️", color: "#ee4d2d" , slug: "shopee" },
];


const DEFAULT_SERVICES = [
  // WhatsApp is pre-added; everything else comes from the picker.
  { id: "whatsapp", name: "WhatsApp", url: "https://web.whatsapp.com/", icon: "💬", color: "#1faa55", brand: "whatsapp", iconColor: "#ffffff" },
];

const ICON_PALETTE = ["💬","✈️","📸","🎮","✉️","🎵","📺","👍","🎧","🐙","💼","🤖","📌","🎬","🛍️","🛒","❤️","🔥","✅","📅","👥","🌐","💡","📰"];

const store = {
  load() {
    try { return JSON.parse(localStorage.getItem("sodium.services")) || structuredClone(DEFAULT_SERVICES); }
    catch { return structuredClone(DEFAULT_SERVICES); }
  },
  save(list) { localStorage.setItem("sodium.services", JSON.stringify(list)); scheduleConfigSave(); },
  pinned() {
    try { return new Set(JSON.parse(localStorage.getItem("sodium.pinned") || "[]")); }
    catch { return new Set(); }
  },
  savePinned(set) { localStorage.setItem("sodium.pinned", JSON.stringify([...set])); scheduleConfigSave(); },
  disabled() {
    try { return new Set(JSON.parse(localStorage.getItem("sodium.disabled") || "[]")); }
    catch { return new Set(); }
  },
  saveDisabled(set) { localStorage.setItem("sodium.disabled", JSON.stringify([...set])); scheduleConfigSave(); },
};

// Durable mirror of the local settings in config.json on the Rust
// side: localStorage is the working copy, but it dies with the
// webview profile data; config.json survives that. Saves are
// debounced and revisioned; at startup a newer config.json wins.
const CFG_KEYS = ["sodium.services", "sodium.pinned", "sodium.disabled", "sodium.showNames", "sodium.lastActive", "sodium.onboarded", "sodium.zoom", "sodium.zoomByService", "sodium.maxAlive", "sodium.downloads", "sodium.lastUpdateCheck", "sodium.iconSize"];
let cfgRev = parseInt(localStorage.getItem("sodium.cfgRev") || "0", 10) || 0;
let cfgTimer = null;
let applyingConfig = false;
function scheduleConfigSave() {
  if (applyingConfig) return;
  clearTimeout(cfgTimer);
  cfgTimer = setTimeout(() => {
    cfgRev += 1;
    localStorage.setItem("sodium.cfgRev", String(cfgRev));
    const data = {};
    for (const k of CFG_KEYS) {
      const v = localStorage.getItem(k);
      if (v !== null) data[k] = v;
    }
    invoke("save_config", { data: JSON.stringify({ rev: cfgRev, data }) }).catch(() => {});
  }, 250);
}

let services = store.load();
// Unread counts per service id, reported by Rust from page titles
// ("(3) WhatsApp"). Only alive webviews report; Rust sends 0 when a
// webview is closed or evicted, so a badge never shows a stale count.
const unread = new Map();
let pinned = store.pinned();
let disabled = store.disabled();
let activeId = null;
let showNames = localStorage.getItem("sodium.showNames") === "1";
// Sidebar icon size (40/48/56 px button): a CSS variable the
// stylesheet reads, so low-resolution screens can shrink the icons.
let iconSize = parseInt(localStorage.getItem("sodium.iconSize") || "48", 10) || 48;
function applyIconSize() {
  document.documentElement.style.setProperty("--svc", iconSize + "px");
  document.documentElement.style.setProperty("--svc-sm", Math.round(iconSize * 28 / 48) + "px");
}
function svcGlyphPx() { return Math.round(iconSize * 26 / 48); }
applyIconSize();

const nav = document.getElementById("services");
const { invoke } = window.__TAURI__.core;
const el = (id) => document.getElementById(id);

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// One-time migration: services added before v0.2.0 have letter icons and no
// colour. If their URL matches a catalog entry, adopt its emoji + colour
// (only when the icon is still the auto-generated 1-2 letters), and adopt
// the real brand logo when the icon is still that catalog default.
(function migrate() {
  let changed = false;
  for (const s of services) {
    const cat = CATALOG.find(c => hostOf(c.url) === hostOf(s.url));
    if (!cat) continue;
    if (!s.color) { s.color = cat.color; changed = true; }
    if (!s.icon || /^[A-Za-z]{1,2}$/.test(s.icon)) { s.icon = cat.icon; changed = true; }
    // Brand logo adoption: only when the icon is still the untouched
    // catalog default and no image was uploaded. A manually chosen icon
    // or an uploaded image is never overridden.
    if (cat.slug && !s.brand && !s.img && s.icon === cat.icon) { s.brand = cat.slug; changed = true; }
  }
  if (changed) store.save(services);
})();

// Panels (service picker / right-click menu / icon changer)
//
// Service webviews are NATIVE controls layered on top of this UI webview,
// so any panel rendered here would sit *behind* e.g. the WhatsApp webview
// and look like the button does nothing. While a panel is open we ask Rust
// to hide the service webviews (hide, not destroy: sessions stay alive).
const pickerPanel = el("pickerPanel");
const ctxPanel = el("ctxPanel");
const iconPanel = el("iconPanel");
const managePanel = el("managePanel");
const dlPanel = el("dlPanel");
const updatePanel = el("updatePanel");
const allPanels = [pickerPanel, ctxPanel, iconPanel, managePanel, dlPanel, updatePanel];
let ctxService = null;
let iconTarget = null;

let lastFocus = null;
async function openPanel(panel) {
  lastFocus = document.activeElement;
  for (const p of allPanels) p.hidden = true;
  // Only the modal popups (picker / Kelola / right-click menu,
  // class "picker") get the dimmed backdrop.
  el("scrim").hidden = !panel.classList.contains("picker");
  await invoke("set_services_visible", { visible: false });
  panel.hidden = false;
  const f = panel.querySelector("input:not([type='file']), button:not([disabled])");
  if (f) f.focus();
}

async function closePanels() {
  for (const p of allPanels) p.hidden = true;
  el("scrim").hidden = true;
  await invoke("set_services_visible", { visible: true });
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

// Clicking outside an open panel (welcome area, top bar) closes it.
// Sidebar clicks are excluded: they run their own open/switch logic.
document.addEventListener("click", (e) => {
  const open = allPanels.find(p => !p.hidden);
  if (!open) return;
  // Use composedPath: a handler may detach e.target mid-click.
  const path = e.composedPath ? e.composedPath() : [e.target];
  if (path.includes(open)) return;
  if (path.some(n => n && n.id === "sidebar")) return;
  closePanels();
});

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

// Sidebar
// The visual for a service without an uploaded image: the real brand
// logo (SVG path from icons.js) drawn in iconColor, or the text icon
// (emoji / letters) in iconColor. Uploaded images always win: render()
// handles them before calling this.
function iconVisual(s, px) {
  const col = s.iconColor || "#ffffff";
  const sp = document.createElement("span");
  if (s.brand && ICON_PATHS[s.brand]) {
    sp.className = "svgIcon";
    sp.innerHTML = '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="' + col + '" aria-hidden="true"><path d="' + ICON_PATHS[s.brand] + '"/></svg>';
  } else {
    sp.className = "txtIcon";
    sp.style.color = col;
    sp.textContent = s.icon || s.name.slice(0, 2);
  }
  return sp;
}

// The right-click menu is a panel like the others: opening it
// hides the service webviews; it shows as a centred modal.
async function openCtx(s) {
  ctxService = s;
  el("ctxTitle").textContent = s.name;
  el("ctxPin").textContent = pinned.has(s.id) ? "Unpin" : "Pin (tetap hidup buat notif)";
  el("ctxDisable").textContent = disabled.has(s.id) ? "Aktifkan lagi" : "Nonaktifkan (matikan total sementara)";
  await openPanel(ctxPanel);
  el("ctxPin").focus();
}

function render() {
  document.body.classList.toggle("showNames", showNames);
  nav.innerHTML = "";
  for (const s of services) {
    const b = document.createElement("button");
    b.className = "svc" + (s.id === activeId ? " active" : "") + (disabled.has(s.id) ? " disabled" : "");
    b.title = s.name + (pinned.has(s.id) ? " (pinned - tetap hidup)" : "") + (disabled.has(s.id) ? " (nonaktif, klik untuk mengaktifkan lagi)" : "");
    b.setAttribute("aria-label", b.title);
    if (s.img) {
      const im = document.createElement("img");
      im.className = "svcImg"; im.src = s.img; im.alt = "";
      // A remote favicon URL can fail to load (offline, site gone):
      // fall back to the text/brand icon instead of a broken image.
      im.onerror = () => {
        im.replaceWith(iconVisual(s, svcGlyphPx()));
        if (s.color) b.style.background = s.color;
      };
      b.appendChild(im);
    } else {
      b.appendChild(iconVisual(s, svcGlyphPx()));
      if (s.color) b.style.background = s.color;
    }
    if (pinned.has(s.id)) {
      const p = document.createElement("span"); p.className = "pin"; b.appendChild(p);
    }
    if (showNames) {
      const nm = document.createElement("span");
      nm.className = "svcName";
      nm.textContent = s.name;
      b.appendChild(nm);
    }
    const n = unread.get(s.id);
    if (n && !disabled.has(s.id)) {
      const bd = document.createElement("span");
      bd.className = "badge";
      bd.textContent = n > 99 ? "99+" : String(n);
      b.appendChild(bd);
    }
    b.addEventListener("click", async (e) => {
      if (disabled.has(s.id)) {
        // Disabled services cannot be opened; a click opens the menu
        // where "Aktifkan lagi" lives, so the way back is one click away.
        await openCtx(s);
        return;
      }
      switchTo(s);
    });
    b.addEventListener("contextmenu", async (e) => {
      e.preventDefault();
      await openCtx(s);
    });
    b.addEventListener("keydown", async (e) => {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        await openCtx(s);
      }
    });
    nav.appendChild(b);
  }
}

async function switchTo(s) {
  if (disabled.has(s.id)) return;
  if (linkPopupOpen) await closeLinkPopup();
  if (allPanels.some(p => !p.hidden)) await closePanels();
  activeId = s.id; render();
  localStorage.setItem("sodium.lastActive", s.id); scheduleConfigSave();
  el("activeName").textContent = s.name;
  el("welcome").style.display = "none";
  try {
    // Push this service's own zoom first: Rust stores it and applies it
    // when the webview is created (or right away if it already exists).
    await invoke("set_service_zoom", { id: s.id, scale: zoomFor(s.id) });
    await invoke("switch_service", { id: s.id, url: s.url });
    showZoom();
    const alive = await invoke("alive_services");
    el("ramNote").textContent = "";
    el("ramNote").classList.remove("error");
    console.log("Sodium alive webviews:", alive);
  } catch (err) {
    el("welcome").style.display = "";
    el("ramNote").textContent = "Gagal membuka " + s.name + ": " + err;
    el("ramNote").classList.add("error");
  }
}

// Service picker (first run + "+" button)
const grid = el("pickerGrid");
const searchInput = el("pickerSearch");

// How many instances of a catalog service already exist (the first
// add, plus numbered copies for other accounts).
function instanceCount(cat) {
  return services.filter(s =>
    (cat.slug && s.brand === cat.slug) || hostOf(s.url) === hostOf(cat.url)
  ).length;
}

// Add one instance of a catalog service. The first keeps the catalog
// id and name; further instances (another account) get the smallest
// free number: "WhatsApp 2", "WhatsApp 3", ... Each instance is its
// own service with its own empty profile folder, so logins never mix.
function addCatalogService(cat) {
  let id = cat.id;
  let name = cat.name;
  if (instanceCount(cat) > 0) {
    let n = 2;
    while (services.some(s => s.name === cat.name + " " + n)) n++;
    id = cat.id + "-" + n;
    name = cat.name + " " + n;
  }
  const svc = { id, name, url: cat.url, icon: cat.icon, color: cat.color, iconColor: "#ffffff" };
  if (cat.slug) svc.brand = cat.slug;
  services.push(svc);
  store.save(services);
  render();
  markOnboarded();
  return instanceCount(cat);
}

function renderPicker() {
  const q = searchInput.value.trim().toLowerCase();
  grid.innerHTML = "";
  for (const cat of CATALOG) {
    if (q && !cat.name.toLowerCase().includes(q)) continue;
    const t = document.createElement("button");
    t.type = "button";
    t.className = "tile";
    t.title = "Klik untuk menambah " + cat.name;
    const ic = document.createElement("span");
    ic.className = "tileIcon"; ic.style.background = cat.color;
    ic.appendChild(iconVisual({ brand: cat.slug, icon: cat.icon, name: cat.name, iconColor: "#ffffff" }, 28));
    const nm = document.createElement("span");
    nm.className = "tileName"; nm.textContent = cat.name;
    t.append(ic, nm);
    const badge = document.createElement("span");
    badge.className = "tileBadge";
    const n0 = instanceCount(cat);
    badge.textContent = n0 ? "\u00d7" + n0 : "";
    badge.hidden = !n0;
    t.appendChild(badge);
    // Click = add right away; there is no select-then-confirm step.
    // Only this tile's badge is updated, the grid is not re-rendered,
    // so the panel stays open and the click target stays attached.
    t.addEventListener("click", () => {
      const n = addCatalogService(cat);
      badge.textContent = "\u00d7" + n;
      badge.hidden = false;
    });
    grid.appendChild(t);
  }
  if (!grid.children.length) {
    const d = document.createElement("div");
    d.className = "pickerEmpty";
    d.textContent = "Tidak ada layanan yang cocok dengan \"" + searchInput.value.trim() + "\". Coba kata lain, atau tambah lewat form custom URL di bawah.";
    grid.appendChild(d);
  }
}

function markOnboarded() { localStorage.setItem("sodium.onboarded", "1"); scheduleConfigSave(); }

async function openPicker() {
  searchInput.value = "";
  el("pickerSkip").textContent = localStorage.getItem("sodium.onboarded") ? "Tutup" : "Lewati";
  renderPicker();
  await openPanel(pickerPanel);
  searchInput.focus();
}

// Right-click menu actions: pin, disable, and the door to the
// Kelola panel.
el("ctxPin").addEventListener("click", async () => {
  if (!ctxService) return;
  togglePin(ctxService);
  await closePanels();
});
el("ctxDisable").addEventListener("click", async () => {
  if (!ctxService) return;
  await setServiceDisabled(ctxService, !disabled.has(ctxService.id));
  await closePanels();
});
el("ctxManage").addEventListener("click", async () => {
  await openManage();
});

el("addBtn").addEventListener("click", openPicker);
searchInput.addEventListener("input", renderPicker);
el("pickerSkip").addEventListener("click", async () => { markOnboarded(); await closePanels(); });

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
  if (!customImg) fetchFaviconFor(svc);
  store.save(services); render();
  el("cName").value = ""; el("cUrl").value = ""; el("cIcon").value = "";
  clearCustomImg();
  markOnboarded();
  await closePanels();
});

// Favicons for custom services, best effort in order: Google,
// DuckDuckGo, the site's own /favicon.ico. CORS-readable results
// are stored as data URLs (work offline); runs once, kept in svc.img.
function faviconSources(host) {
  return [
    "https://www.google.com/s2/favicons?domain=" + host + "&sz=128",
    "https://icons.duckduckgo.com/ip3/" + host + ".ico",
    "https://" + host + "/favicon.ico",
  ];
}
function faviconAsDataUrl(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const to = setTimeout(() => resolve(null), 6000);
    img.onload = () => {
      clearTimeout(to);
      try {
        const w = Math.min(64, img.naturalWidth || 64);
        const h = Math.min(64, img.naturalHeight || 64);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/png"));
      } catch { resolve(null); }
    };
    img.onerror = () => { clearTimeout(to); resolve(null); };
    img.src = url;
  });
}
async function fetchFaviconFor(s) {
  if (s.img || s.brand) return;
  const host = hostOf(s.url);
  if (!host) return;
  for (const u of faviconSources(host)) {
    const d = await faviconAsDataUrl(u);
    if (d) { s.img = d; s.favicon = true; store.save(services); render(); return; }
  }
  s.img = faviconSources(host)[0];
  s.favicon = true;
  store.save(services); render();
}

// Service actions, shared by the right-click menu (quick actions) and
// the Kelola layanan panel (full management, v0.4.0).
function togglePin(s) {
  const nowPinned = !pinned.has(s.id);
  if (nowPinned) pinned.add(s.id); else pinned.delete(s.id);
  store.savePinned(pinned);
  invoke("set_pinned", { id: s.id, pinned: nowPinned });
  render();
}

// Disable = destroy the webview completely (RAM freed, nothing runs),
// but keep the profile folder: cookies/session survive on disk, so
// re-enabling never asks for a new login.
async function setServiceDisabled(s, off) {
  const id = s.id;
  if (!off) {
    disabled.delete(id);
  } else {
    disabled.add(id);
    await invoke("close_service", { id });
    if (activeId === id) {
      activeId = null;
      if (localStorage.getItem("sodium.lastActive") === id) localStorage.removeItem("sodium.lastActive"); scheduleConfigSave();
      el("activeName").textContent = "Sodium";
      el("welcome").style.display = "";
      showZoom();
    }
  }
  store.saveDisabled(disabled);
  render();
}

// Duplicate with a fresh, empty profile: same URL, icon and colours,
// next free number in the name ("WhatsApp 2", "WhatsApp 3", ...). No
// session or cookie is copied, so the copy is a clean sign-in for a
// different account. Pin and disabled state are per-service and are
// not inherited: the new id is in neither set.
function duplicateService(srcSvc) {
  const base = srcSvc.name.replace(/\s+\d+$/, "");
  let n = 2;
  while (services.some(s => s.name === base + " " + n)) n++;
  const copy = { ...srcSvc, id: srcSvc.id + "-d" + Date.now().toString(36), name: base + " " + n };
  services.push(copy);
  store.save(services);
  render();
  return copy;
}

// Delete removes the service from the list; its profile folder stays
// on disk either way, so re-adding it later restores the login.
async function deleteService(id) {
  services = services.filter(x => x.id !== id);
  store.save(services);
  if (pinned.has(id)) { pinned.delete(id); store.savePinned(pinned); invoke("set_pinned", { id, pinned: false }); }
  if (disabled.has(id)) { disabled.delete(id); store.saveDisabled(disabled); }
  if (activeId === id) {
    activeId = null;
    el("activeName").textContent = "Sodium";
    el("welcome").style.display = "";
  }
  if (localStorage.getItem("sodium.lastActive") === id) localStorage.removeItem("sodium.lastActive"); scheduleConfigSave();
  await invoke("close_service", { id });
  render();
}

async function openIconPanel(s) {
  iconTarget = s;
  el("iconTitle").textContent = "Ganti ikon: " + s.name;
  el("iconText").value = "";
  el("iconMsg").textContent = "";
  iconDraft = { color: s.color || "#262a33", iconColor: s.iconColor || "#ffffff" };
  refreshIconPanelImg();
  refreshIconColors();
  await openPanel(iconPanel);
}



function refreshIconPanelImg() {
  const has = !!(iconTarget && iconTarget.img);
  el("iconPreview").hidden = !has;
  el("iconRemoveImg").hidden = !has;
  if (has) el("iconPreview").src = iconTarget.img;
}

// Tile / logo colours and the custom icon text are a draft with a
// live preview and only land when Simpan is clicked; uploads apply
// at once (existing behaviour).
const COLOR_SWATCHES = ["#ffffff", "#e8eaf0", "#9aa3b5", "#14161a", "#f5c518", "#1faa55", "#229ed9", "#1877f2", "#5865f2", "#c13584", "#e60023", "#ee4d2d", "#ff4500", "#42b549", "#611f69", "#b20710"];
let iconDraft = { color: "#262a33", iconColor: "#ffffff" };

function buildSwatches(container, key) {
  container.innerHTML = "";
  for (const c of COLOR_SWATCHES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (iconDraft[key].toLowerCase() === c ? " sel" : "");
    b.style.background = c;
    b.title = c;
    b.setAttribute("aria-label", "Warna " + c);
    b.addEventListener("click", () => { iconDraft[key] = c; refreshIconColors(); });
    container.appendChild(b);
  }
}

function refreshIconColors() {
  if (!iconTarget) return;
  const hasImg = !!iconTarget.img;
  // An uploaded image covers the whole button, so a logo colour
  // cannot apply to it: that row is hidden while an image is set.
  el("logoColorRow").hidden = hasImg;
  buildSwatches(el("tilePalette"), "color");
  buildSwatches(el("logoPalette"), "iconColor");
  const pv = el("iconCombo");
  pv.innerHTML = "";
  pv.style.background = iconDraft.color;
  if (hasImg) {
    const im = document.createElement("img");
    im.className = "svcImg"; im.src = iconTarget.img; im.alt = "";
    pv.appendChild(im);
  } else {
    pv.appendChild(iconVisual({ brand: iconTarget.brand, icon: el("iconText").value.trim() || iconTarget.icon, name: iconTarget.name, iconColor: iconDraft.iconColor }, 28));
  }
}
el("iconText").addEventListener("input", refreshIconColors);

// Kelola layanan panel (v0.4.0): every service setting in one place —
// edit (name / icon / URL), reorder, pin, disable, duplicate, delete,
// plus the global "show names in the sidebar" toggle. Opened from the
// sidebar button under "+", or from the right-click menu.
const manageList = el("manageList");
let manageEditId = null;      // service id whose edit form is open
let manageDeleteArmed = null; // service id whose Hapus awaits a confirm click

async function openManage() {
  renderManage();
  await openPanel(managePanel);
}
el("manageBtn").addEventListener("click", openManage);
el("manageClose").addEventListener("click", closePanels);
el("showNamesToggle").addEventListener("change", () => {
  showNames = el("showNamesToggle").checked;
  localStorage.setItem("sodium.showNames", showNames ? "1" : "0"); scheduleConfigSave();
  render();
});
el("iconSizeSel").addEventListener("change", () => {
  iconSize = Number(el("iconSizeSel").value) || 48;
  localStorage.setItem("sodium.iconSize", String(iconSize)); scheduleConfigSave();
  applyIconSize();
  render();
});

function mgButton(text, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function renderManage() {
  el("showNamesToggle").checked = showNames;
  el("iconSizeSel").value = String(iconSize);
  manageList.innerHTML = "";
  services.forEach((s, idx) => {
    const row = document.createElement("div");
    row.className = "mgRow" + (disabled.has(s.id) ? " off" : "");
    const ic = document.createElement("span");
    ic.className = "tileIcon mgIcon";
    if (s.img) {
      const im = document.createElement("img");
      im.className = "svcImg"; im.src = s.img; im.alt = "";
      im.onerror = () => { im.replaceWith(iconVisual(s, 24)); if (s.color) ic.style.background = s.color; };
      ic.appendChild(im);
    } else {
      if (s.color) ic.style.background = s.color;
      ic.appendChild(iconVisual(s, 24));
    }
    const info = document.createElement("div");
    info.className = "mgInfo";
    const nm = document.createElement("div");
    nm.className = "mgName"; nm.textContent = s.name;
    const sub = document.createElement("div");
    sub.className = "mgSub"; sub.textContent = s.url; sub.title = s.url;
    info.append(nm, sub);
    const status = [pinned.has(s.id) ? "Pin" : "", disabled.has(s.id) ? "Nonaktif" : ""].filter(Boolean).join(" · ");
    if (status) {
      const st = document.createElement("div");
      st.className = "mgStatus"; st.textContent = status;
      info.appendChild(st);
    }
    const btns = document.createElement("div");
    btns.className = "mgBtns";
    const up = mgButton("↑", "btnGhost", () => moveService(idx, -1));
    up.disabled = idx === 0;
    up.title = "Pindah ke atas";
    const down = mgButton("↓", "btnGhost", () => moveService(idx, 1));
    down.disabled = idx === services.length - 1;
    down.title = "Pindah ke bawah";
    btns.append(
      up, down,
      mgButton("Edit", "btnGhost", () => { manageEditId = manageEditId === s.id ? null : s.id; manageDeleteArmed = null; renderManage(); }),
      mgButton(pinned.has(s.id) ? "Unpin" : "Pin", "btnGhost", () => { togglePin(s); renderManage(); }),
      mgButton(disabled.has(s.id) ? "Aktifkan" : "Nonaktif", "btnGhost", async () => { await setServiceDisabled(s, !disabled.has(s.id)); renderManage(); }),
      mgButton("Duplikat", "btnGhost", () => { duplicateService(s); renderManage(); }),
      mgButton(manageDeleteArmed === s.id ? "Yakin hapus?" : "Hapus", "btnDanger", async () => {
        if (manageDeleteArmed !== s.id) { manageDeleteArmed = s.id; renderManage(); return; }
        manageDeleteArmed = null;
        if (manageEditId === s.id) manageEditId = null;
        await deleteService(s.id);
        renderManage();
      }),
    );
    row.append(ic, info, btns);
    if (manageEditId === s.id) row.appendChild(buildManageForm(s));
    manageList.appendChild(row);
  });
}

function moveService(idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= services.length) return;
  const it = services[idx];
  services[idx] = services[j];
  services[j] = it;
  store.save(services);
  render();
  renderManage();
}

function buildManageForm(s) {
  const form = document.createElement("div");
  form.className = "mgForm";
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Nama layanan";
  const nameIn = document.createElement("input");
  nameIn.value = s.name;
  nameIn.maxLength = 40;
  nameLabel.appendChild(nameIn);
  const urlLabel = document.createElement("label");
  urlLabel.textContent = "URL";
  const urlIn = document.createElement("input");
  urlIn.value = s.url;
  urlIn.spellcheck = false;
  urlLabel.appendChild(urlIn);
  const warn = document.createElement("p");
  warn.className = "mgWarn";
  warn.hidden = true;
  const oldHost = hostOf(s.url);
  urlIn.addEventListener("input", () => {
    const nh = hostOf(urlIn.value.trim());
    warn.hidden = !(nh && oldHost && nh !== oldHost);
    if (!warn.hidden) {
      warn.textContent = "Host berubah (" + oldHost + " → " + nh + "): webview layanan ditutup dan dibuka ulang pakai alamat baru. Sesi login lama tetap tersimpan di profil layanan ini.";
    }
  });
  const btns = document.createElement("div");
  btns.className = "mgFormBtns";
  btns.append(
    mgButton("Ganti ikon", "btnGhost", () => openIconPanel(s)),
    mgButton("Batal", "btnGhost", () => { manageEditId = null; renderManage(); }),
    mgButton("Simpan", "btnPrimary", () => saveManageEdit(s, nameIn, urlIn)),
  );
  form.append(nameLabel, urlLabel, warn, btns);
  return form;
}

// The name is a label only (everything is keyed by id). A changed
// URL closes the webview; a fetched favicon is dropped and refetched.
async function saveManageEdit(s, nameIn, urlIn) {
  const name = nameIn.value.trim();
  let url = urlIn.value.trim();
  if (!name || !url) return;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const urlChanged = url !== s.url;
  s.name = name;
  if (activeId === s.id) el("activeName").textContent = name;
  manageEditId = null;
  store.save(services);
  render();
  renderManage();
  if (urlChanged) {
    s.url = url;
    store.save(services);
    await invoke("close_service", { id: s.id });
    if (!s.brand && s.favicon) {
      delete s.img;
      delete s.favicon;
      store.save(services);
      fetchFaviconFor(s);
    }
    render();
    renderManage();
    if (activeId === s.id) await switchTo(s);
  }
}

el("iconSave").addEventListener("click", async () => {
  if (!iconTarget) return;
  const v = el("iconText").value.trim();
  if (v) { iconTarget.icon = v; delete iconTarget.img; delete iconTarget.favicon; }
  iconTarget.color = iconDraft.color;
  iconTarget.iconColor = iconDraft.iconColor;
  store.save(services); render();
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
    delete iconTarget.favicon;
    store.save(services); render();
    await closePanels();
  } catch (err) {
    el("iconMsg").textContent = String(err && err.message || err);
  }
});
el("iconRemoveImg").addEventListener("click", async () => {
  if (!iconTarget) return;
  delete iconTarget.img;
  delete iconTarget.favicon;
  store.save(services); render();
  await closePanels();
});

// Link popup
//
// Links inside a service that ask for a new window (target=_blank,
// window.open) are denied by Rust and reported here as a "link-clicked"
// event instead. The UI shows the link bar and asks Rust to open the
// popup webview floating over the active service.
const linkBar = el("linkBar");
let linkPopupOpen = false;
let currentLink = "";
window.__TAURI__.event.listen("link-clicked", async (e) => {
  const url = String(e.payload || "");
  if (!url) return;
  currentLink = url;
  el("linkUrlText").textContent = url;
  el("linkUrlText").title = url;
  el("linkCopy").textContent = "Salin link";
  linkBar.hidden = false;
  linkPopupOpen = true;
  try { await invoke("open_link_popup", { url }); }
  catch { /* popup failed to open; the bar still offers copy / external */ }
});
async function closeLinkPopup() {
  if (!linkPopupOpen) return;
  linkPopupOpen = false;
  linkBar.hidden = true;
  await invoke("close_link_popup");
}
el("linkClose").addEventListener("click", closeLinkPopup);
el("linkExternal").addEventListener("click", async () => {
  if (currentLink) { try { await invoke("open_external", { url: currentLink }); } catch { /* ignore */ } }
  closeLinkPopup();
});
el("linkCopy").addEventListener("click", async () => {
  if (!currentLink) return;
  try { await navigator.clipboard.writeText(currentLink); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = currentLink;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  el("linkCopy").textContent = "Tersalin ✓";
  setTimeout(() => { el("linkCopy").textContent = "Salin link"; }, 1500);
});

// Downloads: Rust reports starts and finishes. Starts drive the
// top-bar pill; finishes feed the toast and the history panel
// (kept in localStorage, newest first, capped at 50).
let toastTimer = null;
function showToast(text, title) {
  const toast = el("toast");
  toast.textContent = text;
  toast.title = title || text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}

let downloads = [];
try { downloads = JSON.parse(localStorage.getItem("sodium.downloads") || "[]"); } catch { downloads = []; }
let activeDownloads = 0;

function saveDownloads() {
  localStorage.setItem("sodium.downloads", JSON.stringify(downloads.slice(0, 50)));
  scheduleConfigSave();
}

function sourceName(sourceId) {
  if (sourceId === "link-popup") return "Popup link";
  const s = services.find(x => x.id === sourceId);
  return s ? s.name : sourceId;
}

window.__TAURI__.event.listen("download-started", (e) => {
  activeDownloads += 1;
  const pill = el("dlPill");
  pill.textContent = "Mengunduh: " + String(e.payload || "file") + "…";
  pill.hidden = false;
});

window.__TAURI__.event.listen("download-finished", (e) => {
  const [path, sourceId, success] = e.payload || [];
  activeDownloads = Math.max(0, activeDownloads - 1);
  if (activeDownloads === 0) el("dlPill").hidden = true;
  if (success && path) {
    const name = String(path).split(/[\\/]/).pop();
    downloads.unshift({ name, path: String(path), source: sourceId || "", time: Date.now() });
    saveDownloads();
    showToast("Tersimpan: " + path, path);
    if (!dlPanel.hidden) renderDownloads();
  } else if (!success) {
    showToast("Unduhan gagal atau dibatalkan.");
  }
});

function renderDownloads() {
  const list = el("dlList");
  list.innerHTML = "";
  if (!downloads.length) {
    const d = document.createElement("div");
    d.className = "dlEmpty";
    d.textContent = "Belum ada unduhan.";
    list.appendChild(d);
    return;
  }
  for (const d of downloads) {
    const row = document.createElement("div");
    row.className = "dlRow";
    const info = document.createElement("div");
    info.className = "dlInfo";
    const name = document.createElement("div");
    name.className = "dlName";
    name.textContent = d.name;
    name.title = d.path;
    const meta = document.createElement("div");
    meta.className = "dlMeta";
    meta.textContent = sourceName(d.source) + " · " + new Date(d.time).toLocaleString("id-ID");
    info.append(name, meta);
    const btn = document.createElement("button");
    btn.className = "btnGhost";
    btn.textContent = "Buka folder";
    btn.addEventListener("click", () => invoke("reveal_file", { path: d.path }).catch(() => {}));
    row.append(info, btn);
    list.appendChild(row);
  }
}

el("dlBtn").addEventListener("click", () => { renderDownloads(); openPanel(dlPanel); });
el("dlClose").addEventListener("click", closePanels);
el("reloadBtn").addEventListener("click", () => { invoke("reload_service").catch(() => {}); });

// Update check against the public GitHub repo: the latest release
// is compared with the running version; the installer asset is
// opened in the browser, where the download happens.
let appVer = "";
let updateAssetUrl = "";
function versionNewer(latest, current) {
  const a = String(latest).split(".").map(n => parseInt(n, 10) || 0);
  const b = String(current).split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

async function checkUpdate(manual) {
  try {
    const res = await fetch("https://api.github.com/repos/aindranto/Sodium/releases/latest", {
      headers: { "Accept": "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error("http " + res.status);
    const rel = await res.json();
    const latest = String(rel.tag_name || "").replace(/^v/, "");
    if (!latest || !appVer) throw new Error("no version");
    if (!versionNewer(latest, appVer)) {
      if (manual) showToast("Sodium sudah versi terbaru (v" + appVer + ").");
      return;
    }
    const asset = (rel.assets || []).find(a => /setup\.exe$/i.test(a.name)) || (rel.assets || [])[0];
    updateAssetUrl = asset ? asset.browser_download_url : rel.html_url;
    el("updateTitle").textContent = "Sodium v" + latest + " tersedia";
    el("updateBody").textContent = (rel.body || "").trim() || "Catatan rilis tidak tersedia.";
    openPanel(updatePanel);
  } catch {
    if (manual) showToast("Gagal memeriksa update — periksa koneksi internet.");
  }
}

function scheduleDailyUpdateCheck() {
  const today = new Date().toDateString();
  if (localStorage.getItem("sodium.lastUpdateCheck") === today) return;
  localStorage.setItem("sodium.lastUpdateCheck", today); scheduleConfigSave();
  setTimeout(() => checkUpdate(false), 5000);
}

el("updateBtn").addEventListener("click", () => checkUpdate(true));
el("updateLater").addEventListener("click", closePanels);
el("updateDownload").addEventListener("click", () => {
  if (updateAssetUrl) invoke("open_external", { url: updateAssetUrl }).catch(() => {});
  closePanels();
});

// Read the version from the app so it cannot go stale.
window.__TAURI__.app.getVersion()
  .then(v => { appVer = v; el("appVersion").textContent = "Sodium v" + v; })
  .catch(() => {});

// Unread badge counts from Rust (page-title watcher in each service
// webview). Re-render the sidebar so the number appears/clears.
window.__TAURI__.event.listen("unread-changed", (e) => {
  const [id, count] = e.payload;
  if (count > 0) unread.set(id, count); else unread.delete(id);
  render();
});

// Ctrl+1..9 also arrives from Rust as a global shortcut while the
// Sodium window is focused (registered on window focus, released on
// blur), because keydown inside a service webview never reaches this UI.
window.__TAURI__.event.listen("shortcut-switch", (e) => {
  const s = services[Number(e.payload)];
  if (s) switchTo(s);
});

// Keyboard: Escape closes the link popup or any open panel;
// Ctrl/Cmd + 1..9 switches services.
window.addEventListener("keydown", async (e) => {
  if (e.key === "Escape") {
    if (linkPopupOpen) { await closeLinkPopup(); return; }
    if (allPanels.some(p => !p.hidden)) { await closePanels(); return; }
  }
  if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
    const s = services[Number(e.key) - 1]; if (s) switchTo(s);
  }
});

// Zoom for the service view (browser-style page zoom), remembered PER
// SERVICE: WhatsApp can sit at 125% while Gmail stays at 100%. The old
// single "sodium.zoom" value remains as the default for services that
// have never been adjusted individually.
const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];
function getDefaultZoom() { return parseFloat(localStorage.getItem("sodium.zoom") || "1") || 1; }
let zoomByService = {};
try { zoomByService = JSON.parse(localStorage.getItem("sodium.zoomByService") || "{}"); } catch { zoomByService = {}; }
function zoomFor(id) { return (id && zoomByService[id]) || getDefaultZoom(); }
function zoomIdxFor(id) {
  const i = ZOOM_STEPS.indexOf(zoomFor(id));
  return i < 0 ? ZOOM_STEPS.indexOf(1.0) : i;
}
function showZoom() { el("zoomLabel").textContent = Math.round(zoomFor(activeId) * 100) + "%"; }
async function setZoomIdx(idx) {
  const scale = ZOOM_STEPS[idx];
  if (activeId) {
    zoomByService[activeId] = scale;
    localStorage.setItem("sodium.zoomByService", JSON.stringify(zoomByService)); scheduleConfigSave();
    await invoke("set_service_zoom", { id: activeId, scale });
  } else {
    // No service open: the buttons adjust the default for new services.
    localStorage.setItem("sodium.zoom", String(scale)); scheduleConfigSave();
  }
  showZoom();
}
el("zoomIn").addEventListener("click", () => { const i = zoomIdxFor(activeId); if (i < ZOOM_STEPS.length - 1) setZoomIdx(i + 1); });
el("zoomOut").addEventListener("click", () => { const i = zoomIdxFor(activeId); if (i > 0) setZoomIdx(i - 1); });
el("zoomLabel").addEventListener("click", () => setZoomIdx(ZOOM_STEPS.indexOf(1.0)));
showZoom();

// Startup: a newer config.json (Rust side) replaces the local
// working copy first; only then are settings pushed to Rust and
// the last session restored.
init();
async function init() {
  await applyConfigFromRust();

  // "Hidup bareng" setting: how many non-pinned services may stay
  // alive. Stored locally, pushed to Rust on startup and on change.
  const maxAliveSel = el("maxAlive");
  const savedMax = localStorage.getItem("sodium.maxAlive") || "1";
  maxAliveSel.value = savedMax;
  invoke("set_max_alive", { max: Number(savedMax) });
  maxAliveSel.addEventListener("change", () => {
    localStorage.setItem("sodium.maxAlive", maxAliveSel.value); scheduleConfigSave();
    invoke("set_max_alive", { max: Number(maxAliveSel.value) });
  });

  // Restore pinned flags into the Rust side on startup
  for (const id of pinned) invoke("set_pinned", { id, pinned: true });
  render();

  // One-time favicon fetch for services that still have no icon image
  // (new custom services fetch theirs when they are added).
  for (const s of services) fetchFaviconFor(s);

  // Pinned services start hidden so their notifications work from
  // boot; the visible restore below reuses the webview if the
  // restored service is the pinned one.
  for (const id of pinned) {
    const s = services.find(x => x.id === id);
    if (s && !disabled.has(id)) {
      try { await invoke("start_service_hidden", { id: s.id, url: s.url }); } catch {}
    }
  }

  // First run: show the service picker once. Otherwise reopen the
  // service that was active when Sodium was closed, like Ferdium
  // does, instead of landing on the welcome screen.
  if (!localStorage.getItem("sodium.onboarded")) {
    openPicker();
  } else {
    const lastId = localStorage.getItem("sodium.lastActive");
    const last = services.find(s => s.id === lastId);
    if (last && !disabled.has(last.id)) switchTo(last);
  }
  scheduleDailyUpdateCheck();
}

async function applyConfigFromRust() {
  try {
    const text = await Promise.race([
      invoke("load_config"),
      new Promise(r => setTimeout(() => r(null), 800)),
    ]);
    if (!text) { scheduleConfigSave(); return; }
    const snap = JSON.parse(text);
    if (!snap || !snap.data || !(snap.rev > cfgRev)) return;
    applyingConfig = true;
    for (const k of CFG_KEYS) {
      if (k in snap.data) localStorage.setItem(k, snap.data[k]);
      else localStorage.removeItem(k);
    }
    cfgRev = snap.rev;
    localStorage.setItem("sodium.cfgRev", String(cfgRev));
    applyingConfig = false;
    services = store.load();
    pinned = store.pinned();
    disabled = store.disabled();
    showNames = localStorage.getItem("sodium.showNames") === "1";
    iconSize = parseInt(localStorage.getItem("sodium.iconSize") || "48", 10) || 48;
    applyIconSize();
    try { zoomByService = JSON.parse(localStorage.getItem("sodium.zoomByService") || "{}"); } catch { zoomByService = {}; }
    el("showNamesToggle").checked = showNames;
  } catch { applyingConfig = false; }
}
