mod support;
use serde_json::{Value, json};
use std::process::Command;
use support::Workspace;

fn workspace() -> Workspace {
    let root = Workspace::new();
    let fixture = fixture();
    for item in fixture["sources"]
        .as_array()
        .unwrap()
        .iter()
        .chain(fixture["context"].as_array().unwrap())
    {
        if let Some(text) = item["text"].as_str() {
            root.write(item["path"].as_str().unwrap(), text.as_bytes());
        }
    }
    root.write("main.any", b"implementation target");
    root.write("neighbor.any", b"private neighbor");
    frontend(&root, &["a.sigil", "b.sigil", "c.sigil"]);
    scope(&root, &["a.sigil"]);
    root
}
fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../core/tests/fixtures/design-scope-080.json"
    ))
    .unwrap()
}
fn frontend(root: &Workspace, paths: &[&str]) {
    let mut input = fixture();
    input["sources"]
        .as_array_mut()
        .unwrap()
        .retain(|s| paths.contains(&s["path"].as_str().unwrap()));
    for field in [
        "entities",
        "units",
        "imports",
        "groups",
        "introductions",
        "references",
        "links",
    ] {
        input[field]
            .as_array_mut()
            .unwrap()
            .retain(|r| paths.contains(&r["source"].as_str().unwrap()));
    }
    root.write("frontend.json", &serde_json::to_vec(&input).unwrap());
}
fn scope(root: &Workspace, paths: &[&str]) {
    root.write(
        "scope.json",
        &serde_json::to_vec(
            &json!({"version":1,"design":{"paths":paths},"implementation":{"paths":["main.any"]}}),
        )
        .unwrap(),
    );
}
fn run(root: &Workspace, args: &[&str], code: i32) -> Value {
    let out = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(args)
        .args(["--root", ".", "--frontend", "frontend.json"])
        .current_dir(&root.0)
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(code),
        "args {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    if out.stdout.is_empty() {
        assert!(code >= 2);
        Value::Null
    } else {
        serde_json::from_slice(&out.stdout).unwrap()
    }
}
fn scoped(root: &Workspace, args: &[&str], code: i32) -> Value {
    let mut args = args.to_vec();
    args.extend(["--scope", "scope.json"]);
    run(root, &args, code)
}
fn publish(root: &Workspace, side: &str, source: &str, out: &str, body: &str, use_scope: bool) {
    let mut args = vec!["prepare", side, "--source", source, "--out", out];
    if use_scope {
        args.extend(["--scope", "scope.json"]);
    }
    run(root, &args, 0);
    // Fixed test interpretations account for every authored Facet explicitly.
    // These statements are supplied by this fixture, never inferred from imports.
    let mut coverage = String::new();
    if side == "design" {
        for u in fixture()["units"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|u| u["source"] == source)
        {
            let id = u["id"].as_str().unwrap();
            let owner = u["owner"].as_str().unwrap();
            coverage.push_str(&format!("<{owner}> s:uses <{owner}> . <{id}> a s:Contract; s:from <{owner}>; s:relation \"uses\"; s:target <{owner}>; s:expected true .\n"));
        }
    } else {
        coverage.push_str("<urn:sigil:component:a.sigil:A> s:uses <urn:sigil:component:a.sigil:A> . <urn:sigil:component:b.sigil:B> s:uses <urn:sigil:component:b.sigil:B> .");
    }
    root.write(
        "facts.ttl",
        format!("@prefix s: <https://sigil.dev/ontology/1#> . {body} {coverage}").as_bytes(),
    );
    let binding = format!("{out}/binding.json");
    let mut args = vec![
        "ingest",
        side,
        "--source",
        source,
        "--binding",
        &binding,
        "--turtle",
        "facts.ttl",
    ];
    if use_scope {
        args.extend(["--scope", "scope.json"]);
    }
    run(root, &args, 0);
}
const PROVIDES: &str =
    "<urn:sigil:component:a.sigil:A> s:provides <urn:sigil:component:b.sigil:B> .";

#[test]
fn scoped_pipeline_excludes_unrelated_contradictions_and_reuses_objects_across_reordering() {
    let root = workspace();
    let initial = scoped(&root, &["scope"], 0);
    assert_eq!(
        initial["scope"]["design"]["focus_order"],
        json!(["a.sigil", "b.sigil"])
    );
    assert_eq!(
        initial["scope"]["implementation_sources"],
        json!(["main.any"])
    );
    assert!(scoped(&root, &["compare"], 3)["comparison"].is_null());
    scoped(
        &root,
        &[
            "prepare", "design", "--source", "c.sigil", "--out", "rejected",
        ],
        2,
    );
    scoped(
        &root,
        &[
            "prepare",
            "implementation",
            "--source",
            "neighbor.any",
            "--out",
            "rejected",
        ],
        2,
    );
    assert!(!root.0.join("rejected").exists());
    publish(&root, "design", "a.sigil", "a", PROVIDES, true);
    publish(&root, "design", "b.sigil", "b", "", true);
    publish(
        &root,
        "design",
        "c.sigil",
        "c",
        "<urn:sigil:component:c.sigil:C> s:uses <urn:sigil:component:c.sigil:C>; s:excludes <urn:sigil:component:c.sigil:C> .",
        false,
    );
    assert_eq!(
        run(&root, &["compile", "design"], 1)["world"]["state"],
        "Disjoint"
    );
    assert_eq!(
        scoped(&root, &["compile", "design"], 0)["world"]["state"],
        "Coherent"
    );
    let before = scoped(&root, &["entities"], 0);
    assert_eq!(before["catalog"]["entries"].as_array().unwrap().len(), 4);
    assert_eq!(
        scoped(&root, &["compare"], 0)["comparison"]["implementation"],
        "Converged"
    );
    publish(&root, "implementation", "main.any", "i", PROVIDES, true);
    let closed = scoped(&root, &["compile", "implementation"], 0);
    assert_eq!(closed["comparison"]["implementation"], "Closed");
    scope(&root, &["b.sigil", "a.sigil"]);
    let reordered = scoped(&root, &["compare"], 0);
    assert_eq!(reordered["comparison"]["implementation"], "Closed");
    assert_eq!(
        reordered["scope"]["design"]["focus_order"],
        json!(["b.sigil", "a.sigil"])
    );
    assert_eq!(
        closed["scope"]["membership_fingerprint"],
        reordered["scope"]["membership_fingerprint"]
    );
    assert_ne!(
        closed["scope"]["order_fingerprint"],
        reordered["scope"]["order_fingerprint"]
    );
    assert_eq!(
        closed["design"]["design_fingerprint"],
        reordered["design"]["design_fingerprint"]
    );
    assert_eq!(
        closed["implementation"]["input_fingerprint"],
        reordered["implementation"]["input_fingerprint"]
    );
    scope(&root, &["b.sigil"]);
    let narrow = scoped(&root, &["stale", "implementation"], 1);
    assert_eq!(narrow["sources"][0]["status"], "entity-catalog-invalidated");
    scope(&root, &["a.sigil"]);
    scoped(&root, &["stale", "implementation"], 0);
    std::fs::remove_file(root.0.join("c.sigil")).unwrap();
    frontend(&root, &["a.sigil", "b.sigil"]);
    scoped(&root, &["stale", "design"], 0);
    let full = run(&root, &["stale", "design"], 1);
    assert!(
        full["sources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["status"] == "deleted")
    );
}

#[test]
fn scoped_bindings_keep_three_interpreter_inputs_and_gate_exits() {
    let root = workspace();
    publish(&root, "design", "a.sigil", "a", PROVIDES, true);
    publish(&root, "design", "b.sigil", "b", "", true);
    let prepared = scoped(
        &root,
        &[
            "prepare",
            "implementation",
            "--source",
            "main.any",
            "--out",
            "worker",
        ],
        0,
    );
    assert_eq!(prepared["inputs"].as_array().unwrap().len(), 3);
    let catalog = std::fs::read_to_string(root.0.join("worker/catalog.json")).unwrap();
    for forbidden in ["scope", "focus_order", "provides", "neighbor", "binding"] {
        assert!(!catalog.contains(forbidden));
    }
    root.write(
        "facts.ttl",
        format!("@prefix s: <https://sigil.dev/ontology/1#> . {PROVIDES} <urn:sigil:component:a.sigil:A> s:uses <urn:sigil:component:b.sigil:B> .").as_bytes(),
    );
    scope(&root, &["b.sigil", "a.sigil"]);
    scoped(
        &root,
        &[
            "ingest",
            "implementation",
            "--source",
            "main.any",
            "--binding",
            "worker/binding.json",
            "--turtle",
            "facts.ttl",
        ],
        0,
    );
    publish(
        &root,
        "design",
        "a.sigil",
        "changed",
        "<urn:sigil:component:a.sigil:A> s:excludes <urn:sigil:component:b.sigil:B> .",
        true,
    );
    for args in [vec!["compare"], vec!["compile", "implementation"]] {
        assert_eq!(
            scoped(&root, &args, 1)["comparison"]["implementation"],
            "Drift"
        );
    }
}

#[test]
fn scope_inspection_rejects_conflicts_empty_and_stale_inputs_without_semantic_success() {
    let root = workspace();
    run(&root, &["scope"], 2);
    scoped(&root, &["compare", "--selection", "ignored.json"], 2);
    scoped(&root, &["compile", "design", "--allow-empty"], 2);
    scope(&root, &[]);
    scoped(&root, &["scope"], 3);
    scope(&root, &["missing.sigil"]);
    scoped(&root, &["scope"], 3);
    scope(&root, &["a.sigil", "a.sigil"]);
    scoped(&root, &["scope"], 3);
    scope(&root, &["a.sigil"]);
    root.write("a.sigil", b"edited");
    scoped(&root, &["scope"], 3);
    root.write("scope.json",br#"{"version":1,"design":{"paths":[],"allowEmpty":true},"implementation":{"include":["no.files"],"allowEmpty":true}}"#);
    let empty = scoped(&root, &["compare"], 0);
    assert!(
        empty["scope"]["design"]["intentional_empty"]
            .as_bool()
            .unwrap()
    );
    assert!(
        empty["implementation"]["intentional_empty"]
            .as_bool()
            .unwrap()
    );
}
