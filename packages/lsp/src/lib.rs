//! The Sigil language server: protocol framing, parameter checks, file URIs,
//! the server that reads a workspace and publishes its diagnostics, and the
//! stdio loop that runs it.
pub mod diagnostics;
pub mod hover;
pub mod navigation;
pub mod occurrences;
pub mod params;
pub mod position;
pub mod render;
pub mod rpc;
pub mod serve;
pub mod server;
pub mod snapshot;
pub mod symbols;
pub mod tokens;
pub mod uri;
pub mod workspaces;

pub use serve::{IO_FAILURE, serve};
