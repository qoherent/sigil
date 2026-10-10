//! Cleanup of disposable caches left in a store.
use std::{fs, path::Path};

pub fn clean(root: &Path) -> Result<Vec<String>, String> {
    clean_in(root, &root.join(".sigil"))
}

/// Remove generated worlds and trees, preserving claims readings and config.
// @sigil implements packages/sigilc/store.sigil::SigilProjectionStore::DisposableCleanup interface
pub fn clean_in(root: &Path, store: &Path) -> Result<Vec<String>, String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    match fs::symlink_metadata(store) {
        Ok(meta) if meta.file_type().is_symlink() => {
            return Err(format!("symlink path is not allowed: {}", store.display()));
        }
        Ok(_) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(error.to_string()),
    }
    let store = store.canonicalize().map_err(|error| error.to_string())?;
    let label = store
        .strip_prefix(&root)
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| store.display().to_string());
    let mut removed = Vec::new();
    for name in ["worlds", "trees"] {
        let path = store.join(name);
        match fs::symlink_metadata(&path) {
            Ok(meta) => {
                // Remove symlinks themselves; never resolve a cache's target.
                if meta.is_dir() {
                    fs::remove_dir_all(&path)
                } else {
                    fs::remove_file(&path)
                }
                .map_err(|error| error.to_string())?;
                removed.push(format!("{label}/{name}"));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.to_string()),
        }
    }
    removed.sort();
    Ok(removed)
}
