// Sodium UI - no framework, no bundler. Just the sidebar.
// The heavy lifting (creating / destroying webviews) happens in Rust:
// see src-tauri/src/lib.rs -> switch_service()

const DEFAULT_SERVICES = [
  // Agung's daily driver. Everything else is added by him via "+ Tambah layanan" (custom URL).
  { id: "whatsapp",  name: "WhatsApp",  url: "https://web.whatsapp.com/",   icon: "Wa" },
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

// ---------------------------------------------------------------------------
// Panels (add service / right-click menu)
//
// Service webviews are NATIVE controls layered on top of this UI webview,
// so any panel rendered here would sit *behind* e.g. the WhatsApp webview
// and look like the button does nothing. While a panel is open we ask Rust
// to hide the service webviews (hide, not destroy: sessions stay alive).
// ---------------------------------------------------------------------------
const addPanel = document.getElementById("addPanel");
const ctxPanel = document.getElementById("ctxPanel");
let ctxService = null;

async function openPanel(panel) {
  addPanel.hidden = true;
  ctxPanel.hidden = true;
  await invoke("set_services_visible", { visible: false });
  panel.hidden = false;
}

async function closePanels() {
  addPanel.hidden = true;
  ctxPanel.hidden = true;
  await invoke("set_services_visible", { visible: true });
}

function render() {
  nav.innerHTML = "";
  for (const s of services) {
    const b = document.createElement("button");
    b.className = "svc" + (s.id === activeId ? " active" : "");
    b.title = s.name + (pinned.has(s.id) ? " (pinned - tetap hidup)" : "");
    b.textContent = s.icon || s.name.slice(0, 2);
    if (pinned.has(s.id)) {
      const p = document.createElement("span"); p.className = "pin"; p.textContent = "📌"; b.appendChild(p);
    }
    b.addEventListener("click", () => switchTo(s));
    b.addEventListener("contextmenu", async (e) => {
      e.preventDefault();
      ctxService = s;
      document.getElementById("ctxTitle").textContent = s.name;
      document.getElementById("ctxPin").textContent = pinned.has(s.id) ? "Unpin" : "Pin (tetap hidup buat notif)";
      await openPanel(ctxPanel);
    });
    nav.appendChild(b);
  }
}

async function switchTo(s) {
  if (!addPanel.hidden || !ctxPanel.hidden) await closePanels();
  activeId = s.id; render();
  document.getElementById("welcome").style.display = "none";
  try {
    await invoke("switch_service", { id: s.id, url: s.url });
    const alive = await invoke("alive_services");
    document.getElementById("ramNote").textContent = "";
    console.log("Sodium alive webviews:", alive);
  } catch (err) {
    document.getElementById("welcome").style.display = "block";
    document.getElementById("ramNote").textContent = "Gagal membuka " + s.name + ": " + err;
  }
}

// Add-service panel
document.getElementById("addBtn").addEventListener("click", async () => {
  await openPanel(addPanel);
  document.getElementById("fName").focus();
});
document.getElementById("cancelService").addEventListener("click", closePanels);
document.getElementById("saveService").addEventListener("click", async () => {
  const name = document.getElementById("fName").value.trim();
  let url = document.getElementById("fUrl").value.trim();
  const icon = document.getElementById("fIcon").value.trim();
  if (!name || !url) return;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
  services.push({ id, name, url, icon: icon || name.slice(0, 2) });
  store.save(services); render();
  document.getElementById("fName").value = "";
  document.getElementById("fUrl").value = "";
  document.getElementById("fIcon").value = "";
  await closePanels();
});

// Right-click panel actions
document.getElementById("ctxPin").addEventListener("click", async () => {
  if (!ctxService) return;
  const nowPinned = !pinned.has(ctxService.id);
  if (nowPinned) pinned.add(ctxService.id); else pinned.delete(ctxService.id);
  store.savePinned(pinned);
  invoke("set_pinned", { id: ctxService.id, pinned: nowPinned });
  render();
  await closePanels();
});
document.getElementById("ctxDelete").addEventListener("click", async () => {
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
document.getElementById("ctxClose").addEventListener("click", closePanels);

// Keyboard shortcuts: Ctrl/Cmd + 1..9
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
    const s = services[Number(e.key) - 1]; if (s) switchTo(s);
  }
});

// "Hidup bareng" setting: how many non-pinned services may stay alive.
// Stored locally, pushed into the Rust side on startup and on change.
const maxAliveSel = document.getElementById("maxAlive");
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
