#![cfg(unix)]
//! Nested workspaces: a file is served by the nearest workspace above it, each
//! workspace is read on its own, and a nested workspace lives while one of its
//! files is open.
mod support;

use serde_json::{Value, json};
use support::{CLEAN, CONSUMER, Client, Temp, at, started};

/// A workspace config that leaves `excluded` to a nested workspace.
fn config_excluding(excluded: &[&str]) -> String {
    let excluded: Vec<String> = excluded.iter().map(|path| format!("{path}/**")).collect();
    json!({
        "sigilVersion": "0.9.0",
        "workspace": {"name": "outer", "members": []},
        "files": {"include": ["**/*.sigil"], "exclude": excluded},
        "tools": {},
    })
    .to_string()
}

/// The same config for a workspace with a name of its own.
fn named_config(name: &str, excluded: &[&str]) -> String {
    let mut config: Value = serde_json::from_str(&config_excluding(excluded)).unwrap();
    config["workspace"]["name"] = json!(name);
    config.to_string()
}

/// An enclosing workspace that excludes `inner/`, which is a workspace itself.
fn enclosing(files: &[(&str, &str)]) -> Temp {
    let temp = Temp::new();
    temp.write(".sigil/config.json", &named_config("outer", &["inner"]));
    temp.write("inner/.sigil/config.json", &named_config("inner", &[]));
    for (path, text) in files {
        temp.write(path, text);
    }
    temp
}

fn hover(client: &mut Client, uri: &str, position: (u32, u32)) -> Value {
    let response = client.request(
        "textDocument/hover",
        json!({
            "textDocument": {"uri": uri},
            "position": {"line": position.0, "character": position.1},
        }),
    );
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}

fn markdown(hover: &Value) -> &str {
    hover["contents"]["value"].as_str().expect("markdown hover")
}

#[test]
fn a_file_of_an_excluded_nested_workspace_is_served_from_that_workspace() {
    let temp = enclosing(&[
        ("inner/contract.sigil", CLEAN),
        ("inner/consumer.sigil", CONSUMER),
    ]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let consumer = temp.uri("inner/consumer.sigil");
    client.open(&consumer, 1, CONSUMER);

    let found = hover(&mut client, &consumer, at(CONSUMER, "Execution", 3));
    assert!(
        markdown(&found).contains("### Tag"),
        "a Tag hover shows the provider contract: {found}"
    );

    let definition = client.request(
        "textDocument/definition",
        json!({
            "textDocument": {"uri": consumer},
            "position": {"line": at(CONSUMER, "Execution", 3).0, "character": at(CONSUMER, "Execution", 3).1},
        }),
    );
    assert_eq!(
        definition["result"]["uri"],
        temp.uri("inner/contract.sigil"),
        "{definition}"
    );

    let tokens = client.request(
        "textDocument/semanticTokens/full",
        json!({"textDocument": {"uri": consumer}}),
    );
    assert!(
        !tokens["result"]["data"].as_array().unwrap().is_empty(),
        "{tokens}"
    );
}

#[test]
fn a_workspace_without_nesting_still_answers_from_the_start_workspace() {
    let (temp, mut client) = started(&[("contract.sigil", CLEAN), ("consumer.sigil", CONSUMER)]);
    let consumer = temp.uri("consumer.sigil");
    client.open(&consumer, 1, CONSUMER);
    let found = hover(&mut client, &consumer, at(CONSUMER, "Execution", 3));
    assert!(markdown(&found).contains("### Tag"), "{found}");
}

const ELSEWHERE_CONTRACT: &str = "component Thing {\n  goal {\n    Represent one useful Execution.\n  }\n\n  cases {\n    Execution {\n      Running succeeds. Each Execution ends.\n    }\n  }\n\n  interface {\n    Execution {\n      run() launches an Execution of the nested kind.\n    }\n  }\n}\n";

fn definition_of(client: &mut Client, uri: &str, position: (u32, u32)) -> Value {
    client.request(
        "textDocument/definition",
        json!({
            "textDocument": {"uri": uri},
            "position": {"line": position.0, "character": position.1},
        }),
    )["result"]
        .clone()
}

fn codes(found: &[Value]) -> Vec<&str> {
    found
        .iter()
        .map(|item| item["code"].as_str().unwrap())
        .collect()
}

#[test]
fn a_workspace_nested_two_levels_deep_is_served_from_its_own_root() {
    let temp = Temp::new();
    temp.write(".sigil/config.json", &named_config("outer", &["mid"]));
    temp.write("mid/.sigil/config.json", &named_config("mid", &["deep"]));
    temp.write("mid/deep/.sigil/config.json", &named_config("deep", &[]));
    temp.write("mid/deep/contract.sigil", CLEAN);
    temp.write("mid/deep/consumer.sigil", CONSUMER);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let consumer = temp.uri("mid/deep/consumer.sigil");
    client.open(&consumer, 1, CONSUMER);
    let found = definition_of(&mut client, &consumer, at(CONSUMER, "Execution", 3));
    assert_eq!(found["uri"], temp.uri("mid/deep/contract.sigil"), "{found}");
    let held = client.server.held_workspaces();
    assert_eq!(held.len(), 2, "the start and the deep workspace: {held:?}");
    assert!(held[1].ends_with("mid/deep"), "{held:?}");
}

#[test]
fn each_workspace_resolves_a_component_of_the_same_name_on_its_own() {
    let temp = enclosing(&[
        ("contract.sigil", CLEAN),
        ("consumer.sigil", CONSUMER),
        ("inner/contract.sigil", ELSEWHERE_CONTRACT),
        ("inner/consumer.sigil", CONSUMER),
    ]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let outer = temp.uri("consumer.sigil");
    let inner = temp.uri("inner/consumer.sigil");
    client.open(&outer, 1, CONSUMER);
    client.open(&inner, 1, CONSUMER);
    let position = at(CONSUMER, "Execution", 3);
    let in_outer = hover(&mut client, &outer, position);
    let in_inner = hover(&mut client, &inner, position);
    assert!(markdown(&in_outer).contains("starts an ["), "{in_outer}");
    assert!(!markdown(&in_outer).contains("nested kind"), "{in_outer}");
    assert!(markdown(&in_inner).contains("nested kind"), "{in_inner}");
}

#[test]
fn the_render_command_serves_a_nested_file() {
    let temp = enclosing(&[("inner/contract.sigil", CLEAN)]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let uri = temp.uri("inner/contract.sigil");
    client.open(&uri, 1, CLEAN);
    let response = client.request(
        "workspace/executeCommand",
        json!({"command": "sigil.renderDocument", "arguments": [uri]}),
    );
    let markdown = response["result"].as_str().expect("markdown");
    assert!(markdown.contains("Thing"), "{markdown}");
}

#[test]
fn a_file_with_no_config_above_it_answers_as_it_did_before() {
    let (_temp, mut client) = started(&[("a.sigil", CLEAN)]);
    let outside = Temp::new();
    outside.write("free.sigil", CONSUMER);
    let uri = outside.uri("free.sigil");
    client.open(&uri, 1, CONSUMER);
    let response = client.request(
        "textDocument/hover",
        json!({
            "textDocument": {"uri": uri},
            "position": {"line": 0, "character": 0},
        }),
    );
    assert!(response.get("error").is_none(), "{response}");
    assert_eq!(response["result"], Value::Null);
}

#[test]
fn a_nested_workspace_that_cannot_be_read_fails_only_its_own_requests() {
    use sigil_core::language::fs::{DiskFs, SourceFs};
    use sigil_lsp::server::ServerOptions;
    let temp = enclosing(&[
        ("contract.sigil", CLEAN),
        ("consumer.sigil", CONSUMER),
        ("inner/consumer.sigil", CONSUMER),
    ]);
    let mut client = Client::new(ServerOptions {
        cwd: temp.root.clone(),
        fs: Some(Box::new(|root| -> Box<dyn SourceFs> {
            if root.ends_with("inner") {
                Box::new(support::Unreadable)
            } else {
                Box::new(DiskFs::new(root))
            }
        })),
        ..ServerOptions::default()
    });
    client.start(&temp);
    let inner = temp.uri("inner/consumer.sigil");
    let outer = temp.uri("consumer.sigil");
    client.open(&inner, 1, CONSUMER);
    client.open(&outer, 1, CONSUMER);
    let failed = client.request(
        "textDocument/hover",
        json!({"textDocument": {"uri": inner}, "position": {"line": 0, "character": 0}}),
    );
    assert_eq!(failed["error"]["code"], -32603, "{failed}");
    assert!(
        failed["error"]["message"]
            .as_str()
            .unwrap()
            .starts_with("Unable to load workspace"),
        "{failed}"
    );
    let found = hover(&mut client, &outer, at(CONSUMER, "Execution", 3));
    assert!(markdown(&found).contains("### Tag"), "{found}");
}

#[test]
fn a_nested_config_that_does_not_parse_is_published_and_the_server_keeps_running() {
    let temp = enclosing(&[("inner/a.sigil", CLEAN)]);
    temp.write("inner/.sigil/config.json", "{");
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let out = client.open(&temp.uri("inner/a.sigil"), 1, CLEAN);
    let config = temp.uri("inner/.sigil/config.json");
    let found = support::published_for(&out, &config).expect("published at the nested config");
    assert_eq!(found[0]["code"], "SIGIL_CONFIG_PARSE");
    assert_eq!(client.server.state(), sigil_lsp::server::State::Running);
}

// Lifecycle, diagnostics and reload (U2).

#[test]
fn a_nested_workspace_publishes_while_a_file_is_open_and_clears_when_the_last_closes() {
    let temp = enclosing(&[
        ("inner/one.sigil", CLEAN),
        ("inner/two.sigil", CONSUMER),
        ("inner/third.sigil", support::BROKEN),
    ]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let one = temp.uri("inner/one.sigil");
    let two = temp.uri("inner/two.sigil");
    let third = temp.uri("inner/third.sigil");
    let out = client.open(&one, 1, CLEAN);
    assert!(
        !support::published_for(&out, &third)
            .expect("published")
            .is_empty(),
        "an unopened file of the nested workspace reports its error"
    );
    client.open(&two, 1, CONSUMER);
    let out = client.close(&one);
    assert!(support::published_for(&out, &third).is_none_or(|found| !found.is_empty()));
    assert_eq!(client.server.held_workspaces().len(), 2);
    let out = client.close(&two);
    assert_eq!(support::published_for(&out, &third), Some(Vec::new()));
    assert_eq!(
        client.server.held_workspaces().len(),
        1,
        "only the start workspace stays"
    );
}

#[test]
fn an_unsaved_nested_buffer_shows_its_own_text_until_it_closes() {
    let temp = enclosing(&[("inner/a.sigil", CLEAN)]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let uri = temp.uri("inner/a.sigil");
    let out = client.open(&uri, 1, support::BROKEN);
    assert!(
        !support::published_for(&out, &uri)
            .expect("published")
            .is_empty()
    );
    let out = client.close(&uri);
    assert_eq!(support::published_for(&out, &uri), Some(Vec::new()));
}

#[test]
fn a_watched_change_to_a_nested_config_reads_only_the_nested_workspace() {
    let temp = enclosing(&[("inner/a.sigil", CLEAN), ("b.sigil", CLEAN)]);
    let disk = support::Disk::new();
    let mut client = Client::new(disk.options(&temp.root, support::LONG_DELAY));
    client.start(&temp);
    client.open(&temp.uri("inner/a.sigil"), 1, CLEAN);
    let before = disk.loads();
    let config = temp.uri("inner/.sigil/config.json");
    temp.write("inner/.sigil/config.json", "{");
    let out = client.watched(std::slice::from_ref(&config));
    assert_eq!(disk.loads() - before, 1, "one workspace was read again");
    let found = support::published_for(&out, &config).expect("published at the nested config");
    assert_eq!(found[0]["code"], "SIGIL_CONFIG_PARSE");
}

#[test]
fn a_created_config_above_an_open_file_moves_it_to_the_new_workspace() {
    let (_start, mut client) = started(&[("a.sigil", CLEAN)]);
    let free = Temp::new();
    free.write("contract.sigil", CLEAN);
    free.write("consumer.sigil", CONSUMER);
    let consumer = free.uri("consumer.sigil");
    client.open(&consumer, 1, CONSUMER);
    let position = at(CONSUMER, "Execution", 3);
    let before = client.request(
        "textDocument/hover",
        json!({"textDocument": {"uri": consumer}, "position": {"line": position.0, "character": position.1}}),
    );
    assert_eq!(before["result"], Value::Null);
    free.write(".sigil/config.json", &named_config("free", &[]));
    client.watched_kind(&[free.uri(".sigil/config.json")], 1);
    let found = hover(&mut client, &consumer, position);
    assert!(markdown(&found).contains("### Tag"), "{found}");
}

#[test]
fn a_config_created_and_deleted_under_a_loaded_workspace_moves_its_files() {
    let temp = Temp::new();
    temp.write(".sigil/config.json", &named_config("outer", &[]));
    temp.write("inner/a.sigil", support::BROKEN);
    let mut client = Client::at(&temp.root);
    let out = client.start(&temp);
    let file = temp.uri("inner/a.sigil");
    assert!(
        !support::published_for(&out, &file)
            .expect("published")
            .is_empty()
    );

    let config = temp.uri("inner/.sigil/config.json");
    temp.write("inner/.sigil/config.json", &named_config("inner", &[]));
    let out = client.watched_kind(std::slice::from_ref(&config), 1);
    assert_eq!(
        support::published_for(&out, &file),
        Some(Vec::new()),
        "the parent no longer reads the nested files"
    );
    let nested = support::published_for(&out, &config).expect("the nested config error");
    assert_eq!(codes(&nested), ["SIGIL_NESTED_CONFIG"]);

    temp.delete("inner/.sigil/config.json");
    let out = client.watched_kind(std::slice::from_ref(&config), 3);
    assert!(
        !support::published_for(&out, &file)
            .expect("published")
            .is_empty()
    );
    assert_eq!(support::published_for(&out, &config), Some(Vec::new()));
}

#[test]
fn a_nested_workspace_its_parent_does_not_exclude_reports_one_error_and_is_still_served() {
    let temp = Temp::new();
    temp.write(".sigil/config.json", &named_config("outer", &[]));
    temp.write("inner/.sigil/config.json", &named_config("inner", &[]));
    temp.write("inner/contract.sigil", CLEAN);
    temp.write("inner/consumer.sigil", CONSUMER);
    let mut client = Client::at(&temp.root);
    let started = client.start(&temp);
    let config = temp.uri("inner/.sigil/config.json");
    assert_eq!(
        codes(&support::published_for(&started, &config).expect("parent's error")),
        ["SIGIL_NESTED_CONFIG"]
    );
    let consumer = temp.uri("inner/consumer.sigil");
    let out = client.open(&consumer, 1, CONSUMER);
    let found = support::published_for(&out, &config).expect("published at the nested config");
    assert_eq!(codes(&found), ["SIGIL_NESTED_CONFIG"], "{found:?}");
    let hovered = hover(&mut client, &consumer, at(CONSUMER, "Execution", 3));
    assert!(markdown(&hovered).contains("### Tag"), "{hovered}");
}

#[test]
fn a_folder_without_a_config_keeps_its_error_and_serves_the_nested_workspace() {
    let temp = Temp::new();
    temp.write("a/.sigil/config.json", &named_config("a", &[]));
    temp.write("a/contract.sigil", CLEAN);
    temp.write("a/consumer.sigil", CONSUMER);
    let mut client = Client::at(&temp.root);
    let out = client.start(&temp);
    let missing = support::published_for(&out, &temp.uri(".sigil/config.json")).expect("published");
    assert_eq!(codes(&missing), ["SIGIL_CONFIG_NOT_FOUND"]);
    let consumer = temp.uri("a/consumer.sigil");
    client.open(&consumer, 1, CONSUMER);
    let found = hover(&mut client, &consumer, at(CONSUMER, "Execution", 3));
    assert!(markdown(&found).contains("### Tag"), "{found}");
}

#[test]
fn a_burst_of_edits_in_two_workspaces_reads_each_once() {
    use sigil_lsp::rpc::classify;
    let temp = enclosing(&[("a.sigil", CLEAN), ("inner/b.sigil", CLEAN)]);
    let disk = support::Disk::new();
    let mut client = Client::new(disk.options(&temp.root, support::LONG_DELAY));
    client.start(&temp);
    let before = disk.loads();
    let open = |uri: &str, version: i64, text: &str| {
        classify(support::message(
            "textDocument/didOpen",
            json!({"textDocument": {"uri": uri, "languageId": "sigil", "version": version, "text": text}}),
        ))
    };
    let outer = temp.uri("a.sigil");
    let inner = temp.uri("inner/b.sigil");
    client.server.handle_queued(open(&outer, 1, CLEAN));
    client.server.handle_queued(open(&inner, 1, CLEAN));
    client.server.handle_queued(open(&inner, 2, CONSUMER));
    assert_eq!(disk.loads(), before, "nothing is read while the queue runs");
    client.server.settle();
    assert_eq!(disk.loads() - before, 2, "each workspace is read once");
}

#[test]
fn a_change_to_a_nested_file_overtakes_a_request_queued_before_it() {
    use sigil_lsp::rpc::classify;
    let temp = enclosing(&[("inner/a.sigil", CLEAN)]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let uri = temp.uri("inner/a.sigil");
    client.open(&uri, 1, CLEAN);
    let change = classify(support::message(
        "textDocument/didChange",
        json!({"textDocument": {"uri": uri, "version": 2}, "contentChanges": [{"text": CONSUMER}]}),
    ));
    assert!(client.server.would_reload(&change));
}

// Which workspace owns a document (U3).

fn workspace_of(client: &mut Client, uri: &str) -> Value {
    let response = client.request(
        "sigil/documentWorkspace",
        json!({"textDocument": {"uri": uri}}),
    );
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}

#[test]
fn the_server_names_the_workspace_of_a_document_or_says_why_it_has_none() {
    let temp = Temp::new();
    temp.write(
        ".sigil/config.json",
        &named_config("outer", &["inner", "vendor"]),
    );
    temp.write("inner/.sigil/config.json", &named_config("inner", &[]));
    for path in ["a.sigil", "inner/b.sigil", "vendor/c.sigil"] {
        temp.write(path, CLEAN);
    }
    let mut client = Client::at(&temp.root);
    client.start(&temp);

    let root = workspace_of(&mut client, &temp.uri("a.sigil"));
    assert_eq!(root["state"], "workspace");
    assert_eq!(root["name"], "outer");
    assert_eq!(root["root"], temp.text());

    let nested = workspace_of(&mut client, &temp.uri("inner/b.sigil"));
    assert_eq!(nested["state"], "workspace");
    assert_eq!(nested["name"], "inner");
    assert_eq!(nested["root"], format!("{}/inner", temp.text()));

    let excluded = workspace_of(&mut client, &temp.uri("vendor/c.sigil"));
    assert_eq!(excluded["state"], "excluded");
    assert_eq!(excluded["name"], "outer");
    assert!(
        excluded["reason"]
            .as_str()
            .unwrap()
            .contains("files selection")
    );

    let free = Temp::new();
    free.write("d.sigil", CLEAN);
    let none = workspace_of(&mut client, &free.uri("d.sigil"));
    assert_eq!(none["state"], "none");
    assert!(
        none["reason"]
            .as_str()
            .unwrap()
            .contains(".sigil/config.json")
    );
    assert_eq!(
        client.server.held_workspaces().len(),
        1,
        "asking about a closed file holds nothing afterwards"
    );
}

#[test]
fn the_workspace_request_checks_its_params_and_waits_for_initialize() {
    let temp = enclosing(&[]);
    let mut client = Client::at(&temp.root);
    let early = client.request("sigil/documentWorkspace", json!({}));
    assert_eq!(early["error"]["code"], -32002, "{early}");
    client.start(&temp);
    let invalid = client.request("sigil/documentWorkspace", json!({}));
    assert_eq!(invalid["error"]["code"], -32602, "{invalid}");
    let other = client.request(
        "sigil/documentWorkspace",
        json!({"textDocument": {"uri": "untitled:one"}}),
    );
    assert_eq!(other["error"]["code"], -32603, "{other}");
}

#[test]
fn an_edit_to_the_enclosing_config_refreshes_a_held_nested_workspace() {
    let temp = Temp::new();
    temp.write(".sigil/config.json", &named_config("outer", &[]));
    temp.write("inner/.sigil/config.json", &named_config("inner", &[]));
    temp.write("inner/a.sigil", CLEAN);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let inner_config = temp.uri("inner/.sigil/config.json");
    let out = client.open(&temp.uri("inner/a.sigil"), 1, CLEAN);
    let found = support::published_for(&out, &inner_config).expect("the nested-config error");
    assert_eq!(codes(&found), ["SIGIL_NESTED_CONFIG"]);

    temp.write(".sigil/config.json", &named_config("outer", &["inner"]));
    let out = client.watched(&[temp.uri(".sigil/config.json")]);
    assert_eq!(
        support::published_for(&out, &inner_config),
        Some(Vec::new()),
        "excluding the nested workspace clears its error"
    );
}

#[test]
fn an_error_in_a_nested_file_is_published_once_when_the_parent_reads_it_too() {
    let single = workspace_with_broken();
    let mut one = Client::at(&single.root);
    one.start(&single);
    let uri = single.uri("b.sigil");
    let expected = support::published_for(&one.open(&uri, 1, support::BROKEN), &uri)
        .expect("published")
        .len();
    assert!(expected > 1, "the fixture has several errors");

    let temp = Temp::new();
    temp.write(".sigil/config.json", &named_config("outer", &[]));
    temp.write("inner/.sigil/config.json", &named_config("inner", &[]));
    temp.write("inner/b.sigil", support::BROKEN);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let nested = temp.uri("inner/b.sigil");
    let out = client.open(&nested, 1, support::BROKEN);
    let found = support::published_for(&out, &nested).expect("published");
    assert_eq!(found.len(), expected, "{found:?}");
}

fn workspace_with_broken() -> Temp {
    let temp = Temp::new();
    temp.write(".sigil/config.json", &named_config("single", &[]));
    temp.write("b.sigil", support::BROKEN);
    temp
}

#[test]
fn a_config_created_in_the_start_folder_does_not_leave_two_readings_of_it() {
    // The editor starts in `sub`, whose workspace is the enclosing one until
    // `sub` gets a config of its own.
    let temp = Temp::new();
    temp.write(".sigil/config.json", &named_config("outer", &[]));
    temp.write("sub/a.sigil", support::BROKEN);
    let mut client = Client::at(&temp.root);
    client.start_with(json!({"rootUri": temp.uri("sub")}));
    let uri = temp.uri("sub/a.sigil");
    let out = client.open(&uri, 1, CLEAN);
    assert_eq!(
        support::published_for(&out, &uri).unwrap_or_default().len(),
        0,
        "the unsaved fix hides the disk errors"
    );

    temp.write("sub/.sigil/config.json", &named_config("sub", &[]));
    let out = client.watched_kind(&[temp.uri("sub/.sigil/config.json")], 1);
    assert!(
        support::published_for(&out, &uri).is_none_or(|found| found.is_empty()),
        "no reading of the nested workspace may ignore the unsaved buffer: {:?}",
        support::published_for(&out, &uri)
    );
    let held = client.server.held_workspaces();
    let mut roots: Vec<&String> = held.iter().collect();
    roots.dedup();
    assert_eq!(roots.len(), held.len(), "{held:?}");
    let reading_sub = held
        .iter()
        .filter(|key| key.ends_with("/sub") || key.as_str() == format!("{}/sub", temp.text()))
        .count();
    assert_eq!(reading_sub, 1, "{held:?}");
}

// A nested workspace that fails to load, and what a change to its context files does.

/// Opens `inner/consumer.sigil` while the disk fails, so the nested workspace
/// is held without a reading. The outer workspace was read before.
fn failed_nested(delay: std::time::Duration) -> (Temp, support::Disk, Client, String) {
    let temp = enclosing(&[
        ("contract.sigil", CLEAN),
        ("consumer.sigil", CONSUMER),
        ("inner/contract.sigil", CLEAN),
        ("inner/consumer.sigil", CONSUMER),
    ]);
    let disk = support::Disk::new();
    let mut client = Client::new(disk.options(&temp.root, delay));
    client.start(&temp);
    disk.fail(support::ALWAYS);
    let inner = temp.uri("inner/consumer.sigil");
    let out = client.open(&inner, 1, CONSUMER);
    assert_eq!(out.last().unwrap()["method"], "window/showMessage");
    (temp, disk, client, inner)
}

fn hover_error(client: &mut Client, uri: &str) -> Value {
    client.request(
        "textDocument/hover",
        json!({"textDocument": {"uri": uri}, "position": {"line": 0, "character": 0}}),
    )
}

#[test]
fn a_failed_nested_workspace_is_retried_once_and_then_left_alone_inside_the_window() {
    let (temp, disk, mut client, inner) = failed_nested(support::LONG_DELAY);
    let loads = disk.loads();
    let first = hover_error(&mut client, &inner);
    assert_eq!(first["error"]["code"], -32603, "{first}");
    assert_eq!(disk.loads(), loads + 1, "the first request tries once more");

    // Inside the window not even a disk that works again is read.
    disk.fail(0);
    let second = hover_error(&mut client, &inner);
    assert_eq!(second["error"]["code"], -32603, "{second}");
    assert_eq!(disk.loads(), loads + 1);

    // The workspace that did load keeps answering, without a read.
    let outer = temp.uri("consumer.sigil");
    client.open(&outer, 1, CONSUMER);
    let before = disk.loads();
    let found = hover(&mut client, &outer, at(CONSUMER, "Execution", 3));
    assert!(markdown(&found).contains("### Tag"), "{found}");
    assert_eq!(disk.loads(), before);
}

#[test]
fn a_failed_nested_workspace_is_served_again_once_the_window_has_passed() {
    let (_temp, disk, mut client, inner) = failed_nested(support::SHORT_DELAY);
    assert_eq!(hover_error(&mut client, &inner)["error"]["code"], -32603);
    std::thread::sleep(support::SHORT_DELAY * 4);
    assert_eq!(hover_error(&mut client, &inner)["error"]["code"], -32603);

    disk.fail(0);
    std::thread::sleep(support::SHORT_DELAY * 4);
    let found = hover(&mut client, &inner, at(CONSUMER, "Execution", 3));
    assert!(
        markdown(&found).contains("### Tag"),
        "the nested workspace answers again: {found}"
    );
    assert_eq!(client.server.held_workspaces().len(), 2);
}

fn glossary(definition: &str) -> String {
    json!({
        "schemaVersion": 1,
        "terms": [{"term": "Execution", "definition": definition, "aliases": []}],
        "contexts": [],
    })
    .to_string()
}

#[test]
fn a_glossary_change_inside_a_nested_workspace_reads_only_that_workspace() {
    let temp = enclosing(&[("inner/a.sigil", CLEAN), ("b.sigil", CLEAN)]);
    temp.write("inner/.sigil/glossary.json", &glossary("First meaning."));
    let disk = support::Disk::new();
    let mut client = Client::new(disk.options(&temp.root, support::LONG_DELAY));
    client.start(&temp);
    let uri = temp.uri("inner/a.sigil");
    client.open(&uri, 1, CLEAN);
    let position = at(CLEAN, "Execution.", 0);
    let found = hover(&mut client, &uri, position);
    assert!(markdown(&found).contains("First meaning."), "{found}");

    temp.write("inner/.sigil/glossary.json", &glossary("Second meaning."));
    let before = disk.loads();
    client.watched(&[temp.uri("inner/.sigil/glossary.json")]);
    assert_eq!(disk.loads() - before, 1, "one workspace was read again");
    let found = hover(&mut client, &uri, position);
    assert!(markdown(&found).contains("Second meaning."), "{found}");
    assert!(!markdown(&found).contains("First meaning."), "{found}");
}

#[test]
fn a_local_override_change_inside_a_nested_workspace_reads_only_that_workspace() {
    let temp = enclosing(&[("inner/a.sigil", CLEAN), ("b.sigil", CLEAN)]);
    let disk = support::Disk::new();
    let mut client = Client::new(disk.options(&temp.root, support::LONG_DELAY));
    client.start(&temp);
    client.open(&temp.uri("inner/a.sigil"), 1, CLEAN);
    let before = disk.loads();
    client.watched(&[temp.uri("inner/.sigil/local.json")]);
    assert_eq!(disk.loads() - before, 1, "one workspace was read again");
}

// What a client is told, and how a path may be spelled.

#[test]
fn a_changed_workspace_config_is_followed_by_a_workspaces_changed_notification() {
    let temp = enclosing(&[("inner/a.sigil", CLEAN), ("b.sigil", CLEAN)]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    client.open(&temp.uri("inner/a.sigil"), 1, CLEAN);
    let told = |out: &[Value]| out.iter().any(|m| m["method"] == "sigil/workspacesChanged");

    temp.write("inner/.sigil/config.json", &named_config("renamed", &[]));
    let out = client.watched(&[temp.uri("inner/.sigil/config.json")]);
    assert!(told(&out), "{out:?}");
    let renamed = workspace_of(&mut client, &temp.uri("inner/a.sigil"));
    assert_eq!(renamed["name"], "renamed", "{renamed}");

    temp.write("inner/a.sigil", support::BROKEN);
    let out = client.watched(&[temp.uri("inner/a.sigil")]);
    assert!(
        !told(&out),
        "a source change leaves the workspaces as they were"
    );
}

#[test]
fn one_directory_spelled_with_dots_and_repeated_slashes_is_one_workspace() {
    let temp = enclosing(&[("inner/a.sigil", CLEAN), ("inner/b.sigil", CLEAN)]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let plain = temp.uri("inner/a.sigil");
    let spelled = temp
        .uri("inner/../inner/./b.sigil")
        .replace("/inner/", "//inner/");
    client.open(&plain, 1, CLEAN);
    client.open(&spelled, 1, CLEAN);
    assert_eq!(
        client.server.held_workspaces().len(),
        2,
        "the start workspace and one nested one: {:?}",
        client.server.held_workspaces()
    );
}
