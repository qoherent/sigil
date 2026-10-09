//! Interface-hash freshness through the command line (KTD7, AE5, AE7).
mod support;
use serde_json::{Value, json};
use std::process::{Command, Output};
use support::Workspace;

fn run(root: &Workspace, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(args)
        .args(["--root", "."])
        .current_dir(&root.0)
        .output()
        .unwrap()
}
fn result(root: &Workspace, args: &[&str], code: i32) -> Value {
    let output = run(root, args);
    assert_eq!(
        output.status.code(),
        Some(code),
        "{args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}
fn edit(root: &Workspace, path: &str, from: &str, to: &str) {
    let text = std::fs::read_to_string(root.0.join(path)).unwrap();
    assert!(text.contains(from), "{from} is in {path}");
    root.write(path, text.replacen(from, to, 1).as_bytes());
}
fn publish(root: &Workspace, source: &str) {
    let out = format!("prep-{}", source.trim_end_matches(".sigil"));
    let _ = std::fs::remove_dir_all(root.0.join(&out));
    result(
        root,
        &["prepare", "design", "--source", source, "--out", &out],
        0,
    );
    root.write("empty.ttl", b"");
    result(
        root,
        &[
            "ingest",
            "design",
            "--source",
            source,
            "--binding",
            &format!("{out}/binding.json"),
            "--turtle",
            "empty.ttl",
        ],
        0,
    );
}
fn statuses(root: &Workspace, code: i32) -> std::collections::BTreeMap<String, String> {
    result(root, &["stale", "design"], code)["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            (
                s["source"].as_str().unwrap().to_owned(),
                s["status"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}
/// Base (the provider) and Consumer, both ingested.
fn ingested() -> Workspace {
    let root = support::shared_workspace();
    publish(&root, "base.sigil");
    publish(&root, "consumer.sigil");
    let fresh = statuses(&root, 0);
    assert!(fresh.values().all(|s| s == "fresh"), "{fresh:?}");
    root
}

#[test]
fn editing_a_dependency_private_section_leaves_dependents_fresh() {
    let root = ingested();
    edit(
        &root,
        "base.sigil",
        "Preserve value and result.",
        "Preserve both.",
    );
    let after = statuses(&root, 1);
    assert_eq!(after["consumer.sigil"], "fresh");
    assert_eq!(after["base.sigil"], "modified");
}

#[test]
fn editing_a_dependency_interface_invalidates_its_importers() {
    let root = ingested();
    edit(
        &root,
        "base.sigil",
        "A *value* and *result* exist.",
        "A *value* and *result* exist always.",
    );
    let after = statuses(&root, 1);
    assert_eq!(after["consumer.sigil"], "dependency-invalidated");
    assert_eq!(after["base.sigil"], "modified");
}

#[test]
fn a_pure_reformat_keeps_the_source_and_its_importers_fresh() {
    let root = ingested();
    edit(
        &root,
        "consumer.sigil",
        "Serve the caller.",
        "Serve\n  the   caller.",
    );
    edit(
        &root,
        "base.sigil",
        "Own provider vocabulary.",
        "Own\nprovider   vocabulary.",
    );
    let after = statuses(&root, 0);
    assert!(after.values().all(|s| s == "fresh"), "{after:?}");
}

#[test]
fn editing_the_source_itself_marks_it_modified() {
    let root = ingested();
    edit(
        &root,
        "consumer.sigil",
        "Serve the caller.",
        "Serve every caller.",
    );
    let after = statuses(&root, 1);
    assert_eq!(after["consumer.sigil"], "modified");
    assert_eq!(after["base.sigil"], "fresh");
}

#[test]
fn prepare_presents_the_dependency_interface_and_nothing_else_of_it() {
    let root = support::shared_workspace();
    result(
        &root,
        &[
            "prepare",
            "design",
            "--source",
            "consumer.sigil",
            "--out",
            "prep",
        ],
        0,
    );
    let text = std::fs::read_to_string(root.0.join("prep/design.json")).unwrap();
    let design: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(design["target"]["path"], "consumer.sigil");
    let dependency = &design["dependencies"][0];
    assert_eq!(dependency["source"], "base.sigil");
    assert_eq!(dependency["units"][0]["id"], support::base_interface());
    assert_eq!(dependency["units"].as_array().unwrap().len(), 1);
    for private in [support::base_goal(), support::base_constraints()] {
        assert!(!text.contains(private));
    }
    assert!(!text.contains("Own provider vocabulary."));
    assert!(!text.contains("Preserve value and result."));
    // No Facet of Base but its interface appears among the presented rows.
    let units = design["units"].as_array().unwrap();
    assert!(units.iter().all(|u| u["source"] == "consumer.sigil"));
}

#[test]
fn ingest_rejects_a_binding_whose_inputs_moved_and_names_the_field() {
    let root = support::shared_workspace();
    result(
        &root,
        &[
            "prepare",
            "design",
            "--source",
            "consumer.sigil",
            "--out",
            "prep",
        ],
        0,
    );
    root.write("empty.ttl", b"");
    let ingest = |root: &Workspace| {
        run(
            root,
            &[
                "ingest",
                "design",
                "--source",
                "consumer.sigil",
                "--binding",
                "prep/binding.json",
                "--turtle",
                "empty.ttl",
            ],
        )
    };
    edit(
        &root,
        "base.sigil",
        "A *value* and *result* exist.",
        "A *value* and *result* exist always.",
    );
    let output = ingest(&root);
    assert_eq!(output.status.code(), Some(3));
    let message = String::from_utf8_lossy(&output.stderr);
    assert!(
        message.contains("interface of base.sigil::Base"),
        "{message}"
    );
    // A private edit of the dependency does not reject it.
    let root = support::shared_workspace();
    result(
        &root,
        &[
            "prepare",
            "design",
            "--source",
            "consumer.sigil",
            "--out",
            "prep",
        ],
        0,
    );
    root.write("empty.ttl", b"");
    edit(
        &root,
        "base.sigil",
        "Preserve value and result.",
        "Preserve both.",
    );
    assert_eq!(ingest(&root).status.code(), Some(0));
    // The source itself moving does.
    let root = support::shared_workspace();
    result(
        &root,
        &[
            "prepare",
            "design",
            "--source",
            "consumer.sigil",
            "--out",
            "prep",
        ],
        0,
    );
    root.write("empty.ttl", b"");
    edit(
        &root,
        "consumer.sigil",
        "Serve the caller.",
        "Serve every caller.",
    );
    let output = ingest(&root);
    assert_eq!(output.status.code(), Some(3));
    assert!(String::from_utf8_lossy(&output.stderr).contains("source content"));
    let root = support::shared_workspace();
    result(
        &root,
        &[
            "prepare",
            "design",
            "--source",
            "consumer.sigil",
            "--out",
            "prep",
        ],
        0,
    );
    root.write("empty.ttl", b"");
    root.write(".sigil/glossary.json", b"{}");
    let output = ingest(&root);
    assert_eq!(output.status.code(), Some(3));
    assert!(String::from_utf8_lossy(&output.stderr).contains("context"));
}

const SCOPE: &str =
    r#"{"version":1,"design":{"paths":["PATH"]},"implementation":{"paths":[],"allowEmpty":true}}"#;

#[test]
fn an_unresolved_import_invalidates_only_its_own_closure() {
    let root = ingested();
    root.write(
        "broken.sigil",
        b"@missing.sigil from Gone import { gone }\ncomponent Broken {\ngoal {\nDescribe Broken.\n}\ninterface {\nUse gone.\n}\n}\n",
    );
    root.write(
        "uses_broken.sigil",
        b"@broken.sigil from Broken import { x }\ncomponent UsesBroken {\ngoal {\nDescribe it.\n}\n}\n",
    );
    let after = statuses(&root, 1);
    assert_eq!(after["broken.sigil"], "invalid");
    assert_eq!(after["uses_broken.sigil"], "invalid");
    assert_eq!(after["base.sigil"], "fresh");
    assert_eq!(after["consumer.sigil"], "fresh");
    // The broken source widened nobody's closure: the consumer's scope is two sources.
    root.write(
        "scope-consumer.json",
        SCOPE.replace("PATH", "consumer.sigil").as_bytes(),
    );
    let scoped = result(
        &root,
        &["compile", "design", "--scope", "scope-consumer.json"],
        0,
    );
    assert_eq!(
        scoped["scope"]["design"]["sources"],
        json!(["base.sigil", "consumer.sigil"])
    );
    assert_eq!(scoped["all_fresh"], true);
    // A scope containing the broken source produces no verdict.
    root.write(
        "scope-broken.json",
        SCOPE.replace("PATH", "uses_broken.sigil").as_bytes(),
    );
    let output = run(
        &root,
        &["compile", "design", "--scope", "scope-broken.json"],
    );
    assert_eq!(output.status.code(), Some(3));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("design error"));
    // The whole workspace is not a passing verdict either; preparing the broken
    // source is refused, and preparing a healthy one is not.
    assert_eq!(run(&root, &["compile", "design"]).status.code(), Some(3));
    let refused = run(
        &root,
        &[
            "prepare",
            "design",
            "--source",
            "broken.sigil",
            "--out",
            "prep-broken",
        ],
    );
    assert_eq!(refused.status.code(), Some(3));
    result(
        &root,
        &[
            "prepare",
            "design",
            "--source",
            "base.sigil",
            "--out",
            "prep-base-again",
        ],
        0,
    );
}

#[test]
fn a_projection_stored_under_the_old_format_reads_as_incompatible() {
    let root = ingested();
    let index = root.0.join(".sigil/worlds/index.json");
    let mut value: Value = serde_json::from_slice(&std::fs::read(&index).unwrap()).unwrap();
    for entry in value["entries"].as_object_mut().unwrap().values_mut() {
        let binding = &mut entry["binding"];
        binding["projection_format"] = json!(2);
        let semantic = binding["semantic"].as_object_mut().unwrap();
        semantic.remove("imports");
        semantic.insert("dependencies".into(), json!([]));
        // An index written before the reader rename carries the old field name.
        let version = semantic.remove("reader_version").unwrap();
        semantic.insert("frontend_version".into(), version);
    }
    std::fs::write(&index, serde_json::to_vec(&value).unwrap()).unwrap();
    let after = statuses(&root, 1);
    assert!(after.values().all(|s| s == "incompatible"), "{after:?}");
    // Reading it again is the one-time cost: re-ingest restores freshness.
    publish(&root, "base.sigil");
    publish(&root, "consumer.sigil");
    assert!(statuses(&root, 0).values().all(|s| s == "fresh"));
}
