use std::sync::Mutex;
use tauri::{Manager, State};

/// Absolute path passed on the command line at launch (double-click / "Open with").
struct InitialFile(Mutex<Option<String>>);

/// Pick the first non-flag argument that looks like a file to open.
fn first_file_arg(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1) // program name
        .find(|a| !a.starts_with('-'))
        .cloned()
}

/// Read a UTF-8 text file from any absolute path the user chose.
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write a UTF-8 text file to any absolute path the user chose.
#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Hand the frontend the file we were launched with, if any.
#[tauri::command]
fn initial_file(state: State<InitialFile>) -> Option<String> {
    state.0.lock().ok().and_then(|g| g.clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let initial = first_file_arg(&args);

    let mut builder = tauri::Builder::default();

    // Desktop-only plugins: single-instance MUST be registered first so a second
    // launch (e.g. "Open with") forwards its file to the running window.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
                use tauri::Emitter;
                if let Some(path) = first_file_arg(&argv) {
                    let _ = app.emit("open-file", path);
                }
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_focus();
                }
            }))
            .plugin(tauri_plugin_window_state::Builder::default().build())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(InitialFile(Mutex::new(initial)))
        .invoke_handler(tauri::generate_handler![read_file, write_file, initial_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
