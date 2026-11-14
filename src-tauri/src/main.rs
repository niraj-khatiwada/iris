// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod core;
mod sys;
mod tauri_commands;
mod utils;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;

use tauri::Manager;
use tauri_commands::chat::GenerationState;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

static QUITTING: AtomicBool = AtomicBool::new(false);

fn main() {
    tauri::Builder::default()
        // A second launch summons the quick chat instead of starting another app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Err(error) = crate::sys::overlay::show(app) {
                log::error!("Failed to show Iris from a second launch: {error}");
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // The overlay is positioned and sized by Iris on every show.
                .with_denylist(&["overlay", "canvas"])
                // The main history window starts hidden; do not restore it as visible.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        .difference(tauri_plugin_window_state::StateFlags::VISIBLE),
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            app.manage(GenerationState::default());

            // Alt+Space summons Iris from anywhere; macOS calls it Option+Space. The second
            // binding is there for machines where another launcher already owns the first.
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            if let Err(error) = crate::sys::overlay::toggle(app) {
                                log::error!("Failed to toggle the Iris overlay: {error}");
                            }
                        }
                    })
                    .build(),
            )?;

            for shortcut in ["alt+space", "commandorcontrol+shift+space"] {
                match app.global_shortcut().register(shortcut) {
                    Ok(()) => log::info!("Registered global shortcut {shortcut}"),
                    Err(error) => {
                        log::warn!("Could not register global shortcut {shortcut}: {error}")
                    }
                }
            }

            // The menu bar is how Iris is reached when both windows are hidden.
            let tray = (|| -> tauri::Result<()> {
                let ask = MenuItem::with_id(app, "ask", "Ask Iris", true, None::<&str>)?;
                let history = MenuItem::with_id(app, "history", "History", true, None::<&str>)?;
                let separator = PredefinedMenuItem::separator(app)?;
                let quit = MenuItem::with_id(app, "quit", "Quit Iris", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&ask, &history, &separator, &quit])?;

                TrayIconBuilder::new()
                    .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                    .icon_as_template(true)
                    .menu(&menu)
                    .show_menu_on_left_click(true)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "ask" => {
                            if let Err(error) = crate::sys::overlay::show(app) {
                                log::error!("Failed to show Iris from the tray: {error}");
                            }
                        }
                        "history" => {
                            crate::tauri_commands::app::show_main_window(app.clone());
                        }
                        "quit" => {
                            QUITTING.store(true, Ordering::SeqCst);
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .build(app)?;

                log::info!("Created the Iris menu bar item");
                Ok(())
            })();

            if let Err(error) = tray {
                log::warn!("Could not create the Iris menu bar item: {error}");
            }

            log::info!(
                "Iris {} started on {}",
                app.package_info().version,
                sys::platform::name()
            );
            Ok(())
        })
        // Closing the history window hides it; Iris keeps running in the overlay.
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            tauri_commands::app::get_app_info,
            tauri_commands::app::show_main_window,
            tauri_commands::app::restart_app,
            tauri_commands::chat::send_message,
            tauri_commands::chat::cancel_generation,
            tauri_commands::overlay::overlay_ready,
            tauri_commands::overlay::show_overlay,
            tauri_commands::overlay::hide_overlay,
            tauri_commands::overlay::toggle_overlay,
            tauri_commands::overlay::resize_overlay,
            tauri_commands::screen::get_screen_capture_permission,
            tauri_commands::screen::request_screen_capture_permission,
            tauri_commands::screen::open_screen_capture_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Iris")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                let window_visible = ["overlay", "main"].iter().any(|label| {
                    app.get_webview_window(label)
                        .and_then(|window| window.is_visible().ok())
                        .unwrap_or(false)
                });

                // Cmd+Q works while Iris is on screen; hiding it keeps Iris in the menu bar.
                if !QUITTING.load(Ordering::SeqCst) && !window_visible {
                    api.prevent_exit();
                    log::debug!("Kept Iris running in the menu bar");
                }
            }

            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                if let Err(error) = crate::sys::overlay::show(app) {
                    log::error!("Failed to reopen the Iris overlay: {error}");
                }
            }

            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
