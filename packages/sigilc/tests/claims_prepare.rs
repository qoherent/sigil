use sigilc::claims::{guidance, prepare, vocabulary};
use std::fs;

mod support;
use support::{BASE, CONSUMER, Workspace, shared_input};

fn out_dir(name: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "sigil-claims-prepare-{}-{name}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&path);
    path
}

#[test]
fn every_valid_facet_of_the_selected_source_gets_exactly_one_row() {
    let input = shared_input();
    let request = prepare::project(&input, BASE).unwrap();
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
    let request = prepare::project(&input, BASE).unwrap();
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
    let request = prepare::project(&shared_input(), BASE).unwrap();
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
    let request = prepare::project(&input, BASE).unwrap();
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
fn an_imported_tags_owning_source_enters_the_recorded_closure() {
    let request = prepare::project(&shared_input(), CONSUMER).unwrap();
    assert!(
        request.binding.closure.contains(&BASE.to_string()),
        "consumer imports from base, so base is in the closure: {:?}",
        request.binding.closure
    );
    assert!(request.binding.closure.contains(&CONSUMER.to_string()));

    let ids: Vec<&str> = request.entities.iter().map(|e| e.id.as_str()).collect();
    assert!(
        ids.iter().any(|id| id.contains("base.sigil")),
        "entities admissible to a claim include the imported owner's: {ids:?}"
    );
}

#[test]
fn preparing_an_unexported_source_is_refused_by_name() {
    let error = prepare::project(&shared_input(), "absent.sigil").unwrap_err();
    assert!(error.contains("absent.sigil"), "got: {error}");
}

#[test]
fn preparing_the_same_export_twice_writes_identical_bytes() {
    let input = shared_input();
    let first = out_dir("twice-a");
    let second = out_dir("twice-b");
    prepare::write(&prepare::project(&input, BASE).unwrap(), &first).unwrap();
    prepare::write(&prepare::project(&input, BASE).unwrap(), &second).unwrap();
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
fn the_binding_pins_the_export_the_guidance_and_the_vocabulary() {
    let input = shared_input();
    let request = prepare::project(&input, BASE).unwrap();
    assert_eq!(request.binding.source, BASE);
    assert_eq!(
        request.binding.export_digest,
        prepare::export_digest(&input)
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

    // A different export digest is a different binding.
    let mut other = request.binding.clone();
    other.export_digest.push('x');
    assert_ne!(request.binding.digest(), other.digest());
}

#[test]
fn the_prepared_directory_carries_the_guidance_the_interpreter_needs() {
    let out = out_dir("guidance");
    let written = prepare::write(&prepare::project(&shared_input(), BASE).unwrap(), &out).unwrap();
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
    let request = prepare::project(&shared_input(), BASE).unwrap();
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
    let without = prepare::project(&input, BASE).unwrap();
    let workspace = Workspace::new();
    workspace.write(BASE, b"component Tampered { goal { Different. } }");
    let with = prepare::project(&input, BASE).unwrap();
    assert_eq!(without, with);
}

// ------------------------------------------------- grouping a Logic section

/// Build an export whose components carry Logic Facets in a known order.
///
/// The shared 0.8 fixture has no Logic section, and the grouping is entirely
/// about Logic, so these tests need a source of their own. Facet identities are
/// derived from byte offsets the same way the real frontend derives them, so
/// source order and identity order genuinely disagree where the offsets cross a
/// power of ten — which is the ordering bug this grouping has to avoid.
fn logic_input(bodies: &[(&str, &[&str])]) -> sigilc::frontend::DesignInput {
    use serde_json::json;
    let path = "flows.sigil";
    let mut text = String::new();
    let mut units = Vec::new();
    let mut entities = Vec::new();
    for (name, proses) in bodies {
        let start = text.len();
        text.push_str(&format!("component {name} {{\n  logic {{\n"));
        let mut spans = Vec::new();
        for prose in *proses {
            // Pad so one section's Facets straddle offset 1000: sorting the
            // identities as text would then put "1000" before "999".
            text.push_str(&"    // pad\n".repeat(40));
            let at = text.len();
            text.push_str(&format!("    {prose}\n"));
            spans.push((at, at + prose.len() + 4));
        }
        text.push_str("  }\n}\n");
        let end = text.len();
        let id = format!("urn:sigil:component:{path}:{name}");
        entities.push(json!({
            "id": id, "type": "Component", "label": name, "source": path, "owner": null,
            "range": {"start": start, "end": end},
            "nameRange": {"start": start + 10, "end": start + 10 + name.len()},
            "identityResolved": true, "valid": true, "complete": true
        }));
        for (s, e) in spans {
            units.push(json!({
                "id": format!("facet:{path}:{s}"), "source": path, "owner": id,
                "section": "logic", "range": {"start": s, "end": e},
                "proseRange": {"start": s, "end": e},
                "grouping": null, "introductions": [], "references": [], "links": [],
                "payload": null, "valid": true, "complete": true
            }));
        }
    }
    // The frontend hands units in whatever order it walked them; shuffle so the
    // grouping cannot pass by accident.
    units.reverse();
    sigilc::frontend::DesignInput::parse(
        &serde_json::to_vec(&json!({
            "schemaVersion": 2, "languageVersion": "0.8.0", "frontendVersion": "test",
            "sources": [{"path": path, "text": text}],
            "context": [
                {"path": ".sigil/config.json", "text": "{\"sigilVersion\":\"0.8.0\"}"},
                {"path": ".sigil/local.json", "text": null},
                {"path": ".sigil/glossary.json", "text": null}
            ],
            "diagnostics": [], "entities": entities, "units": units,
            "imports": [], "groups": [], "introductions": [], "references": [], "links": []
        }))
        .unwrap(),
    )
    .unwrap()
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
    let request = prepare::project(&input, "flows.sigil").unwrap();

    assert_eq!(request.flows.len(), 1, "one component, one Logic section");
    let flow = &request.flows[0];
    assert_eq!(flow.component_label, "Pipeline");
    assert_eq!(flow.facets.len(), 5, "all five Facets, none dropped");

    // Source order, which is offset order -- not identity order.
    let offsets: Vec<usize> = flow
        .facets
        .iter()
        .map(|f| f.rsplit(':').next().unwrap().parse().unwrap())
        .collect();
    let mut sorted = offsets.clone();
    sorted.sort_unstable();
    assert_eq!(offsets, sorted, "grouped Facets run in source order");

    // The ordering actually crosses a power of ten here, so a text sort of the
    // identities would disagree. Pin that, or this test proves nothing.
    let mut as_text: Vec<&String> = flow.facets.iter().collect();
    as_text.sort();
    let in_order: Vec<&String> = flow.facets.iter().collect();
    assert_ne!(
        as_text, in_order,
        "fixture must straddle a power of ten, or it cannot catch a text sort"
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
    let request = prepare::project(&input, "flows.sigil").unwrap();

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
    let request = prepare::project(&input, "flows.sigil").unwrap();
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
    let request = prepare::project(&input, BASE).unwrap();
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
    let request = prepare::project(&input, CONSUMER).unwrap();
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

// --------------------------------------------- projecting the whole closure

#[test]
fn the_request_presents_every_facet_in_the_closure() {
    let input = shared_input();
    let request = prepare::project(&input, CONSUMER).unwrap();

    let sources: std::collections::BTreeSet<&str> =
        request.rows.iter().map(|r| r.source.as_str()).collect();
    assert!(
        sources.contains(BASE),
        "a dependency's Facets must be presented too, or a claim in one component \
         has no flow graph in a component it depends on to reach; got {sources:?}"
    );
    assert!(sources.contains(CONSUMER));
    assert_eq!(
        request.binding.facets.len(),
        request.rows.len(),
        "the binding bounds exactly what was presented, closure included"
    );
}

#[test]
fn coverage_stays_scoped_to_the_selected_source() {
    let input = shared_input();
    let request = prepare::project(&input, CONSUMER).unwrap();

    // Facets from the dependency are presented...
    assert!(request.rows.iter().any(|r| r.source == BASE));
    // ...but they are context, never coverage. A dependency Facet the
    // interpretation ignores must not become a gap in this source's report.
    for (component, _) in &request.declared {
        let from_selected = request
            .rows
            .iter()
            .any(|r| &r.component == component && r.source == CONSUMER);
        assert!(
            from_selected,
            "{component} is counted as coverage but authored nothing in {CONSUMER}"
        );
    }
}

#[test]
fn a_dependencys_logic_section_groups_under_its_own_source() {
    let input = logic_input(&[("Alpha", &["a one", "a two"])]);
    let request = prepare::project(&input, "flows.sigil").unwrap();
    assert_eq!(request.flows[0].source, "flows.sigil");
}

#[test]
fn the_request_format_moves_when_presentation_widens() {
    // A directory prepared before the widening carries a narrower Facet set.
    // Pairing it with a widened binding would silently under-report, so the
    // format is the signal that says re-prepare.
    let input = shared_input();
    let request = prepare::project(&input, CONSUMER).unwrap();
    assert_eq!(request.binding.format, prepare::REQUEST_FORMAT);

    // A binding from before the widening must not pair with this request. The
    // Facet set it was prepared against was narrower, so accepting it would
    // silently under-report rather than ask for a fresh directory.
    let mut stale = request.binding.clone();
    stale.format = 2;
    assert_ne!(
        request.binding, stale,
        "an older request format must not compare equal to the current one"
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

#[test]
fn a_logic_unit_is_the_whole_section_and_every_other_role_is_one_facet() {
    let input = logic_input(&[("Pipeline", &["one", "two", "three"])]);
    let request = prepare::project(&input, "flows.sigil").unwrap();
    let units = memo::units(&request);

    assert_eq!(units.len(), 1, "three Logic Facets are one unit, not three");
    assert_eq!(units[0].section, "logic");
    assert_eq!(units[0].facets.len(), 3);

    let other = prepare::project(&shared_input(), BASE).unwrap();
    let units = memo::units(&other);
    assert_eq!(
        units.len(),
        other.rows.len(),
        "goal, interface and constraints are one unit each"
    );
}

#[test]
fn editing_one_logic_paragraph_restales_its_section_and_no_other() {
    let before = prepare::project(
        &logic_input(&[("Alpha", &["a one", "a two"]), ("Beta", &["b one"])]),
        "flows.sigil",
    )
    .unwrap();
    let after = prepare::project(
        &logic_input(&[("Alpha", &["a one", "a two EDITED"]), ("Beta", &["b one"])]),
        "flows.sigil",
    )
    .unwrap();

    let key = |r: &prepare::Request, label: &str| {
        let component = r
            .flows
            .iter()
            .find(|f| f.component_label == label)
            .unwrap()
            .component
            .clone();
        memo::units(r)
            .into_iter()
            .find(|u| u.component == component)
            .unwrap()
            .key
    };
    assert_ne!(
        key(&before, "Alpha"),
        key(&after, "Alpha"),
        "editing a Logic paragraph must restale its whole section: the flow \
         through it may have changed, and a flow spans the section"
    );
    assert_eq!(
        key(&before, "Beta"),
        key(&after, "Beta"),
        "and must restale no other component's section"
    );
}

#[test]
fn two_facets_with_identical_prose_do_not_share_a_stored_interpretation() {
    // Grounding is checked against each Facet's own component and references,
    // so reusing one interpretation for the other could judge a row grounded
    // against a Facet that never named the entity.
    let input = logic_input(&[("Alpha", &["same words"]), ("Beta", &["same words"])]);
    let request = prepare::project(&input, "flows.sigil").unwrap();
    let units = memo::units(&request);
    assert_eq!(units.len(), 2);
    assert_ne!(
        units[0].key, units[1].key,
        "prose alone does not identify a unit; the owning component is part of the key"
    );
}

#[test]
fn a_stored_unit_is_reused_and_a_stale_one_is_asked_for() {
    let root = memo_root("reuse");
    let input = logic_input(&[("Alpha", &["a one"]), ("Beta", &["b one"])]);
    let request = prepare::project(&input, "flows.sigil").unwrap();

    let (stale, reused) = memo::split(&request, &root);
    assert_eq!(stale.len(), 2, "an empty store makes everything stale");
    assert!(reused.is_empty());

    memo::save(&root, &stale[0].key, &[]).unwrap();
    let (stale_now, reused_now) = memo::split(&request, &root);
    assert_eq!(stale_now.len(), 1, "the stored unit is no longer asked for");
    assert_eq!(reused_now.len(), 1);

    // And the narrowed request presents only what is still stale.
    let asked = prepare::presenting(&request, &stale_now);
    assert_eq!(asked.flows.len(), 1);
    assert!(
        asked
            .rows
            .iter()
            .all(|r| stale_now[0].facets.contains(&r.facet))
    );
    // The binding is left whole: ingest recomputes and compares it.
    assert_eq!(asked.binding, request.binding);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn moving_the_guidance_fingerprint_restales_everything() {
    let input = logic_input(&[("Alpha", &["a one"])]);
    let mut request = prepare::project(&input, "flows.sigil").unwrap();
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
    let request = prepare::project(&input, "flows.sigil").unwrap();
    for unit in memo::units(&request) {
        memo::save(&root, &unit.key, &[]).unwrap();
    }
    let (stale, reused) = memo::split(&request, &root);
    assert!(stale.is_empty());
    assert_eq!(reused.len(), 1);

    let asked = prepare::presenting(&request, &stale);
    assert!(asked.rows.is_empty(), "nothing stale, nothing asked");
    assert!(asked.flows.is_empty());
    assert_eq!(
        asked.binding, request.binding,
        "an empty ask still carries the binding ingest will compare"
    );
    fs::remove_dir_all(&root).unwrap();
}
