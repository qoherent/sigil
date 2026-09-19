mod support;
use serde_json::{Value, json};
use std::process::{Command, Output};
use support::Workspace;

fn workspace() -> Workspace {
    let root = Workspace::new();
    root.write("a.sigil", b"component A { goal { Describe A. } }");
    let mut input = serde_json::to_value(root.input(&["a.sigil"], json!([]))).unwrap();
    input["entities"] = json!([{"id":"urn:sigil:component:a.sigil:A","type":"Component","label":"A","source":"a.sigil","owner":null,"exported":true}]);
    input["units"] = json!([{"id":"urn:sigil:unit:a.sigil:1:1","source":"a.sigil","owner":"urn:sigil:component:a.sigil:A","form":"component","section":"goal","tag":null,"range":{"start":{"line":1,"column":1},"end":{"line":1,"column":35}}}]);
    root.write("frontend.json", &serde_json::to_vec(&input).unwrap());
    root
}
fn run(root: &Workspace, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(args)
        .args(["--root", ".", "--frontend", "frontend.json"])
        .current_dir(&root.0)
        .output()
        .unwrap()
}
fn result(root: &Workspace, args: &[&str], code: i32) -> Value {
    let output = run(root, args);
    assert_eq!(
        output.status.code(),
        Some(code),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}
fn publish(root: &Workspace, out: &str, turtle: &str) {
    result(
        root,
        &["prepare", "design", "--source", "a.sigil", "--out", out],
        0,
    );
    root.write("facts.ttl", turtle.as_bytes());
    result(
        root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--binding",
            &format!("{out}/binding.json"),
            "--turtle",
            "facts.ttl",
        ],
        0,
    );
}
const PREFIX: &str =
    "@prefix s: <https://sigil.dev/ontology/1#> . @prefix a: <urn:sigil:component:a.sigil:> . ";

#[test]
fn design_cli_distinguishes_missing_empty_interpreted_and_disjoint_worlds() {
    let root = workspace();
    let missing = result(&root, &["compile", "design"], 0);
    assert_eq!(missing["world"]["state"], "Loose");
    assert_eq!(missing["all_fresh"], false);
    let unresolved = missing["diagnostics"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["code"] == "DESIGN_UNRESOLVED")
        .unwrap();
    assert_eq!(unresolved["severity"], "warning");
    assert_eq!(unresolved["locations"][0]["source"], "a.sigil");
    assert_eq!(unresolved["locations"][0]["range"]["end"]["column"], 35);
    assert_eq!(unresolved["witness"]["table"], "design-unresolved");
    assert!(missing["catalog"].is_null());
    let stale = result(&root, &["stale", "design"], 1);
    assert_eq!(stale["sources"][0]["status"], "missing");
    publish(&root, "first", "");
    let empty = result(&root, &["compile", "design"], 0);
    assert_eq!(empty["world"]["state"], "Loose");
    assert_eq!(empty["all_fresh"], true);
    let provisional = result(&root, &["entities"], 0);
    assert_eq!(provisional["status"], "provisional");
    assert_eq!(
        provisional["catalog"]["entries"].as_array().unwrap().len(),
        1
    );
    publish(
        &root,
        "second",
        &format!(
            "{PREFIX}<urn:sigil:unit:a.sigil:1:1> s:from a:A; s:relation \"uses\"; s:target a:A; s:expected false ."
        ),
    );
    let interpreted = result(&root, &["compile", "design"], 0);
    assert_eq!(interpreted["world"]["state"], "Coherent");
    assert_eq!(interpreted["diagnostics"]["items"], json!([]));
    let authoritative = result(&root, &["entities"], 0);
    assert_eq!(authoritative["status"], "authoritative");
    assert_eq!(
        provisional["catalog"]["fingerprint"],
        authoritative["catalog"]["fingerprint"]
    );
    assert_ne!(
        provisional["design_fingerprint"],
        authoritative["design_fingerprint"]
    );
    publish(
        &root,
        "third",
        &format!("{PREFIX}a:A s:uses a:A; s:excludes a:A ."),
    );
    let disjoint = result(&root, &["compile", "design"], 1);
    assert_eq!(disjoint["world"]["state"], "Disjoint");
    assert_eq!(
        disjoint["diagnostics"]["items"][0]["code"],
        "DESIGN_CONTRADICTION"
    );
    assert_eq!(disjoint["diagnostics"]["items"][0]["severity"], "error");
    assert_eq!(
        disjoint["diagnostics"]["items"][0]["locations"][0]["source"],
        "a.sigil"
    );
    assert!(
        !disjoint["assertion_sources"]
            .as_object()
            .unwrap()
            .is_empty()
    );
    assert!(result(&root, &["entities"], 1)["catalog"].is_null());
}

#[test]
fn design_cli_rejects_stale_bindings_and_unbound_or_foreign_identity() {
    let root = workspace();
    result(
        &root,
        &["prepare", "design", "--source", "a.sigil", "--out", "binding"],
        0,
    );
    root.write(
        "facts.ttl",
        format!("{PREFIX}<urn:sigil:entity:foreign.sigil:X> a s:State; s:label \"X\" .").as_bytes(),
    );
    let invalid = run(
        &root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--binding",
            "binding/binding.json",
            "--turtle",
            "facts.ttl",
        ],
    );
    assert_eq!(invalid.status.code(), Some(3));
    assert!(invalid.stdout.is_empty());

    root.write(
        "facts.ttl",
        format!("{PREFIX}<urn:sigil:unit:a.sigil:1:1> a s:Case .").as_bytes(),
    );
    let reserved = run(
        &root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--binding",
            "binding/binding.json",
            "--turtle",
            "facts.ttl",
        ],
    );
    assert_eq!(reserved.status.code(), Some(3));
    let reserved_stderr = String::from_utf8_lossy(&reserved.stderr);
    assert!(reserved_stderr.contains("hint: reserved authored units"));
    assert!(reserved_stderr.contains("exactly one rdf:type sigil:Contract"));
    assert!(reserved_stderr.contains("attach section/description to that Contract resource"));

    root.write(
        "facts.ttl",
        format!("{PREFIX}<urn:sigil:unit:a.sigil:1:1> s:owner a:A .").as_bytes(),
    );
    let owner = run(
        &root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--binding",
            "binding/binding.json",
            "--turtle",
            "facts.ttl",
        ],
    );
    assert_eq!(owner.status.code(), Some(3));
    assert!(String::from_utf8_lossy(&owner.stderr).contains("sigil:from for unit ownership"));

    root.write(
        "facts.ttl",
        b"<urn:sigil:component:a.sigil:A> <https://example.invalid/uses> <urn:sigil:component:a.sigil:A> .",
    );
    let namespace = run(
        &root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--binding",
            "binding/binding.json",
            "--turtle",
            "facts.ttl",
        ],
    );
    assert_eq!(namespace.status.code(), Some(3));
    let namespace_stderr = String::from_utf8_lossy(&namespace.stderr);
    assert!(namespace_stderr.contains("unknown predicate namespace"));
    assert!(namespace_stderr.contains("use the exact Sigil ontology namespace"));

    root.write(
        "facts.ttl",
        b"@prefix s: <https://sigil.dev/ontology/1#> . <urn:sigil:unit:a.sigil:1:1> s:from <urn:sigil:component:a.sigil:A> ;",
    );
    let malformed = run(
        &root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--binding",
            "binding/binding.json",
            "--turtle",
            "facts.ttl",
        ],
    );
    assert_eq!(malformed.status.code(), Some(3));
    let malformed_stderr = String::from_utf8_lossy(&malformed.stderr);
    assert!(
        malformed_stderr.contains("hint: return RDF 1.1 Turtle only"),
        "{malformed_stderr}"
    );
    assert!(malformed_stderr.contains("terminate every triple with '.'"));

    root.write(
        "facts.ttl",
        b"@prefix s: <https://sigil.dev/ontology/1#> . <urn:sigil:unit:a.sigil:1:1> s:from <urn:sigil:component:a.sigil:A B> .",
    );
    let invalid_iri = run(
        &root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--binding",
            "binding/binding.json",
            "--turtle",
            "facts.ttl",
        ],
    );
    assert_eq!(invalid_iri.status.code(), Some(3));
    assert!(
        String::from_utf8_lossy(&invalid_iri.stderr).contains("hint: return RDF 1.1 Turtle only")
    );

    root.write(
        "facts.ttl",
        format!("{PREFIX}a:A a s:Invented .").as_bytes(),
    );
    let unknown_class = run(
        &root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--binding",
            "binding/binding.json",
            "--turtle",
            "facts.ttl",
        ],
    );
    assert_eq!(unknown_class.status.code(), Some(3));
    let unknown_class_stderr = String::from_utf8_lossy(&unknown_class.stderr);
    assert!(unknown_class_stderr.contains("unknown Sigil class"));
    assert!(unknown_class_stderr.contains("use rdf:type with one class IRI"));

    root.write("facts.ttl", format!("{PREFIX}a:A a s:State .").as_bytes());
    let foreign = run(
        &root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--binding",
            "binding/binding.json",
            "--turtle",
            "facts.ttl",
        ],
    );
    assert_eq!(foreign.status.code(), Some(3));
    assert!(
        String::from_utf8_lossy(&foreign.stderr)
            .contains("dependency identities are foreign references")
    );

    root.write(
        "facts.ttl",
        format!("{PREFIX}a:A s:uses <urn:missing> .").as_bytes(),
    );
    result(
        &root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--binding",
            "binding/binding.json",
            "--turtle",
            "facts.ttl",
        ],
        0,
    );
    let unknown = run(&root, &["compile", "design"]);
    assert_eq!(unknown.status.code(), Some(3));
    assert!(unknown.stdout.is_empty());
    assert!(
        String::from_utf8_lossy(&unknown.stderr)
            .contains("hint: reference only the exact prepared")
    );
    root.write("a.sigil", b"edited after preparation");
    let stale = run(
        &root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--binding",
            "binding/binding.json",
            "--turtle",
            "facts.ttl",
        ],
    );
    assert_eq!(stale.status.code(), Some(3));
    let stale_stderr = String::from_utf8_lossy(&stale.stderr);
    assert!(stale_stderr.contains("frontend source changed"));
    assert!(stale_stderr.contains("recapture the structural Design export"));
}

#[test]
fn preparation_omits_unbound_design_files_and_never_overwrites_a_directory() {
    let root = workspace();
    root.write("unrelated.sigil", b"secret unrelated meaning");
    let mut input: Value =
        serde_json::from_slice(&std::fs::read(root.0.join("frontend.json")).unwrap()).unwrap();
    input["sources"]
        .as_array_mut()
        .unwrap()
        .push(json!({"path":"unrelated.sigil","text":"secret unrelated meaning"}));
    root.write("frontend.json", &serde_json::to_vec(&input).unwrap());
    result(
        &root,
        &["prepare", "design", "--source", "a.sigil", "--out", "binding"],
        0,
    );
    let prepared = std::fs::read_to_string(root.0.join("binding/design.json")).unwrap();
    assert!(!prepared.contains("secret"));
    assert!(!prepared.contains("unrelated.sigil"));
    assert!(root.0.join("binding/binding.json").is_file());
    assert!(root.0.join("binding/ontology.json").is_file());
    assert!(!root.0.join("binding/evidence.json").exists());
    assert_eq!(
        run(
            &root,
            &["prepare", "design", "--source", "a.sigil", "--out", "binding"]
        )
        .status
        .code(),
        Some(3)
    );
    assert_eq!(
        run(&root, &["compile", "design", "--model", "anything"])
            .status
            .code(),
        Some(2)
    );
}

#[test]
fn empty_scope_and_runtime_limits_never_fabricate_success() {
    let root = Workspace::new();
    root.write(
        "frontend.json",
        &serde_json::to_vec(&root.input(&[], json!([]))).unwrap(),
    );
    assert_eq!(run(&root, &["compile", "design"]).status.code(), Some(3));
    let empty = result(&root, &["compile", "design", "--allow-empty"], 0);
    assert_eq!(empty["intentional_empty"], true);
    let root = workspace();
    root.write("limits.json", b"{\"maxRows\":0}");
    let limited = run(&root, &["compile", "design", "--limits", "limits.json"]);
    assert_eq!(limited.status.code(), Some(3));
    assert!(limited.stdout.is_empty());
}

#[test]
fn deleted_index_entries_are_reported_and_never_assembled() {
    let root = workspace();
    publish(&root, "binding", "");
    std::fs::remove_file(root.0.join("a.sigil")).unwrap();
    root.write(
        "frontend.json",
        &serde_json::to_vec(&root.input(&[], json!([]))).unwrap(),
    );
    let stale = result(&root, &["stale", "design"], 1);
    assert_eq!(stale["sources"][0]["status"], "deleted");
    let empty = result(&root, &["compile", "design", "--allow-empty"], 0);
    assert!(empty["sources"].as_array().unwrap().is_empty());
    assert!(
        empty["catalog"]["catalog"]["entries"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
