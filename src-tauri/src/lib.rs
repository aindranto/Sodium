
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::webview::{WebviewBuilder, WebviewUrl};
use tauri::{LogicalPosition, LogicalSize, Manager, State, WindowEvent};

/// Width of the sidebar rendered by the main window's own UI (ui/index.html).
const SIDEBAR_W: f64 = 76.0;

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
}

fn label_for(id: &str) -> String {
    format!("service-{id}")
}

fn id_from_label(label: &str) -> &str {
    label.trim_start_matches("service-")
}

/// Size/position a service webview should occupy: everything right of the sidebar.
fn service_bounds(window: &tauri::Window) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    let size = window.inner_size().unwrap_or(tauri::PhysicalSize { width: 1280, height: 800 });
    let scale = window.scale_factor().unwrap_or(1.0);
    let w = (size.width as f64 / scale).max(SIDEBAR_W + 100.0);
    let h = size.height as f64 / scale;
    (
        LogicalPosition::new(SIDEBAR_W, 0.0),
        LogicalSize::new(w - SIDEBAR_W, h),
    )
}

/// Switch to a service.
///
/// Sodium's RAM strategy is user-tunable: at most `max_alive` non-pinned
/// webviews stay alive; when a switch would exceed that, the
/// least-recently-used non-pinned webview is *destroyed* (not hidden), so
/// its RAM is actually freed. Sessions persist because each service gets
/// its own data_directory on disk (cookies / localStorage survive a destroy).
#[tauri::command]
fn switch_service(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    url: String,
) -> Result<(), String> {
    let label = label_for(&id);
    let window = app.get_webview_window("main").ok_or("main window missing")?;

    // Create the target if it is not alive yet.
    if app.get_webview(&label).is_none() {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("profiles")
            .join(&id);
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        let parsed: tauri::Url = url.parse().map_err(|e| e.to_string())?;
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
        .invoke_handler(tauri::generate_handler![
            switch_service,
            set_pinned,
            set_max_alive,
            alive_services
        ])
        .on_window_event(|window, event| {
            // Keep service webviews filling the area right of the sidebar.
            if let WindowEvent::Resized(_) = event {
                let app = window.app_handle();
                if let Some(main) = app.get_webview_window("main") {
                    let (pos, size) = service_bounds(&main);
                    for wv in app.webviews().values() {
                        if wv.label().starts_with("service-") {
                            let _ = wv.set_position(pos);
                            let _ = wv.set_size(size);
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Sodium");
}
