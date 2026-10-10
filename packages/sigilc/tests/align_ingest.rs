mod support;

use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
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

#[test]
fn malformed_or_invented_rows_refuse_only_their_file() {
    for bad in [
        "(element \"panel\")",
        "(element \"panel\" \"function\")\n(realizes \"panel\" \"RetryPolicy\")",
    ] {
        let ws = workspace();
        let (_, inputs) = prepare(&ws, "first");
        let good = ingest(
            &ws,
            &inputs[1].1,
            "(element \"search\" \"function\")\n(realizes \"search\" \"SearchService\")",
        );
        assert_eq!(good.0, 0, "{:?}", good);
        let refused = ingest(&ws, &inputs[0].1, bad);
        assert_eq!(refused.0, 1, "{:?}", refused);
        assert_eq!(refused.1["refusals"][0]["path"], "src/panel.rs");
        assert_eq!(refused.1["unreadUnits"], 1);
        let (summary, next) = prepare(&ws, "next");
        assert_eq!(summary["requestedUnits"], 1);
        assert_eq!(next[0].0, "src/panel.rs");
    }
}

#[test]
fn qualified_and_unique_names_admit_but_ambiguous_bare_labels_list_alternatives() {
    let ws = workspace();
    let (_, inputs) = prepare(&ws, "first");
    let bad = ingest(
        &ws,
        &inputs[1].1,
        "(element \"search\" \"function\")\n(realizes \"search\" \"search results\")",
    );
    assert_eq!(bad.0, 1, "{:?}", bad);
    let reason = bad.1["refusals"][0]["reason"].as_str().unwrap();
    assert!(
        reason.contains("Panel::search results")
            && reason.contains("SearchService::search results"),
        "{reason}"
    );
    let good = ingest(
        &ws,
        &inputs[1].1,
        "(element \"search\" \"function\")\n(realizes \"search\" \"SearchService\")\n(realizes \"search\" \"SearchService::search results\")\n(act \"search\" \"uses\" \"query\")\n(measure \"search\" \"latencyMs\" \"1.5\")",
    );
    assert_eq!(good.0, 0, "{:?}", good);
    assert_eq!(good.1["storedUnits"], 1);
    assert!(ws.0.join(".sigil/claims/implementation").is_dir());
    let paths: Vec<_> = fs::read_dir(ws.0.join(".sigil/claims/implementation"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(paths.len(), 1);
    let bytes = fs::read(&paths[0]).unwrap();
    let repeat = ingest(
        &ws,
        &inputs[1].1,
        "(element \"search\" \"function\")\n(realizes \"search\" \"SearchService\")\n(realizes \"search\" \"SearchService::search results\")\n(act \"search\" \"uses\" \"query\")\n(measure \"search\" \"latencyMs\" \"1.5\")",
    );
    assert_eq!(repeat.0, 0, "{:?}", repeat);
    assert_eq!(repeat.1["storedUnits"], 0);
    assert_eq!(bytes, fs::read(&paths[0]).unwrap());
}

#[test]
fn executable_or_nested_answers_are_refused_whole() {
    for bad in [
        "(rule ((x a)) ((y a)))",
        "(realizes \"search\" (name \"SearchService\"))",
    ] {
        let ws = workspace();
        let (_, inputs) = prepare(&ws, "first");
        let answer = format!("(element \"search\" \"function\")\n{bad}");
        let refused = ingest(&ws, &inputs[1].1, &answer);
        assert_eq!(refused.0, 1, "{:?}", refused);
        assert_eq!(refused.1["storedUnits"], 0);
        assert_eq!(prepare(&ws, "next").0["requestedUnits"], 2);
    }
}

#[test]
fn empty_or_elementless_answers_remain_unread() {
    for answer in ["", "(realizes \"search\" \"SearchService\")"] {
        let ws = workspace();
        let (_, inputs) = prepare(&ws, "first");
        let result = ingest(&ws, &inputs[1].1, answer);
        assert_eq!(result.0, 1, "{:?}", result);
        assert_eq!(result.1["unreadUnits"], 1);
        assert_eq!(result.1["storedUnits"], 0);
        assert_eq!(prepare(&ws, "next").0["requestedUnits"], 2);
    }
}

#[test]
fn actions_cannot_name_another_files_element() {
    let ws = workspace();
    let (_, inputs) = prepare(&ws, "first");
    let result = ingest(
        &ws,
        &inputs[1].1,
        "(element \"search\" \"function\")\n(act \"search\" \"uses\" \"src/panel.rs::panel\")",
    );
    assert_eq!(result.0, 1, "{:?}", result);
    assert!(
        result.1["refusals"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("src/panel.rs::panel")
    );
}

#[test]
fn edited_file_binding_names_content_hash_and_keeps_neighbor_binding_valid() {
    let ws = workspace();
    let (_, inputs) = prepare(&ws, "first");
    ws.write("src/panel.rs", b"fn changed() {}\n");
    let result = ingest(&ws, &inputs[0].1, "(element \"panel\" \"function\")");
    assert_eq!(result.0, 2, "{:?}", result);
    assert!(result.2.contains("contentHash"), "{:?}", result);
    let neighbor = ingest(&ws, &inputs[1].1, "(element \"search\" \"function\")");
    assert_eq!(neighbor.0, 0, "{:?}", neighbor);
}

#[test]
fn stdin_is_supported_for_one_input_and_repeat_option_is_absent() {
    let ws = workspace();
    let (_, inputs) = prepare(&ws, "first");
    let binding = inputs[1].1.join("binding.json");
    let mut child = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args([
            "align",
            "ingest",
            "--root",
            ws.0.to_str().unwrap(),
            "--binding",
            binding.to_str().unwrap(),
            "--claims",
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"(element \"search\" \"function\")")
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        run(&["align", "ingest", "--binding", "-", "--claims", "-"]).0,
        2
    );
    assert_eq!(run(&["align", "ingest", "--claims-repeat", "x"]).0, 2);
}

#[test]
fn every_binding_mismatch_names_its_field() {
    let ws = workspace();
    let (_, inputs) = prepare(&ws, "first");
    let binding = inputs[1].1.join("binding.json");
    let original: Value = serde_json::from_slice(&fs::read(&binding).unwrap()).unwrap();
    for (field, value) in [
        ("format", json!(99)),
        ("contentHash", json!("changed")),
        ("namesDigest", json!("changed")),
        ("selectionDigest", json!("changed")),
        ("guidanceFingerprint", json!("changed")),
        ("vocabularyGeneration", json!(99)),
        ("path", json!("src/missing.rs")),
    ] {
        let mut moved = original.clone();
        moved[field] = value;
        fs::write(&binding, serde_json::to_vec(&moved).unwrap()).unwrap();
        let result = ingest(&ws, &inputs[1].1, "(element \"search\" \"function\")");
        assert_eq!(result.0, 2, "{:?}", result);
        assert!(result.2.contains(field), "{field}: {:?}", result);
    }
}

#[test]
fn invalid_utf8_claims_are_a_file_refusal() {
    let ws = workspace();
    let (_, inputs) = prepare(&ws, "first");
    let directory = &inputs[1].1;
    fs::write(directory.join("result.egg"), b"\xff").unwrap();
    let result = run(&[
        "align",
        "ingest",
        "--root",
        ws.0.to_str().unwrap(),
        "--binding",
        directory.join("binding.json").to_str().unwrap(),
        "--claims",
        directory.join("result.egg").to_str().unwrap(),
    ]);
    assert_eq!(result.0, 1, "{:?}", result);
    assert_eq!(result.1["unreadUnits"], 1);
    assert!(
        result.1["refusals"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("UTF-8")
    );
}

#[test]
fn annotations_do_not_supply_mappings_and_tests_remain_observations() {
    let ws = workspace();
    ws.write(
        "src/search.rs",
        b"// @sigil implements search.sigil::SearchService\nfn search() {}\n",
    );
    let (_, inputs) = prepare(&ws, "first");
    let result = ingest(&ws, &inputs[1].1, "(element \"search\" \"function\")");
    assert_eq!(result.0, 0, "{:?}", result);
    assert_eq!(result.1["undesignedElements"], 1);
    let tests = ingest(
        &ws,
        &inputs[0].1,
        "(element \"checks\" \"test\")\n(realizes \"checks\" \"SearchService\")\n(realizes \"checks\" \"SearchService::search results\")",
    );
    assert_eq!(tests.0, 0, "{:?}", tests);
    assert_eq!(tests.1["undesignedElements"], 0);
    let workspace = sigilc::align::prepare::load(&ws.0, &ws.0.join(".sigil")).unwrap();
    let request = workspace
        .requests(&ws.0)
        .unwrap()
        .into_iter()
        .find(|request| request.binding.path == "src/panel.rs")
        .unwrap();
    let admitted = sigilc::align::memo::load(&ws.0.join(".sigil"), &request).unwrap();
    assert!(admitted.facts.iter().all(|fact| fact.kind == "test"));
    let stored: sigilc::align::memo::Stored = serde_json::from_slice(
        &fs::read(sigilc::align::memo::path(&ws.0.join(".sigil"), &request)).unwrap(),
    )
    .unwrap();
    assert!(stored.grounding.memberships.is_empty());
}
