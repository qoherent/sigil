//! The language server as a synchronous state machine: one message in, the
//! messages to send out.
//!
//! The stdio loop runs it from one thread. `handle` applies a message
//! completely. For a burst of queued messages the loop calls `handle_queued`,
//! which only records a change that needs a reload, and then `settle` once,
//! which reads the workspace once.
use crate::{
    diagnostics, hover, navigation,
    params::{self, InvalidParams},
    render,
    rpc::{self, Id, Incoming},
    snapshot::Snapshot,
    symbols, tokens,
    uri::{UriError, file_uri_to_path},
    workspaces::{self, Workspaces},
};
use serde_json::{Value, json};
use sigil_core::language::{
    fs::{DiskFs, SourceFs},
    path::normalize_path,
    position::EditorPosition,
    workspace::CONFIG_PATH,
};
use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

/// Makes the file source of one load for the workspace root it found.
pub type FsFactory = Box<dyn Fn(&Path) -> Box<dyn SourceFs> + Send>;

/// How long a failed recovery blocks the next attempt.
pub const RELOAD_RETRY_DELAY: Duration = Duration::from_millis(1000);

/// The request that tells a client which workspace a document belongs to.
pub const DOCUMENT_WORKSPACE: &str = "sigil/documentWorkspace";
const NESTED_CONFIG: &str = "SIGIL_NESTED_CONFIG";
const WATCH_REQUEST_ID: &str = "sigil/watch/request";
const WATCH_REGISTRATION_ID: &str = "sigil/language-watch";
/// The notification that cancels a request, and the one that ends the server.
pub(crate) const CANCEL_REQUEST: &str = "$/cancelRequest";
pub(crate) const EXIT: &str = "exit";

pub struct ServerOptions {
    /// Where a workspace is looked for when the client names no root.
    pub cwd: PathBuf,
    /// A file source other than the disk, for tests that make reads fail.
    pub fs: Option<FsFactory>,
    /// How long a failed recovery blocks the next one.
    pub retry_delay: Duration,
}

impl Default for ServerOptions {
    fn default() -> Self {
        Self {
            cwd: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            fs: None,
            retry_delay: RELOAD_RETRY_DELAY,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Uninitialized,
    Running,
    ShutdownRequested,
    Exited,
}

/// Why a request failed after it was admitted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RequestError {
    InvalidParams(String),
    Internal(String),
}

impl From<InvalidParams> for RequestError {
    fn from(error: InvalidParams) -> Self {
        Self::InvalidParams(error.message().to_owned())
    }
}

impl From<UriError> for RequestError {
    fn from(error: UriError) -> Self {
        Self::Internal(error.message().to_owned())
    }
}

/// What hover and definition read from their params: the file's path and the
/// position, or none when the position cannot be an editor position.
pub(crate) fn position_request(
    params: &Value,
) -> Result<Option<(String, EditorPosition)>, RequestError> {
    let given = params::text_document_position(params)?;
    let path = file_uri_to_path(&given.uri)?;
    Ok(given.editor_position().map(|position| (path, position)))
}

/// What a request method answers with.
pub type Answer = Result<Value, RequestError>;

/// A change that a notification makes to the server's state. It borrows the
/// document text from the message, so planning a change copies none.
enum Change<'a> {
    /// A buffer opened, or replaced by an edit.
    Set {
        path: String,
        uri: &'a str,
        version: f64,
        text: &'a str,
    },
    Close {
        path: String,
        uri: String,
    },
    /// Watched files that matter, with their change kind (1 created, 2
    /// changed, 3 deleted).
    Watch(Vec<(String, u8)>),
}

/// An open buffer.
struct OpenDocument {
    uri: String,
    version: f64,
    text: String,
}

pub struct Server {
    cwd: PathBuf,
    fs: Option<FsFactory>,
    retry_delay: Duration,
    state: State,
    supports_watch_registration: bool,
    watch_requested: bool,
    /// Open buffers by absolute path.
    open: BTreeMap<String, OpenDocument>,
    published: BTreeSet<String>,
    cancelled: HashSet<Id>,
    /// The workspace the editor started in, and the nested ones with an open
    /// file.
    workspaces: Workspaces,
    generation: u64,
    /// A change is recorded and the workspaces it touched wait in `dirty`.
    reload_pending: bool,
    dirty: BTreeSet<String>,
    /// A config appeared or went away, so which workspace owns a file may have
    /// changed for any of them.
    dirty_all: bool,
    closed_uris: BTreeSet<String>,
    exit_code: Option<i32>,
}

impl Server {
    pub fn new(options: ServerOptions) -> Self {
        let workspaces = Workspaces::new(&options.cwd);
        Self {
            cwd: options.cwd,
            fs: options.fs,
            retry_delay: options.retry_delay,
            state: State::Uninitialized,
            supports_watch_registration: false,
            watch_requested: false,
            open: BTreeMap::new(),
            published: BTreeSet::new(),
            cancelled: HashSet::new(),
            workspaces,
            generation: 0,
            reload_pending: false,
            dirty: BTreeSet::new(),
            dirty_all: false,
            closed_uris: BTreeSet::new(),
            exit_code: None,
        }
    }

    pub fn state(&self) -> State {
        self.state
    }

    /// 0 after `exit` that follows `shutdown`, 1 after `exit` without it.
    pub fn exit_code(&self) -> Option<i32> {
        self.exit_code
    }

    /// Grows on every change of what the server holds: a buffer, a reload.
    /// Tests read it to tell that a message changed nothing or read nothing.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// The current reading of the workspace the editor started in, none while
    /// a failed load has not recovered.
    pub fn snapshot(&self) -> Option<&Snapshot> {
        self.workspaces.start()?.snapshot.as_ref()
    }

    /// The keys of the workspaces held now, the start workspace first.
    pub fn held_workspaces(&self) -> Vec<String> {
        let start = self.workspaces.start_key().to_owned();
        let others: Vec<String> = self
            .workspaces
            .keys()
            .filter(|key| **key != start)
            .cloned()
            .collect();
        std::iter::once(start).chain(others).collect()
    }

    /// Whether a change recorded by `handle_queued` still awaits `settle`.
    /// Tests read it to check that edits are recorded without a reload.
    pub fn reload_pending(&self) -> bool {
        self.reload_pending
    }

    /// Cancel the request that has this id and has not been answered yet. The
    /// mark is spent when a request with that id arrives.
    pub fn cancel(&mut self, id: &Id) {
        self.cancelled.insert(id.clone());
    }

    /// Whether `message` would change the workspace and start a reload: a
    /// document message the server would act on, or a watched-file event for a
    /// `.sigil` file, the config, the glossary or the local override. Judged
    /// against the state now, not the state after earlier queued messages.
    pub fn would_reload(&self, message: &Incoming) -> bool {
        match message {
            Incoming::Notification { method, params } => self.plan(method, params).is_some(),
            _ => false,
        }
    }

    /// Apply a message that is queued with others: a change that needs a
    /// reload is only recorded, until `settle` reads the workspace once, and
    /// anything else is handled as `handle` does. The state judged is the
    /// state now.
    pub fn handle_queued(&mut self, message: Incoming) -> Vec<Value> {
        if let Incoming::Notification { method, params } = &message
            && let Some(change) = self.plan(method, params)
        {
            self.apply(change);
            return Vec::new();
        }
        self.handle(message)
    }

    /// Apply one message and return what to send, in order.
    pub fn handle(&mut self, message: Incoming) -> Vec<Value> {
        match message {
            Incoming::Response { .. } => Vec::new(),
            Incoming::Invalid => vec![rpc::invalid_request()],
            Incoming::Request { method, params, .. }
            | Incoming::Notification { method, params }
                if method == CANCEL_REQUEST || method == EXIT =>
            {
                self.control(&method, &params);
                Vec::new()
            }
            Incoming::Request { id, method, params } => self.request(&id, &method, &params),
            Incoming::Notification { method, params } => {
                let mut out = self.notification(&method, &params);
                out.extend(self.settle());
                out
            }
        }
    }

    /// Read the workspace once when a change is waiting, and return the
    /// diagnostics it published, or the failure messages.
    pub fn settle(&mut self) -> Vec<Value> {
        if !self.reload_pending {
            return Vec::new();
        }
        self.reload_pending = false;
        let extra: Vec<String> = std::mem::take(&mut self.closed_uris).into_iter().collect();
        let failures = self.refresh();
        if failures.is_empty() {
            self.diagnostic_notifications(&extra)
        } else {
            self.load_failure_notifications(&failures)
        }
    }

    fn control(&mut self, method: &str, params: &Value) {
        if method == EXIT {
            self.exit_code = Some(if self.state == State::ShutdownRequested {
                0
            } else {
                1
            });
            self.state = State::Exited;
        } else if let Some(id) = params::cancellation_id(params) {
            self.cancel(&id);
        }
    }

    fn request(&mut self, id: &Id, method: &str, params: &Value) -> Vec<Value> {
        let failure = |code, message: &str| vec![rpc::failure(Some(id), code, message)];
        if self.cancelled.remove(id) {
            return failure(rpc::REQUEST_CANCELLED, "Request cancelled.");
        }
        if self.state == State::Uninitialized && method != "initialize" {
            return failure(rpc::SERVER_NOT_INITIALIZED, "Server is not initialized.");
        }
        if matches!(self.state, State::ShutdownRequested | State::Exited) {
            return failure(rpc::INVALID_REQUEST, "Server is shutting down.");
        }
        let mut out = self.settle();
        let key = self.route(params);
        if uses_workspace(method)
            && let Err(cause) = self.recover(&key)
        {
            out.extend(failure(
                rpc::INTERNAL_ERROR,
                &format!("Unable to load workspace: {cause}"),
            ));
            self.release_unneeded();
            return out;
        }
        let answer = self.dispatch(method, params, &key);
        self.release_unneeded();
        out.push(match answer {
            None => rpc::failure(
                Some(id),
                rpc::METHOD_NOT_FOUND,
                &format!("Method not found: {method}"),
            ),
            Some(Ok(result)) => rpc::success(id, result),
            Some(Err(RequestError::InvalidParams(message))) => {
                rpc::failure(Some(id), rpc::INVALID_PARAMS, &message)
            }
            Some(Err(RequestError::Internal(message))) => {
                rpc::failure(Some(id), rpc::INTERNAL_ERROR, &message)
            }
        });
        out
    }

    /// The request methods. A method that reads the workspace takes the
    /// snapshot, which recovery has made present.
    fn dispatch(&mut self, method: &str, params: &Value, key: &str) -> Option<Answer> {
        match method {
            "initialize" => Some(self.initialize(params)),
            "shutdown" => {
                self.state = State::ShutdownRequested;
                Some(Ok(Value::Null))
            }
            DOCUMENT_WORKSPACE => Some(self.document_workspace(params)),
            _ => {
                let snapshot = self.workspaces.get(key)?.snapshot.as_ref()?;
                workspace_method(snapshot, method, params)
            }
        }
    }

    fn initialize(&mut self, params: &Value) -> Answer {
        if self.state != State::Uninitialized {
            return Err(RequestError::InvalidParams(
                "initialize may only be sent once.".to_owned(),
            ));
        }
        let given = params::initialize(params)?;
        let start = match given.start_uri() {
            Some(uri) => PathBuf::from(file_uri_to_path(uri)?),
            None => self.cwd.clone(),
        };
        self.supports_watch_registration = given.supports_watch_registration();
        self.workspaces = Workspaces::new(&start);
        let start = self.workspaces.start_key().to_owned();
        self.reload_entry(&start, false)
            .map_err(RequestError::Internal)?;
        self.state = State::Running;
        Ok(json!({
            "capabilities": {
                "positionEncoding": "utf-16",
                "textDocumentSync": {"openClose": true, "change": 1},
                "definitionProvider": true,
                "documentSymbolProvider": true,
                "hoverProvider": true,
                "semanticTokensProvider": {
                    "legend": {"tokenTypes": tokens::LEGEND, "tokenModifiers": []},
                    "full": true,
                },
                "executeCommandProvider": {"commands": [render::RENDER_DOCUMENT_COMMAND]},
            },
            "serverInfo": {"name": "sigil-lsp", "version": env!("CARGO_PKG_VERSION")},
        }))
    }

    fn notification(&mut self, method: &str, params: &Value) -> Vec<Value> {
        if self.state != State::Running {
            return Vec::new();
        }
        if method == "initialized" {
            let mut out = self.diagnostic_notifications(&[]);
            out.extend(self.watch_registration());
            return out;
        }
        if let Some(change) = self.plan(method, params) {
            self.apply(change);
            return self.settle();
        }
        Vec::new()
    }

    /// What a notification would change, or none when the server ignores it:
    /// parameters that do not check, a change for a document that is not open
    /// or whose version is not newer, a URI that is not a file, a watched file
    /// that does not matter.
    fn plan<'a>(&self, method: &str, params: &'a Value) -> Option<Change<'a>> {
        if self.state != State::Running {
            return None;
        }
        match method {
            "textDocument/didOpen" => {
                let given = params::did_open(params).ok()?;
                let path = file_uri_to_path(given.uri).ok()?;
                Some(Change::Set {
                    path,
                    uri: given.uri,
                    version: given.version,
                    text: given.text,
                })
            }
            "textDocument/didChange" => {
                let given = params::did_change(params).ok()?;
                let path = file_uri_to_path(given.uri).ok()?;
                let current = self.open.get(&path)?;
                if given.version <= current.version {
                    return None;
                }
                let text = *given.texts.last()?;
                Some(Change::Set {
                    path,
                    uri: given.uri,
                    version: given.version,
                    text,
                })
            }
            "textDocument/didClose" => {
                let given = params::did_close(params).ok()?;
                let path = file_uri_to_path(&given.uri).ok()?;
                Some(Change::Close {
                    path,
                    uri: given.uri,
                })
            }
            "workspace/didChangeWatchedFiles" => {
                let given = params::did_change_watched_files(params).ok()?;
                let changed: Vec<(String, u8)> = given
                    .changes
                    .iter()
                    .map(|change| Ok((file_uri_to_path(&change.uri)?, change.kind)))
                    .collect::<Result<_, UriError>>()
                    .ok()?;
                let relevant: Vec<(String, u8)> = changed
                    .into_iter()
                    .filter(|(path, _)| triggers_reload(path))
                    .collect();
                (!relevant.is_empty()).then_some(Change::Watch(relevant))
            }
            _ => None,
        }
    }

    fn apply(&mut self, change: Change<'_>) {
        self.generation += 1;
        self.reload_pending = true;
        match change {
            Change::Set {
                path,
                uri,
                version,
                text,
            } => {
                let key = self.key_for_path(&path);
                self.dirty.insert(key);
                self.open.insert(
                    path,
                    OpenDocument {
                        uri: uri.to_owned(),
                        version,
                        text: text.to_owned(),
                    },
                );
            }
            Change::Close { path, uri } => {
                let key = self.key_for_path(&path);
                self.dirty.insert(key);
                self.open.remove(&path);
                self.closed_uris.insert(uri);
            }
            Change::Watch(changed) => {
                for (path, kind) in changed {
                    let is_config = normalize_path(&path).ends_with(&format!("/{CONFIG_PATH}"));
                    if is_config && kind != 2 {
                        self.dirty_all = true;
                        continue;
                    }
                    let owner = self.key_for_path(&path);
                    self.dirty.insert(owner);
                    // A config, glossary or local override belongs to its own
                    // directory even when that directory is no workspace root
                    // yet. A config also decides the nested-config error that
                    // every workspace below it reports.
                    if let Some(root) = workspaces::context_root(&path) {
                        if is_config {
                            let below = format!("{root}/");
                            let held: Vec<String> = self
                                .workspaces
                                .keys()
                                .filter(|key| key.starts_with(&below))
                                .cloned()
                                .collect();
                            self.dirty.extend(held);
                        }
                        self.dirty.insert(root);
                    }
                }
            }
        }
    }

    /// The key of the workspace that serves a file: the one that owns it, or
    /// the start workspace when no config sits above it.
    fn key_for_path(&self, path: &str) -> String {
        workspaces::owner_key(path).unwrap_or_else(|| self.workspaces.start_key().to_owned())
    }

    /// The key of the workspace a request is about: the owner of the document
    /// it names, or the start workspace.
    fn route(&self, params: &Value) -> String {
        match document_path(params) {
            Some(path) => self.key_for_path(&path),
            None => self.workspaces.start_key().to_owned(),
        }
    }

    /// The keys of the workspaces that own an open buffer.
    fn owners_of_open(&self) -> BTreeSet<String> {
        self.open
            .keys()
            .filter_map(|path| workspaces::owner_key(path))
            .collect()
    }

    /// Release the nested workspaces that no open buffer needs.
    fn release_unneeded(&mut self) {
        if self.workspaces.len() == 1 {
            return;
        }
        let needed = self.owners_of_open();
        self.workspaces.retain(|key| needed.contains(key));
    }

    /// Hold the workspace of each open buffer, release the ones no buffer
    /// needs, and read every workspace that a change touched. The causes of
    /// the reads that failed.
    fn refresh(&mut self) -> Vec<String> {
        let everything = std::mem::take(&mut self.dirty_all);
        if everything {
            self.workspaces.rekey_start();
        }
        let needed = self.owners_of_open();
        for key in &needed {
            if self.workspaces.ensure(key) {
                self.dirty.insert(key.clone());
            }
        }
        self.workspaces.retain(|key| needed.contains(key));
        let dirty = std::mem::take(&mut self.dirty);
        let keys: Vec<String> = if everything {
            self.workspaces.keys().cloned().collect()
        } else {
            self.workspaces
                .keys()
                .filter(|key| dirty.contains(*key))
                .cloned()
                .collect()
        };
        let mut failures = Vec::new();
        for key in keys {
            if let Err(cause) = self.reload_entry(&key, false) {
                failures.push(cause);
            }
        }
        failures
    }

    /// Read one workspace again. A failure drops its snapshot; `recovery` says
    /// this read retries after an earlier failure, which blocks the next retry
    /// for the delay.
    fn reload_entry(&mut self, key: &str, recovery: bool) -> Result<(), String> {
        self.generation += 1;
        let Some(entry) = self.workspaces.get(key) else {
            return Ok(());
        };
        let start = entry.start.clone();
        let loaded = {
            let make = |root: &Path| -> Box<dyn SourceFs> {
                match &self.fs {
                    Some(factory) => factory(root),
                    None => Box::new(DiskFs::new(root)),
                }
            };
            let buffers = self
                .open
                .iter()
                .filter(|(path, _)| self.key_for_path(path) == key)
                .map(|(path, document)| (path.as_str(), document.text.as_str()));
            Snapshot::load(&start, buffers, &make)
        };
        let retry_delay = self.retry_delay;
        let Some(entry) = self.workspaces.get_mut(key) else {
            return Ok(());
        };
        match loaded {
            Ok(snapshot) => {
                entry.snapshot = Some(snapshot);
                entry.load_failure = None;
                entry.retry_after = None;
                Ok(())
            }
            Err(error) => {
                let cause = error.to_string();
                entry.snapshot = None;
                entry.load_failure = Some(cause.clone());
                entry.retry_after = recovery.then(|| Instant::now() + retry_delay);
                Err(cause)
            }
        }
    }

    /// Make a workspace's snapshot present before a request that reads it.
    /// After a failed load the next request tries once more, unless the last
    /// retry failed less than the delay ago.
    fn recover(&mut self, key: &str) -> Result<(), String> {
        self.workspaces.ensure(key);
        let Some(entry) = self.workspaces.get(key) else {
            return Ok(());
        };
        if entry.snapshot.is_some() {
            return Ok(());
        }
        if entry.retry_after.is_some_and(|at| Instant::now() < at) {
            return Err(entry.load_failure.clone().unwrap_or_default());
        }
        self.reload_entry(key, true)
    }

    /// Which workspace a document belongs to, or why none holds it.
    fn document_workspace(&self, params: &Value) -> Answer {
        let given = params::document_workspace(params)?;
        let path = file_uri_to_path(&given.uri)?;
        let Some(owner) = workspaces::owner_key(&path) else {
            return Ok(json!({
                "state": "none",
                "reason": "No .sigil/config.json was found above this file.",
            }));
        };
        let Some(snapshot) = self
            .workspaces
            .get(&owner)
            .and_then(|entry| entry.snapshot.as_ref())
        else {
            return Err(RequestError::Internal(format!(
                "Unable to load workspace: {owner}"
            )));
        };
        let name = snapshot
            .workspace
            .config
            .as_ref()
            .map(|config| config.workspace_name.clone())
            .unwrap_or_else(|| owner.rsplit('/').next().unwrap_or(&owner).to_owned());
        if snapshot.file_index(&path).is_some() {
            Ok(json!({"state": "workspace", "name": name, "root": owner}))
        } else {
            Ok(json!({
                "state": "excluded",
                "name": name,
                "root": owner,
                "reason": "The files selection of this workspace leaves this file out.",
            }))
        }
    }

    fn load_failure_notifications(&mut self, causes: &[String]) -> Vec<Value> {
        let mut out = self.diagnostic_notifications(&[]);
        for cause in causes {
            out.push(rpc::notification(
                "window/showMessage",
                json!({"type": 1, "message": format!("Unable to load Sigil workspace: {cause}")}),
            ));
        }
        out
    }

    /// One `client/registerCapability` request for every file, sent once and
    /// only to a client that accepts dynamic registration. The reply is not
    /// waited for.
    fn watch_registration(&mut self) -> Vec<Value> {
        if !self.supports_watch_registration || self.watch_requested {
            return Vec::new();
        }
        self.watch_requested = true;
        vec![rpc::request(
            &Id::String(WATCH_REQUEST_ID.to_owned()),
            "client/registerCapability",
            json!({"registrations": [{
                "id": WATCH_REGISTRATION_ID,
                "method": "workspace/didChangeWatchedFiles",
                "registerOptions": {"watchers": [{"globPattern": "**/*", "kind": 7}]},
            }]}),
        )]
    }

    /// The diagnostics of every held workspace, grouped by URI. A URI keeps
    /// one nested-config error, the one of the nested workspace's own reading,
    /// and no other entry twice.
    fn grouped_diagnostics(&self) -> BTreeMap<String, Vec<Value>> {
        let mut keys: Vec<&String> = self.workspaces.snapshots().map(|(key, _)| key).collect();
        keys.sort_by_key(|key| std::cmp::Reverse(key.matches('/').count()));
        let mut grouped: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        for key in keys {
            let Some(entry) = self.workspaces.get(key) else {
                continue;
            };
            let Some(snapshot) = entry.snapshot.as_ref() else {
                continue;
            };
            for (uri, found) in diagnostics::by_uri(snapshot) {
                let target = grouped.entry(uri).or_default();
                for item in found {
                    let nested = item["code"] == NESTED_CONFIG;
                    let repeats = target
                        .iter()
                        .any(|seen| *seen == item || (nested && seen["code"] == NESTED_CONFIG));
                    if !repeats {
                        target.push(item);
                    }
                }
            }
        }
        grouped
    }

    /// Publish the diagnostics of every workspace for every file that has some, and an
    /// empty list for each file that had some, each open buffer and each URI
    /// in `extra`, in URI order.
    fn diagnostic_notifications(&mut self, extra: &[String]) -> Vec<Value> {
        let mut grouped = self.grouped_diagnostics();
        let mut uris: BTreeSet<String> = grouped.keys().cloned().collect();
        uris.extend(self.open.values().map(|document| document.uri.clone()));
        uris.extend(extra.iter().cloned());
        uris.extend(self.published.iter().cloned());
        let mut sorted: Vec<String> = uris.into_iter().collect();
        sorted.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        let mut out = Vec::new();
        for uri in sorted {
            let found = grouped.remove(&uri).unwrap_or_default();
            if found.is_empty() {
                self.published.remove(&uri);
            } else {
                self.published.insert(uri.clone());
            }
            out.push(rpc::notification(
                "textDocument/publishDiagnostics",
                json!({"uri": uri, "diagnostics": found}),
            ));
        }
        out
    }
}

/// Whether a request method reads the workspace, so the server must have one.
pub fn uses_workspace(method: &str) -> bool {
    method != "initialize" && method != "shutdown"
}

/// The methods that read a snapshot. A feature module adds its arm here.
fn workspace_method(snapshot: &Snapshot, method: &str, params: &Value) -> Option<Answer> {
    match method {
        "textDocument/definition" => Some(navigation::definition(snapshot, params)),
        "textDocument/documentSymbol" => Some(symbols::document_symbols(snapshot, params)),
        "textDocument/semanticTokens/full" => Some(tokens::semantic_tokens(snapshot, params)),
        "textDocument/hover" => Some(hover::hover(snapshot, params)),
        "workspace/executeCommand" => Some(render::execute_command(snapshot, params)),
        _ => None,
    }
}

/// Whether a changed path reloads a workspace: a `.sigil` source, or the
/// config, glossary or local override under `.sigil/`.
fn triggers_reload(path: &str) -> bool {
    normalize_path(path).ends_with(".sigil") || workspaces::context_root(path).is_some()
}

/// The path of the document a request names: its `textDocument` URI, or the
/// first argument of a command.
fn document_path(params: &Value) -> Option<String> {
    let uri = params
        .get("textDocument")
        .and_then(|document| document.get("uri"))
        .or_else(|| params.get("arguments")?.get(0))?
        .as_str()?;
    file_uri_to_path(uri).ok()
}
