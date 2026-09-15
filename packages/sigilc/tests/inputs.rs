mod support;
use serde_json::json;
use sigilc::{
    catalog::DesignIdentities,
    eqval::DesignState,
    inputs::{self, Binding, DesignSnapshot, SemanticInput},
    sources::capture,
};
use std::collections::BTreeMap;
use support::Workspace;

const PATHS: &[&str] = &["a.sigil", "b.sigil", "c.sigil", "unrelated.sigil"];
fn workspace() -> Workspace {
    support::cycle_workspace()
}
fn snapshot(root: &Workspace) -> DesignSnapshot {
    DesignSnapshot::capture(&root.0, support::cycle_input(root), 10_000).unwrap()
}

#[test]
fn design_transitive_imports_and_cycles_bind_private_bytes() {
    let root = workspace();
    let before = snapshot(&root);
    let text = std::fs::read_to_string(root.0.join("b.sigil")).unwrap();
    root.write("b.sigil", format!("{text}\n// private change").as_bytes());
    let after = snapshot(&root);
    for path in ["a.sigil", "b.sigil", "c.sigil"] {
        assert_ne!(before.binding(path).unwrap(), after.binding(path).unwrap());
    }
    assert_eq!(
        before.binding("unrelated.sigil").unwrap(),
        after.binding("unrelated.sigil").unwrap()
    );
    let SemanticInput::Design { dependencies, .. } = before.binding("a.sigil").unwrap().semantic
    else {
        panic!()
    };
    assert_eq!(dependencies.len(), 2);
    assert_ne!(before.fingerprint().unwrap(), after.fingerprint().unwrap());
    root.write(".sigil/glossary.json", b"{}");
    let context_changed = snapshot(&root);
    for path in PATHS {
        assert_ne!(
            after.binding(path).unwrap(),
            context_changed.binding(path).unwrap()
        );
    }
}

#[test]
fn deleted_provider_bindings_widen_conservatively_instead_of_shrinking_the_world() {
    let root = workspace();
    let before = snapshot(&root);
    std::fs::remove_file(root.0.join("b.sigil")).unwrap();
    let value = support::missing_cycle_provider();
    let input = sigilc::frontend::DesignInput::parse(&serde_json::to_vec(&value).unwrap()).unwrap();
    let deleted = DesignSnapshot::capture(&root.0, input, 10_000).unwrap();
    for path in ["a.sigil", "c.sigil", "unrelated.sigil"] {
        assert_ne!(
            before.binding(path).unwrap(),
            deleted.binding(path).unwrap()
        );
    }
    assert!(sigilc::design::valid_frontend(&deleted).is_err());
}

#[test]
fn stale_frontend_buffers_and_context_absence_are_rejected() {
    let root = workspace();
    let input = root.input(PATHS, json!([]));
    root.write("a.sigil", b"changed");
    assert!(
        DesignSnapshot::capture(&root.0, input, 10_000)
            .err()
            .unwrap()
            .contains("source changed")
    );
    let input = root.input(PATHS, json!([]));
    root.write(".sigil/local.json", b"{}");
    assert!(
        DesignSnapshot::capture(&root.0, input, 10_000)
            .err()
            .unwrap()
            .contains("context appeared")
    );
    let input = root.input(PATHS, json!([]));
    root.write(".sigil/config.json", b"changed");
    assert!(
        DesignSnapshot::capture(&root.0, input, 10_000)
            .err()
            .unwrap()
            .contains("context changed")
    );
}

#[test]
fn implementation_key_contains_only_its_target_and_ontology_format_catalog() {
    let root = workspace();
    let mut input = root.input(PATHS, json!([]));
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
    let source = "component A {\ngoal {\nDescribe A.\n}\ninterface {\nOffer A.\n}\n}";
    input
        .sources
        .iter_mut()
        .find(|s| s.path == "a.sigil")
        .unwrap()
        .text = source.into();
    input
        .entities
        .push(serde_json::from_value(support::component("a.sigil", "A", source)).unwrap());
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
