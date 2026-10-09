//! Targeted parser and resolver scenarios beyond the shared corpus.
use sigilc::language::{
    inline::decode,
    parse::{Span, parse_document},
    resolve::ResolvedWorkspace,
    tags::{is_tag_word_character, match_tag_references},
    text::{SourceText, capture_source},
    workspace::Workspace,
};
use std::{fs, path::PathBuf};

fn parse(text: &str) -> sigilc::language::parse::Document {
    parse_document("a.sigil", &capture_source("a.sigil", text.as_bytes()))
}

fn codes(document: &sigilc::language::parse::Document) -> Vec<&str> {
    document
        .diagnostics
        .iter()
        .map(|d| d.code.as_str())
        .collect()
}

#[test]
fn a_line_ending_in_a_brace_covered_by_a_complete_link_stays_prose() {
    let document = parse(
        "component A {\n  goal {\n    Intro [a](u \"covered {\n    by title\") text.\n  }\n  interface {\n    Offer.\n  }\n}\n",
    );
    assert_eq!(codes(&document), Vec::<&str>::new());
    let goal = &document.components[0].sections[0];
    assert!(goal.groups.is_empty());
    assert_eq!(goal.units.len(), 1);
    assert_eq!(goal.units[0].links.len(), 1);
}

#[test]
fn an_uncovered_trailing_brace_opens_a_grouping_tag() {
    let document = parse(
        "component A {\n  goal {\n    Text [a](u) here {\n      Body.\n    }\n  }\n  interface {\n    Offer.\n  }\n}\n",
    );
    assert_eq!(document.components[0].sections[0].groups.len(), 1);
}

#[test]
fn an_unknown_section_body_is_skipped_and_reported() {
    let document = parse(
        "component A {\n  goal {\n    Goal.\n  }\n  notes {\n    inner {\n      x\n    }\n    ```\n    }\n    ```\n  }\n  interface {\n    Offer.\n  }\n}\n",
    );
    assert_eq!(codes(&document), ["SIGIL_UNKNOWN_SECTION"]);
    let component = &document.components[0];
    assert!(component.complete);
    let notes = &component.sections[1];
    assert!(!notes.known && notes.complete && notes.units.is_empty());
    assert_eq!(component.sections[2].units.len(), 1);
}

#[test]
fn entity_decoding_matches_the_typescript_reader() {
    assert_eq!(decode("a&amp;b"), "a&b");
    assert_eq!(decode("&#35;&#x26;&#X41;"), "#&A");
    assert_eq!(decode("&bogus;"), "&bogus;");
    assert_eq!(
        decode("&#0;&#128;&#xD800;&#1114112;"),
        "\u{fffd}\u{20ac}\u{fffd}\u{fffd}"
    );
    // Strict decoding needs the semicolon, and escapes drop their backslash.
    assert_eq!(decode("&amp &#35"), "&amp &#35");
    assert_eq!(decode(r"\&amp; \* \a"), r"&amp; * \a");
    assert_eq!(decode("&notin;"), "\u{2209}");
}

#[test]
fn unicode_15_1_word_characters_bound_tag_references() {
    // U+2EBF0 joined CJK Extension I in Unicode 15.1.
    let new = '\u{2ebf0}';
    assert!(is_tag_word_character(Some(new)));
    assert!(!is_tag_word_character(Some('-')) && !is_tag_word_character(None));
    let text = format!("x{new} x {new}x x");
    let source = SourceText::new(text.clone());
    let found = match_tag_references(&source, &[Span::new(0, text.len())], &["x"]);
    let starts: Vec<usize> = found.iter().map(|m| m.range.start).collect();
    assert_eq!(starts, [text.find(" x ").unwrap() + 1, text.len() - 1]);
}

fn workspace(files: &[(&str, &str)]) -> Workspace {
    let dir: PathBuf = std::env::temp_dir().join(format!("sigilc-parse-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join(".sigil")).unwrap();
    fs::write(
        dir.join(".sigil/config.json"),
        r#"{"sigilVersion":"0.9.0","workspace":{"name":"t"},"files":{"include":["**/*.sigil"]}}"#,
    )
    .unwrap();
    for (name, text) in files {
        fs::write(dir.join(name), text).unwrap();
    }
    Workspace::load(&dir).unwrap()
}

#[test]
fn a_tag_evidenced_only_outside_the_interface_is_not_importable() {
    let workspace = workspace(&[
        (
            "provider.sigil",
            "component Provider {\n  goal {\n    Own.\n  }\n  logic {\n    The *hidden* rule.\n  }\n  interface {\n    Offers *shown*.\n  }\n}\n",
        ),
        (
            "consumer.sigil",
            "@provider.sigil from Provider import { hidden, shown }\n\ncomponent Consumer {\n  goal {\n    Use shown.\n  }\n  interface {\n    Use hidden.\n  }\n}\n",
        ),
    ]);
    let resolved = ResolvedWorkspace::from(&workspace);
    let unresolved: Vec<_> = resolved
        .diagnostics
        .iter()
        .filter(|d| d.code == "SIGIL_UNRESOLVED_IMPORTED_TAG")
        .collect();
    assert_eq!(unresolved.len(), 1, "{:?}", resolved.diagnostics);
    assert_eq!(unresolved[0].file_path.as_deref(), Some("consumer.sigil"));
    assert_eq!(
        unresolved[0].related.len(),
        1,
        "the provider's evidence is related"
    );
}
