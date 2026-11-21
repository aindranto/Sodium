use std::collections::HashSet;
use std::sync::Mutex;
use tauri::webview::{PermissionKind, PermissionResponse, WebviewBuilder};
use tauri::{LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WindowEvent};

/// Width of the sidebar rendered by Sodium's own UI (ui/index.html).
const SIDEBAR_W: f64 = 76.0;

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

/// Bounds for a service webview: everything right of the sidebar.
fn service_bounds(window: &tauri::Window) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    let size = logical_inner_size(window);
    let w = size.width.max(SIDEBAR_W + 100.0);
    (
        LogicalPosition::new(SIDEBAR_W, 0.0),
        LogicalSize::new(w - SIDEBAR_W, size.height),
    )
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
        let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed))
            .data_directory(data_dir);
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

    // Mark target as most-recently-used.
    {
        let mut mru = state.alive_mru.lock().unwrap();
        mru.retain(|l| l != &label);
        mru.insert(0, label.clone());
    }

    // Evict LRU non-pinned webviews while over the user's limit.
    let max_alive = *state.max_alive.lock().unwrap();
    if max_alive > 0 {
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
                    state.alive_mru.lock().unwrap().retain(|l| l != &v);
                }
                None => break,
            }
        }
    }
    Ok(())
}

/// Hide or show all alive service webviews. Used while a UI panel (add
/// service / right-click menu) is open: service webviews are native
/// controls layered *above* the UI webview, so a panel rendered by the UI
/// would be hidden behind e.g. WhatsApp and its buttons unclickable.
/// Hiding is not destroying: sessions and state stay alive.
#[tauri::command]
fn set_services_visible(app: tauri::AppHandle, visible: bool) {
    for wv in app.webviews().values() {
        if wv.label().starts_with("service-") {
            if visible {
                let _ = wv.show();
            } else {
                let _ = wv.hide();
            }
        }
    }
}

/// Destroy one service's webview and forget it (used when the user
/// deletes the service from the sidebar).
#[tauri::command]
fn close_service(app: tauri::AppHandle, state: State<'_, AppState>, id: String) {
    let label = label_for(&id);
    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.close();
    }
    state.alive_mru.lock().unwrap().retain(|l| l != &label);
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
fn set_max_alive(state: State<'_, AppState>, max: usize) {
    *state.max_alive.lock().unwrap() = max;
}

#[tauri::command]
fn alive_services(state: State<'_, AppState>) -> Vec<String> {
    state.alive_mru.lock().unwrap().clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            max_alive: Mutex::new(1),
            ..Default::default()
        })
        .setup(|app| {
            // The main window is built here as a plain `tauri::Window`
            // (tauri.conf.json declares no windows) because only `Window`
            // supports `add_child`; a config-created window is a
            // WebviewWindow, which cannot host service webviews.
            let window = tauri::window::WindowBuilder::new(app, "main")
                .title("Sodium")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            let size = window.inner_size()?;
            let ui_builder = WebviewBuilder::new(UI_LABEL, WebviewUrl::App("index.html".into()));
            window.add_child(ui_builder, LogicalPosition::new(0.0, 0.0), size)?;
            let state = app.state::<AppState>();
            *state.main_window.lock().unwrap() = Some(window);
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
            alive_services
        ])
        .on_window_event(|window, event| {
            // Keep the UI and service webviews filling the main window.
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::Resized(_) = event {
                let app = window.app_handle();
                let (ui_pos, ui_size) = full_bounds(window);
                let (pos, size) = service_bounds(window);
                for wv in app.webviews().values() {
                    if wv.label() == UI_LABEL {
                        let _ = wv.set_position(ui_pos);
                        let _ = wv.set_size(ui_size);
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
