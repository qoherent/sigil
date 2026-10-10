mod support;

use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use support::Workspace;

fn run(args: &[&str]) -> (i32, Value, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(args)
        .output()
        .unwrap();
    (
        output.status.code().unwrap(),
        serde_json::from_slice(&output.stdout).unwrap_or(Value::Null),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

fn workspace() -> Workspace {
    let ws = Workspace::new();
    let mut config: Value = serde_json::from_str(support::CONFIG).unwrap();
    config["tools"] = json!({"sigilc":{"implementation":{"dirs":["src"]}}});
    ws.write(".sigil/config.json", config.to_string().as_bytes());
    ws.write("search.sigil", b"component SearchService {\n  interface {\n    Search {\n      Return *search results* for *query*.\n    }\n  }\n}\n");
    ws.write("panel.sigil", b"component Panel {\n  interface {\n    Render {\n      Render *search results*.\n    }\n  }\n}\n");
    ws.write("src/search.rs", b"fn search() {}\n");
    ws.write("src/panel.rs", b"fn panel() {}\n");
    ws
}

fn prepare(ws: &Workspace, name: &str) -> (Value, Vec<(String, PathBuf)>) {
    let out = ws.0.join(name);
    let (code, summary, error) = run(&[
        "align",
        "prepare",
        "--root",
        ws.0.to_str().unwrap(),
        "--out",
        out.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{summary} {error}");
    let mut inputs: Vec<_> = summary["inputs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            let dir = PathBuf::from(v.as_str().unwrap());
            let binding: Value =
                serde_json::from_slice(&fs::read(dir.join("binding.json")).unwrap()).unwrap();
            (binding["path"].as_str().unwrap().to_owned(), dir)
        })
        .collect();
    inputs.sort();
    (summary, inputs)
}

fn ingest(ws: &Workspace, directory: &Path, rows: &str) -> (i32, Value, String) {
    fs::write(directory.join("result.egg"), rows).unwrap();
    run(&[
        "align",
        "ingest",
        "--root",
        ws.0.to_str().unwrap(),
        "--binding",
        directory.join("binding.json").to_str().unwrap(),
        "--claims",
        directory.join("result.egg").to_str().unwrap(),
    ])
}

fn admit_all(ws: &Workspace, inputs: &[(String, PathBuf)], search: &str, panel: &str) {
    for (path, dir) in inputs {
        let rows = if path == "src/search.rs" {
            search
        } else {
            panel
        };
        let result = ingest(ws, dir, rows);
        assert_eq!(result.0, 0, "{:?}", result);
    }
}

fn design_ingest(ws: &Workspace, name: &str, rows: &str) {
    let out = ws.0.join(name);
    let result = run(&[
        "prepare",
        "--root",
        ws.0.to_str().unwrap(),
        "--source",
        "search.sigil",
        "--out",
        out.to_str().unwrap(),
    ]);
    assert_eq!(result.0, 0, "{:?}", result);
    fs::write(out.join("result.egg"), rows).unwrap();
    let result = run(&[
        "ingest",
        "--root",
        ws.0.to_str().unwrap(),
        "--binding",
        out.join("binding.json").to_str().unwrap(),
        "--claims",
        out.join("result.egg").to_str().unwrap(),
    ]);
    assert_eq!(result.0, 0, "{:?}", result);
}

#[test]
fn cited_tag_rename_reasks_only_its_file_and_unrelated_prose_reasks_nothing() {
    let ws = workspace();
    design_ingest(
        &ws,
        "design-before-rename",
        r##"(claim "#1" "SearchService" "provides" "search results" "required" "true") (claim "#1" "SearchService" "requires" "query" "required" "true")"##,
    );
    let (_, inputs) = prepare(&ws, "first");
    admit_all(
        &ws,
        &inputs,
        r#"(element "search" "function") (realizes "search" "SearchService::search results")"#,
        r#"(element "panel" "function") (realizes "panel" "query")"#,
    );
    assert_eq!(prepare(&ws, "unchanged").0["requestedUnits"], 0);
    ws.write("panel.sigil", b"component Panel {\n  goal {\n    An unrelated prose edit.\n  }\n  interface {\n    Render {\n      Render *search results*.\n    }\n  }\n}\n");
    assert_eq!(prepare(&ws, "unrelated").0["requestedUnits"], 0);
    ws.write("search.sigil", b"component SearchService {\n  interface {\n    Search {\n      Return *renamed results* for *query*.\n    }\n  }\n}\n");
    design_ingest(
        &ws,
        "design-after-rename",
        r##"(claim "#1" "SearchService" "provides" "renamed results" "required" "true") (claim "#1" "SearchService" "requires" "query" "required" "true")"##,
    );
    let (summary, next) = prepare(&ws, "renamed");
    assert_eq!(summary["requestedUnits"], 1);
    assert_eq!(next[0].0, "src/search.rs");
}

#[test]
fn adding_a_name_reasks_only_files_with_undesigned_elements() {
    let ws = workspace();
    let (_, inputs) = prepare(&ws, "first");
    admit_all(
        &ws,
        &inputs,
        r#"(element "search" "function") (realizes "search" "query")"#,
        r#"(element "panel" "function")"#,
    );
    assert_eq!(prepare(&ws, "unchanged").0["requestedUnits"], 0);
    ws.write("panel.sigil", b"component Panel {\n  interface {\n    Render {\n      Render *search results* and *new result*.\n    }\n  }\n}\n");
    let (summary, next) = prepare(&ws, "added");
    assert_eq!(summary["requestedUnits"], 1);
    assert_eq!(next[0].0, "src/panel.rs");
}

#[test]
fn new_delivery_and_changed_claims_reask_component_members_only() {
    let ws = workspace();
    design_ingest(
        &ws,
        "design-first",
        r##"(claim "#1" "SearchService" "provides" "search results" "required" "true")"##,
    );
    let (_, inputs) = prepare(&ws, "first");
    admit_all(
        &ws,
        &inputs,
        r#"(element "search" "function") (realizes "search" "SearchService")"#,
        r#"(element "panel" "function") (realizes "panel" "Panel")"#,
    );
    ws.write("search.sigil", b"component SearchService {\n  interface {\n    Search {\n      Return *search results* and *new results* for *query*.\n    }\n  }\n}\n");
    design_ingest(
        &ws,
        "design-added",
        r##"(claim "#1" "SearchService" "provides" "search results" "required" "true") (claim "#1" "SearchService" "provides" "new results" "required" "true")"##,
    );
    let (summary, next) = prepare(&ws, "added");
    assert_eq!(summary["requestedUnits"], 1);
    assert_eq!(next[0].0, "src/search.rs");
    assert_eq!(
        ingest(
            &ws,
            &next[0].1,
            r#"(element "search" "function") (realizes "search" "SearchService")"#
        )
        .0,
        0
    );
    ws.write("search.sigil", b"component SearchService {\n  interface {\n    Search {\n      May return *search results* and *new results* for *query*.\n    }\n  }\n}\n");
    design_ingest(
        &ws,
        "design-changed",
        r##"(claim "#1" "SearchService" "provides" "search results" "permitted" "true") (claim "#1" "SearchService" "provides" "new results" "required" "true")"##,
    );
    let (summary, next) = prepare(&ws, "changed");
    assert_eq!(summary["requestedUnits"], 1);
    assert_eq!(next[0].0, "src/search.rs");
}

#[test]
fn rename_and_duplicate_of_unchanged_code_reuse_local_element_readings() {
    let ws = workspace();
    let (_, inputs) = prepare(&ws, "first");
    admit_all(
        &ws,
        &inputs,
        r#"(element "search" "function") (realizes "search" "SearchService")"#,
        r#"(element "panel" "function") (realizes "panel" "Panel")"#,
    );
    let memo_dir = ws.0.join(".sigil/claims/implementation");
    let before: Vec<_> = fs::read_dir(&memo_dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    fs::rename(ws.0.join("src/search.rs"), ws.0.join("src/renamed.rs")).unwrap();
    ws.write("src/duplicate.rs", b"fn search() {}\n");
    let summary = prepare(&ws, "renamed").0;
    assert_eq!(summary["requestedUnits"], 0);
    assert_eq!(summary["reusedUnits"], 3);
    let workspace = sigilc::align::prepare::load(&ws.0, &ws.0.join(".sigil")).unwrap();
    for request in workspace.requests(&ws.0).unwrap() {
        let admitted = sigilc::align::memo::load(&ws.0.join(".sigil"), &request).unwrap();
        assert!(admitted.facts.iter().all(|fact| {
            fact.path == request.binding.path
                && fact
                    .element
                    .starts_with(&format!("{}::", request.binding.path))
        }));
    }
    assert_eq!(fs::read_dir(&memo_dir).unwrap().count(), before.len());
    for path in before {
        let stored: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert!(!stored.to_string().contains("src/search.rs"));
    }
}

#[test]
fn code_edits_and_refused_rereads_preserve_other_files_and_keep_changed_file_stale() {
    let ws = workspace();
    let (_, inputs) = prepare(&ws, "first");
    admit_all(
        &ws,
        &inputs,
        r#"(element "search" "function") (realizes "search" "SearchService")"#,
        r#"(element "panel" "function") (realizes "panel" "Panel")"#,
    );
    ws.write("src/search.rs", b"fn search() { changed(); }\n");
    let (_, changed) = prepare(&ws, "changed");
    assert_eq!(changed.len(), 1);
    assert_eq!(changed[0].0, "src/search.rs");
    assert_eq!(
        ingest(
            &ws,
            &changed[0].1,
            r#"(element "search" "function") (realizes "search" "RetryPolicy")"#
        )
        .0,
        1
    );
    let (summary, next) = prepare(&ws, "refused");
    assert_eq!(summary["requestedUnits"], 1);
    assert_eq!(summary["reusedUnits"], 1);
    assert_eq!(next[0].0, "src/search.rs");
}
