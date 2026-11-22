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
// Unread counts per service id, reported by Rust from page titles
// ("(3) WhatsApp"). Only alive webviews report; Rust sends 0 when a
// webview is closed or evicted, so a badge never shows a stale count.
const unread = new Map();
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

let lastFocus = null;
async function openPanel(panel) {
  lastFocus = document.activeElement;
  for (const p of allPanels) p.hidden = true;
  await invoke("set_services_visible", { visible: false });
  panel.hidden = false;
  const f = panel.querySelector("input:not([type='file']), button:not([disabled])");
  if (f) f.focus();
}

async function closePanels() {
  for (const p of allPanels) p.hidden = true;
  await invoke("set_services_visible", { visible: true });
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

// Clicking outside an open panel (welcome area, top bar) closes it.
// Sidebar clicks are excluded: they run their own open/switch logic.
document.addEventListener("click", (e) => {
  const open = allPanels.find(p => !p.hidden);
  if (!open) return;
  if (open.contains(e.target)) return;
  if (e.target.closest("#sidebar")) return;
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

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
// Open the right-click menu for a service. Used by the contextmenu
// event, by clicking a disabled service, and from the keyboard
// (ContextMenu key / Shift+F10 on the focused sidebar button), so the
// menu is reachable without a mouse too.
async function openCtx(s) {
  ctxService = s;
  el("ctxTitle").textContent = s.name;
  el("ctxPin").textContent = pinned.has(s.id) ? "Unpin" : "Pin (tetap hidup buat notif)";
  el("ctxDisable").textContent = disabled.has(s.id) ? "Aktifkan lagi" : "Nonaktifkan (matikan total sementara)";
  // Delete is a two-step action (see the ctxDelete handler): every fresh
  // opening of the menu starts disarmed.
  const del = el("ctxDelete");
  del.dataset.armed = "";
  del.textContent = "Hapus layanan";
  await openPanel(ctxPanel);
}

function render() {
  nav.innerHTML = "";
  for (const s of services) {
    const b = document.createElement("button");
    b.className = "svc" + (s.id === activeId ? " active" : "") + (disabled.has(s.id) ? " disabled" : "");
    b.title = s.name + (pinned.has(s.id) ? " (pinned - tetap hidup)" : "") + (disabled.has(s.id) ? " (nonaktif, klik untuk mengaktifkan lagi)" : "");
    b.setAttribute("aria-label", b.title);
    if (s.img) {
      const im = document.createElement("img");
      im.className = "svcImg"; im.src = s.img; im.alt = "";
      b.appendChild(im);
    } else {
      b.textContent = s.icon || s.name.slice(0, 2);
      if (s.color) b.style.background = s.color;
    }
    if (pinned.has(s.id)) {
      const p = document.createElement("span"); p.className = "pin"; b.appendChild(p);
    }
    const n = unread.get(s.id);
    if (n && !disabled.has(s.id)) {
      const bd = document.createElement("span");
      bd.className = "badge";
      bd.textContent = n > 99 ? "99+" : String(n);
      b.appendChild(bd);
    }
    b.addEventListener("click", async () => {
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
  localStorage.setItem("sodium.lastActive", s.id);
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
    el("welcome").style.display = "block";
    el("ramNote").textContent = "Gagal membuka " + s.name + ": " + err;
    el("ramNote").classList.add("error");
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
  if (!grid.children.length) {
    const d = document.createElement("div");
    d.className = "pickerEmpty";
    d.textContent = q
      ? "Tidak ada layanan yang cocok dengan \"" + searchInput.value.trim() + "\". Coba kata lain, atau tambah lewat form custom URL di bawah."
      : "Semua layanan di katalog sudah ditambahkan.";
    grid.appendChild(d);
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
  el("iconTitle").textContent = "Ganti ikon: " + ctxService.name;
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
      if (localStorage.getItem("sodium.lastActive") === id) localStorage.removeItem("sodium.lastActive");
      el("activeName").textContent = "Sodium";
      el("welcome").style.display = "block";
      showZoom();
    }
  }
  store.saveDisabled(disabled);
  render();
  await closePanels();
});
el("ctxDelete").addEventListener("click", async () => {
  if (!ctxService) return;
  // Two-step delete: the first click arms the button, the second one
  // really deletes. The profile folder stays on disk either way, so
  // re-adding the service later restores the login session.
  if (!el("ctxDelete").dataset.armed) {
    el("ctxDelete").dataset.armed = "1";
    el("ctxDelete").textContent = "Yakin hapus? Klik sekali lagi";
    return;
  }
  const id = ctxService.id;
  services = services.filter(x => x.id !== id);
  store.save(services);
  if (pinned.has(id)) { pinned.delete(id); store.savePinned(pinned); }
  if (disabled.has(id)) { disabled.delete(id); store.saveDisabled(disabled); }
  if (activeId === id) activeId = null;
  if (localStorage.getItem("sodium.lastActive") === id) localStorage.removeItem("sodium.lastActive");
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

// ---------------------------------------------------------------------------
// Link popup
//
// Links inside a service that ask for a new window (target=_blank,
// window.open) are denied by Rust and reported here as a "link-clicked"
// event instead. The UI shows the link bar and asks Rust to open the
// popup webview floating over the active service.
// ---------------------------------------------------------------------------
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

// Download toast: Rust reports the saved path when a download finishes.
let toastTimer = null;
window.__TAURI__.event.listen("download-finished", (e) => {
  const path = String(e.payload || "");
  if (!path) return;
  const toast = el("toast");
  toast.textContent = "Tersimpan: " + path;
  toast.title = path;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
});

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
    localStorage.setItem("sodium.zoomByService", JSON.stringify(zoomByService));
    await invoke("set_service_zoom", { id: activeId, scale });
  } else {
    // No service open: the buttons adjust the default for new services.
    localStorage.setItem("sodium.zoom", String(scale));
  }
  showZoom();
}
el("zoomIn").addEventListener("click", () => { const i = zoomIdxFor(activeId); if (i < ZOOM_STEPS.length - 1) setZoomIdx(i + 1); });
el("zoomOut").addEventListener("click", () => { const i = zoomIdxFor(activeId); if (i > 0) setZoomIdx(i - 1); });
el("zoomLabel").addEventListener("click", () => setZoomIdx(ZOOM_STEPS.indexOf(1.0)));
showZoom();

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
// Otherwise reopen the service that was active when Sodium was closed,
// like Ferdium does, instead of landing on the welcome screen.
if (!localStorage.getItem("sodium.onboarded")) {
  openPicker();
} else {
  const lastId = localStorage.getItem("sodium.lastActive");
  const last = services.find(s => s.id === lastId);
  if (last && !disabled.has(last.id)) switchTo(last);
}
