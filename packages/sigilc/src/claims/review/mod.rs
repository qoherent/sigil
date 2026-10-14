//! The review view: the linked check's computed evidence, small enough for a
//! judge to read whole.
//!
//! The judgment context carries every unit's prose, and repeats a promise's
//! prose for each obligation it raises, so on a real design it is far larger
//! than the design itself. This view carries no prose. It names every entity,
//! unit, claim, conclusion, obligation, finding and simplification candidate
//! by a short alias local to one check, and the evidence file beside it maps
//! each alias back to its full identity, the exact source bytes it was read
//! from, and the report or context entry that carries its detail.
//!
//! Nothing here judges or computes anything new: it is a projection of what
//! the check already derived. Only exact repeats are folded together, each
//! keeping every place it came from.
mod evidence;
mod project;
mod view;

pub use evidence::*;

use super::{
    context::{CONTEXT_VERSION, Context},
    findings::{REPORT_VERSION, Report, file_name},
    link::{Linked, WORKSPACE},
    program::Saturated,
};
use crate::{locations::sha256, structure::DesignInput};

/// Changes when the evidence file's shape changes.
pub const REVIEW_VERSION: u32 = 1;

/// The view beside a linked report.
pub const VIEW_SUFFIX: &str = ".linked.review.md";

/// The evidence file beside a linked report.
pub const EVIDENCE_SUFFIX: &str = ".linked.review.json";

/// What the view is projected from: one linked check, already computed.
pub struct Inputs<'a> {
    /// The design as the check loaded it, so source identities are those of
    /// the bytes it read rather than whatever is on disk later.
    pub input: &'a DesignInput,
    pub linked: &'a Linked,
    pub world: &'a Saturated,
    pub report: &'a Report,
    pub context: &'a Context,
    /// The `--source` the report's findings were narrowed to, if any.
    pub filter: Option<&'a str>,
    pub report_artifact: Artifact,
    pub context_artifact: Artifact,
}

/// The view and the evidence that resolves it.
pub struct Bundle {
    pub view: String,
    pub evidence: Evidence,
}

/// Project one linked check into its view and evidence.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::JudgmentContext interface
pub fn build(inputs: &Inputs) -> Bundle {
    let Inputs {
        input,
        linked,
        report,
        filter,
        ..
    } = inputs;
    let projection = project::project(inputs);
    let unresolved_imports = (0..projection.totals.unresolved_imports)
        .map(|n| format!("/unresolvedImports/{n}"))
        .collect();
    let view = view::render(
        inputs,
        &projection,
        &file_name(&report.source, EVIDENCE_SUFFIX),
    );

    let evidence = Evidence {
        version: REVIEW_VERSION,
        scope: Scope {
            computation: WORKSPACE.to_owned(),
            report_filter: filter.map(str::to_owned),
            state: report.state,
            findings: report.findings.len(),
            coverage: projection.totals,
        },
        computation: Computation {
            tool: format!("sigilc {}", env!("CARGO_PKG_VERSION")),
            language_version: input.language_version.clone(),
            reader_version: input.reader_version.clone(),
            report_version: REPORT_VERSION,
            context_version: CONTEXT_VERSION,
            workspace_digest: linked.workspace_digest.clone(),
            identity: report.identity.clone(),
            sources: linked.sources.clone(),
        },
        artifacts: Artifacts {
            view: Artifact::new(&file_name(&report.source, VIEW_SUFFIX), view.as_bytes()),
            report: inputs.report_artifact.clone(),
            context: inputs.context_artifact.clone(),
        },
        inputs: LoadedInputs {
            sources: input
                .sources
                .iter()
                .map(|s| LoadedSource {
                    path: s.path.clone(),
                    sha256: sha256(s.text.as_bytes()),
                    bytes: s.text.len(),
                })
                .collect(),
            context: input
                .context
                .iter()
                .map(|c| LoadedContext {
                    path: c.path.clone(),
                    present: c.text.is_some(),
                    sha256: c.text.as_deref().map(|t| sha256(t.as_bytes())),
                })
                .collect(),
        },
        entities: projection.entities,
        units: projection.units,
        claims: projection.claims,
        conclusions: projection.conclusions,
        obligations: projection.obligations.into_iter().map(|(e, _)| e).collect(),
        findings: projection.findings.into_iter().map(|(e, _)| e).collect(),
        simplifications: projection
            .simplifications
            .into_iter()
            .map(|(e, _)| e)
            .collect(),
        unread: projection.unread.into_iter().map(|(e, _)| e).collect(),
        unresolved_imports,
    };
    Bundle { view, evidence }
}
