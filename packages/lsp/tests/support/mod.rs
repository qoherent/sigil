#![allow(dead_code)]
//! Shared test support: temporary workspaces, a client that drives the server
//! directly, and the replay of the sessions recorded from the TypeScript server.
use serde_json::{Value, json};
use sigil_core::language::fs::{DiskFs, SourceFs};
use sigil_lsp::{
    rpc::{self, Framer, Id, Item, classify, encode},
    server::{Server, ServerOptions},
    uri::path_to_file_uri,
};
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

pub const CONFIG: &str = r#"{"sigilVersion":"0.9.0","workspace":{"name":"test","members":[]},"files":{"include":["**/*.sigil"],"exclude":[]},"tools":{}}"#;

/// A component with an unknown section and no goal or interface: three errors.
pub const BROKEN: &str = "component Thing {\n  mystery {\n    broken\n  }\n}\n";

/// A provider that defines no Tag named Execution.
pub const PROVIDER_WITHOUT_TAG: &str = "component Thing {\n  goal {\n    Represent one useful Other.\n  }\n\n  interface {\n    Other {\n      run() starts an Other.\n    }\n  }\n}\n";

/// A consumer that imports the Tag Execution from `contract.sigil`.
pub const CONSUMER: &str = "@contract.sigil from Thing import { Execution }\n\ncomponent Consumer {\n  goal {\n    Consume the provider contract for Execution.\n  }\n\n  constraints {\n    Consumer retries preserve Execution.\n  }\n\n  interface {\n    ConsumerSurface {\n      run() uses Execution.\n\n      execution and ExecutionCache remain prose\n      beside Execution.\n    }\n  }\n}\n";

/// A valid provider of the Tag Execution.
pub const CLEAN: &str = "component Thing {\n  goal {\n    Represent one useful Execution.\n  }\n\n  cases {\n    Execution {\n      Running succeeds. Each Execution ends.\n    }\n  }\n\n  interface {\n    Execution {\n      run() starts an Execution.\n    }\n  }\n}\n";

/// A provider whose Tag has an inline definition and a later group heading.
pub const INLINE_PROVIDER: &str = "component Provider {\r\ngoal {\r\nOwn vocabulary.\r\n}\r\ninterface {\r\n😀 A *café results* carries a response.\r\n}\r\nconstraints {\r\ncafé results {\r\nPreserve exact content.\r\n}\r\n}\r\n}\r\n";

pub const MULTIWORD_CONSUMER: &str = "@provider.sigil from Provider import { café results }\ncomponent Consumer {\ngoal {\nServe the caller.\n}\ninterface {\n😀 Use café results now.\n\nRead [café results](./notes.md).\n```text\ncafé results\n```\n}\n}\n";

pub const BOOKING: &str = "component Booking {\n  goal {\n    A temporary reservation creates a hold.\n\n    Ignore `temporary reservation`.\n  }\n\n  interface {\n    BookingTerm {\n      The hold remains visible.\n    }\n  }\n}\n";

/// A temporary directory with a canonical path, removed when dropped.
pub struct Temp {
    pub root: PathBuf,
}

impl Temp {
    pub fn new() -> Self {
        Self::in_dir(&std::env::temp_dir())
    }

    /// A temporary directory below the build's scratch directory, which lies
    /// under the process's current directory when cargo runs the tests.
    pub fn below_cwd() -> Self {
        Self::in_dir(Path::new(env!("CARGO_TARGET_TMPDIR")))
    }

    fn in_dir(parent: &Path) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = parent.join(format!(
            "sigil-lsp-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self {
            root: path.canonicalize().unwrap(),
        }
    }

    /// A temporary workspace with a minimal config.
    pub fn workspace() -> Self {
        let temp = Self::new();
        temp.write(".sigil/config.json", CONFIG);
        temp
    }

    pub fn path(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }

    pub fn text(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    /// The `file:` URI of a path below the directory.
    pub fn uri(&self, relative: &str) -> String {
        path_to_file_uri(&self.path(relative).to_string_lossy())
    }

    pub fn write(&self, relative: &str, text: &str) {
        self.write_bytes(relative, text.as_bytes());
    }

    pub fn write_bytes(&self, relative: &str, bytes: &[u8]) {
        let path = self.path(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    pub fn delete(&self, relative: &str) {
        fs::remove_file(self.path(relative)).unwrap();
    }
}

impl Default for Temp {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// A server driven by hand, with the ids of its requests counted for it.
pub struct Client {
    pub server: Server,
    next_id: i64,
}

impl Client {
    pub fn new(options: ServerOptions) -> Self {
        Self {
            server: Server::new(options),
            next_id: 0,
        }
    }

    /// A server whose directory is `cwd`.
    pub fn at(cwd: &Path) -> Self {
        Self::new(ServerOptions {
            cwd: cwd.to_path_buf(),
            ..ServerOptions::default()
        })
    }

    /// Send one JSON message and return what the server sends back.
    pub fn send(&mut self, message: Value) -> Vec<Value> {
        self.server.handle(classify(message))
    }

    /// Send a request and return its response, which must be the last message.
    pub fn request(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        let id = self.next_id;
        let out = self.send(request(id, method, params));
        out.last().cloned().expect("a response")
    }

    pub fn notify(&mut self, method: &str, params: Value) -> Vec<Value> {
        self.send(message(method, params))
    }

    /// Initialize with `rootUri` set to the temp directory, then send `initialized`.
    /// Returns what `initialized` published.
    pub fn start(&mut self, temp: &Temp) -> Vec<Value> {
        self.start_with(json!({"rootUri": temp.uri("")}))
    }

    pub fn start_with(&mut self, params: Value) -> Vec<Value> {
        let response = self.request("initialize", params);
        assert!(response.get("result").is_some(), "initialize: {response}");
        self.notify("initialized", json!({}))
    }

    pub fn open(&mut self, uri: &str, version: i64, text: &str) -> Vec<Value> {
        self.notify(
            "textDocument/didOpen",
            json!({"textDocument": {"uri": uri, "languageId": "sigil", "version": version, "text": text}}),
        )
    }

    pub fn change(&mut self, uri: &str, version: i64, texts: &[&str]) -> Vec<Value> {
        let changes: Vec<Value> = texts.iter().map(|text| json!({"text": text})).collect();
        self.notify(
            "textDocument/didChange",
            json!({"textDocument": {"uri": uri, "version": version}, "contentChanges": changes}),
        )
    }

    pub fn close(&mut self, uri: &str) -> Vec<Value> {
        self.notify(
            "textDocument/didClose",
            json!({"textDocument": {"uri": uri}}),
        )
    }

    pub fn watched(&mut self, uris: &[String]) -> Vec<Value> {
        self.watched_kind(uris, 2)
    }

    /// Watched-file events of one kind: 1 created, 2 changed, 3 deleted.
    pub fn watched_kind(&mut self, uris: &[String], kind: u8) -> Vec<Value> {
        let changes: Vec<Value> = uris
            .iter()
            .map(|uri| json!({"uri": uri, "type": kind}))
            .collect();
        self.notify(
            "workspace/didChangeWatchedFiles",
            json!({"changes": changes}),
        )
    }
}

/// A temporary workspace with a minimal config and `files` written below it.
pub fn workspace_with(files: &[(&str, &str)]) -> Temp {
    let temp = Temp::workspace();
    for (path, text) in files {
        temp.write(path, text);
    }
    temp
}

/// `workspace_with(files)` and a client that has initialized on it.
pub fn started(files: &[(&str, &str)]) -> (Temp, Client) {
    let temp = workspace_with(files);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    (temp, client)
}

/// The (line, UTF-16 column) of the `nth` occurrence of `needle`, counting
/// CRLF, CR and LF as one line ending each.
pub fn at(text: &str, needle: &str, nth: usize) -> (u32, u32) {
    let offset = text
        .match_indices(needle)
        .nth(nth)
        .unwrap_or_else(|| panic!("{needle:?} #{nth} is not in the text"))
        .0;
    let (mut line, mut column) = (0, 0);
    let mut chars = text[..offset].chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' if chars.peek() == Some(&'\n') => {}
            '\r' | '\n' => (line, column) = (line + 1, 0),
            c => column += c.len_utf16() as u32,
        }
    }
    (line, column)
}

/// A notification as a client sends it.
pub fn message(method: &str, params: Value) -> Value {
    rpc::notification(method, params)
}

/// A request as a client sends it.
pub fn request(request_id: i64, method: &str, params: Value) -> Value {
    rpc::request(&id(request_id), method, params)
}

/// The frames of `messages`, one after the other.
pub fn frames(messages: &[Value]) -> Vec<u8> {
    messages.iter().flat_map(encode).collect()
}

/// Every message in the bytes. Anything that is not a whole frame of JSON, or
/// bytes between frames, fails the test.
pub fn decode(bytes: &[u8]) -> Vec<Value> {
    let values: Vec<Value> = Framer::new()
        .feed(bytes)
        .into_iter()
        .map(|item| match item {
            Item::Message(value) => value,
            Item::ParseError => panic!("the loop wrote something that is not a message"),
        })
        .collect();
    assert_eq!(
        bytes.len(),
        values
            .iter()
            .map(|value| encode(value).len())
            .sum::<usize>(),
        "bytes outside the frames"
    );
    values
}

/// A retry delay no test waits out.
pub const LONG_DELAY: Duration = Duration::from_secs(3600);

/// A retry delay a test can wait out.
pub const SHORT_DELAY: Duration = Duration::from_millis(30);

/// Marks a file source that fails every load until cleared.
pub const ALWAYS: usize = usize::MAX;

/// The control of a file source that counts loads and fails on demand.
#[derive(Clone, Default)]
pub struct Disk {
    loads: Arc<AtomicUsize>,
    failing: Arc<AtomicUsize>,
}

impl Disk {
    pub fn new() -> Self {
        Self::default()
    }

    /// How many loads began, whether or not they failed.
    pub fn loads(&self) -> usize {
        self.loads.load(Ordering::SeqCst)
    }

    /// Fail the next `count` loads (`ALWAYS` until cleared with 0).
    pub fn fail(&self, count: usize) {
        self.failing.store(count, Ordering::SeqCst);
    }

    /// Server options that read through this disk, from `cwd`.
    pub fn options(&self, cwd: &Path, retry_delay: Duration) -> ServerOptions {
        let disk = self.clone();
        ServerOptions {
            cwd: cwd.to_path_buf(),
            retry_delay,
            fs: Some(Box::new(move |root| {
                disk.loads.fetch_add(1, Ordering::SeqCst);
                let failing = disk.failing.load(Ordering::SeqCst);
                if failing != 0 && failing != ALWAYS {
                    disk.failing.store(failing - 1, Ordering::SeqCst);
                }
                if failing == 0 {
                    Box::new(DiskFs::new(root))
                } else {
                    Box::new(Unreadable)
                }
            })),
        }
    }
}

/// A file source whose every read fails.
pub struct Unreadable;

impl SourceFs for Unreadable {
    fn read(&self, _path: &str) -> io::Result<Option<Vec<u8>>> {
        Err(io::Error::other("disk unplugged"))
    }

    fn list_files(&self) -> io::Result<Vec<String>> {
        Err(io::Error::other("disk unplugged"))
    }
}

/// The `publishDiagnostics` notifications of a batch, as (uri, diagnostics).
pub fn published(out: &[Value]) -> Vec<(String, Vec<Value>)> {
    out.iter()
        .filter(|m| m["method"] == "textDocument/publishDiagnostics")
        .map(|m| {
            (
                m["params"]["uri"].as_str().unwrap().to_owned(),
                m["params"]["diagnostics"].as_array().unwrap().clone(),
            )
        })
        .collect()
}

/// The diagnostics published for one URI in a batch.
pub fn published_for(out: &[Value], uri: &str) -> Option<Vec<Value>> {
    published(out)
        .into_iter()
        .find(|(found, _)| found == uri)
        .map(|(_, diagnostics)| diagnostics)
}

pub fn id(value: i64) -> Id {
    Id::Number(value.into())
}

/// Messages of a batch that are requests or responses, not notifications.
pub fn responses(out: &[Value]) -> Vec<Value> {
    out.iter()
        .filter(|m| m.get("id").is_some())
        .cloned()
        .collect()
}

/// Replay of `tests/fixtures/lsp-parity.json`, the sessions recorded from the
/// TypeScript server.
pub mod replay {
    use super::{Temp, classify, path_to_file_uri};
    use serde::Deserialize;
    use serde_json::Value;
    use sigil_lsp::server::{Server, ServerOptions};
    use std::path::Path;

    /// How a diagnostic's message is worded differently by the Rust core.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Wording {
        /// The detail of a JSON parse error is the parser's own text: V8's in
        /// the recording, serde_json's here. The head up to `JSON:` (the
        /// message's code, file and subject) is still compared.
        JsonParseDetail,
        /// The TypeScript core words a path inside a message as an absolute
        /// path; the Rust core words it relative to the workspace. Only the
        /// root and its slash are dropped from the recorded message.
        AbsolutePathInMessage,
    }

    /// Recorded scenarios whose diagnostic messages the Rust core words
    /// differently, with the reason. Each scenario is still replayed in full:
    /// only the messages of its diagnostics are compared through `known_view`.
    /// Keep the list as short as it can be.
    pub const KNOWN_DIFFERENCES: &[(&str, Wording, &str)] = &[
        (
            "diagnostics-config-parse-failure",
            Wording::JsonParseDetail,
            "config.json that is not JSON: parser wording",
        ),
        (
            "watch-config-repaired",
            Wording::JsonParseDetail,
            "config.json that is not JSON: parser wording",
        ),
        (
            "glossary-parse-diagnostic",
            Wording::JsonParseDetail,
            "glossary.json that is not JSON: parser wording",
        ),
        (
            "bom-config-on-disk",
            Wording::JsonParseDetail,
            "config.json that starts with a byte-order mark: parser wording",
        ),
        (
            "bom-glossary-on-disk",
            Wording::JsonParseDetail,
            "glossary.json that starts with a byte-order mark: parser wording",
        ),
        (
            "diagnostics-invalid-character-in-buffer",
            Wording::AbsolutePathInMessage,
            "SIGIL_UNRESOLVED_IMPORTED_COMPONENT names its source by path",
        ),
    ];

    /// A diagnostic message as compared in a scenario with a known wording
    /// difference. Applied to both the recorded and the actual message.
    pub fn known_view(wording: Wording, message: &str, root: &str) -> String {
        match wording {
            Wording::JsonParseDetail => match message.find(" JSON:") {
                Some(at) => message[..at + " JSON:".len()].to_owned(),
                None => message.to_owned(),
            },
            Wording::AbsolutePathInMessage => {
                message.replace(&format!("Source {root}/"), "Source ")
            }
        }
    }

    /// Put the known wording view on the diagnostic messages of a
    /// `publishDiagnostics` notification.
    fn apply_known(scenario: &str, message: &mut Value, root: &str) {
        let Some((_, wording, _)) = KNOWN_DIFFERENCES
            .iter()
            .find(|(name, ..)| *name == scenario)
        else {
            return;
        };
        let Some(Value::Array(diagnostics)) = message.pointer_mut("/params/diagnostics") else {
            return;
        };
        for item in diagnostics {
            if let Some(text) = item["message"].as_str() {
                item["message"] = Value::String(known_view(*wording, text, root));
            }
        }
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Fixture {
        pub scenarios: Vec<Scenario>,
    }

    #[derive(Debug, Deserialize)]
    pub struct Scenario {
        pub name: String,
        pub feature: String,
        pub files: std::collections::BTreeMap<String, String>,
        pub steps: Vec<Step>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(tag = "kind", rename_all = "lowercase")]
    pub enum Step {
        #[serde(rename_all = "camelCase")]
        Send {
            message: Value,
            output: Vec<Value>,
            exit_code: Option<i32>,
        },
        Write {
            path: String,
            text: String,
        },
        Delete {
            path: String,
        },
    }

    pub fn load() -> Fixture {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/lsp-parity.json");
        let text = std::fs::read_to_string(path).expect("the recording is present");
        serde_json::from_str(&text).expect("the recording parses")
    }

    /// Put the temp directory where the recording says `<ROOT>`: percent-encoded
    /// inside a `file:` URI, raw everywhere else.
    pub fn substitute(value: &Value, root: &str) -> Value {
        match value {
            Value::String(text) => {
                let uri_root = path_to_file_uri(root);
                Value::String(
                    text.replace("file://<ROOT>", &uri_root)
                        .replace("<ROOT>", root),
                )
            }
            Value::Array(items) => {
                Value::Array(items.iter().map(|item| substitute(item, root)).collect())
            }
            Value::Object(map) => Value::Object(
                map.iter()
                    .map(|(key, item)| (key.clone(), substitute(item, root)))
                    .collect(),
            ),
            other => other.clone(),
        }
    }

    /// The version in `serverInfo` is the crate's own, not the recorded one.
    pub fn server_info_version(message: &mut Value) {
        if let Some(version) = message.pointer_mut("/result/serverInfo/version") {
            *version = Value::String(env!("CARGO_PKG_VERSION").to_owned());
        }
    }

    const RECORDED_WATCH_ID: &str = "sigil/ownership-watch/request";
    const WATCH_ID: &str = "sigil/watch/request";
    const WATCH_REGISTRATION: &str = "sigil/language-watch";

    /// The TypeScript server also registered a watcher for implementation
    /// sources, which the Rust server drops with ownership. Its request id is
    /// renamed, and only the registration for every file remains. The same id
    /// on the client's reply is renamed, so the reply answers the request.
    pub fn watch_registration(message: &mut Value) {
        if message["id"] == RECORDED_WATCH_ID {
            message["id"] = Value::String(WATCH_ID.to_owned());
        }
        if let Some(Value::Array(registrations)) = message.pointer_mut("/params/registrations") {
            registrations.retain(|entry| entry["id"] == WATCH_REGISTRATION);
        }
    }

    /// The TypeScript server publishes a glossary context overlap at
    /// `file:///contract.sigil`: it turns the workspace-relative path into a
    /// URI without the root. The Rust server publishes at the file's own URI.
    /// Only that scenario's publication is rewritten.
    pub fn rootless_overlap_uri(scenario: &str, message: &mut Value, root: &str) {
        if scenario != "glossary-context-overlap"
            || message["method"] != "textDocument/publishDiagnostics"
            || message["params"]["uri"] != "file:///contract.sigil"
        {
            return;
        }
        let uri = path_to_file_uri(&format!("{root}/contract.sigil"));
        message["params"]["uri"] = Value::String(uri);
    }

    /// The TypeScript server builds document symbols from the file's raw
    /// source, not the editor's view of it, so for a file on disk that starts
    /// with a byte-order mark it counts the mark on line 0: every line 0
    /// position of a symbol is one unit to the right of what the editor
    /// shows. The Rust server hides the mark in symbols too, as hover,
    /// definition and tokens do. The recorded line 0 characters of such a
    /// response move one unit left.
    pub fn symbols_without_disk_bom(scenario: &Scenario, request: &Value, response: &mut Value) {
        if request["method"] != "textDocument/documentSymbol" {
            return;
        }
        let uri = request["params"]["textDocument"]["uri"]
            .as_str()
            .unwrap_or_default();
        let on_disk_with_mark = scenario
            .files
            .iter()
            .any(|(path, text)| uri.ends_with(&format!("/{path}")) && text.starts_with('\u{feff}'));
        if on_disk_with_mark && let Some(Value::Array(symbols)) = response.get_mut("result") {
            symbols.iter_mut().for_each(unshift_line_zero);
        }
    }

    fn unshift_line_zero(symbol: &mut Value) {
        for key in ["range", "selectionRange"] {
            for end in ["start", "end"] {
                let point = &mut symbol[key][end];
                if point["line"] == 0
                    && let Some(character) = point["character"].as_u64()
                {
                    point["character"] = character.saturating_sub(1).into();
                }
            }
        }
        if let Some(Value::Array(children)) = symbol.get_mut("children") {
            children.iter_mut().for_each(unshift_line_zero);
        }
    }

    fn expected_output(scenario: &str, output: &[Value], root: &str) -> Vec<Value> {
        output
            .iter()
            .map(|message| {
                let mut message = substitute(message, root);
                server_info_version(&mut message);
                watch_registration(&mut message);
                rootless_overlap_uri(scenario, &mut message, root);
                message
            })
            .collect()
    }

    /// What a replay compared.
    #[derive(Debug, Default)]
    pub struct Tally {
        pub scenarios: usize,
        pub steps: usize,
        pub compared: usize,
        pub failures: Vec<String>,
    }

    /// Replay one scenario in a fresh temp directory and add its mismatches.
    pub fn replay(scenario: &Scenario, tally: &mut Tally) {
        tally.scenarios += 1;
        let temp = Temp::new();
        let root = temp.text();
        for (path, text) in &scenario.files {
            temp.write(path, text);
        }
        let mut server = Server::new(ServerOptions {
            cwd: temp.root.clone(),
            ..ServerOptions::default()
        });
        for (index, step) in scenario.steps.iter().enumerate() {
            tally.steps += 1;
            match step {
                Step::Write { path, text } => temp.write(path, text),
                Step::Delete { path } => temp.delete(path),
                Step::Send {
                    message,
                    output,
                    exit_code,
                } => {
                    tally.compared += 1;
                    let mut sent = substitute(message, &root);
                    watch_registration(&mut sent);
                    let mut actual = server.handle(classify(sent.clone()));
                    let mut expected = expected_output(&scenario.name, output, &root);
                    for message in &mut expected {
                        symbols_without_disk_bom(scenario, &sent, message);
                    }
                    for message in expected.iter_mut().chain(actual.iter_mut()) {
                        apply_known(&scenario.name, message, &root);
                    }
                    if actual != expected {
                        tally.failures.push(format!(
                            "{} step {index}\nsent:     {sent}\nexpected: {}\nactual:   {}",
                            scenario.name,
                            Value::Array(expected),
                            Value::Array(actual)
                        ));
                    } else if let Some(code) = exit_code
                        && server.exit_code() != Some(*code)
                    {
                        tally.failures.push(format!(
                            "{} step {index}: exit code {:?}, expected {code}",
                            scenario.name,
                            server.exit_code()
                        ));
                    }
                }
            }
        }
    }

    /// Replay every scenario whose feature is in `features`, or all of them
    /// when it is empty.
    pub fn replay_features(features: &[&str]) -> Tally {
        let fixture = load();
        let mut tally = Tally::default();
        for scenario in &fixture.scenarios {
            if features.is_empty() || features.contains(&scenario.feature.as_str()) {
                replay(scenario, &mut tally);
            }
        }
        tally
    }
}
