mod support;
use std::process::Command;
use support::Workspace;

#[test]
fn help_lists_design_commands_tree_and_clean() {
    let result = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .arg("--help")
        .current_dir(std::env::temp_dir())
        .output()
        .unwrap();
    assert!(result.status.success());
    let help = String::from_utf8(result.stdout).unwrap();
    assert!(help.contains("  tree "));
    assert!(help.contains("  clean "));
    assert!(help.contains("prepare --source"));
    assert!(help.contains("ingest --binding"));
    assert!(help.contains("  check "));
    assert!(help.contains("extract-guidance"));
    assert!(help.contains("align prepare"));
    assert!(help.contains("--implementation"));
    for retired in [
        "prepare design",
        "compile design",
        "entities",
        "compare",
        "ontology",
        "scope",
        "stale",
        "compile implementation",
        "prepare implementation",
    ] {
        assert!(
            !help.contains(retired),
            "retired command in help: {retired}"
        );
    }
}

#[test]
fn retired_commands_are_usage_errors() {
    for args in [
        vec!["compile", "design", "--root", "."],
        vec!["compile", "implementation", "--root", "."],
        vec!["prepare", "design"],
        vec!["ingest", "design"],
        vec!["stale", "design"],
        vec!["entities"],
        vec!["compare"],
        vec!["ontology"],
        vec!["scope"],
    ] {
        let result = Command::new(env!("CARGO_BIN_EXE_sigilc"))
            .args(&args)
            .output()
            .unwrap();
        assert_eq!(result.status.code(), Some(2), "{args:?}");
        assert!(result.stdout.is_empty());
        assert!(!result.stderr.is_empty());
    }
}

#[test]
fn clean_requires_no_valid_cache() {
    let root = Workspace::new();
    root.write(".sigil/worlds/index.json", b"malformed");
    let output = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(["clean", "--root"])
        .arg(&root.0)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["removed"], serde_json::json!([".sigil/worlds"]));
    assert!(!root.0.join(".sigil/worlds").exists());
}

#[test]
fn store_isolates_the_tree_cache_from_the_workspace() {
    let root = Workspace::new();
    root.write(
        "a.sigil",
        b"component A {\n  goal {\n    Describe A.\n  }\n  interface {\n    Offer A.\n  }\n}\n",
    );
    let store = root.0.join("store");
    let run = |command| {
        Command::new(env!("CARGO_BIN_EXE_sigilc"))
            .arg(command)
            .arg("--root")
            .arg(&root.0)
            .arg("--store")
            .arg(&store)
            .output()
            .unwrap()
    };
    let tree = run("tree");
    assert!(
        tree.status.success(),
        "{}",
        String::from_utf8_lossy(&tree.stderr)
    );
    assert!(store.join("trees").is_dir());
    assert!(!root.0.join(".sigil/trees").exists());
    let clean = run("clean");
    assert!(
        clean.status.success(),
        "{}",
        String::from_utf8_lossy(&clean.stderr)
    );
    assert!(!store.join("trees").exists());
    assert!(!store.join("worlds").exists());
}
