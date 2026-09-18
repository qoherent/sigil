//! Computed design validation.
//!
//! Interprets a design's Facet prose into Datalog claims through an external
//! model, saturates those claims against tool-owned laws, and reports the
//! findings that follow from facts rather than from a reading.
//!
//! The compiler's own pipeline is untouched by everything here: this component
//! reads the design export, owns its own store, and never writes the files
//! whose text `eqval::fingerprint()` hashes.
pub mod guidance;
pub mod prepare;
pub mod vocabulary;
