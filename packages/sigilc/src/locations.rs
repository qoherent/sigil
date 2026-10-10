//! Editor coordinates over captured source bytes, independent of memo identities.
use crate::structure::{DesignInput, Range};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Location {
    pub side: String,
    pub source: String,
    pub coordinate_system: String,
    pub source_digest: String,
    pub range: Range,
}
// @sigil implements packages/sigilc/align.sigil::SigilImplementationClaims::LocatedFindings interface
impl Location {
    pub fn new(side: &str, source: &str, bytes: &[u8], range: Range) -> Self {
        Self {
            side: side.into(),
            source: source.into(),
            coordinate_system: "utf8-bytes".into(),
            source_digest: Sha256::digest(bytes)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect(),
            range,
        }
    }
    pub fn design(input: &DesignInput, facet: &str) -> Option<Self> {
        let u = input.units.iter().find(|u| u.id == facet)?;
        let s = input.sources.iter().find(|s| s.path == u.source)?;
        Some(Self::new(
            "design",
            &u.source,
            s.text.as_bytes(),
            u.prose_range.clone(),
        ))
    }
    pub fn element(source: &str, bytes: &[u8]) -> Self {
        Self::new(
            "implementation",
            source,
            bytes,
            Range {
                start: 0,
                end: bytes.len(),
            },
        )
    }
}
