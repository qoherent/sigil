//! The published claim vocabulary. Guidance describes it; the validator enforces it.
use crate::{frontend::Section, turtle};
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

/// Relation names a claim may use: the compiler's entity predicates.
///
/// Read through the public `turtle::vocabulary()` rather than the predicate
/// tables themselves. `TEXT_PREDICATES`, `BOOLEAN_PREDICATES` and
/// `NUMBER_PREDICATES` are private, and widening them would edit `turtle.rs`,
/// whose text `eqval::fingerprint()` hashes.
pub fn relations() -> &'static BTreeSet<&'static str> {
    static RELATIONS: LazyLock<BTreeSet<&'static str>> = LazyLock::new(|| named("entity"));
    &RELATIONS
}

/// Property names a property row may use.
pub fn boolean_properties() -> &'static BTreeSet<&'static str> {
    static BOOLEAN: LazyLock<BTreeSet<&'static str>> = LazyLock::new(|| named("boolean"));
    &BOOLEAN
}

/// Property names a measure row may use.
pub fn numeric_properties() -> &'static BTreeSet<&'static str> {
    static NUMERIC: LazyLock<BTreeSet<&'static str>> = LazyLock::new(|| named("number"));
    &NUMERIC
}

fn named(range: &str) -> BTreeSet<&'static str> {
    turtle::vocabulary()
        .into_iter()
        .filter(|(_, kind)| *kind == range)
        .map(|(name, _)| name)
        .collect()
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
