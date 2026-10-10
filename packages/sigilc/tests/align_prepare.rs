mod support;

use serde_json::{Value, json};
use std::{fs, path::Path, process::Command};
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
    config["tools"] =
        json!({"sigilc":{"implementation":{"dirs":["src"],"design":["search.sigil"]}}});
    ws.write(".sigil/config.json", config.to_string().as_bytes());
    ws.write("search.sigil", b"component SearchService {\n  interface {\n    Search {\n      Return *search results* for *query*.\n    }\n  }\n}\n");
    ws.write(
        "outside.sigil",
        b"component Outside {\n  interface {\n    Outside {\n      Return *outside result*.\n    }\n  }\n}\n",
    );
    ws.write(
        "src/search.rs",
        b"pub fn search(query: &str) -> Vec<String> { vec![query.to_owned()] }\n",
    );
    ws.write(
        "src/panel.ts",
        b"export function render(results: string[]) { return results.join(','); }\n",
    );
    ws
}

fn prepare(ws: &Workspace, out: &Path) -> (i32, Value, String) {
    run(&[
        "align",
        "prepare",
        "--root",
        ws.0.to_str().unwrap(),
        "--out",
        out.to_str().unwrap(),
    ])
}

#[test]
fn fresh_prepare_writes_standalone_file_units_with_qualified_design_claims() {
    let ws = workspace();
    // Store a real design interpretation, so context must carry admitted claims.
    let design = ws.0.join("design-request");
    let (code, _, error) = run(&[
        "prepare",
        "--root",
        ws.0.to_str().unwrap(),
        "--source",
        "search.sigil",
        "--out",
        design.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{error}");
    fs::write(
        design.join("result.egg"),
        "(claim \"#1\" \"SearchService\" \"provides\" \"search results\" \"required\" \"true\")\n",
    )
    .unwrap();
    let (code, _, error) = run(&[
        "ingest",
        "--root",
        ws.0.to_str().unwrap(),
        "--binding",
        design.join("binding.json").to_str().unwrap(),
        "--claims",
        design.join("result.egg").to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{error}");
    let out = ws.0.join("requests");
    let (code, summary, error) = prepare(&ws, &out);
    assert_eq!(code, 0, "{summary} {error}");
    assert_eq!(summary["requestedUnits"], 2);
    let dirs: Vec<_> = fs::read_dir(&out)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(dirs.len(), 2);
    for dir in dirs {
        assert!(dir.is_dir());
        let request: Value =
            serde_json::from_slice(&fs::read(dir.join("request.json")).unwrap()).unwrap();
        let binding: Value =
            serde_json::from_slice(&fs::read(dir.join("binding.json")).unwrap()).unwrap();
        assert_eq!(request["binding"], binding);
        let path = binding["path"].as_str().unwrap();
        assert_eq!(
            fs::read(dir.join("source.txt")).unwrap(),
            fs::read(ws.0.join(path)).unwrap()
        );
        assert_eq!(
            request["source"].as_str().unwrap().as_bytes(),
            fs::read(dir.join("source.txt")).unwrap()
        );
        let names = request["names"].as_array().unwrap();
        assert!(
            !names.is_empty(),
            "empty names in {request}; selection={summary}"
        );
        let results = names
            .iter()
            .find(|n| n["qualifiedLabel"] == "SearchService::search results")
            .unwrap_or_else(|| panic!("missing qualified Tag: {names:?}"));
        assert!(!results["claims"].as_array().unwrap().is_empty());
        assert!(!results["facets"].as_array().unwrap().is_empty());
        assert!(!results["digest"].as_str().unwrap().is_empty());
        assert!(names.iter().all(|n| n["label"] != "Outside"));
        for name in ["rows.md", "examples.md", "rejected.md"] {
            assert!(dir.join(name).is_file());
        }
        let guidance = fs::read_to_string(dir.join("rows.md")).unwrap();
        assert!(guidance.contains("unmapped") && guidance.contains("whole file"));
    }
}

#[test]
fn unusable_files_are_reported_and_output_must_be_empty() {
    let ws = workspace();
    ws.write("src/empty.rs", b"");
    ws.write("src/binary.dat", b"\xff");
    ws.write("src/large.rs", &vec![b'a'; 1_000_001]);
    #[cfg(unix)]
    std::os::unix::fs::symlink("search.rs", ws.0.join("src/link.rs")).unwrap();
    let out = ws.0.join("requests");
    let (code, summary, error) = prepare(&ws, &out);
    assert_eq!(code, 0, "{summary} {error}");
    assert_eq!(summary["requestedUnits"], 2);
    assert_eq!(
        summary["selection"]["implementation"]["emptyFiles"],
        json!(["src/empty.rs"])
    );
    assert_eq!(
        summary["selection"]["implementation"]["unpresentable"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    #[cfg(unix)]
    assert_eq!(
        summary["selection"]["implementation"]["skippedSymlinks"],
        json!(["src/link.rs"])
    );
    let before = fs::read_dir(&out).unwrap().count();
    let (code, _, error) = prepare(&ws, &out);
    assert_eq!(code, 2, "{error}");
    assert!(error.contains("not empty"), "{error}");
    assert_eq!(fs::read_dir(out).unwrap().count(), before);
}

#[test]
fn implementation_guidance_extraction_refuses_workspace_and_exports_code_rows() {
    let ws = workspace();
    let inside = ws.0.join("guidance");
    let (code, _, error) = run(&[
        "extract-guidance",
        "--implementation",
        "--root",
        ws.0.to_str().unwrap(),
        "--out",
        inside.to_str().unwrap(),
    ]);
    assert_eq!(code, 2, "{error}");
    assert!(error.contains("inside the workspace"), "{error}");
    assert!(!inside.exists());
    let outside = Workspace::new();
    let out = outside.0.join("guidance");
    let (code, summary, error) = run(&[
        "extract-guidance",
        "--implementation",
        "--root",
        ws.0.to_str().unwrap(),
        "--out",
        out.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{summary} {error}");
    assert_eq!(summary["written"].as_array().unwrap().len(), 3);
    let rows = fs::read_to_string(out.join("rows.md")).unwrap();
    assert!(rows.contains("realizes") && rows.contains("element") && rows.contains("test"));
    let examples = fs::read_to_string(out.join("examples.md")).unwrap();
    assert!(
        examples.contains("SearchService")
            && examples.contains("SearchPanel")
            && examples.contains("export")
    );
}

#[test]
fn invalid_implementation_configuration_is_usage() {
    let ws = workspace();
    let out = ws.0.join("requests");
    for implementation in [
        None,
        Some(json!({"mystery":true})),
        Some(json!({"paths":["src/empty.rs"]})),
        Some(json!({"design":["absent.sigil"]})),
    ] {
        ws.write("src/empty.rs", b"");
        let mut config: Value = serde_json::from_str(support::CONFIG).unwrap();
        if let Some(implementation) = implementation {
            config["tools"] = json!({"sigilc":{"implementation":implementation}});
        }
        ws.write(".sigil/config.json", config.to_string().as_bytes());
        let (code, _, error) = prepare(&ws, &out);
        assert_eq!(code, 2, "{error}");
        assert!(!out.exists());
    }
}

#[test]
fn unrelated_file_content_and_presentation_handles_do_not_move_grounding() {
    use sigilc::align::prepare::{design_names, load};
    let ws = workspace();
    let store = ws.0.join(".sigil");
    let mut first = load(&ws.0, &store).unwrap();
    let file = first
        .selection
        .implementation
        .files
        .iter()
        .find(|f| f.path == "src/search.rs")
        .unwrap();
    let binding = first.request(&ws.0, file).unwrap().binding;
    for row in &mut first.linked.request.rows {
        row.handle = "#999".into();
        row.context = true;
    }
    let names = design_names(&first.linked, &first.selection).unwrap();
    for (before, after) in first.names.iter().zip(names.iter()) {
        assert_eq!(before.digest, after.digest);
        assert_eq!(before.membership_digest, after.membership_digest);
    }
    ws.write(
        "src/panel.ts",
        b"export function render() { return 'changed'; }\n",
    );
    let second = load(&ws.0, &store).unwrap();
    let file = second
        .selection
        .implementation
        .files
        .iter()
        .find(|f| f.path == "src/search.rs")
        .unwrap();
    assert_eq!(binding, second.request(&ws.0, file).unwrap().binding);
    assert_ne!(first.selection.fingerprint, second.selection.fingerprint);
}
