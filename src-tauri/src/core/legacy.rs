use std::path::Path;

/// Old bundle identifier. macOS keys Application Support and WebKit storage by it; renaming the
/// identifier would otherwise hide existing chats and settings.
const LEGACY_IDENTIFIER: &str = "com.iris.app";

/// Current bundle identifier. Must match `tauri.conf.json`.
const IDENTIFIER: &str = "com.iris.desktop";

/// One-time copy of the old identifier's data into the new locations. Runs before the Tauri
/// runtime starts so the webviews open the migrated WebKit store, and before `Storage::open`.
pub fn migrate_legacy_identifier() {
    // Development builds use their own identifier; never touch the installed app's data.
    if cfg!(debug_assertions) {
        return;
    }

    let Some(home) = std::env::var_os("HOME") else {
        return;
    };
    migrate(Path::new(&home));
}

/// Removes the pre-rename copies so a reset leaves no old conversations behind.
pub fn remove_legacy_data() {
    // Development builds must never delete the installed app's legacy backup.
    if cfg!(debug_assertions) {
        return;
    }

    let Some(home) = std::env::var_os("HOME") else {
        return;
    };

    let library = Path::new(&home).join("Library");
    for folder in ["Application Support", "WebKit"] {
        let path = library.join(folder).join(LEGACY_IDENTIFIER);
        if !path.is_dir() {
            continue;
        }

        if let Err(error) = std::fs::remove_dir_all(&path) {
            eprintln!("iris: could not remove {folder}/{LEGACY_IDENTIFIER}: {error}");
        }
    }
}

fn migrate(home: &Path) {
    let library = home.join("Library");

    for folder in ["Application Support", "WebKit"] {
        let from = library.join(folder).join(LEGACY_IDENTIFIER);
        let to = library.join(folder).join(IDENTIFIER);

        if !from.is_dir() || to.exists() {
            continue;
        }

        if let Err(error) = copy_dir(&from, &to) {
            eprintln!(
                "iris: could not migrate {folder}/{LEGACY_IDENTIFIER} to {IDENTIFIER}: {error}"
            );
        }
    }
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;

    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let source = entry.path();
        let target = to.join(entry.file_name());

        if entry.file_type()?.is_dir() {
            copy_dir(&source, &target)?;
        } else {
            std::fs::copy(&source, &target)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{migrate, IDENTIFIER, LEGACY_IDENTIFIER};

    fn sandbox() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "iris-legacy-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn copies_the_old_identifier_data_once() {
        let home = sandbox();
        let library = home.join("Library");

        let support = library.join("Application Support").join(LEGACY_IDENTIFIER);
        std::fs::create_dir_all(&support).unwrap();
        std::fs::write(support.join("iris.db"), b"chats").unwrap();

        let storage = library
            .join("WebKit")
            .join(LEGACY_IDENTIFIER)
            .join("WebsiteData/LocalStorage");
        std::fs::create_dir_all(&storage).unwrap();
        std::fs::write(storage.join("localstorage.sqlite3"), b"settings").unwrap();

        migrate(&home);

        let migrated_db = library
            .join("Application Support")
            .join(IDENTIFIER)
            .join("iris.db");
        assert_eq!(std::fs::read(&migrated_db).unwrap(), b"chats");

        let migrated_storage = library
            .join("WebKit")
            .join(IDENTIFIER)
            .join("WebsiteData/LocalStorage/localstorage.sqlite3");
        assert_eq!(std::fs::read(&migrated_storage).unwrap(), b"settings");

        // A later launch keeps the migrated copy instead of overwriting it.
        std::fs::write(&migrated_db, b"newer").unwrap();
        migrate(&home);
        assert_eq!(std::fs::read(&migrated_db).unwrap(), b"newer");

        let _ = std::fs::remove_dir_all(&home);
    }
}
