mod support;
use serde_json::json;
use sigilc::{
    catalog::{Catalog, DesignIdentities},
    eqval::{DesignState, Limits},
    implementation, inputs,
    sources::{Selection, capture},
    store::{Freshness, LockedStore, StoreLimits},
    turtle::{self, TurtleLimits},
};
use std::collections::BTreeMap;
use support::Workspace;

fn catalog(root: &Workspace, name: &str) -> Catalog {
    let source = format!(
        "component A {{\ngoal {{\nDescribe A.\n}}\ninterface {{\nOffer A.\n}}\n}}\ncomponent {name} {{\ngoal {{\nDescribe {name}.\n}}\ninterface {{\nOffer {name}.\n}}\n}}"
    );
    root.write("a.sigil", source.as_bytes());
    let mut input = root.input(&["a.sigil"], json!([]));
    for label in ["A", name] {
        input
            .entities
            .push(serde_json::from_value(support::component("a.sigil", label, &source)).unwrap());
    }
    DesignIdentities::collect(&input, &BTreeMap::new())
        .unwrap()
        .freeze(DesignState::Loose, "fixture".into(), true)
        .unwrap()
        .catalog
}
fn selection() -> Selection {
    Selection {
        include: vec!["*.rs".into(), "*.py".into()],
        ..Selection::default()
    }
}
fn facts(body: &str) -> Vec<turtle::Assertion> {
    turtle::parse(format!("@prefix s: <https://sigil.dev/ontology/1#> . @prefix : <urn:sigil:component:a.sigil:> . {body}").as_bytes(),TurtleLimits::default()).unwrap()
}
fn publish(root: &Workspace, store: &mut LockedStore, catalog: &Catalog, path: &str, body: &str) {
    let current = inputs::implementation(&capture(&root.0, path, 10000).unwrap(), catalog);
    let prepared = store.prepare(current.clone()).unwrap();
    let facts = facts(body);
    catalog.validate_implementation(&facts).unwrap();
    store.publish(&prepared, &current, &facts).unwrap();
}

#[test]
fn independent_assembly_excludes_stale_neighbors_and_preserves_source_attribution() {
    let root = Workspace::new();
    root.write("a.rs", b"uses B");
    root.write("b.py", b"provides A");
    let catalog = catalog(&root, "B");
    let mut store = LockedStore::open(&root.0, StoreLimits::default()).unwrap();
    publish(&root, &mut store, &catalog, "a.rs", ":A s:dependsOn :B .");
    publish(&root, &mut store, &catalog, "b.py", ":B s:provides :A .");
    let before = implementation::assemble(&root.0, &selection(), &catalog, &store, 100)
        .unwrap()
        .compile(Limits::default())
        .unwrap();
    assert!(before.all_fresh);
    assert_eq!(before.world.tables["known"].len(), 2);
    let id = facts(":A s:dependsOn :B .")[0].id();
    assert_eq!(before.assertion_sources[&id], vec!["a.rs"]);
    root.write("b.py", b"changed neighbor");
    let after = implementation::assemble(&root.0, &selection(), &catalog, &store, 100)
        .unwrap()
        .compile(Limits::default())
        .unwrap();
    assert!(!after.all_fresh);
    assert_eq!(after.world.tables["known"].len(), 1);
    assert_eq!(after.sources[0].status, Freshness::Fresh);
    assert_eq!(after.sources[1].status, Freshness::Modified);
    assert_ne!(
        before.implementation_fingerprint,
        after.implementation_fingerprint
    );
    assert_ne!(before.input_fingerprint, after.input_fingerprint);
}

#[test]
fn fresh_empty_is_distinct_from_missing_and_catalog_does_not_supply_evidence() {
    let root = Workspace::new();
    root.write("a.rs", b"empty evidence");
    let catalog = catalog(&root, "B");
    let mut store = LockedStore::open(&root.0, StoreLimits::default()).unwrap();
    let missing = implementation::assemble(&root.0, &selection(), &catalog, &store, 100)
        .unwrap()
        .compile(Limits::default())
        .unwrap();
    assert!(!missing.all_fresh);
    assert!(missing.world.tables["known"].is_empty());
    publish(&root, &mut store, &catalog, "a.rs", "");
    let empty = implementation::assemble(&root.0, &selection(), &catalog, &store, 100)
        .unwrap()
        .compile(Limits::default())
        .unwrap();
    assert!(empty.all_fresh);
    assert!(empty.world.tables["known"].is_empty());
    assert!(!empty.intentional_empty);
    let changed = catalog_for_changed_name(&root);
    assert_eq!(
        implementation::assemble(&root.0, &selection(), &changed, &store, 100)
            .unwrap()
            .sources[0]
            .status,
        Freshness::EntityCatalogInvalidated
    );
    std::fs::remove_file(root.0.join("a.rs")).unwrap();
    assert!(implementation::assemble(&root.0, &selection(), &catalog, &store, 100).is_err());
    let intentional = implementation::assemble(
        &root.0,
        &Selection {
            allow_empty: true,
            ..selection()
        },
        &catalog,
        &store,
        100,
    )
    .unwrap()
    .compile(Limits::default())
    .unwrap();
    assert!(intentional.intentional_empty);
    assert!(intentional.all_fresh);
    assert_eq!(intentional.sources[0].status, Freshness::Deleted);
}
fn catalog_for_changed_name(root: &Workspace) -> Catalog {
    catalog(root, "C")
}

#[test]
fn cached_identity_is_revalidated_and_aggregate_inputs_are_bounded() {
    let root = Workspace::new();
    root.write("a.rs", b"a");
    root.write("b.py", b"b");
    let catalog = catalog(&root, "B");
    let mut store = LockedStore::open(&root.0, StoreLimits::default()).unwrap();
    publish(&root, &mut store, &catalog, "a.rs", ":A s:uses :B .");
    publish(&root, &mut store, &catalog, "b.py", ":B s:uses :A .");
    assert!(
        implementation::assemble(&root.0, &selection(), &catalog, &store, 1)
            .err()
            .unwrap()
            .contains("aggregate")
    );
    // Exercise an internally consistent cache with invalid side-specific data.
    let current = inputs::implementation(&capture(&root.0, "a.rs", 100).unwrap(), &catalog);
    let prepared = store.prepare(current.clone()).unwrap();
    store
        .publish(&prepared, &current, &facts(":Unknown s:uses :B ."))
        .unwrap();
    assert!(
        implementation::assemble(&root.0, &selection(), &catalog, &store, 100)
            .err()
            .unwrap()
            .contains("unknown domain")
    );
}
