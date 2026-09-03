# Architecture and design

Treat the supplied purpose retrieval result as the authoritative architecture
scope, with the selected component as its root. Evaluate that component, its
expansions, dependencies reached through its imports, relevant module indexes,
cycle groups wholly reached downstream, public concept origins, reasons, and
exclusions. Do not analyze importers, consumers, or other ancestors. Use
selected downstream evidence by default. Only when that evidence is insufficient
because an explicit evidence gap blocks evaluation, perform targeted graph or
context inspection limited to the target's downstream dependency closure. Do not
broadly rediscover the repository or redefine the authoritative scope.

Evaluate:

- responsibility cohesion and durable reasons to change;
- state, lifecycle, and policy ownership;
- interface size and information hiding;
- coupling and dependency direction;
- component and expand decomposition;
- whether the contract can guide implementation into cohesive owning modules;
- ModuleIndexFile scope and namespace-assembly responsibility;
- reuse of semantically matching imported public components and concepts.

Read each component's declared `scope` before reporting a decomposition or
ownership gap. An area declared excluded or deferred is an intentional boundary,
so absence of a contract for it is not a finding.

Treat graph edges as evidence rather than findings. Report only a concrete
ownership, dependency, coupling, decomposition, interface, namespace, or
change-locality consequence. Do not assign numeric modularity scores or report
subjective style preferences.

Treat each `_module.sigil` as a concise architectural summary and intentional
namespace-assembly surface. It contains one local boundary summary and imports
the cohesive components intended for shorthand. Its matching expand retains only
architecture constraints and durable decisions that genuinely govern the whole
boundary. Report `MODULE_INDEX_SCOPE` when a module index owns material
operational logic, narrower mutable state, detailed lifecycle behavior, or
independently changing policy. Boundary-wide state or orchestration remains
valid when it cannot coherently belong to a narrower owner.

When the selected component renders a user interface, evaluate presentation
ownership on the same terms as any other boundary. Report
`PRESENTATION_BOUNDARY` when one surface owns unrelated rendering, data access,
navigation, or authorization responsibilities that have separate reasons to
change, or when a screen restates a design-system primitive's contract instead
of depending on it. Report `UI_STATE_OWNERSHIP` when client state has no single
owning component, when a store is written by several surfaces without a recorded
decision, or when server cache and surface mode are owned by the same contract.
Treat an interaction, accessibility, or responsive statement as contract content
rather than style, and do not report the absence of a component for passive
markup, layout wrappers, or individual visual elements.

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
