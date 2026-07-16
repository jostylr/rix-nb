use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;

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
        .invoke_handler(tauri::generate_handler![git_commit_note, move_note_to_trash])
        .setup(|app| {
            let handle = app.handle();
            let file = SubmenuBuilder::new(handle, "File")
                .item(&MenuItemBuilder::with_id("new-note", "New Note…").accelerator("CmdOrCtrl+N").build(handle)?)
                .item(&MenuItemBuilder::with_id("new-project", "New Project…").accelerator("CmdOrCtrl+Shift+A").build(handle)?)
                .item(&MenuItemBuilder::with_id("open-project", "Open Project…").accelerator("CmdOrCtrl+O").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::with_id("save-note", "Save").accelerator("CmdOrCtrl+S").build(handle)?)
                .item(&MenuItemBuilder::with_id("save-and-commit", "Save and Commit Note…").accelerator("CmdOrCtrl+Shift+S").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::with_id("new-notebook", "New Notebook…").accelerator("CmdOrCtrl+Shift+N").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::with_id("export", "Export…").accelerator("CmdOrCtrl+E").build(handle)?)
                .item(&MenuItemBuilder::with_id("quick-export", "Export Notebook / Project").accelerator("CmdOrCtrl+Shift+E").build(handle)?)
                .build()?;
            let edit = SubmenuBuilder::new(handle, "Edit")
                .undo().redo().separator().cut().copy().paste().select_all().build()?;
            let view = SubmenuBuilder::new(handle, "View")
                .item(&MenuItemBuilder::with_id("toggle-right-pane", "Toggle Preview / Results").accelerator("CmdOrCtrl+P").build(handle)?)
                .build()?;
            let window = SubmenuBuilder::new(handle, "Window")
                .minimize().maximize().separator().close_window().build()?;
            let app_menu = SubmenuBuilder::new(handle, "RiX Notebook")
                .about(None).separator().services().separator().hide().hide_others().show_all().separator().quit().build()?;
            let menu = MenuBuilder::new(handle).items(&[&app_menu, &file, &edit, &view, &window]).build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let _ = app.emit("menu-command", event.id().as_ref());
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running RiX Notebook");
}
