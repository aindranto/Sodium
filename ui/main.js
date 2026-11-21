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
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const choice = prompt(`${s.name}\nKetik: pin = pin/unpin (tetap hidup buat notif)\nhapus = hapus layanan`, "");
      if (choice === "pin") {
        pinned.has(s.id) ? pinned.delete(s.id) : pinned.add(s.id);
        store.savePinned(pinned);
        invoke("set_pinned", { id: s.id, pinned: pinned.has(s.id) });
        render();
      } else if (choice === "hapus") {
        services = services.filter(x => x.id !== s.id); store.save(services); render();
      }
    });
    nav.appendChild(b);
  }
}

async function switchTo(s) {
  activeId = s.id; render();
  document.getElementById("welcome").style.display = "none";
  try {
    await invoke("switch_service", { id: s.id, url: s.url });
    const alive = await invoke("alive_services");
    document.getElementById("ramNote").textContent = "";
    console.log("Sodium alive webviews:", alive);
  } catch (err) {
    document.getElementById("welcome").style.display = "block";
    alert("Gagal membuka " + s.name + ": " + err);
  }
}

// Add-service dialog
const dlg = document.getElementById("addDialog");
document.getElementById("addBtn").addEventListener("click", () => dlg.showModal());
document.getElementById("saveService").addEventListener("click", (e) => {
  const name = document.getElementById("fName").value.trim();
  const url = document.getElementById("fUrl").value.trim();
  const icon = document.getElementById("fIcon").value.trim();
  if (!name || !url) return;
  e.preventDefault(); dlg.close();
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
  services.push({ id, name, url, icon: icon || name.slice(0, 2) });
  store.save(services); render();
});

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
