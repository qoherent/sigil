//! The published claim vocabulary. Guidance describes it; the validator enforces it.
use crate::frontend::Section;
use std::{collections::BTreeSet, sync::LazyLock};

/// Changes when the accepted claim profile becomes incompatible.
pub const VOCABULARY_GENERATION: u32 = 1;

/// The seven contract roles, in the order the language reference lists them.
pub const SECTIONS: &[&str] = &[
    "goal",
    "interface",
    "state",
    "logic",
    "constraints",
    "decisions",
    "cases",
];

/// A claim carries the modality its Facet authored it with.
///
/// `design.egg` raises obligations from a boolean attached to the proposition
/// rather than to an entity, so modality has to travel on the claim itself: a
/// property row, whose subject is an entity, cannot reach it.
pub const MODALITIES: &[&str] = &["required", "permitted", "assumed"];

/// Whether the claim asserts the relation holds or asserts that it must not.
pub const EXPECTATIONS: &[&str] = &["true", "false"];

/// What a reading row records about a Facet that yielded no claim.
pub const READING_OUTCOMES: &[&str] = &["no-commitment", "unresolved"];

/// A relation the interpreter is allowed to return.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Returned {
    pub name: &'static str,
    /// What each column means, in order. Its length is the accepted arity.
    pub columns: &'static [&'static str],
}

impl Returned {
    pub fn arity(&self) -> usize {
        self.columns.len()
    }
}

/// The complete set of rows an interpreter may return.
///
/// No row carries a section: only the export knows which contract role a Facet
/// belongs to, so the tool fills that column from the Facet identity instead of
/// asking the interpreter to restate it.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::CompiledGuidance interface,constraints
pub const RETURNED: &[Returned] = &[
    Returned {
        name: "claim",
        columns: &[
            "facet", "subject", "relation", "object", "modality", "expected",
        ],
    },
    Returned {
        name: "property",
        columns: &["facet", "subject", "property", "value"],
    },
    Returned {
        name: "measure",
        columns: &["facet", "subject", "property", "number"],
    },
    Returned {
        name: "reading",
        columns: &["facet", "outcome"],
    },
];

pub fn returned(name: &str) -> Option<&'static Returned> {
    RETURNED.iter().find(|row| row.name == name)
}

/// The accepted set: this component's own, read from nothing at runtime.
///
/// These names began as a copy of the compiler's ontology and deliberately do
/// not track it. Reading `turtle::vocabulary()` here folded the compiler's
/// ontology into `guidance::fingerprint()`, so an edit anywhere in the compiler
/// invalidated every prepared interpretation directory; holding the two equal
/// by test would have kept the same coupling in a weaker form. Being able to
/// diverge is the point, and it is what lets the compiler's own vocabulary be
/// replaced without moving what an interpretation may return.
///
/// `claims_guidance.rs` asserts these carry every name the laws in `claims.egg`
/// read. A missing name would not fail: it would make a law that never fires
/// and reports nothing.
const RELATION_NAMES: &[&str] = &[
    "owns",
    "provides",
    "requires",
    "dependsOn",
    "excludes",
    "delegates",
    "routesThrough",
    "persistsAt",
    "authorityFor",
    "trusts",
    "invokes",
    "reads",
    "writes",
    "uses",
    "hasContract",
    "from",
    "to",
    "target",
    "initialState",
    "transitionsTo",
];

const BOOLEAN_NAMES: &[&str] = &["required", "exclusive", "assumed", "expected"];

const NUMERIC_NAMES: &[&str] = &["cost", "latencyBudgetMs", "latencyMs", "risk"];

/// Relation names a claim may use.
// @sigil implements packages/sigilc/vocabulary.sigil::SigilClaimsVocabulary::AcceptedVocabulary interface,constraints
pub fn relations() -> &'static BTreeSet<&'static str> {
    static RELATIONS: LazyLock<BTreeSet<&'static str>> =
        LazyLock::new(|| RELATION_NAMES.iter().copied().collect());
    &RELATIONS
}

/// Property names a property row may use.
pub fn boolean_properties() -> &'static BTreeSet<&'static str> {
    static BOOLEAN: LazyLock<BTreeSet<&'static str>> =
        LazyLock::new(|| BOOLEAN_NAMES.iter().copied().collect());
    &BOOLEAN
}

/// Property names a measure row may use.
pub fn numeric_properties() -> &'static BTreeSet<&'static str> {
    static NUMERIC: LazyLock<BTreeSet<&'static str>> =
        LazyLock::new(|| NUMERIC_NAMES.iter().copied().collect());
    &NUMERIC
}

/// The contract role of a Facet, as the evaluated program spells it.
pub fn section_name(section: &Section) -> &'static str {
    match section {
        Section::Goal => "goal",
        Section::Interface => "interface",
        Section::State => "state",
        Section::Logic => "logic",
        Section::Constraints => "constraints",
        Section::Decisions => "decisions",
        Section::Cases => "cases",
    }
}
