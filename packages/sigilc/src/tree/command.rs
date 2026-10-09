//! `sigilc tree [--source PATH] [--diff] [--root DIR] [--store DIR]`: the
//! resolved trees as deterministic JSON, or what changed since the previous one.
use super::{ResolvedTree, Snapshot, cache::TreeCache, diff::diff_trees};
use crate::{cli::Output, language::workspace::Workspace};
use serde::Serialize;
use std::path::PathBuf;

const USAGE: &str = "Usage: sigilc tree [--source PATH] [--diff] [--root DIR] [--store DIR]";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Trees<'a> {
    version: u32,
    trees: Vec<&'a ResolvedTree>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceDiff {
    source: String,
    /// False when no earlier tree is recorded, in which case the diff is empty.
    has_previous: bool,
    diff: super::diff::TreeDiff,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Diffs {
    version: u32,
    diffs: Vec<SourceDiff>,
}

fn json(value: &impl Serialize) -> Output {
    let text = serde_json::to_string_pretty(value).map_err(|e| (3, e.to_string()))?;
    Ok((0, text + "\n"))
}

pub fn run(args: &[&str]) -> Output {
    let mut source = None;
    let mut root = None;
    let mut store = None;
    let mut diff = false;
    let mut rest = args;
    while let Some((flag, next)) = rest.split_first() {
        rest = next;
        if *flag == "--diff" {
            if std::mem::replace(&mut diff, true) {
                return Err((2, format!("duplicate option: --diff\n{USAGE}")));
            }
            continue;
        }
        let slot = match *flag {
            "--source" => &mut source,
            "--root" => &mut root,
            "--store" => &mut store,
            _ => return Err((2, format!("unknown option: {flag}\n{USAGE}"))),
        };
        let Some((value, next)) = rest.split_first() else {
            return Err((2, format!("missing value: {flag}\n{USAGE}")));
        };
        rest = next;
        if slot.replace(*value).is_some() {
            return Err((2, format!("duplicate option: {flag}\n{USAGE}")));
        }
    }
    let root = PathBuf::from(root.unwrap_or("."));
    let store = crate::cli::store_dir(&root, store);
    if !root.is_dir() {
        return Err((
            3,
            format!("workspace root is not a directory: {}", root.display()),
        ));
    }
    let workspace = Workspace::load(&root).map_err(|e| (3, format!("read workspace: {e}")))?;
    let mut cache = TreeCache::new(&store.join("trees"));
    let snapshot = Snapshot::build(&workspace, &mut cache);
    let trees: Vec<&ResolvedTree> = match source {
        Some(path) => vec![
            snapshot
                .tree(path)
                .ok_or_else(|| (3, format!("source is not part of the workspace: {path}")))?,
        ],
        None => snapshot.trees.iter().collect(),
    };
    if diff {
        return json(&Diffs {
            version: 1,
            diffs: trees.iter().map(|tree| diff_of(&cache, tree)).collect(),
        });
    }
    match (source, trees.as_slice()) {
        (Some(_), [tree]) => Ok((0, tree.to_json() + "\n")),
        _ => json(&Trees { version: 1, trees }),
    }
}

fn diff_of(cache: &TreeCache, tree: &ResolvedTree) -> SourceDiff {
    let previous = cache.previous(&tree.parse.path);
    SourceDiff {
        source: tree.parse.path.clone(),
        has_previous: previous.is_some(),
        diff: previous
            .map(|p| diff_trees(&p.parse, &tree.parse))
            .unwrap_or_default(),
    }
}
