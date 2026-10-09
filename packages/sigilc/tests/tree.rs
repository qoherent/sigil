//! Merkle trees, the tree cache, and the tree diff.
use sigilc::language::{resolve::ResolvedWorkspace, workspace::Workspace};
use sigilc::tree::{Child, ResolvedTree, Snapshot, cache::TreeCache, diff::diff_trees};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
};

static NEXT: AtomicUsize = AtomicUsize::new(0);

struct Temp(PathBuf);

impl Temp {
    fn new(files: &[(&str, &str)]) -> Self {
        let root = std::env::temp_dir().join(format!(
            "sigilc-tree-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".sigil")).unwrap();
        fs::write(
            root.join(".sigil/config.json"),
            r#"{"sigilVersion":"0.9.0","workspace":{"name":"t"},"files":{"include":["**/*.sigil"]}}"#,
        )
        .unwrap();
        let temp = Temp(root);
        for (path, text) in files {
            temp.write(path, text);
        }
        temp
    }

    fn write(&self, path: &str, text: &str) {
        let target = self.0.join(path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, text).unwrap();
    }

    fn cache(&self) -> PathBuf {
        self.0.join(".sigil/trees")
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot::load(&self.0).unwrap()
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

const BASE: &str = "component A {
  goal {
    Offer a thing for callers.
  }

  logic {
    Step one happens.

    Step two happens.
  }

  constraints {
    First rule about things.

    Second rule about things.

    Third rule about things.
  }

  interface {
    A *thing* exists.
  }
}
";

fn only(snapshot: &Snapshot) -> &ResolvedTree {
    assert_eq!(snapshot.trees.len(), 1);
    &snapshot.trees[0]
}

fn section<'a>(
    tree: &'a ResolvedTree,
    component: &str,
    name: &str,
) -> &'a sigilc::tree::SectionNode {
    tree.parse
        .components
        .iter()
        .find(|c| c.name == component)
        .unwrap()
        .sections
        .iter()
        .find(|s| s.name == name)
        .unwrap()
}

fn facet_ids(tree: &ResolvedTree, component: &str, name: &str) -> Vec<String> {
    fn walk(children: &[Child], out: &mut Vec<String>) {
        for c in children {
            match c {
                Child::Facet(f) => out.push(f.id.clone()),
                Child::Group(g) => walk(&g.children, out),
            }
        }
    }
    let mut out = Vec::new();
    walk(&section(tree, component, name).children, &mut out);
    out
}

/// Every section, component, and file id of a tree, in order.
fn all_ids(tree: &ResolvedTree) -> Vec<String> {
    let mut ids = vec![tree.parse.file_id.clone()];
    for c in &tree.parse.components {
        ids.push(c.id.clone());
        ids.push(c.interface_hash.clone());
        for s in &c.sections {
            ids.push(s.id.clone());
            ids.extend(facet_ids(tree, &c.name, &s.name));
        }
    }
    ids
}

fn ranges(tree: &ResolvedTree) -> Vec<[usize; 2]> {
    tree.parse.components.iter().map(|c| c.range).collect()
}

#[test]
fn ae1_rewrapping_and_reindenting_every_paragraph_changes_no_id() {
    let temp = Temp::new(&[("a.sigil", BASE)]);
    let before = temp.snapshot();
    let rewrapped = BASE
        .replace(
            "Offer a thing for callers.",
            "Offer a thing\n      for callers.",
        )
        .replace("First rule about things.", "First   rule\n\tabout things.")
        .replace("Step one happens.", "    Step one\n    happens.");
    assert_ne!(rewrapped, BASE);
    temp.write("a.sigil", &rewrapped);
    let after = temp.snapshot();
    assert_eq!(all_ids(only(&before)), all_ids(only(&after)));
    assert_eq!(only(&before).parse.file_id, only(&after).parse.file_id);
    assert_ne!(only(&before).parse.key, only(&after).parse.key);
    let diff = diff_trees(&only(&before).parse, &only(&after).parse);
    assert!(diff.is_empty());
    assert_eq!(diff.visits.facets, 0);
}

#[test]
fn no_position_takes_part_in_any_id() {
    let temp = Temp::new(&[("a.sigil", BASE)]);
    let before = temp.snapshot();
    temp.write("a.sigil", &format!("\n\n\n\n{BASE}"));
    let after = temp.snapshot();
    assert_eq!(all_ids(only(&before)), all_ids(only(&after)));
    assert_ne!(ranges(only(&before)), ranges(only(&after)));
}

const WITH_PAYLOAD: &str = "component A {
  goal {
    Offer a thing.
  }

  interface {
    Introduce the payload.
    ```json
    {\"a\": 1}
    ```

    Another thing.
  }
}
";

#[test]
fn ae2_reindenting_a_payload_changes_that_facet_only() {
    let temp = Temp::new(&[("a.sigil", WITH_PAYLOAD)]);
    let before = temp.snapshot();
    temp.write(
        "a.sigil",
        &WITH_PAYLOAD.replace("{\"a\": 1}", "  {\"a\": 1}"),
    );
    let after = temp.snapshot();
    let (b, a) = (
        facet_ids(only(&before), "A", "interface"),
        facet_ids(only(&after), "A", "interface"),
    );
    assert_ne!(b[0], a[0]);
    assert_eq!(b[1], a[1]);
    assert_eq!(
        facet_ids(only(&before), "A", "goal"),
        facet_ids(only(&after), "A", "goal")
    );
    let diff = diff_trees(&only(&before).parse, &only(&after).parse);
    assert_eq!(diff.changed.len(), 1);
    assert!(diff.added.is_empty() && diff.removed.is_empty());
}

#[test]
fn ae3_constraint_order_is_free_and_logic_order_is_not() {
    let temp = Temp::new(&[("a.sigil", BASE)]);
    let before = temp.snapshot();
    let swapped_constraints = BASE
        .replace("First rule about things.", "TMP")
        .replace("Second rule about things.", "First rule about things.")
        .replace("TMP", "Second rule about things.");
    temp.write("a.sigil", &swapped_constraints);
    let after = temp.snapshot();
    let (b, a) = (only(&before), only(&after));
    assert_eq!(
        section(b, "A", "constraints").id,
        section(a, "A", "constraints").id
    );
    assert_eq!(b.parse.file_id, a.parse.file_id);

    let swapped_logic = BASE
        .replace("Step one happens.", "TMP")
        .replace("Step two happens.", "Step one happens.")
        .replace("TMP", "Step two happens.");
    temp.write("a.sigil", &swapped_logic);
    let after = temp.snapshot();
    let a = only(&after);
    assert_ne!(section(b, "A", "logic").id, section(a, "A", "logic").id);
    assert_eq!(
        section(b, "A", "constraints").id,
        section(a, "A", "constraints").id
    );
    let mut old = facet_ids(b, "A", "logic");
    old.sort();
    let mut new = facet_ids(a, "A", "logic");
    new.sort();
    assert_eq!(old, new);
    let diff = diff_trees(&b.parse, &a.parse);
    assert!(diff.added.is_empty() && diff.removed.is_empty() && diff.changed.is_empty());
    assert_eq!(diff.sections_changed.len(), 1);
    assert_eq!(diff.sections_changed[0].section, "logic");
}

const TWO: &str = "component A {
  goal {
    Offer a thing.
  }

  constraints {
    Keep it simple.

    shape {
      Keep it round.
    }
  }

  interface {
    A *thing* exists.
  }
}

component B {
  goal {
    Offer another.
  }

  interface {
    A *other* exists.
  }
}
";

#[test]
fn ae4_section_component_and_grouping_moves_change_the_id() {
    let temp = Temp::new(&[("a.sigil", TWO)]);
    let before = temp.snapshot();
    let b = only(&before);
    let simple = &facet_ids(b, "A", "constraints")[0];
    let round = &facet_ids(b, "A", "constraints")[1];

    // Between sections.
    let moved = TWO.replace("    Keep it simple.\n\n", "").replace(
        "    A *thing* exists.\n",
        "    A *thing* exists.\n\n    Keep it simple.\n",
    );
    temp.write("a.sigil", &moved);
    let after = temp.snapshot();
    assert!(
        facet_ids(only(&after), "A", "interface")
            .iter()
            .all(|i| i != simple)
    );
    assert!(!facet_ids(only(&after), "A", "interface").is_empty());

    // Between components.
    let moved = TWO.replace("    Keep it simple.\n\n", "").replace(
        "  interface {\n    A *other*",
        "  constraints {\n    Keep it simple.\n  }\n\n  interface {\n    A *other*",
    );
    temp.write("a.sigil", &moved);
    let after = temp.snapshot();
    assert_ne!(&facet_ids(only(&after), "B", "constraints")[0], simple);

    // Renaming the grouping Tag.
    temp.write("a.sigil", &TWO.replace("shape {", "form {"));
    let after = temp.snapshot();
    assert_ne!(&facet_ids(only(&after), "A", "constraints")[1], round);
    assert_eq!(&facet_ids(only(&after), "A", "constraints")[0], simple);
}

#[test]
fn identical_facets_take_ordinals_and_deleting_one_restores_the_base_id() {
    let twice = BASE.replace(
        "    First rule about things.\n",
        "    First rule about things.\n\n    First rule about things.\n",
    );
    let temp = Temp::new(&[("a.sigil", &twice)]);
    let doubled = temp.snapshot();
    let ids = facet_ids(only(&doubled), "A", "constraints");
    assert_eq!(ids.len(), 4);
    assert_ne!(ids[0], ids[1]);
    assert_eq!(ids[0].matches(':').count(), 1);
    assert!(ids[1].starts_with(&ids[0]) && ids[1].ends_with(":2"));
    temp.write("a.sigil", BASE);
    let single = temp.snapshot();
    assert_eq!(facet_ids(only(&single), "A", "constraints")[0], ids[0]);
    let diff = diff_trees(&only(&doubled).parse, &only(&single).parse);
    assert_eq!(diff.removed.len(), 1);
    assert_eq!(diff.removed[0].id, ids[1]);
}

#[test]
fn a_renamed_source_gets_new_ids_and_copies_get_distinct_ids() {
    let old = Temp::new(&[("a.sigil", BASE)]);
    let new = Temp::new(&[("renamed/b.sigil", BASE)]);
    let (old, new) = (old.snapshot(), new.snapshot());
    let (o, n) = (only(&old), only(&new));
    assert_ne!(o.parse.key, n.parse.key);
    assert!(n.parse.components[0].iri.contains("renamed%2Fb.sigil"));
    assert!(o.parse.components[0].iri.ends_with("a.sigil:A"));
    for (a, b) in facet_ids(o, "A", "constraints")
        .iter()
        .zip(facet_ids(n, "A", "constraints"))
    {
        assert_ne!(*a, b);
    }
    assert_ne!(o.parse.file_id, n.parse.file_id);

    let both = Temp::new(&[("a.sigil", BASE), ("b.sigil", BASE)]);
    let snapshot = both.snapshot();
    let (a, b) = (&snapshot.trees[0], &snapshot.trees[1]);
    assert_eq!(a.parse.path, "a.sigil");
    for (x, y) in all_ids(a)
        .iter()
        .zip(all_ids(b))
        .filter(|(x, _)| x.starts_with("facet:"))
    {
        assert_ne!(*x, y);
    }
    assert!(
        snapshot
            .diagnostics
            .iter()
            .any(|d| d.code == "SIGIL_DUPLICATE_COMPONENT")
    );
    assert!(!a.resolution.components[0].identity_resolved);
}

#[test]
fn same_named_components_in_one_file_take_a_dup_ordinal() {
    let temp = Temp::new(&[("a.sigil", &format!("{BASE}\n{BASE}"))]);
    let snapshot = temp.snapshot();
    let tree = only(&snapshot);
    let iris: Vec<&str> = tree
        .parse
        .components
        .iter()
        .map(|c| c.iri.as_str())
        .collect();
    assert!(iris[0].ends_with(":A") && iris[1].ends_with(":A:dup:2"));
    assert!(iris.iter().all(|i| !i.contains(":at:")));
    assert_ne!(
        facet_ids(tree, "A", "goal")[0],
        tree.parse.components[1].sections[0]
            .children
            .iter()
            .map(|c| c.id().to_owned())
            .next()
            .unwrap()
    );
}

const PROVIDER: &str = "component A {
  goal {
    Own alpha.
  }

  logic {
    Hidden detail one.
  }

  constraints {
    Hidden rule.
  }

  interface {
    An *alpha* exists.
  }
}
";

const CONSUMER: &str = "@a.sigil from A import { alpha }

component B {
  goal {
    Use alpha.
  }

  interface {
    B relies on alpha.
  }
}
";

#[test]
fn ae5_private_edits_leave_the_interface_hash_and_dependents_alone() {
    let temp = Temp::new(&[("a.sigil", PROVIDER), ("b.sigil", CONSUMER)]);
    let before = temp.snapshot();
    assert!(before.diagnostics.is_empty(), "{:?}", before.diagnostics);
    let (a0, b0) = (&before.trees[0], &before.trees[1]);

    temp.write(
        "a.sigil",
        &PROVIDER
            .replace("Hidden detail one.", "Hidden detail two, longer.")
            .replace("Hidden rule.", "Another hidden rule."),
    );
    let after = temp.snapshot();
    let (a1, b1) = (&after.trees[0], &after.trees[1]);
    assert_ne!(a0.parse.file_id, a1.parse.file_id);
    assert_eq!(
        a0.parse.components[0].interface_hash,
        a1.parse.components[0].interface_hash
    );
    assert_eq!(b0.id, b1.id);
    assert_eq!(after.stats.resolved_hits, 1);
    assert_eq!(after.stats.resolved_misses, 1);

    temp.write(
        "a.sigil",
        &PROVIDER.replace("An *alpha* exists.", "An *alpha* exists, changed."),
    );
    let after = temp.snapshot();
    let (a2, b2) = (&after.trees[0], &after.trees[1]);
    assert_ne!(
        a0.parse.components[0].interface_hash,
        a2.parse.components[0].interface_hash
    );
    assert_ne!(b0.id, b2.id);
    // B's own parse layer is untouched.
    assert_eq!(b0.parse.key, b2.parse.key);
    assert_eq!(after.stats.parse_hits, 1);
}

fn corpus() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../spec/conformance")
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

#[test]
fn mutual_imports_resolve_and_each_side_sees_the_others_interface() {
    let temp = Temp::new(&[]);
    fs::remove_dir_all(&temp.0).unwrap();
    copy_dir(&corpus().join("c05-mutual-import/workspace"), &temp.0);
    let before = temp.snapshot();
    assert!(before.diagnostics.is_empty(), "{:?}", before.diagnostics);
    for tree in &before.trees {
        assert_eq!(tree.resolution.imports[0].status, "resolved");
        assert_eq!(tree.resolution.imports[0].names[0].status, "resolved");
    }
    let a = fs::read_to_string(temp.0.join("a.sigil")).unwrap();
    temp.write(
        "a.sigil",
        &a.replace("exists and uses beta", "exists, loudly, and uses beta"),
    );
    let after = temp.snapshot();
    assert_ne!(
        before.trees[0].parse.components[0].interface_hash,
        after.trees[0].parse.components[0].interface_hash
    );
    assert_ne!(before.trees[1].id, after.trees[1].id);
    assert_eq!(before.trees[1].parse.key, after.trees[1].parse.key);
    assert!(after.diagnostics.is_empty());
}

#[test]
fn a_second_run_reuses_every_entry() {
    let temp = Temp::new(&[("a.sigil", PROVIDER), ("b.sigil", CONSUMER)]);
    let first = temp.snapshot();
    assert_eq!(
        (first.stats.parse_misses, first.stats.resolved_misses),
        (2, 2)
    );
    let second = temp.snapshot();
    assert_eq!(second.stats.parse_misses + second.stats.resolved_misses, 0);
    assert_eq!(
        (second.stats.parse_hits, second.stats.resolved_hits),
        (2, 2)
    );
    for (x, y) in first.trees.iter().zip(&second.trees) {
        assert_eq!(x.to_json(), y.to_json());
    }
}

fn json(snapshot: &Snapshot) -> String {
    let trees: Vec<String> = snapshot.trees.iter().map(ResolvedTree::to_json).collect();
    format!(
        "{}{}",
        trees.join("\n"),
        serde_json::to_string(&snapshot.diagnostics).unwrap()
    )
}

#[test]
fn deleting_the_cache_and_corrupting_it_change_no_output() {
    let temp = Temp::new(&[("a.sigil", PROVIDER), ("b.sigil", CONSUMER)]);
    let first = json(&temp.snapshot());
    let uncached = json(&Snapshot::load_with(&temp.0, None).unwrap());
    assert_eq!(first, uncached);

    fs::remove_dir_all(temp.cache()).unwrap();
    assert_eq!(json(&temp.snapshot()), first);

    // Truncate every entry, then break one with the wrong version.
    for kind in ["parse", "resolved", "sources"] {
        for entry in fs::read_dir(temp.cache().join(kind)).unwrap() {
            let path = entry.unwrap().path();
            let text = fs::read_to_string(&path).unwrap();
            fs::write(path, &text[..text.len() / 2]).unwrap();
        }
    }
    let rebuilt = temp.snapshot();
    assert_eq!(json(&rebuilt), first);
    assert_eq!(
        (rebuilt.stats.parse_misses, rebuilt.stats.resolved_misses),
        (2, 2)
    );
    assert_eq!(rebuilt.stats.parse_hits + rebuilt.stats.resolved_hits, 0);

    for entry in fs::read_dir(temp.cache().join("parse")).unwrap() {
        let path = entry.unwrap().path();
        let text = fs::read_to_string(&path)
            .unwrap()
            .replacen("\"format\":1", "\"format\":99", 1);
        fs::write(path, text).unwrap();
    }
    let rebuilt = temp.snapshot();
    assert_eq!(json(&rebuilt), first);
    assert_eq!(rebuilt.stats.parse_misses, 2);
}

#[test]
fn the_cache_keeps_the_current_and_previous_tree_per_source() {
    let temp = Temp::new(&[("a.sigil", BASE)]);
    let v0 = temp.snapshot();
    let edit = |n: usize| BASE.replace("Third rule about things.", &format!("Third rule {n}."));
    temp.write("a.sigil", &edit(1));
    let v1 = temp.snapshot();
    let previous = TreeCache::new(&temp.cache()).previous("a.sigil").unwrap();
    assert_eq!(previous.id, only(&v0).id);
    let diff = diff_trees(&previous.parse, &only(&v1).parse);
    assert_eq!(diff.changed.len(), 1);
    assert!(diff.added.is_empty() && diff.removed.is_empty());
    assert_eq!(diff.sections_changed.len(), 1);

    temp.write("a.sigil", &edit(2));
    temp.snapshot();
    temp.write("a.sigil", &edit(3));
    temp.snapshot();
    for kind in ["parse", "resolved"] {
        assert_eq!(fs::read_dir(temp.cache().join(kind)).unwrap().count(), 2);
    }
    let previous = TreeCache::new(&temp.cache()).previous("a.sigil").unwrap();
    assert_ne!(previous.id, only(&v1).id);
}

#[test]
fn the_diff_does_not_descend_into_equal_subtrees() {
    let temp = Temp::new(&[("a.sigil", TWO)]);
    let before = temp.snapshot();
    temp.write("a.sigil", &TWO.replace("Keep it simple.", "Keep it plain."));
    let after = temp.snapshot();
    let diff = diff_trees(&only(&before).parse, &only(&after).parse);
    assert_eq!(diff.changed.len(), 1);
    // Component B and every unchanged section of A stay closed.
    assert_eq!(diff.visits.components, 1);
    assert_eq!(diff.visits.sections, 1);
    assert_eq!(diff.visits.facets, 4);
    assert_eq!(diff.sections_changed.len(), 1);

    let same = diff_trees(&only(&before).parse, &only(&before).parse);
    assert!(same.is_empty());
    assert_eq!(
        same.visits.components + same.visits.sections + same.visits.facets,
        0
    );
}

#[test]
fn trees_carry_resolution_and_serialize_deterministically() {
    let temp = Temp::new(&[("a.sigil", PROVIDER), ("b.sigil", CONSUMER)]);
    let snapshot = temp.snapshot();
    let b = &snapshot.trees[1];
    assert_eq!(
        b.resolution.imports[0]
            .provider_iri
            .as_deref()
            .map(|s| s.ends_with(":A")),
        Some(true)
    );
    assert_eq!(b.resolution.references.len(), 2);
    assert!(
        b.resolution.references[0]
            .tag_iri
            .as_deref()
            .unwrap()
            .ends_with(":A:tag:alpha")
    );
    assert_eq!(b.to_json(), temp.snapshot().trees[1].to_json());
    let a = &snapshot.trees[0];
    assert_eq!(
        a.resolution.components[0].tags[0]
            .iri
            .as_deref()
            .map(|s| s.ends_with(":tag:alpha")),
        Some(true)
    );
}

#[test]
fn a_tree_with_errors_keeps_its_diagnostics() {
    let temp = Temp::new(&[(
        "a.sigil",
        "@missing.sigil from M import { x }\n\ncomponent A {\n  goal {\n    G.\n  }\n}\n",
    )]);
    let snapshot = temp.snapshot();
    let tree = only(&snapshot);
    assert_eq!(tree.resolution.imports[0].status, "unresolvedPath");
    assert!(!tree.resolution.diagnostics.is_empty());
}

#[test]
fn snapshots_agree_with_whole_workspace_resolution_on_the_corpus() {
    let scratch = Temp::new(&[]);
    for entry in fs::read_dir(corpus()).unwrap() {
        let dir = entry.unwrap().path().join("workspace");
        if !dir.is_dir() {
            continue;
        }
        let workspace = Workspace::load(&dir).unwrap();
        let expected =
            serde_json::to_value(&ResolvedWorkspace::from(&workspace).diagnostics).unwrap();
        let cache = scratch.0.join(dir.parent().unwrap().file_name().unwrap());
        for pass in 0..2 {
            let snapshot = Snapshot::load_with(&dir, Some(&cache)).unwrap();
            assert_eq!(
                serde_json::to_value(&snapshot.diagnostics).unwrap(),
                expected,
                "{} pass {pass}",
                dir.display()
            );
        }
    }
}
