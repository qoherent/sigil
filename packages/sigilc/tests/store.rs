mod support;
use sigilc::{
    inputs::{Binding, PROJECTION_FORMAT, SemanticInput},
    sources::{capture, hash},
    store::{Freshness, LockedStore, PreparedBinding, StoreLimits},
    turtle::{self, TurtleLimits},
};
use support::Workspace;

fn binding(root: &Workspace, path: &str) -> Binding {
    Binding {
        source: capture(&root.0, path, 100_000).unwrap().identity,
        ontology: turtle::ontology_fingerprint(),
        projection_format: PROJECTION_FORMAT,
        semantic: SemanticInput::Implementation {
            catalog_fingerprint: hash(b"fixed test catalog"),
        },
    }
}
fn facts() -> Vec<turtle::Assertion> {
    turtle::parse(
        b"<urn:fixture:a> <https://sigil.dev/ontology/1#uses> <urn:fixture:b> .",
        TurtleLimits::default(),
    )
    .unwrap()
}
fn open(root: &Workspace) -> LockedStore {
    LockedStore::open(&root.0, StoreLimits::default()).unwrap()
}

#[test]
fn bindings_capture_generation_before_turtle_and_cannot_publish_out_of_order() {
    let root = Workspace::new();
    root.write("folder/a.py", b"first");
    let input = binding(&root, "folder/a.py");
    let prepared = {
        let store = open(&root);
        assert_eq!(store.inspect(&input).unwrap().status, Freshness::Missing);
        store.prepare(input.clone()).unwrap()
    };
    let duplicate =
        serde_json::from_slice::<PreparedBinding>(&serde_json::to_vec(&prepared).unwrap()).unwrap();
    let mut store = open(&root);
    store.publish(&prepared, &input, &facts()).unwrap();
    assert!(
        root.0
            .join(".sigil/worlds/implementation/folder/a.py.egg")
            .is_file()
    );
    assert_eq!(store.inspect(&input).unwrap().assertions, facts());
    assert!(
        store
            .publish(&duplicate, &input, &[])
            .unwrap_err()
            .contains("generation")
    );
    let replacement = store.prepare(input.clone()).unwrap();
    store.publish(&replacement, &input, &[]).unwrap();
    assert_eq!(store.inspect(&input).unwrap().status, Freshness::Fresh);
    assert!(store.inspect(&input).unwrap().assertions.is_empty());
    assert!(store.publish(&replacement, &input, &facts()).is_err());
    assert!(
        LockedStore::open(&root.0, StoreLimits::default())
            .err()
            .unwrap()
            .contains("lock")
    );
    drop(store);
    assert_eq!(
        open(&root).inspect(&input).unwrap().status,
        Freshness::Fresh
    );
}

#[test]
fn changed_sources_catalogs_and_formats_reject_publication() {
    let root = Workspace::new();
    root.write("a.rs", b"one");
    let input = binding(&root, "a.rs");
    let mut store = open(&root);
    let prepared = store.prepare(input.clone()).unwrap();
    root.write("neighbor.rs", b"unrelated");
    store.publish(&prepared, &input, &facts()).unwrap();
    let prepared = store.prepare(input.clone()).unwrap();
    root.write("a.rs", b"two");
    assert!(
        store
            .publish(&prepared, &input, &[])
            .unwrap_err()
            .contains("source input changed")
    );
    let modified = binding(&root, "a.rs");
    assert_eq!(
        store.inspect(&modified).unwrap().status,
        Freshness::Modified
    );
    assert!(
        store
            .publish(&prepared, &modified, &[])
            .unwrap_err()
            .contains("semantic inputs")
    );
    let mut changed_catalog = input.clone();
    changed_catalog.semantic = SemanticInput::Implementation {
        catalog_fingerprint: hash(b"changed"),
    };
    assert_eq!(
        store.inspect(&changed_catalog).unwrap().status,
        Freshness::EntityCatalogInvalidated
    );
    assert!(store.publish(&prepared, &changed_catalog, &[]).is_err());
    let mut incompatible = input.clone();
    incompatible.projection_format += 1;
    assert!(store.prepare(incompatible).is_err());
}

#[test]
fn retains_distinct_semantic_bindings_for_ordered_scopes() {
    let root = Workspace::new();
    root.write("a.rs", b"one");
    let first = binding(&root, "a.rs");
    let mut second = first.clone();
    second.semantic = SemanticInput::Implementation {
        catalog_fingerprint: hash(b"second catalog"),
    };

    let mut store = open(&root);
    let first_binding = store.prepare(first.clone()).unwrap();
    store.publish(&first_binding, &first, &facts()).unwrap();
    assert_eq!(store.inspect(&first).unwrap().status, Freshness::Fresh);
    assert_eq!(
        store.inspect(&second).unwrap().status,
        Freshness::EntityCatalogInvalidated
    );

    let second_binding = store.prepare(second.clone()).unwrap();
    store.publish(&second_binding, &second, &[]).unwrap();
    assert_eq!(store.inspect(&second).unwrap().status, Freshness::Fresh);
    assert_eq!(store.inspect(&second).unwrap().assertions, vec![]);
    assert_eq!(store.inspect(&first).unwrap().status, Freshness::Fresh);
    assert_eq!(store.inspect(&first).unwrap().assertions, facts());
    assert!(
        store
            .entries()
            .keys()
            .any(|key| key.starts_with("implementation/a.rs~"))
    );
}

#[test]
fn failed_index_publication_remains_incomplete_in_memory_and_after_reopen() {
    let root = Workspace::new();
    root.write("a", b"source");
    let input = binding(&root, "a");
    let mut store = open(&root);
    let first = store.prepare(input.clone()).unwrap();
    store.publish(&first, &input, &facts()).unwrap();
    let second = store.prepare(input.clone()).unwrap();
    let obstruction = root.0.join(".sigil/worlds/index.json.tmp");
    std::fs::create_dir(&obstruction).unwrap();
    assert!(store.publish(&second, &input, &[]).is_err());
    assert_eq!(store.inspect(&input).unwrap().status, Freshness::Incomplete);
    drop(store);
    let mut store = open(&root);
    assert_eq!(store.inspect(&input).unwrap().status, Freshness::Incomplete);
    std::fs::remove_dir(obstruction).unwrap();
    store.publish(&second, &input, &[]).unwrap();
    assert_eq!(store.inspect(&input).unwrap().status, Freshness::Fresh);
}

#[test]
fn only_matching_indexed_restricted_assertions_contribute_facts() {
    let root = Workspace::new();
    root.write("a", b"source");
    let input = binding(&root, "a");
    root.write(
        ".sigil/worlds/implementation/a.egg",
        b"(panic \"never execute\")",
    );
    let mut store = open(&root);
    assert_eq!(store.inspect(&input).unwrap().status, Freshness::Missing);
    let prepared = store.prepare(input.clone()).unwrap();
    store.publish(&prepared, &input, &facts()).unwrap();
    root.write(
        ".sigil/worlds/implementation/a.egg",
        b"(panic \"never execute\")",
    );
    assert_eq!(store.inspect(&input).unwrap().status, Freshness::Incomplete);
    drop(store);
    let index_path = root.0.join(".sigil/worlds/index.json");
    let mut index: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&index_path).unwrap()).unwrap();
    index["entries"]["implementation/a"]["assertion_checksum"] =
        serde_json::json!(hash(b"(panic \"never execute\")"));
    std::fs::write(&index_path, serde_json::to_vec(&index).unwrap()).unwrap();
    assert_eq!(
        open(&root).inspect(&input).unwrap().status,
        Freshness::Incomplete
    );
    std::fs::remove_file(root.0.join(".sigil/worlds/implementation/a.egg")).unwrap();
    assert_eq!(
        open(&root).inspect(&input).unwrap().status,
        Freshness::Incomplete
    );
    index["entries"]["implementation/a"]["model"] = serde_json::json!("forbidden");
    std::fs::write(index_path, serde_json::to_vec(&index).unwrap()).unwrap();
    assert!(LockedStore::open(&root.0, StoreLimits::default()).is_err());
}

#[test]
fn limits_and_invalid_paths_fail_before_index_acceptance() {
    let root = Workspace::new();
    root.write("a", b"source");
    let input = binding(&root, "a");
    let limits = StoreLimits {
        max_index_bytes: 2,
        ..StoreLimits::default()
    };
    let mut store = LockedStore::open(&root.0, limits).unwrap();
    let prepared = store.prepare(input.clone()).unwrap();
    assert!(
        store
            .publish(&prepared, &input, &[])
            .unwrap_err()
            .contains("index exceeds")
    );
    assert_eq!(store.inspect(&input).unwrap().status, Freshness::Missing);
    assert!(!root.0.join(".sigil/worlds/implementation/a.egg").exists());
    let mut invalid = input.clone();
    invalid.source.path = "../escape".into();
    assert!(store.prepare(invalid).is_err());
    for pointer in ["", "/binding", "/binding/semantic"] {
        let mut value = serde_json::to_value(&prepared).unwrap();
        value
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("producer".into(), serde_json::json!("forbidden"));
        assert!(serde_json::from_value::<PreparedBinding>(value).is_err());
    }
}

#[cfg(unix)]
#[test]
fn symlinked_store_and_artifact_paths_are_rejected() {
    use std::os::unix::fs::symlink;
    let root = Workspace::new();
    let outside = Workspace::new();
    symlink(&outside.0, root.0.join(".sigil")).unwrap();
    assert!(LockedStore::open(&root.0, StoreLimits::default()).is_err());
    std::fs::remove_file(root.0.join(".sigil")).unwrap();
    root.write("a", b"source");
    let input = binding(&root, "a");
    let mut store = open(&root);
    let prepared = store.prepare(input.clone()).unwrap();
    symlink(&outside.0, root.0.join(".sigil/worlds/implementation")).unwrap();
    assert!(store.publish(&prepared, &input, &facts()).is_err());
    assert!(!outside.0.join("a.egg").exists());
}

#[test]
fn cache_deletion_cannot_make_an_old_generation_current_again() {
    let root = Workspace::new();
    root.write("a", b"source");
    let input = binding(&root, "a");
    let mut store = open(&root);
    let first = store.prepare(input.clone()).unwrap();
    store.publish(&first, &input, &facts()).unwrap();
    let old = store.prepare(input.clone()).unwrap();
    drop(store);
    std::fs::remove_dir_all(root.0.join(".sigil/worlds")).unwrap();
    let mut store = open(&root);
    let rebuilt = store.prepare(input.clone()).unwrap();
    store.publish(&rebuilt, &input, &[]).unwrap();
    assert!(
        store
            .publish(&old, &input, &facts())
            .unwrap_err()
            .contains("generation")
    );
    assert!(store.inspect(&input).unwrap().assertions.is_empty());
}

#[test]
fn cleanup_recovers_corrupt_indexes_and_preserves_sources_and_the_writer_lock() {
    let root = Workspace::new();
    root.write("a", b"source");
    root.write(".sigil/config.json", b"preserve");
    root.write("binding/binding.json", b"external input");
    let store = open(&root);
    root.write(".sigil/worlds/index.json", b"corrupt index");
    root.write(".sigil/worlds/design/a.egg", b"corrupt assertion");
    assert!(sigilc::store::clean(&root.0).is_err());
    drop(store);
    assert!(LockedStore::open(&root.0, StoreLimits::default()).is_err());
    let removed = sigilc::store::clean(&root.0).unwrap();
    assert_eq!(
        removed,
        vec![".sigil/worlds/design", ".sigil/worlds/index.json"]
    );
    assert!(root.0.join(".sigil/worlds/.lock").is_file());
    for path in ["a", ".sigil/config.json", "binding/binding.json"] {
        assert!(root.0.join(path).is_file());
    }
    assert!(open(&root).entries().is_empty());
    assert!(sigilc::store::clean(&root.0).unwrap().is_empty());
}

#[cfg(unix)]
#[test]
fn cleanup_unlinks_artifacts_without_following_symlinks() {
    let root = Workspace::new();
    let outside = Workspace::new();
    outside.write("preserved", b"outside");
    drop(open(&root));
    std::os::unix::fs::symlink(&outside.0, root.0.join(".sigil/worlds/foreign")).unwrap();
    root.write(".sigil/worlds/design/local.egg", b"cache");
    std::os::unix::fs::symlink(&outside.0, root.0.join(".sigil/worlds/design/nested")).unwrap();
    sigilc::store::clean(&root.0).unwrap();
    assert!(outside.0.join("preserved").is_file());
}

#[test]
fn legacy_projection_and_history_remain_stored_but_cannot_be_reused() {
    use serde_json::json;
    let root = Workspace::new();
    root.write("a.rs", b"unchanged source");
    let current = binding(&root, "a.rs");
    let mut legacy = current.clone();
    legacy.projection_format = 1;
    legacy.ontology = hash(b"old Concept vocabulary");
    let legacy_hash = hash(&serde_json::to_vec(&("sigil-input-v1", &legacy)).unwrap());
    let head = "implementation/a.rs";
    let history = format!("{head}~{legacy_hash}");
    let body = b"retained old projection bytes";
    let entry = json!({"binding":legacy,"assertion_checksum":hash(body),"generation":hash(b"legacy generation")});
    let mut entries = serde_json::Map::new();
    entries.insert(head.into(), entry.clone());
    entries.insert(history.clone(), entry);
    root.write(
        ".sigil/worlds/index.json",
        &serde_json::to_vec(&json!({"version":3,"entries":entries})).unwrap(),
    );
    root.write(&format!(".sigil/worlds/{head}.egg"), body);
    root.write(&format!(".sigil/worlds/{history}.egg"), body);
    let before = std::fs::read(root.0.join(".sigil/worlds/index.json")).unwrap();
    let mut store = open(&root);
    assert_eq!(
        store.inspect(&current).unwrap().status,
        Freshness::Incompatible
    );
    assert!(store.inspect(&current).unwrap().assertions.is_empty());
    assert!(store.prepare(legacy.clone()).is_err());
    let prepared = PreparedBinding {
        version: 2,
        binding: legacy,
        expected_generation: None,
    };
    assert!(store.publish(&prepared, &current, &facts()).is_err());
    assert_eq!(
        std::fs::read(root.0.join(".sigil/worlds/index.json")).unwrap(),
        before
    );
    assert_eq!(
        std::fs::read(root.0.join(format!(".sigil/worlds/{history}.egg"))).unwrap(),
        body
    );
}
