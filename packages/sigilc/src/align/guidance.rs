//! Compiled code guidance, independent of the design guidance fingerprint.
use crate::sources::hash;
use std::path::{Path, PathBuf};

pub use crate::claims::guidance::Document;

pub const BUNDLE: &[Document] = &[
    Document {
        name: "rows.md",
        text: include_str!("guidance/rows.md"),
    },
    Document {
        name: "examples.md",
        text: include_str!("guidance/examples.md"),
    },
    Document {
        name: "rejected.md",
        text: include_str!("guidance/rejected.md"),
    },
];

// @sigil implements packages/sigilc/align.sigil::SigilImplementationClaims::CodeGuidance interface
pub fn fingerprint() -> String {
    hash(
        concat!(
            include_str!("guidance/rows.md"),
            include_str!("guidance/examples.md"),
            include_str!("guidance/rejected.md"),
            include_str!("vocabulary.rs"),
            include_str!("laws.egg")
        )
        .as_bytes(),
    )
}

pub fn extract(out: &Path, workspace_root: &Path) -> Result<Vec<PathBuf>, String> {
    crate::claims::guidance::extract_bundle(BUNDLE, out, workspace_root)
}
