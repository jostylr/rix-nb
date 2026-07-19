use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WindowEvent};
use tauri_plugin_fs::FsExt;

const RECENT_PROJECT_LIMIT: usize = 12;

#[derive(Clone, Deserialize, Serialize)]
struct RecentProject {
    #[serde(default = "default_recent_kind")]
    kind: String,
    #[serde(default)]
    last_note_path: Option<String>,
    path: String,
    title: String,
}

#[derive(Deserialize, Serialize)]
struct WindowGeometry {
    height: u32,
    maximized: bool,
    width: u32,
    x: i32,
    y: i32,
}

fn default_recent_kind() -> String {
    "project".to_string()
}

fn recent_projects_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate application data: {error}"))?;
    fs::create_dir_all(&directory).map_err(|error| format!("Could not create application data folder: {error}"))?;
    Ok(directory.join("recent-projects.json"))
}

fn window_geometry_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate application data: {error}"))?;
    fs::create_dir_all(&directory).map_err(|error| format!("Could not create application data folder: {error}"))?;
    Ok(directory.join("window-geometry.json"))
}

fn restore_window_geometry<R: Runtime>(app: &AppHandle<R>) {
    let Ok(path) = window_geometry_path(app) else { return; };
    let Ok(source) = fs::read_to_string(path) else { return; };
    let Ok(geometry) = serde_json::from_str::<WindowGeometry>(&source) else { return; };
    let Some(window) = app.get_webview_window("main") else { return; };
    let _ = window.set_size(PhysicalSize::new(geometry.width.max(640), geometry.height.max(480)));
    let _ = window.set_position(PhysicalPosition::new(geometry.x, geometry.y));
    if geometry.maximized {
        let _ = window.maximize();
    }
}

fn save_window_geometry<R: Runtime>(window: &tauri::Window<R>) {
    let Ok(position) = window.outer_position() else { return; };
    let Ok(size) = window.outer_size() else { return; };
    let Ok(maximized) = window.is_maximized() else { return; };
    let geometry = WindowGeometry {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized,
    };
    let Ok(path) = window_geometry_path(&window.app_handle()) else { return; };
    let Ok(source) = serde_json::to_string(&geometry) else { return; };
    let _ = fs::write(path, source);
}

fn load_recent_projects<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<RecentProject>, String> {
    let path = recent_projects_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let source = fs::read_to_string(path).map_err(|error| format!("Could not read recent projects: {error}"))?;
    serde_json::from_str(&source).map_err(|error| format!("Could not read recent projects: {error}"))
}

fn save_recent_projects<R: Runtime>(app: &AppHandle<R>, projects: &[RecentProject]) -> Result<(), String> {
    let source = serde_json::to_string(projects).map_err(|error| format!("Could not save recent projects: {error}"))?;
    fs::write(recent_projects_path(app)?, source).map_err(|error| format!("Could not save recent projects: {error}"))
}

fn allow_project_access<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<(), String> {
    let project = Path::new(path)
        .canonicalize()
        .map_err(|error| format!("Could not access recent project: {error}"))?;
    if !project.is_dir() {
        return Err("The recent project folder no longer exists".to_string());
    }
    app.fs_scope()
        .allow_directory(&project, true)
        .map_err(|error| format!("Could not grant project file access: {error}"))?;
    app.asset_protocol_scope()
        .allow_directory(&project, true)
        .map_err(|error| format!("Could not grant project asset access: {error}"))?;
    Ok(())
}

#[tauri::command]
fn grant_project_access(app: AppHandle, path: String) -> Result<(), String> {
    allow_project_access(&app, &path)
}

fn allow_file_access<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<(), String> {
    let file = Path::new(path)
        .canonicalize()
        .map_err(|error| format!("Could not access recent file: {error}"))?;
    if !file.is_file() {
        return Err("The recent file no longer exists".to_string());
    }
    let directory = file.parent().ok_or_else(|| "Could not locate the file folder".to_string())?;
    app.fs_scope()
        .allow_directory(directory, true)
        .map_err(|error| format!("Could not grant file access: {error}"))?;
    app.asset_protocol_scope()
        .allow_directory(directory, true)
        .map_err(|error| format!("Could not grant file asset access: {error}"))?;
    Ok(())
}

fn allow_recent_access<R: Runtime>(app: &AppHandle<R>, recent: &RecentProject) -> Result<(), String> {
    if recent.kind == "file" { allow_file_access(app, &recent.path) } else { allow_project_access(app, &recent.path) }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let recents = load_recent_projects(app).unwrap_or_default();
    let mut recent_menu = SubmenuBuilder::new(app, "Open Recent");
    if recents.is_empty() {
        recent_menu = recent_menu.item(&MenuItemBuilder::with_id("recent-empty", "No Recent Projects").enabled(false).build(app)?);
    } else {
        for (index, recent) in recents.iter().enumerate() {
            recent_menu = recent_menu.item(
                &MenuItemBuilder::with_id(format!("open-recent:{index}"), &recent.title).build(app)?,
            );
        }
        recent_menu = recent_menu.separator().item(
            &MenuItemBuilder::with_id("clear-recent-projects", "Clear Menu").build(app)?,
        );
    }
    let recent_menu = recent_menu.build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::with_id("new-note", "New Note…").accelerator("CmdOrCtrl+N").build(app)?)
        .item(&MenuItemBuilder::with_id("new-project", "New Project…").accelerator("CmdOrCtrl+Shift+A").build(app)?)
        .item(&MenuItemBuilder::with_id("open-project", "Open…").accelerator("CmdOrCtrl+O").build(app)?)
        .item(&recent_menu)
        .separator()
        .item(&MenuItemBuilder::with_id("save-note", "Save").accelerator("CmdOrCtrl+S").build(app)?)
        .item(&MenuItemBuilder::with_id("save-and-commit", "Save and Commit Note…").accelerator("CmdOrCtrl+Shift+S").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("new-notebook", "New Notebook…").accelerator("CmdOrCtrl+Shift+N").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("export", "Export…").accelerator("CmdOrCtrl+E").build(app)?)
        .item(&MenuItemBuilder::with_id("quick-export", "Export Notebook / Project").accelerator("CmdOrCtrl+Shift+E").build(app)?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo().redo().separator().cut().copy().paste().select_all().build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::with_id("toggle-right-pane", "Toggle Preview / Results").accelerator("CmdOrCtrl+P").build(app)?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize().maximize().separator().close_window().build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("open-notebook-help", "RiX Notebook Help").accelerator("CmdOrCtrl+Shift+/").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("open-rix-reference", "RiX Language Reference").build(app)?)
        .item(&MenuItemBuilder::with_id("open-rix-tutorials", "RiX Tutorials").build(app)?)
        .build()?;
    let app_menu = SubmenuBuilder::new(app, "RiX Notebook")
        .about(None).separator().services().separator().hide().hide_others().show_all().separator().quit().build()?;
    MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &view, &window, &help]).build()
}

#[tauri::command]
fn record_recent_project(
    app: AppHandle,
    path: String,
    title: String,
    last_note_path: Option<String>,
) -> Result<(), String> {
    allow_project_access(&app, &path)?;
    let mut recents = load_recent_projects(&app)?;
    recents.retain(|recent| recent.path != path);
    recents.insert(0, RecentProject { kind: "project".to_string(), path, title, last_note_path });
    recents.truncate(RECENT_PROJECT_LIMIT);
    save_recent_projects(&app, &recents)?;
    app.set_menu(build_menu(&app).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Could not update Open Recent: {error}"))?;
    Ok(())
}

#[tauri::command]
fn record_recent_file(app: AppHandle, path: String, title: String) -> Result<(), String> {
    allow_file_access(&app, &path)?;
    let mut recents = load_recent_projects(&app)?;
    recents.retain(|recent| recent.path != path);
    recents.insert(0, RecentProject { kind: "file".to_string(), path, title, last_note_path: None });
    recents.truncate(RECENT_PROJECT_LIMIT);
    save_recent_projects(&app, &recents)?;
    app.set_menu(build_menu(&app).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Could not update Open Recent: {error}"))?;
    Ok(())
}

#[tauri::command]
fn get_recent_documents(app: AppHandle) -> Result<Vec<RecentProject>, String> {
    load_recent_projects(&app)
}

fn command_output(command: &mut Command) -> Result<String, String> {
    let output = command.output().map_err(|error| format!("Could not run git: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if message.is_empty() { "git command failed".to_string() } else { message })
    }
}

fn note_relative_to_project(project_root: &str, note_path: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = Path::new(project_root)
        .canonicalize()
        .map_err(|error| format!("Cannot access project folder: {error}"))?;
    let note = Path::new(note_path)
        .canonicalize()
        .map_err(|error| format!("Cannot access note: {error}"))?;
    let relative = note
        .strip_prefix(&root)
        .map_err(|_| "The selected note is outside the current project".to_string())?
        .to_path_buf();
    Ok((root, relative))
}

#[tauri::command]
fn git_commit_note(project_root: String, note_path: String, message: String) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("A commit message is required".to_string());
    }
    let (root, relative) = note_relative_to_project(&project_root, &note_path)?;
    command_output(Command::new("git").arg("-C").arg(&root).arg("add").arg("--").arg(&relative))?;
    let output = command_output(
        Command::new("git")
            .arg("-C")
            .arg(&root)
            .arg("commit")
            .arg("-m")
            .arg(message.trim())
            .arg("--")
            .arg(&relative),
    )?;
    Ok(if output.is_empty() { "Committed note".to_string() } else { output })
}

#[tauri::command]
fn move_note_to_trash(project_root: String, note_path: String) -> Result<(), String> {
    let (root, relative) = note_relative_to_project(&project_root, &note_path)?;
    let note = root.join(relative);
    let script = "on run argv\n  set item_to_trash to (POSIX file (item 1 of argv) as alias)\n  tell application \"Finder\"\n    delete item_to_trash\n  end tell\nend run";
    command_output(Command::new("osascript").arg("-e").arg(script).arg(note))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                save_window_geometry(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            git_commit_note,
            move_note_to_trash,
            record_recent_project,
            record_recent_file,
            get_recent_documents,
            grant_project_access
        ])
        .setup(|app| {
            let handle = app.handle();
            app.set_menu(build_menu(handle)?)?;
            restore_window_geometry(handle);
            app.on_menu_event(|app, event| {
                let id = event.id().as_ref();
                if id == "clear-recent-projects" {
                    let _ = save_recent_projects(app, &[]);
                    if let Ok(menu) = build_menu(app) {
                        let _ = app.set_menu(menu);
                    }
                    return;
                }
                if let Some(index) = id.strip_prefix("open-recent:").and_then(|index| index.parse::<usize>().ok()) {
                    if let Some(recent) = load_recent_projects(app).ok().and_then(|projects| projects.get(index).cloned()) {
                        if allow_recent_access(app, &recent).is_ok() {
                            let _ = app.emit("open-recent-document", recent);
                        }
                    }
                    return;
                }
                let _ = app.emit("menu-command", id);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running RiX Notebook");
}
