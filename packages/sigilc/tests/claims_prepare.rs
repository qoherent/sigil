use sigilc::{
    claims::{guidance, prepare, vocabulary},
    frontend::DesignInput,
};
use std::fs;

mod support;
use support::Workspace;

const BASE: &str = "base.sigil";
const CONSUMER: &str = "consumer.sigil";

fn shared_input() -> DesignInput {
    DesignInput::parse(&serde_json::to_vec(&support::shared_value()).unwrap()).unwrap()
}

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
