//! Parameter checks for the messages the server reads, with the TypeScript
//! server's error text.
use crate::rpc::Id;
use serde_json::{Map, Value};
use sigil_core::language::position::EditorPosition;
use std::fmt;

/// Parameters that failed a check; the message goes into an invalid-params reply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidParams(String);

impl InvalidParams {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }

    pub fn message(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for InvalidParams {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for InvalidParams {}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InitializeParams {
    pub root_uri: Option<String>,
    pub workspace_folders: Option<Vec<String>>,
    pub dynamic_registration: Option<bool>,
}

impl InitializeParams {
    /// The first workspace folder, else the root; `None` when absent or empty.
    pub fn start_uri(&self) -> Option<&str> {
        self.workspace_folders
            .as_ref()
            .and_then(|folders| folders.first())
            .map(String::as_str)
            .or(self.root_uri.as_deref())
            .filter(|uri| !uri.is_empty())
    }

    /// Whether the client accepts dynamic registration of file watchers.
    pub fn supports_watch_registration(&self) -> bool {
        self.dynamic_registration == Some(true)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextDocumentParams {
    pub uri: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileChange {
    pub uri: String,
    /// 1 created, 2 changed, 3 deleted.
    pub kind: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DidChangeWatchedFilesParams {
    pub changes: Vec<FileChange>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PositionParams {
    pub uri: String,
    pub line: u64,
    pub character: u64,
}

impl PositionParams {
    /// The position as an editor position, or none when a coordinate does not
    /// fit in 32 bits.
    pub fn editor_position(&self) -> Option<EditorPosition> {
        Some(EditorPosition {
            line: u32::try_from(self.line).ok()?,
            character: u32::try_from(self.character).ok()?,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExecuteCommandParams {
    pub command: String,
    pub arguments: Option<Vec<Value>>,
}

/// The id a `$/cancelRequest` names, if it names one.
pub fn cancellation_id(params: &Value) -> Option<Id> {
    params.as_object()?.get("id").and_then(Id::from_value)
}

pub fn initialize(params: &Value) -> Result<InitializeParams, InvalidParams> {
    let value = optional_record(Some(params))?;
    let field = |name: &str| value.and_then(|map| map.get(name));
    let root_uri = match field("rootUri") {
        None | Some(Value::Null) => None,
        Some(Value::String(uri)) => Some(uri.clone()),
        Some(_) => {
            return Err(InvalidParams::new(
                "initialize rootUri must be a string or null.",
            ));
        }
    };
    let workspace_folders = match field("workspaceFolders") {
        None | Some(Value::Null) => None,
        Some(Value::Array(folders)) => Some(
            folders
                .iter()
                .map(|folder| {
                    folder
                        .get("uri")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                        .ok_or_else(|| InvalidParams::new("Each workspace folder requires a URI."))
                })
                .collect::<Result<Vec<_>, _>>()?,
        ),
        Some(_) => {
            return Err(InvalidParams::new(
                "initialize workspaceFolders must be an array or null.",
            ));
        }
    };
    let capabilities = optional_record(field("capabilities"))?;
    let workspace = optional_record(capabilities.and_then(|map| map.get("workspace")))?;
    let watched = optional_record(workspace.and_then(|map| map.get("didChangeWatchedFiles")))?;
    let dynamic_registration = match watched.and_then(|map| map.get("dynamicRegistration")) {
        None => None,
        Some(Value::Bool(flag)) => Some(*flag),
        Some(_) => {
            return Err(InvalidParams::new(
                "initialize watched-file dynamicRegistration must be a boolean.",
            ));
        }
    };
    Ok(InitializeParams {
        root_uri,
        workspace_folders,
        dynamic_registration,
    })
}

/// The checked `textDocument/didOpen` params, borrowed from the message so a
/// check copies no text.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DidOpenRef<'a> {
    pub uri: &'a str,
    pub version: f64,
    pub text: &'a str,
}

/// The checked `textDocument/didChange` params, borrowed from the message so a
/// check copies no text. `texts` are the full-text changes, in the order sent.
#[derive(Debug, Clone, PartialEq)]
pub struct DidChangeRef<'a> {
    pub uri: &'a str,
    pub version: f64,
    pub texts: Vec<&'a str>,
}

pub fn did_open(params: &Value) -> Result<DidOpenRef<'_>, InvalidParams> {
    let value = required_record(params, "didOpen params")?;
    let document = required_record(field(value, "textDocument"), "didOpen textDocument")?;
    match (
        document.get("uri"),
        document.get("version"),
        document.get("text"),
    ) {
        (Some(Value::String(uri)), Some(Value::Number(version)), Some(Value::String(text))) => {
            Ok(DidOpenRef {
                uri,
                version: version.as_f64().unwrap_or_default(),
                text,
            })
        }
        _ => Err(InvalidParams::new(
            "didOpen requires uri, version, and text.",
        )),
    }
}

pub fn did_change(params: &Value) -> Result<DidChangeRef<'_>, InvalidParams> {
    let value = required_record(params, "didChange params")?;
    let document = required_record(field(value, "textDocument"), "didChange textDocument")?;
    let wrong = || InvalidParams::new("didChange requires uri, version, and full text changes.");
    let (Some(Value::String(uri)), Some(Value::Number(version)), Some(Value::Array(changes))) = (
        document.get("uri"),
        document.get("version"),
        value.get("contentChanges"),
    ) else {
        return Err(wrong());
    };
    let texts = changes
        .iter()
        .map(|change| change.get("text").and_then(Value::as_str).ok_or_else(wrong))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(DidChangeRef {
        uri,
        version: version.as_f64().unwrap_or_default(),
        texts,
    })
}

pub fn did_close(params: &Value) -> Result<TextDocumentParams, InvalidParams> {
    document_only(params, "didClose params")
}

pub fn document_symbol(params: &Value) -> Result<TextDocumentParams, InvalidParams> {
    document_only(params, "documentSymbol params")
}

pub fn semantic_tokens(params: &Value) -> Result<TextDocumentParams, InvalidParams> {
    document_only(params, "semanticTokens params")
}

/// Params for the request that asks which workspace a document belongs to.
pub fn document_workspace(params: &Value) -> Result<TextDocumentParams, InvalidParams> {
    document_only(params, "documentWorkspace params")
}

pub fn did_change_watched_files(
    params: &Value,
) -> Result<DidChangeWatchedFilesParams, InvalidParams> {
    let value = required_record(params, "didChangeWatchedFiles params")?;
    let wrong =
        || InvalidParams::new("didChangeWatchedFiles requires URI and change type entries.");
    let Some(Value::Array(changes)) = value.get("changes") else {
        return Err(wrong());
    };
    let changes = changes
        .iter()
        .map(|change| {
            let uri = change
                .get("uri")
                .and_then(Value::as_str)
                .ok_or_else(wrong)?;
            let kind = match change.get("type").and_then(Value::as_f64) {
                Some(1.0) => 1,
                Some(2.0) => 2,
                Some(3.0) => 3,
                _ => return Err(wrong()),
            };
            Ok(FileChange {
                uri: uri.to_owned(),
                kind,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(DidChangeWatchedFilesParams { changes })
}

/// Params for hover and definition: a document and a zero-based position.
pub fn text_document_position(params: &Value) -> Result<PositionParams, InvalidParams> {
    let value = required_record(params, "text document position params")?;
    let position = required_record(field(value, "position"), "position")?;
    let (Some(line), Some(character)) = (
        position.get("line").and_then(non_negative_integer),
        position.get("character").and_then(non_negative_integer),
    ) else {
        return Err(InvalidParams::new(
            "Position requires non-negative line and character values.",
        ));
    };
    let document = text_document_identifier(field(value, "textDocument"))?;
    Ok(PositionParams {
        uri: document.uri,
        line,
        character,
    })
}

pub fn execute_command(params: &Value) -> Result<ExecuteCommandParams, InvalidParams> {
    let value = required_record(params, "executeCommand params")?;
    let Some(Value::String(command)) = value.get("command") else {
        return Err(InvalidParams::new(
            "executeCommand requires a command string.",
        ));
    };
    let arguments = match value.get("arguments") {
        None => None,
        Some(Value::Array(arguments)) => Some(arguments.clone()),
        Some(_) => {
            return Err(InvalidParams::new(
                "executeCommand arguments must be an array.",
            ));
        }
    };
    Ok(ExecuteCommandParams {
        command: command.clone(),
        arguments,
    })
}

fn document_only(params: &Value, label: &str) -> Result<TextDocumentParams, InvalidParams> {
    let value = required_record(params, label)?;
    text_document_identifier(field(value, "textDocument"))
}

fn text_document_identifier(value: &Value) -> Result<TextDocumentParams, InvalidParams> {
    let document = required_record(value, "textDocument")?;
    match document.get("uri") {
        Some(Value::String(uri)) => Ok(TextDocumentParams { uri: uri.clone() }),
        _ => Err(InvalidParams::new("textDocument requires a URI.")),
    }
}

fn field<'a>(map: &'a Map<String, Value>, name: &str) -> &'a Value {
    map.get(name).unwrap_or(&Value::Null)
}

fn required_record<'a>(
    value: &'a Value,
    label: &str,
) -> Result<&'a Map<String, Value>, InvalidParams> {
    value
        .as_object()
        .ok_or_else(|| InvalidParams::new(format!("{label} must be an object.")))
}

/// An absent or null value is an empty record.
fn optional_record(value: Option<&Value>) -> Result<Option<&Map<String, Value>>, InvalidParams> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => required_record(value, "params").map(Some),
    }
}

/// Whole numbers at or above zero; JSON `2.0` counts, as it does in JavaScript.
fn non_negative_integer(value: &Value) -> Option<u64> {
    let Value::Number(number) = value else {
        return None;
    };
    if let Some(whole) = number.as_u64() {
        return Some(whole);
    }
    let float = number.as_f64()?;
    (float.is_finite() && float.fract() == 0.0 && float >= 0.0).then_some(float as u64)
}
