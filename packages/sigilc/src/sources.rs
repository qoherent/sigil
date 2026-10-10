use crate::structure::normalized_path;
use regex::Regex;
use serde::{Deserialize, Serialize};
use snapdir_core::hash_file::HashFile;
use snapdir_core::{Blake3Hasher, ExcludeMatcher, FollowMode, Hasher, PathType, WalkOptions};
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

const INTERNAL: &[&str] = &[
    ".sigil",
    ".git",
    ".deno",
    "node_modules",
    "build",
    "target",
    "coverage",
];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    pub paths: Vec<String>,
    pub dirs: Vec<String>,
    pub include: Vec<String>,
    pub exclude: Vec<String>,
    pub vendor_dirs: Vec<String>,
    pub allow_empty: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceIdentity {
    pub path: String,
    pub checksum: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceManifest {
    pub fingerprint: String,
    pub files: Vec<SourceIdentity>,
    pub intentional_empty: bool,
}

#[derive(Debug)]
pub struct CapturedSource {
    pub identity: SourceIdentity,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
pub struct PatternExclusion {
    pub pattern: String,
    pub removed: usize,
}

#[derive(Debug, Serialize)]
pub struct UnpresentableSource {
    pub path: String,
    pub reason: String,
}

/// Alignment distinguishes files that can be presented from selected files
/// that keep the check incomplete. All report lists are deterministically sorted.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentManifest {
    pub fingerprint: String,
    pub files: Vec<SourceIdentity>,
    pub exclusions: Vec<PatternExclusion>,
    pub auto_excluded_design: Vec<String>,
    pub empty_files: Vec<String>,
    pub unpresentable: Vec<UnpresentableSource>,
    pub skipped_symlinks: Vec<String>,
    pub intentional_empty: bool,
}

/// Discover alignment units without following links or reading excluded files.
/// Exclude patterns remove candidates in config order; an overlapping pattern
/// only counts files not already removed by an earlier pattern.
pub fn discover_alignment(
    root: &Path,
    selection: &Selection,
    design_sources: &BTreeSet<String>,
    max_bytes: u64,
) -> Result<AlignmentManifest, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    for vendor in &selection.vendor_dirs {
        normalized_path(vendor)?;
    }
    let includes = selection
        .include
        .iter()
        .map(|p| glob(p))
        .collect::<Result<Vec<_>, _>>()?;
    let excludes = selection
        .exclude
        .iter()
        .map(|p| glob(p))
        .collect::<Result<Vec<_>, _>>()?;
    let mut candidates = BTreeSet::new();
    let mut links = BTreeSet::new();
    for path in &selection.paths {
        normalized_path(path)?;
        if symlink_segment(&root, path)? {
            links.insert(path.clone());
            continue;
        }
        let target = checked_path(&root, path)?;
        if !fs::symlink_metadata(target)
            .map_err(|e| format!("{path}: {e}"))?
            .is_file()
        {
            return Err(format!("not a regular source file: {path}"));
        }
        candidates.insert(path.clone());
    }
    for dir in &selection.dirs {
        normalized_path(dir)?;
        if symlink_segment(&root, dir)? {
            links.insert(dir.clone());
            continue;
        }
        let target = checked_path(&root, dir)?;
        if !fs::symlink_metadata(target)
            .map_err(|e| format!("{dir}: {e}"))?
            .is_dir()
        {
            return Err(format!("not a source directory: {dir}"));
        }
        if !internal_or_vendor(dir, selection) {
            alignment_candidates(&root, dir, selection, &mut candidates, &mut links)?;
        }
    }
    if selection.paths.is_empty() && selection.dirs.is_empty() {
        alignment_candidates(&root, "", selection, &mut candidates, &mut links)?;
    }
    let included = |path: &str| {
        !internal_or_vendor(path, selection)
            && (includes.is_empty() || includes.iter().any(|p| p.is_match(path)))
    };
    candidates.retain(|p| included(p));
    // A linked directory may contain included files, but checking its contents
    // would follow the link. Report every encountered link that is not excluded.
    links.retain(|p| !internal_or_vendor(p, selection) && !excludes.iter().any(|e| e.is_match(p)));
    let auto_excluded_design: Vec<_> = candidates.intersection(design_sources).cloned().collect();
    candidates.retain(|p| !design_sources.contains(p));
    let mut exclusions = Vec::new();
    for (pattern, matcher) in selection.exclude.iter().zip(&excludes) {
        let before = candidates.len();
        candidates.retain(|p| !matcher.is_match(p));
        exclusions.push(PatternExclusion {
            pattern: pattern.clone(),
            removed: before - candidates.len(),
        });
    }
    let mut files = Vec::new();
    let mut empty_files = Vec::new();
    let mut unpresentable = Vec::new();
    for path in &candidates {
        let metadata =
            fs::symlink_metadata(checked_path(&root, path)?).map_err(|e| format!("{path}: {e}"))?;
        if metadata.len() > max_bytes {
            unpresentable.push(UnpresentableSource {
                path: path.clone(),
                reason: format!("source exceeds presentation byte limit ({max_bytes})"),
            });
            continue;
        }
        let source = capture(&root, path, max_bytes)?;
        if source.bytes.is_empty() {
            empty_files.push(path.clone());
        } else if std::str::from_utf8(&source.bytes).is_err() {
            unpresentable.push(UnpresentableSource {
                path: path.clone(),
                reason: "source is not UTF-8".into(),
            });
        } else {
            files.push(source.identity);
        }
    }
    // Empty files are not units. Unpresentable regular files remain selected
    // units, so a binary-only selection reaches Incomplete rather than usage.
    let intentional_empty = files.is_empty() && unpresentable.is_empty();
    if intentional_empty && !selection.allow_empty {
        return Err(format!(
            "empty source selection; intentional empty scope requires allowEmpty; empty files: {empty_files:?}; skipped symlinks: {links:?}; auto-excluded design sources: {auto_excluded_design:?}"
        ));
    }
    let skipped_symlinks: Vec<_> = links.into_iter().collect();
    let fingerprint = hash(
        &serde_json::to_vec(&(
            "sigil-align-sources-v1",
            &files,
            &exclusions,
            &auto_excluded_design,
            &empty_files,
            &unpresentable,
            &skipped_symlinks,
        ))
        .map_err(|e| e.to_string())?,
    );
    Ok(AlignmentManifest {
        fingerprint,
        files,
        exclusions,
        auto_excluded_design,
        empty_files,
        unpresentable,
        skipped_symlinks,
        intentional_empty,
    })
}

fn internal_or_vendor(path: &str, selection: &Selection) -> bool {
    path.split('/').any(|part| INTERNAL.contains(&part))
        || selection
            .vendor_dirs
            .iter()
            .any(|v| path == v || path.starts_with(&format!("{v}/")))
}

/// Inspect each segment before checking the final file type. No target behind a
/// link is statted or read, including explicit paths that cross a linked parent.
fn symlink_segment(root: &Path, path: &str) -> Result<bool, String> {
    let mut target = root.to_path_buf();
    for part in path.split('/') {
        target.push(part);
        let metadata = fs::symlink_metadata(&target).map_err(|e| format!("{path}: {e}"))?;
        if metadata.file_type().is_symlink() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn alignment_candidates(
    root: &Path,
    dir: &str,
    selection: &Selection,
    files: &mut BTreeSet<String>,
    links: &mut BTreeSet<String>,
) -> Result<(), String> {
    let target = if dir.is_empty() {
        root.to_owned()
    } else {
        checked_path(root, dir)?
    };
    for entry in fs::read_dir(target).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "non-UTF-8 source path")?;
        let path = if dir.is_empty() {
            name
        } else {
            format!("{dir}/{name}")
        };
        if internal_or_vendor(&path, selection) {
            continue;
        }
        normalized_path(&path)?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            links.insert(path);
        } else if kind.is_dir() {
            alignment_candidates(root, &path, selection, files, links)?;
        } else if kind.is_file() {
            files.insert(path);
        }
    }
    Ok(())
}

pub fn hash(bytes: &[u8]) -> String {
    Blake3Hasher.hash_hex(bytes)
}

pub fn implementation_path(path: &str) -> Result<(), String> {
    normalized_path(path)?;
    if path.split('/').any(|part| INTERNAL.contains(&part)) {
        return Err("Implementation source is inside an excluded internal tree".into());
    }
    Ok(())
}

// @sigil implements packages/sigilc/sources.sigil::SigilSourceIdentity::CompilerInputSelection interface
pub fn discover(root: &Path, selection: &Selection) -> Result<SourceManifest, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    for vendor in &selection.vendor_dirs {
        normalized_path(vendor)?;
    }
    for path in &selection.paths {
        let target = checked_path(&root, path)?;
        if !target.is_file() {
            return Err(format!("not a regular source file: {path}"));
        }
    }
    for dir in &selection.dirs {
        let target = checked_path(&root, dir)?;
        if !target.is_dir() {
            return Err(format!("not a source directory: {dir}"));
        }
    }
    let includes: Vec<_> = selection
        .include
        .iter()
        .map(|p| glob(p))
        .collect::<Result<_, _>>()?;
    let excludes: Vec<_> = selection
        .exclude
        .iter()
        .map(|p| glob(p))
        .collect::<Result<_, _>>()?;
    let eligible = |path: &str| {
        !path.split('/').any(|part| INTERNAL.contains(&part))
            && !selection
                .vendor_dirs
                .iter()
                .any(|v| path == v || path.starts_with(&format!("{v}/")))
            && (includes.is_empty() || includes.iter().any(|p| p.is_match(path)))
            && !excludes.iter().any(|p| p.is_match(path))
    };
    // A focused file list needs no directory manifest. Keep snapdir's content
    // hashing and byte-count guard, with fresh path/metadata checks around it.
    if !selection.paths.is_empty() && selection.dirs.is_empty() {
        let mut files = Vec::new();
        for path in selection.paths.iter().collect::<BTreeSet<_>>() {
            if !eligible(path) {
                continue;
            }
            let target = checked_path(&root, path)?;
            let before = fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
            if !before.is_file() {
                return Err(format!("not a regular source file: {path}"));
            }
            let (checksum, size) = Blake3Hasher
                .hash_file_hex(&target)
                .map_err(|e| format!("hash {path}: {e}"))?;
            let after =
                fs::symlink_metadata(checked_path(&root, path)?).map_err(|e| e.to_string())?;
            if !after.is_file()
                || size != before.len()
                || size != after.len()
                || before.modified().ok() != after.modified().ok()
                || snapdir_core::copy_guard::CopyGuard::from_metadata(&before)
                    != snapdir_core::copy_guard::CopyGuard::from_metadata(&after)
            {
                return Err(format!("source changed during hashing: {path}"));
            }
            files.push(SourceIdentity {
                path: path.clone(),
                checksum,
            });
        }
        return source_manifest(files, selection.allow_empty);
    }
    // Snapdir takes absolute regexes. Never pass user globs to ExcludeMatcher.
    let prefix = regex::escape(root.to_str().ok_or("non-UTF-8 workspace path")?);
    let internal = INTERNAL
        .iter()
        .map(|p| regex::escape(p))
        .collect::<Vec<_>>()
        .join("|");
    let mut prune = format!(r"^{prefix}[/\\](?:[^/\\]+[/\\])*(?:{internal})(?:[/\\]|$)");
    for vendor in &selection.vendor_dirs {
        let parts = vendor
            .split('/')
            .map(regex::escape)
            .collect::<Vec<_>>()
            .join(r"[/\\]");
        prune.push_str(&format!(r"|^{prefix}[/\\]{parts}(?:[/\\]|$)"));
    }
    let manifest = snapdir_core::walk(
        &root,
        &WalkOptions {
            follow: FollowMode::NoFollow,
            exclude: Some(ExcludeMatcher::new(&prune).map_err(|e| e.to_string())?),
            object_store_roots: Vec::new(),
            ..Default::default()
        },
        &Blake3Hasher,
    )
    .map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for entry in manifest.entries() {
        if entry.path_type != PathType::File {
            continue;
        }
        #[cfg(windows)]
        let manifest_path = entry.path.replace('\\', "/");
        #[cfg(not(windows))]
        let manifest_path = entry.path.clone();
        let path = manifest_path
            .strip_prefix("./")
            .unwrap_or(&manifest_path)
            .to_owned();
        normalized_path(&path)?;
        let requested = selection.paths.is_empty() && selection.dirs.is_empty()
            || selection.paths.contains(&path)
            || selection
                .dirs
                .iter()
                .any(|d| path.starts_with(&format!("{d}/")));
        if requested && eligible(&path) {
            files.push(SourceIdentity {
                path,
                checksum: entry.checksum.clone(),
            });
        }
    }
    source_manifest(files, selection.allow_empty)
}

fn source_manifest(
    mut files: Vec<SourceIdentity>,
    allow_empty: bool,
) -> Result<SourceManifest, String> {
    files.sort_by(|a, b| a.path.cmp(&b.path));
    if files.is_empty() && !allow_empty {
        return Err("empty source selection; intentional empty scope requires allowEmpty".into());
    }
    let rows: Vec<_> = files
        .iter()
        .map(|f| (&f.path, "file", &f.checksum))
        .collect();
    let fingerprint =
        hash(&serde_json::to_vec(&("sigil-sources-v1", rows)).map_err(|e| e.to_string())?);
    Ok(SourceManifest {
        fingerprint,
        intentional_empty: files.is_empty(),
        files,
    })
}

// @sigil implements packages/sigilc/sources.sigil::SigilSourceIdentity::SourceIdentity interface
pub fn capture(root: &Path, path: &str, max_bytes: u64) -> Result<CapturedSource, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let target = checked_path(&root, path)?;
    let metadata = fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err(format!("not a regular source file: {path}"));
    }
    let mut bytes = Vec::new();
    fs::File::open(&target)
        .map_err(|e| e.to_string())?
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!("source exceeds byte limit: {path}"));
    }
    let checksum = hash(&bytes);
    let target = checked_path(&root, path)?;
    let (current, size) = Blake3Hasher
        .hash_file_hex(&target)
        .map_err(|e| e.to_string())?;
    if current != checksum || size != bytes.len() as u64 {
        return Err(format!("source changed during capture: {path}"));
    }
    Ok(CapturedSource {
        identity: SourceIdentity {
            path: path.into(),
            checksum,
        },
        bytes,
    })
}

/// Reject symlinks in every existing segment, including artifact parents.
pub fn checked_path(root: &Path, path: &str) -> Result<PathBuf, String> {
    normalized_path(path)?;
    let mut target = root.to_path_buf();
    for part in path.split('/') {
        target.push(part);
        match fs::symlink_metadata(&target) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(format!("symlink path is not allowed: {path}"));
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(target)
}

/// Same *, ** and ? rules as packages/core/src/path.ts::globMatches.
fn glob(pattern: &str) -> Result<Regex, String> {
    let normalized = pattern.replace('\\', "/");
    let mut chars = normalized
        .strip_prefix("./")
        .unwrap_or(&normalized)
        .chars()
        .peekable();
    let mut expression = String::from("^");
    while let Some(c) = chars.next() {
        match c {
            '*' if chars.peek() == Some(&'*') => {
                chars.next();
                if chars.peek() == Some(&'/') {
                    chars.next();
                    expression.push_str("(?:.*/)?");
                } else {
                    expression.push_str(".*");
                }
            }
            '*' => expression.push_str("[^/]*"),
            '?' => expression.push_str("[^/]"),
            _ => expression.push_str(&regex::escape(&c.to_string())),
        }
    }
    expression.push('$');
    Regex::new(&expression).map_err(|e| e.to_string())
}
