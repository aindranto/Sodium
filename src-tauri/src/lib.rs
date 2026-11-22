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
    /// Label of the service webview currently shown. Alive service
    /// webviews are stacked native controls, so exactly one may be
    /// visible at a time: this one.
    active: Mutex<Option<String>>,
    /// Whether the link popup is currently open over the active service.
    link_open: Mutex<bool>,
    /// Folder the Save As dialog starts in: the user's Downloads folder
    /// at first, then the last folder a download was saved to.
    download_dir: std::sync::Arc<Mutex<std::path::PathBuf>>,
    /// The main window, created in the setup hook as a plain `tauri::Window`
    /// (not a WebviewWindow) because only `Window` can host child webviews
    /// via `add_child`.
    main_window: Mutex<Option<tauri::Window>>,
}

fn label_for(id: &str) -> String {
    format!("service-{id}")
}

fn id_from_label(label: &str) -> &str {
    label.trim_start_matches("service-")
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

/// Build the download handler for a service or popup webview.
///
/// Downloads inside a webview (e.g. a file a friend sent on WhatsApp)
/// silently go nowhere unless the host answers WebView2's download
/// event. Answer it with the native Save As dialog, starting in the
/// Downloads folder (then in the last folder used) with the file name
/// the site suggests; cancelling the dialog cancels the download. When
/// a download finishes, the UI is told the saved path so it can show a
/// small toast.
fn make_download_handler(
    app: tauri::AppHandle,
    download_dir: std::sync::Arc<Mutex<std::path::PathBuf>>,
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
                        *destination = path;
                        true
                    }
                    None => false,
                }
            }
            DownloadEvent::Finished { path, success, .. } => {
                if success {
                    if let Some(p) = &path {
                        let _ = app.emit_to(
                            UI_LABEL,
                            "download-finished",
                            p.to_string_lossy().into_owned(),
                        );
                    }
                }
                true
            }
            _ => true,
        }
    }
}

/// Ctrl+1..9 as global shortcuts. They are registered only while the
/// Sodium window is focused (and released on blur, so other apps keep
/// their Ctrl+number keys): keydown events inside a service webview
/// never reach Sodium's own UI, so without this the number shortcuts
/// would be dead exactly while the user is chatting.
fn digit_shortcuts() -> Vec<tauri_plugin_global_shortcut::Shortcut> {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    [
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
    .collect()
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

/// Unread count from a service page title. Services put it in the
/// title as a leading "(n)" (WhatsApp, Telegram, Messenger, Discord)
/// or as "Inbox (n)" (Gmail). Anything else means no badge; counts are
/// capped at 999, which also keeps title years like "(2024)" from
/// being misread as unread counts.
fn parse_unread(title: &str) -> usize {
    fn paren_number(s: &str) -> Option<usize> {
        let inner = s.split(')').next()?;
        if inner.is_empty() || !inner.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        inner.parse().ok()
    }
    let count = if let Some(rest) = title.strip_prefix('(') {
        paren_number(rest)
    } else if let Some(pos) = title.find("Inbox (") {
        paren_number(&title[pos + "Inbox (".len()..])
    } else {
        None
    };
    count.filter(|&n| n <= 999).unwrap_or(0)
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

/// Switch to a service.
///
/// Sodium's RAM strategy is user-tunable: at most `max_alive` non-pinned
/// webviews stay alive; when a switch would exceed that, the
/// least-recently-used non-pinned webview is *destroyed* (not hidden), so
/// its RAM is actually freed. Sessions persist because each service gets
/// its own data_directory on disk (cookies / localStorage survive a destroy).
///
/// This command is `async` on purpose: creating a webview from a synchronous
/// command can deadlock on Windows (documented Webview2 issue).
#[tauri::command]
async fn switch_service(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    url: String,
) -> Result<(), String> {
    let label = label_for(&id);
    let window = state
        .main_window
        .lock()
        .unwrap()
        .clone()
        .ok_or("main window missing")?;

    // Create the target if it is not alive yet.
    if app.get_webview(&label).is_none() {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("profiles")
            .join(&id);
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
        // Links that ask for a new window (target=_blank, window.open)
        // would be silently dropped by WebView2. Deny the window and
        // tell the UI instead: it shows the link popup over the service.
        let app_for_links = app.clone();
        let app_for_title = app.clone();
        let id_for_title = id.clone();
        let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed))
            .data_directory(data_dir)
            .on_new_window(move |u, _features| {
                let _ = app_for_links.emit_to(UI_LABEL, "link-clicked", u.to_string());
                NewWindowResponse::Deny
            })
            .on_download(make_download_handler(
                app.clone(),
                state.download_dir.clone(),
            ))
            // Unread badge: services announce unread chats in their
            // page title ("(3) WhatsApp"); forward the parsed count to
            // the UI, which draws the number on the sidebar icon.
            .on_document_title_changed(move |_wv, title| {
                let count = parse_unread(&title);
                let _ = app_for_title.emit_to(
                    UI_LABEL,
                    "unread-changed",
                    (id_for_title.clone(), count),
                );
            });
        let (pos, size) = service_bounds(&window);
        window
            .add_child(builder, pos, size)
            .map_err(|e| e.to_string())?;
    } else if let Some(wv) = app.get_webview(&label) {
        let (pos, size) = service_bounds(&window);
        let _ = wv.set_position(pos);
        let _ = wv.set_size(size);
        let _ = wv.set_focus();
    }

    // Apply this service's own zoom level to the (possibly just created)
    // webview.
    if let Some(wv) = app.get_webview(&label) {
        let z = state.zoom.lock().unwrap().get(&id).copied().unwrap_or(1.0);
        let _ = wv.set_zoom(z);
    }

    // Show only the target. Alive service webviews are stacked native
    // controls with the most recently *created* one on top, so without
    // this, switching to an older alive webview (a pinned service, or
    // max_alive > 1) changes nothing on screen: the newer webview keeps
    // covering it, and the covered service only appears once the covering
    // one is deleted. Hide the rest, show the target.
    *state.active.lock().unwrap() = Some(label.clone());
    for wv in app.webviews().values() {
        if wv.label() == label {
            let _ = wv.show();
        } else if wv.label().starts_with("service-") {
            let _ = wv.hide();
        }
    }

    // Mark target as most-recently-used.
    {
        let mut mru = state.alive_mru.lock().unwrap();
        mru.retain(|l| l != &label);
        mru.insert(0, label.clone());
    }

    evict_over_limit(&app, &state);
    Ok(())
}

/// Destroy least-recently-used non-pinned webviews while more of them
/// are alive than the user's "Hidup bareng" limit. Called after every
/// switch and immediately when the limit itself changes, so lowering
/// the limit takes effect at once instead of on the next switch.
fn evict_over_limit(app: &tauri::AppHandle, state: &AppState) {
    let max_alive = *state.max_alive.lock().unwrap();
    if max_alive == 0 {
        return;
    }
    loop {
        let victim: Option<String> = {
            let mru = state.alive_mru.lock().unwrap();
            let pinned = state.pinned.lock().unwrap();
            let non_pinned: Vec<&String> = mru
                .iter()
                .filter(|l| !pinned.contains(id_from_label(l)))
                .collect();
            if non_pinned.len() <= max_alive {
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
                state.alive_mru.lock().unwrap().retain(|l| l != &v);
            }
            None => break,
        }
    }
}

/// Hide or show all alive service webviews. Used while a UI panel (add
/// service / right-click menu) is open: service webviews are native
/// controls layered *above* the UI webview, so a panel rendered by the UI
/// would be hidden behind e.g. WhatsApp and its buttons unclickable.
/// Hiding is not destroying: sessions and state stay alive.
#[tauri::command]
fn set_services_visible(app: tauri::AppHandle, state: State<'_, AppState>, visible: bool) {
    let active = state.active.lock().unwrap().clone();
    let link_open = *state.link_open.lock().unwrap();
    for wv in app.webviews().values() {
        if wv.label().starts_with("service-") {
            // "visible" means "panels closed": bring back only the active
            // service, never the whole stack — and while the link popup
            // is open, the services stay hidden behind it.
            if visible && !link_open && active.as_deref() == Some(wv.label()) {
                let _ = wv.show();
            } else {
                let _ = wv.hide();
            }
        } else if wv.label() == POPUP_LABEL {
            if visible && link_open {
                let _ = wv.show();
            } else {
                let _ = wv.hide();
            }
        }
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
            .on_new_window(move |u, _features| {
                let _ = app_for_links.emit_to(UI_LABEL, "link-clicked", u.to_string());
                NewWindowResponse::Deny
            })
            .on_download(make_download_handler(
                app.clone(),
                state.download_dir.clone(),
            ));
        let (pos, size) = popup_bounds(&window);
        window
            .add_child(builder, pos, size)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Close the link popup and bring the active service back.
#[tauri::command]
fn close_link_popup(app: tauri::AppHandle, state: State<'_, AppState>) {
    *state.link_open.lock().unwrap() = false;
    if let Some(wv) = app.get_webview(POPUP_LABEL) {
        let _ = wv.close();
    }
    let active = state.active.lock().unwrap().clone();
    if let Some(active_label) = &active {
        if let Some(wv) = app.get_webview(active_label) {
            let _ = wv.show();
        }
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

/// Destroy one service's webview and forget it (used when the user
/// deletes the service from the sidebar).
#[tauri::command]
fn close_service(app: tauri::AppHandle, state: State<'_, AppState>, id: String) {
    let label = label_for(&id);
    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.close();
    }
    let _ = app.emit_to(UI_LABEL, "unread-changed", (id.clone(), 0usize));
    state.alive_mru.lock().unwrap().retain(|l| l != &label);
    let mut active = state.active.lock().unwrap();
    if active.as_deref() == Some(label.as_str()) {
        *active = None;
    }
}

#[tauri::command]
fn set_pinned(state: State<'_, AppState>, id: String, pinned: bool) {
    let mut set = state.pinned.lock().unwrap();
    if pinned {
        set.insert(id);
    } else {
        set.remove(&id);
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

#[tauri::command]
fn alive_services(state: State<'_, AppState>) -> Vec<String> {
    state.alive_mru.lock().unwrap().clone()
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
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state() == ShortcutState::Pressed {
                        if let Some(idx) = shortcut_index(shortcut.key) {
                            let _ = app.emit_to(UI_LABEL, "shortcut-switch", idx);
                        }
                    }
                })
                .build(),
        )
        .manage(AppState {
            max_alive: Mutex::new(1),
            zoom: Mutex::new(HashMap::new()),
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
                    .register_multiple(digit_shortcuts());
            }
            let size = window.inner_size()?;
            let ui_builder = WebviewBuilder::new(UI_LABEL, WebviewUrl::App("index.html".into()));
            window.add_child(ui_builder, LogicalPosition::new(0.0, 0.0), size)?;
            let state = app.state::<AppState>();
            *state.main_window.lock().unwrap() = Some(window);
            if let Ok(dir) = app.path().download_dir() {
                *state.download_dir.lock().unwrap() = dir;
            }
            Ok(())
        })
        // WebView2 denies web permission requests by default when the host
        // app does not answer them, which is why e.g. WhatsApp Web's
        // "turn on notifications" could never be enabled. Answer the
        // request: notifications are allowed (that is the point of a
        // messaging aggregator); everything else keeps the default.
        .on_permission_request(|_, kind| match kind {
            PermissionKind::Notifications => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .invoke_handler(tauri::generate_handler![
            switch_service,
            set_services_visible,
            close_service,
            set_pinned,
            set_max_alive,
            set_service_zoom,
            open_link_popup,
            close_link_popup,
            open_external,
            alive_services
        ])
        .on_window_event(|window, event| {
            // Keep the UI and service webviews filling the main window.
            if window.label() != "main" {
                return;
            }
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                match event {
                    // Ctrl+1..9 belong to Sodium only while its window is
                    // focused; release them when it blurs.
                    WindowEvent::Focused(true) => {
                        let _ = window
                            .app_handle()
                            .global_shortcut()
                            .register_multiple(digit_shortcuts());
                    }
                    WindowEvent::Focused(false) => {
                        let _ = window
                            .app_handle()
                            .global_shortcut()
                            .unregister_multiple(digit_shortcuts());
                    }
                    WindowEvent::CloseRequested { .. } => {
                        save_window_state(&window.app_handle(), window);
                    }
                    _ => {}
                }
            }
            if let WindowEvent::Resized(_) = event {
                let app = window.app_handle();
                let (ui_pos, ui_size) = full_bounds(window);
                let (pos, size) = service_bounds(window);
                for wv in app.webviews().values() {
                    if wv.label() == UI_LABEL {
                        let _ = wv.set_position(ui_pos);
                        let _ = wv.set_size(ui_size);
                    } else if wv.label() == POPUP_LABEL {
                        let (ppos, psize) = popup_bounds(window);
                        let _ = wv.set_position(ppos);
                        let _ = wv.set_size(psize);
                    } else if wv.label().starts_with("service-") {
                        let _ = wv.set_position(pos);
                        let _ = wv.set_size(size);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Sodium");
}
