//! The code vocabulary is independent of design claims and their generation.
// @sigil implements packages/sigilc/align.sigil::SigilImplementationClaims::CodeVocabulary interface

pub const VOCABULARY_GENERATION: u32 = 1;
pub const RETURNED: &[&str] = &["element", "realizes", "act", "measure"];
pub const ELEMENT_KINDS: &[&str] = &["function", "module", "type", "state", "test"];
pub const RELATIONS: &[&str] = &["uses", "owns", "invokes", "dependsOn"];
pub const MEASURES: &[&str] = &["durationDays", "leadDays", "spanDays", "latencyMs"];
