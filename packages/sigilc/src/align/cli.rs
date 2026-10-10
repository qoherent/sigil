//! Deterministic implementation interpretation commands.
use super::{admit, dialect, memo, prepare};
use crate::command::{Output, json, store_dir};
use std::{collections::BTreeMap, path::Path};

pub fn help() -> String {
    "sigilc align — implementation claims\n\nCommands:\n  check [--root DIR] [--store DIR]\n  prepare --out NEW_DIR [--root DIR] [--store DIR]\n  ingest --binding FILE --claims FILE [--root DIR] [--store DIR]\n\nReads tools.sigilc.implementation from workspace configuration. Each selected\nwhole file is presented in its own directory with names, claims and code guidance.\nThe presentation limit is 1000000 bytes per file. These commands launch no model.\nEither ingest input may be '-' to read standard input, but only one at a time.\n".into()
}

// @sigil implements packages/sigilc/align.sigil::SigilImplementationClaims::AlignCommands interface
pub fn run(args: &[&str]) -> Output {
    if matches!(args, [] | ["--help"] | ["-h"]) {
        return Ok((0, help()));
    }
    let [command @ ("prepare" | "ingest" | "check"), tail @ ..] = args else {
        return Err((2, "Invalid align command. Run sigilc align --help.".into()));
    };
    let allowed: &[&str] = if *command == "prepare" {
        &["--out", "--root", "--store"]
    } else if *command == "check" {
        &["--root", "--store"]
    } else {
        &["--binding", "--claims", "--root", "--store"]
    };
    let mut options = BTreeMap::new();
    let mut remaining = tail;
    while let Some((flag, next)) = remaining.split_first() {
        if !allowed.contains(flag) || options.contains_key(*flag) {
            return Err((2, format!("unknown or duplicate option: {flag}")));
        }
        let Some((value, next)) = next.split_first() else {
            return Err((2, format!("missing value for {flag}")));
        };
        options.insert(*flag, *value);
        remaining = next;
    }
    let required = |flag: &str| {
        options
            .get(flag)
            .copied()
            .ok_or_else(|| (2, format!("missing required option: {flag}")))
    };
    let root = Path::new(options.get("--root").copied().unwrap_or("."));
    let store = store_dir(root, options.get("--store").copied());
    if *command == "check" {
        return super::check::run(root, &store);
    }
    if *command == "prepare" {
        let out = Path::new(required("--out")?);
        prepare::empty_output(out).map_err(|e| (2, e))?;
        let workspace = prepare::load(root, &store).map_err(prepare::LoadError::output)?;
        let requests = workspace.requests(root).map_err(|e| (3, e))?;
        let split = memo::split(&requests, &store);
        let directories = prepare::write(&split.stale, out).map_err(|e| (3, e))?;
        return json(
            0,
            &serde_json::json!({
                "version": prepare::REQUEST_FORMAT,
                "requestedUnits": split.stale.len(),
                "reusedUnits": split.reused.len(),
                "inputs": directories,
                "namesDigest": workspace.names_digest,
                "selection": workspace.selection,
                "presentationByteLimit": prepare::MAX_FILE_BYTES,
            }),
        );
    }
    let (binding_path, claims_path) = (required("--binding")?, required("--claims")?);
    if [binding_path, claims_path]
        .iter()
        .filter(|path| **path == "-")
        .count()
        > 1
    {
        return Err((2, "only one input may read standard input".into()));
    }
    let supplied: prepare::Binding =
        serde_json::from_slice(&crate::command::read(binding_path, 64_000).map_err(|e| (3, e))?)
            .map_err(|e| (3, format!("{binding_path}: {e}")))?;
    let workspace = prepare::load(root, &store).map_err(prepare::LoadError::output)?;
    let file = workspace
        .selection
        .implementation
        .files
        .iter()
        .find(|file| file.path == supplied.path)
        .ok_or_else(|| {
            (
                2,
                format!(
                    "binding mismatch: path {:?} is no longer a selected presentable file",
                    supplied.path
                ),
            )
        })?;
    let request = workspace.request(root, file).map_err(|e| (3, e))?;
    if request.binding != supplied {
        return Err((2, mismatch(&request.binding, &supplied)));
    }
    let bytes = crate::command::read(
        claims_path,
        dialect::Limits::default().max_document_bytes as u64,
    )
    .map_err(|e| (3, e))?;
    let admitted = String::from_utf8(bytes)
        .map_err(|_| "claims artifact is not valid UTF-8".to_owned())
        .and_then(|text| dialect::parse(&text, dialect::Limits::default()))
        .and_then(|rows| {
            if rows.is_empty()
                || !rows
                    .iter()
                    .any(|row| matches!(row, dialect::Row::Element { .. }))
            {
                Ok(None)
            } else {
                admit::admit(&request, &rows).map(Some)
            }
        });
    let (code, stored, facts, undesigned, refusals, unread) = match admitted {
        Ok(Some(admitted)) => {
            let stored = memo::save(&store, &request, &admitted).map_err(|e| (3, e))?;
            (
                0,
                usize::from(stored),
                admitted.facts.len(),
                admitted.undesigned_elements.len(),
                vec![],
                0,
            )
        }
        Ok(None) => (1, 0, 0, 0, vec![], 1),
        Err(reason) => (
            1,
            0,
            0,
            0,
            vec![serde_json::json!({"path": request.binding.path, "reason": reason})],
            1,
        ),
    };
    json(
        code,
        &serde_json::json!({
            "version": prepare::REQUEST_FORMAT,
            "path": request.binding.path,
            "storedUnits": stored,
            "admittedFacts": facts,
            "undesignedElements": undesigned,
            "unreadUnits": unread,
            "refusals": refusals,
        }),
    )
}

fn mismatch(current: &prepare::Binding, supplied: &prepare::Binding) -> String {
    let current = serde_json::to_value(current).expect("binding serialization");
    let supplied = serde_json::to_value(supplied).expect("binding serialization");
    let fields: Vec<_> = current
        .as_object()
        .expect("binding object")
        .iter()
        .filter(|(name, value)| supplied[*name] != **value)
        .map(|(name, _)| name.as_str())
        .collect();
    format!(
        "binding mismatch for {}: {} changed; prepare this file again",
        supplied["path"].as_str().unwrap_or("file"),
        fields.join(", ")
    )
}
