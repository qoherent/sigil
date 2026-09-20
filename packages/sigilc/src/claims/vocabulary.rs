//! The published claim vocabulary. Guidance describes it; the validator enforces it.
use crate::frontend::Section;
use std::{collections::BTreeSet, sync::LazyLock};

/// Changes when the accepted claim profile becomes incompatible.
///
/// 2 adds the step and guard rows and the reference forms a row uses to name a
/// step or a graph. An interpretation produced against generation 1 knows
/// neither, so a directory prepared under it can no longer be answered.
pub const VOCABULARY_GENERATION: u32 = 2;

/// How a returned row names a step, which it cannot name by identity.
///
/// A step's identity is minted by the tool after the interpretation returns, so
/// the interpretation has no way to write one. The ordinal is the one reference
/// both sides can compute: the interpretation reads the prose and numbers the
/// steps, and the tool mints from the Facet and that number.
pub const STEP_REF: &str = "step:";

/// How a returned row names the graph of its Facet's Logic section.
///
/// An edge to the graph is what declares an end of the flow, so this has to be
/// nameable. A graph is minted per component section, which the Facet already
/// determines, so no further reference is needed.
pub const GRAPH_REF: &str = "graph";

/// What a guard compares against.
///
/// An input value is text and never resolves to an entity; a constraint names
/// the Facet that authored it, because a claim identity does not exist yet when
/// the interpretation is written.
pub const GUARD_OPERANDS: &[&str] = &["state", "input", "constraint"];

/// Whether a name is a reference to a minted flow entity rather than a design
/// entity the export declares.
pub fn is_flow_ref(name: &str) -> bool {
    name == GRAPH_REF || name.starts_with(STEP_REF)
}

/// The ordinal a step reference carries, if it is well formed.
///
/// Ordinals start at 1 so that a missing or zero ordinal is distinguishable
/// from a real one rather than defaulting to the first step.
pub fn step_ordinal(name: &str) -> Option<u32> {
    name.strip_prefix(STEP_REF)?.parse().ok().filter(|n| *n > 0)
}

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
    // A step declaration. It carries the ordinal its identity is minted from,
    // which is also how every other row refers to it. Everything a step does --
    // what it reads, writes, calls, and where its output goes -- is an ordinary
    // claim about the entity this row mints.
    Returned {
        name: "step",
        columns: &["facet", "ordinal"],
    },
    // A guard on a step. This stays a row of its own because an input-value
    // operand is a literal, and a claim row has no column that takes one.
    Returned {
        name: "guard",
        columns: &["facet", "step", "operand", "value"],
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
