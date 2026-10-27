#![cfg(unix)]
//! `fmt` beyond the replay of the recorded cases: the batch protocol, `--check`,
//! repeated runs, and every tracked Sigil source of this repository.
mod support;

use std::{path::Path, process::Command};
use support::Temp;

const WRAPPABLE: &str = "component C {\n  goal {\n    These words need wrapping. These words need wrapping. These words need wrapping. These words need wrapping. These words need wrapping.\n  }\n\n  interface {\n    run()\n  }\n}\n";
const WRAPPED: &str = "component C {\n  goal {\n    These words need wrapping. These words need wrapping. These words need\n    wrapping. These words need wrapping. These words need wrapping.\n  }\n\n  interface {\n    run()\n  }\n}\n";
const UNFORMATTABLE: &str = "component Invalid {\n  goal {\n    xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n  }\n\n  interface {\n    run()\n  }\n}\n";

fn named(source: &str, name: &str) -> String {
    source.replacen("component C", &format!("component {name}"), 1)
}

#[test]
fn the_wrapped_fixture_is_what_formatting_writes() {
    let temp = Temp::workspace();
    temp.write("c.sigil", WRAPPABLE);
    let ran = temp.sigil(&["fmt"]);
    assert_eq!((ran.code, ran.stdout.as_str()), (0, "formatted c.sigil\n"));
    assert_eq!(temp.files()["c.sigil"], WRAPPED);
}

#[test]
fn one_unrepairable_file_fails_both_and_writes_neither() {
    let temp = Temp::workspace();
    temp.write("a.sigil", &named(WRAPPABLE, "A"));
    temp.write("b.sigil", UNFORMATTABLE);
    let before = temp.files();

    let ran = temp.sigil(&["fmt"]);
    assert_eq!(ran.code, 1);
    assert!(
        ran.stdout
            .starts_with("failed a.sigil\nfailed b.sigil\nerror ")
    );
    assert!(ran.stdout.contains("SIGIL_UNFORMATTABLE_LINE"));
    assert_eq!(temp.files(), before);

    let json = temp.sigil(&["fmt", "--format", "json"]);
    assert_eq!(json.code, 1);
    assert_eq!(json.stdout.matches("\"status\":\"failed\"").count(), 2);
    assert_eq!(temp.files(), before);

    let quiet = temp.sigil(&["fmt", "--quiet"]);
    assert_eq!((quiet.code, quiet.stdout.as_str()), (1, ""));
    assert_eq!(temp.files(), before);
}

#[test]
fn a_workspace_error_fails_every_selected_file_even_with_check() {
    let temp = Temp::workspace();
    temp.write("a.sigil", &named(WRAPPABLE, "A"));
    temp.write("broken.sigil", "component Broken {\n}\n");
    let before = temp.files();
    for args in [&["fmt"][..], &["fmt", "--check"]] {
        let ran = temp.sigil(args);
        assert_eq!(ran.code, 1, "{args:?}");
        assert!(
            ran.stdout
                .starts_with("failed a.sigil\nfailed broken.sigil\n"),
            "{}",
            ran.stdout
        );
        assert_eq!(temp.files(), before);
    }
}

#[test]
fn a_malformed_conventions_file_does_not_stop_formatting() {
    // `check.json` is an advisory file for `sigil check`; the formatter reads
    // sources, so a typo in it must not fail every file.
    let temp = Temp::workspace();
    temp.write("c.sigil", WRAPPABLE);
    temp.write(".sigil/conventions/check.json", "{ \"rules\": [");
    for args in [&["fmt", "--check"][..], &["fmt"][..]] {
        let ran = temp.sigil(args);
        assert!(ran.stdout.contains("c.sigil"), "{args:?}: {}", ran.stdout);
        assert!(
            !ran.stdout.contains("SIGIL_CONVENTION_PARSE"),
            "{args:?}: {}",
            ran.stdout
        );
        assert!(
            !ran.stdout.starts_with("failed"),
            "{args:?}: {}",
            ran.stdout
        );
    }
    assert_eq!(temp.files()["c.sigil"], WRAPPED);
    // `check` still reports the file.
    let checked = temp.sigil(&["check"]);
    assert_eq!(checked.code, 1);
    assert!(checked.stdout.contains("SIGIL_CONVENTION_PARSE"));
}

#[test]
fn a_failed_batch_does_not_report_a_malformed_conventions_file() {
    let temp = Temp::workspace();
    temp.write("a.sigil", &named(WRAPPABLE, "A"));
    temp.write("b.sigil", UNFORMATTABLE);
    temp.write(".sigil/conventions/check.json", "{ \"rules\": [");
    for args in [&["fmt"][..], &["fmt", "--format", "json"][..]] {
        let ran = temp.sigil(args);
        assert_eq!(ran.code, 1, "{args:?}");
        assert!(
            ran.stdout.contains("SIGIL_UNFORMATTABLE_LINE"),
            "{}",
            ran.stdout
        );
        assert!(
            !ran.stdout.contains("SIGIL_CONVENTION_PARSE"),
            "{args:?}: {}",
            ran.stdout
        );
    }
}

#[test]
fn check_reports_a_noncanonical_file_and_leaves_it_alone() {
    let temp = Temp::workspace();
    temp.write("c.sigil", WRAPPABLE);
    let ran = temp.sigil(&["fmt", "--check"]);
    assert_eq!(
        (ran.code, ran.stdout.as_str()),
        (1, "noncanonical c.sigil\n")
    );
    assert_eq!(temp.files()["c.sigil"], WRAPPABLE);

    let canonical = Temp::workspace();
    canonical.write("c.sigil", WRAPPED);
    let ran = canonical.sigil(&["fmt", "--check"]);
    assert_eq!((ran.code, ran.stdout.as_str()), (0, "unchanged c.sigil\n"));
    assert_eq!(canonical.files()["c.sigil"], WRAPPED);
}

#[test]
fn json_keys_follow_the_recorded_order() {
    let temp = Temp::workspace();
    temp.write("c.sigil", WRAPPABLE);
    let ran = temp.sigil(&["fmt", "--check", "--format", "json"]);
    assert_eq!(ran.code, 1);
    assert_eq!(
        ran.stdout,
        "{\"command\":\"fmt\",\"workspaceRoot\":\".\",\"configPath\":\".sigil/config.json\",\"sigilVersion\":\"0.9.0\",\"workspaceName\":\"test\",\"check\":true,\"files\":[{\"filePath\":\"c.sigil\",\"status\":\"noncanonical\"}],\"diagnostics\":[]}\n"
    );
}

#[test]
fn a_file_that_fails_only_the_whole_workspace_reload_fails_every_file() {
    // `a.sigil` formats cleanly on its own. `b.sigil` is not selected and keeps
    // its too-long line, so the reloaded workspace still has an error.
    let temp = Temp::workspace();
    temp.write("a.sigil", &named(WRAPPABLE, "A"));
    temp.write("b.sigil", &named(WRAPPABLE, "B"));
    let before = temp.files();
    let ran = temp.sigil(&["fmt", "a.sigil"]);
    assert_eq!(ran.code, 1);
    assert!(
        ran.stdout
            .starts_with("failed a.sigil\nerror SIGIL_LINE_TOO_LONG")
    );
    assert_eq!(temp.files(), before);

    // Selecting both repairs the whole workspace and writes both.
    let ran = temp.sigil(&["fmt"]);
    assert_eq!(
        (ran.code, ran.stdout.as_str()),
        (0, "formatted a.sigil\nformatted b.sigil\n")
    );
}

#[test]
fn an_unchanged_selection_still_fails_for_a_long_line_elsewhere() {
    // `a.sigil` is canonical and `b.sigil`, which is not selected, keeps a line
    // that is too long. The workspace is not valid, so `a.sigil` is `failed`
    // and the error is listed even though nothing would be written.
    let temp = Temp::workspace();
    temp.write("a.sigil", &named(WRAPPED, "A"));
    temp.write("b.sigil", &named(WRAPPABLE, "B"));
    let before = temp.files();
    for args in [&["fmt", "a.sigil"][..], &["fmt", "--check", "a.sigil"]] {
        let ran = temp.sigil(args);
        assert_eq!(ran.code, 1, "{args:?}");
        assert!(
            ran.stdout
                .starts_with("failed a.sigil\nerror SIGIL_LINE_TOO_LONG: "),
            "{}",
            ran.stdout
        );
        assert_eq!(ran.stdout.lines().count(), 2, "{}", ran.stdout);
        assert_eq!(ran.stderr, "");
        assert_eq!(temp.files(), before);
    }

    let json = temp.json("fmt", &["a.sigil"]);
    assert_eq!(json.0, 1);
    assert_eq!(
        json.1["files"],
        serde_json::json!([{"filePath": "a.sigil", "status": "failed"}])
    );
    assert_eq!(json.1["diagnostics"][0]["code"], "SIGIL_LINE_TOO_LONG");
    assert_eq!(json.1["diagnostics"][0]["filePath"], "b.sigil");
}

#[test]
fn a_nested_workspace_has_no_source_to_format_from_inside_it() {
    let temp = Temp::workspace();
    temp.write("p.sigil", &named(WRAPPED, "P"));
    temp.write("child/.sigil/config.json", support::CONFIG);
    temp.write("child/c.sigil", &named(WRAPPED, "K"));
    let before = temp.files();
    let child = temp.path("child");
    for args in [&["fmt"][..], &["fmt", "c.sigil"], &["fmt", "--check"]] {
        let ran = support::run(&child, args);
        assert_eq!((ran.code, ran.stdout.as_str()), (3, ""), "{args:?}");
        assert_eq!(
            ran.stderr,
            format!(
                "No Sigil source matched {}.\n",
                if args.contains(&"c.sigil") {
                    format!("{}/c.sigil", child.display())
                } else {
                    child.display().to_string()
                }
            )
        );
    }
    assert_eq!(temp.files(), before);
}

#[test]
fn a_nested_workspace_fails_the_parent_with_the_workspace_named_by_path() {
    let temp = Temp::workspace();
    temp.write("p.sigil", &named(WRAPPED, "P"));
    temp.write("child/.sigil/config.json", support::CONFIG);
    temp.write("child/c.sigil", &named(WRAPPED, "K"));
    let before = temp.files();
    let ran = temp.sigil(&["fmt"]);
    assert_eq!(ran.code, 1);
    assert_eq!(
        ran.stdout,
        format!(
            "failed p.sigil\nerror SIGIL_NESTED_CONFIG: Nested .sigil/config.json must be inside a subtree excluded by workspace {}.\n",
            temp.text()
        )
    );
    assert_eq!(temp.files(), before);
}

#[test]
fn formatting_twice_leaves_the_second_run_unchanged() {
    let temp = Temp::workspace();
    temp.write("c.sigil", WRAPPABLE);
    assert_eq!(temp.sigil(&["fmt"]).stdout, "formatted c.sigil\n");
    let after = temp.files();
    let second = temp.sigil(&["fmt"]);
    assert_eq!(
        (second.code, second.stdout.as_str()),
        (0, "unchanged c.sigil\n")
    );
    assert_eq!(temp.files(), after);
}

#[test]
fn argument_order_does_not_change_the_output() {
    let temp = Temp::workspace();
    temp.write("a b.sigil", &named(WRAPPABLE, "A"));
    temp.write("z.sigil", &named(WRAPPABLE, "Z"));
    let forward = temp.sigil(&["fmt", "--check", "a b.sigil", "z.sigil"]);
    let reversed = temp.sigil(&["fmt", "--check", "z.sigil", "a b.sigil"]);
    assert_eq!(
        forward.stdout,
        "noncanonical a b.sigil\nnoncanonical z.sigil\n"
    );
    assert_eq!(forward.stdout, reversed.stdout);
    assert_eq!((forward.code, reversed.code), (1, 1));
}

#[test]
fn markdown_is_a_usage_error_with_no_stdout() {
    let temp = Temp::workspace();
    temp.write("c.sigil", WRAPPABLE);
    let ran = temp.sigil(&["fmt", "--format", "markdown"]);
    assert_eq!((ran.code, ran.stdout.as_str()), (2, ""));
    assert!(
        ran.stderr
            .starts_with("Error: --format must be text or json for fmt.")
    );
    assert_eq!(temp.files()["c.sigil"], WRAPPABLE);
}

#[test]
fn no_config_is_a_runtime_error_not_a_diagnostic() {
    let temp = Temp::new();
    let ran = temp.sigil(&["fmt"]);
    assert_eq!(ran.code, 3);
    assert_eq!(ran.stdout, "");
    assert_eq!(
        ran.stderr,
        format!("No Sigil source matched {}.\n", temp.text())
    );
}

fn tracked_sigil_files(repo: &Path) -> Option<Vec<String>> {
    let listed = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["ls-files", "*.sigil"])
        .output()
        .ok()?;
    listed.status.success().then(|| {
        String::from_utf8(listed.stdout)
            .expect("paths are UTF-8")
            .lines()
            .map(str::to_owned)
            .collect()
    })
}

/// The tracked sources are the repository's own canonical text, so `fmt --check`
/// in a copy of them must report every selected file unchanged. The core corpus test
/// uses recorded fixtures, not these files, so this covers different ground.
/// A temporary workspace is used because running on the repository root walks
/// `target/`.
#[test]
fn every_tracked_sigil_source_of_the_repository_is_canonical() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let Some(files) = tracked_sigil_files(&repo) else {
        eprintln!("skipped: git is unavailable or this is not a checkout");
        return;
    };
    if files.is_empty() {
        eprintln!("skipped: no tracked .sigil files");
        return;
    }
    let temp = Temp::new();
    for context in [".sigil/config.json", ".sigil/glossary.json"] {
        if let Ok(text) = std::fs::read_to_string(repo.join(context)) {
            temp.write(context, &text);
        }
    }
    for file in &files {
        let text = std::fs::read_to_string(repo.join(file)).expect("a tracked source is readable");
        temp.write(file, &text);
    }
    let ran = temp.sigil(&["fmt", "--check"]);
    // The repository config excludes some tracked sources (the examples), so
    // the output may name fewer files than were copied.
    assert_eq!(ran.code, 0, "{}", ran.stdout);
    let reported: Vec<&str> = ran
        .stdout
        .lines()
        .map(|line| {
            line.strip_prefix("unchanged ")
                .unwrap_or_else(|| panic!("not unchanged: {line}"))
        })
        .collect();
    assert!(reported.iter().all(|path| files.iter().any(|f| f == path)));
    assert!(
        reported.contains(&"packages/core/core.sigil") && reported.len() >= 10,
        "{reported:?}"
    );
}
