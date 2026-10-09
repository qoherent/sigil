//! Native reading of `.sigil` sources: text, workspace, parsing, and resolution.
pub mod config;
pub mod data;
pub mod diagnostics;
pub mod glossary;
pub mod inline;
pub mod parse;
pub mod path;
pub mod resolve;
pub mod tags;
pub mod text;
pub mod width;
pub mod workspace;

/// The Sigil language version this reader supports.
pub const SIGIL_VERSION: &str = "0.9.0";
