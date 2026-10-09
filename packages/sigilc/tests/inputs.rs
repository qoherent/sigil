mod support;
use serde_json::json;
use sigilc::{
    catalog::DesignIdentities,
    eqval::DesignState,
    inputs::{self, Binding, DesignSnapshot, SemanticInput, moved},
    sources::capture,
};
use std::collections::BTreeMap;
use support::Workspace;

const PATHS: &[&str] = &["a.sigil", "b.sigil", "c.sigil", "unrelated.sigil"];
fn workspace() -> Workspace {
    support::cycle_workspace()
}
fn snapshot(root: &Workspace) -> DesignSnapshot {
    root.snapshot()
}
fn edit(root: &Workspace, path: &str, from: &str, to: &str) {
    let text = std::fs::read_to_string(root.0.join(path)).unwrap();
    assert!(text.contains(from), "{from} is in {path}");
    root.write(path, text.replacen(from, to, 1).as_bytes());
}

#[test]
fn a_dependency_private_edit_reaches_nobody_and_an_interface_edit_reaches_importers() {
    let root = workspace();
    let before = snapshot(&root);
    // b's goal is private: a imports b, c imports a, a cycle closes through c.
    edit(
        &root,
        "b.sigil",
        "Describe B.",
        "Describe B in more detail.",
    );
    let after = snapshot(&root);
    for path in ["a.sigil", "c.sigil", "unrelated.sigil"] {
        assert_eq!(
            before.binding(path).unwrap(),
            after.binding(path).unwrap(),
            "{path} reads only interfaces"
        );
    }
    let (old, new) = (
        before.binding("b.sigil").unwrap(),
        after.binding("b.sigil").unwrap(),
    );
    assert_ne!(old, new);
    assert_eq!(moved(&old, &new), "source content");
    assert_ne!(before.fingerprint().unwrap(), after.fingerprint().unwrap());

    // b's interface is what a imports; c imports only a, so it is still unmoved.
    edit(&root, "b.sigil", "A *b* exists.", "A *b* exists today.");
    let interface = snapshot(&root);
    assert_eq!(
        after.binding("c.sigil").unwrap(),
        interface.binding("c.sigil").unwrap()
    );
    let (old, new) = (
        after.binding("a.sigil").unwrap(),
        interface.binding("a.sigil").unwrap(),
    );
    assert_eq!(old.source, new.source, "a's own content did not move");
    assert_eq!(moved(&old, &new), "interface of b.sigil::B");
    let SemanticInput::Design { imports, .. } = new.semantic else {
        panic!()
    };
    assert_eq!(imports.len(), 1);
    assert_eq!(
        (imports[0].path.as_str(), imports[0].component.as_str()),
        ("b.sigil", "B")
    );
    assert_eq!(imports[0].interface.len(), 1);

    root.write(".sigil/glossary.json", b"{}");
    let context_changed = snapshot(&root);
    for path in PATHS {
        assert_ne!(
            interface.binding(path).unwrap(),
            context_changed.binding(path).unwrap()
        );
    }
    assert_eq!(
        moved(
            &interface.binding("a.sigil").unwrap(),
            &context_changed.binding("a.sigil").unwrap()
        ),
        "context"
    );
}

#[test]
fn a_pure_reformat_of_a_source_leaves_its_binding_and_its_importers_alone() {
    let root = workspace();
    let before = snapshot(&root);
    edit(&root, "a.sigil", "Describe A.", "Describe\n   A.");
    edit(&root, "a.sigil", "A *a* exists.", "A  *a*\n  exists.");
    let after = snapshot(&root);
    for path in PATHS {
        assert_eq!(
            before.binding(path).unwrap(),
            after.binding(path).unwrap(),
            "{path}"
        );
    }
}

#[test]
fn a_deleted_provider_invalidates_only_the_sources_that_depend_on_it() {
    let root = workspace();
    let before = snapshot(&root);
    assert!(PATHS.iter().all(|p| before.invalid(p).is_none()));
    std::fs::remove_file(root.0.join("b.sigil")).unwrap();
    let deleted = snapshot(&root);
    // a imports the deleted b; c imports a, so b is in c's import closure.
    assert!(deleted.invalid("a.sigil").is_some());
    assert!(
        deleted
            .invalid("c.sigil")
            .unwrap()
            .contains("import closure: a.sigil")
    );
    assert!(deleted.invalid("unrelated.sigil").is_none());
    assert_ne!(
        before.binding("a.sigil").unwrap(),
        deleted.binding("a.sigil").unwrap()
    );
    assert_eq!(
        before.binding("unrelated.sigil").unwrap(),
        deleted.binding("unrelated.sigil").unwrap()
    );
    assert!(sigilc::design::valid_structure(&deleted).is_err());
    assert!(deleted.require_valid("a.sigil").is_err());
    deleted.require_valid("unrelated.sigil").unwrap();
}

#[test]
fn implementation_key_contains_only_its_target_and_ontology_format_catalog() {
    let root = workspace();
    let input = root.design_input();
    let frozen = DesignIdentities::collect(&input, &BTreeMap::new())
        .unwrap()
        .freeze(DesignState::Loose, "d1".into(), true)
        .unwrap();
    root.write("arbitrary.raw", b"\xff\x00bytes");
    let first = capture(&root.0, "arbitrary.raw", 100).unwrap();
    let binding = inputs::implementation(&first, &frozen.catalog);
    root.write("neighbor.rs", b"imports changed");
    root.write("b.sigil", b"Design relationship changed");
    assert_eq!(
        binding,
        inputs::implementation(
            &capture(&root.0, "arbitrary.raw", 100).unwrap(),
            &frozen.catalog
        )
    );
    // A new Component in the workspace changes the catalog, and so the key.
    root.write(
        "a.sigil",
        b"component A {\ngoal {\nDescribe A.\n}\ninterface {\nOffer A.\n}\n}\ncomponent Added {\ngoal {\nDescribe it.\n}\n}",
    );
    let input = root.design_input();
    let changed = DesignIdentities::collect(&input, &BTreeMap::new())
        .unwrap()
        .freeze(DesignState::Coherent, "d2".into(), true)
        .unwrap();
    assert_ne!(binding, inputs::implementation(&first, &changed.catalog));
    root.write("arbitrary.raw", b"different");
    assert_ne!(
        binding,
        inputs::implementation(
            &capture(&root.0, "arbitrary.raw", 100).unwrap(),
            &frozen.catalog
        )
    );
    let original = serde_json::to_value(&binding).unwrap();
    for field in [
        "model",
        "prompt",
        "context",
        "neighbors",
        "symbolMap",
        "dependencies",
    ] {
        for pointer in ["", "/source", "/semantic"] {
            let mut bad = original.clone();
            bad.pointer_mut(pointer)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert(field.into(), json!([]));
            assert!(
                serde_json::from_value::<Binding>(bad).is_err(),
                "{pointer}/{field}"
            );
        }
    }
}
