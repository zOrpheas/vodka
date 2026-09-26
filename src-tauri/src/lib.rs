mod dl;
mod lyrics;
mod media;
mod sync;

use std::fs;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

fn db_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("library.json"))
}

#[tauri::command]
fn load_db(app: AppHandle) -> Option<String> {
    fs::read_to_string(db_path(&app).ok()?).ok()
}

#[tauri::command]
fn save_db(app: AppHandle, json: String) -> Result<(), String> {
    let path = db_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn media_base(m: tauri::State<media::Media>) -> String {
    m.base.clone()
}

#[tauri::command]
fn delete_file(path: String) {
    let p = std::path::Path::new(&path);
    let _ = fs::remove_file(p);
    let _ = fs::remove_file(p.with_extension("jpg"));
}

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        // Launching Vodka again (e.g. while it sits in the tray) focuses the running window.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(dl::Dl::default())
        .manage(media::start().expect("could not start media server"))
        .setup(|app| {
            let show_i = MenuItem::with_id(app, "show", "Show Vodka", true, None::<&str>)?;
            let play_i = MenuItem::with_id(app, "toggle", "Play / Pause", true, None::<&str>)?;
            let next_i = MenuItem::with_id(app, "next", "Next track", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Vodka", true, None::<&str>)?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Vodka is running. Click to open.")
                .menu(&Menu::with_items(app, &[&show_i, &play_i, &next_i, &quit_i])?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "show" => show(app),
                    "quit" => app.exit(0),
                    "toggle" | "next" => {
                        let _ = app.emit("tray", e.id.as_ref());
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = e {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<dl::Dl>().close_to_tray() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_db,
            save_db,
            delete_file,
            media_base,
            lyrics::lyrics,
            sync::align_lyrics,
            dl::configure,
            dl::onset,
            dl::add_jobs,
            dl::pause_job,
            dl::resume_job,
            dl::cancel_job,
            dl::retry_job,
            dl::retry_failed,
            dl::clear_finished,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vodka");
}
