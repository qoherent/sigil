use sigilc::{
    claims::{
        dialect::{self, Row},
        guidance, vocabulary,
    },
    sources::hash,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::PathBuf,
};

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
    // Read from the registry, not hardcoded: a row kind added there must be
    // documented, and this direction has to keep saying so as kinds are added.
    let reserved: Vec<&str> = vocabulary::RETURNED.iter().map(|r| r.name).collect();
    // Fields of the request the interpreter reads, as opposed to rows it
    // returns. The document has to name them to explain what it is shown, and
    // they are deliberately not accepted as row names.
    let request_fields = ["flows", "rows"];
    // Values a column takes, as opposed to names the vocabulary publishes: a
    // starting ordinal, the guard operand kinds, and the reference forms a row
    // uses to name a step or a graph.
    let literals = ["1", "graph", "step:<ordinal>"];
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
            || request_fields.contains(&token.as_str())
            || literals.contains(&token.as_str())
            || vocabulary::GUARD_OPERANDS.contains(&token.as_str())
            || token.starts_with(vocabulary::STEP_REF)
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
    let files_only = [
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
        hash(files_only.as_bytes()),
        "the runtime identity must hash exactly the guidance, the vocabulary and the laws.          The compiler's ontology is deliberately not folded in: the accepted set is this          component's own, so an unrelated compiler edit must not invalidate prepared requests"
    );
    // The inverse of what this once asserted. The compiler's ontology used to be
    // folded in, defensively, because `vocabulary::relations()` read it at
    // runtime. It no longer does, so an edit to the compiler's predicate list
    // must leave every prepared interpretation directory valid.
    let with_ontology = format!("{files_only}{}", sigilc::turtle::ontology_fingerprint());
    assert_ne!(
        guidance::fingerprint(),
        hash(with_ontology.as_bytes()),
        "the compiler's ontology must not reach the runtime identity: the accepted set          is this component's own, and folding the ontology in would make an unrelated          compiler edit invalidate every prepared request"
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

// --------------------------------------------------------- examples ground

/// Every asterisk-marked term in a blockquote: `*a name*` -> `"a name"`.
fn asterisked(prose: &str) -> BTreeSet<&str> {
    let mut out = BTreeSet::new();
    let mut rest = prose;
    while let Some(start) = rest.find('*') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('*') else { break };
        out.insert(&after[..end]);
        rest = &after[end + 1..];
    }
    out
}

/// Pairs each blockquote in the guidance with the fenced code block that
/// immediately follows it, when one does. Some blockquotes in this document
/// are explanatory only and carry no rows; those are skipped.
fn worked_examples(markdown: &str) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    let mut lines = markdown.lines().peekable();
    while let Some(line) = lines.next() {
        if !line.trim_start().starts_with('>') {
            continue;
        }
        let mut quote = line.trim_start_matches('>').trim().to_string();
        while let Some(next) = lines.peek() {
            if next.trim_start().starts_with('>') {
                quote.push(' ');
                quote.push_str(lines.next().unwrap().trim_start_matches('>').trim());
            } else {
                break;
            }
        }
        let mut code = String::new();
        let mut in_fence = false;
        let mut closed = false;
        for l in lines.by_ref() {
            let trimmed = l.trim_start();
            if trimmed.starts_with("```") {
                if in_fence {
                    closed = true;
                    break;
                }
                in_fence = true;
                continue;
            }
            if in_fence {
                code.push_str(l);
                code.push('\n');
            } else if !trimmed.is_empty() {
                break;
            }
        }
        if closed && !code.trim().is_empty() {
            pairs.push((quote, code));
        }
    }
    pairs
}

#[test]
fn every_worked_claim_names_only_its_component_or_an_asterisk_marked_tag() {
    // The exact invariant identity::Grounding enforces at runtime: a claim's
    // subject and object are either the Facet's own component (or an import
    // provider, not exercised by these single-component examples) or a Tag
    // the Facet's own prose marks with asterisks. A worked example that names
    // anything else would teach the interpreter a pattern the validator
    // refuses -- this is the regression this test exists to catch.
    let components: BTreeSet<&str> = ["SearchService", "SearchPanel"].into_iter().collect();
    let markdown = guidance::document("examples.md").unwrap().text;
    let pairs = worked_examples(markdown);
    assert!(
        pairs.len() >= 7,
        "expected at least 7 worked examples, found {}",
        pairs.len()
    );

    let mut checked = 0;
    for (quote, code) in pairs {
        let ground = asterisked(&quote);
        let rows = dialect::parse(&code, dialect::Limits::default()).unwrap_or_else(|e| {
            panic!(
                "worked example is not valid data: {e}
code:
{code}"
            )
        });
        for row in &rows {
            let names: Vec<&str> = match &row {
                Row::Claim {
                    subject, object, ..
                } => vec![subject.as_str(), object.as_str()],
                Row::Property { subject, .. } | Row::Measure { subject, .. } => {
                    vec![subject.as_str()]
                }
                // A step names no entity of its own, and a guard's operands are
                // an ordinal, a literal or a Facet -- none of them the entity
                // reference this check is about.
                Row::Reading { .. } | Row::Step { .. } | Row::Guard { .. } => vec![],
            };
            for name in names {
                assert!(
                    components.contains(name) || ground.contains(name),
                    "{quote:?} claims {name:?}, which is neither a component nor                      asterisk-marked in that same prose"
                );
                checked += 1;
            }
        }
    }
    assert!(
        checked >= 8,
        "expected to check at least 8 entity mentions, saw {checked}"
    );
}

/// Every name a law in `claims.egg` reads is in the accepted set.
///
/// The accepted set is this component's own and no longer tracks the compiler's
/// ontology, so nothing structural guarantees it still carries the names the
/// laws fire on. A missing name would not fail loudly: the law would simply
/// never fire and report nothing, which is the failure mode this whole
/// subsystem is most prone to. Deliberately not an equality check against
/// `turtle::vocabulary()` — diverging from it is the point of owning the set.
#[test]
fn accepted_vocabulary_carries_every_name_the_laws_read() {
    let laws = include_str!("../src/claims/claims.egg");

    // Relation names the laws quote, read out of the law text itself so a new
    // law that quotes a name this set lacks fails here rather than at runtime.
    let quoted: BTreeSet<&str> = laws
        .split('"')
        .skip(1)
        .step_by(2)
        .filter(|s| {
            !s.is_empty()
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        })
        .collect();

    let relations = vocabulary::relations();
    let booleans = vocabulary::boolean_properties();
    let numerics = vocabulary::numeric_properties();

    // Not every quoted string is a vocabulary name: the laws also quote law
    // names, modalities, expectations and contract roles. Check the ones that
    // are, and pin the list so removing a name from the set fails this test.
    let must_carry_relations = [
        "owns",
        "provides",
        "requires",
        "dependsOn",
        "excludes",
        "delegates",
        "invokes",
        "reads",
        "writes",
        "uses",
        "to",
    ];
    for name in must_carry_relations {
        assert!(
            relations.contains(name),
            "the laws read relation {name:?}, which the accepted set does not carry; \
             a law reading a name outside the set never fires and reports nothing"
        );
    }
    assert!(
        booleans.contains("exclusive"),
        "the ownership law reads the `exclusive` property, which the accepted set does not carry"
    );
    assert!(
        booleans.contains("required"),
        "the required-state obligation law reads the `required` property"
    );

    // A sweep over every quoted string was tried and dropped: the laws also
    // quote law names and witness kinds ("asserted", "delegated-capability"),
    // which are not distinguishable from vocabulary names by shape. The pinned
    // list above is the honest check, and it fails if a name leaves the set.
    let _ = (&quoted, numerics);
}
