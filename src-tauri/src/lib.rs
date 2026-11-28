use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::webview::{
    DownloadEvent, NewWindowResponse, PermissionKind, PermissionResponse, WebviewBuilder,
};
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WindowEvent};

/// Width of the sidebar rendered by Sodium's own UI (ui/index.html).
const SIDEBAR_W: f64 = 76.0;

/// Height of the top bar rendered by Sodium's own UI (ui/index.html):
/// active service name, zoom controls and the "Hidup bareng" setting.
const TOPBAR_H: f64 = 44.0;

/// Height of the link bar the UI shows above the link popup.
const LINKBAR_H: f64 = 40.0;

/// Label of the link-popup webview. Deliberately not "service-"-prefixed:
/// it is not a service (no eviction, no profile-per-service rules).
const POPUP_LABEL: &str = "link-popup";

/// Label of the webview that renders Sodium's own UI inside the main window.
const UI_LABEL: &str = "ui";

/// Width of the divider strip between the two panes in split
/// view (v0.9.0). The strip is rendered by Sodium's own UI in the
/// gap the layout leaves between the main and companion webviews.
const DIVIDER_W: f64 = 6.0;

/// Minimum logical width of either pane in split view. The split
/// ratio is clamped against the current content width so neither
/// pane can be dragged (or restored) below this.
const MIN_PANE_W: f64 = 400.0;

/// Height of the companion header strip the UI renders at the
/// top of the right pane in split view (v0.9.1): the companion
/// webview starts this far below the pane top and is shorter
/// by the same amount, so the strip (companion name + Ganti /
/// Tutup buttons) is never covered by the native webview.
const COMPANION_STRIP_H: f64 = 32.0;

#[derive(Default)]
struct AppState {
    /// Labels of alive service webviews, most-recently-used first.
    alive_mru: Mutex<Vec<String>>,
    /// Service ids the user pinned: exempt from eviction (e.g. WhatsApp,
    /// so its notifications keep working).
    pinned: Mutex<HashSet<String>>,
    /// User setting: how many non-pinned service webviews may be alive at
    /// the same time. 1 = lightest (default). 0 = unlimited (Ferdium-like,
    /// RAM grows with every service opened).
    max_alive: Mutex<usize>,
    /// Browser-style page zoom per service (service id -> scale,
    /// 1.0 = 100%). Each service remembers its own zoom; services without
    /// an entry use 100%.
    zoom: Mutex<HashMap<String, f64>>,
    /// Per-service notification permission policy (service id ->
    /// "allow" | "default" | "deny"), pushed by the UI at startup
    /// and whenever a service's setting changes. Services without
    /// an entry are treated as "allow". Read on every permission
    /// request by the handler on the service webview itself (see
    /// create_service_webview).
    notif_policy: Mutex<HashMap<String, String>>,
    /// Per-service microphone/camera permission policy (service id ->
    /// "allow" | "default" | "deny"), pushed by the UI exactly like
    /// notif_policy (startup, edit saves, config import, the
    /// first-open permission dialog). Services without an entry are
    /// treated as "allow". Read on every permission request by the
    /// handler on the service webview itself (see
    /// create_service_webview).
    media_policy: Mutex<HashMap<String, String>>,
    /// Page notifications recorded by the bridge script
    /// (v0.10.0), surfaced by the v0.11.0 notification panel.
    /// Mirrored to notifications.json in the app data dir
    /// (debounced, see schedule_persist_notifications) and
    /// loaded back at startup, so the panel survives restarts.
    /// Capped at 200 in handle_bridge_message.
    page_notifications: Mutex<Vec<PageNotification>>,
    /// Generation counter for debouncing notification-store
    /// writes: a burst of incoming notifications schedules
    /// several writes, only the newest one touches the disk.
    /// Same pattern as the split gate's gate_gen.
    notif_save_gen: std::sync::atomic::AtomicU64,
    /// Bridge liveness per service id (v0.10.1): how many RAW
    /// WebMessageReceived callbacks the service's webview has
    /// produced, and when the last one arrived. The counter is
    /// bumped at the very top of the handler closure, before
    /// the message is extracted or parsed — it measures
    /// CONTACT, so a bridge whose script sends garbage still
    /// counts as alive, while a handler that never fires (or
    /// a script that never runs) stays at zero. No UI reads
    /// this yet — it is the liveness foundation the v0.11.0
    /// notification panel will surface.
    bridge_contacts: Mutex<HashMap<String, BridgeContact>>,
    /// Labels of service webviews whose bridge handler is
    /// ACTUALLY registered (v0.10.1). attach_bridge marks a
    /// label only when add_WebMessageReceived returns Ok —
    /// every failure on that path is otherwise silent.
    /// switch_service and split_set_companion consult this
    /// set and re-attach when a live webview is missing from
    /// it, so a failed registration at creation time is
    /// retried instead of permanent. Cleared in
    /// clear_bridge_state, with the rest of the per-webview
    /// bridge state.
    bridge_attached: Mutex<HashSet<String>>,
    /// Label of the service webview currently shown. Alive service
    /// webviews are stacked native controls, so exactly one may
    /// occupy the service area at a time: this one. The rest are
    /// parked off-screen (see park_webview).
    active: Mutex<Option<String>>,
    /// Whether the link popup is currently open over the active service.
    link_open: Mutex<bool>,
    /// Split view (v0.9.0): whether split mode is on. The layout
    /// shows the two panes only while this is on AND the double
    /// gate passes (see gate_ok).
    split_mode: Mutex<bool>,
    /// Label of the companion (right-pane) service webview, if one
    /// is chosen. Kept across split exit/re-enter and gate
    /// collapses — leaving split parks the companion, it never
    /// closes it — and cleared only when the UI picks another
    /// companion (or none) or the webview is destroyed.
    companion: Mutex<Option<String>>,
    /// True while the UI's companion picker is open in "replace"
    /// mode over an existing companion (v0.9.1): the layout parks
    /// the companion webview (parking, not hiding, so its page
    /// keeps running) while the user picks another service for
    /// the right pane. Reset by every command that ends the
    /// pick — choosing or clearing the companion, swapping the
    /// panes, entering or leaving split — and by a gate
    /// collapse, so the flag can never strand the companion
    /// off-screen.
    companion_picking: Mutex<bool>,
    /// Split ratio: the main pane's share of the width available
    /// to the two panes (0.5 = even). Pushed by the UI (which
    /// persists it) and by the divider drag session; the layout
    /// clamps it against the current content width.
    split_ratio: Mutex<f64>,
    /// Whether the split double gate currently passes: the
    /// monitor the window sits on offers >= 1920 logical px of
    /// width AND the window's inner width is >= 1600 logical px.
    /// Recomputed (debounced) on resize/move/scale changes; the
    /// UI learns about changes through the "split-gate" event.
    gate_ok: Mutex<bool>,
    /// Generation counter for debouncing gate rechecks: a burst
    /// of move/resize events schedules several checks, only the
    /// newest one actually recomputes.
    gate_gen: std::sync::atomic::AtomicU64,
    /// True while service webviews are hidden because a UI panel
    /// is open (see set_services_visible). The layout pass reads
    /// it so a resize or split change mid-panel cannot flash the
    /// services back over the panel.
    services_hidden: Mutex<bool>,
    /// Whether the notification drawer is open (v0.11.1). In
    /// single mode the layout shrinks the active service by the
    /// drawer's width, so the drawer PUSHES the service instead
    /// of covering it; in split mode the layout parks the
    /// companion instead, so the drawer overlays the right pane
    /// without touching the pane geometry. Set only through
    /// set_inbox_open; the UI calls it on every drawer open /
    /// close path (the shared panel machinery included) and once
    /// with `false` at startup, so the flag cannot outlive the
    /// drawer — a UI reload resets it.
    inbox_open: Mutex<bool>,
    /// True while a divider drag session is polling the cursor.
    split_dragging: std::sync::atomic::AtomicBool,
    /// Folder the Save As dialog starts in: the user's Downloads folder
    /// at first, then the last folder a download was saved to.
    download_dir: std::sync::Arc<Mutex<std::path::PathBuf>>,
    /// The main window, created in the setup hook as a plain `tauri::Window`
    /// (not a WebviewWindow) because only `Window` can host child webviews
    /// via `add_child`.
    main_window: Mutex<Option<tauri::Window>>,
    /// True once the tray icon exists; only then may closing the
    /// window mean hiding it (otherwise the app would be stranded).
    tray_ok: std::sync::atomic::AtomicBool,
    /// True once a graceful shutdown has begun: further exit
    /// requests are no longer intercepted, so the exit scheduled by
    /// begin_graceful_shutdown can actually proceed.
    shutting_down: std::sync::atomic::AtomicBool,
    /// The active YouTube adblock script: the newest copy the UI
    /// downloaded from the repo, or the bundled fallback. Injected
    /// into YouTube service webviews when they are created.
    adblock_script: Mutex<String>,
    /// Whether the YouTube adblock is switched on (UI setting,
    /// pushed to Rust at startup and whenever the switch flips).
    adblock_enabled: Mutex<bool>,
}

/// The YouTube adblock script bundled with the app: the fallback
/// until the UI downloads a newer one from the repo (the script
/// lives in adblock/ at the repo root so it can be updated without
/// an app release).
const BUNDLED_YT_ADBLOCK: &str = include_str!("../../adblock/youtube.js");

/// The shared bridge script (v0.10.0; trimmed in v0.10.3),
/// injected into every service webview: a liveness hello and
/// page-notification recording, reported back over WebView2
/// WebMessage. It lives in bridge/ at the repo root, next to
/// adblock/, so it stays a readable, separately checkable
/// file.
const BRIDGE_SCRIPT: &str = include_str!("../../bridge/bridge.js");

/// Raw bridge contact for one service (v0.10.1): how many
/// WebMessageReceived callbacks its webview has produced and
/// when the last one arrived (Sodium's own clock — the
/// page's is not trusted). Counts contact, not validity:
/// see bridge_contacts in AppState.
#[derive(Clone, Default)]
struct BridgeContact {
    count: u64,
    last_ms: u64,
}

/// One page notification the bridge script recorded (v0.10.0),
/// listed by the v0.11.0 notification panel and persisted to
/// notifications.json. `at_ms` is Sodium's own receive time:
/// the page's clock is not trusted.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct PageNotification {
    service_id: String,
    title: String,
    body: String,
    at_ms: u64,
}

fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// youtube.com and any of its subdomains (www., m., music., ...).
fn is_youtube_host(host: &str) -> bool {
    host == "youtube.com" || host.ends_with(".youtube.com")
}

fn label_for(id: &str) -> String {
    format!("service-{id}")
}

fn id_from_label(label: &str) -> &str {
    label.strip_prefix("service-").unwrap_or(label)
}

/// Service ids are minted by the UI (catalog slugs, "<slug>-<n>"
/// clones, "custom-<base36>"): lowercase letters, digits, dashes.
/// Anything else is rejected before it can reach a filesystem path.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Only web URLs may be loaded into a service or popup webview.
fn valid_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://")
}

fn logical_inner_size(window: &tauri::Window) -> LogicalSize<f64> {
    let size = window
        .inner_size()
        .unwrap_or(tauri::PhysicalSize { width: 1280, height: 800 });
    let scale = window.scale_factor().unwrap_or(1.0);
    LogicalSize::new(size.width as f64 / scale, size.height as f64 / scale)
}

/// Bounds for Sodium's own UI webview: the full window.
fn full_bounds(window: &tauri::Window) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    (LogicalPosition::new(0.0, 0.0), logical_inner_size(window))
}

/// Bounds for a service webview: right of the sidebar, below the top
/// bar.
fn service_bounds(window: &tauri::Window) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    let size = logical_inner_size(window);
    let w = size.width.max(SIDEBAR_W + 100.0);
    let h = size.height.max(TOPBAR_H + 100.0);
    (
        LogicalPosition::new(SIDEBAR_W, TOPBAR_H),
        LogicalSize::new(w - SIDEBAR_W, h - TOPBAR_H),
    )
}

/// Where inactive service webviews are parked: far outside every
/// monitor, at their normal service-area size.
const PARK_POS: f64 = -32000.0;

/// Park a service webview off-screen instead of hiding it.
///
/// A hidden WebView2 controller reports its page as not visible, and
/// Chromium then throttles the page's background work (timers, sync)
/// hard after a few minutes. WhatsApp Web loses its session that way
/// and demands a fresh QR scan — even for pinned services, which are
/// never destroyed but used to sit hidden from startup. A parked
/// webview stays shown, so the browser keeps treating the page as
/// visible and it runs exactly as if it were on screen; only its
/// position is off-screen. (Eviction still destroys webviews as
/// before — parking only replaces hiding.)
fn park_webview(wv: &tauri::Webview) {
    let _ = wv.set_position(LogicalPosition::new(PARK_POS, PARK_POS));
    let _ = wv.show();
}

/// Clamp a split ratio so both panes keep at least MIN_PANE_W of
/// the available width (or halve the space when there is not
/// room for two minimum panes — impossible while the gate
/// passes, but the clamp stays total). Returns the effective
/// ratio: the main pane's share of `content_w - DIVIDER_W`.
fn clamp_split_ratio(ratio: f64, content_w: f64) -> f64 {
    let avail = (content_w - DIVIDER_W).max(0.0);
    if avail <= 0.0 {
        return 0.5;
    }
    let min_main = MIN_PANE_W.min(avail / 2.0);
    let main = (avail * ratio).clamp(min_main, avail - min_main);
    main / avail
}

/// Width of the notification drawer (v0.11.1): mirrors the
/// CSS `min(380px, 100vw - 108px)` on #inboxPanel, computed
/// from the window's logical inner width (the UI webview spans
/// the whole window, so its 100vw is the inner width). The
/// layout pass shrinks the active service by exactly this much
/// while the drawer is open, so the HTML drawer and the native
/// service never overlap.
fn inbox_drawer_width(window: &tauri::Window) -> f64 {
    (380.0f64)
        .min(logical_inner_size(window).width - 108.0)
        .max(0.0)
}

/// The one layout pass for service webviews: who sits where.
/// Single mode: the active service fills the content area. Split
/// mode (on + gate passing): the active service is the main
/// (left) pane at the split ratio and the companion — when one
/// is chosen and alive — the right one, with the divider gap
/// between them; with no companion the right side stays empty
/// for the UI's companion picker. A shown companion sits below
/// the UI's companion header strip (v0.9.1, COMPANION_STRIP_H);
/// while the UI is re-picking a companion (companion_picking)
/// the current one is parked like any inactive service.
/// While the notification drawer is open (v0.11.1, inbox_open)
/// the single-mode active service shrinks by the drawer's
/// width (the drawer pushes it), and in split mode the
/// companion is parked like a re-pick, so the drawer overlays
/// the right pane with the pane geometry untouched.
/// Everything else is parked off-screen at full content size. While a UI panel or the link
/// popup owns the screen (services_hidden / link_open) nothing
/// is shown, but positions are still updated so the restore is
/// exact.
fn layout_services(app: &tauri::AppHandle, state: &AppState, window: &tauri::Window) {
    let (cpos, csize) = service_bounds(window);
    let active = state.active.lock().unwrap().clone();
    let companion = state.companion.lock().unwrap().clone();
    let split = *state.split_mode.lock().unwrap() && *state.gate_ok.lock().unwrap();
    let picking = *state.companion_picking.lock().unwrap();
    let inbox = *state.inbox_open.lock().unwrap();
    let blocked = *state.services_hidden.lock().unwrap() || *state.link_open.lock().unwrap();
    let avail = csize.width - DIVIDER_W;
    let main_w = avail * clamp_split_ratio(*state.split_ratio.lock().unwrap(), csize.width);
    for wv in app.webviews().values() {
        let label = wv.label();
        if !label.starts_with("service-") {
            continue;
        }
        if Some(label) == active.as_deref() {
            if split {
                let _ = wv.set_position(cpos);
                let _ = wv.set_size(LogicalSize::new(main_w, csize.height));
            } else if inbox {
                // The notification drawer pushes the service
                // (v0.11.1): the freed strip on the right is
                // exactly the drawer's CSS width.
                let _ = wv.set_position(cpos);
                let _ = wv.set_size(LogicalSize::new(
                    (csize.width - inbox_drawer_width(window)).max(0.0),
                    csize.height,
                ));
            } else {
                let _ = wv.set_position(cpos);
                let _ = wv.set_size(csize);
            }
            if blocked {
                let _ = wv.hide();
            } else {
                let _ = wv.show();
            }
        } else if split && !picking && !inbox && Some(label) == companion.as_deref() {
            // Below the UI's companion header strip (v0.9.1):
            // the strip owns the top COMPANION_STRIP_H px of
            // the right pane, so the webview starts lower and
            // is shorter; its height keeps the same 100px
            // floor service_bounds gives the content area.
            let _ = wv.set_position(LogicalPosition::new(
                cpos.x + main_w + DIVIDER_W,
                cpos.y + COMPANION_STRIP_H,
            ));
            let _ = wv.set_size(LogicalSize::new(
                avail - main_w,
                (csize.height - COMPANION_STRIP_H).max(100.0),
            ));
            if blocked {
                let _ = wv.hide();
            } else {
                let _ = wv.show();
            }
        } else {
            // Parked: off-screen at full content size (already
            // correct when activated), still shown so the page
            // keeps running unthrottled — unless the UI owns the
            // screen, in which case it hides like everything else.
            let _ = wv.set_size(csize);
            if blocked {
                let _ = wv.set_position(LogicalPosition::new(PARK_POS, PARK_POS));
                let _ = wv.hide();
            } else {
                park_webview(wv);
            }
        }
    }
}

/// The split view double gate: the monitor the window sits on
/// must offer at least 1920 logical px of width (physical size /
/// scale factor), and the window's inner width must be at least
/// 1600 logical px. Below either, two panes side by side get too
/// cramped to be useful, so the feature hides entirely.
fn compute_split_gate(window: &tauri::Window) -> bool {
    if logical_inner_size(window).width < 1600.0 {
        return false;
    }
    match window.current_monitor() {
        Ok(Some(m)) => {
            let scale = m.scale_factor();
            scale > 0.0 && (m.size().width as f64 / scale) >= 1920.0
        }
        _ => false,
    }
}

/// Recompute the gate (called debounced after resize / move /
/// scale changes). On a pass-to-fail transition while split is
/// on, split collapses safely: split mode turns off and the
/// layout pass parks the companion — the choice itself is kept,
/// in Rust's companion slot and in the UI's stored preference,
/// for the next entry. The UI is told through "split-gate".
fn refresh_split_gate(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let window = match state.main_window.lock().unwrap().clone() {
        Some(w) => w,
        None => return,
    };
    let ok = compute_split_gate(&window);
    let changed = {
        let mut g = state.gate_ok.lock().unwrap();
        let changed = *g != ok;
        *g = ok;
        changed
    };
    if !changed {
        return;
    }
    if !ok && *state.split_mode.lock().unwrap() {
        *state.split_mode.lock().unwrap() = false;
        *state.companion_picking.lock().unwrap() = false;
        layout_services(app, &state, &window);
    }
    let _ = app.emit_to(UI_LABEL, "split-gate", ok);
}

/// Debounced gate recheck (~150ms): dragging the window between
/// monitors fires move events continuously, so each event only
/// schedules a check and a generation counter lets just the
/// newest scheduled check recompute.
fn schedule_gate_check(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let gen = state
        .gate_gen
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1;
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));
        let state = handle.state::<AppState>();
        if state.gate_gen.load(std::sync::atomic::Ordering::SeqCst) == gen {
            refresh_split_gate(&handle);
        }
    });
}

/// Labels exempt from eviction while split view is on: the two
/// visible panes. They are treated exactly like pinned services
/// for eviction purposes — excluded from the alive count and
/// from victimhood — because a pane the user is looking at must
/// never be destroyed under them. Outside split mode this is
/// empty, so single-mode eviction behaves exactly as before.
fn split_protected_labels(state: &AppState) -> HashSet<String> {
    let mut set = HashSet::new();
    if *state.split_mode.lock().unwrap() {
        if let Some(a) = state.active.lock().unwrap().clone() {
            set.insert(a);
        }
        if let Some(c) = state.companion.lock().unwrap().clone() {
            set.insert(c);
        }
    }
    set
}

/// Download handler for a service or popup webview: without it,
/// downloads silently go nowhere. Answers with the native Save As
/// dialog (Downloads first, then the last folder used) and reports
/// start/finish to the UI for its indicator and history.
fn make_download_handler(
    app: tauri::AppHandle,
    download_dir: std::sync::Arc<Mutex<std::path::PathBuf>>,
    source: String,
) -> impl Fn(tauri::Webview, DownloadEvent) -> bool + Send + Sync + 'static {
    move |_webview, event| {
        match event {
            DownloadEvent::Requested { destination, .. } => {
                let suggested = destination
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .filter(|n| !n.trim().is_empty())
                    .unwrap_or_else(|| "sodium-download".to_string());
                let start_dir = download_dir.lock().unwrap().clone();
                let mut dialog = rfd::FileDialog::new().set_file_name(&suggested);
                if !start_dir.as_os_str().is_empty() {
                    dialog = dialog.set_directory(&start_dir);
                }
                match dialog.save_file() {
                    Some(path) => {
                        if let Some(parent) = path.parent() {
                            *download_dir.lock().unwrap() = parent.to_path_buf();
                        }
                        let name = path
                            .file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                            .unwrap_or(suggested);
                        *destination = path;
                        let _ = app.emit_to(UI_LABEL, "download-started", name);
                        true
                    }
                    None => false,
                }
            }
            DownloadEvent::Finished { path, success, .. } => {
                let saved = if success {
                    path.as_ref().map(|p| p.to_string_lossy().into_owned())
                } else {
                    None
                };
                let _ = app.emit_to(
                    UI_LABEL,
                    "download-finished",
                    (saved, source.clone(), success),
                );
                true
            }
            _ => true,
        }
    }
}

/// Global shortcuts owned by Sodium: Ctrl+1..9 (switch service),
/// Alt+Space (quick switcher) and Ctrl+, (settings panel, v0.12.0).
/// They are registered only while the
/// Sodium window is focused (and released on blur, so other apps keep
/// their keys): keydown events inside a service webview never reach
/// Sodium's own UI, so without this the shortcuts would be dead
/// exactly while the user is chatting.
fn focus_shortcuts() -> Vec<tauri_plugin_global_shortcut::Shortcut> {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    let mut list: Vec<Shortcut> = [
        Code::Digit1,
        Code::Digit2,
        Code::Digit3,
        Code::Digit4,
        Code::Digit5,
        Code::Digit6,
        Code::Digit7,
        Code::Digit8,
        Code::Digit9,
    ]
    .iter()
    .map(|c| Shortcut::new(Some(Modifiers::CONTROL), *c))
    .collect();
    list.push(Shortcut::new(Some(Modifiers::ALT), Code::Space));
    list.push(Shortcut::new(Some(Modifiers::CONTROL), Code::Comma));
    list
}

fn shortcut_index(code: tauri_plugin_global_shortcut::Code) -> Option<usize> {
    use tauri_plugin_global_shortcut::Code;
    match code {
        Code::Digit1 => Some(0),
        Code::Digit2 => Some(1),
        Code::Digit3 => Some(2),
        Code::Digit4 => Some(3),
        Code::Digit5 => Some(4),
        Code::Digit6 => Some(5),
        Code::Digit7 => Some(6),
        Code::Digit8 => Some(7),
        Code::Digit9 => Some(8),
        _ => None,
    }
}

/// Unread count from a service page title: the first "(n)" in the
/// first 40 characters — "(3) WhatsApp", "Inbox (3)", "Kotak Masuk
/// (3)". Capped at 999 so title years like "(2024)" read as 0.
fn parse_unread(title: &str) -> usize {
    let head: String = title.chars().take(40).collect();
    let Some(open) = head.find('(') else { return 0 };
    let rest = &head[open + 1..];
    let Some(close) = rest.find(')') else { return 0 };
    let inner = &rest[..close];
    if inner.is_empty() || !inner.bytes().all(|b| b.is_ascii_digit()) {
        return 0;
    }
    inner.parse().ok().filter(|&n| n <= 999).unwrap_or(0)
}

/// Saved main-window geometry (logical pixels), restored on startup so
/// Sodium reopens where and how big the user left it.
#[derive(serde::Serialize, serde::Deserialize)]
struct WindowStateFile {
    width: f64,
    height: f64,
    x: Option<f64>,
    y: Option<f64>,
}

fn load_window_state(app: &tauri::AppHandle) -> Option<WindowStateFile> {
    let path = app.path().app_data_dir().ok()?.join("window-state.json");
    let text = std::fs::read_to_string(path).ok()?;
    let saved: WindowStateFile = serde_json::from_str(&text).ok()?;
    if saved.width < 900.0 || saved.height < 600.0 || saved.width > 10000.0 || saved.height > 10000.0
    {
        return None;
    }
    if let (Some(x), Some(y)) = (saved.x, saved.y) {
        if x < -10000.0 || x > 10000.0 || y < -10000.0 || y > 10000.0 {
            return None;
        }
    }
    Some(saved)
}

fn save_window_state(app: &tauri::AppHandle, window: &tauri::Window) {
    let (Ok(size), Ok(pos)) = (window.inner_size(), window.outer_position()) else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let saved = WindowStateFile {
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
        x: Some(pos.x as f64 / scale),
        y: Some(pos.y as f64 / scale),
    };
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(text) = serde_json::to_string(&saved) {
            let _ = std::fs::write(dir.join("window-state.json"), text);
        }
    }
}

/// Bounds for the link popup: floating over the content area with a
/// margin on every side, below the top bar and the UI's link bar.
fn popup_bounds(window: &tauri::Window) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    let size = logical_inner_size(window);
    let x = SIDEBAR_W + 24.0;
    let y = TOPBAR_H + LINKBAR_H + 16.0;
    let w = (size.width - x - 24.0).max(200.0);
    let h = (size.height - y - 24.0).max(200.0);
    (LogicalPosition::new(x, y), LogicalSize::new(w, h))
}

/// Create one service webview (not yet shown): its own profile
/// folder, link clicks diverted to the popup, downloads handled,
/// title changes forwarded as unread counts.
fn create_service_webview(
    app: &tauri::AppHandle,
    state: &AppState,
    window: &tauri::Window,
    id: &str,
    url: &str,
) -> Result<(), String> {
    let label = label_for(id);
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("profiles")
        .join(id);
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let parsed = tauri::Url::parse(url).map_err(|e| e.to_string())?;
    // Links that ask for a new window (target=_blank, window.open)
    // would be silently dropped by WebView2. Deny the window and
    // tell the UI instead: it shows the link popup over the service.
    let app_for_links = app.clone();
    let app_for_title = app.clone();
    let app_for_perm = app.clone();
    let id_for_title = id.to_string();
    let id_for_perm = id.to_string();
    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed.clone()))
        .data_directory(data_dir)
        // Tauri's own drop handler replaces WebView2's on Windows,
        // so dropped files would never reach the page (no attaching
        // files in WhatsApp). Disabling it lets the page handle drops.
        .disable_drag_drop_handler()
        .on_new_window(move |u, _features| {
            let _ = app_for_links.emit_to(UI_LABEL, "link-clicked", u.to_string());
            NewWindowResponse::Deny
        })
        .on_download(make_download_handler(
            app.clone(),
            state.download_dir.clone(),
            id.to_string(),
        ))
        .on_document_title_changed(move |_wv, title| {
            let count = parse_unread(&title);
            let _ = app_for_title.emit_to(
                UI_LABEL,
                "unread-changed",
                (id_for_title.clone(), count),
            );
        })
        // Notification permission is answered HERE, on the service
        // webview itself. The app-level handler on the Builder does
        // not reach webviews created at runtime, so service pages
        // were silently denied by WebView2's unanswered-request
        // default (Shopee Seller Chat showed a "browser is blocking
        // notifications" banner). The per-service policy comes from
        // AppState (UI setting, see set_service_notif); no entry
        // means "allow", the historical intent. Microphone and
        // camera requests (v0.8.8) are answered the same way from
        // the media policy (see set_service_media): before this,
        // they fell through to the Default arm and WebView2 denied
        // them silently, so calls could never get the mic/camera.
        .on_permission_request(move |_, kind| match kind {
            PermissionKind::Notifications => {
                let state = app_for_perm.state::<AppState>();
                let policy = state.notif_policy.lock().unwrap();
                match policy.get(&id_for_perm).map(String::as_str) {
                    Some("default") => PermissionResponse::Default,
                    Some("deny") => PermissionResponse::Deny,
                    _ => PermissionResponse::Allow,
                }
            }
            PermissionKind::Microphone | PermissionKind::Camera => {
                let state = app_for_perm.state::<AppState>();
                let policy = state.media_policy.lock().unwrap();
                match policy.get(&id_for_perm).map(String::as_str) {
                    Some("default") => PermissionResponse::Default,
                    Some("deny") => PermissionResponse::Deny,
                    _ => PermissionResponse::Allow,
                }
            }
            _ => PermissionResponse::Default,
        });
    // Bridge (v0.10.0): every service page gets the shared
    // bridge script as an initialization script (main frame).
    // It reports page notifications and a liveness hello back
    // over WebView2 WebMessage; the receiving end is attached
    // right after the webview is created (see attach_bridge).
    //
    // YouTube services with the adblock on get the adblock
    // script too — CONCATENATED behind the bridge script in
    // ONE initialization_script call (v0.10.1). v0.10.0 made
    // two separate calls; if repeated calls replace rather
    // than append in the locked Tauri/wry version, the second
    // call would silently wipe the first script. One call
    // removes the question whatever the semantics are. Bridge
    // first, adblock after, separated by a newline and a stray
    // semicolon so the two files can never fuse into one
    // statement. Webviews that are already alive are not
    // touched — the scripts apply from the next time the
    // service is created.
    let mut init_script = String::from(BRIDGE_SCRIPT);
    if *state.adblock_enabled.lock().unwrap() {
        if let Some(host) = parsed.host_str() {
            if is_youtube_host(host) {
                let script = state.adblock_script.lock().unwrap().clone();
                if !script.is_empty() {
                    init_script.push_str("\n;\n");
                    init_script.push_str(&script);
                }
            }
        }
    }
    builder = builder.initialization_script(init_script);
    let (pos, size) = service_bounds(window);
    let wv = window
        .add_child(builder, pos, size)
        .map_err(|e| e.to_string())?;
    attach_bridge(app, &wv, id);
    Ok(())
}

/// Attach the receiving end of the bridge (v0.10.0) to
/// one service webview.
///
/// The bridge channel is WebView2's own host messaging: the
/// page calls `window.chrome.webview.postMessage(json)` and the
/// host hears it as the CoreWebView2 `WebMessageReceived`
/// event. The controller comes from Tauri's `with_webview`
/// (`PlatformWebview::controller()`); the handler registration
/// mirrors the one wry itself uses for Tauri's IPC, and the two
/// coexist — WebView2 events are multi-subscriber, and our
/// parser ignores everything that is not a bridge report
/// (Tauri's IPC strings included). The alternatives were
/// weighed and rejected (BLUEPRINT seksi 16): a Tauri remote
/// capability would hand arbitrary user-chosen origins an
/// invoke surface, and a localhost bridge adds a listening
/// server plus token distribution for no gain.
///
/// Security: a page message is untrusted input. It can only
/// ever be DATA for handle_bridge_message — no message shape
/// reaches a command, a shell, or an eval.
///
/// v0.10.1 hardening: v0.10.0 swallowed every failure on this
/// path (the with_webview result, a CoreWebView2 error, the
/// registration result), so a dead registration was silent
/// and permanent — one of the two suspects for Agung's
/// "no media detected at all" test. Now the handler counts
/// RAW contact before anything else, and the label is marked
/// in bridge_attached only when registration returns Ok, so
/// the show paths can re-attach (ensure_bridge_attached)
/// instead of leaving the bridge dead.
#[cfg(target_os = "windows")]
fn attach_bridge(app: &tauri::AppHandle, wv: &tauri::Webview, id: &str) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2;
    use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
    use windows::core::PWSTR;

    let app = app.clone();
    let id = id.to_string();
    let _ = wv.with_webview(move |platform| {
        let controller = platform.controller();
        let core: ICoreWebView2 = match unsafe { controller.CoreWebView2() } {
            Ok(c) => c,
            Err(_) => return,
        };
        let label = label_for(&id);
        let handler_app = app.clone();
        let handler_id = id.clone();
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_sender, args| {
            // Liveness before everything (v0.10.1): count the
            // RAW callback — before the message is extracted,
            // let alone parsed. The count measures whether the
            // channel itself is alive.
            {
                let state = handler_app.state::<AppState>();
                let mut contacts = state.bridge_contacts.lock().unwrap();
                let contact = contacts.entry(handler_id.clone()).or_default();
                contact.count += 1;
                contact.last_ms = unix_ms();
            }
            let Some(args) = args else {
                return Ok(());
            };
            let mut raw = PWSTR::null();
            if unsafe { args.TryGetWebMessageAsString(&mut raw) }.is_err() {
                // Not a string message (an object post): not a
                // bridge report — our script always posts a
                // JSON string.
                return Ok(());
            }
            let text = take_pwstr(raw);
            handle_bridge_message(&handler_app, &handler_id, &text);
            Ok(())
        }));
        let mut token = Default::default();
        if unsafe { core.add_WebMessageReceived(&handler, &mut token) }.is_ok() {
            let state = app.state::<AppState>();
            state.bridge_attached.lock().unwrap().insert(label);
        }
    });
}

/// Sodium ships for Windows only; anywhere else the bridge is
/// simply absent and pages cannot report notifications.
#[cfg(not(target_os = "windows"))]
fn attach_bridge(_app: &tauri::AppHandle, _wv: &tauri::Webview, _id: &str) {}

/// Re-attach insurance (v0.10.1): paths that SHOW a service
/// call this so a live webview whose handler registration
/// failed silently at creation time gets a second chance,
/// instead of a bridge that stays dead for the webview's
/// whole life. bridge_attached is the guard against double
/// registration: a label already in the set is never
/// attached twice.
fn ensure_bridge_attached(app: &tauri::AppHandle, state: &AppState, id: &str) {
    let label = label_for(id);
    if state.bridge_attached.lock().unwrap().contains(&label) {
        return;
    }
    if let Some(wv) = app.get_webview(&label) {
        attach_bridge(app, &wv, id);
    }
}

/// One bounded string field out of a bridge message: anything
/// that is not a string is empty, anything longer is cut.
fn bridge_str(v: &serde_json::Value, key: &str, max: usize) -> String {
    match v.get(key).and_then(|x| x.as_str()) {
        Some(s) => s.chars().take(max).collect(),
        None => String::new(),
    }
}

/// Handle one raw bridge message from one service's page. The
/// page is untrusted: the payload is size-capped before
/// parsing, the version and type must match the known
/// report shapes ("notif", and the v0.10.1 liveness
/// "hello"), and every field is type-checked and clamped.
/// Anything else is dropped silently.
fn handle_bridge_message(app: &tauri::AppHandle, id: &str, text: &str) {
    if text.len() > 8192 {
        return;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };
    if v.get("v").and_then(|x| x.as_u64()) != Some(1) {
        return;
    }
    let state = app.state::<AppState>();
    match v.get("t").and_then(|x| x.as_str()) {
        Some("notif") => {
            // Recorded for the notification panel (v0.11.0),
            // capped so a notification-happy page cannot grow
            // this without bound. The panel learns about the
            // new entry at once (badge + an open list); the
            // store file follows on a debounce.
            let note = PageNotification {
                service_id: id.to_string(),
                title: bridge_str(&v, "title", 300),
                body: bridge_str(&v, "body", 1000),
                at_ms: unix_ms(),
            };
            {
                let mut list = state.page_notifications.lock().unwrap();
                list.push(note.clone());
                if list.len() > 200 {
                    let excess = list.len() - 200;
                    list.drain(..excess);
                }
            }
            let _ = app.emit_to(UI_LABEL, "notif-added", note);
            schedule_persist_notifications(app);
        }
        Some("hello") => {
            // Liveness hello (v0.10.1): the bridge script is
            // alive in this page — it posts one at script
            // start and one on DOMContentLoaded. The raw
            // contact was already counted in the handler
            // closure; there is nothing else to do with it
            // until the v0.11.0 panel surfaces liveness.
        }
        _ => {}
    }
}

/// Path of the durable notification store (v0.11.0): its own
/// file next to config.json, so the panel's history survives
/// restarts (and a config reset does not take it along).
fn notifications_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("notifications.json"))
}

/// Load the persisted notification store at startup. A missing
/// or damaged file is not an error: the panel simply starts
/// empty. The in-memory cap is re-applied, keeping the newest.
fn load_notifications(app: &tauri::AppHandle) -> Vec<PageNotification> {
    let Some(path) = notifications_path(app) else {
        return Vec::new();
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(mut list) = serde_json::from_str::<Vec<PageNotification>>(&text) else {
        return Vec::new();
    };
    if list.len() > 200 {
        let excess = list.len() - 200;
        list.drain(..excess);
    }
    list
}

/// Write the notification store atomically (temp file +
/// rename), the same pattern as save_config.
fn persist_notifications(app: &tauri::AppHandle) {
    let Some(path) = notifications_path(app) else {
        return;
    };
    let Some(dir) = path.parent() else {
        return;
    };
    let state = app.state::<AppState>();
    let text = {
        let list = state.page_notifications.lock().unwrap();
        serde_json::to_string(&*list).unwrap_or_else(|_| "[]".to_string())
    };
    let _ = std::fs::create_dir_all(dir);
    let tmp = dir.join("notifications.json.tmp");
    if std::fs::write(&tmp, text).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

/// Debounced persist (v0.11.0): notifications can arrive in
/// bursts (a chatty group chat), so each new entry only bumps
/// the generation; the newest scheduled writer, ~400 ms
/// later, snapshots whatever the store holds by then. Same
/// generation-counter pattern as schedule_gate_check.
fn schedule_persist_notifications(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let gen = state
        .notif_save_gen
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1;
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        let state = handle.state::<AppState>();
        if state.notif_save_gen.load(std::sync::atomic::Ordering::SeqCst) == gen {
            persist_notifications(&handle);
        }
    });
}

/// The notification panel's snapshot (v0.11.0): newest first,
/// the order the panel renders.
#[tauri::command]
fn notifications_list(state: State<'_, AppState>) -> Vec<PageNotification> {
    let list = state.page_notifications.lock().unwrap();
    list.iter().rev().cloned().collect()
}

/// Empty the notification store (v0.11.0) and its file. The
/// write goes out immediately, not on the debounce, so a
/// restart right after clearing cannot resurrect the list;
/// bumping the generation first retires any debounced writer
/// still in flight.
#[tauri::command]
fn notifications_clear(app: tauri::AppHandle, state: State<'_, AppState>) {
    state.page_notifications.lock().unwrap().clear();
    state
        .notif_save_gen
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    persist_notifications(&app);
}

/// Forget a service's per-webview bridge state (its webview
/// is gone): the registration mark and the contact record go
/// with it, so liveness never describes a dead webview as
/// connected, and a re-created webview starts from a clean
/// slate (its fresh attach marks the label again).
fn clear_bridge_state(state: &AppState, id: &str) {
    state.bridge_attached.lock().unwrap().remove(&label_for(id));
    state.bridge_contacts.lock().unwrap().remove(id);
}

/// Create a pinned service's webview at startup, parked off-screen
/// (not hidden — see park_webview), so its notifications work from
/// boot. Async for the same WebView2 reason as switch_service.
#[tauri::command]
async fn start_service_hidden(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    url: String,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("invalid service id".into());
    }
    if !valid_url(&url) {
        return Err("invalid service url".into());
    }
    let label = label_for(&id);
    if app.get_webview(&label).is_some() {
        return Ok(());
    }
    let window = state
        .main_window
        .lock()
        .unwrap()
        .clone()
        .ok_or("main window missing")?;
    create_service_webview(&app, &state, &window, &id, &url)?;
    if let Some(wv) = app.get_webview(&label) {
        let z = state.zoom.lock().unwrap().get(&id).copied().unwrap_or(1.0);
        let _ = wv.set_zoom(z);
        park_webview(&wv);
    }
    let mut mru = state.alive_mru.lock().unwrap();
    if !mru.contains(&label) {
        mru.push(label);
    }
    // Keep the layout authoritative: if split view is on and this
    // service is one of the panes, it belongs in its pane, not in
    // the park.
    layout_services(&app, &state, &window);
    Ok(())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Graceful shutdown: close every service webview (and the link
/// popup) first so WebView2 gets a chance to flush its on-disk
/// profiles, wait a moment, then exit. Without this the process
/// dies wherever it happens to be — worst case Windows kills it at
/// shutdown while the window is only hidden in the tray — and a
/// half-written profile is left behind. WhatsApp's session lives
/// across several stores, so the mixed old/new state a hard kill
/// leaves behind makes it reject the session on the next run and
/// demand a fresh QR scan.
fn begin_graceful_shutdown(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    if state
        .shutting_down
        .swap(true, std::sync::atomic::Ordering::SeqCst)
    {
        return;
    }
    for wv in app.webviews().values() {
        if wv.label().starts_with("service-") || wv.label() == POPUP_LABEL {
            let _ = wv.close();
        }
    }
    // Give WebView2 a window to flush the profiles it just closed
    // before the process goes away; ~1.2 s still fits inside the
    // grace Windows grants apps while the machine shuts down.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1200));
        handle.exit(0);
    });
}

/// System tray icon: left-click brings the window back, the menu
/// offers Buka/Keluar. Quitting only happens from that menu —
/// closing the window hides it instead (see on_window_event).
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open_item = MenuItem::with_id(app, "tray-open", "Buka Sodium", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "tray-quit", "Keluar", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Sodium")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-open" => show_main_window(app),
            "tray-quit" => begin_graceful_shutdown(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Switch to a service. Over the "Hidup bareng" limit, the
/// least-recently-used non-pinned webview is destroyed (sessions
/// survive in its on-disk profile). Async on purpose: creating a
/// webview from a sync command can deadlock on Windows.
#[tauri::command]
async fn switch_service(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    url: String,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("invalid service id".into());
    }
    if !valid_url(&url) {
        return Err("invalid service url".into());
    }
    let label = label_for(&id);
    let window = state
        .main_window
        .lock()
        .unwrap()
        .clone()
        .ok_or("main window missing")?;

    if app.get_webview(&label).is_none() {
        // Make room first: creating first and evicting after would
        // peak at limit+1 webviews (and their RAM) for a moment.
        if !state.pinned.lock().unwrap().contains(&id) {
            let max = *state.max_alive.lock().unwrap();
            if max > 0 {
                evict_down_to(&app, &state, max - 1);
            }
        }
        create_service_webview(&app, &state, &window, &id, &url)?;
    }

    // Apply this service's own zoom level to the (possibly just created)
    // webview.
    if let Some(wv) = app.get_webview(&label) {
        let z = state.zoom.lock().unwrap().get(&id).copied().unwrap_or(1.0);
        let _ = wv.set_zoom(z);
    }

    // Bridge attach insurance (v0.10.1): if this webview's
    // handler registration failed silently at creation time,
    // retry it now instead of leaving the bridge dead.
    ensure_bridge_attached(&app, &state, &id);

    // Native webviews stack with the newest on top, so only the
    // target may sit in the service area; the layout pass puts it
    // there (full area, or the main pane in split view), keeps a
    // split companion in its pane, and parks the rest off-screen
    // (not hidden — see park_webview) so their pages keep running
    // unthrottled.
    *state.active.lock().unwrap() = Some(label.clone());
    layout_services(&app, &state, &window);
    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.set_focus();
    }

    {
        let mut mru = state.alive_mru.lock().unwrap();
        mru.retain(|l| l != &label);
        mru.insert(0, label.clone());
    }

    evict_over_limit(&app, &state);
    Ok(())
}

/// Destroy least-recently-used non-pinned webviews while more of
/// them are alive than the user's "Hidup bareng" limit. Called after
/// every switch and immediately when the limit itself changes, so
/// lowering the limit takes effect at once instead of on the next
/// switch.
fn evict_over_limit(app: &tauri::AppHandle, state: &AppState) {
    let max_alive = *state.max_alive.lock().unwrap();
    if max_alive == 0 {
        return;
    }
    evict_down_to(app, state, max_alive);
}

/// Destroy LRU non-pinned webviews until at most `target` remain.
fn evict_down_to(app: &tauri::AppHandle, state: &AppState, target: usize) {
    loop {
        let victim: Option<String> = {
            let mru = state.alive_mru.lock().unwrap();
            let pinned = state.pinned.lock().unwrap();
            // While split view is on, its two panes are exempt
            // exactly like pinned services: they neither count
            // towards the limit nor can be chosen as victims.
            let protected = split_protected_labels(state);
            let non_pinned: Vec<&String> = mru
                .iter()
                .filter(|l| !pinned.contains(id_from_label(l)) && !protected.contains(*l))
                .collect();
            if non_pinned.len() <= target {
                None
            } else {
                // Last non-pinned in MRU order = least recently used.
                non_pinned.last().map(|s| (*s).clone())
            }
        };
        match victim {
            Some(v) => {
                if let Some(wv) = app.get_webview(&v) {
                    let _ = wv.close();
                }
                // A destroyed webview has no live count: clear its
                // badge instead of leaving a stale number behind.
                let _ = app.emit_to(
                    UI_LABEL,
                    "unread-changed",
                    (id_from_label(&v).to_string(), 0usize),
                );
                // Same for its per-webview bridge state: a dead
                // webview must not stay marked as attached.
                clear_bridge_state(state, id_from_label(&v));
                state.alive_mru.lock().unwrap().retain(|l| l != &v);
            }
            None => break,
        }
    }
}

/// Hide or show all alive service webviews while a UI panel is
/// open: native webviews layer above the UI, so they would cover
/// the panel. Hiding is not destroying; sessions stay alive. When
/// the panels close, the layout pass restores the arrangement —
/// the active service (and a split companion) in their panes,
/// the rest parked off-screen (see park_webview). While the link
/// popup is open, the services stay hidden behind it.
#[tauri::command]
fn set_services_visible(app: tauri::AppHandle, state: State<'_, AppState>, visible: bool) {
    *state.services_hidden.lock().unwrap() = !visible;
    let link_open = *state.link_open.lock().unwrap();
    if !visible || link_open {
        for wv in app.webviews().values() {
            if wv.label().starts_with("service-") {
                let _ = wv.hide();
            } else if wv.label() == POPUP_LABEL {
                if visible && link_open {
                    let _ = wv.show();
                } else {
                    let _ = wv.hide();
                }
            }
        }
        return;
    }
    if let Some(window) = state.main_window.lock().unwrap().clone() {
        layout_services(&app, &state, &window);
    }
    if let Some(wv) = app.get_webview(POPUP_LABEL) {
        let _ = wv.hide();
    }
}

/// Open or close the notification drawer (v0.11.1). Unlike the
/// modal panels, the drawer does NOT hide the services: the
/// flag is all the layout pass needs — in single mode it
/// shrinks the active service by the drawer width (push), in
/// split mode it parks the companion so the drawer overlays
/// the right pane. The UI calls this on every drawer open /
/// close path (the shared panel machinery routes through it)
/// and once with `false` at startup, so the flag can never
/// outlive the drawer.
#[tauri::command]
fn set_inbox_open(app: tauri::AppHandle, state: State<'_, AppState>, open: bool) {
    *state.inbox_open.lock().unwrap() = open;
    if let Some(window) = state.main_window.lock().unwrap().clone() {
        layout_services(&app, &state, &window);
    }
}

/// Open the link popup over the active service, or navigate it if it is
/// already open. The active service webview is hidden while the popup is
/// open: the UI's link bar sits in the strip above the popup and would
/// otherwise be covered by the (native) service webview.
/// Async for the same WebView2 reason as switch_service.
#[tauri::command]
async fn open_link_popup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<(), String> {
    if !valid_url(&url) {
        return Err("invalid url".into());
    }
    let window = state
        .main_window
        .lock()
        .unwrap()
        .clone()
        .ok_or("main window missing")?;
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    *state.link_open.lock().unwrap() = true;
    let active = state.active.lock().unwrap().clone();
    if let Some(active_label) = &active {
        if let Some(wv) = app.get_webview(active_label) {
            let _ = wv.hide();
        }
    }
    // In split view the companion pane would cover the popup's
    // right half the same way, so it hides too.
    let companion = state.companion.lock().unwrap().clone();
    if let Some(comp_label) = &companion {
        if let Some(wv) = app.get_webview(comp_label) {
            let _ = wv.hide();
        }
    }
    if let Some(wv) = app.get_webview(POPUP_LABEL) {
        let _ = wv.navigate(parsed);
        let (pos, size) = popup_bounds(&window);
        let _ = wv.set_position(pos);
        let _ = wv.set_size(size);
        let _ = wv.show();
    } else {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("profiles")
            .join("link-popup");
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        let app_for_links = app.clone();
        let builder = WebviewBuilder::new(POPUP_LABEL, WebviewUrl::External(parsed))
            .data_directory(data_dir)
            .disable_drag_drop_handler()
            .on_new_window(move |u, _features| {
                let _ = app_for_links.emit_to(UI_LABEL, "link-clicked", u.to_string());
                NewWindowResponse::Deny
            })
            .on_download(make_download_handler(
                app.clone(),
                state.download_dir.clone(),
                "link-popup".to_string(),
            ));
        let (pos, size) = popup_bounds(&window);
        window
            .add_child(builder, pos, size)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Close the link popup and bring the service layout back
/// (single mode or both split panes, via the layout pass).
#[tauri::command]
fn close_link_popup(app: tauri::AppHandle, state: State<'_, AppState>) {
    *state.link_open.lock().unwrap() = false;
    if let Some(wv) = app.get_webview(POPUP_LABEL) {
        let _ = wv.close();
    }
    if let Some(window) = state.main_window.lock().unwrap().clone() {
        layout_services(&app, &state, &window);
    }
}

/// Open a link in the user's default browser (the link bar's escape
/// hatch). http/https only, passed as a single argument (no shell).
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("only http/https links can be opened externally".into());
    }
    std::process::Command::new("explorer")
        .arg(parsed.as_str())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Launch a downloaded Sodium installer, then exit so the installer
/// can replace the running app. Only existing .exe files are
/// accepted; the path comes from the app's own download history,
/// never from free-form input.
#[tauri::command]
fn run_installer(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    let is_exe = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("exe"))
        .unwrap_or(false);
    if !is_exe || !p.is_file() {
        return Err("installer file not found".into());
    }
    if let Some(window) = app.get_window("main") {
        save_window_state(&app, &window);
    }
    std::process::Command::new(&p)
        .spawn()
        .map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

/// Destroy one service's webview and forget it (used when the user
/// deletes the service from the sidebar).
#[tauri::command]
fn close_service(app: tauri::AppHandle, state: State<'_, AppState>, id: String) {
    let label = label_for(&id);
    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.close();
    }
    let _ = app.emit_to(UI_LABEL, "unread-changed", (id.clone(), 0usize));
    clear_bridge_state(&state, &id);
    state.alive_mru.lock().unwrap().retain(|l| l != &label);
    let mut active = state.active.lock().unwrap();
    if active.as_deref() == Some(label.as_str()) {
        *active = None;
    }
    drop(active);
    // A destroyed webview cannot stay the split companion; the
    // UI keeps its own stored choice and re-creates it on the
    // next split entry if it still wants this service there.
    let mut comp = state.companion.lock().unwrap();
    if comp.as_deref() == Some(label.as_str()) {
        *comp = None;
    }
    drop(comp);
    // Delete the profile folder too: it holds cookies and session
    // tokens that must not outlive the service. WebView2 can keep
    // the files locked briefly after the webview closes, so a
    // failed first attempt retries in the background.
    if valid_id(&id) {
        if let Ok(dir) = app.path().app_data_dir() {
            let profile = dir.join("profiles").join(&id);
            if profile.exists() && std::fs::remove_dir_all(&profile).is_err() {
                std::thread::spawn(move || {
                    for _ in 0..5 {
                        std::thread::sleep(std::time::Duration::from_secs(2));
                        if !profile.exists() || std::fs::remove_dir_all(&profile).is_ok() {
                            break;
                        }
                    }
                });
            }
        }
    }
}

/// Destroy one service's webview and forget it, but KEEP its
/// profile folder (session survives). Used by config import, where
/// a removed or re-URLed service must stop running without losing
/// the login it may need again if the config is re-imported.
#[tauri::command]
fn close_webview(app: tauri::AppHandle, state: State<'_, AppState>, id: String) {
    let label = label_for(&id);
    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.close();
    }
    let _ = app.emit_to(UI_LABEL, "unread-changed", (id.clone(), 0usize));
    clear_bridge_state(&state, &id);
    state.alive_mru.lock().unwrap().retain(|l| l != &label);
    let mut active = state.active.lock().unwrap();
    if active.as_deref() == Some(label.as_str()) {
        *active = None;
    }
    drop(active);
    // Same companion cleanup as close_service: a destroyed
    // webview cannot stay the split companion.
    let mut comp = state.companion.lock().unwrap();
    if comp.as_deref() == Some(label.as_str()) {
        *comp = None;
    }
}

#[tauri::command]
fn set_pinned(app: tauri::AppHandle, state: State<'_, AppState>, id: String, pinned: bool) {
    {
        let mut set = state.pinned.lock().unwrap();
        if pinned {
            set.insert(id);
        } else {
            set.remove(&id);
        }
    }
    // Unpinning can put the alive count over the limit; evict now
    // instead of waiting for the next switch.
    if !pinned {
        evict_over_limit(&app, &state);
    }
}

/// Set how many non-pinned services may be alive at once. 0 = unlimited.
#[tauri::command]
fn set_max_alive(app: tauri::AppHandle, state: State<'_, AppState>, max: usize) {
    *state.max_alive.lock().unwrap() = max;
    evict_over_limit(&app, &state);
}

/// Set the page zoom for one service (1.0 = 100%). Stored per service so
/// a newly created webview gets its own service's zoom, and applied at
/// once when that service's webview is already alive.
#[tauri::command]
fn set_service_zoom(app: tauri::AppHandle, state: State<'_, AppState>, id: String, scale: f64) {
    state.zoom.lock().unwrap().insert(id.clone(), scale);
    if let Some(wv) = app.get_webview(&label_for(&id)) {
        let _ = wv.set_zoom(scale);
    }
}

/// Set one service's notification permission policy: "allow"
/// (answer Allow), "default" (leave the request to WebView2) or
/// "deny". Unknown values fall back to "allow", the historical
/// behaviour. The service webview's permission handler reads this
/// map on every request, so the change also reaches webviews that
/// are already alive.
#[tauri::command]
fn set_service_notif(state: State<'_, AppState>, id: String, mode: String) {
    let mode = match mode.as_str() {
        "default" | "deny" => mode,
        _ => "allow".to_string(),
    };
    state.notif_policy.lock().unwrap().insert(id, mode);
}

/// Set one service's microphone/camera permission policy:
/// "allow" (answer Allow), "default" (leave the request to
/// WebView2) or "deny". Unknown values fall back to "allow",
/// mirroring set_service_notif. The service webview's permission
/// handler reads this map on every request, so the change also
/// reaches webviews that are already alive.
#[tauri::command]
fn set_service_media(state: State<'_, AppState>, id: String, mode: String) {
    let mode = match mode.as_str() {
        "default" | "deny" => mode,
        _ => "allow".to_string(),
    };
    state.media_policy.lock().unwrap().insert(id, mode);
}

/// Enter split view (v0.9.0): the active service becomes the
/// main (left) pane at the given ratio; a chosen companion takes
/// the right pane, otherwise the right side stays empty for the
/// UI's companion picker. The layout pass enforces the gate, so
/// entering while the gate fails simply changes nothing visible.
#[tauri::command]
fn split_enter(app: tauri::AppHandle, state: State<'_, AppState>, ratio: f64) {
    *state.split_ratio.lock().unwrap() = ratio;
    *state.split_mode.lock().unwrap() = true;
    *state.companion_picking.lock().unwrap() = false;
    if let Some(window) = state.main_window.lock().unwrap().clone() {
        layout_services(&app, &state, &window);
    }
}

/// Leave split view: the companion is parked by the layout pass
/// (never closed — leaving split must not kill anything), and
/// the main pane takes the full content area again.
#[tauri::command]
fn split_exit(app: tauri::AppHandle, state: State<'_, AppState>) {
    *state.split_mode.lock().unwrap() = false;
    *state.companion_picking.lock().unwrap() = false;
    if let Some(window) = state.main_window.lock().unwrap().clone() {
        layout_services(&app, &state, &window);
    }
}

/// Choose (or clear, with None) the split companion. Creating the
/// companion's webview follows the same rules as a switch —
/// own profile folder, own zoom, permission handlers — except
/// eviction: while split is on the two panes are protected (see
/// split_protected_labels), so creating the companion may exceed
/// the "Hidup bareng" limit as a special case. Async for the
/// same WebView2 reason as switch_service.
#[tauri::command]
async fn split_set_companion(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: Option<String>,
    url: Option<String>,
) -> Result<(), String> {
    let window = state
        .main_window
        .lock()
        .unwrap()
        .clone()
        .ok_or("main window missing")?;
    if let (Some(id), Some(url)) = (id, url) {
        if !valid_id(&id) {
            return Err("invalid service id".into());
        }
        if !valid_url(&url) {
            return Err("invalid service url".into());
        }
        let label = label_for(&id);
        if app.get_webview(&label).is_none() {
            create_service_webview(&app, &state, &window, &id, &url)?;
            if let Some(wv) = app.get_webview(&label) {
                let z = state.zoom.lock().unwrap().get(&id).copied().unwrap_or(1.0);
                let _ = wv.set_zoom(z);
            }
        }
        // Same bridge attach insurance as switch_service
        // (v0.10.1): a companion webview that already existed
        // gets a registration retry if its first one failed.
        ensure_bridge_attached(&app, &state, &id);
        *state.companion.lock().unwrap() = Some(label.clone());
        let mut mru = state.alive_mru.lock().unwrap();
        mru.retain(|l| l != &label);
        mru.insert(0, label);
    } else {
        *state.companion.lock().unwrap() = None;
    }
    // Choosing (or clearing) the companion ends any replace
    // pick in progress: the new companion shows under its
    // header strip, not parked behind the picker.
    *state.companion_picking.lock().unwrap() = false;
    layout_services(&app, &state, &window);
    Ok(())
}

/// Enter or leave "replace companion" picking (v0.9.1): while
/// picking, the layout parks the current companion so the UI's
/// picker owns the right pane; leaving picking (the UI's Batal
/// / Esc, or a choice — which goes through split_set_companion
/// and resets the flag itself) restores it under its header
/// strip. Pure flag + relayout: nothing is created, closed or
/// destroyed here.
#[tauri::command]
fn split_set_picking(app: tauri::AppHandle, state: State<'_, AppState>, picking: bool) {
    *state.companion_picking.lock().unwrap() = picking;
    if let Some(window) = state.main_window.lock().unwrap().clone() {
        layout_services(&app, &state, &window);
    }
}

/// Swap the two split panes: the companion becomes the main
/// service (Rust's active) and the main becomes the companion.
/// Both webviews already exist, so this is a pure relayout.
#[tauri::command]
fn split_swap(app: tauri::AppHandle, state: State<'_, AppState>) {
    let active = state.active.lock().unwrap().clone();
    let companion = state.companion.lock().unwrap().clone();
    if let (Some(a), Some(c)) = (active, companion) {
        *state.active.lock().unwrap() = Some(c);
        *state.companion.lock().unwrap() = Some(a);
    }
    *state.companion_picking.lock().unwrap() = false;
    if let Some(window) = state.main_window.lock().unwrap().clone() {
        layout_services(&app, &state, &window);
    }
}

/// Set the split ratio (divider keyboard control, double-click
/// reset). The stored value is the requested ratio; the layout
/// pass clamps it against the current content width.
#[tauri::command]
fn split_set_ratio(app: tauri::AppHandle, state: State<'_, AppState>, ratio: f64) {
    *state.split_ratio.lock().unwrap() = ratio.clamp(0.05, 0.95);
    if let Some(window) = state.main_window.lock().unwrap().clone() {
        layout_services(&app, &state, &window);
    }
}

/// Whether the split double gate currently passes, recomputed
/// fresh (the UI also receives "split-gate" events on changes).
#[tauri::command]
fn split_gate(state: State<'_, AppState>) -> bool {
    match state.main_window.lock().unwrap().clone() {
        Some(w) => compute_split_gate(&w),
        None => false,
    }
}

/// Whether the left mouse button is currently down, asked of
/// Windows directly. The divider drag session polls this because
/// Sodium's own UI cannot be trusted to see the release: during
/// the drag the cursor spends most of its time over the native
/// service webviews, which swallow the pointer events.
#[cfg(target_os = "windows")]
fn left_button_down() -> bool {
    extern "system" {
        fn GetAsyncKeyState(v_key: i32) -> i16;
    }
    const VK_LBUTTON: i32 = 0x01;
    (unsafe { GetAsyncKeyState(VK_LBUTTON) } as u16 & 0x8000) != 0
}

#[cfg(not(target_os = "windows"))]
fn left_button_down() -> bool {
    true
}

/// Begin a split-divider drag session. A background thread polls
/// the global cursor position (Window::cursor_position) roughly
/// every frame, turns it into a split ratio, stores it, relays
/// out (throttled by the poll rate itself) and reports it to the
/// UI as "split-ratio" so the divider strip and its
/// aria-valuenow follow. The session ends when the left button
/// comes up — wherever the cursor is by then — and the final
/// ratio goes out as "split-drag-end" for the UI to persist. A
/// naive pointer-capture drag in the UI would break the moment
/// the cursor crossed a native webview, which is most of the
/// drag. The 120 s cap is a safety net for a session whose
/// window vanished mid-drag.
#[tauri::command]
fn split_drag_start(app: tauri::AppHandle, state: State<'_, AppState>) {
    if state
        .split_dragging
        .swap(true, std::sync::atomic::Ordering::SeqCst)
    {
        return;
    }
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
        loop {
            std::thread::sleep(std::time::Duration::from_millis(16));
            let state = app.state::<AppState>();
            let stop = !state.split_dragging.load(std::sync::atomic::Ordering::SeqCst)
                || !left_button_down()
                || !*state.split_mode.lock().unwrap()
                || std::time::Instant::now() > deadline;
            if stop {
                state
                    .split_dragging
                    .store(false, std::sync::atomic::Ordering::SeqCst);
                let ratio = *state.split_ratio.lock().unwrap();
                let _ = app.emit_to(UI_LABEL, "split-drag-end", ratio);
                return;
            }
            let window = match state.main_window.lock().unwrap().clone() {
                Some(w) => w,
                None => continue,
            };
            let Ok(pos) = window.cursor_position() else {
                continue;
            };
            let scale = window.scale_factor().unwrap_or(1.0);
            if scale <= 0.0 {
                continue;
            }
            let size = logical_inner_size(&window);
            let content_w = size.width - SIDEBAR_W;
            if content_w <= DIVIDER_W + 2.0 {
                continue;
            }
            // cursor_position is relative to the window's client
            // area, in physical pixels: to logical content
            // coordinates, then to a (clamped) ratio.
            let x = pos.x / scale - SIDEBAR_W;
            let ratio = clamp_split_ratio(x / (content_w - DIVIDER_W), content_w);
            let changed = {
                let mut r = state.split_ratio.lock().unwrap();
                let changed = (*r - ratio).abs() > 0.0005;
                if changed {
                    *r = ratio;
                }
                changed
            };
            if changed {
                layout_services(&app, &state, &window);
                let _ = app.emit_to(UI_LABEL, "split-ratio", ratio);
            }
        }
    });
}

#[tauri::command]
fn alive_services(state: State<'_, AppState>) -> Vec<String> {
    state.alive_mru.lock().unwrap().clone()
}

/// Reload the active service's page (a hung WhatsApp Web tab
/// otherwise needs a service round-trip to recover).
#[tauri::command]
fn reload_service(app: tauri::AppHandle, state: State<'_, AppState>) {
    let active = state.active.lock().unwrap().clone();
    if let Some(label) = active {
        if let Some(wv) = app.get_webview(&label) {
            let _ = wv.reload();
        }
    }
}

/// Show a downloaded file selected in Explorer.
#[tauri::command]
fn reveal_file(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(format!("/select,\"{path}\""))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Replace the active YouTube adblock script (the UI downloaded a
/// newer one from the repo). Applies to service webviews created
/// after this call; alive ones keep the script they started with.
#[tauri::command]
fn set_adblock_script(state: State<'_, AppState>, script: String) {
    *state.adblock_script.lock().unwrap() = script;
}

/// Switch the YouTube adblock on or off (applies at webview
/// creation, like the script itself).
#[tauri::command]
fn set_adblock_enabled(state: State<'_, AppState>, enabled: bool) {
    *state.adblock_enabled.lock().unwrap() = enabled;
}

/// Read the durable settings file (config.json), if it exists.
/// The UI keeps its working copy in localStorage, which dies with
/// the webview profile data; this file survives that.
#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Option<String> {
    let path = app.path().app_data_dir().ok()?.join("config.json");
    std::fs::read_to_string(path).ok()
}

/// Write the settings file atomically (temp file + rename), so a
/// crash mid-write cannot corrupt the only copy.
#[tauri::command]
fn save_config(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("config.json.tmp");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join("config.json")).map_err(|e| e.to_string())?;
    Ok(())
}

/// Export the settings snapshot to a JSON file the user picks.
/// Returns false when the dialog was cancelled.
#[tauri::command]
fn export_config(data: String) -> Result<bool, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_file_name("sodium-config.json")
        .add_filter("JSON", &["json"])
        .save_file()
    else {
        return Ok(false);
    };
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Import a settings snapshot from a JSON file the user picks.
/// Returns None when the dialog was cancelled. Files over
/// 16 MB are refused up front (v0.12.0): a real snapshot is
/// orders of magnitude smaller, and the UI validates the
/// contents before anything is applied.
#[tauri::command]
fn import_config() -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("JSON", &["json"])
        .pick_file()
    else {
        return Ok(None);
    };
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if size > 16 * 1024 * 1024 {
        return Err("Berkas terlalu besar (maks 16 MB).".to_string());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(text))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single instance: a second launch must not fight the first one
        // over the same WebView2 profile folders (they are locked per
        // process). Focus the existing window instead. This plugin has
        // to be registered first.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};
                    if event.state() == ShortcutState::Pressed {
                        if shortcut.key == Code::Space && shortcut.mods == Modifiers::ALT {
                            let _ = app.emit_to(UI_LABEL, "quick-switch", ());
                        } else if shortcut.key == Code::Comma && shortcut.mods == Modifiers::CONTROL {
                            let _ = app.emit_to(UI_LABEL, "shortcut-settings", ());
                        } else if let Some(idx) = shortcut_index(shortcut.key) {
                            let _ = app.emit_to(UI_LABEL, "shortcut-switch", idx);
                        }
                    }
                })
                .build(),
        )
        .manage(AppState {
            max_alive: Mutex::new(1),
            split_ratio: Mutex::new(0.5),
            zoom: Mutex::new(HashMap::new()),
            adblock_script: Mutex::new(BUNDLED_YT_ADBLOCK.to_string()),
            adblock_enabled: Mutex::new(true),
            ..Default::default()
        })
        .setup(|app| {
            // The main window is built here as a plain `tauri::Window`
            // (tauri.conf.json declares no windows) because only `Window`
            // supports `add_child`; a config-created window is a
            // WebviewWindow, which cannot host service webviews.
            let mut win_builder = tauri::window::WindowBuilder::new(app, "main")
                .title("Sodium")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0);
            if let Some(saved) = load_window_state(app.handle()) {
                win_builder = win_builder.inner_size(saved.width, saved.height);
                if let (Some(x), Some(y)) = (saved.x, saved.y) {
                    win_builder = win_builder.position(x, y);
                }
            }
            let window = win_builder.build()?;
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                let _ = app
                    .handle()
                    .global_shortcut()
                    .register_multiple(focus_shortcuts());
            }
            let size = window.inner_size()?;
            let state = app.state::<AppState>();
            // The split gate's initial value, so the very first
            // layout decisions and the UI's first query agree.
            *state.gate_ok.lock().unwrap() = compute_split_gate(&window);
            // The notification panel's history (v0.11.0):
            // reload the persisted store so it survives the
            // restart. A missing or damaged file starts empty.
            let saved_notifs = load_notifications(app.handle());
            if !saved_notifs.is_empty() {
                *state.page_notifications.lock().unwrap() = saved_notifs;
            }
            // The UI webview gets the download handler too (source
            // "sodium-update") so update installers download inside
            // Sodium instead of opening the system browser.
            let ui_builder = WebviewBuilder::new(UI_LABEL, WebviewUrl::App("index.html".into()))
                .on_download(make_download_handler(
                    app.handle().clone(),
                    state.download_dir.clone(),
                    "sodium-update".to_string(),
                ));
            window.add_child(ui_builder, LogicalPosition::new(0.0, 0.0), size)?;
            *state.main_window.lock().unwrap() = Some(window);
            if let Ok(dir) = app.path().download_dir() {
                *state.download_dir.lock().unwrap() = dir;
            }
            if build_tray(app.handle()).is_ok() {
                state
                    .tray_ok
                    .store(true, std::sync::atomic::Ordering::Relaxed);
            }
            Ok(())
        })
        // Allow notification requests (unanswered, WebView2 denies
        // them — WhatsApp's "turn on notifications" could never be
        // enabled before this); everything else keeps the default.
        .on_permission_request(|_, kind| match kind {
            PermissionKind::Notifications => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .invoke_handler(tauri::generate_handler![
            switch_service,
            start_service_hidden,
            set_services_visible,
            set_inbox_open,
            close_service,
            close_webview,
            set_pinned,
            set_max_alive,
            set_service_zoom,
            set_service_notif,
            set_service_media,
            split_enter,
            split_exit,
            split_set_companion,
            split_set_picking,
            split_swap,
            split_set_ratio,
            split_drag_start,
            split_gate,
            open_link_popup,
            close_link_popup,
            open_external,
            run_installer,
            alive_services,
            reload_service,
            reveal_file,
            load_config,
            save_config,
            export_config,
            import_config,
            set_adblock_script,
            set_adblock_enabled,
            notifications_list,
            notifications_clear
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                match event {
                    // Ctrl+1..9, Alt+Space and Ctrl+, belong to Sodium only
                    // while its window is focused; release them when
                    // it blurs.
                    WindowEvent::Focused(true) => {
                        let _ = window
                            .app_handle()
                            .global_shortcut()
                            .register_multiple(focus_shortcuts());
                    }
                    WindowEvent::Focused(false) => {
                        let _ = window
                            .app_handle()
                            .global_shortcut()
                            .unregister_multiple(focus_shortcuts());
                    }
                    WindowEvent::CloseRequested { api, .. } => {
                        save_window_state(&window.app_handle(), window);
                        // With a tray icon, closing hides the window:
                        // services keep running (and notifying) in
                        // the background. Real exit is the tray
                        // menu's "Keluar".
                        let handle = window.app_handle();
                        let state = handle.state::<AppState>();
                        if state.tray_ok.load(std::sync::atomic::Ordering::Relaxed) {
                            api.prevent_close();
                            let _ = window.hide();
                        }
                    }
                    _ => {}
                }
            }
            if let WindowEvent::Resized(_) = event {
                let app = window.app_handle();
                let (ui_pos, ui_size) = full_bounds(window);
                if let Some(wv) = app.get_webview(UI_LABEL) {
                    let _ = wv.set_position(ui_pos);
                    let _ = wv.set_size(ui_size);
                }
                if let Some(wv) = app.get_webview(POPUP_LABEL) {
                    let (ppos, psize) = popup_bounds(window);
                    let _ = wv.set_position(ppos);
                    let _ = wv.set_size(psize);
                }
                // Service webviews follow the one layout pass:
                // the active service (and a split companion) get
                // their new bounds, parked ones just track the
                // new full size so they are already correct when
                // activated.
                let state = app.state::<AppState>();
                layout_services(&app, &state, window);
                schedule_gate_check(&app);
            }
            // Moving between monitors can flip the split gate
            // either way; recheck it (debounced inside
            // schedule_gate_check). A display scale change needs
            // no arm of its own: Tauri 2 has no ScaleChanged
            // window event — the change surfaces as Resized,
            // whose branch above already rechecks the gate.
            if let WindowEvent::Moved(_) = event {
                schedule_gate_check(&window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Sodium")
        .run(|app, event| {
            // Intercept exit requests (Windows shutdown/logoff and
            // any app.exit land here): hold the exit until the
            // service webviews have been closed gracefully, so
            // their profiles are flushed — see
            // begin_graceful_shutdown. Once a graceful shutdown is
            // under way, let its scheduled exit proceed untouched.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<AppState>();
                if !state
                    .shutting_down
                    .load(std::sync::atomic::Ordering::SeqCst)
                {
                    api.prevent_exit();
                    begin_graceful_shutdown(app);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::parse_unread;

    #[test]
    fn unread_from_titles() {
        assert_eq!(parse_unread("(3) WhatsApp"), 3);
        assert_eq!(parse_unread("Inbox (12) - Gmail"), 12);
        assert_eq!(parse_unread("Kotak Masuk (3) - a@b.com"), 3);
        assert_eq!(parse_unread("(2024) Rekap"), 0);
        assert_eq!(parse_unread("WhatsApp"), 0);
    }
}
