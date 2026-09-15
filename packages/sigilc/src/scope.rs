//! Ordered focus and effective world membership, without external scheduling.
use crate::{
    frontend::{DesignInput, normalized_path},
    sources::{self, Selection, SourceManifest},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scope {
    pub version: u32,
    pub design: DesignSelection,
    pub implementation: Selection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesignSelection {
    pub paths: Vec<String>,
    #[serde(default)]
    pub allow_empty: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct Dependency {
    pub source: String,
    pub target: String,
    pub reason: &'static str,
}

#[derive(Debug, Serialize)]
pub struct DesignMembership {
    pub roots: Vec<String>,
    pub focus_order: Vec<String>,
    pub sources: BTreeSet<String>,
    pub dependencies: BTreeSet<Dependency>,
    pub conservative_full_bundle: bool,
    pub intentional_empty: bool,
}

#[derive(Debug, Serialize)]
pub struct ScopeReport {
    pub version: u32,
    pub membership_fingerprint: String,
    pub order_fingerprint: String,
    pub design: DesignMembership,
    pub implementation_selection: Selection,
    pub implementation_sources: Vec<String>,
    pub implementation_intentional_empty: bool,
}

pub struct ResolvedScope {
    pub report: ScopeReport,
    pub implementation: SourceManifest,
}

impl Scope {
    // @sigil implements packages/sigilc/scope.sigil::SigilComparisonScope::ScopeInput interface
    pub fn resolve(self, root: &Path, input: &mut DesignInput) -> Result<ResolvedScope, String> {
        if self.version != 1 {
            return Err("unsupported scope version".into());
        }
        input.validate()?;
        let original_sources: BTreeSet<_> = input.sources.iter().map(|s| s.path.clone()).collect();
        let mut roots = BTreeSet::new();
        for path in &self.design.paths {
            normalized_path(path)?;
            if !roots.insert(path.as_str()) {
                return Err(format!("duplicate Design scope root: {path}"));
            }
            if !original_sources.contains(path) {
                return Err(format!("Design scope root absent from frontend: {path}"));
            }
        }
        if roots.is_empty() && !self.design.allow_empty {
            return Err("empty Design scope requires design.allowEmpty".into());
        }
        let design = design_membership(input, self.design.paths.iter().map(String::as_str));
        let implementation = sources::discover(root, &self.implementation)?;
        let implementation_sources: Vec<_> = implementation
            .files
            .iter()
            .map(|f| f.path.clone())
            .collect();
        let membership_fingerprint = sources::hash(
            &serde_json::to_vec(&(
                "sigil-scope-membership-v1",
                &design.sources,
                &implementation_sources,
            ))
            .map_err(|e| e.to_string())?,
        );
        let order_fingerprint = sources::hash(
            &serde_json::to_vec(&("sigil-scope-order-v1", &design.roots, &design.focus_order))
                .map_err(|e| e.to_string())?,
        );
        input.sources.retain(|s| design.sources.contains(&s.path));
        input
            .entities
            .retain(|e| design.sources.contains(&e.source));
        input.units.retain(|u| design.sources.contains(&u.source));
        input.imports.retain(|i| design.sources.contains(&i.source));
        input.groups.retain(|g| design.sources.contains(&g.source));
        input
            .introductions
            .retain(|i| design.sources.contains(&i.source));
        input
            .references
            .retain(|r| design.sources.contains(&r.source));
        input.links.retain(|l| design.sources.contains(&l.source));
        // Global/context diagnostics remain. Only diagnostics on known, excluded
        // authored files are outside this comparison's effective membership.
        input.diagnostics.retain(|d| {
            d.file_path
                .as_ref()
                .is_none_or(|p| !original_sources.contains(p) || design.sources.contains(p))
        });
        input.validate()?;
        Ok(ResolvedScope {
            report: ScopeReport {
                version: 1,
                membership_fingerprint,
                order_fingerprint,
                design,
                implementation_selection: self.implementation,
                implementation_sources,
                implementation_intentional_empty: implementation.intentional_empty,
            },
            implementation,
        })
    }
}

// Both callers operate on validated frontend structure. Share this closure with
// per-source binding so changing focus cannot hide a semantic dependency.
/*
 * @sigil implements packages/sigilc/scope.sigil::SigilComparisonScope::DesignMembership interface
 * @sigil implements packages/sigilc/scope.sigil::SigilComparisonScope::FocusOrder interface
 */
pub(crate) fn design_membership<'a>(
    input: &'a DesignInput,
    roots: impl IntoIterator<Item = &'a str>,
) -> DesignMembership {
    let roots: Vec<_> = roots.into_iter().map(str::to_owned).collect();
    let mut pending: Vec<_> = roots.iter().map(String::as_str).collect();
    let conservative_full_bundle = !roots.is_empty()
        && input
            .imports
            .iter()
            .any(|i| i.target.is_none() || i.names.iter().any(|n| n.entity.is_none()));
    if conservative_full_bundle {
        pending.extend(input.sources.iter().map(|s| s.path.as_str()));
    }
    let entities: BTreeMap<_, _> = input
        .entities
        .iter()
        .map(|e| (e.id.as_str(), e.source.as_str()))
        .collect();
    let mut sources = BTreeSet::new();
    let mut dependencies = BTreeSet::new();
    while let Some(source) = pending.pop() {
        if !sources.insert(source.to_owned()) {
            continue;
        }
        let mut include = |target: &str, reason| {
            if source != target {
                dependencies.insert(Dependency {
                    source: source.into(),
                    target: target.into(),
                    reason,
                });
            }
        };
        for import in input.imports.iter().filter(|i| i.source == source) {
            if let Some(target) = &import.target {
                include(target, "import");
                pending.push(target);
            }
            for name in &import.names {
                if let Some(id) = &name.entity {
                    let target = entities[id.as_str()];
                    include(target, "imported-owner");
                    pending.push(target);
                }
            }
        }
        for owner in input
            .entities
            .iter()
            .filter(|e| e.source == source)
            .filter_map(|e| e.owner.as_deref())
            .chain(
                input
                    .units
                    .iter()
                    .filter(|u| u.source == source)
                    .filter_map(|u| u.owner.as_deref()),
            )
        {
            let target = entities[owner];
            include(target, "owner");
            pending.push(target);
        }
    }
    let mut focus_order = roots.clone();
    let root_set: BTreeSet<_> = roots.iter().collect();
    focus_order.extend(sources.iter().filter(|p| !root_set.contains(p)).cloned());
    DesignMembership {
        roots,
        focus_order,
        intentional_empty: sources.is_empty(),
        sources,
        dependencies,
        conservative_full_bundle,
    }
}
