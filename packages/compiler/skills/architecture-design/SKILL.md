# Architecture and design

Treat the supplied purpose retrieval result as the authoritative architecture
scope. Evaluate its selected component, expansions, dependencies, importers,
module indexes, cycle groups, public concept origins, reasons, and exclusions.
Inspect selected evidence paths only to verify a citation or report an explicit
retrieval gap; do not independently traverse the workspace graph.

Evaluate:

- responsibility cohesion and durable reasons to change;
- state, lifecycle, and policy ownership;
- interface size and information hiding;
- coupling and dependency direction;
- component and expand decomposition;
- whether the contract can guide implementation into cohesive owning modules;
- ModuleIndexFile scope and namespace-assembly responsibility;
- reuse of semantically matching imported public components and concepts.

Treat graph edges as evidence rather than findings. Report only a concrete
ownership, dependency, coupling, decomposition, interface, namespace, or
change-locality consequence. Do not assign numeric modularity scores or report
subjective style preferences.

Treat each `_module.sigil` as a concise architectural summary and intentional
namespace-assembly surface. It contains one local boundary summary and imports
the cohesive components intended for shorthand. Its matching expand retains
only architecture constraints and durable decisions that genuinely govern the
whole boundary. Report `MODULE_INDEX_SCOPE` when a module index owns material
operational logic, narrower mutable state, detailed lifecycle behavior, or
independently changing policy. Boundary-wide state or orchestration remains
valid when it cannot coherently belong to a narrower owner.

Inspect the accessible imported public namespace before recommending a local
identity. Report `IMPORTED_NAMESPACE_REUSE` for aliases, local synonyms, or
duplicate provider contracts, but do not force reuse when similar terminology
represents a materially different responsibility.

A contradiction in public behavior belongs to semantic-readiness. Ownership,
dependency, decomposition, coupling, namespace, and change-locality findings
belong here. Current implementation structure may demonstrate a genuine
feasibility constraint but is not authoritative desired architecture, and mere
code/Sigil mismatch is not an architecture finding.

Findings must cite exact workspace evidence. Do not edit files, use the network,
or run implementation experiments.
