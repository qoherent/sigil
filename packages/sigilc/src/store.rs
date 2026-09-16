//! Small disposable index and atomic per-source publication. No external-work registry.
use crate::{
    assertions,
    frontend::normalized_path,
    inputs::{Binding, SemanticInput},
    sources::{self, hash},
    turtle::{Assertion, TurtleLimits},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

const WORLDS: &str = ".sigil/worlds";
const INDEX: &str = ".sigil/worlds/index.json";
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
    root: PathBuf,
    _lock: File,
    index: Index,
    limits: StoreLimits,
}

impl LockedStore {
    pub fn open(root: &Path, limits: StoreLimits) -> Result<Self, String> {
        let (root, lock) = acquire(root)?;
        let index = match fs::symlink_metadata(sources::checked_path(&root, INDEX)?) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Index {
                version: INDEX_VERSION,
                entries: BTreeMap::new(),
            },
            Err(e) => return Err(e.to_string()),
            Ok(_) => serde_json::from_slice::<Index>(
                &sources::capture(&root, INDEX, limits.max_index_bytes)?.bytes,
            )
            .map_err(|e| format!("invalid projection index: {e}"))?,
        };
        if index.version != INDEX_VERSION {
            return Err("unsupported projection index version".into());
        }
        for (key, entry) in &index.entries {
            if *key != object_key(&entry.binding)? && *key != history_key(&entry.binding)?
                || !checksum(&entry.generation)
                || !checksum(&entry.assertion_checksum)
            {
                return Err(format!("invalid projection index entry: {key}"));
            }
        }
        Ok(Self {
            root,
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
            return Err("prepared semantic inputs no longer match current inputs".into());
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
            preserve_projection(&self.root, &key, &previous_key, self.limits)?;
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
            &self.root,
            &format!("{WORLDS}/{key}.egg"),
            encoded.as_bytes(),
        )?;
        atomic_write(&self.root, INDEX, &data)?;
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
        match fs::symlink_metadata(sources::checked_path(&self.root, &path)?) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(inspected(Freshness::Incomplete));
            }
            Err(e) => return Err(e.to_string()),
            Ok(meta) if !meta.is_file() => return Err("projection is not a regular file".into()),
            _ => (),
        }
        let captured = sources::capture(
            &self.root,
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

    fn check_live(&self, binding: &Binding) -> Result<(), String> {
        let mut inputs = vec![(&binding.source.path, Some(binding.source.checksum.as_str()))];
        if let SemanticInput::Design {
            dependencies,
            context,
            ..
        } = &binding.semantic
        {
            inputs.extend(
                dependencies
                    .iter()
                    .map(|d| (&d.path, Some(d.checksum.as_str()))),
            );
            inputs.extend(context.iter().map(|c| (&c.path, c.checksum.as_deref())));
        }
        for (path, expected) in inputs {
            if let Some(expected) = expected {
                let current = sources::capture(&self.root, path, self.limits.max_source_bytes)?;
                if current.identity.checksum != expected {
                    return Err(format!("source input changed: {path}"));
                }
            } else {
                match fs::symlink_metadata(sources::checked_path(&self.root, path)?) {
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                    Err(e) => return Err(e.to_string()),
                    Ok(_) => return Err(format!("source input appeared: {path}")),
                }
            }
        }
        Ok(())
    }
}

// @sigil implements packages/sigilc/store.sigil::SigilProjectionStore::DisposableCleanup interface
pub fn clean(root: &Path) -> Result<Vec<String>, String> {
    let (root, _lock) = acquire(root)?;
    let mut removed = Vec::new();
    for entry in fs::read_dir(sources::checked_path(&root, WORLDS)?).map_err(|e| e.to_string())? {
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
        removed.push(format!("{WORLDS}/{}", entry.file_name().to_string_lossy()));
    }
    removed.sort();
    Ok(removed)
}

fn acquire(root: &Path) -> Result<(PathBuf, File), String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    fs::create_dir_all(sources::checked_path(&root, WORLDS)?).map_err(|e| e.to_string())?;
    let path = sources::checked_path(&root, &format!("{WORLDS}/.lock"))?;
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
    Ok((root, lock))
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
