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
    // Must run before the runtime (and its webviews) opens the identifier-keyed data folders.
    crate::core::legacy::migrate_legacy_identifier();

    let builder = tauri::Builder::default()
        // A second launch summons the quick chat instead of starting another app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Err(error) = crate::sys::overlay::show(app) {
                log::error!("Failed to show Iris from a second launch: {error}");
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // The overlay, canvas, capture, and preview are positioned and sized by Iris.
                .with_denylist(&["overlay", "canvas", "capture", "preview"])
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
        );

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .setup(|app| {
            app.manage(GenerationState::default());
            app.manage(crate::core::agent::SummaryCache::default());
            app.manage(crate::sys::overlay::OverlayPosition::load(app.handle()));
            crate::sys::menu::remove_close_window_items(app.handle());
            app.manage(crate::sys::speech::SpeechState::default());
            app.manage(crate::tauri_commands::preview::PreviewState::default());
            let storage =
                crate::core::storage::Storage::open(app.handle()).map_err(std::io::Error::other)?;
            app.manage(storage);

            #[cfg(target_os = "macos")]
            if let Err(error) = crate::sys::overlay::setup_panels(app.handle()) {
                log::error!("Could not convert the Iris windows to non-activating panels: {error}");
            }

            // One global shortcut summons Iris. The default is registered below; the recorder in
            // Settings replaces it at runtime with the user's choice.
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

            let default_shortcut = crate::tauri_commands::shortcut::DEFAULT_OPEN_SHORTCUT;
            let registered = match app.global_shortcut().register(default_shortcut) {
                Ok(()) => {
                    log::info!("Registered global shortcut {default_shortcut}");
                    true
                }
                Err(error) => {
                    log::warn!("Could not register global shortcut {default_shortcut}: {error}");
                    false
                }
            };
            app.manage(crate::tauri_commands::shortcut::ShortcutState::new(
                registered.then(|| default_shortcut.to_string()),
            ));
            // The menu bar is how Iris is reached when both windows are hidden.
            let tray = (|| -> tauri::Result<()> {
                let ask = MenuItem::with_id(app, "ask", "Ask Iris", true, None::<&str>)?;
                let history = MenuItem::with_id(app, "history", "History", true, None::<&str>)?;
                let separator = PredefinedMenuItem::separator(app)?;
                let quit = MenuItem::with_id(app, "quit", "Quit Iris", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&ask, &history, &separator, &quit])?;

                TrayIconBuilder::new()
                    .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                    // The tray keeps the avatar's colour so it matches the app icon instead of
                    // being recoloured as a monochrome template.
                    .icon_as_template(false)
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
            if window.label() == crate::sys::overlay::OVERLAY_LABEL {
                if let tauri::WindowEvent::Moved(position) = event {
                    if let Ok(size) = window.outer_size() {
                        crate::sys::overlay::record_move(window.app_handle(), *position, size);
                    }
                }
            }

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
            tauri_commands::app::hide_main_window,
            tauri_commands::app::reload_app_windows,
            tauri_commands::app::reset_app_data,
            tauri_commands::attachments::attachment_data_url,
            tauri_commands::attachments::attachment_path,
            tauri_commands::attachments::copy_attachment,
            tauri_commands::attachments::delete_attachment_files,
            tauri_commands::attachments::store_attachment,
            tauri_commands::chat::send_message,
            tauri_commands::files::upload_document,
            tauri_commands::chat::generate_conversation_title,
            tauri_commands::chat::cancel_generation,
            tauri_commands::credentials::has_api_key,
            tauri_commands::credentials::remove_api_key,
            tauri_commands::credentials::save_api_key,
            tauri_commands::models::list_models,
            tauri_commands::overlay::overlay_ready,
            tauri_commands::overlay::show_overlay,
            tauri_commands::overlay::hide_overlay,
            tauri_commands::overlay::toggle_overlay,
            tauri_commands::overlay::resize_overlay,
            tauri_commands::preview::show_image_preview,
            tauri_commands::preview::close_image_preview,
            tauri_commands::preview::copy_preview_image,
            tauri_commands::preview::save_preview_image,
            tauri_commands::screen::start_screen_capture,
            tauri_commands::screen::capture_annotated_screen,
            tauri_commands::screen::close_screen_capture,
            tauri_commands::screen::get_screen_capture_permission,
            tauri_commands::screen::request_screen_capture_permission,
            tauri_commands::screen::open_screen_capture_settings,
            tauri_commands::shortcut::set_open_shortcut,
            tauri_commands::storage::load_conversations,
            tauri_commands::storage::load_message_page,
            tauri_commands::storage::search_history,
            tauri_commands::storage::save_conversation_meta,
            tauri_commands::storage::save_message,
            tauri_commands::storage::delete_messages,
            tauri_commands::storage::quick_conversation_id,
            tauri_commands::storage::set_quick_conversation_id,
            tauri_commands::storage::save_conversation,
            tauri_commands::storage::save_conversations,
            tauri_commands::storage::delete_conversation,
            tauri_commands::storage::clear_conversations,
            tauri_commands::theme::set_main_window_theme,
            tauri_commands::voice::stop_speaking,
            tauri_commands::voice::speak_text,
            tauri_commands::voice::transcribe_audio,
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

            if let tauri::RunEvent::Exit = &event {
                crate::sys::speech::stop(app);
                crate::sys::overlay::persist_position(app);
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
