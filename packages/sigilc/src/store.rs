//! Small disposable index and atomic per-source publication. No external-work registry.
use crate::{
    assertions,
    inputs::{Binding, SemanticInput},
    sources::{self, hash},
    structure::normalized_path,
    turtle::{Assertion, TurtleLimits},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

/// Paths inside the store directory, which is `<root>/.sigil` unless `--store` moves it.
const WORLDS: &str = "worlds";
const INDEX: &str = "worlds/index.json";
const TREES: &str = "trees";
const INDEX_VERSION: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedBinding {
    pub version: u32,
    pub binding: Binding,
    pub expected_generation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub binding: Binding,
    pub assertion_checksum: String,
    pub generation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Index {
    version: u32,
    entries: BTreeMap<String, Entry>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Freshness {
    Fresh,
    Missing,
    Modified,
    DependencyInvalidated,
    EntityCatalogInvalidated,
    Incompatible,
    Incomplete,
    Deleted,
    /// The source, or a source it imports, has errors, so nothing was read.
    Invalid,
}

#[derive(Debug)]
pub struct Inspection {
    pub status: Freshness,
    pub assertions: Vec<Assertion>,
}

#[derive(Clone, Copy)]
pub struct StoreLimits {
    pub max_index_bytes: u64,
    pub max_source_bytes: u64,
    pub assertions: TurtleLimits,
}
impl Default for StoreLimits {
    fn default() -> Self {
        Self {
            max_index_bytes: 16_000_000,
            max_source_bytes: 16_000_000,
            assertions: TurtleLimits {
                max_document_bytes: 8_000_000,
                max_assertions: 100_000,
            },
        }
    }
}

/// Owns the exclusive lock until dropped. Host code computes current Design and
/// catalog bindings inside this lifetime before preparing or publishing.
pub struct LockedStore {
    /// The workspace root: where the authored and implementation sources are read.
    root: PathBuf,
    /// The store directory: where the projections and their index live.
    store: PathBuf,
    _lock: File,
    index: Index,
    limits: StoreLimits,
}

impl LockedStore {
    /// Open the store at its default place, `<root>/.sigil`.
    pub fn open(root: &Path, limits: StoreLimits) -> Result<Self, String> {
        Self::open_in(root, &root.join(".sigil"), limits)
    }

    /// Open the store in `store`, while the sources are read from `root`.
    pub fn open_in(root: &Path, store: &Path, limits: StoreLimits) -> Result<Self, String> {
        let (root, store, lock) = acquire(root, store)?;
        let index = match fs::symlink_metadata(sources::checked_path(&store, INDEX)?) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Index {
                version: INDEX_VERSION,
                entries: BTreeMap::new(),
            },
            Err(e) => return Err(e.to_string()),
            Ok(_) => parse_index(&sources::capture(&store, INDEX, limits.max_index_bytes)?.bytes)
                .map_err(|e| format!("invalid projection index: {e}"))?,
        };
        if index.version != INDEX_VERSION {
            return Err("unsupported projection index version".into());
        }
        for (key, entry) in &index.entries {
            let object = object_key(&entry.binding)?;
            // An entry of an older projection format keeps its key but not its
            // fingerprint, which only the current layout can reproduce.
            let keyed = if entry.binding.projection_format == crate::inputs::PROJECTION_FORMAT {
                *key == object || *key == history_key(&entry.binding)?
            } else {
                *key == object || key.starts_with(&format!("{object}~"))
            };
            if !keyed || !checksum(&entry.generation) || !checksum(&entry.assertion_checksum) {
                return Err(format!("invalid projection index entry: {key}"));
            }
        }
        Ok(Self {
            root,
            store,
            _lock: lock,
            index,
            limits,
        })
    }

    pub fn entries(&self) -> &BTreeMap<String, Entry> {
        &self.index.entries
    }

    pub fn deleted_sources(
        &self,
        side: &str,
        selected: &std::collections::BTreeSet<&str>,
    ) -> Result<Vec<String>, String> {
        let mut deleted = std::collections::BTreeSet::new();
        for entry in self.index.entries.values() {
            let path = &entry.binding.source.path;
            if entry.binding.side() != side || selected.contains(path.as_str()) {
                continue;
            }
            match fs::symlink_metadata(sources::checked_path(&self.root, path)?) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    deleted.insert(path.clone());
                }
                Err(e) => return Err(e.to_string()),
                Ok(_) => (),
            }
        }
        Ok(deleted.into_iter().collect())
    }

    /// Return a descriptor to the external caller before it supplies Turtle.
    pub fn prepare(&self, binding: Binding) -> Result<PreparedBinding, String> {
        compatible(&binding)?;
        self.check_live(&binding)?;
        let expected_generation = self
            .entry_for(&binding)
            .map(|(_, entry)| entry.generation.clone());
        Ok(PreparedBinding {
            version: 2,
            binding,
            expected_generation,
        })
    }

    // @sigil implements packages/sigilc/store.sigil::SigilProjectionStore::ProjectionPublication interface
    pub fn publish(
        &mut self,
        prepared: &PreparedBinding,
        current: &Binding,
        facts: &[Assertion],
    ) -> Result<String, String> {
        compatible(current)?;
        let key = object_key(current)?;
        if prepared.version != 2 || prepared.binding != *current {
            return Err(format!(
                "prepared semantic inputs no longer match current inputs: {} moved",
                crate::inputs::moved(&prepared.binding, current)
            ));
        }
        if self
            .entry_for(current)
            .map(|(_, entry)| entry.generation.as_str())
            != prepared.expected_generation.as_deref()
        {
            return Err("projection generation changed; prepare a new binding".into());
        }
        self.check_live(current)?;
        if facts.len() > self.limits.assertions.max_assertions {
            return Err("projection assertion count exceeds limit".into());
        }
        let encoded = assertions::encode(facts)?;
        if encoded.len() > self.limits.assertions.max_document_bytes {
            return Err("encoded projection exceeds byte limit".into());
        }
        let mut nonce = [0u8; 32];
        getrandom::fill(&mut nonce).map_err(|e| e.to_string())?;
        let generation = hash(&nonce);
        let mut proposed = self.index.clone();
        if let Some(previous) = proposed.entries.get(&key).cloned()
            && previous.binding != *current
        {
            let previous_key = history_key(&previous.binding)?;
            preserve_projection(&self.store, &key, &previous_key, self.limits)?;
            proposed.entries.insert(previous_key, previous);
            proposed.entries.remove(&key);
        }
        proposed.entries.insert(
            key.clone(),
            Entry {
                binding: current.clone(),
                assertion_checksum: hash(encoded.as_bytes()),
                generation: generation.clone(),
            },
        );
        let data = serde_json::to_vec(&proposed).map_err(|e| e.to_string())?;
        if data.len() as u64 > self.limits.max_index_bytes {
            return Err("projection index exceeds byte limit".into());
        }
        // A crash between replacements leaves a detectable checksum mismatch or
        // orphan. Failed publication never becomes current in this handle either.
        atomic_write(
            &self.store,
            &format!("{WORLDS}/{key}.egg"),
            encoded.as_bytes(),
        )?;
        atomic_write(&self.store, INDEX, &data)?;
        self.index = proposed;
        Ok(generation)
    }

    // @sigil implements packages/sigilc/store.sigil::SigilProjectionStore::IndexedAssembly interface
    pub fn inspect(&self, current: &Binding) -> Result<Inspection, String> {
        compatible(current)?;
        let Some((key, entry)) = self.entry_for(current) else {
            let key = object_key(current)?;
            let Some(entry) = self.index.entries.get(&key) else {
                return Ok(inspected(Freshness::Missing));
            };
            return Ok(inspected(freshness(&entry.binding, current)));
        };
        let status = freshness(&entry.binding, current);
        if status != Freshness::Fresh {
            return Ok(inspected(status));
        }
        let path = format!("{WORLDS}/{key}.egg");
        match fs::symlink_metadata(sources::checked_path(&self.store, &path)?) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(inspected(Freshness::Incomplete));
            }
            Err(e) => return Err(e.to_string()),
            Ok(meta) if !meta.is_file() => return Err("projection is not a regular file".into()),
            _ => (),
        }
        let captured = sources::capture(
            &self.store,
            &path,
            self.limits.assertions.max_document_bytes as u64,
        )?;
        if captured.identity.checksum != entry.assertion_checksum {
            return Ok(inspected(Freshness::Incomplete));
        }
        let Ok(source) = std::str::from_utf8(&captured.bytes) else {
            return Ok(inspected(Freshness::Incomplete));
        };
        match assertions::parse(source, self.limits.assertions) {
            Ok(assertions) => Ok(Inspection {
                status: Freshness::Fresh,
                assertions,
            }),
            Err(_) => Ok(inspected(Freshness::Incomplete)),
        }
    }

    // @sigil implements packages/sigilc/store.sigil::SigilProjectionStore::BindingHistory interface
    fn entry_for(&self, binding: &Binding) -> Option<(String, &Entry)> {
        let key = object_key(binding).ok()?;
        if let Some(entry) = self.index.entries.get(&key)
            && entry.binding == *binding
        {
            return Some((key, entry));
        }
        let history = history_key(binding).ok()?;
        self.index
            .entries
            .get(&history)
            .filter(|entry| entry.binding == *binding)
            .map(|entry| (history, entry))
    }

    /// A binding is live while what it recorded still holds on disk. An
    /// Implementation source is read again byte for byte. A Design source is
    /// read through its trees again, and only the source's content identity and
    /// the interface hashes it imports (and the context) are compared, so the
    /// failure names the field that moved.
    fn check_live(&self, binding: &Binding) -> Result<(), String> {
        if matches!(binding.semantic, SemanticInput::Design { .. }) {
            let live = crate::tree::design_input::load_basis(&self.root, &self.store)?
                .binding(&binding.source.path)
                .map_err(|e| format!("source input changed: {e}"))?;
            if live != *binding {
                return Err(format!(
                    "prepared semantic inputs no longer match current inputs: {} moved",
                    crate::inputs::moved(binding, &live)
                ));
            }
            return Ok(());
        }
        let current = sources::capture(
            &self.root,
            &binding.source.path,
            self.limits.max_source_bytes,
        )?;
        if current.identity.checksum != binding.source.checksum {
            return Err(format!("source input changed: {}", binding.source.path));
        }
        Ok(())
    }
}

// @sigil implements packages/sigilc/store.sigil::SigilProjectionStore::DisposableCleanup interface
pub fn clean(root: &Path) -> Result<Vec<String>, String> {
    clean_in(root, &root.join(".sigil"))
}

/// Remove the disposable state in `store`: projections and the tree cache.
pub fn clean_in(root: &Path, store: &Path) -> Result<Vec<String>, String> {
    let (root, store, _lock) = acquire(root, store)?;
    // Report paths the way the caller can read them: under the workspace root
    // when the store sits there, otherwise under the store directory itself.
    let label = store
        .strip_prefix(&root)
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| store.display().to_string());
    let mut removed = Vec::new();
    for entry in fs::read_dir(sources::checked_path(&store, WORLDS)?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_name() == ".lock" {
            continue;
        }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        // read_dir's file type does not follow symlinks. Never resolve a cache
        // entry's target; recursive removal also leaves symlink targets intact.
        if kind.is_dir() {
            fs::remove_dir_all(entry.path())
        } else {
            fs::remove_file(entry.path())
        }
        .map_err(|e| e.to_string())?;
        removed.push(format!(
            "{label}/{WORLDS}/{}",
            entry.file_name().to_string_lossy()
        ));
    }
    // The tree cache is disposable too; `trees` is only ever a directory.
    let trees = sources::checked_path(&store, TREES)?;
    if fs::symlink_metadata(&trees).is_ok_and(|m| m.is_dir()) {
        fs::remove_dir_all(&trees).map_err(|e| e.to_string())?;
        removed.push(format!("{label}/{TREES}"));
    }
    removed.sort();
    Ok(removed)
}

/// The workspace root and the store directory, canonical, with the store locked.
fn acquire(root: &Path, store: &Path) -> Result<(PathBuf, PathBuf, File), String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if fs::symlink_metadata(store).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(format!("symlink path is not allowed: {}", store.display()));
    }
    fs::create_dir_all(store.join(WORLDS)).map_err(|e| e.to_string())?;
    let store = store.canonicalize().map_err(|e| e.to_string())?;
    let path = sources::checked_path(&store, &format!("{WORLDS}/.lock"))?;
    regular_or_absent(&path)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    lock.try_lock()
        .map_err(|e| format!("projection store lock unavailable: {e}"))?;
    Ok((root, store, lock))
}

fn parse_index(bytes: &[u8]) -> Result<Index, String> {
    let mut value: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    // A Design binding of an older projection format has other semantic fields.
    // Keep it readable so it reports `incompatible` instead of failing the open.
    let current = u64::from(crate::inputs::PROJECTION_FORMAT);
    if let Some(entries) = value.get_mut("entries").and_then(|e| e.as_object_mut()) {
        for entry in entries.values_mut() {
            let Some(binding) = entry.get_mut("binding") else {
                continue;
            };
            if binding["projection_format"].as_u64() == Some(current) {
                continue;
            }
            if let Some(semantic) = binding.get_mut("semantic").and_then(|s| s.as_object_mut())
                && semantic.get("side").and_then(|s| s.as_str()) == Some("design")
            {
                semantic.remove("dependencies");
                // The reader version used to be recorded as `frontend_version`.
                if let Some(version) = semantic.remove("frontend_version") {
                    semantic.entry("reader_version").or_insert(version);
                }
                semantic
                    .entry("imports")
                    .or_insert_with(|| serde_json::json!([]));
            }
        }
    }
    serde_json::from_value(value).map_err(|e| e.to_string())
}

fn inspected(status: Freshness) -> Inspection {
    Inspection {
        status,
        assertions: vec![],
    }
}

fn object_key(binding: &Binding) -> Result<String, String> {
    normalized_path(&binding.source.path)?;
    Ok(format!("{}/{}", binding.side(), binding.source.path))
}

fn history_key(binding: &Binding) -> Result<String, String> {
    Ok(format!(
        "{}~{}",
        object_key(binding)?,
        binding.fingerprint()
    ))
}

fn preserve_projection(
    root: &Path,
    current_key: &str,
    history_key: &str,
    limits: StoreLimits,
) -> Result<(), String> {
    let current = format!("{WORLDS}/{current_key}.egg");
    let history = format!("{WORLDS}/{history_key}.egg");
    let current_path = sources::checked_path(root, &current)?;
    if !regular_or_absent(&current_path)? {
        return Ok(());
    }
    let captured = sources::capture(root, &current, limits.assertions.max_document_bytes as u64)?;
    atomic_write(root, &history, &captured.bytes)
}

fn checksum(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn compatible(binding: &Binding) -> Result<(), String> {
    if binding.ontology != crate::turtle::ontology_fingerprint()
        || binding.projection_format != crate::inputs::PROJECTION_FORMAT
    {
        return Err("incompatible ontology or projection format".into());
    }
    Ok(())
}

fn freshness(previous: &Binding, current: &Binding) -> Freshness {
    if previous.ontology != current.ontology
        || previous.projection_format != current.projection_format
    {
        Freshness::Incompatible
    } else if previous.source != current.source {
        Freshness::Modified
    } else if previous.semantic != current.semantic {
        match (&previous.semantic, &current.semantic) {
            (SemanticInput::Implementation { .. }, SemanticInput::Implementation { .. }) => {
                Freshness::EntityCatalogInvalidated
            }
            (SemanticInput::Design { .. }, SemanticInput::Design { .. }) => {
                Freshness::DependencyInvalidated
            }
            _ => Freshness::Incompatible,
        }
    } else {
        Freshness::Fresh
    }
}

fn atomic_write(root: &Path, relative: &str, bytes: &[u8]) -> Result<(), String> {
    let target = sources::checked_path(root, relative)?;
    regular_or_absent(&target)?;
    fs::create_dir_all(target.parent().ok_or("artifact has no parent")?)
        .map_err(|e| e.to_string())?;
    let temporary = sources::checked_path(root, &format!("{relative}.tmp"))?;
    if regular_or_absent(&temporary)? {
        fs::remove_file(&temporary).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(temporary, target).map_err(|e| e.to_string())
}

fn regular_or_absent(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() => Ok(true),
        Ok(_) => Err(format!(
            "artifact is not a regular file: {}",
            path.display()
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}
