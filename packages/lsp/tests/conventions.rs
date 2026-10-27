#![cfg(unix)]
//! Workspace conventions in the server: a missing required label is published
//! as a warning on the group header, a saved `check.json` reloads its own
//! workspace only, and the parts the server never reads do not reload.
mod support;

use serde_json::{Value, json};
use support::{CONFIG, Client, Disk, LONG_DELAY, Temp, published_for, workspace_with};

const RULE: &str = r#"{"rules":[{"section":"decisions","require":["Decision:","Scope:"]}]}"#;
const CHECK: &str = ".sigil/conventions/check.json";

/// A decision group that carries `Decision:` but not `Scope:`.
const LACKS_SCOPE: &str = "component Feature {\n  goal {\n    Keep the record.\n  }\n\n  interface {\n    Record {\n      A Record is kept.\n    }\n  }\n\n  decisions {\n    Retention {\n      Decision: Keep audit data.\n    }\n  }\n}\n";

fn codes(diagnostics: &[Value]) -> Vec<&str> {
    diagnostics
        .iter()
        .map(|d| d["code"].as_str().unwrap())
        .collect()
}

fn reloads(disk: &Disk, client: &mut Client, uris: &[String]) -> usize {
    let before = disk.loads();
    client.watched(uris);
    disk.loads() - before
}

#[test]
fn a_missing_label_is_published_on_the_group_header() {
    let temp = workspace_with(&[("a.sigil", LACKS_SCOPE), (CHECK, RULE)]);
    let mut client = Client::at(&temp.root);
    let started = client.start(&temp);
    let uri = temp.uri("a.sigil");
    let out = client.open(&uri, 1, LACKS_SCOPE);
    for batch in [&started, &out] {
        let found = published_for(batch, &uri).expect("published for the document");
        assert_eq!(codes(&found), ["SIGIL_CONVENTION_MISSING_LABEL"]);
        assert_eq!(found[0]["severity"], 2);
        assert!(found[0]["message"].as_str().unwrap().contains("`Scope:`"));
        assert_eq!(
            found[0]["range"],
            json!({"start": {"line": 12, "character": 0}, "end": {"line": 13, "character": 0}}),
            "the header line of `Retention`"
        );
    }
}

#[test]
fn a_saved_check_file_republishes_and_a_part_the_server_never_reads_does_not() {
    let temp = workspace_with(&[("a.sigil", LACKS_SCOPE), (CHECK, RULE)]);
    let disk = Disk::new();
    let mut client = Client::new(disk.options(&temp.root, LONG_DELAY));
    client.start(&temp);
    let uri = temp.uri("a.sigil");
    client.open(&uri, 1, LACKS_SCOPE);

    temp.write(
        CHECK,
        r#"{"rules":[{"section":"decisions","require":["Decision:"]}]}"#,
    );
    let before = disk.loads();
    let out = client.watched(&[temp.uri(CHECK)]);
    assert_eq!(disk.loads() - before, 1, "one workspace was read again");
    assert_eq!(
        published_for(&out, &uri),
        Some(Vec::new()),
        "the satisfied rule clears the warning"
    );

    temp.write(CHECK, "{");
    let out = client.watched(&[temp.uri(CHECK)]);
    let found = published_for(&out, &temp.uri(CHECK)).expect("published at the check file");
    assert_eq!(codes(&found), ["SIGIL_CONVENTION_PARSE"]);

    for part in [".sigil/conventions/write.md", ".sigil/conventions/judge.md"] {
        assert_eq!(reloads(&disk, &mut client, &[temp.uri(part)]), 0, "{part}");
    }
}

/// An enclosing workspace with `check.json`, and a nested one without it.
fn enclosing_with_rule() -> Temp {
    let temp = Temp::new();
    temp.write(
        ".sigil/config.json",
        &CONFIG.replace(r#""exclude":[]"#, r#""exclude":["inner/**"]"#),
    );
    temp.write("inner/.sigil/config.json", CONFIG);
    temp.write(CHECK, RULE);
    temp.write("inner/a.sigil", LACKS_SCOPE);
    temp.write("b.sigil", LACKS_SCOPE);
    temp
}

#[test]
fn a_nested_workspace_does_not_inherit_the_enclosing_rules() {
    let temp = enclosing_with_rule();
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let inner = temp.uri("inner/a.sigil");
    let out = client.open(&inner, 1, LACKS_SCOPE);
    assert_eq!(published_for(&out, &inner), Some(Vec::new()));
    let outer = temp.uri("b.sigil");
    let out = client.open(&outer, 1, LACKS_SCOPE);
    let found = published_for(&out, &outer).expect("published for the enclosing file");
    assert_eq!(codes(&found), ["SIGIL_CONVENTION_MISSING_LABEL"]);
}

#[test]
fn a_check_file_reloads_its_own_workspace_and_not_the_one_beside_or_below_it() {
    let temp = enclosing_with_rule();
    let disk = Disk::new();
    let mut client = Client::new(disk.options(&temp.root, LONG_DELAY));
    client.start(&temp);
    client.open(&temp.uri("inner/a.sigil"), 1, LACKS_SCOPE);
    client.open(&temp.uri("b.sigil"), 1, LACKS_SCOPE);

    let outer = temp.uri(CHECK);
    assert_eq!(
        reloads(&disk, &mut client, &[outer]),
        1,
        "the enclosing only"
    );
    let inner = temp.uri(&format!("inner/{CHECK}"));
    assert_eq!(reloads(&disk, &mut client, &[inner]), 1, "the nested only");
}
