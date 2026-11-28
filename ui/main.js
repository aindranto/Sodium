// Sodium UI - no framework, no bundler. Sidebar + service picker.
// The heavy lifting (creating / destroying webviews) happens in Rust:
// see src-tauri/src/lib.rs -> switch_service()

// Catalog of popular services with their official web apps, shown in the
// picker (first run, and whenever "+" is clicked). "slug" points into
// ICON_PATHS (icons.js, Simple Icons paths): the service renders as the
// real brand logo, drawn in the service's iconColor on its colour tile.
// Entries without a slug are not in Simple Icons (Tokopedia, Lazada,
// OpenAI/ChatGPT) and render a generic glyph instead ("glyph" key into
// GLYPHS, icons.js). No emoji anywhere since v0.8.0.
const CATALOG = [
  { id: "whatsapp",  name: "WhatsApp",        url: "https://web.whatsapp.com/",        color: "#1faa55", slug: "whatsapp" },
  { id: "telegram",  name: "Telegram",        url: "https://web.telegram.org/k/",      color: "#229ed9", slug: "telegram" },
  { id: "instagram", name: "Instagram",       url: "https://www.instagram.com/",       color: "#c13584", slug: "instagram" },
  { id: "messenger", name: "Messenger",       url: "https://www.messenger.com/",       color: "#0084ff", slug: "messenger" },
  { id: "discord",   name: "Discord",         url: "https://discord.com/channels/@me", color: "#5865f2", slug: "discord" },
  { id: "gmail",     name: "Gmail",           url: "https://mail.google.com/",         color: "#d93025", slug: "gmail" },
  { id: "facebook",  name: "Facebook",        url: "https://www.facebook.com/",        color: "#1877f2", slug: "facebook" },
  { id: "tiktok",    name: "TikTok",          url: "https://www.tiktok.com/",          color: "#161823", slug: "tiktok" },
  { id: "youtube",   name: "YouTube",         url: "https://www.youtube.com/",         color: "#ff0000", slug: "youtube" },
  { id: "twitter",   name: "X (Twitter)",     url: "https://x.com/",                   color: "#14171a", slug: "x" },
  { id: "slack",     name: "Slack",           url: "https://app.slack.com/client",     color: "#611f69", slug: "slack" },
  { id: "teams",     name: "Microsoft Teams", url: "https://teams.microsoft.com/",     color: "#4b53bc", slug: "microsoftteams" },
  { id: "gcal",      name: "Google Calendar", url: "https://calendar.google.com/",     color: "#4285f4", slug: "googlecalendar" },
  { id: "spotify",   name: "Spotify",         url: "https://open.spotify.com/",        color: "#1db954", slug: "spotify" },
  { id: "github",    name: "GitHub",          url: "https://github.com/",              color: "#24292e", slug: "github" },
  { id: "linkedin",  name: "LinkedIn",        url: "https://www.linkedin.com/",        color: "#0a66c2", slug: "linkedin" },
  { id: "reddit",    name: "Reddit",          url: "https://www.reddit.com/",          color: "#ff4500", slug: "reddit" },
  { id: "pinterest", name: "Pinterest",       url: "https://www.pinterest.com/",       color: "#e60023", slug: "pinterest" },
  { id: "netflix",   name: "Netflix",         url: "https://www.netflix.com/",         color: "#b20710", slug: "netflix" },
  { id: "tokopedia", name: "Tokopedia",       url: "https://www.tokopedia.com/",       color: "#42b549", glyph: "bag" },
  { id: "shopee",    name: "Shopee",          url: "https://shopee.co.id/",            color: "#ee4d2d", slug: "shopee" },
  { id: "lazada",    name: "Lazada",          url: "https://www.lazada.co.id/",        color: "#0f146d", glyph: "bag" },
  { id: "blibli",    name: "Blibli",          url: "https://www.blibli.com/",          color: "#0072ff", slug: "blibli" },
  { id: "bukalapak", name: "Bukalapak",       url: "https://www.bukalapak.com/",       color: "#e31e52", slug: "bukalapak" },
  { id: "threads",   name: "Threads",         url: "https://www.threads.net/",         color: "#14171a", slug: "threads" },
  { id: "chatgpt",   name: "ChatGPT",         url: "https://chatgpt.com/",             color: "#10a37f", glyph: "chat" },
  { id: "gemini",    name: "Google Gemini",   url: "https://gemini.google.com/",       color: "#8e75b2", slug: "googlegemini" },
  { id: "claude",    name: "Claude",          url: "https://claude.ai/",               color: "#d97757", slug: "claude" },
  { id: "notion",    name: "Notion",          url: "https://www.notion.so/",           color: "#14161a", slug: "notion" },
  { id: "zoom",      name: "Zoom",            url: "https://zoom.us/",                 color: "#2d8cff", slug: "zoom" },
  { id: "gdrive",    name: "Google Drive",    url: "https://drive.google.com/",        color: "#0066da", slug: "googledrive" },
];


const DEFAULT_SERVICES = [
  // WhatsApp is pre-added; everything else comes from the picker.
  { id: "whatsapp", name: "WhatsApp", url: "https://web.whatsapp.com/", icon: "Wa", color: "#1faa55", brand: "whatsapp", iconColor: "#ffffff" },
];

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
const CFG_KEYS = ["sodium.services", "sodium.pinned", "sodium.disabled", "sodium.groups", "sodium.showNames", "sodium.lastActive", "sodium.onboarded", "sodium.zoom", "sodium.zoomByService", "sodium.maxAlive", "sodium.downloads", "sodium.lastUpdateCheck", "sodium.iconSize", "sodium.ytAdblock", "sodium.ytAdblockInfo", "sodium.ytAdblockScript", "sodium.splitRatio", "sodium.splitCompanion"];
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

// A service's group name (free text set in the Kelola panel);
// "" means ungrouped. Groups only affect sidebar separators,
// the quick switcher captions and "Mulai kelompok".
function groupOf(s) {
  return (s && s.group ? String(s.group) : "").trim();
}

// A service's notification permission mode: "allow" (also when
// the field is absent), "default" (leave the request to WebView2)
// or "deny". The answer itself is given by Rust's permission
// handler on the service webview, so the mode is mirrored there
// with set_service_notif — at startup for every service, and
// whenever the edit dialog saves.
function notifModeOf(s) {
  return s && (s.notif === "default" || s.notif === "deny") ? s.notif : "allow";
}
function pushNotifPolicy(s) {
  invoke("set_service_notif", { id: s.id, mode: notifModeOf(s) }).catch(() => {});
}

// A service's microphone/camera permission mode (v0.8.8): one
// shared mode for both kinds, stored and mirrored exactly like
// the notification mode — Rust's permission handler on the
// service webview answers both kinds from it via set_service_media.
function mediaModeOf(s) {
  return s && (s.media === "default" || s.media === "deny") ? s.media : "allow";
}
function pushMediaPolicy(s) {
  invoke("set_service_media", { id: s.id, mode: mediaModeOf(s) }).catch(() => {});
}

// Persistent, ordered list of group names (v0.8.8). Before this,
// a group existed only while a service used it: empty groups were
// invisible everywhere and vanished when their last service moved
// out. The list keeps empty groups alive so Kelola can show them
// (with a drop slot); the sidebar still derives its separators
// from the services themselves, so empty groups render nothing
// there. Names compare case-insensitively everywhere here: the
// list never holds two names that differ only by case.
let groups = [];
function sameGroupName(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}
function canonicalGroup(name) {
  const hit = groups.find(g => sameGroupName(g, name));
  return hit || String(name || "").trim();
}
function groupIsEmpty(name) {
  return !services.some(s => sameGroupName(groupOf(s), name));
}
function saveGroups() {
  localStorage.setItem("sodium.groups", JSON.stringify(groups));
  scheduleConfigSave();
}
function loadGroups() {
  let stored = [];
  try { stored = JSON.parse(localStorage.getItem("sodium.groups") || "[]"); } catch { stored = []; }
  if (!Array.isArray(stored)) stored = [];
  groups = [];
  for (const g of stored) {
    const name = String(g || "").trim();
    if (name && !groups.some(x => sameGroupName(x, name))) groups.push(name);
  }
  // Migration / union: every group a service uses joins the list,
  // in first-appearance order, so the list always covers the
  // derived groups too.
  let changed = JSON.stringify(groups) !== JSON.stringify(stored);
  for (const s of services) {
    const g = groupOf(s);
    if (g && !groups.some(x => sameGroupName(x, g))) { groups.push(g); changed = true; }
  }
  if (changed) saveGroups();
}
loadGroups();

// ------------------------------------------------------------------
// Split view (v0.9.0): two services side by side — the main
// (left) pane, which the sidebar / reload / bell keep
// controlling exactly as before, and a companion (right) pane.
// v0.9.1 adds the companion header strip (name + Ganti /
// Tutup) over the right pane and replace-picking: Ganti
// re-opens the picker there while Rust parks the companion.
// Rust owns the native layout (bounds, the double gate, the
// cursor-polled divider drag); this side owns the choices: the
// ratio and the companion id are persisted here (localStorage +
// config.json mirror), and the mode itself is restored at
// startup only when the gate passes at that moment.
//
// The geometry constants mirror the Rust layout (DIVIDER_W /
// MIN_PANE_W in lib.rs) so the divider strip and the companion
// picker land exactly on the boundary Rust computes.
const SPLIT_DIVIDER_W = 6;
const SPLIT_MIN_PANE = 400;
let splitOn = false;
let splitGateOk = false;
let splitRatio = 0.5;
let companionId = null;
// Replace-picking (v0.9.1): true while the picker is open in
// the right pane to CHANGE an existing companion. The current
// companion stays chosen (and persisted) the whole time; Rust
// parks its webview behind the picker (split_set_picking), so
// Batal / Esc brings the exact same view back, and picking
// another service simply replaces it.
let splitPicking = false;
// What the companion header strip last painted (companion id
// + name), so layoutSplitChrome only rebuilds its icon when
// the companion actually changed; render() clears it so
// renames and icon edits repaint too.
let barRenderedKey = null;
function reloadSplitPrefs() {
  const r = parseFloat(localStorage.getItem("sodium.splitRatio") || "0.5");
  splitRatio = Number.isFinite(r) && r > 0 && r < 1 ? r : 0.5;
  companionId = localStorage.getItem("sodium.splitCompanion") || null;
}
reloadSplitPrefs();
function saveSplitPrefs() {
  localStorage.setItem("sodium.splitRatio", String(splitRatio));
  if (companionId) localStorage.setItem("sodium.splitCompanion", companionId);
  else localStorage.removeItem("sodium.splitCompanion");
  scheduleConfigSave();
}
// The main pane's width in logical px for the current window,
// clamped exactly like the Rust layout clamps it.
function splitMainW() {
  const avail = Math.max(0, window.innerWidth - 76 - SPLIT_DIVIDER_W);
  if (avail <= 0) return 0;
  const minMain = Math.min(SPLIT_MIN_PANE, avail / 2);
  return Math.min(Math.max(avail * splitRatio, minMain), avail - minMain);
}
function refreshSplitBtn() {
  const btn = el("splitBtn");
  btn.hidden = !splitGateOk;
  btn.classList.toggle("on", splitOn);
  btn.setAttribute("aria-pressed", splitOn ? "true" : "false");
  btn.title = splitOn ? "Matikan tampilan split" : "Tampilan split (dua layanan berdampingan)";
}
// Position the divider strip, the companion picker and the
// companion header strip over the content area. Called on
// every split state change and on window resize; cheap style
// writes only, no layout reads.
function layoutSplitChrome() {
  const div = el("splitDivider");
  const picker = el("splitPicker");
  const bar = el("companionBar");
  if (!splitOn) { div.hidden = true; picker.hidden = true; bar.hidden = true; return; }
  const mainW = splitMainW();
  div.hidden = false;
  div.style.left = (76 + mainW) + "px";
  const avail = Math.max(1, window.innerWidth - 76 - SPLIT_DIVIDER_W);
  div.setAttribute("aria-valuenow", String(Math.round(mainW / avail * 100)));
  const rightLeft = 76 + mainW + SPLIT_DIVIDER_W;
  if (companionId && !splitPicking) {
    // Companion on display: its header strip owns the top of
    // the right pane (Rust shrinks the webview by the same
    // 32px to make room), the picker hides.
    picker.hidden = true;
    bar.hidden = false;
    bar.style.left = rightLeft + "px";
    const s = services.find(x => x.id === companionId);
    const key = companionId + "|" + (s ? s.name : "");
    if (barRenderedKey !== key) { barRenderedKey = key; renderCompanionBar(); }
  } else {
    // No companion yet, or re-picking one: the picker fills
    // the right pane and the strip hides. The Batal footer
    // and the hint text only make sense in replace mode.
    bar.hidden = true;
    picker.hidden = false;
    picker.style.left = rightLeft + "px";
    el("splitPickerFoot").hidden = !splitPicking;
    el("splitPickerHint").textContent = splitPicking
      ? "Pilih layanan lain untuk mengganti pendamping di panel kanan. Batal (atau tombol Esc) menampilkan lagi pendamping yang sekarang."
      : "Layanan ini tampil di panel kanan, berdampingan dengan layanan utama. Matikan tampilan split dari tombol split di bar atas untuk menutup pemilih ini.";
  }
}
// Paint the companion header strip: the companion service's
// small icon and name (same icon-building pattern as the
// picker tiles). Called by layoutSplitChrome only when the
// companion or its name changed.
function renderCompanionBar() {
  const s = services.find(x => x.id === companionId);
  const ic = el("companionIcon");
  ic.innerHTML = "";
  ic.style.background = "";
  el("companionName").textContent = s ? s.name : "";
  if (!s) return;
  if (s.img) {
    const im = document.createElement("img");
    im.className = "svcImg"; im.src = s.img; im.alt = "";
    const f = imgFilter(s); if (f) im.style.filter = f;
    im.onerror = () => { im.replaceWith(iconVisual(s, 13)); if (s.color) ic.style.background = s.color; };
    ic.appendChild(im);
  } else {
    if (s.color) ic.style.background = s.color;
    ic.appendChild(iconVisual(s, 13));
  }
}
function renderSplitPicker() {
  const grid = el("splitGrid");
  if (!grid) return;
  grid.innerHTML = "";
  for (const s of services) {
    if (s.id === activeId || disabled.has(s.id)) continue;
    const t = document.createElement("button");
    t.type = "button";
    t.className = "tile";
    t.title = "Jadikan " + s.name + " pendamping di panel kanan";
    const ic = document.createElement("span");
    ic.className = "tileIcon";
    if (s.img) {
      const im = document.createElement("img");
      im.className = "svcImg"; im.src = s.img; im.alt = "";
      const f = imgFilter(s); if (f) im.style.filter = f;
      im.onerror = () => { im.replaceWith(iconVisual(s, 28)); if (s.color) ic.style.background = s.color; };
      ic.appendChild(im);
    } else {
      if (s.color) ic.style.background = s.color;
      ic.appendChild(iconVisual(s, 28));
    }
    const nm = document.createElement("span");
    nm.className = "tileName"; nm.textContent = s.name;
    t.append(ic, nm);
    t.addEventListener("click", () => {
      // In replace mode, picking the service that already is
      // the companion changes nothing: it is the Batal path.
      if (splitPicking && s.id === companionId) { cancelSplitPick(); return; }
      setCompanion(s);
    });
    grid.appendChild(t);
  }
  if (!grid.children.length) {
    const d = document.createElement("div");
    d.className = "pickerEmpty";
    d.textContent = "Tidak ada layanan lain yang bisa jadi pendamping. Tambah layanan dulu lewat tombol + di sidebar.";
    grid.appendChild(d);
  }
}
async function enterSplit(restoreCompanion = true) {
  if (!activeId || !splitGateOk || splitOn) return;
  splitOn = true;
  splitPicking = false;
  refreshSplitBtn();
  try { await invoke("split_enter", { ratio: splitRatio }); } catch { /* gate still rules in Rust */ }
  if (restoreCompanion && companionId) {
    const comp = services.find(s => s.id === companionId);
    if (comp && comp.id !== activeId && !disabled.has(comp.id)) {
      await setCompanion(comp);
    } else {
      companionId = null;
      saveSplitPrefs();
    }
  }
  layoutSplitChrome();
  if (!companionId) renderSplitPicker();
}
async function exitSplit() {
  if (!splitOn) return;
  splitOn = false;
  splitPicking = false;
  refreshSplitBtn();
  layoutSplitChrome();
  try { await invoke("split_exit"); } catch { /* nothing to undo */ }
}
// Pick a companion: its webview is created through the same
// path as a normal switch (own zoom pushed first, profile and
// permission handlers from Rust's create path), so the
// first-open permission ask (v0.8.8) fires for it too.
async function setCompanion(s) {
  // A choice ends any replace pick in progress (Rust's
  // split_set_companion resets its picking flag too): the old
  // companion is hidden by the layout, never closed, and the
  // new one takes the right pane under its header strip.
  splitPicking = false;
  companionId = s.id;
  saveSplitPrefs();
  try {
    await invoke("set_service_zoom", { id: s.id, scale: zoomFor(s.id) });
    await invoke("split_set_companion", { id: s.id, url: s.url });
  } catch { /* pane stays empty; the picker remains available */ }
  layoutSplitChrome();
  if (!s.permAsked) openPermDialog(s);
}
async function clearCompanion() {
  splitPicking = false;
  companionId = null;
  saveSplitPrefs();
  try { await invoke("split_set_companion", { id: null, url: null }); } catch { /* already gone */ }
  layoutSplitChrome();
  if (splitOn) renderSplitPicker();
}
// "Ganti" on the companion header strip (v0.9.1): re-open the
// picker in the right pane to choose a different companion.
// The current companion is PARKED by Rust (split_set_picking),
// never closed, so cancelling brings the exact same view
// back; choosing another service replaces it via setCompanion.
async function startReplacePick() {
  if (!splitOn || !companionId || splitPicking) return;
  splitPicking = true;
  renderSplitPicker();
  layoutSplitChrome();
  try { await invoke("split_set_picking", { picking: true }); } catch { /* companion stays shown */ }
}
// Batal / Esc in replace mode: close the picker and show the
// same companion again under its strip.
async function cancelSplitPick() {
  if (!splitPicking) return;
  splitPicking = false;
  layoutSplitChrome();
  try { await invoke("split_set_picking", { picking: false }); } catch { /* already restored */ }
}

// Top-bar bell (v0.8.5): a second door to the same per-service
// notification setting as the edit dialog. The icon mirrors the
// ACTIVE service's effective mode — plain bell for "allow", a
// dimmed bell for "default", a slashed bell for "deny" — and the
// click opens the small anchored menu (notifMenu) with the three
// choices. refreshNotifBtn() runs at the end of every render(),
// which covers service switches, edit-dialog saves, deletion /
// disabling of the active service, config import and startup.
const NOTIF_LABELS = { allow: "Diizinkan", default: "Ikuti bawaan", deny: "Ditolak" };
function bellSvg(mode) {
  const slash = mode === "deny" ? '<path d="M4.5 4.5l15 15"/>' : "";
  return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 3h-15L6 16z"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>' + slash + "</svg>";
}
function refreshNotifBtn() {
  const btn = el("notifBtn");
  const s = services.find(x => x.id === activeId);
  if (!s) { btn.hidden = true; return; }
  const mode = notifModeOf(s);
  btn.hidden = false;
  btn.innerHTML = bellSvg(mode);
  btn.classList.toggle("notifDim", mode === "default");
  btn.title = "Notifikasi: " + NOTIF_LABELS[mode] + " — klik untuk mengubah";
}

// One-time migrations for services stored by older versions: adopt
// the catalog colour when missing, adopt the real brand logo (or the
// catalog glyph) when the service's URL matches a catalog entry and
// the user has not customised the icon, and — since v0.8.0 dropped
// emoji icons — turn a stored emoji icon on a brand-less service
// into the name's initials (brand services render their logo anyway
// and are left untouched).
(function migrate() {
  let changed = false;
  for (const s of services) {
    const cat = CATALOG.find(c => hostOf(c.url) === hostOf(s.url));
    if (cat && !s.color) { s.color = cat.color; changed = true; }
    if (cat && cat.slug && !s.brand && !s.img && !s.glyph) { s.brand = cat.slug; changed = true; }
    if (cat && cat.glyph && !s.brand && !s.img && !s.glyph) { s.glyph = cat.glyph; changed = true; }
    if (!s.brand && s.icon && /[^\x00-\x7F]/.test(s.icon)) { s.icon = s.name.slice(0, 2); changed = true; }
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
const editPanel = el("editPanel");
const adblockPanel = el("adblockPanel");
const confirmPanel = el("confirmPanel");
const managePanel = el("managePanel");
const dlPanel = el("dlPanel");
const mediaPanel = el("mediaPanel");
const updatePanel = el("updatePanel");
const quickPanel = el("quickPanel");
const groupPanel = el("groupPanel");
const notifMenu = el("notifMenu");
const permPanel = el("permPanel");
const groupNamePanel = el("groupNamePanel");
// The Kelola group context menu is NOT in allPanels on purpose:
// it opens over the (already open) Kelola panel and is shown /
// hidden by hand (see openGroupMenu), so the panel machinery
// never tears Kelola down underneath it.
const groupMenu = el("groupMenu");
const allPanels = [pickerPanel, ctxPanel, editPanel, adblockPanel, confirmPanel, managePanel, dlPanel, mediaPanel, updatePanel, quickPanel, groupPanel, notifMenu, permPanel, groupNamePanel];
let ctxService = null;

let lastFocus = null;
// Panels leave through a short exit beat (v0.8.6): closePanels()
// marks the open panel .closing for ~110ms before [hidden] lands,
// so exits are faster than entrances instead of an instant vanish.
// panelSeq invalidates a pending close whenever a newer open or
// close takes over mid-beat, so the timeout can never hide a panel
// that was just (re)opened.
let panelSeq = 0;
async function openPanel(panel) {
  // The first-open permission dialog saves on ANY way out
  // (v0.8.8): if another panel takes over while it is up, its
  // current choices land first. savePermChoices is defined with
  // the dialog further down; it no-ops when no dialog is pending.
  if (panel !== permPanel) savePermChoices();
  hideGroupMenu();
  panelSeq++;
  lastFocus = document.activeElement;
  for (const p of allPanels) { p.hidden = true; p.classList.remove("closing"); }
  // Only the modal popups (picker / Kelola / right-click menu,
  // class "picker") get the dimmed backdrop.
  el("scrim").hidden = !panel.classList.contains("picker");
  await invoke("set_services_visible", { visible: false });
  panel.hidden = false;
  const f = panel.querySelector("input:not([type='file']), button:not([disabled])");
  if (f) f.focus();
}

async function closePanels() {
  // Same save-on-any-exit rule as openPanel: Escape, outside
  // clicks and service switches all funnel through here.
  savePermChoices();
  hideGroupMenu();
  const open = allPanels.filter(p => !p.hidden);
  const seq = ++panelSeq;
  if (open.length) {
    for (const p of open) p.classList.add("closing");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    await new Promise(r => setTimeout(r, reduced ? 0 : 115));
    if (seq !== panelSeq) return; // a newer open/close took over
    for (const p of open) { p.hidden = true; p.classList.remove("closing"); }
  }
  el("scrim").hidden = true;
  await invoke("set_services_visible", { visible: true });
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

// Clicking outside an open panel (welcome area, top bar) closes it.
// Sidebar clicks are excluded: they run their own open/switch logic.
// Two implicit-dismiss guards: a dirty edit draft asks before it is
// thrown away, and clicking outside the discard confirmation itself
// counts as cancelling it (back to the edit dialog).
document.addEventListener("click", (e) => {
  // The Kelola group menu floats over the Kelola panel: a click
  // anywhere else closes the menu first, and a click that stays
  // inside Kelola goes no further.
  const path = e.composedPath ? e.composedPath() : [e.target];
  if (!groupMenu.hidden) {
    if (path.includes(groupMenu)) return;
    hideGroupMenu();
    if (path.includes(managePanel)) return;
  }
  const open = allPanels.find(p => !p.hidden);
  if (!open) return;
  // Use composedPath: a handler may detach e.target mid-click.
  if (path.includes(open)) return;
  if (path.some(n => n && n.id === "sidebar")) return;
  if (open === confirmPanel && confirmReturnTo) { cancelConfirm(); return; }
  if (open === editPanel && editIsDirty()) { confirmDiscardEdit(); return; }
  closePanels();
});

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
// The visual for a service without an uploaded image. Precedence:
// an explicitly chosen glyph wins over the brand logo, which wins
// over the text icon (initials). Explicit choices in the edit dialog
// clear the fields they override, so this order can never resurrect
// a logo the user replaced (the pre-v0.8.0 bug: typed text never
// showed for brand services). Uploaded images always win: render()
// handles them before calling this.
function glyphSvg(key, px, col) {
  return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + GLYPHS[key] + "</svg>";
}

// CSS filter for an uploaded icon image with a hue shift (0 = none).
function imgFilter(s) {
  return s && s.hue ? "hue-rotate(" + s.hue + "deg)" : "";
}

function iconVisual(s, px) {
  const col = s.iconColor || "#ffffff";
  const sp = document.createElement("span");
  if (s.glyph && GLYPHS[s.glyph]) {
    sp.className = "svgIcon";
    sp.innerHTML = glyphSvg(s.glyph, px, col);
  } else if (s.brand && ICON_PATHS[s.brand]) {
    sp.className = "svgIcon";
    sp.innerHTML = '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="' + col + '" aria-hidden="true"><path d="' + ICON_PATHS[s.brand] + '"/></svg>';
  } else {
    sp.className = "txtIcon";
    sp.style.color = col;
    sp.textContent = s.icon || s.name.slice(0, 2);
  }
  return sp;
}

// True for the YouTube service (and any custom service on a YouTube
// host): those get the extra "Adblock YouTube" menu item / dialog
// button, and their webviews get the adblock script injected.
function isYouTubeService(s) {
  const h = hostOf(s.url);
  return h === "youtube.com" || h.endsWith(".youtube.com");
}

// The right-click menu is a panel like the others: opening it
// hides the service webviews; it shows as a centred modal.
async function openCtx(s) {
  ctxService = s;
  el("ctxTitle").textContent = s.name;
  el("ctxPin").textContent = pinned.has(s.id) ? "Unpin" : "Pin (tetap hidup buat notif)";
  el("ctxDisable").textContent = disabled.has(s.id) ? "Aktifkan lagi" : "Nonaktifkan (matikan total sementara)";
  // "Buka di panel kanan" only makes sense for a service that
  // can actually open and is not already one of the two panes,
  // and only while the split gate passes (the button that
  // reveals the feature is hidden otherwise). With split
  // already on, choosing it for another service REPLACES the
  // current companion (v0.9.1) — the click handler below goes
  // through setCompanion, which swaps the right pane without
  // closing the old companion's webview.
  el("ctxSplit").hidden = !splitGateOk || disabled.has(s.id) || s.id === activeId || (splitOn && s.id === companionId);
  el("ctxAdblock").hidden = !isYouTubeService(s);
  await openPanel(ctxPanel);
  el("ctxPin").focus();
}

// Unread badge pop (v0.8.6): a CSS transition, not a keyframe, so
// a burst of count changes retargets mid-flight instead of
// restarting. The class is added, held briefly, then removed; a
// repeat pop restarts from the current scale via a forced reflow.
function popBadge(bd) {
  bd.classList.remove("pop");
  void bd.offsetWidth;
  bd.classList.add("pop");
  clearTimeout(bd._popTimer);
  bd._popTimer = setTimeout(() => bd.classList.remove("pop"), 180);
}

// Local badge update for one service tile (v0.8.6): an unread
// change touches only that tile's badge instead of re-rendering
// the whole sidebar. Falls back to a full render if the tile is
// not in the DOM (cannot happen in practice: counts only arrive
// for services, and every service renders a tile).
function updateBadge(id, popped) {
  const btn = nav.querySelector('.svc[data-svc="' + id + '"]');
  if (!btn) { render(); return; }
  let bd = btn.querySelector(".badge");
  const n = unread.get(id) || 0;
  if (!n || disabled.has(id)) {
    if (bd) bd.remove();
    return;
  }
  if (!bd) {
    bd = document.createElement("span");
    bd.className = "badge";
    btn.appendChild(bd);
  }
  bd.textContent = n > 99 ? "99+" : String(n);
  if (popped) popBadge(bd);
  if (id === popId) popId = null;
}

function render() {
  document.body.classList.toggle("showNames", showNames);
  nav.innerHTML = "";
  let prevGroup = null;
  for (const s of services) {
    // Group separator: a hairline between two neighbours whose
    // groups differ (when at least one of them is grouped). The
    // divider that introduces a named group carries the group:
    // right-clicking it offers "Mulai kelompok".
    const g = groupOf(s);
    if (prevGroup !== null && g !== prevGroup && (g || prevGroup)) {
      const sep = document.createElement("div");
      sep.className = "svcSep";
      if (g) {
        sep.dataset.group = g;
        sep.title = "Kelompok " + g;
        sep.setAttribute("aria-label", sep.title);
        sep.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          openGroupPanel(g);
        });
        // Keyboard alternative to the right-click above: the
        // separator is focusable and Enter/Space (or the context
        // menu keys) opens the same group panel.
        sep.tabIndex = 0;
        sep.setAttribute("role", "button");
        sep.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            openGroupPanel(g);
          }
        });
      }
      nav.appendChild(sep);
    }
    prevGroup = g;
    const b = document.createElement("button");
    b.className = "svc" + (s.id === activeId ? " active" : "") + (disabled.has(s.id) ? " disabled" : "");
    b.dataset.svc = s.id;
    b.title = s.name + (pinned.has(s.id) ? " (pinned - tetap hidup)" : "") + (disabled.has(s.id) ? " (nonaktif, klik untuk mengaktifkan lagi)" : "");
    b.setAttribute("aria-label", b.title);
    if (s.img) {
      const im = document.createElement("img");
      im.className = "svcImg"; im.src = s.img; im.alt = "";
      const f = imgFilter(s); if (f) im.style.filter = f;
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
      if (s.id === popId) popBadge(bd);
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
  popId = null;
  positionPill(false);
  refreshNotifBtn();
  refreshSplitBtn();
  if (splitOn && !companionId) renderSplitPicker();
  // Force the companion strip to repaint below: a rename or
  // icon edit must reach it even though the companion id did
  // not change.
  barRenderedKey = null;
  layoutSplitChrome();
}

// Discord-style active indicator: a small accent pill at the left
// edge of the rail that slides to the active service icon.
const pillEl = el("activePill");
let pillShown = false;
function positionPill(instant) {
  const active = nav.querySelector(".svc.active");
  if (!active) { pillEl.hidden = true; pillShown = false; return; }
  const sb = el("sidebar").getBoundingClientRect();
  const r = active.getBoundingClientRect();
  const y = r.top - sb.top + (r.height - 24) / 2;
  pillEl.hidden = false;
  if (instant || !pillShown) {
    pillEl.style.transition = "none";
    pillEl.style.transform = "translateY(" + y + "px)";
    pillEl.getBoundingClientRect();
    pillEl.style.transition = "";
  } else {
    pillEl.style.transform = "translateY(" + y + "px)";
  }
  pillShown = true;
}
nav.addEventListener("scroll", () => positionPill(true));
window.addEventListener("resize", () => positionPill(true));

async function switchTo(s) {
  if (disabled.has(s.id)) return;
  if (linkPopupOpen) await closeLinkPopup();
  // Switching away would close the panels: a dirty edit draft
  // asks first instead of being discarded silently.
  if (editIsDirty()) { confirmDiscardEdit(() => switchTo(s)); return; }
  if (allPanels.some(p => !p.hidden)) await closePanels();
  // Split view: "switching" to the service that is currently
  // the companion swaps the two panes instead of switching —
  // the companion becomes the main service and the main becomes
  // the companion. Both webviews already exist, so this goes
  // through split_swap, never switch_service (which would park
  // the old main and collapse the pair onto one service).
  if (splitOn && companionId && activeId && s.id === companionId && s.id !== activeId) {
    const prevMainId = activeId;
    try { await invoke("split_swap"); } catch { return; }
    splitPicking = false;
    companionId = prevMainId;
    saveSplitPrefs();
    activeId = s.id;
    localStorage.setItem("sodium.lastActive", s.id); scheduleConfigSave();
    el("activeName").textContent = s.name;
    render();
    showZoom();
    return;
  }
  activeId = s.id; render();
  localStorage.setItem("sodium.lastActive", s.id); scheduleConfigSave();
  el("activeName").textContent = s.name;
  el("welcome").style.display = "none";
  let openedOk = false;
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
    openedOk = true;
  } catch (err) {
    el("welcome").style.display = "";
    el("ramNote").textContent = "Gagal membuka " + s.name + ": " + err;
    el("ramNote").classList.add("error");
  }
  // First-open permission ask (v0.8.8): a service that has never
  // been asked gets the one-time dialog now that it is open. This
  // also covers every pre-v0.8.8 service on its first open after
  // the update — none of them carries permAsked yet.
  if (openedOk && !s.permAsked) openPermDialog(s);
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
  const svc = { id, name, url: cat.url, icon: cat.name.slice(0, 2), color: cat.color, iconColor: "#ffffff" };
  if (cat.slug) svc.brand = cat.slug;
  if (cat.glyph) svc.glyph = cat.glyph;
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
    ic.appendChild(iconVisual({ brand: cat.slug, glyph: cat.glyph, icon: cat.name.slice(0, 2), name: cat.name, iconColor: "#ffffff" }, 28));
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
el("ctxSplit").addEventListener("click", async () => {
  if (!ctxService) return;
  const s = ctxService;
  await closePanels();
  // With no main service yet there is nothing to accompany:
  // the service simply becomes the main one.
  if (!activeId) { switchTo(s); return; }
  if (!splitOn) await enterSplit(false);
  if (!splitOn) return; // the gate failed between menu and click
  if (companionId !== s.id) await setCompanion(s);
});
el("ctxDisable").addEventListener("click", async () => {
  if (!ctxService) return;
  await setServiceDisabled(ctxService, !disabled.has(ctxService.id));
  await closePanels();
});
el("ctxManage").addEventListener("click", async () => {
  await openManage();
});
el("ctxAdblock").addEventListener("click", async () => {
  await openAdblockPanel(null);
});

el("addBtn").addEventListener("click", openPicker);
searchInput.addEventListener("input", renderPicker);
el("pickerSkip").addEventListener("click", async () => { markOnboarded(); await closePanels(); });

// Custom-service icon choice: a glyph from the generic set, or an
// uploaded image; with neither, the service starts with its name's
// initials and (as before) a best-effort favicon fetch after adding.
let customImg = null;
let customGlyph = null;
function clearCustomImg() {
  customImg = null;
  el("cIconPreview").hidden = true;
  el("cIconPreview").removeAttribute("src");
}
function paintCustomGlyphs() {
  const box = el("customGlyphs");
  box.innerHTML = "";
  for (const key of Object.keys(GLYPHS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "glyphBtn" + (key === customGlyph ? " sel" : "");
    b.title = GLYPH_LABELS[key] || key;
    b.setAttribute("aria-label", b.title);
    b.innerHTML = glyphSvg(key, 20, "currentColor");
    b.addEventListener("click", () => {
      customGlyph = customGlyph === key ? null : key;
      if (customGlyph) clearCustomImg();
      paintCustomGlyphs();
    });
    box.appendChild(b);
  }
}
paintCustomGlyphs();
el("cUploadBtn").addEventListener("click", () => el("cIconFile").click());
el("cIconPreview").addEventListener("click", clearCustomImg);
// The preview image is a click target (click = discard the image),
// so it needs a keyboard path too: it carries tabindex/role in the
// markup, and Enter/Space do what a click does.
el("cIconPreview").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    clearCustomImg();
  }
});
el("cIconFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    customImg = await processIconFile(f);
    customGlyph = null;
    paintCustomGlyphs();
    el("cIconPreview").src = customImg;
    el("cIconPreview").hidden = false;
  } catch { /* unreadable file: keep the glyph / initials icon */ }
});
el("cName").addEventListener("input", () => { el("customErr").hidden = true; });
el("cUrl").addEventListener("input", () => { el("customErr").hidden = true; });
el("customAdd").addEventListener("click", async () => {
  const name = el("cName").value.trim();
  let url = el("cUrl").value.trim();
  // Empty name/URL used to stop silently; say what is missing,
  // inline, and focus the first invalid field.
  const cerr = el("customErr");
  if (!name) { cerr.textContent = "Nama layanan wajib diisi."; cerr.hidden = false; el("cName").focus(); return; }
  if (!url) { cerr.textContent = "URL layanan wajib diisi."; cerr.hidden = false; el("cUrl").focus(); return; }
  cerr.hidden = true;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
  const svc = { id, name, url, icon: name.slice(0, 2) };
  if (customGlyph) svc.glyph = customGlyph;
  if (customImg) svc.img = customImg;
  services.push(svc);
  if (!customImg) fetchFaviconFor(svc);
  store.save(services); render();
  el("cName").value = ""; el("cUrl").value = "";
  customGlyph = null;
  paintCustomGlyphs();
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
// re-enabling never asks for a new login. That is why this uses
// close_webview, NOT close_service — close_service deletes the profile
// folder (the v0.8.7 bug: disabling WhatsApp wiped its login, so it
// asked for a QR scan again on re-enable).
async function setServiceDisabled(s, off) {
  const id = s.id;
  if (!off) {
    disabled.delete(id);
  } else {
    // Split view edge cases (v0.9.0): disabling the companion
    // empties its slot (the picker returns if split is still
    // on); disabling the main service collapses split entirely
    // (the companion is parked by split_exit, never closed).
    if (splitOn && companionId === id) await clearCompanion();
    else if (splitOn && activeId === id) await exitSplit();
    disabled.add(id);
    await invoke("close_webview", { id });
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
  // The copy is a fresh service: it has not been asked about
  // permissions yet, so the first-open dialog appears for it too
  // (its inherited notif/media values become the dialog's initial
  // choices).
  delete copy.permAsked;
  services.push(copy);
  store.save(services);
  pushNotifPolicy(copy);
  pushMediaPolicy(copy);
  render();
  return copy;
}

// Delete removes the service from the list; its profile folder stays
// on disk either way, so re-adding it later restores the login.
// (close_webview, not close_service: the latter deletes the profile —
// see the v0.8.7 note in setServiceDisabled.)
async function deleteService(id) {
  // Same split edge cases as disabling: a deleted companion
  // empties the slot; a deleted main service collapses split.
  if (splitOn && companionId === id) await clearCompanion();
  else if (splitOn && activeId === id) await exitSplit();
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
  await invoke("close_webview", { id });
  render();
}

// ------------------------------------------------------------------
// Edit dialog (v0.8.0): one centred dialog per service, in the spirit
// of Firefox/Zen container settings — name, URL, group, the icon
// editor, tile/logo colours, pin & disable switches, duplicate.
// The old standalone icon panel is gone: icon editing lives here.
//
// The icon editor works on a draft (mode + glyph + text + image +
// hue + colours) with a live preview; nothing lands until Simpan.
// Modes: "brand" (catalog logo), "glyph" (generic SVG), "text"
// (1-2 initials), "image" (uploaded image / favicon, with a hue
// slider). Saving a non-brand mode clears the fields it overrides,
// so an explicit user choice always wins over the brand logo.
const COLOR_SWATCHES = ["#ffffff", "#e8eaf0", "#9aa3b5", "#14161a", "#f5c518", "#1faa55", "#229ed9", "#1877f2", "#5865f2", "#c13584", "#e60023", "#ee4d2d", "#ff4500", "#42b549", "#611f69", "#b20710"];
let editId = null;
let editDraft = null;
// Snapshot of the whole edit form (fields + icon draft) taken
// when the dialog opens. Implicit dismissals — outside click,
// Escape, switching service — compare against it and ask before
// discarding unsaved changes; the explicit Batal button and a
// successful Simpan never ask.
let editSnapshot = null;
function editFormState() {
  if (!editDraft) return "";
  return JSON.stringify({
    name: el("editName").value,
    url: el("editUrl").value,
    group: el("editGroup").value,
    pin: el("editPin").checked,
    disabled: el("editDisabled").checked,
    notif: el("editNotif").value,
    media: el("editMedia").value,
    draft: editDraft,
  });
}
function editIsDirty() {
  return !!(editId && editDraft && editSnapshot !== null && editFormState() !== editSnapshot);
}

function catalogFor(s) {
  return CATALOG.find(c => hostOf(c.url) === hostOf(s.url)) || null;
}

function refreshGroupDatalist() {
  const dl = el("groupNames");
  dl.innerHTML = "";
  // The persistent group list (which already unions in every
  // service-derived group) plus any straggler, sorted.
  const all = [...groups];
  for (const s of services) {
    const g = groupOf(s);
    if (g && !all.some(x => sameGroupName(x, g))) all.push(g);
  }
  for (const g of all.sort()) {
    const o = document.createElement("option");
    o.value = g;
    dl.appendChild(o);
  }
}

async function openEditDialog(s) {
  editId = s.id;
  editDraft = {
    mode: s.img ? "image" : (s.glyph ? "glyph" : (s.brand ? "brand" : "text")),
    glyph: s.glyph || "bag",
    text: (s.icon && !/[^\x00-\x7F]/.test(s.icon)) ? s.icon : s.name.slice(0, 2),
    img: s.img || null,
    favicon: !!s.favicon,
    hue: s.hue || 0,
    color: s.color || "#262a33",
    iconColor: s.iconColor || "#ffffff",
  };
  el("editName").value = s.name;
  el("editUrl").value = s.url;
  el("editGroup").value = s.group || "";
  el("editPin").checked = pinned.has(s.id);
  el("editDisabled").checked = disabled.has(s.id);
  el("editNotif").value = notifModeOf(s);
  el("editMedia").value = mediaModeOf(s);
  el("editIconMsg").textContent = "";
  el("editErr").hidden = true;
  el("editAdblockBtn").hidden = !isYouTubeService(s);
  refreshGroupDatalist();
  paintEditWarn();
  paintEditIcon();
  await openPanel(editPanel);
  editSnapshot = editFormState();
}

function paintEditWarn() {
  const s = services.find(x => x.id === editId);
  const warn = el("editWarn");
  if (!s) { warn.hidden = true; return; }
  const oldHost = hostOf(s.url);
  const nh = hostOf(el("editUrl").value.trim());
  warn.hidden = !(nh && oldHost && nh !== oldHost);
  if (!warn.hidden) {
    warn.textContent = "Host berubah (" + oldHost + " → " + nh + "): webview layanan ditutup dan dibuka ulang pakai alamat baru. Sesi login lama tetap tersimpan di profil layanan ini.";
  }
}
el("editUrl").addEventListener("input", paintEditWarn);
el("editName").addEventListener("input", paintEditIcon);
el("editIconText").addEventListener("input", () => {
  if (!editDraft) return;
  editDraft.text = el("editIconText").value;
  paintEditPreview();
});

function paintSwatches(container, key) {
  container.innerHTML = "";
  for (const c of COLOR_SWATCHES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (editDraft[key].toLowerCase() === c ? " sel" : "");
    b.style.background = c;
    b.title = c;
    b.setAttribute("aria-label", "Warna " + c);
    b.addEventListener("click", () => { editDraft[key] = c; paintEditIcon(); });
    container.appendChild(b);
  }
}

function paintGlyphGrid(container, selected, onPick) {
  container.innerHTML = "";
  for (const key of Object.keys(GLYPHS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "glyphBtn" + (key === selected ? " sel" : "");
    b.title = GLYPH_LABELS[key] || key;
    b.setAttribute("aria-label", b.title);
    b.innerHTML = glyphSvg(key, 20, "currentColor");
    b.addEventListener("click", () => onPick(key));
    container.appendChild(b);
  }
}

// The service object the draft would produce, for the live preview.
function draftVisual() {
  const s = services.find(x => x.id === editId);
  const cat = s ? catalogFor(s) : null;
  return {
    brand: editDraft.mode === "brand" ? ((s && s.brand) || (cat && cat.slug) || null) : null,
    glyph: editDraft.mode === "glyph" ? editDraft.glyph : null,
    icon: editDraft.text || ((s && s.name) || "?").slice(0, 2),
    name: (s && s.name) || "",
    iconColor: editDraft.iconColor,
  };
}

function paintEditPreview() {
  if (!editDraft) return;
  const pv = el("editPreview");
  pv.innerHTML = "";
  pv.style.background = editDraft.color;
  if (editDraft.mode === "image" && editDraft.img) {
    const im = document.createElement("img");
    im.className = "svcImg"; im.src = editDraft.img; im.alt = "";
    const f = imgFilter(editDraft); if (f) im.style.filter = f;
    pv.appendChild(im);
  } else {
    pv.appendChild(iconVisual(draftVisual(), 28));
  }
}

function paintEditIcon() {
  const s = services.find(x => x.id === editId);
  if (!s || !editDraft) return;
  const cat = catalogFor(s);
  el("modeBrand").hidden = !(s.brand || (cat && cat.slug));
  el("modeImage").hidden = !editDraft.img;
  for (const b of el("editModes").querySelectorAll("button")) {
    b.classList.toggle("sel", b.dataset.mode === editDraft.mode);
  }
  el("glyphGrid").hidden = editDraft.mode !== "glyph";
  if (editDraft.mode === "glyph") {
    paintGlyphGrid(el("glyphGrid"), editDraft.glyph, (k) => { editDraft.glyph = k; paintEditIcon(); });
  }
  el("editIconText").hidden = editDraft.mode !== "text";
  if (document.activeElement !== el("editIconText")) el("editIconText").value = editDraft.text;
  const hasImg = !!editDraft.img;
  const imgActive = hasImg && editDraft.mode === "image";
  el("editImgPreview").hidden = !hasImg;
  if (hasImg) {
    el("editImgPreview").src = editDraft.img;
    el("editImgPreview").style.filter = imgActive ? imgFilter(editDraft) : "";
  }
  el("editRemoveImg").hidden = !hasImg;
  el("hueRow").hidden = !imgActive;
  if (imgActive) {
    el("hueRange").value = String(editDraft.hue);
    el("hueVal").textContent = String(editDraft.hue);
  }
  // An uploaded image covers the whole tile, so a logo colour
  // cannot apply to it: that row is hidden while an image is used.
  el("editLogoColorRow").hidden = imgActive;
  paintSwatches(el("editTilePalette"), "color");
  paintSwatches(el("editLogoPalette"), "iconColor");
  paintEditPreview();
}

for (const b of el("editModes").querySelectorAll("button")) {
  b.addEventListener("click", () => {
    if (!editDraft) return;
    editDraft.mode = b.dataset.mode;
    paintEditIcon();
  });
}
el("editUploadBtn").addEventListener("click", () => el("editIconFile").click());
el("editIconFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f || !editDraft) return;
  try {
    // Draft only: the image lands when Simpan is clicked.
    editDraft.img = await processIconFile(f);
    editDraft.favicon = false;
    editDraft.mode = "image";
    el("editIconMsg").textContent = "";
    paintEditIcon();
  } catch (err) {
    el("editIconMsg").textContent = String(err && err.message || err);
  }
});
el("editRemoveImg").addEventListener("click", () => {
  if (!editDraft) return;
  editDraft.img = null;
  editDraft.favicon = false;
  editDraft.hue = 0;
  if (editDraft.mode === "image") {
    const s = services.find(x => x.id === editId);
    const cat = s ? catalogFor(s) : null;
    editDraft.mode = (s && s.brand) || (cat && cat.slug) ? "brand" : "glyph";
  }
  paintEditIcon();
});
el("hueRange").addEventListener("input", () => {
  if (!editDraft) return;
  editDraft.hue = Number(el("hueRange").value) || 0;
  el("hueVal").textContent = String(editDraft.hue);
  paintEditPreview();
  if (editDraft.img) el("editImgPreview").style.filter = imgFilter(editDraft);
});
el("hueReset").addEventListener("click", () => {
  if (!editDraft) return;
  editDraft.hue = 0;
  paintEditIcon();
});
el("editAdblockBtn").addEventListener("click", async () => {
  if (editId) await openAdblockPanel(editId);
});
el("editDuplicate").addEventListener("click", async () => {
  const s = services.find(x => x.id === editId);
  if (!s) return;
  editId = null; editDraft = null; editSnapshot = null;
  duplicateService(s);
  await openManage();
});
el("editCancel").addEventListener("click", async () => {
  editId = null; editDraft = null; editSnapshot = null;
  await openManage();
});
el("editName").addEventListener("input", () => { el("editErr").hidden = true; });
el("editUrl").addEventListener("input", () => { el("editErr").hidden = true; });
el("editSave").addEventListener("click", async () => {
  const s = services.find(x => x.id === editId);
  if (!s || !editDraft) return;
  const name = el("editName").value.trim();
  let url = el("editUrl").value.trim();
  // Empty name/URL used to stop silently; say what is missing,
  // inline, and focus the first invalid field.
  const eerr = el("editErr");
  if (!name) { eerr.textContent = "Nama layanan wajib diisi."; eerr.hidden = false; el("editName").focus(); return; }
  if (!url) { eerr.textContent = "URL layanan wajib diisi."; eerr.hidden = false; el("editUrl").focus(); return; }
  eerr.hidden = true;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const urlChanged = url !== s.url;
  const wasDisabled = disabled.has(s.id);
  const wantDisabled = el("editDisabled").checked;
  const wantPin = el("editPin").checked;

  s.name = name;
  const grp = el("editGroup").value.trim();
  if (grp) s.group = grp; else delete s.group;
  // A group name typed here joins the persistent group list
  // (v0.8.8), so the group survives even its last service leaving.
  if (grp && !groups.some(g => sameGroupName(g, grp))) {
    groups.push(grp);
    saveGroups();
  }
  // Notification mode: only non-default values are stored, like
  // the group above; "allow" is the absence of the field.
  const wantNotif = el("editNotif").value;
  if (wantNotif === "default" || wantNotif === "deny") s.notif = wantNotif; else delete s.notif;
  // Microphone/camera mode: same storage semantics as notif.
  const wantMedia = el("editMedia").value;
  if (wantMedia === "default" || wantMedia === "deny") s.media = wantMedia; else delete s.media;

  // Icon draft: the chosen mode clears whatever it overrides, so
  // the explicit choice always wins over the brand logo.
  const cat = catalogFor(s);
  if (editDraft.mode === "image" && editDraft.img) {
    s.img = editDraft.img;
    if (editDraft.favicon) s.favicon = true; else delete s.favicon;
    delete s.glyph;
    if (editDraft.hue) s.hue = editDraft.hue; else delete s.hue;
  } else if (editDraft.mode === "glyph") {
    s.glyph = editDraft.glyph;
    delete s.img; delete s.favicon; delete s.brand; delete s.hue;
  } else if (editDraft.mode === "text") {
    s.icon = editDraft.text.trim() || name.slice(0, 2);
    delete s.glyph; delete s.img; delete s.favicon; delete s.brand; delete s.hue;
  } else {
    const slug = s.brand || (cat && cat.slug);
    if (slug) s.brand = slug;
    delete s.glyph; delete s.img; delete s.favicon; delete s.hue;
  }
  s.color = editDraft.color;
  s.iconColor = editDraft.iconColor;
  if (activeId === s.id) el("activeName").textContent = name;
  editId = null; editDraft = null; editSnapshot = null;
  store.save(services);
  if (wantPin !== pinned.has(s.id)) togglePin(s);
  pushNotifPolicy(s);
  pushMediaPolicy(s);
  render();

  if (urlChanged) {
    s.url = url;
    store.save(services);
    // close_webview, not close_service: a URL edit must not throw away
    // the saved login (close_service deletes the profile folder).
    await invoke("close_webview", { id: s.id });
    if (!s.brand && s.favicon) {
      delete s.img;
      delete s.favicon;
      store.save(services);
      fetchFaviconFor(s);
    }
    render();
    if (activeId === s.id && !wantDisabled) await switchTo(s);
    // A companion whose URL changed had its webview closed
    // above (and Rust cleared its companion slot): re-create it
    // at the new URL so the right pane does not stay empty.
    if (splitOn && companionId === s.id && !wantDisabled) await setCompanion(s);
  }
  if (wantDisabled !== wasDisabled) await setServiceDisabled(s, wantDisabled);
  render();
  await openManage();
});

// ------------------------------------------------------------------
// Small confirm dialog (used for service deletion from the Kelola
// list): a real modal, not a two-click arm. `returnTo` names a
// panel that cancelling reopens instead of closing everything —
// the discard-changes confirmation uses it to hand the user back
// to the edit dialog with the draft untouched.
let confirmAction = null;
let confirmFromManage = false;
let confirmReturnTo = null;
function openConfirm({ title, body, okLabel, onOk, fromManage, returnTo }) {
  el("confirmTitle").textContent = title;
  el("confirmBody").textContent = body;
  el("confirmOk").textContent = okLabel || "Hapus";
  confirmAction = onOk || null;
  confirmFromManage = !!fromManage;
  confirmReturnTo = returnTo || null;
  openPanel(confirmPanel);
}
async function cancelConfirm() {
  confirmAction = null;
  if (confirmReturnTo) {
    const p = confirmReturnTo;
    confirmReturnTo = null;
    confirmFromManage = false;
    await openPanel(p);
    return;
  }
  if (confirmFromManage) { confirmFromManage = false; await openManage(); }
  else await closePanels();
}
el("confirmCancel").addEventListener("click", cancelConfirm);
el("confirmOk").addEventListener("click", async () => {
  const f = confirmAction;
  const back = confirmFromManage;
  confirmAction = null; confirmFromManage = false; confirmReturnTo = null;
  await closePanels();
  if (f) await f();
  if (back) await openManage();
});

// Ask before an implicit dismissal throws away a dirty edit
// draft. Confirming clears the draft, closes the panels, then
// runs whatever the dismissal was heading to (if anything).
function confirmDiscardEdit(after) {
  openConfirm({
    title: "Buang perubahan?",
    body: "Dialog edit punya perubahan yang belum disimpan. Buang perubahan itu?",
    okLabel: "Buang",
    returnTo: editPanel,
    onOk: async () => {
      editId = null; editDraft = null; editSnapshot = null;
      await closePanels();
      if (after) after();
    },
  });
}

// Kelola layanan panel (v0.8.0, Container-style like Firefox/Zen):
// a plain list — drag grip, icon, name, status pills, edit (pencil)
// and delete (trash, behind a confirm dialog) — plus the global
// sidebar settings. All per-service editing happens in the edit
// dialog (see openEditDialog above).
const manageList = el("manageList");

async function openManage() {
  renderManage();
  await openPanel(managePanel);
}
el("manageBtn").addEventListener("click", openManage);
el("manageClose").addEventListener("click", closePanels);
el("manageAdd").addEventListener("click", openPicker);
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

const MG_ICONS = {
  edit: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
};
function mgIconButton(icon, cls, title, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "mgAct " + cls;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + MG_ICONS[icon] + "</svg>";
  b.addEventListener("click", onClick);
  return b;
}

// Pointer-based drag reorder for the Kelola list. HTML5 drag &
// drop never actually starts inside Sodium's WebView2 windows, so
// the grip tracks pointer events directly instead: the dragged
// row follows the cursor via a transform while the other rows
// stay put in the layout.
let mgDrag = null; // { from, startY, startScroll, insertBefore, groupDrop, row, geo }

function clearDragMarks() {
  for (const r of manageList.querySelectorAll(".mgRow")) r.classList.remove("dropAbove", "dropBelow");
  for (const sl of manageList.querySelectorAll(".mgDropSlot")) sl.classList.remove("dropTarget");
}

// Where would the dragged row land if dropped at this pointer Y?
// Returns the original services index to insert before
// (services.length = past the end) and the row to mark.
// During a drag the geometry cached at dragstart is used, so a
// pointermove never measures layout: cached row centres live in
// content coordinates (invariant under scrolling), and the
// pointer's content position is derived from the cached list top
// plus the current scroll offset.
function mgInsertPoint(clientY) {
  if (mgDrag && mgDrag.geo) {
    const contentY = (clientY - mgDrag.geo.listTop) + manageList.scrollTop;
    // An empty group's drop slot wins inside its own span: the
    // drop there assigns the group instead of reordering.
    for (const sl of mgDrag.geo.slots || []) {
      if (contentY >= sl.top && contentY <= sl.bottom) {
        return { groupDrop: sl.group, mark: sl.el };
      }
    }
    let lastOther = null;
    for (const it of mgDrag.geo.items) {
      lastOther = it.row;
      if (contentY < it.mid) {
        return { before: it.idx, mark: it.row, below: false };
      }
    }
    return { before: services.length, mark: lastOther, below: true };
  }
  let lastOther = null;
  for (const r of manageList.querySelectorAll(".mgRow")) {
    if (mgDrag && r === mgDrag.row) continue;
    lastOther = r;
    const rect = r.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return { before: Number(r.dataset.idx), mark: r, below: false };
    }
  }
  return { before: services.length, mark: lastOther, below: true };
}

// One group header row inside the Kelola list. Non-empty groups
// get one where their first row appears (mirroring the sidebar's
// separators); empty groups get a dimmed one above their drop
// slot. Right-click (or the context-menu key) opens the small
// group menu — its only item deletes the group, and only for
// empty groups.
function mgGroupHeader(name, empty) {
  const h = document.createElement("div");
  h.className = "mgGroupHead" + (empty ? " empty" : "");
  h.dataset.group = name;
  const nm = document.createElement("span");
  nm.className = "mgGroupName";
  nm.textContent = name;
  h.appendChild(nm);
  if (empty) {
    const tag = document.createElement("span");
    tag.className = "mgGroupTag";
    tag.textContent = "Kosong";
    h.appendChild(tag);
  }
  h.title = "Kelompok " + name;
  h.tabIndex = 0;
  h.setAttribute("role", "button");
  h.setAttribute("aria-haspopup", "menu");
  h.setAttribute("aria-label", "Kelompok " + name + " — klik kanan atau tombol menu untuk opsi kelompok");
  h.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openGroupMenu(name, h);
  });
  h.addEventListener("keydown", (e) => {
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      openGroupMenu(name, h);
    }
  });
  return h;
}

function renderManage() {
  hideGroupMenu();
  el("showNamesToggle").checked = showNames;
  el("iconSizeSel").value = String(iconSize);
  refreshGroupDatalist();
  manageList.innerHTML = "";
  let prevGroup = null;
  services.forEach((s, idx) => {
    // Group header: the first row of a named group is preceded
    // by its header, like the sidebar's separators. Empty groups
    // render after the rows (below).
    const g = groupOf(s);
    if (g && g !== prevGroup) {
      manageList.appendChild(mgGroupHeader(canonicalGroup(g), false));
    }
    prevGroup = g;
    const row = document.createElement("div");
    row.className = "mgRow" + (disabled.has(s.id) ? " off" : "");
    row.dataset.idx = String(idx);
    // Pointer drag reorder: only the grip starts a drag, so text
    // selection and button clicks elsewhere on the row stay normal.
    // The grip is also the keyboard path: focusable, and ArrowUp /
    // ArrowDown swap the service with its neighbour (focus follows
    // the row to its new position).
    const grip = document.createElement("span");
    grip.className = "mgGrip";
    grip.title = "Seret untuk mengubah urutan";
    grip.setAttribute("aria-label", "Ubah urutan " + s.name + " (seret, atau fokus lalu tekan panah atas/bawah)");
    grip.tabIndex = 0;
    grip.setAttribute("role", "button");
    grip.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>';
    grip.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const j = idx + (e.key === "ArrowUp" ? -1 : 1);
      if (j < 0 || j >= services.length) return;
      const [it] = services.splice(idx, 1);
      services.splice(j, 0, it);
      store.save(services);
      render();
      renderManage();
      const g2 = manageList.querySelector('.mgRow[data-idx="' + j + '"] .mgGrip');
      if (g2) g2.focus();
    });
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || mgDrag) return;
      e.preventDefault();
      mgDrag = {
        from: idx,
        startY: e.clientY,
        startScroll: manageList.scrollTop,
        insertBefore: idx,
        row,
      };
      // Measure every row ONCE, here at dragstart: centres in
      // content coordinates plus the list's own edges. The move
      // handler below then only writes (scroll, transform, mark
      // classes) and reads scrollTop — no layout reads interleaved
      // with style writes, so no layout thrash on long lists.
      {
        const listRect = manageList.getBoundingClientRect();
        const items = [];
        for (const r of manageList.querySelectorAll(".mgRow")) {
          if (r === row) continue;
          const rect = r.getBoundingClientRect();
          items.push({
            idx: Number(r.dataset.idx),
            mid: (rect.top - listRect.top) + mgDrag.startScroll + rect.height / 2,
            row: r,
          });
        }
        // Empty-group drop slots are measured in the same pass,
        // in the same content coordinates, so the move handler
        // treats them exactly like row targets (no extra reads).
        const slots = [];
        for (const sl of manageList.querySelectorAll(".mgDropSlot")) {
          const rect = sl.getBoundingClientRect();
          slots.push({
            group: sl.dataset.group,
            top: (rect.top - listRect.top) + mgDrag.startScroll,
            bottom: (rect.bottom - listRect.top) + mgDrag.startScroll,
            el: sl,
          });
        }
        mgDrag.geo = { listTop: listRect.top, listBottom: listRect.bottom, items, slots };
      }
      row.classList.add("dragging");
      manageList.classList.add("dragging");
      try { grip.setPointerCapture(e.pointerId); } catch { /* older WebView2 */ }
      const onMove = (ev) => {
        if (!mgDrag) return;
        // Auto-scroll when the pointer nears the list's edges,
        // then follow the pointer (the scroll delta is part of the
        // offset so the row stays glued to the cursor).
        if (ev.clientY < mgDrag.geo.listTop + 40) manageList.scrollTop -= 10;
        else if (ev.clientY > mgDrag.geo.listBottom - 40) manageList.scrollTop += 10;
        const dy = (ev.clientY - mgDrag.startY) + (manageList.scrollTop - mgDrag.startScroll);
        row.style.transform = "translateY(" + dy + "px)";
        const p = mgInsertPoint(ev.clientY);
        mgDrag.insertBefore = p.before;
        mgDrag.groupDrop = p.groupDrop || null;
        clearDragMarks();
        if (p.groupDrop) p.mark.classList.add("dropTarget");
        else if (p.mark) p.mark.classList.add(p.below ? "dropBelow" : "dropAbove");
      };
      const onUp = () => {
        grip.removeEventListener("pointermove", onMove);
        grip.removeEventListener("pointerup", onUp);
        grip.removeEventListener("pointercancel", onUp);
        if (!mgDrag) return;
        const from = mgDrag.from;
        const groupDrop = mgDrag.groupDrop || null;
        let to = mgDrag.insertBefore;
        mgDrag = null;
        if (groupDrop) {
          // Dropped on an empty group's slot: assign the group,
          // keep the row's position in the list.
          const svc = services[from];
          if (svc && !sameGroupName(groupOf(svc), groupDrop)) {
            svc.group = groupDrop;
            store.save(services);
            render();
          }
          renderManage();
          return;
        }
        if (to > from) to -= 1;
        if (to !== from && to >= 0 && to < services.length) {
          const [it] = services.splice(from, 1);
          services.splice(to, 0, it);
          store.save(services);
          render();
        }
        renderManage();
      };
      grip.addEventListener("pointermove", onMove);
      grip.addEventListener("pointerup", onUp);
      grip.addEventListener("pointercancel", onUp);
    });
    const ic = document.createElement("span");
    ic.className = "tileIcon mgIcon";
    if (s.img) {
      const im = document.createElement("img");
      im.className = "svcImg"; im.src = s.img; im.alt = "";
      const f = imgFilter(s); if (f) im.style.filter = f;
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
    const slot = document.createElement("div");
    slot.className = "mgStatusSlot";
    if (pinned.has(s.id)) {
      const p = document.createElement("span");
      p.className = "mgPill pin"; p.textContent = "Dipin";
      slot.appendChild(p);
    }
    if (disabled.has(s.id)) {
      const p = document.createElement("span");
      p.className = "mgPill"; p.textContent = "Nonaktif";
      slot.appendChild(p);
    }
    const acts = document.createElement("div");
    acts.className = "mgActs";
    acts.append(
      mgIconButton("edit", "", "Edit layanan", () => openEditDialog(s)),
      mgIconButton("trash", "danger", "Hapus layanan", () => askDeleteService(s)),
    );
    row.append(grip, ic, info, slot, acts);
    manageList.appendChild(row);
  });
  // Empty groups (v0.8.8): dimmed header + dashed drop slot, in
  // the persistent list's order. Dropping a service row on a slot
  // assigns it to that group (see the drag handlers above).
  for (const name of groups) {
    if (!groupIsEmpty(name)) continue;
    manageList.appendChild(mgGroupHeader(name, true));
    const slotEl = document.createElement("div");
    slotEl.className = "mgDropSlot";
    slotEl.dataset.group = name;
    slotEl.textContent = "Seret layanan ke sini";
    manageList.appendChild(slotEl);
  }
  const addGroup = document.createElement("button");
  addGroup.type = "button";
  addGroup.className = "mgAddGroup";
  addGroup.textContent = "+ Kelompok baru";
  addGroup.addEventListener("click", openGroupNamePrompt);
  manageList.appendChild(addGroup);
}

function askDeleteService(s) {
  openConfirm({
    title: "Hapus layanan",
    body: "Hapus \"" + s.name + "\" dari Sodium? Webview-nya akan ditutup dan layanan hilang dari daftar.",
    okLabel: "Hapus",
    fromManage: true,
    onOk: async () => { await deleteService(s.id); renderManage(); },
  });
}

// ------------------------------------------------------------------
// Group menu + new-group prompt (v0.8.8). The menu is an anchored
// popover in the notification menu's style (clamped to the window,
// growing from its invocation point), but it is shown and hidden
// by hand — not through openPanel — because it floats over the
// Kelola panel, which must stay open underneath. Dismissal paths:
// outside click and Escape are intercepted in their global
// handlers; openPanel / closePanels / renderManage also hide it.
let groupMenuCtx = null; // { name, anchor }
function openGroupMenu(name, anchor) {
  hideGroupMenu();
  const empty = groupIsEmpty(name);
  groupMenuCtx = { name, anchor };
  el("groupMenuTitle").textContent = "Kelompok " + name;
  const del = el("groupMenuDelete");
  del.setAttribute("aria-disabled", empty ? "false" : "true");
  del.title = empty ? "" : "Hanya kelompok kosong yang bisa dihapus";
  groupMenu.hidden = false;
  // Anchor under the header row, clamped inside the window; open
  // upward when the space below is not enough.
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 224));
  groupMenu.style.left = left + "px";
  const menuH = groupMenu.offsetHeight;
  const upward = r.bottom + 6 + menuH > window.innerHeight && r.top - 6 - menuH >= 8;
  groupMenu.style.top = (upward ? r.top - 6 - menuH : r.bottom + 6) + "px";
  // The popover grows from the header (same rule as the bell menu).
  const originX = Math.max(0, Math.min(r.left + r.width / 2 - left, 208));
  groupMenu.style.transformOrigin = originX + "px " + (upward ? "100%" : "0px");
  if (empty) del.focus();
  else groupMenu.focus();
}
function hideGroupMenu() {
  if (groupMenu.hidden) { groupMenuCtx = null; return; }
  groupMenu.hidden = true;
  const anchor = groupMenuCtx && groupMenuCtx.anchor;
  groupMenuCtx = null;
  if (anchor && document.contains(anchor)) anchor.focus();
}
el("groupMenuDelete").addEventListener("click", () => {
  if (!groupMenuCtx) return;
  if (el("groupMenuDelete").getAttribute("aria-disabled") === "true") return;
  const name = groupMenuCtx.name;
  hideGroupMenu();
  // Deleting an empty group only drops its name from the list —
  // no service references it, so nothing else changes.
  groups = groups.filter(g => !sameGroupName(g, name));
  saveGroups();
  renderManage();
});

// New-group prompt: a small centred modal in the panel system.
// Saving returns to Kelola, where the group appears at once as a
// dimmed header + drop slot; cancelling returns there too.
async function openGroupNamePrompt() {
  el("groupNameInput").value = "";
  el("groupNameErr").hidden = true;
  await openPanel(groupNamePanel);
  el("groupNameInput").focus();
}
function saveGroupName() {
  const name = el("groupNameInput").value.trim();
  const err = el("groupNameErr");
  if (!name) {
    err.textContent = "Nama kelompok wajib diisi.";
    err.hidden = false;
    el("groupNameInput").focus();
    return;
  }
  if (groups.some(g => sameGroupName(g, name))) {
    err.textContent = "Kelompok \"" + name + "\" sudah ada. Pakai nama lain.";
    err.hidden = false;
    el("groupNameInput").focus();
    return;
  }
  groups.push(name);
  saveGroups();
  openManage();
}
el("groupNameSave").addEventListener("click", saveGroupName);
el("groupNameCancel").addEventListener("click", async () => { await openManage(); });
el("groupNameInput").addEventListener("input", () => { el("groupNameErr").hidden = true; });
el("groupNameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); saveGroupName(); }
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
  toast.classList.remove("closing");
  toast.hidden = false;
  clearTimeout(toastTimer);
  // Dismissal mirrors the entrance (v0.8.6): a short exit beat
  // through .closing before [hidden] lands.
  toastTimer = setTimeout(() => {
    toast.classList.add("closing");
    toastTimer = setTimeout(() => {
      toast.hidden = true;
      toast.classList.remove("closing");
    }, 100);
  }, 4500);
}

let downloads = [];
try { downloads = JSON.parse(localStorage.getItem("sodium.downloads") || "[]"); } catch { downloads = []; }
let activeDownloads = 0;
let installerPath = ""; // set when an update installer finishes downloading

function saveDownloads() {
  localStorage.setItem("sodium.downloads", JSON.stringify(downloads.slice(0, 50)));
  scheduleConfigSave();
}

function sourceName(sourceId) {
  if (sourceId === "link-popup") return "Popup link";
  if (sourceId === "sodium-update") return "Update Sodium";
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
    if (sourceId === "sodium-update") { installerPath = String(path); refreshUpdateButtons(); }
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

// ------------------------------------------------------------------
// Media panel (v0.10.0, Jalur B tahap 1). Rust holds the truth:
// each service page's bridge script reports its media state
// over WebView2 WebMessage, Rust keeps it per service and
// forwards changes as "media-changed"; media_states gives the
// snapshot when this UI (re)starts. Controls go back through
// the media_control command, which evals the bridge's fixed
// control handle in the page — the action names are a
// whitelist, nothing free-form is ever sent. A service whose
// media ends (or whose webview dies) reports "none" and its
// row disappears, mirroring how unread badges clear.
const mediaStates = new Map();
const MEDIA_STATUS_LABEL = { playing: "Sedang diputar", paused: "Jeda" };
const MEDIA_ICON_PLAY = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5z"/></svg>';
const MEDIA_ICON_PAUSE = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/></svg>';
const MEDIA_ICON_PREV = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M19 6.2v11.6L9.8 12z"/><rect x="5" y="6" width="2.4" height="12" rx="0.8"/></svg>';
const MEDIA_ICON_NEXT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M5 6.2v11.6L14.2 12z"/><rect x="16.6" y="6" width="2.4" height="12" rx="0.8"/></svg>';
function isYouTubeSvc(s) {
  const h = hostOf(s.url);
  return h === "youtube.com" || h.endsWith(".youtube.com");
}
function refreshMediaDot() {
  let any = false;
  for (const m of mediaStates.values()) {
    if (m.status === "playing" || m.pip) { any = true; break; }
  }
  el("mediaDot").hidden = !any;
}
function applyMediaEntry(entry) {
  if (!entry || !entry.id) return;
  if (entry.status === "none" && !entry.pip) mediaStates.delete(entry.id);
  else mediaStates.set(entry.id, entry);
  refreshMediaDot();
  if (!mediaPanel.hidden) renderMediaPanel();
}
window.__TAURI__.event.listen("media-changed", (e) => applyMediaEntry(e.payload));
invoke("media_states").then((list) => {
  for (const entry of list || []) applyMediaEntry(entry);
}).catch(() => {});

function renderMediaPanel() {
  const list = el("mediaList");
  list.innerHTML = "";
  const rows = [];
  for (const s of services) {
    const m = mediaStates.get(s.id);
    if (m) rows.push([s, m]);
  }
  if (!rows.length) {
    const d = document.createElement("div");
    d.className = "dlEmpty";
    d.textContent = "Tidak ada media yang diputar";
    list.appendChild(d);
    return;
  }
  for (const [s, m] of rows) {
    const row = document.createElement("div");
    row.className = "dlRow mediaRow";
    const info = document.createElement("div");
    info.className = "dlInfo";
    const title = document.createElement("div");
    title.className = "dlName";
    title.textContent = m.title || "Tanpa judul";
    title.title = m.title || "";
    const meta = document.createElement("div");
    meta.className = "dlMeta";
    const bits = [s.name];
    if (m.artist) bits.push(m.artist);
    bits.push(m.pip ? "Picture in picture" : (MEDIA_STATUS_LABEL[m.status] || m.status));
    meta.textContent = bits.join(" · ");
    info.append(title, meta);
    const ctl = document.createElement("div");
    ctl.className = "mediaCtl";
    const mk = (html, titleText, action) => {
      const b = document.createElement("button");
      b.className = "btnGhost mediaCtlBtn";
      b.innerHTML = html;
      b.title = titleText;
      b.setAttribute("aria-label", titleText + " — " + s.name);
      b.addEventListener("click", () => invoke("media_control", { id: s.id, action }).catch(() => {}));
      ctl.appendChild(b);
    };
    if (isYouTubeSvc(s)) mk(MEDIA_ICON_PREV, "Sebelumnya", "prev");
    mk("−10", "Mundur 10 detik", "seek-back");
    mk(m.status === "playing" ? MEDIA_ICON_PAUSE : MEDIA_ICON_PLAY, m.status === "playing" ? "Jeda" : "Putar", "toggle");
    mk("+10", "Maju 10 detik", "seek-fwd");
    if (isYouTubeSvc(s)) mk(MEDIA_ICON_NEXT, "Berikutnya", "next");
    row.append(info, ctl);
    list.appendChild(row);
  }
}
el("mediaBtn").addEventListener("click", () => { renderMediaPanel(); openPanel(mediaPanel); });
el("mediaClose").addEventListener("click", closePanels);

// Bell button (v0.8.5): toggles the notification menu for the
// active service. The menu is a panel like the others — opening
// it hides the service webviews — but anchored under the button
// and clamped to the viewport; outside clicks, Escape and
// service switches close it via the shared panel machinery.
el("notifBtn").addEventListener("click", async () => {
  if (!notifMenu.hidden) { await closePanels(); return; }
  const s = services.find(x => x.id === activeId);
  if (!s) return;
  const mode = notifModeOf(s);
  for (const b of notifMenu.querySelectorAll(".popItem")) {
    const on = b.dataset.notifMode === mode;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  }
  const r = el("notifBtn").getBoundingClientRect();
  const menuLeft = Math.max(8, Math.min(r.left, window.innerWidth - 224));
  notifMenu.style.left = menuLeft + "px";
  notifMenu.style.top = (r.bottom + 6) + "px";
  // The popover grows from the bell (v0.8.6): origin on the menu's
  // top edge, horizontally at the button's centre (the menu is
  // 208px wide; its left was clamped above, so recompute against
  // the final position).
  const originX = Math.max(0, Math.min(r.left + r.width / 2 - menuLeft, 208));
  notifMenu.style.transformOrigin = originX + "px 0px";
  await openPanel(notifMenu);
});
for (const b of notifMenu.querySelectorAll(".popItem")) {
  b.addEventListener("click", async () => {
    const s = services.find(x => x.id === activeId);
    if (s) {
      // Same storage semantics as the edit dialog: "allow" is
      // the absence of the field.
      if (b.dataset.notifMode === "default" || b.dataset.notifMode === "deny") s.notif = b.dataset.notifMode;
      else delete s.notif;
      store.save(services);
      pushNotifPolicy(s);
      refreshNotifBtn();
    }
    await closePanels();
  });
}

// ------------------------------------------------------------------
// Split view controls (v0.9.0). The toggle only exists while
// the double gate passes (Rust reports it at startup and on
// every "split-gate" change). The divider's drag is NOT tracked
// here: native service webviews swallow pointer events, so a
// pointer-capture drag would die mid-gesture — the strip's
// pointerdown only starts Rust's cursor-polling session, and
// the strip follows the "split-ratio" events it emits.
el("splitBtn").addEventListener("click", async () => {
  if (splitOn) await exitSplit();
  else await enterSplit();
});
// Companion header strip controls (v0.9.1): Ganti re-opens
// the picker over the parked companion, Tutup leaves split
// exactly like the top-bar toggle, and the picker's Batal
// returns to the companion that is already open.
el("compChange").addEventListener("click", startReplacePick);
el("compClose").addEventListener("click", async () => { await exitSplit(); });
el("splitPickCancel").addEventListener("click", cancelSplitPick);
const splitDivider = el("splitDivider");
splitDivider.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !splitOn) return;
  e.preventDefault();
  splitDivider.classList.add("dragging");
  invoke("split_drag_start").catch(() => splitDivider.classList.remove("dragging"));
});
// Fallback cleanup if the pointer comes up over the UI itself;
// the authoritative end is Rust's "split-drag-end" event.
splitDivider.addEventListener("pointerup", () => splitDivider.classList.remove("dragging"));
splitDivider.addEventListener("dblclick", async () => {
  splitRatio = 0.5;
  saveSplitPrefs();
  try { await invoke("split_set_ratio", { ratio: 0.5 }); } catch { /* layout keeps the old ratio */ }
  layoutSplitChrome();
});
splitDivider.addEventListener("keydown", async (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const avail = Math.max(1, window.innerWidth - 76 - SPLIT_DIVIDER_W);
  const cur = splitMainW() / avail;
  const next = Math.min(0.95, Math.max(0.05, cur + (e.key === "ArrowRight" ? 0.02 : -0.02)));
  splitRatio = next;
  saveSplitPrefs();
  try { await invoke("split_set_ratio", { ratio: next }); } catch { /* layout keeps the old ratio */ }
  layoutSplitChrome();
});
window.__TAURI__.event.listen("split-ratio", (e) => {
  const r = Number(e.payload);
  if (Number.isFinite(r) && r > 0 && r < 1) splitRatio = r;
  layoutSplitChrome();
});
window.__TAURI__.event.listen("split-drag-end", (e) => {
  const r = Number(e.payload);
  if (Number.isFinite(r) && r > 0 && r < 1) splitRatio = r;
  saveSplitPrefs();
  splitDivider.classList.remove("dragging");
  layoutSplitChrome();
});
window.__TAURI__.event.listen("split-gate", (e) => {
  splitGateOk = !!e.payload;
  if (!splitGateOk && splitOn) {
    // The gate collapsed under an active split: Rust already
    // parked the companion and restored the single layout.
    // Mirror it here — the companion choice stays stored, so
    // re-entering split (once the gate passes again) brings
    // the same companion back.
    splitOn = false;
    splitPicking = false;
    layoutSplitChrome();
  }
  refreshSplitBtn();
});
window.addEventListener("resize", () => layoutSplitChrome());

// ------------------------------------------------------------------
// First-open permission dialog (v0.8.8). WebView2 has no native
// permission prompt, so Sodium asks once itself: the first time a
// service is opened successfully and it has never been asked
// (permAsked absent), this centred modal offers Izinkan / Tolak
// for notifications, microphone and camera. Microphone and camera
// share the one media policy, so their two segmented rows move
// together. ANY way out of the dialog — Simpan, Escape, outside
// click, another panel taking over — saves the choices currently
// shown: openPanel and closePanels both call savePermChoices()
// before doing anything else, and it no-ops once saved.
let permSvc = null;
let permChoice = { notif: "allow", media: "allow" };
function openPermDialog(s) {
  permSvc = s;
  // Initial values come from the service's stored modes; the
  // dialog only knows Izinkan / Tolak, so a stored "default"
  // starts at Izinkan (the historical behaviour).
  permChoice = {
    notif: notifModeOf(s) === "deny" ? "deny" : "allow",
    media: mediaModeOf(s) === "deny" ? "deny" : "allow",
  };
  el("permTitle").textContent = "Izin untuk " + s.name;
  paintPermDialog();
  openPanel(permPanel);
}
function paintPermDialog() {
  for (const b of permPanel.querySelectorAll("[data-perm-kind]")) {
    const on = permChoice[b.dataset.permKind] === b.dataset.permVal;
    b.classList.toggle("sel", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  }
}
function savePermChoices() {
  const s = permSvc;
  if (!s) return;
  permSvc = null;
  // Same storage semantics as the edit dialog: "allow" (and the
  // dialog's Izinkan) is the absence of the field.
  if (permChoice.notif === "deny") s.notif = "deny"; else delete s.notif;
  if (permChoice.media === "deny") s.media = "deny"; else delete s.media;
  s.permAsked = true;
  store.save(services);
  pushNotifPolicy(s);
  pushMediaPolicy(s);
  render();
}
for (const b of permPanel.querySelectorAll("[data-perm-kind]")) {
  b.addEventListener("click", () => {
    permChoice[b.dataset.permKind] = b.dataset.permVal;
    paintPermDialog();
  });
}
el("permSave").addEventListener("click", async () => {
  savePermChoices();
  await closePanels();
});

// Update check against the public GitHub repo: the latest release
// is compared with the running version. The installer downloads
// inside Sodium (the UI webview has the same download handler as
// the service webviews); once it lands, the panel offers to run it.
let appVer = "";
let updateAssetUrl = "";
let pendingLatest = "";
function refreshUpdateButtons() {
  const ready = !!installerPath;
  el("updateInstall").hidden = !ready;
  el("updateDownload").hidden = ready;
}
// Persistent dot on the top-bar update button while a newer
// version is known to exist: it survives the panel being closed
// and only clears once Sodium is up to date again.
function refreshUpdateDot() {
  el("updateDot").hidden = !pendingLatest;
}
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
    // The fetch succeeded: only now is the check schedule consumed.
    // A failed check (offline at startup, say) must not burn the
    // day's slot the way the pre-v0.8.0 code did.
    localStorage.setItem("sodium.lastUpdateCheck", new Date().toDateString()); scheduleConfigSave();
    const latest = String(rel.tag_name || "").replace(/^v/, "");
    if (!latest || !appVer) throw new Error("no version");
    if (!versionNewer(latest, appVer)) {
      pendingLatest = "";
      refreshUpdateDot();
      if (manual) showToast("Sodium sudah versi terbaru (v" + appVer + ").");
      return;
    }
    const asset = (rel.assets || []).find(a => /setup\.exe$/i.test(a.name)) || (rel.assets || [])[0];
    updateAssetUrl = asset ? asset.browser_download_url : rel.html_url;
    pendingLatest = latest;
    // An installer for this exact version may already sit in the
    // download history (e.g. downloaded in a previous session).
    if (!installerPath) {
      const d = downloads.find(x => x.source === "sodium-update" && x.name.includes(latest));
      if (d) installerPath = d.path;
    }
    refreshUpdateButtons();
    refreshUpdateDot();
    el("updateTitle").textContent = "Sodium v" + latest + " tersedia";
    el("updateBody").textContent = (rel.body || "").trim() || "Catatan rilis tidak tersedia.";
    // Automatic checks only light the dot; the panel opens from the
    // button (or a manual check), never by popping up on its own.
    if (manual) openPanel(updatePanel);
  } catch {
    if (manual) showToast("Gagal memeriksa update — periksa koneksi internet.");
  }
}

// Automatic checks: once shortly after startup, then every 6 hours
// while Sodium keeps running — a release dropped mid-day is noticed
// without waiting for a restart or the next day.
function scheduleAutoUpdateChecks() {
  setTimeout(() => checkUpdate(false), 5000);
  setInterval(() => checkUpdate(false), 6 * 60 * 60 * 1000);
}

el("updateBtn").addEventListener("click", () => {
  if (pendingLatest) { openPanel(updatePanel); return; }
  checkUpdate(true);
});
el("updateLater").addEventListener("click", closePanels);
el("updateBrowser").addEventListener("click", () => {
  if (updateAssetUrl) invoke("open_external", { url: updateAssetUrl }).catch(() => {});
  closePanels();
});
el("updateDownload").addEventListener("click", () => {
  if (!updateAssetUrl) return;
  // Anchor navigation to the asset: GitHub serves it as an
  // attachment, so the UI webview's download handler takes over
  // (Save As dialog, progress pill, history) instead of navigating.
  const a = document.createElement("a");
  a.href = updateAssetUrl;
  document.body.appendChild(a);
  a.click();
  a.remove();
  closePanels();
});
el("updateInstall").addEventListener("click", async () => {
  if (!installerPath) return;
  try {
    await invoke("run_installer", { path: installerPath });
  } catch {
    showToast("Gagal menjalankan installer — buka dari riwayat unduhan.");
  }
});

// YouTube adblock (v0.8.0): a small script maintained in the repo
// (adblock/youtube.js) and injected by Rust into YouTube service
// webviews at creation time. It updates independently of app
// releases: this UI periodically downloads the newest script from
// the repo, stores it (localStorage, mirrored to config.json) and
// hands it to Rust via set_adblock_script. The copy bundled with
// the app is the fallback until a download succeeds. The on/off
// switch is global for every youtube.com service.
const ADBLOCK_BUNDLED_VERSION = "1.0.0";
const ADBLOCK_MANIFEST_URL = "https://raw.githubusercontent.com/aindranto/Sodium/main/adblock/manifest.json";
const ADBLOCK_SCRIPT_URL = "https://raw.githubusercontent.com/aindranto/Sodium/main/adblock/youtube.js";
let ytAdblockEnabled = localStorage.getItem("sodium.ytAdblock") !== "0";
function ytAdblockInfo() {
  try { return JSON.parse(localStorage.getItem("sodium.ytAdblockInfo") || "{}"); } catch { return {}; }
}
function saveYtAdblockInfo(info) {
  localStorage.setItem("sodium.ytAdblockInfo", JSON.stringify(info)); scheduleConfigSave();
}
function ytAdblockVersion() {
  return ytAdblockInfo().version || ADBLOCK_BUNDLED_VERSION;
}
async function pushAdblockToRust() {
  try { await invoke("set_adblock_enabled", { enabled: ytAdblockEnabled }); } catch { /* older Rust */ }
  const script = localStorage.getItem("sodium.ytAdblockScript");
  if (script) { try { await invoke("set_adblock_script", { script }); } catch { /* older Rust */ } }
}
async function checkYtAdblock(manual) {
  try {
    const res = await fetch(ADBLOCK_MANIFEST_URL);
    if (!res.ok) throw new Error("http " + res.status);
    const man = await res.json();
    const latest = String(man.version || "").trim();
    if (!latest) throw new Error("no version");
    const info = ytAdblockInfo();
    info.lastCheck = Date.now();
    if (versionNewer(latest, ytAdblockVersion())) {
      const sres = await fetch(ADBLOCK_SCRIPT_URL);
      if (!sres.ok) throw new Error("http " + sres.status);
      const text = await sres.text();
      if (!text || !text.includes("youtube.com")) throw new Error("bad script");
      localStorage.setItem("sodium.ytAdblockScript", text); scheduleConfigSave();
      info.version = latest;
      info.source = "Unduhan";
      saveYtAdblockInfo(info);
      try { await invoke("set_adblock_script", { script: text }); } catch { /* older Rust */ }
      if (manual) showToast("Adblock YouTube diperbarui ke v" + latest + ".");
    } else {
      saveYtAdblockInfo(info);
      if (manual) showToast("Adblock YouTube sudah versi terbaru (v" + ytAdblockVersion() + ").");
    }
  } catch {
    if (manual) showToast("Gagal memeriksa update adblock — periksa koneksi internet.");
  }
  if (!adblockPanel.hidden) paintAdblockPanel();
}
function scheduleYtAdblockCheck() {
  const last = ytAdblockInfo().lastCheck || 0;
  if (Date.now() - last < 24 * 60 * 60 * 1000) return;
  setTimeout(() => checkYtAdblock(false), 7000);
}

let adblockReturnEditId = null;
async function openAdblockPanel(fromEditId) {
  adblockReturnEditId = fromEditId || null;
  paintAdblockPanel();
  await openPanel(adblockPanel);
}
function paintAdblockPanel() {
  const info = ytAdblockInfo();
  el("adblockToggle").checked = ytAdblockEnabled;
  el("adblockVersion").textContent = "v" + ytAdblockVersion() + " (" + (info.source || "Bawaan") + ")";
  el("adblockChecked").textContent = info.lastCheck ? new Date(info.lastCheck).toLocaleString("id-ID") : "Belum pernah";
}
el("adblockToggle").addEventListener("change", async () => {
  ytAdblockEnabled = el("adblockToggle").checked;
  localStorage.setItem("sodium.ytAdblock", ytAdblockEnabled ? "1" : "0"); scheduleConfigSave();
  try { await invoke("set_adblock_enabled", { enabled: ytAdblockEnabled }); } catch { /* older Rust */ }
});
el("adblockCheckBtn").addEventListener("click", () => checkYtAdblock(true));
el("adblockClose").addEventListener("click", async () => {
  const back = adblockReturnEditId;
  adblockReturnEditId = null;
  if (back) {
    const s = services.find(x => x.id === back);
    if (s) { await openEditDialog(s); return; }
  }
  await closePanels();
});

// Read the version from the app so it cannot go stale.
window.__TAURI__.app.getVersion()
  .then(v => { appVer = v; el("appVersion").textContent = "Sodium v" + v; })
  .catch(() => {});

// Unread badge counts from Rust (page-title watcher in each service
// webview). Only the affected tile's badge is updated (v0.8.6);
// popId still marks the tile whose count just rose so a full
// render (e.g. a service switch racing the event) pops it too.
let popId = null;
window.__TAURI__.event.listen("unread-changed", (e) => {
  const [id, count] = e.payload;
  const prev = unread.get(id) || 0;
  if (count > 0) unread.set(id, count); else unread.delete(id);
  if (count > prev) popId = id;
  updateBadge(id, count > prev);
});

// Ctrl+1..9 also arrives from Rust as a global shortcut while the
// Sodium window is focused (registered on window focus, released on
// blur), because keydown inside a service webview never reaches this UI.
window.__TAURI__.event.listen("shortcut-switch", (e) => {
  const s = services[Number(e.payload)];
  if (s) switchTo(s);
});

// "Mulai kelompok": right-clicking a named group separator in the
// sidebar opens this panel; confirming starts every (enabled)
// member hidden, then switches to the first one. switch_service's
// own eviction trims the alive set to the "Hidup bareng" limit.
let groupCtx = null;
async function openGroupPanel(name) {
  groupCtx = name;
  el("groupTitle").textContent = "Kelompok " + name;
  await openPanel(groupPanel);
}
el("groupCancel").addEventListener("click", closePanels);
el("groupStart").addEventListener("click", async () => {
  if (!groupCtx) return;
  const members = services.filter(s => groupOf(s) === groupCtx && !disabled.has(s.id));
  await closePanels();
  for (const m of members) {
    if (m.id === activeId) continue;
    try { await invoke("start_service_hidden", { id: m.id, url: m.url }); } catch { /* ignore */ }
  }
  if (members.length) switchTo(members[0]);
});

// Quick switcher (Alt+Space, arriving from Rust as a global
// shortcut while the window is focused): a centred panel listing
// every service — tile icon, name, group caption, an "Aktif" pill
// for the current service and an accent dot for services whose
// webview is alive. Type to filter by name or group; arrows +
// Enter or a click switch.
const quickList = el("quickList");
const quickSearch = el("quickSearch");
let quickRows = []; // { svc, row } entries currently shown (post-filter)
let quickSel = 0;
let quickAlive = new Set();

async function openQuickSwitch() {
  try {
    const labels = await invoke("alive_services");
    quickAlive = new Set(labels.map(l => l.startsWith("service-") ? l.slice("service-".length) : l));
  } catch { quickAlive = new Set(); }
  quickSearch.value = "";
  renderQuickList("");
  await openPanel(quickPanel);
  quickSearch.focus();
}

function renderQuickList(q) {
  const query = (q || "").trim().toLowerCase();
  quickList.innerHTML = "";
  quickRows = [];
  for (const s of services) {
    if (query && !s.name.toLowerCase().includes(query) && !groupOf(s).toLowerCase().includes(query)) continue;
    const row = document.createElement("div");
    row.className = "qRow" + (disabled.has(s.id) ? " off" : "");
    // Listbox semantics (v0.8.6): the container is role=listbox in
    // the markup, rows are options, and paintQuickSel keeps
    // aria-selected + the search input's aria-activedescendant in
    // step with the visual selection.
    row.setAttribute("role", "option");
    row.id = "qrow-" + s.id;
    row.setAttribute("aria-selected", "false");
    const tile = document.createElement("span");
    tile.className = "tileIcon qTile";
    if (s.img) {
      const im = document.createElement("img");
      im.className = "svcImg"; im.src = s.img; im.alt = "";
      const f = imgFilter(s); if (f) im.style.filter = f;
      // Same broken-favicon fallback as the sidebar.
      im.onerror = () => {
        im.replaceWith(iconVisual(s, 20));
        if (s.color) tile.style.background = s.color;
      };
      tile.appendChild(im);
    } else {
      if (s.color) tile.style.background = s.color;
      tile.appendChild(iconVisual(s, 20));
    }
    const info = document.createElement("div");
    info.className = "qInfo";
    const nm = document.createElement("div");
    nm.className = "qName";
    nm.textContent = s.name;
    info.appendChild(nm);
    const g = groupOf(s);
    if (g) {
      const cap = document.createElement("div");
      cap.className = "qGroup";
      cap.textContent = g;
      info.appendChild(cap);
    }
    row.append(tile, info);
    if (quickAlive.has(s.id)) {
      const dot = document.createElement("span");
      dot.className = "qAlive";
      dot.title = "Sedang hidup";
      row.appendChild(dot);
    }
    if (s.id === activeId) {
      const p = document.createElement("span");
      p.className = "mgPill pin";
      p.textContent = "Aktif";
      row.appendChild(p);
    }
    const entry = { svc: s, row };
    row.addEventListener("click", () => activateQuick(entry));
    row.addEventListener("mouseenter", () => {
      const i = quickRows.indexOf(entry);
      if (i >= 0) { quickSel = i; paintQuickSel(); }
    });
    quickRows.push(entry);
    quickList.appendChild(row);
  }
  if (!quickRows.length) {
    const d = document.createElement("div");
    d.className = "dlEmpty";
    d.textContent = "Tidak ada layanan yang cocok.";
    quickList.appendChild(d);
  }
  // Start on the active service when it is in the list.
  quickSel = Math.max(0, quickRows.findIndex(r => r.svc.id === activeId));
  paintQuickSel();
}

function paintQuickSel() {
  quickRows.forEach((r, i) => {
    const on = i === quickSel;
    r.row.classList.toggle("sel", on);
    r.row.setAttribute("aria-selected", on ? "true" : "false");
    if (on) {
      quickSearch.setAttribute("aria-activedescendant", r.row.id);
      r.row.scrollIntoView({ block: "nearest" });
    }
  });
}

async function activateQuick(entry) {
  if (!entry) return;
  const s = entry.svc;
  await closePanels();
  // Disabled services open their menu instead, like a sidebar click.
  if (disabled.has(s.id)) { await openCtx(s); return; }
  switchTo(s);
}

quickSearch.addEventListener("input", () => renderQuickList(quickSearch.value));
quickSearch.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (quickSel < quickRows.length - 1) { quickSel++; paintQuickSel(); }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (quickSel > 0) { quickSel--; paintQuickSel(); }
  } else if (e.key === "Enter") {
    e.preventDefault();
    activateQuick(quickRows[quickSel]);
  }
});

window.__TAURI__.event.listen("quick-switch", () => { openQuickSwitch(); });

// Export / import the whole configuration (services, groups, pins,
// zoom, settings) as one JSON file — the same snapshot shape that
// config.json uses. Login sessions live in the per-service profile
// folders and deliberately do NOT travel with it.
el("exportBtn").addEventListener("click", exportConfig);
el("importBtn").addEventListener("click", importConfig);

async function exportConfig() {
  const data = {};
  for (const k of CFG_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) data[k] = v;
  }
  try {
    const done = await invoke("export_config", { data: JSON.stringify({ rev: cfgRev, data }) });
    if (done) showToast("Konfigurasi diekspor.");
  } catch { showToast("Gagal mengekspor konfigurasi."); }
}

async function importConfig() {
  let text;
  try { text = await invoke("import_config"); } catch { return; }
  if (!text) return; // dialog cancelled
  let snap;
  try {
    snap = JSON.parse(text);
    if (!snap || !snap.data || !Array.isArray(JSON.parse(snap.data["sodium.services"] || "null"))) {
      throw new Error("invalid config file");
    }
  } catch { showToast("File konfigurasi tidak valid."); return; }

  // Replacing the whole configuration is destructive enough to
  // ask first (v0.8.6): the file was validated above, and only a
  // confirmed import proceeds to applyImport. Cancelling returns
  // to the Kelola panel with the current configuration untouched.
  openConfirm({
    title: "Impor konfigurasi",
    body: "Impor akan mengganti seluruh konfigurasi Sodium saat ini — daftar layanan, pin, kelompok, zoom, dan pengaturan — dengan isi file ini. Sesi login di tiap layanan tidak berubah. Lanjutkan?",
    okLabel: "Impor",
    fromManage: true,
    onOk: async () => { await applyImport(snap); },
  });
}

async function applyImport(snap) {
  const oldUrls = new Map(services.map(s => [s.id, s.url]));
  const oldPinned = new Set(pinned);

  applyingConfig = true;
  for (const k of CFG_KEYS) {
    if (k in snap.data) localStorage.setItem(k, snap.data[k]);
    else localStorage.removeItem(k);
  }
  if (typeof snap.rev === "number") cfgRev = snap.rev;
  localStorage.setItem("sodium.cfgRev", String(cfgRev));
  applyingConfig = false;
  scheduleConfigSave();

  // Reload the in-memory state, mirroring applyConfigFromRust().
  services = store.load();
  pinned = store.pinned();
  disabled = store.disabled();
  loadGroups();
  reloadSplitPrefs();
  showNames = localStorage.getItem("sodium.showNames") === "1";
  iconSize = parseInt(localStorage.getItem("sodium.iconSize") || "48", 10) || 48;
  applyIconSize();
  try { zoomByService = JSON.parse(localStorage.getItem("sodium.zoomByService") || "{}"); } catch { zoomByService = {}; }
  try { downloads = JSON.parse(localStorage.getItem("sodium.downloads") || "[]"); } catch { downloads = []; }
  el("showNamesToggle").checked = showNames;
  el("maxAlive").value = localStorage.getItem("sodium.maxAlive") || "1";

  // Push the restored settings into Rust.
  invoke("set_max_alive", { max: Number(localStorage.getItem("sodium.maxAlive") || "1") });
  for (const id of pinned) invoke("set_pinned", { id, pinned: true });
  for (const s of services) { pushNotifPolicy(s); pushMediaPolicy(s); }
  for (const id of oldPinned) {
    if (!pinned.has(id)) invoke("set_pinned", { id, pinned: false });
  }

  // Webviews of services that vanished or changed URL must stop;
  // close_webview keeps their profile folders (sessions survive).
  let activeGone = false;
  for (const [id, url] of oldUrls) {
    const now = services.find(s => s.id === id);
    if (!now || now.url !== url) {
      await invoke("close_webview", { id });
      if (activeId === id) activeGone = true;
    }
  }
  if (activeId && !services.some(s => s.id === activeId)) activeGone = true;
  if (activeGone) {
    activeId = null;
    el("activeName").textContent = "Sodium";
    el("welcome").style.display = "";
    showZoom();
  }
  // Split view follows the imported snapshot: a companion that
  // no longer exists (or is now the main service) is cleared,
  // and losing the main service collapses split.
  if (companionId && (!services.some(s => s.id === companionId) || companionId === activeId)) {
    companionId = null;
    splitPicking = false;
    saveSplitPrefs();
    invoke("split_set_companion", { id: null, url: null }).catch(() => {});
  }
  if (activeGone && splitOn) await exitSplit();
  layoutSplitChrome();

  render();
  renderManage();
  showToast("Konfigurasi diimpor.");
}

// Keyboard: Escape closes the link popup or any open panel;
// Ctrl/Cmd + 1..9 switches services; Alt+Space opens the quick
// switcher (fallback for when focus sits in this UI webview —
// inside a service webview the Rust global shortcut covers it).
window.addEventListener("keydown", async (e) => {
  if (e.altKey && e.code === "Space") {
    e.preventDefault();
    openQuickSwitch();
    return;
  }
  if (e.key === "Escape") {
    // Replace-picking has its own Esc: back to the companion
    // that is parked behind the picker (v0.9.1).
    if (splitPicking) { await cancelSplitPick(); return; }
    if (!groupMenu.hidden) { hideGroupMenu(); return; }
    if (linkPopupOpen) { await closeLinkPopup(); return; }
    const open = allPanels.find(p => !p.hidden);
    if (open) {
      // Same implicit-dismiss guards as the outside-click path:
      // Escape on the discard confirmation cancels back to the
      // edit dialog; Escape on a dirty edit draft asks first.
      if (open === confirmPanel && confirmReturnTo) { await cancelConfirm(); return; }
      if (open === editPanel && editIsDirty()) { confirmDiscardEdit(); return; }
      await closePanels();
      return;
    }
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

  // Split gate, asked once up front; Rust recomputes it on
  // resize / move / scale changes and reports flips as
  // "split-gate" events.
  try { splitGateOk = await invoke("split_gate"); } catch { splitGateOk = false; }
  refreshSplitBtn();

  // Adblock state goes to Rust before any service webview is
  // created below: the script and the switch only apply at
  // webview-creation time.
  ytAdblockEnabled = localStorage.getItem("sodium.ytAdblock") !== "0";
  await pushAdblockToRust();

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

  // Notification and media policies go to Rust too, before any
  // service webview is created below: the permission handler on
  // each webview reads them on every request.
  for (const s of services) { pushNotifPolicy(s); pushMediaPolicy(s); }
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
    if (last && !disabled.has(last.id)) await switchTo(last);
    // Split view restore: the ratio and companion choice are
    // persisted, but the mode itself only comes back when the
    // gate passes right now (enterSplit checks) and the stored
    // companion is still usable next to the restored main.
    await enterSplit();
  }
  scheduleAutoUpdateChecks();
  scheduleYtAdblockCheck();
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
    loadGroups();
    reloadSplitPrefs();
    showNames = localStorage.getItem("sodium.showNames") === "1";
    iconSize = parseInt(localStorage.getItem("sodium.iconSize") || "48", 10) || 48;
    applyIconSize();
    try { zoomByService = JSON.parse(localStorage.getItem("sodium.zoomByService") || "{}"); } catch { zoomByService = {}; }
    el("showNamesToggle").checked = showNames;
  } catch { applyingConfig = false; }
}
