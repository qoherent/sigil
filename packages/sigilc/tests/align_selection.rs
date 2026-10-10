mod support;

use serde_json::{Value, json};
use sigilc::align::selection::{ImplementationSelection, load};
use support::Workspace;

fn settings(root: &Workspace, implementation: Value) {
    let mut config: Value = serde_json::from_str(support::CONFIG).unwrap();
    config["tools"] = json!({"sigilc": {"implementation": implementation}});
    root.write(".sigil/config.json", &serde_json::to_vec(&config).unwrap());
}

#[test]
fn config_is_required_and_sigilc_owns_strict_validation_of_its_namespace() {
    let root = Workspace::new();
    assert!(
        load(&root.0)
            .unwrap_err()
            .contains("tools.sigilc.implementation")
    );
    settings(&root, json!({"dirs": ["src"], "mystery": true}));
    let error = load(&root.0).unwrap_err();
    assert!(error.contains("tools.sigilc.implementation") && error.contains("mystery"));
    root.write(".sigil/config.json", br#"{"sigilVersion":"0.9.0","workspace":{"name":"test"},"files":{"include":["**/*.sigil"]},"tools":{"sigilc":{"other":true}}}"#);
    assert!(load(&root.0).unwrap_err().contains("tools.sigilc.other"));
    for (key, value) in [
        ("paths", json!(false)),
        ("design", json!(null)),
        ("exclude", json!([3])),
        ("allowEmpty", json!("yes")),
    ] {
        settings(&root, json!({key: value}));
        assert!(load(&root.0).unwrap_err().contains(key));
    }
    settings(&root, json!({"dirs": ["src"]}));
    let text = std::fs::read_to_string(root.0.join(".sigil/config.json")).unwrap();
    // Core owns only tools' object shape; compiler-specific validation stays outside it.
    let mut core: Value = serde_json::from_str(&text).unwrap();
    core["tools"]["sigilc"]["implementation"]["mystery"] = json!(true);
    assert!(
        sigilc::language::config::parse_config(&core.to_string(), ".sigil/config.json")
            .diagnostics
            .is_empty()
    );
}

#[test]
fn local_tool_settings_merge_recursively_and_arrays_replace() {
    let root = Workspace::new();
    settings(
        &root,
        json!({"dirs":["src"], "exclude":["old/**"], "design":["a.sigil"]}),
    );
    root.write(".sigil/local.json", br#"{"tools":{"sigilc":{"implementation":{"exclude":["new/**"],"allowEmpty":true}},"editor":{"unrelated":true}}}"#);
    let config = load(&root.0).unwrap();
    assert_eq!(config.selection.dirs, ["src"]);
    assert_eq!(config.selection.exclude, ["new/**"]);
    assert_eq!(config.design.unwrap(), ["a.sigil"]);
    assert!(config.selection.allow_empty);
    root.write(
        ".sigil/local.json",
        br#"{"tools":{"sigilc":{"implementation":{"mistake":true}}}}"#,
    );
    assert!(
        load(&root.0)
            .unwrap_err()
            .contains("tools.sigilc.implementation.mistake")
    );
}

#[test]
fn configured_design_roots_reuse_dependency_closure_and_list_outside_components() {
    let root = support::scope_workspace();
    root.write("src/code.rs", b"code");
    settings(&root, json!({"dirs":["src"],"design":["a.sigil"]}));
    let mut input = root.design_input();
    let first = load(&root.0)
        .unwrap()
        .resolve(&root.0, &input, 1024)
        .unwrap();
    assert_eq!(
        first
            .design
            .sources
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["a.sigil", "b.sigil"]
    );
    assert!(
        first
            .design
            .dependencies
            .iter()
            .any(|d| d.target == "b.sigil" && d.reason == "imported-owner")
    );
    assert_eq!(first.outside_components.len(), 1);
    assert_eq!(first.outside_components[0].label, "C");
    input.sources.reverse();
    input.entities.reverse();
    input.imports.reverse();
    let second = load(&root.0)
        .unwrap()
        .resolve(&root.0, &input, 1024)
        .unwrap();
    assert_eq!(first.fingerprint, second.fingerprint);
    settings(&root, json!({"dirs":["src"]}));
    let whole = load(&root.0)
        .unwrap()
        .resolve(&root.0, &input, 1024)
        .unwrap();
    assert_eq!(whole.design.sources.len(), 3);
    assert!(whole.outside_components.is_empty());
    assert_ne!(whole.fingerprint, first.fingerprint);
    for roots in [
        json!([]),
        json!(["missing.sigil"]),
        json!(["../a.sigil"]),
        json!(["a.sigil", "a.sigil"]),
    ] {
        settings(&root, json!({"dirs":["src"], "design":roots}));
        assert!(
            load(&root.0)
                .unwrap()
                .resolve(&root.0, &input, 1024)
                .unwrap_err()
                .contains("design")
        );
    }
}

#[test]
fn implementation_selection_reports_removals_and_unpresentable_files() {
    let root = Workspace::new();
    for (path, bytes) in [
        ("src/a.ts", b"code".as_slice()),
        ("src/generated/a.ts", b"generated"),
        ("src/design.sigil", b"component D {}"),
        ("src/empty.ts", b""),
        ("src/raw.bin", b"\xff"),
        ("src/large.ts", b"this file exceeds the limit"),
    ] {
        root.write(path, bytes);
    }
    settings(
        &root,
        json!({"dirs":["src"], "exclude":["**/generated/**", "**/generated/*.ts", "nothing"]}),
    );
    let input = root.design_input();
    let config = load(&root.0).unwrap();
    let first = config.resolve(&root.0, &input, 20).unwrap();
    assert_eq!(
        first
            .implementation
            .files
            .iter()
            .map(|f| f.path.as_str())
            .collect::<Vec<_>>(),
        ["src/a.ts"]
    );
    assert_eq!(
        first
            .implementation
            .exclusions
            .iter()
            .map(|e| e.removed)
            .collect::<Vec<_>>(),
        [1, 0, 0]
    );
    assert_eq!(
        first.implementation.auto_excluded_design,
        ["src/design.sigil"]
    );
    assert_eq!(first.implementation.empty_files, ["src/empty.ts"]);
    assert_eq!(
        first
            .implementation
            .unpresentable
            .iter()
            .map(|f| f.path.as_str())
            .collect::<Vec<_>>(),
        ["src/large.ts", "src/raw.bin"]
    );
    assert_eq!(
        first.fingerprint,
        config.resolve(&root.0, &input, 20).unwrap().fingerprint
    );
    settings(
        &root,
        json!({"dirs":["src"],"include":["**/*.nothing"],"allowEmpty":true}),
    );
    let empty = load(&root.0).unwrap().resolve(&root.0, &input, 20).unwrap();
    assert!(empty.implementation.intentional_empty);
    settings(&root, json!({"dirs":["src"],"include":["**/*.nothing"]}));
    assert!(
        load(&root.0)
            .unwrap()
            .resolve(&root.0, &input, 20)
            .unwrap_err()
            .contains("allowEmpty")
    );
    settings(&root, json!({"paths":["src/raw.bin"]}));
    let binary = load(&root.0).unwrap().resolve(&root.0, &input, 20).unwrap();
    assert!(!binary.implementation.intentional_empty);
    assert_eq!(binary.implementation.unpresentable.len(), 1);
}

#[test]
fn local_config_can_supply_the_whole_implementation_selection() {
    let root = Workspace::new();
    root.write(
        ".sigil/local.json",
        br#"{"tools":{"sigilc":{"implementation":{"paths":["code.rs"],"allowEmpty":true}}}}"#,
    );
    let config: ImplementationSelection = load(&root.0).unwrap();
    assert_eq!(config.selection.paths, ["code.rs"]);
    assert!(config.selection.allow_empty);
}

#[test]
fn binding_selection_digest_does_not_change_when_another_file_is_edited() {
    let root = Workspace::new();
    root.write("src/a.rs", b"old bytes");
    root.write("src/b.rs", b"unchanged");
    settings(&root, json!({"dirs":["src"]}));
    let input = root.design_input();
    let before = load(&root.0)
        .unwrap()
        .resolve(&root.0, &input, 1024)
        .unwrap();
    root.write("src/a.rs", b"new bytes");
    let after = load(&root.0)
        .unwrap()
        .resolve(&root.0, &input, 1024)
        .unwrap();
    assert_ne!(before.fingerprint, after.fingerprint);
    assert_eq!(before.selection_fingerprint, after.selection_fingerprint);
    settings(&root, json!({"dirs":["src"],"exclude":["no/matches"]}));
    let changed = load(&root.0)
        .unwrap()
        .resolve(&root.0, &input, 1024)
        .unwrap();
    assert_ne!(after.selection_fingerprint, changed.selection_fingerprint);
}

#[cfg(unix)]
#[test]
fn symlinks_are_listed_without_following_their_files_or_parents() {
    use std::os::unix::fs::symlink;
    let root = Workspace::new();
    let outside = Workspace::new();
    outside.write("secret", b"not code");
    root.write("src/a.ts", b"code");
    symlink(&outside.0, root.0.join("src/escape")).unwrap();
    symlink(root.0.join("src/a.ts"), root.0.join("src/alias")).unwrap();
    settings(&root, json!({"dirs":["src"]}));
    let input = root.design_input();
    let result = load(&root.0)
        .unwrap()
        .resolve(&root.0, &input, 1024)
        .unwrap();
    assert_eq!(result.implementation.files.len(), 1);
    assert_eq!(
        result.implementation.skipped_symlinks,
        ["src/alias", "src/escape"]
    );
    settings(
        &root,
        json!({"paths":["src/a.ts", "src/escape/secret", "src/alias"]}),
    );
    let result = load(&root.0)
        .unwrap()
        .resolve(&root.0, &input, 1024)
        .unwrap();
    assert_eq!(result.implementation.files.len(), 1);
    assert_eq!(
        result.implementation.skipped_symlinks,
        ["src/alias", "src/escape/secret"]
    );
    assert!(sigilc::sources::capture(&root.0, "src/escape/secret", 1024).is_err());
}
