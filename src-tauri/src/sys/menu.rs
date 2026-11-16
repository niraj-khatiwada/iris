use tauri::menu::MenuItemKind;
use tauri::AppHandle;

/// macOS binds Close Window to Cmd+W by default, which would dismiss Iris while it is on screen.
/// Remove the empty File menu and the Window > Close item so the key reaches the webview.
#[cfg(target_os = "macos")]
pub fn remove_close_window_items(app: &AppHandle) {
    let Some(menu) = app.menu() else {
        return;
    };

    let result = (|| -> tauri::Result<()> {
        let items = menu.items()?;
        for index in (0..items.len()).rev() {
            let MenuItemKind::Submenu(submenu) = &items[index] else {
                continue;
            };

            match submenu.text()?.as_str() {
                "File" => {
                    // On macOS this submenu only contains Close Window.
                    menu.remove_at(index)?;
                }
                "Window" => {
                    let children = submenu.items()?;
                    for child_index in (0..children.len()).rev() {
                        let MenuItemKind::Predefined(item) = &children[child_index] else {
                            continue;
                        };
                        if item.text()? == "Close Window" {
                            submenu.remove_at(child_index)?;
                        }
                    }
                }
                _ => {}
            }
        }

        app.set_menu(menu)?;
        Ok(())
    })();

    if let Err(error) = result {
        log::warn!("Could not remove the Close Window menu shortcut: {error}");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn remove_close_window_items(_app: &AppHandle) {}
