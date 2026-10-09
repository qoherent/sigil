//! `sigilc tree`: deterministic trees and the R10 diff.
mod support;
use serde_json::Value;
use std::process::{Command, Output};
use support::Workspace;

fn run(root: &Workspace, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .arg("tree")
        .args(args)
        .args(["--root", "."])
        .current_dir(&root.0)
        .output()
        .unwrap()
}
fn json(root: &Workspace, args: &[&str]) -> Value {
    let output = run(root, args);
    assert_eq!(
        output.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}
fn edit(root: &Workspace, path: &str, from: &str, to: &str) {
    let text = std::fs::read_to_string(root.0.join(path)).unwrap();
    root.write(path, text.replacen(from, to, 1).as_bytes());
}

#[test]
fn a_source_tree_prints_identical_bytes_every_time() {
    let root = support::shared_workspace();
    let first = run(&root, &["--source", "consumer.sigil"]);
    let second = run(&root, &["--source", "consumer.sigil"]);
    assert_eq!(first.status.code(), Some(0));
    assert_eq!(first.stdout, second.stdout);
    let tree: Value = serde_json::from_slice(&first.stdout).unwrap();
    assert_eq!(tree["parse"]["path"], "consumer.sigil");
    assert!(tree["id"].as_str().unwrap().len() == 64);
    // A different store (so a cold cache) prints the same bytes.
    let cold = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args([
            "tree",
            "--source",
            "consumer.sigil",
            "--root",
            ".",
            "--store",
        ])
        .arg(root.0.join("elsewhere"))
        .current_dir(&root.0)
        .output()
        .unwrap();
    assert_eq!(first.stdout, cold.stdout);
}

#[test]
fn every_source_prints_in_path_order() {
    let root = support::shared_workspace();
    let all = json(&root, &[]);
    let paths: Vec<_> = all["trees"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["parse"]["path"].as_str().unwrap())
        .collect();
    assert_eq!(paths, ["base.sigil", "consumer.sigil"]);
}

#[test]
fn diff_lists_exactly_the_edited_facet() {
    let root = support::shared_workspace();
    // Recording the first tree makes it the baseline; there is nothing before it.
    let none = json(&root, &["--source", "base.sigil", "--diff"]);
    assert_eq!(none["diffs"][0]["hasPrevious"], false);
    assert_eq!(none["diffs"][0]["diff"]["changed"], serde_json::json!([]));
    let before = support::base_goal().to_owned();
    edit(
        &root,
        "base.sigil",
        "Own provider vocabulary.",
        "Own the provider vocabulary.",
    );
    let diff = json(&root, &["--source", "base.sigil", "--diff"]);
    let entry = &diff["diffs"][0];
    assert_eq!(entry["source"], "base.sigil");
    assert_eq!(entry["hasPrevious"], true);
    let changed = entry["diff"]["changed"].as_array().unwrap();
    assert_eq!(changed.len(), 1, "{entry}");
    assert_eq!(changed[0]["before"]["id"], before);
    assert_eq!(changed[0]["before"]["section"], "goal");
    assert_ne!(changed[0]["after"]["id"], before);
    assert_eq!(entry["diff"]["added"], serde_json::json!([]));
    assert_eq!(entry["diff"]["removed"], serde_json::json!([]));
    // The other source has no previous tree.
    let all = json(&root, &["--diff"]);
    let consumer = all["diffs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["source"] == "consumer.sigil")
        .unwrap();
    assert_eq!(consumer["hasPrevious"], false);
}

#[test]
fn a_reformat_diffs_to_nothing() {
    let root = support::shared_workspace();
    json(&root, &["--source", "base.sigil"]);
    edit(
        &root,
        "base.sigil",
        "Own provider vocabulary.",
        "Own\n   provider   vocabulary.",
    );
    let diff = json(&root, &["--source", "base.sigil", "--diff"]);
    assert_eq!(diff["diffs"][0]["diff"]["changed"], serde_json::json!([]));
    assert_eq!(
        diff["diffs"][0]["diff"]["sectionsChanged"],
        serde_json::json!([])
    );
}

#[test]
fn usage_and_operational_errors_use_the_shared_exit_codes() {
    let root = support::shared_workspace();
    for args in [
        vec!["--unknown"],
        vec!["--source"],
        vec!["--diff", "--diff"],
        vec!["--source", "a", "--source", "b"],
    ] {
        assert_eq!(run(&root, &args).status.code(), Some(2), "{args:?}");
    }
    assert_eq!(
        run(&root, &["--source", "missing.sigil"]).status.code(),
        Some(3)
    );
    let missing = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(["tree", "--root", "does-not-exist"])
        .current_dir(&root.0)
        .output()
        .unwrap();
    assert_eq!(missing.status.code(), Some(3));
}
