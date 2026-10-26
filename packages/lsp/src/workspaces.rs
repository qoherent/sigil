//! The workspaces one server holds, and the rule that picks the one that owns
//! a file.
//!
//! A file belongs to the workspace of the nearest directory above it that
//! holds a workspace config. The workspace the editor started in stays loaded.
//! Any other workspace is held while one of its files is open.
use crate::snapshot::Snapshot;
use sigil_core::language::{path::normalize_path, workspace::CONFIG_PATH};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::Instant,
};

/// One workspace's reading and what its last load did.
#[derive(Debug)]
pub struct Entry {
    /// Where discovery starts when this workspace is read.
    pub start: PathBuf,
    /// None until the first read, and after a failed one.
    pub snapshot: Option<Snapshot>,
    pub load_failure: Option<String>,
    /// How long a failed recovery blocks the next attempt.
    pub retry_after: Option<Instant>,
}

impl Entry {
    fn new(start: PathBuf) -> Self {
        Self {
            start,
            snapshot: None,
            load_failure: None,
            retry_after: None,
        }
    }
}

/// The held workspaces by root key, and which one the editor started in.
#[derive(Debug)]
pub struct Workspaces {
    /// Where the editor started, kept so the start workspace can be found
    /// again when a config appears or goes away.
    start_dir: PathBuf,
    start_key: String,
    entries: BTreeMap<String, Entry>,
}

impl Workspaces {
    /// Hold the workspace found from `start`, not yet read.
    pub fn new(start: &Path) -> Self {
        let start_key = start_key(start);
        let mut entries = BTreeMap::new();
        entries.insert(start_key.clone(), Entry::new(start.to_path_buf()));
        Self {
            start_dir: start.to_path_buf(),
            start_key,
            entries,
        }
    }

    /// Find the start workspace again. A config that appeared or went away may
    /// have changed which workspace the start folder belongs to, and its entry
    /// must read the workspace it is keyed by. The reading of the old start
    /// workspace is dropped; it comes back when an open buffer still needs it.
    pub fn rekey_start(&mut self) {
        let key = start_key(&self.start_dir);
        if key == self.start_key {
            return;
        }
        self.entries.remove(&self.start_key);
        self.entries
            .entry(key.clone())
            .or_insert_with(|| Entry::new(self.start_dir.clone()));
        self.start_key = key;
    }

    pub fn start_key(&self) -> &str {
        &self.start_key
    }

    pub fn start(&self) -> Option<&Entry> {
        self.entries.get(&self.start_key)
    }

    pub fn get(&self, key: &str) -> Option<&Entry> {
        self.entries.get(key)
    }

    pub fn get_mut(&mut self, key: &str) -> Option<&mut Entry> {
        self.entries.get_mut(key)
    }

    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.entries.keys()
    }

    pub fn snapshots(&self) -> impl Iterator<Item = (&String, &Snapshot)> {
        self.entries
            .iter()
            .filter_map(|(key, entry)| Some((key, entry.snapshot.as_ref()?)))
    }

    /// Hold the workspace at `key` when it is not held. True when it was added.
    pub fn ensure(&mut self, key: &str) -> bool {
        if self.entries.contains_key(key) {
            return false;
        }
        self.entries
            .insert(key.to_owned(), Entry::new(PathBuf::from(key)));
        true
    }

    /// Release every workspace that `keep` does not name, except the start one.
    pub fn retain(&mut self, keep: impl Fn(&str) -> bool) {
        let start = &self.start_key;
        self.entries.retain(|key, _| key == start || keep(key));
    }

    /// How many workspaces are held, the start one included.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// A workspace root as the key of its entry and as a snapshot names its root:
/// normalized, `/`-separated, with no trailing slash.
fn root_key(root: &Path) -> String {
    let text = normalize_path(&root.to_string_lossy());
    if text == "/" {
        text
    } else {
        text.trim_end_matches('/').to_owned()
    }
}

/// The nearest directory at or above `dir` that holds a workspace config.
fn nearest_config_root(dir: &Path) -> Option<PathBuf> {
    dir.ancestors()
        .find(|ancestor| ancestor.join(CONFIG_PATH).is_file())
        .map(Path::to_path_buf)
}

/// The key of the workspace that owns the file at `path`, or none when no
/// config sits above it.
pub fn owner_key(path: &str) -> Option<String> {
    let dir = Path::new(path).parent()?;
    nearest_config_root(dir).map(|root| root_key(&root))
}

/// The key of the workspace found from the start directory: the nearest config
/// above it, else the directory itself.
fn start_key(start: &Path) -> String {
    let start = std::path::absolute(start).unwrap_or_else(|_| start.to_path_buf());
    let start = PathBuf::from(normalize_path(&start.to_string_lossy()));
    root_key(&nearest_config_root(&start).unwrap_or(start))
}

/// The root a config, glossary or local override path belongs to, or none for
/// any other path.
pub fn context_root(path: &str) -> Option<String> {
    const CONTEXT_FILES: [&str; 3] = ["config.json", "glossary.json", "local.json"];
    let path = normalize_path(path);
    CONTEXT_FILES.iter().find_map(|name| {
        let suffix = format!("/.sigil/{name}");
        path.strip_suffix(&suffix).map(str::to_owned)
    })
}
