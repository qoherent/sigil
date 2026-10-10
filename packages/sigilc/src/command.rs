//! Shared deterministic command helpers.
use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
};

pub type Output = Result<(u8, String), (u8, String)>;

/// Where disposable state lives: `--store DIR`, else `<root>/.sigil`.
pub fn store_dir(root: &Path, store: Option<&str>) -> PathBuf {
    store.map_or_else(|| root.join(".sigil"), PathBuf::from)
}

pub fn read(path: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
    let reader: Box<dyn Read> = if path == "-" {
        Box::new(io::stdin())
    } else {
        Box::new(fs::File::open(path).map_err(|e| format!("read {path}: {e}"))?)
    };
    let mut bytes = Vec::new();
    reader
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!("input exceeds byte limit: {path}"));
    }
    Ok(bytes)
}

/// Serialize a deterministic command response with its exit code.
pub fn json(code: u8, value: &impl serde::Serialize) -> Output {
    Ok((
        code,
        serde_json::to_string_pretty(value).map_err(|error| (3, error.to_string()))? + "\n",
    ))
}
