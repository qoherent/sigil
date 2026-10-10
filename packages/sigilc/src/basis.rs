//! Content identities shared by tree and claims preparation.
use crate::sources::SourceIdentity;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// What a source reads of one imported component: nothing but its interface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportedInterface {
    /// The workspace path of the importing target.
    pub path: String,
    pub component: String,
    /// The interface hash of every component of that name in the target,
    /// sorted. Empty when the import did not resolve.
    pub interface: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContextIdentity {
    pub path: String,
    pub checksum: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SourceBasis {
    /// The source's path and its content file id from the tree, which a pure
    /// reformat leaves unchanged.
    pub identity: SourceIdentity,
    pub imports: Vec<ImportedInterface>,
    /// Hash of the source's own resolution, with no position in it.
    pub structure: String,
    /// Own component IRI to the Tag names its interface exposes.
    pub exposed: BTreeMap<String, Vec<String>>,
}

/// Everything a Design binding reads from the trees, for every source.
#[derive(Debug, Clone)]
pub struct DesignBasis {
    pub reader_version: String,
    pub sources: BTreeMap<String, SourceBasis>,
    pub context: Vec<ContextIdentity>,
}
