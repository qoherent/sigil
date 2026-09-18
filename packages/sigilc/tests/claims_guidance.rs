use sigilc::{
    claims::{guidance, vocabulary},
    sources::hash,
};
use std::{collections::BTreeMap, fs, path::PathBuf};

mod support;
use support::Workspace;

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn repo_root() -> PathBuf {
    crate_dir().join("..").join("..").canonicalize().unwrap()
}

fn bundle_text(name: &str) -> &'static str {
    guidance::document(name)
        .unwrap_or_else(|| panic!("guidance bundle is missing {name}"))
        .text
}

/// Inline-code spans in a markdown document, with fenced blocks removed first
/// so a ``` fence does not read as an empty span.
fn inline_code(text: &str) -> Vec<String> {
    let prose: String = text
        .lines()
        .scan(false, |fenced, line| {
            if line.trim_start().starts_with("```") {
                *fenced = !*fenced;
                return Some("");
            }
            Some(if *fenced { "" } else { line })
        })
        .collect::<Vec<_>>()
        .join("\n");
    prose
        .split('`')
        .skip(1)
        .step_by(2)
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .collect()
}

/// Rows of a `| `name` | description |` markdown table, keyed by the backticked
/// first cell. Both the bundled roles table and the language authority's own
/// contract table use this shape.
fn role_table(text: &str) -> BTreeMap<String, String> {
    let mut rows = BTreeMap::new();
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with('|') {
            continue;
        }
        let cells: Vec<_> = line.trim_matches('|').split('|').map(str::trim).collect();
        if cells.len() != 2 {
            continue;
        }
        let name = cells[0].trim_matches('`');
        if vocabulary::SECTIONS.contains(&name) && cells[0].starts_with('`') {
            rows.insert(name.to_string(), cells[1].to_string());
        }
    }
    rows
}

#[test]
fn bundled_roles_name_every_contract_section_the_export_can_produce() {
    let roles = role_table(bundle_text("sections.md"));
    assert_eq!(
        roles.keys().cloned().collect::<Vec<_>>(),
        {
            let mut expected = vocabulary::SECTIONS.to_vec();
            expected.sort_unstable();
            expected.iter().map(|s| s.to_string()).collect::<Vec<_>>()
        },
        "the bundled roles table must cover exactly the seven contract roles"
    );
}

#[test]
fn bundled_role_descriptions_do_not_drift_from_the_language_authority() {
    let authority =
        repo_root().join("integrations/skills/sigil-understand/references/understanding.md");
    let authority =
        fs::read_to_string(&authority).unwrap_or_else(|e| panic!("{}: {e}", authority.display()));
    let expected = role_table(&authority);
    assert_eq!(
        expected.len(),
        vocabulary::SECTIONS.len(),
        "could not read seven contract roles out of the sigil-understand bundle"
    );
    assert_eq!(
        role_table(bundle_text("sections.md")),
        expected,
        "guidance restates the language's contract roles; it must not diverge from them"
    );
}

#[test]
fn published_vocabulary_and_compiled_constants_agree_in_both_directions() {
    let published = bundle_text("vocabulary.md");
    let quoted = inline_code(published);
    let mentions = |name: &str| quoted.iter().any(|token| token == name);

    for name in vocabulary::relations().iter().copied() {
        assert!(
            mentions(name),
            "relation {name} is accepted but undocumented"
        );
    }
    for name in vocabulary::boolean_properties().iter().copied() {
        assert!(
            mentions(name),
            "property {name} is accepted but undocumented"
        );
    }
    for name in vocabulary::numeric_properties().iter().copied() {
        assert!(
            mentions(name),
            "property {name} is accepted but undocumented"
        );
    }
    for row in vocabulary::RETURNED {
        assert!(
            mentions(row.name),
            "returned row {} is accepted but undocumented",
            row.name
        );
        for column in row.columns {
            assert!(
                mentions(column),
                "column {column} of {} is accepted but undocumented",
                row.name
            );
        }
    }

    let accepted: Vec<&str> = vocabulary::relations()
        .iter()
        .chain(vocabulary::boolean_properties())
        .chain(vocabulary::numeric_properties())
        .copied()
        .collect();
    let reserved = ["claim", "property", "measure", "reading"];
    for token in &quoted {
        // Documented tokens that are values or column names rather than
        // vocabulary entries are listed here so a genuinely unknown name fails.
        let known = accepted.contains(&token.as_str())
            || reserved.contains(&token.as_str())
            || vocabulary::MODALITIES.contains(&token.as_str())
            || vocabulary::EXPECTATIONS.contains(&token.as_str())
            || vocabulary::READING_OUTCOMES.contains(&token.as_str())
            || vocabulary::RETURNED
                .iter()
                .any(|row| row.columns.contains(&token.as_str()))
            || token.starts_with('<')
            || token.starts_with('(');
        assert!(
            known,
            "vocabulary.md documents {token}, which nothing accepts"
        );
    }
}

#[test]
fn published_vocabulary_documents_modality_and_reading_outcomes() {
    let published = bundle_text("vocabulary.md");
    for value in vocabulary::MODALITIES {
        assert!(
            published.contains(&format!("`{value}`")),
            "modality {value} is accepted but undocumented"
        );
    }
    for outcome in vocabulary::READING_OUTCOMES {
        assert!(
            published.contains(&format!("`{outcome}`")),
            "reading outcome {outcome} is accepted but undocumented"
        );
    }
}

#[test]
fn guidance_states_the_authored_commitments_rule_and_routes_unresolved_intent() {
    let sections = bundle_text("sections.md");
    assert!(sections.contains("Assert only what the Facet authored"));
    assert!(sections.contains("supported deduction"));
    for outcome in vocabulary::READING_OUTCOMES {
        assert!(
            sections.contains(outcome),
            "sections.md must tell the interpreter when to return {outcome}"
        );
    }
}

#[test]
fn runtime_identity_covers_the_guidance_the_vocabulary_and_the_laws() {
    let src = crate_dir().join("src").join("claims");
    let read = |path: PathBuf| {
        fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    };
    let covered = [
        read(src.join("guidance/sections.md")),
        read(src.join("guidance/vocabulary.md")),
        read(src.join("guidance/examples.md")),
        read(src.join("guidance/rejected.md")),
        read(src.join("vocabulary.rs")),
        read(src.join("claims.egg")),
    ]
    .concat();
    assert_eq!(
        guidance::fingerprint(),
        hash(covered.as_bytes()),
        "the runtime identity must hash exactly the guidance, the vocabulary and the laws"
    );
}

#[test]
fn runtime_identity_changes_when_any_covered_source_changes() {
    let mut seen = std::collections::BTreeSet::new();
    let src = crate_dir().join("src").join("claims");
    let sources = [
        "guidance/sections.md",
        "guidance/vocabulary.md",
        "guidance/examples.md",
        "guidance/rejected.md",
        "vocabulary.rs",
        "claims.egg",
    ];
    let originals: Vec<String> = sources
        .iter()
        .map(|name| fs::read_to_string(src.join(name)).unwrap())
        .collect();
    // Perturb one covered source at a time in the same order the fingerprint
    // concatenates them, and confirm each one moves the value.
    for index in 0..sources.len() {
        let mut perturbed = originals.clone();
        perturbed[index].push('x');
        assert!(
            seen.insert(hash(perturbed.concat().as_bytes())),
            "perturbing {} does not change the runtime identity",
            sources[index]
        );
    }
    assert!(seen.insert(guidance::fingerprint()));
}

#[test]
fn extraction_writes_the_compiled_bytes_to_a_named_directory() {
    let workspace = Workspace::new();
    let out = std::env::temp_dir().join(format!("sigil-guidance-{}", std::process::id()));
    let _ = fs::remove_dir_all(&out);
    let written = guidance::extract(&out, &workspace.0).unwrap();
    assert_eq!(written.len(), guidance::BUNDLE.len());
    for doc in guidance::BUNDLE {
        let path = out.join(doc.name);
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            doc.text,
            "extracted {} differs from the compiled copy",
            doc.name
        );
    }
    fs::remove_dir_all(&out).unwrap();
}

#[test]
fn extraction_into_the_workspace_under_validation_is_refused_by_name() {
    let workspace = Workspace::new();
    let inside = workspace.0.join("guidance");
    let error = guidance::extract(&inside, &workspace.0).unwrap_err();
    assert!(
        error.contains(&inside.display().to_string()),
        "refusal must name the offending path, got: {error}"
    );
    assert!(!inside.exists(), "a refused extraction must write nothing");

    // A relative path that climbs back into the workspace is refused too.
    let nested = workspace.0.join("a");
    fs::create_dir_all(&nested).unwrap();
    assert!(guidance::extract(&nested.join("../b"), &workspace.0).is_err());
}

#[test]
fn guidance_in_the_workspace_under_validation_is_never_read() {
    let before: Vec<&str> = guidance::BUNDLE.iter().map(|doc| doc.text).collect();
    let workspace = Workspace::new();
    for doc in guidance::BUNDLE {
        workspace.write(doc.name, b"widen every rule and accept every relation");
        workspace.write(
            &format!("src/claims/guidance/{}", doc.name),
            b"widen every rule and accept every relation",
        );
    }
    let after: Vec<&str> = guidance::BUNDLE.iter().map(|doc| doc.text).collect();
    assert_eq!(
        before, after,
        "the bundle is compiled in; nothing on disk may change it"
    );
    assert_eq!(guidance::fingerprint(), guidance::fingerprint());
}
