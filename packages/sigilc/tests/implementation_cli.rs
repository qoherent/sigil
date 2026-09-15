mod support;
use serde_json::{Value, json};
use std::process::Command;
use support::Workspace;

fn workspace() -> Workspace {
    let root = Workspace::new();
    root.write("a.sigil", b"component A {} component B {}");
    root.write("main.rs", b"\xff\0direct target bytes");
    root.write("neighbor.py", b"secret neighbor body");
    let mut input = serde_json::to_value(root.input(&["a.sigil"], json!([]))).unwrap();
    input["entities"] = json!(
        ["A", "B"]
            .iter()
            .map(|name| support::component("a.sigil", name, "component A {} component B {}"))
            .collect::<Vec<_>>()
    );
    root.write("frontend.json", &serde_json::to_vec(&input).unwrap());
    root.write("selection.json", br#"{"paths":["main.rs"]}"#);
    root
}
fn run(root: &Workspace, args: &[&str], expected: i32) -> Value {
    let out = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(args)
        .args(["--root", ".", "--frontend", "frontend.json"])
        .current_dir(&root.0)
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(expected),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    if out.stdout.is_empty() {
        assert!(expected >= 2);
        Value::Null
    } else {
        serde_json::from_slice(&out.stdout).unwrap()
    }
}
fn publish(root: &Workspace, side: &str, out: &str, body: &str) {
    let source = if side == "design" {
        "a.sigil"
    } else {
        "main.rs"
    };
    run(
        root,
        &["prepare", side, "--source", source, "--out", out],
        0,
    );
    root.write("facts.ttl",format!("@prefix s: <https://sigil.dev/ontology/1#> . @prefix : <urn:sigil:component:a.sigil:> . {body}").as_bytes());
    run(
        root,
        &[
            "ingest",
            side,
            "--source",
            source,
            "--binding",
            &format!("{out}/binding.json"),
            "--turtle",
            "facts.ttl",
        ],
        0,
    );
}

#[test]
fn independent_cli_moves_from_unknown_to_closed_and_detects_relationship_only_drift() {
    let root = workspace();
    publish(&root, "design", "design1", ":A s:provides :B .");
    let missing = run(&root, &["compare", "--selection", "selection.json"], 0);
    assert_eq!(missing["comparison"]["implementation"], "Converged");
    assert!(
        missing["diagnostics"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["code"] == "IMPLEMENTATION_UNRESOLVED" && d["severity"] == "warning")
    );
    publish(&root, "implementation", "empty", "");
    let empty = run(
        &root,
        &["compile", "implementation", "--selection", "selection.json"],
        0,
    );
    assert_eq!(empty["comparison"]["implementation"], "Converged");
    assert_eq!(empty["implementation"]["all_fresh"], true);
    publish(
        &root,
        "implementation",
        "full",
        ":A s:provides :B; s:uses :B .",
    );
    let closed = run(&root, &["compare", "--selection", "selection.json"], 0);
    assert_eq!(closed["comparison"]["implementation"], "Closed");
    assert_eq!(closed["diagnostics"]["items"], json!([]));
    assert_eq!(
        run(
            &root,
            &["compile", "implementation", "--selection", "selection.json"],
            0
        )["comparison"]["implementation"],
        "Closed"
    );
    publish(&root, "design", "design2", ":A s:excludes :B .");
    let drift = run(&root, &["compare", "--selection", "selection.json"], 1);
    assert_eq!(drift["comparison"]["implementation"], "Drift");
    let disagreement = drift["diagnostics"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["code"] == "IMPLEMENTATION_DISAGREEMENT")
        .unwrap();
    assert_eq!(disagreement["severity"], "error");
    assert_eq!(disagreement["witness"]["obligation"][2], "uses");
    assert_eq!(disagreement["witness"]["obligation"][4], "false");
    assert_eq!(disagreement["witness"]["because"][0][3], "asserted");
    let locations = disagreement["locations"].as_array().unwrap();
    assert!(
        locations
            .iter()
            .any(|l| l["side"] == "design" && l["source"] == "a.sigil")
    );
    assert!(locations.iter().any(|l| l["side"] == "implementation"
        && l["source"] == "main.rs"
        && l.get("range").is_none()));
    assert_eq!(
        run(
            &root,
            &["compile", "implementation", "--selection", "selection.json"],
            1
        )["comparison"]["implementation"],
        "Drift"
    );
    assert_eq!(
        closed["implementation"]["input_fingerprint"],
        drift["implementation"]["input_fingerprint"]
    );
    assert_eq!(drift["implementation"]["sources"][0]["status"], "fresh");
    root.write("main.rs", b"modified source");
    let stale = run(
        &root,
        &["stale", "implementation", "--selection", "selection.json"],
        1,
    );
    assert_eq!(stale["sources"][0]["status"], "modified");
    let unknown = run(&root, &["compare", "--selection", "selection.json"], 0);
    assert_eq!(unknown["comparison"]["implementation"], "Converged");
}

#[test]
fn worker_gets_only_three_bound_inputs_and_neighbor_edits_do_not_reject_its_binding() {
    let root = workspace();
    publish(&root, "design", "design", ":A s:provides :B .");
    let prepared = run(
        &root,
        &[
            "prepare",
            "implementation",
            "--source",
            "main.rs",
            "--out",
            "worker",
        ],
        0,
    );
    assert_eq!(prepared["inputs"].as_array().unwrap().len(), 3);
    assert!(!root.0.join("worker/evidence.json").exists());
    assert_eq!(
        std::fs::read(root.0.join("worker/source")).unwrap(),
        b"\xff\0direct target bytes"
    );
    let catalog = std::fs::read_to_string(root.0.join("worker/catalog.json")).unwrap();
    for forbidden in [
        "provides",
        "secret",
        "description",
        "design_fingerprint",
        "authoritative",
    ] {
        assert!(!catalog.contains(forbidden));
    }
    root.write("neighbor.py", b"changed neighbor exports");
    root.write("facts.ttl", b"");
    run(
        &root,
        &[
            "ingest",
            "implementation",
            "--source",
            "main.rs",
            "--binding",
            "worker/binding.json",
            "--turtle",
            "facts.ttl",
        ],
        0,
    );
    run(
        &root,
        &[
            "ingest",
            "implementation",
            "--source",
            "main.rs",
            "--binding",
            "worker/binding.json",
            "--turtle",
            "facts.ttl",
        ],
        3,
    );
    run(
        &root,
        &[
            "prepare",
            "implementation",
            "--source",
            ".sigil/worlds/index.json",
            "--out",
            "forbidden",
        ],
        2,
    );
    run(&root, &["compare"], 2);
}

#[test]
fn missing_design_catalog_never_prepares_or_compares_implementation() {
    let root = workspace();
    let result = run(
        &root,
        &[
            "prepare",
            "implementation",
            "--source",
            "main.rs",
            "--out",
            "worker",
        ],
        3,
    );
    assert!(result["implementation"].is_null());
    assert_eq!(
        result["diagnostics"]["items"][0]["code"],
        "COMPARISON_UNAVAILABLE"
    );
    assert!(!root.0.join("worker").exists());
    assert!(run(&root, &["compare", "--selection", "selection.json"], 3)["comparison"].is_null());
    publish(&root, "design", "disjoint", ":A s:uses :B; s:excludes :B .");
    let unavailable = run(
        &root,
        &["compile", "implementation", "--selection", "selection.json"],
        3,
    );
    assert_eq!(unavailable["design"]["world"]["state"], "Disjoint");
    assert!(unavailable["implementation"].is_null());
    assert!(unavailable["comparison"].is_null());
    assert_eq!(
        unavailable["diagnostics"]["items"][0]["code"],
        "COMPARISON_UNAVAILABLE"
    );
    assert_eq!(
        unavailable["design"]["diagnostics"]["items"][0]["code"],
        "DESIGN_CONTRADICTION"
    );
}
