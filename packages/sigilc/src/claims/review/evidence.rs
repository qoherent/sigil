//! What the evidence file carries: every alias in the view, mapped to its
//! full identity, a pointer to its detail, and the exact bytes it came from.
use super::super::{
    findings::{Identity, State},
    link::SourceEvidence,
};
use crate::locations::{Location, sha256};
use serde::{Deserialize, Serialize};

/// One file the evidence binds: its name in the claims store and the SHA-256
/// of its exact bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Artifact {
    pub file: String,
    pub sha256: String,
}

impl Artifact {
    pub fn new(file: &str, bytes: &[u8]) -> Self {
        Self {
            file: file.to_owned(),
            sha256: sha256(bytes),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    pub version: u32,
    pub scope: Scope,
    pub computation: Computation,
    pub artifacts: Artifacts,
    pub inputs: LoadedInputs,
    pub entities: Vec<EntityEntry>,
    pub units: Vec<UnitEntry>,
    pub claims: Vec<ClaimEntry>,
    pub conclusions: Vec<ConclusionEntry>,
    pub obligations: Vec<ObligationEntry>,
    pub findings: Vec<FindingEntry>,
    pub simplifications: Vec<SimplificationEntry>,
    pub unread: Vec<UnreadEntry>,
    /// A pointer into the report for each import that did not resolve.
    pub unresolved_imports: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    /// What was computed: always the whole workspace.
    pub computation: String,
    /// The source the report's findings were narrowed to. Units, claims and
    /// coverage are the workspace's either way.
    pub report_filter: Option<String>,
    pub state: State,
    pub findings: usize,
    pub coverage: CoverageTotals,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CoverageTotals {
    pub units: usize,
    pub interpreted: usize,
    pub read_without_commitment: usize,
    pub uninterpreted: usize,
    pub unread: usize,
    pub refused: usize,
    pub unresolved_imports: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Computation {
    pub tool: String,
    pub language_version: String,
    pub reader_version: String,
    pub report_version: u32,
    pub context_version: u32,
    pub workspace_digest: String,
    pub identity: Identity,
    pub sources: Vec<SourceEvidence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Artifacts {
    pub view: Artifact,
    pub report: Artifact,
    pub context: Artifact,
}

/// Every file the check loaded, by the bytes it loaded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadedInputs {
    pub sources: Vec<LoadedSource>,
    /// Workspace configuration, including files that were absent.
    pub context: Vec<LoadedContext>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadedSource {
    pub path: String,
    pub sha256: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadedContext {
    pub path: String,
    pub present: bool,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntityEntry {
    pub alias: String,
    pub id: String,
    pub kind: String,
    pub label: String,
    /// The owning entity's alias.
    pub owner: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnitEntry {
    pub alias: String,
    pub facet: String,
    pub source: String,
    /// The owning component's alias.
    pub component: String,
    pub section: String,
    pub coverage: UnitCoverage,
    /// The unit's prose as exact UTF-8 bytes of the source the check loaded.
    pub location: Option<Location>,
    /// A JSON pointer into the judgment context.
    pub context: String,
}

/// How far the check got with one unit, with what is unread or refused taking
/// precedence over the context's own account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnitCoverage {
    Interpreted,
    ReadWithoutCommitment,
    Uninterpreted,
    /// No valid stored reading.
    Unread,
    /// A stored reading that admission refused.
    Refused,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaimEntry {
    pub alias: String,
    pub id: String,
    pub unit: String,
    pub context: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConclusionEntry {
    pub alias: String,
    pub subject: String,
    pub relation: String,
    pub object: String,
    pub derivations: Vec<Derivation>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Derivation {
    pub law: String,
    pub witness: String,
    /// Pointers into the judgment context, where a unit carries it.
    pub context: Vec<String>,
    /// Aliases of the claims and conclusions the law combined, so a conclusion
    /// whose witness is a component or graph still leads to its support.
    pub premises: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObligationEntry {
    pub alias: String,
    pub claim: String,
    pub filled: bool,
    pub context: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FindingEntry {
    pub alias: String,
    /// A JSON pointer into the report.
    pub report: String,
    pub claims: Vec<String>,
    pub units: Vec<String>,
    pub obligations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SimplificationEntry {
    pub alias: String,
    pub kind: String,
    pub claims: Vec<String>,
    /// Every context candidate the entry folds together.
    pub context: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnreadEntry {
    pub report: String,
    pub units: Vec<String>,
}
