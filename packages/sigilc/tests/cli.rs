use std::process::Command;

#[test]
fn ontology_is_available_without_workspace_or_model_configuration() {
    let result = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(["ontology", "--format", "json"])
        .current_dir(std::env::temp_dir())
        .output()
        .unwrap();
    assert!(result.status.success());
    let ontology: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(ontology["namespace"], sigilc::turtle::ONTOLOGY);
    assert_eq!(ontology["predicates"]["dependsOn"], "entity");
    assert!(ontology["predicates"].get("complete-scope").is_none());
    assert!(
        !String::from_utf8(result.stdout)
            .unwrap()
            .contains("Evidence")
    );
    let invalid = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(["ontology", "--model", "anything"])
        .output()
        .unwrap();
    assert_eq!(invalid.status.code(), Some(2));
    assert!(invalid.stdout.is_empty());
}

#[test]
fn clean_requires_no_valid_cache() {
    let root = std::env::temp_dir().join(format!("sigil-clean-cli-{}", std::process::id()));
    std::fs::create_dir_all(root.join(".sigil/worlds")).unwrap();
    std::fs::write(root.join(".sigil/worlds/index.json"), "malformed").unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(["clean", "--root"])
        .arg(&root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        report["removed"],
        serde_json::json!([".sigil/worlds/index.json"])
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn the_removed_pre_exported_input_flag_is_a_usage_error_that_names_root() {
    for args in [
        vec!["stale", "design", "--frontend", "f.json"],
        vec!["scope", "--frontend", "f.json", "--scope", "s.json"],
    ] {
        let out = Command::new(env!("CARGO_BIN_EXE_sigilc"))
            .args(&args)
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(2), "{args:?}");
        assert!(String::from_utf8_lossy(&out.stderr).contains("--root"));
    }
}

#[test]
fn store_isolates_projections_and_the_tree_cache_from_the_workspace() {
    let base = std::env::temp_dir().join(format!("sigil-store-cli-{}", std::process::id()));
    let (workspace, store) = (base.join("workspace"), base.join("store"));
    std::fs::create_dir_all(workspace.join(".sigil")).unwrap();
    std::fs::write(
        workspace.join(".sigil/config.json"),
        r#"{"sigilVersion":"0.9.0","workspace":{"name":"t"},"files":{"include":["**/*.sigil"]}}"#,
    )
    .unwrap();
    std::fs::write(
        workspace.join("a.sigil"),
        "component A {\n  goal {\n    Describe A.\n  }\n  interface {\n    Offer A.\n  }\n}\n",
    )
    .unwrap();
    let run = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_sigilc"))
            .args(args)
            .args(["--root"])
            .arg(&workspace)
            .args(["--store"])
            .arg(&store)
            .output()
            .unwrap()
    };
    let stale = run(&["stale", "design"]);
    assert_eq!(
        stale.status.code(),
        Some(1),
        "{}",
        String::from_utf8_lossy(&stale.stderr)
    );
    assert!(store.join("worlds").is_dir());
    assert!(store.join("trees").is_dir());
    assert!(!workspace.join(".sigil/worlds").exists());
    assert!(!workspace.join(".sigil/trees").exists());
    let clean = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(["clean", "--root"])
        .arg(&workspace)
        .args(["--store"])
        .arg(&store)
        .output()
        .unwrap();
    assert!(clean.status.success());
    assert!(!store.join("trees").exists());
    std::fs::remove_dir_all(base).unwrap();
}
