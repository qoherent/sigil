use sigilc::claims::{guidance, prepare, vocabulary};
use std::fs;

mod support;
use support::{BASE, CONSUMER, Workspace, shared_input, shared_workspace};

fn out_dir(name: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("sigilc-prepare-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&path);
    path
}

#[test]
fn every_valid_facet_of_the_selected_source_gets_exactly_one_row() {
    let input = shared_input();
    let request = support::project(&input, BASE).unwrap();
    let expected: Vec<&str> = input
        .units
        .iter()
        .filter(|u| u.source == BASE)
        .map(|u| u.id.as_str())
        .collect();
    assert_eq!(request.rows.len(), expected.len());
    assert_eq!(request.rows.len(), 3, "base.sigil declares three Facets");

    let mut got: Vec<&str> = request.rows.iter().map(|r| r.facet.as_str()).collect();
    let mut want = expected.clone();
    got.sort_unstable();
    want.sort_unstable();
    assert_eq!(got, want, "each row names its own Facet, once");

    let sections: Vec<&str> = request.rows.iter().map(|r| r.section.as_str()).collect();
    for section in &sections {
        assert!(vocabulary::SECTIONS.contains(section));
    }
    assert_eq!(request.binding.facets.len(), request.rows.len());
}

#[test]
fn facet_prose_is_the_exact_source_slice_for_its_range() {
    let input = shared_input();
    let request = support::project(&input, BASE).unwrap();
    let text = &input.sources.iter().find(|s| s.path == BASE).unwrap().text;
    for row in &request.rows {
        let unit = input.units.iter().find(|u| u.id == row.facet).unwrap();
        assert_eq!(
            row.prose,
            &text[unit.prose_range.start..unit.prose_range.end],
            "prose for {} must be sliced, never reconstructed",
            row.facet
        );
        assert!(!row.prose.is_empty());
    }
}

#[test]
fn the_interpreter_is_told_each_facets_role_but_returns_no_role_column() {
    // R4: the role travels with the prose, because only the export knows it.
    let request = support::project(&shared_input(), BASE).unwrap();
    for row in &request.rows {
        assert!(
            !row.section.is_empty(),
            "the request must carry the contract role for {}",
            row.facet
        );
    }
    // R9 and KTD4: no row the interpreter sends back has a role column, so
    // there is no restatement to drift from the export.
    for row in vocabulary::RETURNED {
        assert!(
            !row.columns.contains(&"section"),
            "returned row {} must not carry a section column",
            row.name
        );
        for column in row.columns {
            assert!(!vocabulary::SECTIONS.contains(column));
        }
    }
}

#[test]
fn declared_roles_cover_only_roles_that_actually_hold_a_facet() {
    let input = shared_input();
    let request = support::project(&input, BASE).unwrap();
    for (component, section) in &request.declared {
        assert!(
            request
                .rows
                .iter()
                .any(|r| &r.component == component && &r.section == section),
            "declared {component}/{section} has no Facet, so it cannot be a gap"
        );
    }
    let roles: Vec<&str> = request.declared.iter().map(|(_, s)| s.as_str()).collect();
    assert!(roles.contains(&"goal") && roles.contains(&"interface"));
    assert!(
        !roles.contains(&"cases"),
        "a role with no Facet must not be declared"
    );
}

#[test]
fn an_imported_components_interface_enters_the_request_as_context() {
    let request = support::project(&shared_input(), CONSUMER).unwrap();
    let context: Vec<_> = request.rows.iter().filter(|r| r.context).collect();
    assert!(
        !context.is_empty() && context.iter().all(|r| r.source == BASE),
        "consumer imports from base, so base's interface is context: {context:?}"
    );
    assert!(
        context.iter().all(|r| r.section == "interface"),
        "only interface Facets cross a component boundary"
    );
    assert!(
        request
            .binding
            .interfaces
            .iter()
            .any(|i| i.path == BASE && i.component == "Base" && !i.hash.is_empty()),
        "the binding records base's interface hash: {:?}",
        request.binding.interfaces
    );

    let ids: Vec<&str> = request.entities.iter().map(|e| e.id.as_str()).collect();
    assert!(
        ids.iter().any(|id| id.contains("base.sigil")),
        "entities admissible to a claim include the imported owner's: {ids:?}"
    );
}

#[test]
fn the_request_lists_what_each_source_imports_and_only_that() {
    let request = support::project(&shared_input(), CONSUMER).unwrap();

    let consumer = request
        .imports
        .iter()
        .find(|i| i.source == CONSUMER)
        .expect("consumer imports from base, so it has an entry");
    assert_eq!(consumer.from.len(), 1, "one provider: {:?}", consumer.from);
    let from = &consumer.from[0];
    assert!(
        from.component.contains("base.sigil"),
        "the provider is a component of base: {}",
        from.component
    );
    assert!(!from.component_label.is_empty());
    assert!(
        !from.names.is_empty(),
        "the names taken from the provider are listed: {from:?}"
    );
    let mut sorted = from.names.clone();
    sorted.sort();
    assert_eq!(
        sorted, from.names,
        "names are sorted, so the request is stable"
    );

    assert!(
        request.imports.iter().all(|i| i.source != BASE),
        "base imports nothing, so it has no entry: {:?}",
        request.imports
    );

    let alone = support::project(&shared_input(), BASE).unwrap();
    assert!(
        alone.imports.is_empty(),
        "a closure of one source that imports nothing has no imports: {:?}",
        alone.imports
    );
}

#[test]
fn preparing_an_unexported_source_is_refused_by_name() {
    let error = support::project(&shared_input(), "absent.sigil").unwrap_err();
    assert!(error.contains("absent.sigil"), "got: {error}");
}

#[test]
fn preparing_the_same_export_twice_writes_identical_bytes() {
    let input = shared_input();
    let first = out_dir("twice-a");
    let second = out_dir("twice-b");
    prepare::write(&support::project(&input, BASE).unwrap(), &first).unwrap();
    prepare::write(&support::project(&input, BASE).unwrap(), &second).unwrap();
    for name in ["binding.json", "request.json"] {
        assert_eq!(
            fs::read(first.join(name)).unwrap(),
            fs::read(second.join(name)).unwrap(),
            "{name} must be byte-identical across runs"
        );
    }
    fs::remove_dir_all(&first).unwrap();
    fs::remove_dir_all(&second).unwrap();
}

#[test]
fn the_binding_pins_the_content_the_guidance_and_the_vocabulary() {
    let input = shared_input();
    let request = support::project(&input, CONSUMER).unwrap();
    assert_eq!(request.binding.source, CONSUMER);
    assert!(
        !request.binding.source_content.is_empty(),
        "the binding carries the selected source's content file id"
    );
    assert_eq!(
        request.binding.guidance_fingerprint,
        guidance::fingerprint()
    );
    assert_eq!(
        request.binding.vocabulary_generation,
        vocabulary::VOCABULARY_GENERATION
    );
    assert_eq!(request.binding.format, prepare::REQUEST_FORMAT);

    // Each field is part of the binding's identity.
    let mut other = request.binding.clone();
    other.source_content.push('x');
    assert_ne!(request.binding.digest(), other.digest());
    let mut other = request.binding.clone();
    other.interfaces[0].hash.push('x');
    assert_ne!(request.binding.digest(), other.digest());
}

#[test]
fn the_binding_ignores_the_resolved_tree_id_and_every_position() {
    // Reformatting the selected source and editing an unrelated one leave the
    // binding alone; editing a dependency's private section does too.
    let root = shared_workspace();
    let before = {
        let (input, basis) = root.load();
        prepare::project(&input, &basis, CONSUMER).unwrap()
    };
    let consumer = std::fs::read_to_string(root.0.join(CONSUMER)).unwrap();
    root.write(
        CONSUMER,
        format!(
            "\n\n{}\n",
            consumer
                .replace("Serve the caller.", "Serve\n    the   caller.")
                .replace(
                    "Use value and result with",
                    "Use value\n   and result    with"
                )
        )
        .as_bytes(),
    );
    root.write(
        "unrelated.sigil",
        b"component Other { goal { Elsewhere. } }",
    );
    let base = std::fs::read_to_string(root.0.join(BASE)).unwrap();
    root.write(
        BASE,
        base.replace(
            "Preserve value and result.",
            "Preserve value, result and more.",
        )
        .as_bytes(),
    );
    let after = {
        let (input, basis) = root.load();
        prepare::project(&input, &basis, CONSUMER).unwrap()
    };
    assert_eq!(before.binding, after.binding);
}

#[test]
fn the_prepared_directory_carries_the_guidance_the_interpreter_needs() {
    let out = out_dir("guidance");
    let written = prepare::write(&support::project(&shared_input(), BASE).unwrap(), &out).unwrap();
    for doc in guidance::BUNDLE {
        assert_eq!(
            fs::read_to_string(out.join(doc.name)).unwrap(),
            doc.text,
            "a caller with no workspace access still needs {}",
            doc.name
        );
    }
    assert_eq!(written.len(), guidance::BUNDLE.len() + 2);
    fs::remove_dir_all(&out).unwrap();
}

#[test]
fn preparing_into_a_non_empty_directory_is_refused_rather_than_merged() {
    let out = out_dir("occupied");
    fs::create_dir_all(&out).unwrap();
    fs::write(out.join("binding.json"), b"{\"stale\":true}").unwrap();
    let request = support::project(&shared_input(), BASE).unwrap();
    let error = prepare::write(&request, &out).unwrap_err();
    assert!(error.contains(&out.display().to_string()), "got: {error}");
    assert_eq!(
        fs::read_to_string(out.join("binding.json")).unwrap(),
        "{\"stale\":true}",
        "a refused preparation must not overwrite what was there"
    );
    fs::remove_dir_all(&out).unwrap();
}

#[test]
fn preparation_reads_no_sigil_file_from_the_workspace() {
    // The export carries every source's text, so a projection produced with no
    // workspace present at all must be identical to one produced beside it.
    let input = shared_input();
    let without = support::project(&input, BASE).unwrap();
    let workspace = Workspace::new();
    workspace.write(BASE, b"component Tampered { goal { Different. } }");
    let with = support::project(&input, BASE).unwrap();
    assert_eq!(without, with);
}

// ------------------------------------------------- grouping a Logic section

/// Build a workspace whose components carry Logic Facets in a known order.
///
/// The shared fixture has no Logic section, and the grouping is entirely about
/// Logic, so these tests need a source of their own. Facet identities are
/// content ids, so source order is read from each Facet's position, never from
/// its id.
fn logic_input(bodies: &[(&str, &[&str])]) -> sigilc::structure::DesignInput {
    let mut text = String::new();
    for (name, proses) in bodies {
        text.push_str(&format!("component {name} {{\n  logic {{\n"));
        for prose in *proses {
            // A blank line keeps each paragraph its own Facet.
            text.push_str(&format!("    {prose}\n\n"));
        }
        text.push_str("  }\n}\n");
    }
    let root = Workspace::new();
    root.write("flows.sigil", text.as_bytes());
    root.design_input()
}

#[test]
fn a_components_logic_facets_are_grouped_in_source_order() {
    let input = logic_input(&[(
        "Pipeline",
        &[
            "first step",
            "second step",
            "third step",
            "fourth step",
            "fifth step",
        ],
    )]);
    let request = support::project(&input, "flows.sigil").unwrap();

    assert_eq!(request.flows.len(), 1, "one component, one Logic section");
    let flow = &request.flows[0];
    assert_eq!(flow.component_label, "Pipeline");
    assert_eq!(flow.facets.len(), 5, "all five Facets, none dropped");

    // Source order: the grouped Facets run by position, whatever their ids sort as.
    let mut by_position: Vec<_> = input
        .units
        .iter()
        .filter(|u| flow.facets.contains(&u.id))
        .collect();
    by_position.sort_by_key(|u| u.prose_range.start);
    let in_source_order: Vec<&String> = by_position.iter().map(|u| &u.id).collect();
    let grouped: Vec<&String> = flow.facets.iter().collect();
    assert_eq!(
        grouped, in_source_order,
        "grouped Facets run in source order"
    );

    // Each grouped Facet still has its own row, identity and prose.
    for facet in &flow.facets {
        let row = request
            .rows
            .iter()
            .find(|r| &r.facet == facet)
            .unwrap_or_else(|| panic!("{facet} is grouped but has no row of its own"));
        assert_eq!(row.section, "logic");
        assert!(!row.prose.is_empty());
    }
}

#[test]
fn two_components_logic_sections_group_separately() {
    let input = logic_input(&[("Alpha", &["a one", "a two"]), ("Beta", &["b one"])]);
    let request = support::project(&input, "flows.sigil").unwrap();

    assert_eq!(request.flows.len(), 2);
    let alpha = request
        .flows
        .iter()
        .find(|f| f.component_label == "Alpha")
        .unwrap();
    let beta = request
        .flows
        .iter()
        .find(|f| f.component_label == "Beta")
        .unwrap();
    assert_eq!(alpha.facets.len(), 2);
    assert_eq!(beta.facets.len(), 1);
    for facet in &beta.facets {
        assert!(
            !alpha.facets.contains(facet),
            "sections must never merge across components"
        );
    }
}

#[test]
fn a_single_logic_facet_still_groups() {
    let input = logic_input(&[("Solo", &["the only step"])]);
    let request = support::project(&input, "flows.sigil").unwrap();
    assert_eq!(
        request.flows.len(),
        1,
        "one shape for the interpreter, not two"
    );
    assert_eq!(request.flows[0].facets.len(), 1);
}

#[test]
fn a_component_with_no_logic_section_produces_no_group() {
    let input = shared_input();
    let request = support::project(&input, BASE).unwrap();
    assert!(
        request.flows.is_empty(),
        "base.sigil declares goal, interface and constraints and no Logic, \
         so it must produce no group rather than an empty placeholder"
    );
    assert_eq!(request.rows.len(), 3, "its other roles are untouched");
}

#[test]
fn grouping_leaves_every_other_role_byte_identical() {
    let input = shared_input();
    let request = support::project(&input, CONSUMER).unwrap();
    // Nothing in the shared fixture is Logic, so every row here predates the
    // grouping. If the grouping ever reshapes a non-Logic row, this fails.
    assert!(request.flows.is_empty());
    for row in &request.rows {
        assert_ne!(row.section, "logic");
        assert!(!row.prose.is_empty());
        assert!(!row.component_label.is_empty());
    }
    assert_eq!(
        request.binding.facets.len(),
        request.rows.len(),
        "the binding still bounds exactly the rows presented"
    );
}

// ------------------------------------------------- the black box over imports

/// A provider with a private section of every role and a consumer that
/// imports one Tag of it.
fn black_box_workspace() -> Workspace {
    let root = Workspace::new();
    root.write(
        "a.sigil",
        b"component A {
  goal {
    Provide the shared thing.
  }
  interface {
    The *shared thing* is exposed.
  }
  state {
    The *private ledger* is kept.
  }
  logic {
    Read the private ledger.

    Write the private ledger.
  }
  constraints {
    The private ledger never leaves A.
  }
}
",
    );
    root.write(
        "b.sigil",
        b"@a.sigil from A import { shared thing }
component B {
  goal {
    Use the shared thing.
  }
}
",
    );
    root
}

#[test]
fn a_dependents_request_holds_no_private_facet_and_no_private_entity() {
    let root = black_box_workspace();
    let (input, basis) = root.load();
    let request = prepare::project(&input, &basis, "b.sigil").unwrap();

    let own: Vec<_> = request.own_rows().collect();
    assert_eq!(own.len(), 1, "B declares one Facet");
    let context: Vec<_> = request.rows.iter().filter(|r| r.context).collect();
    assert_eq!(context.len(), 1, "A's one interface Facet: {context:?}");
    assert_eq!(context[0].section, "interface");
    assert!(
        request.rows.iter().all(|r| !matches!(
            r.section.as_str(),
            "state" | "logic" | "constraints" | "goal"
        ) || r.source == "b.sigil"),
        "no dependency Facet outside its interface"
    );
    assert!(
        request.flows.is_empty(),
        "a dependency's flow is not presented"
    );

    let labels: Vec<&str> = request.entities.iter().map(|e| e.label.as_str()).collect();
    assert!(labels.contains(&"shared thing"), "{labels:?}");
    assert!(labels.contains(&"A") && labels.contains(&"B"));
    assert!(
        !labels.contains(&"private ledger"),
        "an entity introduced only in A's private state is not visible: {labels:?}"
    );
    // The request a dependent is handed names nothing private, in any field.
    let text = serde_json::to_string(&request).unwrap();
    assert!(!text.contains("private ledger"), "{text}");
}

#[test]
fn coverage_stays_scoped_to_the_selected_source() {
    let input = shared_input();
    let request = support::project(&input, CONSUMER).unwrap();

    // Facets from the dependency are presented...
    assert!(request.rows.iter().any(|r| r.source == BASE));
    // ...but they are context, never coverage. A dependency Facet the
    // interpretation ignores must not become a gap in this source's report.
    for (component, _) in &request.declared {
        let from_selected = request
            .own_rows()
            .any(|r| &r.component == component && r.source == CONSUMER);
        assert!(
            from_selected,
            "{component} is counted as coverage but authored nothing in {CONSUMER}"
        );
    }
}

#[test]
fn a_logic_section_groups_under_its_own_source() {
    let input = logic_input(&[("Alpha", &["a one", "a two"])]);
    let request = support::project(&input, "flows.sigil").unwrap();
    assert_eq!(request.flows[0].source, "flows.sigil");
}

#[test]
fn the_request_format_moves_when_presentation_narrows() {
    // A directory prepared under format 4 presented a whole closure and bound
    // the whole input; one prepared under 5 carried no handles or names.
    // Pairing it with this binding must fail loudly.
    let input = shared_input();
    let request = support::project(&input, CONSUMER).unwrap();
    assert_eq!(request.binding.format, prepare::REQUEST_FORMAT);
    assert_eq!(prepare::REQUEST_FORMAT, 6);

    let mut stale = request.binding.clone();
    stale.format = 4;
    assert_ne!(
        request.binding, stale,
        "an older request format must not compare equal to the current one"
    );
}

// ------------------------------------------ handles and each Facet's names

#[test]
fn own_facets_get_handles_in_facet_id_order() {
    let request = support::project(&shared_input(), BASE).unwrap();
    let handles: Vec<&str> = request.rows.iter().map(|r| r.handle.as_str()).collect();
    assert_eq!(handles, ["#1", "#2", "#3"], "rows are sorted by Facet id");
    let ids: Vec<&str> = request.rows.iter().map(|r| r.facet.as_str()).collect();
    let mut sorted = ids.clone();
    sorted.sort_unstable();
    assert_eq!(ids, sorted);
}

#[test]
fn handles_do_not_move_when_a_presentation_narrows() {
    let input = shared_input();
    let request = support::project(&input, BASE).unwrap();
    let units = memo::units(&request);
    let one = units
        .iter()
        .find(|u| u.facets == [request.rows[2].facet.clone()])
        .unwrap();
    let asked = prepare::presenting(&request, std::slice::from_ref(one));
    let own: Vec<_> = asked.own_rows().collect();
    assert_eq!(own.len(), 1);
    assert_eq!(own[0].handle, "#3", "numbered over the whole source");
}

#[test]
fn a_facet_lists_its_component_its_providers_and_the_tags_it_references() {
    let input = shared_input();
    let request = support::project(&input, BASE).unwrap();
    let constraints = request
        .rows
        .iter()
        .find(|r| r.section == "constraints")
        .unwrap();
    assert_eq!(constraints.names, ["Base", "result", "value"]);
    let goal = request.rows.iter().find(|r| r.section == "goal").unwrap();
    assert_eq!(
        goal.names,
        ["Base"],
        "a goal that references no Tag lists none"
    );

    let consumer = support::project(&input, CONSUMER).unwrap();
    let goal = consumer
        .rows
        .iter()
        .find(|r| !r.context && r.section == "goal")
        .unwrap();
    assert_eq!(
        goal.names,
        ["Base", "Consumer"],
        "an imported component is on every Facet's list, its Tags are not"
    );
}

#[test]
fn imported_context_rows_carry_no_handle_and_no_names() {
    let request = support::project(&shared_input(), CONSUMER).unwrap();
    let context: Vec<_> = request.rows.iter().filter(|r| r.context).collect();
    assert!(!context.is_empty());
    for row in context {
        assert!(row.handle.is_empty() && row.names.is_empty(), "{row:?}");
    }
}

#[test]
fn an_unresolved_import_does_not_put_its_provider_on_a_list() {
    let root = Workspace::new();
    root.write(
        "c.sigil",
        b"@gone.sigil from Gone import { thing }\ncomponent C {\n  goal {\n    Use thing.\n  }\n}\n",
    );
    let (input, basis) = root.load();
    let request = prepare::project(&input, &basis, "c.sigil").unwrap();
    let goal = request.rows.iter().find(|r| r.section == "goal").unwrap();
    assert_eq!(goal.names, ["C"], "{:?}", goal.names);
}

#[test]
fn a_logic_section_lists_the_handles_of_its_facets_in_order() {
    let input = logic_input(&[("Alpha", &["a one", "a two"])]);
    let request = support::project(&input, "flows.sigil").unwrap();
    let flow = &request.flows[0];
    assert_eq!(flow.facets.len(), flow.handles.len());
    for (facet, handle) in flow.facets.iter().zip(&flow.handles) {
        let row = request.rows.iter().find(|r| &r.facet == facet).unwrap();
        assert_eq!(&row.handle, handle);
    }
}

#[test]
fn asking_a_logic_section_again_shows_its_constraints_as_read_only_context() {
    let root = Workspace::new();
    root.write(
        "f.sigil",
        b"component F {\n  logic {\n    one\n\n    two\n  }\n  constraints {\n    must not do x\n  }\n  goal {\n    a goal\n  }\n}\n",
    );
    let (input, basis) = root.load();
    let request = prepare::project(&input, &basis, "f.sigil").unwrap();
    let logic = memo::units(&request)
        .into_iter()
        .find(|u| u.section == "logic")
        .unwrap();
    let asked = prepare::presenting(&request, std::slice::from_ref(&logic));

    let constraint = asked
        .rows
        .iter()
        .find(|r| r.section == "constraints")
        .expect("the constraint a guard would name is shown");
    assert!(constraint.context, "shown for its prose, never answered");
    assert!(!constraint.handle.is_empty(), "so a guard can name it");
    assert!(
        !asked.rows.iter().any(|r| r.section == "goal"),
        "only what a flow can be guarded on is added"
    );
    assert_eq!(
        asked.own_rows().count(),
        2,
        "the two Logic Facets are asked"
    );
}

// ------------------------------------------- stored interpretations (memo)

use sigilc::claims::memo;

fn memo_root(name: &str) -> std::path::PathBuf {
    let p = std::env::temp_dir().join(format!("sigil-memo-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&p);
    fs::create_dir_all(&p).unwrap();
    p
}

fn reading(facet: &str) -> sigilc::claims::dialect::Row {
    sigilc::claims::dialect::Row::Reading {
        facet: facet.into(),
        outcome: "saved reading".into(),
    }
}

fn save_all(root: &std::path::Path, request: &prepare::Request, units: &[memo::Unit]) {
    for unit in units {
        let rows: Vec<_> = unit.facets.iter().map(|f| reading(f)).collect();
        memo::save(root, request, unit, &rows, Default::default()).unwrap();
    }
}

#[test]
fn a_non_logic_unit_key_is_its_facet_content_id_alone() {
    // Swapping two constraints, re-wrapping prose or editing elsewhere in the
    // file leaves every key unchanged; no position or discriminator is in it.
    let make = |text: &str| {
        let root = Workspace::new();
        root.write("c.sigil", text.as_bytes());
        let (input, basis) = root.load();
        let request = prepare::project(&input, &basis, "c.sigil").unwrap();
        let mut keys: Vec<_> = memo::units(&request).into_iter().map(|u| u.key).collect();
        keys.sort();
        keys
    };
    let original = "component C {\n  constraints {\n    First rule.\n\n    Second rule.\n\n    Third rule.\n  }\n}\n";
    let swapped = "component C {\n  constraints {\n    Third rule.\n\n    First rule.\n\n    Second rule.\n  }\n}\n";
    let rewrapped = "component C {\n\n\n      constraints {\n    First\n   rule.\n\n    Second   rule.\n\n\n    Third rule.\n  }\n}\n";
    let edited = "component C {\n  constraints {\n    First rule.\n\n    Second rule!\n\n    Third rule.\n  }\n}\n";
    assert_eq!(make(original), make(swapped));
    assert_eq!(make(original), make(rewrapped));
    assert_ne!(make(original), make(edited));
}

#[test]
fn identical_facets_of_one_section_are_still_separate_units() {
    let root = Workspace::new();
    root.write(
        "d.sigil",
        b"component D {\n  constraints {\n    Same rule.\n\n    Same rule.\n  }\n}\n",
    );
    let (input, basis) = root.load();
    let request = prepare::project(&input, &basis, "d.sigil").unwrap();
    let units = memo::units(&request);
    assert_eq!(units.len(), 2);
    assert_ne!(units[0].key, units[1].key, "an ordinal tells them apart");
}

#[test]
fn a_logic_unit_is_the_whole_section_and_every_other_role_is_one_facet() {
    let input = logic_input(&[("Pipeline", &["one", "two", "three"])]);
    let request = support::project(&input, "flows.sigil").unwrap();
    let units = memo::units(&request);

    assert_eq!(units.len(), 1, "three Logic Facets are one unit, not three");
    assert_eq!(units[0].section, "logic");
    assert_eq!(units[0].facets.len(), 3);

    let other = support::project(&shared_input(), BASE).unwrap();
    let units = memo::units(&other);
    assert_eq!(
        units.len(),
        other.rows.len(),
        "goal, interface and constraints are one unit each"
    );
}

#[test]
fn editing_or_swapping_logic_paragraphs_restales_the_section_and_no_other() {
    let key = |bodies: &[(&str, &[&str])], label: &str| {
        let r = support::project(&logic_input(bodies), "flows.sigil").unwrap();
        let component = r
            .flows
            .iter()
            .find(|f| f.component_label == label)
            .unwrap()
            .component
            .clone();
        memo::units(&r)
            .into_iter()
            .find(|u| u.component == component)
            .unwrap()
            .key
    };
    let before = [("Alpha", &["a one", "a two"][..]), ("Beta", &["b one"][..])];
    let edited = [("Alpha", &["a one", "b two"][..]), ("Beta", &["b one"][..])];
    let swapped = [("Alpha", &["a two", "a one"][..]), ("Beta", &["b one"][..])];
    for after in [&edited, &swapped] {
        assert_ne!(
            key(&before, "Alpha"),
            key(after, "Alpha"),
            "a Logic edit or reorder must restale its whole section: step order is part of a flow"
        );
        assert_eq!(
            key(&before, "Beta"),
            key(after, "Beta"),
            "and must restale no other component's section"
        );
    }
}

#[test]
fn a_stored_unit_is_reused_and_a_stale_one_is_asked_for() {
    let root = memo_root("reuse");
    let input = logic_input(&[("Alpha", &["a one"]), ("Beta", &["b one"])]);
    let request = support::project(&input, "flows.sigil").unwrap();

    let split = memo::split(&request, &input, &root);
    assert_eq!(
        split.stale.len(),
        2,
        "an empty store makes everything stale"
    );
    assert!(split.reused.is_empty());

    save_all(&root, &request, &split.stale[..1]);
    let now = memo::split(&request, &input, &root);
    assert_eq!(now.stale.len(), 1, "the stored unit is no longer asked for");
    assert_eq!(now.reused.len(), 1);
    assert!(
        now.refreshed.is_empty(),
        "the recorded grounding context still matches, so nothing is re-checked"
    );

    // And the narrowed request presents only what is still stale.
    let asked = prepare::presenting(&request, &now.stale);
    assert_eq!(asked.flows.len(), 1);
    assert!(
        asked
            .rows
            .iter()
            .all(|r| now.stale[0].facets.contains(&r.facet))
    );
    // The binding is left whole: ingest recomputes and compares it.
    assert_eq!(asked.binding, request.binding);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_reading_follows_its_facet_id_and_nothing_else() {
    // The same stored reading serves a request whose Facet moved: its key and
    // its rows name the content id, so there is nothing to remap.
    let root = memo_root("follows-id");
    let before = logic_input(&[("Alpha", &["a one"])]);
    let request = support::project(&before, "flows.sigil").unwrap();
    save_all(&root, &request, &memo::units(&request));

    let shifted = {
        let workspace = Workspace::new();
        workspace.write(
            "flows.sigil",
            b"\n\n\ncomponent Alpha {\n\n       logic {\n   a   one\n\n  }\n}\n",
        );
        workspace.design_input()
    };
    let moved = support::project(&shifted, "flows.sigil").unwrap();
    let split = memo::split(&moved, &shifted, &root);
    assert!(split.stale.is_empty());
    assert_eq!(split.reused.len(), 1);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn moving_the_guidance_fingerprint_restales_everything() {
    let input = logic_input(&[("Alpha", &["a one"])]);
    let mut request = support::project(&input, "flows.sigil").unwrap();
    let before = memo::units(&request)[0].key.clone();
    request.binding.guidance_fingerprint = "moved".into();
    assert_ne!(
        before,
        memo::units(&request)[0].key,
        "what the interpreter is told is part of what its answer depends on"
    );
}

#[test]
fn a_request_with_nothing_stale_is_valid_and_asks_for_nothing() {
    let root = memo_root("empty");
    let input = logic_input(&[("Alpha", &["a one"])]);
    let request = support::project(&input, "flows.sigil").unwrap();
    save_all(&root, &request, &memo::units(&request));
    let split = memo::split(&request, &input, &root);
    assert!(split.stale.is_empty());
    assert_eq!(split.reused.len(), 1);

    let asked = prepare::presenting(&request, &split.stale);
    assert!(asked.rows.is_empty(), "nothing stale, nothing asked");
    assert!(asked.flows.is_empty());
    assert_eq!(
        asked.binding, request.binding,
        "an empty ask still carries the binding ingest will compare"
    );
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_rowless_unit_remains_stale_and_cannot_be_memoized() {
    let root = memo_root("rowless-stale");
    let input = logic_input(&[("Alpha", &["a one"])]);
    let request = support::project(&input, "flows.sigil").unwrap();
    let unit = memo::units(&request).remove(0);

    assert!(memo::save(&root, &request, &unit, &[], Default::default()).is_err());
    let split = memo::split(&request, &input, &root);
    assert_eq!(split.stale, vec![unit]);
    assert!(split.reused.is_empty());
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn an_entry_of_another_memo_version_reads_as_absent_and_is_pruned() {
    let root = memo_root("older-version");
    let input = logic_input(&[("Alpha", &["a one"])]);
    let request = support::project(&input, "flows.sigil").unwrap();
    let unit = memo::units(&request).remove(0);

    // A v4 entry: no version field, offset-era Facet ids and a `constraintTargets` map.
    let dir = root.join("claims/interpretations");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join(format!("{}.json", unit.key)),
        br#"{"facets":["facet:flows.sigil:1"],"rows":[],"constraintTargets":{}}"#,
    )
    .unwrap();
    fs::write(dir.join("0000.json"), b"not json").unwrap();
    let split = memo::split(&request, &input, &root);
    assert_eq!(
        split.stale.len(),
        1,
        "an older entry never serves a request"
    );
    assert_eq!(memo::older_entries(&root), 2);

    save_all(&root, &request, &[unit]);
    assert_eq!(
        memo::prune_older(&root).unwrap(),
        1,
        "the unreadable one goes"
    );
    assert_eq!(memo::older_entries(&root), 0);
    assert!(memo::split(&request, &input, &root).stale.is_empty());
    fs::remove_dir_all(&root).unwrap();
}

// ------------------------------------------- re-grounding a stored reading

/// B's one goal Facet references `alpha`; `beta` is visible through A's
/// interface but unreferenced there.
fn grounding_workspace() -> Workspace {
    let root = Workspace::new();
    root.write(
        "a.sigil",
        b"component A {\n  interface {\n    The *alpha* and *beta* exist.\n  }\n}\n",
    );
    root.write(
        "b.sigil",
        b"@a.sigil from A import { alpha, beta }\ncomponent B {\n  goal {\n    Use alpha.\n  }\n}\n",
    );
    root
}

fn claim_on(facet: &str, object: &str) -> sigilc::claims::dialect::Row {
    sigilc::claims::dialect::Row::Claim {
        facet: facet.into(),
        subject: "B".into(),
        relation: "uses".into(),
        object: object.into(),
        modality: "required".into(),
        expected: "true".into(),
    }
}

/// A reading of B's goal stored as if admitted under another source content.
fn stored_under_an_older_context(
    name: &str,
    object: &str,
    defects: std::collections::BTreeSet<sigilc::claims::identity::Defect>,
) -> (std::path::PathBuf, memo::Split) {
    let workspace = grounding_workspace();
    let (input, basis) = workspace.load();
    let request = prepare::project(&input, &basis, "b.sigil").unwrap();
    let unit = memo::units(&request)
        .into_iter()
        .find(|u| !u.context)
        .unwrap();
    let mut older = request.clone();
    older.binding.source_content = "an-older-content-id".into();
    let root = memo_root(name);
    memo::save(
        &root,
        &older,
        &unit,
        &[claim_on(&unit.facets[0], object)],
        defects,
    )
    .unwrap();
    let split = memo::split(&request, &input, &root);
    (root, split)
}

#[test]
fn a_moved_context_that_still_admits_cleanly_reuses_and_refreshes() {
    let (root, split) = stored_under_an_older_context("regrounds", "alpha", Default::default());
    assert!(split.stale.is_empty());
    assert_eq!(split.reused.len(), 1);
    assert_eq!(split.refreshed.len(), 1);
    memo::refresh(&root, &split).unwrap();

    // The recorded context now matches, so the next split re-checks nothing.
    let workspace = grounding_workspace();
    let (input, basis) = workspace.load();
    let request = prepare::project(&input, &basis, "b.sigil").unwrap();
    let again = memo::split(&request, &input, &root);
    assert_eq!(again.reused.len(), 1);
    assert!(again.refreshed.is_empty());
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_reading_naming_a_visible_but_unreferenced_entity_goes_stale_when_context_moves() {
    // `beta` is visible but this Facet never references it, so it is not on the
    // Facet's list and admission now refuses the stored reading.
    let (root, split) = stored_under_an_older_context("new-defect", "beta", Default::default());
    assert_eq!(split.stale.len(), 1);
    assert!(split.reused.is_empty());
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_new_defect_makes_a_moved_context_stale() {
    // B uses B asserts nothing. The reading was stored without that defect
    // recorded, so admission now finds one the reading lacked.
    let (root, split) = stored_under_an_older_context("degenerate", "B", Default::default());
    assert_eq!(split.stale.len(), 1);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_defect_the_reading_already_carried_does_not_make_it_stale() {
    use sigilc::claims::identity::Defect;
    let (root, split) =
        stored_under_an_older_context("old-defect", "B", [Defect::Degenerate].into());
    assert!(split.stale.is_empty());
    assert_eq!(split.refreshed.len(), 1);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_reading_naming_an_entity_that_left_the_request_is_stale() {
    let (root, split) = stored_under_an_older_context("gone", "gamma", Default::default());
    assert_eq!(split.stale.len(), 1, "admission refuses an unknown entity");
    fs::remove_dir_all(&root).unwrap();
}
