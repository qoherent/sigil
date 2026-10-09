//! The disposable tree cache under `.sigil/trees` (KTD10).
//!
//! Layout: `parse/<key>.json`, `resolved/<id>.json`, and one pointer per
//! source in `sources/<hash of path>.json` naming its current and previous
//! entries. Anything unreadable, truncated, or from another format version is
//! a miss, and the caller rebuilds silently. Writes are best effort: a failed
//! write loses only time.
use super::{ParseTree, Resolution, ResolvedTree, TREE_FORMAT, ids::Fields};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CacheStats {
    pub parse_hits: usize,
    pub parse_misses: usize,
    pub resolved_hits: usize,
    pub resolved_misses: usize,
}

impl CacheStats {
    pub fn since(self, earlier: CacheStats) -> CacheStats {
        CacheStats {
            parse_hits: self.parse_hits - earlier.parse_hits,
            parse_misses: self.parse_misses - earlier.parse_misses,
            resolved_hits: self.resolved_hits - earlier.resolved_hits,
            resolved_misses: self.resolved_misses - earlier.resolved_misses,
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Entry<T> {
    format: u32,
    key: String,
    value: T,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    pub parse: String,
    pub resolved: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pointer {
    format: u32,
    path: String,
    current: Slot,
    previous: Option<Slot>,
}

#[derive(Debug, Default)]
pub struct TreeCache {
    dir: Option<PathBuf>,
    pub stats: CacheStats,
}

fn safe(key: &str) -> bool {
    !key.is_empty() && key.bytes().all(|b| b.is_ascii_hexdigit())
}

impl TreeCache {
    pub fn new(dir: &Path) -> Self {
        Self {
            dir: Some(dir.to_owned()),
            stats: CacheStats::default(),
        }
    }

    /// A cache that stores nothing; every lookup misses.
    pub fn disabled() -> Self {
        Self::default()
    }

    fn file(&self, kind: &str, key: &str) -> Option<PathBuf> {
        safe(key)
            .then(|| {
                self.dir
                    .as_ref()
                    .map(|d| d.join(kind).join(format!("{key}.json")))
            })
            .flatten()
    }

    fn read<T: DeserializeOwned>(&self, kind: &str, key: &str) -> Option<T> {
        let bytes = fs::read(self.file(kind, key)?).ok()?;
        let entry: Entry<T> = serde_json::from_slice(&bytes).ok()?;
        (entry.format == TREE_FORMAT && entry.key == key).then_some(entry.value)
    }

    fn write<T: Serialize>(&self, kind: &str, key: &str, value: &T) {
        let Some(target) = self.file(kind, key) else {
            return;
        };
        let entry = Entry {
            format: TREE_FORMAT,
            key: key.to_owned(),
            value,
        };
        if let Ok(bytes) = serde_json::to_vec(&entry) {
            let _ = atomic_write(&target, &bytes);
        }
    }

    pub fn load_parse(&mut self, key: &str) -> Option<ParseTree> {
        let found = self
            .read::<ParseTree>("parse", key)
            .filter(|t| t.key == key && t.format == TREE_FORMAT);
        if found.is_some() {
            self.stats.parse_hits += 1;
        } else {
            self.stats.parse_misses += 1;
        }
        found
    }

    pub fn store_parse(&self, tree: &ParseTree) {
        self.write("parse", &tree.key, tree);
    }

    pub fn load_resolved(&mut self, id: &str) -> Option<Resolution> {
        let found = self.read::<Resolution>("resolved", id);
        if found.is_some() {
            self.stats.resolved_hits += 1;
        } else {
            self.stats.resolved_misses += 1;
        }
        found
    }

    pub fn store_resolved(&self, id: &str, resolution: &Resolution) {
        self.write("resolved", id, resolution);
    }

    fn pointer_file(&self, path: &str) -> Option<PathBuf> {
        let name = Fields::new("pointer/v1").str(path).finish();
        self.file("sources", &name)
    }

    fn pointer(&self, path: &str) -> Option<Pointer> {
        let bytes = fs::read(self.pointer_file(path)?).ok()?;
        let pointer: Pointer = serde_json::from_slice(&bytes).ok()?;
        (pointer.format == TREE_FORMAT && pointer.path == path).then_some(pointer)
    }

    /// Note a source's current tree. When it changed, the old current becomes
    /// the previous one and the entries two generations back are removed.
    pub fn record(&self, path: &str, parse: &str, resolved: &str) {
        let Some(file) = self.pointer_file(path) else {
            return;
        };
        let slot = Slot {
            parse: parse.to_owned(),
            resolved: resolved.to_owned(),
        };
        let existing = self.pointer(path);
        if existing.as_ref().is_some_and(|p| p.current == slot) {
            return;
        }
        let dropped = existing.as_ref().and_then(|p| p.previous.clone());
        let pointer = Pointer {
            format: TREE_FORMAT,
            path: path.to_owned(),
            previous: existing.map(|p| p.current),
            current: slot,
        };
        if let Ok(bytes) = serde_json::to_vec(&pointer)
            && atomic_write(&file, &bytes).is_ok()
            && let Some(old) = dropped
        {
            let keep = |k: &str| {
                [Some(&pointer.current), pointer.previous.as_ref()]
                    .into_iter()
                    .flatten()
                    .any(|s| s.parse == k || s.resolved == k)
            };
            if !keep(&old.parse)
                && let Some(f) = self.file("parse", &old.parse)
            {
                let _ = fs::remove_file(f);
            }
            if !keep(&old.resolved)
                && let Some(f) = self.file("resolved", &old.resolved)
            {
                let _ = fs::remove_file(f);
            }
        }
    }

    /// The tree a source had before its current one, when both entries survive.
    pub fn previous(&self, path: &str) -> Option<ResolvedTree> {
        let slot = self.pointer(path)?.previous?;
        let parse = self.read::<ParseTree>("parse", &slot.parse)?;
        let resolution = self.read::<Resolution>("resolved", &slot.resolved)?;
        Some(ResolvedTree {
            id: slot.resolved,
            parse,
            resolution,
        })
    }
}

fn atomic_write(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    fs::create_dir_all(target.parent().expect("a cache file has a parent"))?;
    let mut name = target.file_name().expect("a file name").to_owned();
    // The process id keeps concurrent writers (an editor and the CLI) on
    // separate temporary files, so one cannot publish the other's partial write.
    name.push(format!(".tmp{}", std::process::id()));
    let temporary = target.with_file_name(name);
    let _ = fs::remove_file(&temporary);
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(temporary, target)
}
