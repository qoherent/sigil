//! Native reading of `.sigil` sources: text, workspace, parsing, and resolution.
pub mod config;
pub mod conventions;
pub mod data;
pub mod diagnostics;
pub mod discovery;
pub mod format;
pub mod fs;
pub mod glossary;
pub mod inline;
pub mod parse;
pub mod path;
pub mod position;
pub mod resolve;
pub mod tags;
pub mod text;
pub mod tools;
pub mod untagged;
pub mod width;
pub mod workspace;

/// The Sigil language version this reader supports.
pub const SIGIL_VERSION: &str = "0.9.0";

/// The version of this crate, which is not the Sigil language version.
pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");
