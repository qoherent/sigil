#![cfg(unix)]
//! The `check` command beyond the recorded cases: the untagged-Facet warning
//! without implementation diagnostics, counts, character locations, and the
//! markdown output.
mod support;

use serde_json::Value;
use sigil_cli::model::source_location;
use sigil_core::language::workspace::Workspace;
use support::{BASE_SOURCE, Temp};

/// A component whose Interface Facet names no Tag.
const UNTAGGED: &str = "component Feature {\n  goal {\n    Keep the record.\n  }\n  interface {\n    Operations complete synchronously.\n  }\n}\n";

fn codes(value: &Value) -> Vec<&str> {
    value["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["code"].as_str().unwrap())
        .collect()
}

#[test]
fn an_untagged_facet_warns_and_an_implementation_annotation_adds_nothing() {
    let temp = Temp::workspace();
    temp.write("contract.sigil", UNTAGGED);
    temp.write(
        "src/feature.ts",
        "// @sigil implements contract.sigil::Feature::Missing interface\nexport const feature = 1;\n",
    );
    let (code, value) = temp.json("check", &[]);
    assert_eq!(code, 0);
    assert_eq!(codes(&value), ["SIGIL_UNTAGGED_FACET"]);
    assert_eq!(value["diagnostics"][0]["severity"], "warning");
    assert_eq!(
        value["diagnostics"][0]["sourceLocation"],
        serde_json::json!({"line": 6, "column": 1})
    );
    assert_eq!(
        value["diagnosticCounts"],
        serde_json::json!({"error": 0, "warning": 1, "info": 0})
    );
}

/// A required-label rule, and a contract whose named decision group lacks `Scope:`.
const DECISION_RULE: &str =
    r#"{"rules":[{"section":"decisions","require":["Decision:","Scope:"]}]}"#;
const LACKS_SCOPE: &str = "component Feature {\n  goal {\n    Keep the record.\n  }\n\n  interface {\n    Record {\n      A Record is kept.\n    }\n  }\n\n  decisions {\n    Retention {\n      Decision: Keep audit data.\n    }\n  }\n}\n";

#[test]
fn a_group_missing_a_required_label_warns_and_the_exit_stays_zero() {
    let temp = Temp::workspace();
    temp.write(".sigil/conventions/check.json", DECISION_RULE);
    temp.write("contract.sigil", LACKS_SCOPE);
    let (code, value) = temp.json("check", &[]);
    assert_eq!(code, 0);
    assert_eq!(codes(&value), ["SIGIL_CONVENTION_MISSING_LABEL"]);
    assert_eq!(value["diagnostics"][0]["severity"], "warning");
    assert!(
        value["diagnostics"][0]["message"]
            .as_str()
            .unwrap()
            .contains("`Scope:`")
    );
    assert_eq!(
        value["diagnosticCounts"],
        serde_json::json!({"error": 0, "warning": 1, "info": 0})
    );
    let text = temp.sigil(&["check", "--show-locations"]);
    assert_eq!(text.code, 0);
    assert!(
        text.stdout
            .contains("Diagnostics: 0 error, 1 warning, 0 info\n")
    );
    assert!(
        text.stdout
            .contains("warning SIGIL_CONVENTION_MISSING_LABEL contract.sigil:13:1: "),
        "{}",
        text.stdout
    );
}

#[test]
fn a_workspace_without_conventions_reports_no_convention_warning() {
    let temp = Temp::workspace();
    temp.write("contract.sigil", LACKS_SCOPE);
    let (code, value) = temp.json("check", &[]);
    assert_eq!(code, 0);
    assert_eq!(codes(&value), Vec::<&str>::new());
    assert_eq!(
        value["diagnosticCounts"],
        serde_json::json!({"error": 0, "warning": 0, "info": 0})
    );
    assert_eq!(
        temp.sigil(&["check"]).stdout,
        "Workspace root: .\nDiagnostics: 0 error, 0 warning, 0 info\n"
    );
}

#[test]
fn a_malformed_conventions_file_is_an_error_that_names_it() {
    let temp = Temp::workspace();
    temp.write(
        ".sigil/conventions/check.json",
        "{\"rules\": [{\"section\": \"decisions\", \"require\": []}]}",
    );
    temp.write("contract.sigil", LACKS_SCOPE);
    let (code, value) = temp.json("check", &[]);
    assert_eq!(code, 1);
    assert_eq!(codes(&value), ["SIGIL_CONVENTION_PARSE"]);
    assert_eq!(
        value["diagnostics"][0]["filePath"],
        ".sigil/conventions/check.json"
    );
    assert_eq!(
        value["diagnosticCounts"],
        serde_json::json!({"error": 1, "warning": 0, "info": 0})
    );
}

#[test]
fn counts_follow_the_severities_and_an_error_decides_the_exit_status() {
    let temp = Temp::workspace();
    temp.write("base.sigil", BASE_SOURCE);
    temp.write("contract.sigil", UNTAGGED);
    temp.write(
        "a.sigil",
        "@base.sigil from Base import { value, missing }\ncomponent Broken {\n  goal {\n    Ship it.\n  }\n  interface {\n    Use value.\n  }\n}\n",
    );
    let (code, value) = temp.json("check", &[]);
    assert_eq!(code, 1);
    assert_eq!(
        value["diagnosticCounts"],
        serde_json::json!({"error": 1, "warning": 1, "info": 0})
    );
    // Ordered by file path, so the error in a.sigil comes before the warning.
    assert_eq!(
        codes(&value),
        ["SIGIL_UNRESOLVED_IMPORTED_TAG", "SIGIL_UNTAGGED_FACET"]
    );
    let text = temp.sigil(&["check"]);
    assert_eq!(text.code, 1);
    assert!(
        text.stdout
            .contains("Diagnostics: 1 error, 1 warning, 0 info\n")
    );
}

#[test]
fn a_warning_only_workspace_exits_zero() {
    let temp = Temp::workspace();
    temp.write("contract.sigil", UNTAGGED);
    assert_eq!(temp.sigil(&["check"]).code, 0);
}

#[test]
fn show_locations_counts_columns_in_characters() {
    let temp = Temp::workspace();
    temp.write("base.sigil", BASE_SOURCE);
    temp.write(
        "a.sigil",
        "@base.sigil from Base import { value, \u{1F600}, missing }\ncomponent Broken {\n  goal {\n    Ship it.\n  }\n  interface {\n    Use value.\n  }\n}\n",
    );
    let ran = temp.sigil(&["check", "--show-locations"]);
    assert_eq!(ran.code, 1);
    // The emoji is one column and four bytes.
    assert_eq!(
        ran.stdout,
        "Workspace root: .\n\
         Diagnostics: 2 error, 0 warning, 0 info\n\
         error SIGIL_UNRESOLVED_IMPORTED_TAG a.sigil:1:39: Component Base does not own an unambiguous Tag \"\u{1F600}\".\n\
         error SIGIL_UNRESOLVED_IMPORTED_TAG a.sigil:1:42: Component Base does not own an unambiguous Tag \"missing\".\n"
    );
    let (_, value) = temp.json("check", &[]);
    assert_eq!(
        value["diagnostics"][1]["sourceLocation"],
        serde_json::json!({"line": 1, "column": 42})
    );
}

#[test]
fn locations_are_text_only_and_files_show_without_them_by_default() {
    let temp = Temp::workspace();
    temp.write("contract.sigil", UNTAGGED);
    let plain = temp.sigil(&["check"]);
    assert!(plain.stdout.contains("warning SIGIL_UNTAGGED_FACET: "));
    let shown = temp.sigil(&["check", "--show-locations"]);
    assert!(
        shown
            .stdout
            .contains("warning SIGIL_UNTAGGED_FACET contract.sigil:6:1: ")
    );
    let (_, with) = temp.json("check", &["--show-locations"]);
    let (_, without) = temp.json("check", &[]);
    assert_eq!(with, without);
}

#[test]
fn a_diagnostic_in_a_file_the_snapshot_lacks_prints_no_location() {
    let temp = Temp::new();
    temp.write(".sigil/config.json", "{\"sigilVersion\":");
    temp.write("item.sigil", UNTAGGED);
    let ran = temp.sigil(&["check", "--show-locations"]);
    assert_eq!(ran.code, 1);
    let line = ran.stdout.lines().nth(2).unwrap();
    assert!(
        line.starts_with("error SIGIL_CONFIG_PARSE .sigil/config.json: "),
        "{line}"
    );
    let (_, value) = temp.json("check", &[]);
    assert!(value["diagnostics"][0].get("sourceLocation").is_none());
}

#[test]
fn an_offset_inside_a_character_has_no_location() {
    let temp = Temp::workspace();
    temp.write(
        "a.sigil",
        "component A {\n  goal {\n    x \u{1F600}\n  }\n}\n",
    );
    let workspace = Workspace::load(&temp.root).unwrap();
    let source = std::fs::read_to_string(temp.path("a.sigil")).unwrap();
    let emoji = source.find('\u{1F600}').unwrap();
    assert!(source_location(&workspace, "a.sigil", emoji).is_some());
    assert!(source_location(&workspace, "a.sigil", emoji + 1).is_none());
    assert!(source_location(&workspace, "missing.sigil", 0).is_none());
}

#[test]
fn a_missing_config_reports_the_recorded_code_in_text() {
    let temp = Temp::new();
    let ran = temp.sigil(&["check"]);
    assert_eq!(ran.code, 1);
    assert!(ran.stdout.contains("error SIGIL_CONFIG_NOT_FOUND: "));
}

#[test]
fn markdown_for_a_clean_workspace() {
    let temp = Temp::workspace();
    temp.write("base.sigil", BASE_SOURCE);
    let ran = temp.sigil(&["check", "--format", "markdown"]);
    assert_eq!(ran.code, 0);
    assert_eq!(
        ran.stdout,
        "# Sigil check\n\n- Workspace root: .\n- Diagnostics: 0 error, 0 warning, 0 info\n\n## Diagnostics\n\nNone.\n"
    );
}

#[test]
fn markdown_lists_the_diagnostics_the_text_does() {
    let temp = Temp::workspace();
    temp.write("base.sigil", BASE_SOURCE);
    temp.write("contract.sigil", UNTAGGED);
    temp.write(
        "a.sigil",
        "@base.sigil from Base import { value, missing }\ncomponent Broken {\n  goal {\n    Ship it.\n  }\n  interface {\n    Use value.\n  }\n}\n",
    );
    let ran = temp.sigil(&["check", "--format", "markdown"]);
    assert_eq!(ran.code, 1);
    assert_eq!(
        ran.stdout,
        "# Sigil check\n\n- Workspace root: .\n- Diagnostics: 1 error, 1 warning, 0 info\n\n## Diagnostics\n\n\
         - error SIGIL_UNRESOLVED_IMPORTED_TAG: Component Base does not own an unambiguous Tag \"missing\".\n\
         - warning SIGIL_UNTAGGED_FACET: Facet has no Tag reference or inline Tag definition in its prose.\n"
    );
    let located = temp.sigil(&["check", "--format", "markdown", "--show-locations"]);
    assert!(
        located
            .stdout
            .contains("- warning SIGIL_UNTAGGED_FACET contract.sigil:6:1: ")
    );
}

#[test]
fn quiet_prints_nothing_and_keeps_the_exit_status() {
    let temp = Temp::new();
    let ran = temp.sigil(&["check", "--quiet", "--format", "markdown"]);
    assert_eq!((ran.code, ran.stdout.as_str()), (1, ""));
}

#[test]
fn nested_config_messages_name_the_workspaces_by_absolute_path() {
    let temp = Temp::workspace();
    temp.write("child/.sigil/config.json", support::CONFIG);
    temp.write("p.sigil", BASE_SOURCE);
    let root = temp.text();
    let parent = temp.sigil(&["check"]);
    assert_eq!(parent.code, 1);
    assert!(
        parent.stdout.contains(&format!(
            "error SIGIL_NESTED_CONFIG: Nested .sigil/config.json must be inside a subtree excluded by workspace {root}.\n"
        )),
        "{}",
        parent.stdout
    );
    let child = support::run(&temp.path("child"), &["check"]);
    assert_eq!(child.code, 1);
    assert!(
        child.stdout.contains(&format!(
            "error SIGIL_NESTED_CONFIG: Workspace {root}/child is nested inside parent workspace {root} without being excluded by it.\n"
        )),
        "{}",
        child.stdout
    );
}

#[test]
fn a_member_with_its_own_config_is_named_by_absolute_path() {
    let temp = Temp::new();
    temp.write(
        ".sigil/config.json",
        "{\"sigilVersion\":\"0.9.0\",\"workspace\":{\"name\":\"test\",\"members\":[\"sub\"]},\"files\":{\"include\":[\"**/*.sigil\"]},\"tools\":{}}",
    );
    temp.write("sub/.sigil/config.json", support::CONFIG);
    let ran = temp.sigil(&["check"]);
    assert_eq!(ran.code, 1);
    assert!(
        ran.stdout.contains(&format!(
            "error SIGIL_NESTED_CONFIG: Workspace member {}/sub must not contain its own .sigil/config.json.\n",
            temp.text()
        )),
        "{}",
        ran.stdout
    );
}
