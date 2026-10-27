//! Workspace conventions: the `check.json` loader and the missing-label rule.
use serde_json::{Value, json};
use sigil_core::language::{
    conventions::{
        CONVENTIONS_CHECK_PATH, advisory_diagnostics, convention_diagnostics, parse_check,
    },
    fs::{MemoryFs, Overlay, SourceFs},
    resolve::ResolvedWorkspace,
    workspace::Workspace,
};
use sigil_core::types::{Diagnostic, Severity, Stage};

const CONFIG: &str =
    r#"{"sigilVersion":"0.9.0","workspace":{"name":"test"},"files":{"include":["**/*.sigil"]}}"#;
const RULE: &str = r#"{"rules":[{"section":"decisions","require":["Decision:","Scope:"]}]}"#;

fn memory(check: Option<&str>, files: &[(&str, &str)]) -> MemoryFs {
    let mut fs = MemoryFs::new();
    fs.insert(".sigil/config.json", CONFIG);
    if let Some(check) = check {
        fs.insert(CONVENTIONS_CHECK_PATH, check);
    }
    for (path, text) in files {
        fs.insert(path, *text);
    }
    fs
}

fn load(check: Option<&str>, files: &[(&str, &str)]) -> Workspace {
    Workspace::load_with(&memory(check, files)).unwrap()
}

/// The convention warnings alone, so ungrouped untagged-Facet noise is out of the way.
fn warn(check: &str, files: &[(&str, &str)]) -> Vec<Diagnostic> {
    let workspace = load(Some(check), files);
    convention_diagnostics(&ResolvedWorkspace::from(&workspace), &workspace)
}

fn design(sections: &str) -> String {
    format!("component Feature {{\n  goal {{\n    Keep a record.\n  }}\n\n{sections}}}\n")
}

fn decisions(body: &str) -> String {
    design(&format!("  decisions {{\n{body}  }}\n"))
}

fn pointed_at<'a>(source: &'a str, d: &Diagnostic) -> &'a str {
    let range = d.range.as_ref().expect("a warning has a range");
    source[range.start..range.end].trim()
}

fn missing(label: &str, group: &str, section: &str) -> String {
    format!("Group `{group}` in `{section}` has no Facet starting with `{label}`.")
}

#[test]
fn a_group_missing_one_label_gets_one_warning_on_its_header() {
    let source = decisions("    Retention {\n      Decision: Keep audit data.\n    }\n");
    let found = warn(RULE, &[("c.sigil", &source)]);
    assert_eq!(found.len(), 1, "{found:?}");
    let d = &found[0];
    assert_eq!(d.code, "SIGIL_CONVENTION_MISSING_LABEL");
    assert_eq!(d.message, missing("Scope:", "Retention", "decisions"));
    assert!(matches!(d.severity, Severity::Warning));
    assert!(matches!(d.stage, Stage::Resolution));
    assert_eq!(d.file_path.as_deref(), Some("c.sigil"));
    assert_eq!(pointed_at(&source, d), "Retention {");
}

#[test]
fn a_group_with_every_label_gets_none() {
    let source = decisions(
        "    Retention {\n      Decision: Keep audit data.\n\n      Scope: Audit exports.\n    }\n",
    );
    assert!(warn(RULE, &[("c.sigil", &source)]).is_empty());
}

#[test]
fn a_group_missing_both_labels_gets_one_warning_per_label() {
    let source = decisions("    Retention {\n      Keep audit data.\n    }\n");
    let messages: Vec<String> = warn(RULE, &[("c.sigil", &source)])
        .into_iter()
        .map(|d| d.message)
        .collect();
    assert_eq!(
        messages,
        [
            missing("Decision:", "Retention", "decisions"),
            missing("Scope:", "Retention", "decisions"),
        ]
    );
}

#[test]
fn a_label_must_start_the_facet() {
    let mid = decisions(
        "    Retention {\n      Decision: Keep audit data.\n\n      We chose this. Scope: Audit exports.\n    }\n",
    );
    assert_eq!(warn(RULE, &[("c.sigil", &mid)]).len(), 1);

    // Leading whitespace is ignored, and only the first line must carry it.
    let wrapped = decisions(
        "    Retention {\n      Decision: Keep audit data.\n\n      Scope:\n      Audit exports and the\n      reports built from them.\n    }\n",
    );
    assert!(warn(RULE, &[("c.sigil", &wrapped)]).is_empty());

    // A label that only leads a later line of a Facet does not count.
    let later = decisions(
        "    Retention {\n      Decision: Keep audit data.\n\n      Audit exports\n      Scope: here.\n    }\n",
    );
    assert_eq!(warn(RULE, &[("c.sigil", &later)]).len(), 1);
}

#[test]
fn a_label_wrapped_across_lines_still_starts_the_facet() {
    let rule = r#"{"rules":[{"section":"decisions","require":["Discarded alternatives:"]}]}"#;
    let wrapped = decisions(
        "    Retention {\n      Discarded\n      alternatives: Immediate deletion.\n    }\n",
    );
    assert!(warn(rule, &[("c.sigil", &wrapped)]).is_empty());

    // Runs of spaces and a line break all count as one space, in the label too.
    let spaced =
        decisions("    Retention {\n      Discarded   alternatives: Immediate deletion.\n    }\n");
    assert!(warn(rule, &[("c.sigil", &spaced)]).is_empty());
    let double = r#"{"rules":[{"section":"decisions","require":["Discarded  alternatives:"]}]}"#;
    assert!(warn(double, &[("c.sigil", &wrapped)]).is_empty());

    // A different word between the two is still a miss.
    let other =
        decisions("    Retention {\n      Discarded\n      options: Immediate deletion.\n    }\n");
    assert_eq!(warn(rule, &[("c.sigil", &other)]).len(), 1);
}

#[test]
fn a_trailing_space_in_a_label_still_guards_the_word() {
    let rule = r#"{"rules":[{"section":"decisions","require":["Must "]}]}"#;
    // `Must ` ends in a word boundary, so it must not match the start of `Mustard`.
    let longer = decisions("    Retention {\n      Mustard is a condiment.\n    }\n");
    assert_eq!(warn(rule, &[("c.sigil", &longer)]).len(), 1);
    let word = decisions("    Retention {\n      Must keep audit data.\n    }\n");
    assert!(warn(rule, &[("c.sigil", &word)]).is_empty());
    // A line break after the word is that same boundary.
    let wrapped = decisions("    Retention {\n      Must\n      keep audit data.\n    }\n");
    assert!(warn(rule, &[("c.sigil", &wrapped)]).is_empty());
}

#[test]
fn two_rules_requiring_the_same_label_warn_once() {
    let rules = r#"{"rules":[
        {"section":"decisions","require":["Scope:"]},
        {"section":"decisions","groups":["Retention"],"require":["Scope:"]}
    ]}"#;
    let source = decisions("    Retention {\n      Decision: Keep audit data.\n    }\n");
    let found = warn(rules, &[("c.sigil", &source)]);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(
        found[0].message,
        missing("Scope:", "Retention", "decisions")
    );
}

#[test]
fn a_label_in_another_group_does_not_satisfy_this_one() {
    let source = decisions(
        "    Retention {\n      Decision: Keep audit data.\n    }\n\n    Access {\n      Decision: Limit readers.\n\n      Scope: Staff only.\n    }\n",
    );
    let found = warn(RULE, &[("c.sigil", &source)]);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(
        found[0].message,
        missing("Scope:", "Retention", "decisions")
    );
}

#[test]
fn an_ungrouped_facet_is_never_matched() {
    let source = decisions("    A plain paragraph with no labels.\n");
    assert!(warn(RULE, &[("c.sigil", &source)]).is_empty());
}

#[test]
fn groups_narrow_a_rule_and_their_absence_means_every_named_group() {
    let source = decisions(
        "    Retention {\n      Keep audit data.\n    }\n\n    Access {\n      Limit readers.\n    }\n",
    );
    let narrowed =
        r#"{"rules":[{"section":"decisions","groups":["Retention"],"require":["Scope:"]}]}"#;
    let found = warn(narrowed, &[("c.sigil", &source)]);
    assert_eq!(found.len(), 1);
    assert_eq!(
        found[0].message,
        missing("Scope:", "Retention", "decisions")
    );

    let every = r#"{"rules":[{"section":"decisions","require":["Scope:"]}]}"#;
    assert_eq!(warn(every, &[("c.sigil", &source)]).len(), 2);
}

#[test]
fn a_rule_checks_only_its_own_section() {
    let source = design(
        "  constraints {\n    Limits {\n      Keep it small.\n    }\n  }\n\n  decisions {\n    Retention {\n      Keep audit data.\n    }\n  }\n",
    );
    let rule = r#"{"rules":[{"section":"constraints","require":["Limit:"]}]}"#;
    let found = warn(rule, &[("c.sigil", &source)]);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].message, missing("Limit:", "Limits", "constraints"));
}

#[test]
fn every_complete_component_in_every_file_is_checked_in_canonical_order() {
    let one = decisions("    Retention {\n      Decision: Keep audit data.\n    }\n");
    let two = decisions("    Access {\n      Decision: Limit readers.\n    }\n");
    let found = warn(RULE, &[("b.sigil", &two), ("a.sigil", &one)]);
    let paths: Vec<_> = found
        .iter()
        .map(|d| d.file_path.as_deref().unwrap())
        .collect();
    assert_eq!(paths, ["a.sigil", "b.sigil"]);
}

#[test]
fn an_incomplete_document_is_skipped() {
    let broken = "component C {\n  goal {\n    Own a responsibility.\n  }\n\n  decisions {\n    Retention {\n      Keep audit data.\n    }\n";
    let workspace = load(Some(RULE), &[("c.sigil", broken)]);
    let resolved = ResolvedWorkspace::from(&workspace);
    assert!(
        !resolved.documents[0].complete,
        "the source must be incomplete"
    );
    assert!(convention_diagnostics(&resolved, &workspace).is_empty());
}

#[test]
fn the_advisory_function_holds_untagged_and_convention_warnings_in_one_order() {
    let source = design(
        "  interface {\n    Offer an interaction.\n  }\n\n  decisions {\n    Retention {\n      Decision: Keep audit data.\n    }\n  }\n",
    );
    let workspace = load(Some(RULE), &[("c.sigil", &source)]);
    let resolved = ResolvedWorkspace::from(&workspace);
    let advisory = advisory_diagnostics(&resolved, &workspace);
    let codes: Vec<&str> = advisory.iter().map(|d| d.code.as_str()).collect();
    assert_eq!(
        codes,
        ["SIGIL_UNTAGGED_FACET", "SIGIL_CONVENTION_MISSING_LABEL"]
    );

    // Without conventions it is the untagged warning alone.
    let plain = load(None, &[("c.sigil", &source)]);
    let resolved = ResolvedWorkspace::from(&plain);
    assert_eq!(advisory_diagnostics(&resolved, &plain).len(), 1);
}

#[test]
fn a_workspace_without_conventions_loads_as_it_always_did() {
    let source = decisions("    Retention {\n      Keep audit data.\n    }\n");
    let workspace = load(None, &[("c.sigil", &source)]);
    assert!(workspace.conventions.is_none());
    assert!(workspace.diagnostics.is_empty());
    assert!(workspace.text_complete);
    let resolved = ResolvedWorkspace::from(&workspace);
    assert!(convention_diagnostics(&resolved, &workspace).is_empty());
    // Conventions never join the claims inputs.
    assert_eq!(workspace.context.len(), 3);
}

#[test]
fn a_loaded_rule_set_keeps_its_rules_and_stays_out_of_context() {
    let workspace = load(Some(RULE), &[]);
    let conventions = workspace.conventions.expect("rules load");
    assert_eq!(conventions.rules.len(), 1);
    assert_eq!(conventions.rules[0].section, "decisions");
    assert_eq!(conventions.rules[0].groups, None);
    assert_eq!(conventions.rules[0].require, ["Decision:", "Scope:"]);
    assert!(workspace.diagnostics.is_empty());
}

/// A file source that fails the test when the loader opens a part core must not read.
struct Spy<'a> {
    base: &'a MemoryFs,
}

impl SourceFs for Spy<'_> {
    fn read(&self, path: &str) -> std::io::Result<Option<Vec<u8>>> {
        assert!(
            !path.ends_with("write.md") && !path.ends_with("judge.md"),
            "core must not open {path}"
        );
        self.base.read(path)
    }

    fn list_files(&self) -> std::io::Result<Vec<String>> {
        self.base.list_files()
    }
}

#[test]
fn write_and_judge_parts_are_never_read() {
    let source = decisions("    Retention {\n      Keep audit data.\n    }\n");
    for (write, judge) in [
        (&b"# Write\nplain markdown"[..], &b"# Judge"[..]),
        (&[0xff, 0xfe, 0x00][..], &[0xc3, 0x28][..]),
        (&br#"{"rules":[{"nope":1}]}"#[..], &b"{ not json"[..]),
    ] {
        let mut fs = memory(None, &[("c.sigil", &source)]);
        fs.insert(".sigil/conventions/write.md", write);
        fs.insert(".sigil/conventions/judge.md", judge);
        let workspace = Workspace::load_with(&Spy { base: &fs }).unwrap();
        assert!(workspace.conventions.is_none());
        assert!(workspace.diagnostics.is_empty());
        assert!(workspace.text_complete);
        let resolved = ResolvedWorkspace::from(&workspace);
        assert!(convention_diagnostics(&resolved, &workspace).is_empty());
    }
}

#[test]
fn a_nested_workspace_inherits_nothing_from_its_enclosing_one() {
    let source = decisions("    Retention {\n      Keep audit data.\n    }\n");
    let outer = Workspace::load_with(&memory(Some(RULE), &[("c.sigil", &source)])).unwrap();
    assert_eq!(outer.conventions.expect("outer rules").rules.len(), 1);

    // The nested root is read on its own, as the editor and CLI do.
    let inner = load(None, &[("c.sigil", &source)]);
    assert!(inner.conventions.is_none());
    let resolved = ResolvedWorkspace::from(&inner);
    assert!(convention_diagnostics(&resolved, &inner).is_empty());
}

#[test]
fn text_laid_over_check_json_replaces_the_stored_copy() {
    let source = decisions("    Retention {\n      Keep audit data.\n    }\n");
    let base = memory(Some(RULE), &[("c.sigil", &source)]);
    let mut overlay = Overlay::new(&base);
    overlay.set(
        CONVENTIONS_CHECK_PATH,
        r#"{"rules":[{"section":"decisions","require":["Why:"]}]}"#,
    );
    let workspace = Workspace::load_with(&overlay).unwrap();
    let resolved = ResolvedWorkspace::from(&workspace);
    let found = convention_diagnostics(&resolved, &workspace);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].message, missing("Why:", "Retention", "decisions"));

    // An overlay can also supply the file where the base has none.
    let bare = memory(None, &[("c.sigil", &source)]);
    let mut overlay = Overlay::new(&bare);
    overlay.set(CONVENTIONS_CHECK_PATH, RULE);
    assert!(
        Workspace::load_with(&overlay)
            .unwrap()
            .conventions
            .is_some()
    );
}

#[test]
fn a_malformed_check_json_is_one_host_stage_error_and_no_rule_warnings() {
    let source = decisions("    Retention {\n      Keep audit data.\n    }\n");
    let invalid_utf8: &[u8] = &[b'{', 0xff, b'}'];
    let cases: [(&str, &[u8]); 5] = [
        ("unknown key", br#"{"rules":[],"extra":true}"#),
        (
            "empty require",
            br#"{"rules":[{"section":"decisions","require":[]}]}"#,
        ),
        (
            "non-string label",
            br#"{"rules":[{"section":"decisions","require":[1]}]}"#,
        ),
        ("invalid JSON", b"{ not json"),
        ("invalid UTF-8", invalid_utf8),
    ];
    for (name, bytes) in cases {
        let mut fs = memory(None, &[("c.sigil", &source)]);
        fs.insert(CONVENTIONS_CHECK_PATH, bytes);
        let workspace = Workspace::load_with(&fs).unwrap();
        assert!(workspace.conventions.is_none(), "{name}");
        assert_eq!(
            workspace.diagnostics.len(),
            1,
            "{name}: {:?}",
            workspace.diagnostics
        );
        let d = &workspace.diagnostics[0];
        assert_eq!(d.code, "SIGIL_CONVENTION_PARSE", "{name}");
        assert!(matches!(d.severity, Severity::Error), "{name}");
        assert!(matches!(d.stage, Stage::Host), "{name}");
        assert_eq!(
            d.file_path.as_deref(),
            Some(CONVENTIONS_CHECK_PATH),
            "{name}"
        );

        // The diagnostic reaches the resolved workspace, the way glossary faults do.
        let resolved = ResolvedWorkspace::from(&workspace);
        assert!(
            resolved
                .diagnostics
                .iter()
                .any(|r| r.code == "SIGIL_CONVENTION_PARSE"),
            "{name}"
        );
        assert!(
            convention_diagnostics(&resolved, &workspace).is_empty(),
            "{name}"
        );
    }
}

#[test]
fn formatting_results_never_carry_the_conventions_error() {
    use sigil_core::language::format::format_document;
    let long = "These words need wrapping. These words need wrapping. These words need wrapping. These words need wrapping.";
    let wrappable = format!(
        "component Feature {{\n  goal {{\n    {long}\n  }}\n\n  interface {{\n    run()\n  }}\n}}\n"
    );
    let canonical = "component Feature {\n  goal {\n    Keep a record.\n  }\n\n  interface {\n    run()\n  }\n}\n".to_owned();
    let broken = "component Feature {\n}\n";
    for (source, formats) in [
        (&wrappable, true),
        (&canonical, true),
        (&broken.to_owned(), false),
    ] {
        let workspace = load(Some("{ not json"), &[("c.sigil", source)]);
        let result = format_document(&workspace, "c.sigil");
        assert_eq!(result.formatted_source.is_some(), formats, "{source}");
        assert!(
            result
                .diagnostics
                .iter()
                .all(|d| d.code != "SIGIL_CONVENTION_PARSE"),
            "{source}: {:?}",
            result.diagnostics
        );
    }
}

#[test]
fn a_bad_check_json_never_marks_the_text_snapshot_incomplete() {
    // Conventions are no claims input, so a bad file must not make `sigilc`
    // refuse the workspace (KTD3, KTD6).
    for bytes in [&[0xffu8][..], b"{ not json"] {
        let mut fs = memory(None, &[]);
        fs.insert(CONVENTIONS_CHECK_PATH, bytes);
        assert!(Workspace::load_with(&fs).unwrap().text_complete);
    }
}

#[test]
fn a_workspace_without_config_reads_no_conventions() {
    let mut fs = MemoryFs::new();
    fs.insert(CONVENTIONS_CHECK_PATH, RULE);
    let workspace = Workspace::load_with(&fs).unwrap();
    assert!(workspace.config.is_none() && workspace.conventions.is_none());
    assert_eq!(workspace.diagnostics.len(), 1);
    assert_eq!(workspace.diagnostics[0].code, "SIGIL_CONFIG_NOT_FOUND");
}

#[test]
fn the_parser_gives_the_outcome_the_shared_fixture_records() {
    let fixtures: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/conventions-parity.json")).unwrap();
    assert!(fixtures.len() > 20);
    for fixture in fixtures {
        let name = fixture["name"].as_str().unwrap();
        let parsed = parse_check(
            fixture["source"].as_str().unwrap().as_bytes(),
            CONVENTIONS_CHECK_PATH,
        );
        assert_eq!(
            parsed.conventions.is_some(),
            fixture["parserValid"].as_bool().unwrap(),
            "{name}: parser disagreed"
        );
        // A rejected file gives exactly one diagnostic, an accepted one none.
        assert_eq!(
            parsed.diagnostics.len(),
            usize::from(parsed.conventions.is_none()),
            "{name}"
        );
    }
}

#[test]
fn the_parser_keeps_groups_and_labels_as_written() {
    let parsed = parse_check(
        json!({"rules": [{"section": "decisions", "groups": ["A", "B"], "require": ["X:", "Y z:"]}]})
            .to_string()
            .as_bytes(),
        CONVENTIONS_CHECK_PATH,
    );
    let rule = &parsed.conventions.unwrap().rules[0];
    assert_eq!(
        rule.groups.as_deref(),
        Some(&["A".to_owned(), "B".to_owned()][..])
    );
    assert_eq!(rule.require, ["X:", "Y z:"]);
}
