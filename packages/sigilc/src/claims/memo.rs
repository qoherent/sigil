//! Stored interpretations, so a request asks only for what is stale.
//!
//! A unit is keyed by its content id, so a reading follows its Facet through
//! every edit that leaves the Facet unchanged: a re-wrap, a reorder inside a
//! section, an edit elsewhere in the file. The key covers nothing else of the
//! workspace. What a reading was grounded against travels beside it instead
//! (see [`Grounding`]), so a change in the surroundings is re-checked rather
//! than silently trusted or needlessly re-read.
//!
//! Nothing here launches a model. A stored interpretation is one a caller
//! already supplied; reusing it is reuse of their own input, not a new call.
use super::{
    dialect::Row,
    identity::{Admitter, Defect},
    prepare::{REQUEST_FORMAT, Request},
};
use crate::{sources::hash, structure::DesignInput};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

/// Where stored interpretations live, inside the store directory (`<root>/.sigil` by default).
const DIR: &str = "claims/interpretations";

/// The layout version of a stored entry and of its key. An entry written under
/// any other version reads as absent and is pruned at the next write.
pub const MEMO_VERSION: u32 = 6;

/// One thing the interpreter is shown, and the unit staleness is judged in.
///
/// Not always a Facet. Logic is presented as a whole section, because a flow
/// spans one, so a Logic unit is the component's Logic section and its key
/// covers its Facet ids in order: swap two Logic paragraphs and the section is
/// re-read, because the flow through it may have changed. Every other role is
/// one Facet, and its key is its Facet id alone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unit {
    pub key: String,
    pub source: String,
    pub component: String,
    pub section: String,
    /// Every Facet this unit covers, in source order.
    pub facets: Vec<String>,
    /// An imported interface unit. Its stored reading joins the program, but
    /// it is never an interpretation target of this source's run.
    pub context: bool,
}

/// The presentation units of a request, each with the key it is stored under.
///
/// The key deliberately excludes the binding, which is taken over the source's
/// content and moves with every edit to it. It also excludes the source, the
/// path and every position: a Facet id already covers its component, section,
/// grouping Tag, introduced Tags, normalized prose and payload. Grounding runs
/// at admission rather than at interpretation, so a changed import re-grounds
/// stored rows without re-reading them.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::InterpretationRequest interface
pub fn units(request: &Request) -> Vec<Unit> {
    let identity = (
        MEMO_VERSION,
        REQUEST_FORMAT,
        request.binding.guidance_fingerprint.as_str(),
        request.binding.vocabulary_generation,
    );

    let mut units = Vec::new();
    let mut grouped: BTreeSet<&str> = BTreeSet::new();
    for flow in &request.flows {
        units.push(Unit {
            key: hash(
                &serde_json::to_vec(&(
                    "sigil-claims-memo",
                    identity,
                    "logic",
                    &flow.component,
                    &flow.facets,
                ))
                .expect("memo key serialization"),
            ),
            source: flow.source.clone(),
            component: flow.component.clone(),
            section: "logic".to_owned(),
            facets: flow.facets.clone(),
            context: false,
        });
        grouped.extend(flow.facets.iter().map(String::as_str));
    }
    for row in &request.rows {
        if grouped.contains(row.facet.as_str()) {
            continue; // carried by its section's unit
        }
        units.push(Unit {
            key: hash(
                &serde_json::to_vec(&("sigil-claims-memo", identity, "facet", &row.facet))
                    .expect("memo key serialization"),
            ),
            source: row.source.clone(),
            component: row.component.clone(),
            section: row.section.clone(),
            facets: vec![row.facet.clone()],
            context: row.context,
        });
    }
    units
}

fn path(root: &Path, key: &str) -> PathBuf {
    root.join(DIR).join(format!("{key}.json"))
}

/// What a reading was admitted against, recorded beside its rows.
///
/// `prepare` reuses a reading without re-checking only when `source` and every
/// recorded interface hash still match. Otherwise it dry-runs admission over
/// the stored rows. `defects` is what admission had already accepted: a defect
/// in this set never forces a re-read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Grounding {
    /// The selected source's content file id.
    pub source: String,
    /// `path::component` of each import to its interface hash.
    pub interfaces: BTreeMap<String, String>,
    pub defects: BTreeSet<Defect>,
}

impl Grounding {
    /// The grounding context the request describes, with no defects recorded.
    pub fn current(request: &Request) -> Self {
        Self {
            source: request.binding.source_content.clone(),
            interfaces: request
                .binding
                .interfaces
                .iter()
                .map(|i| (i.key(), i.hash.clone()))
                .collect(),
            defects: BTreeSet::new(),
        }
    }

    fn same_context(&self, other: &Self) -> bool {
        self.source == other.source && self.interfaces == other.interfaces
    }
}

/// A stored reading: Facet ids, rows naming them, and the grounding context.
///
/// Facet ids are content ids, so rows need no remapping. A Guard's constraint
/// operand is the target Facet's id, not a unit key and position.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stored {
    pub version: u32,
    pub facets: Vec<String>,
    pub rows: Vec<Row>,
    pub grounding: Grounding,
}

fn load_stored(root: &Path, unit: &Unit) -> Option<Stored> {
    let bytes = std::fs::read(path(root, &unit.key)).ok()?;
    let stored: Stored = serde_json::from_slice(&bytes).ok()?;
    (stored.version == MEMO_VERSION
        && stored.facets == unit.facets
        && stored
            .rows
            .iter()
            .all(|row| unit.facets.iter().any(|f| f == row.facet())))
    .then_some(stored)
}

/// The rows stored for a unit, or `None` when nothing current is stored.
pub fn load(root: &Path, unit: &Unit) -> Option<Vec<Row>> {
    load_stored(root, unit).map(|s| s.rows)
}

fn write_stored(root: &Path, unit: &Unit, stored: &Stored) -> Result<(), String> {
    let path = path(root, &unit.key);
    let dir = path.parent().expect("memo path has a parent");
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut bytes = serde_json::to_vec(stored).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    // Written beside its target and renamed, so a reader never sees half a file.
    let temporary = path.with_extension(format!("json.tmp{}", std::process::id()));
    std::fs::write(&temporary, bytes).map_err(|e| format!("{}: {e}", temporary.display()))?;
    std::fs::rename(&temporary, &path).map_err(|e| {
        let _ = std::fs::remove_file(&temporary);
        format!("{}: {e}", path.display())
    })
}

/// Store a nonempty interpretation with the grounding context it was admitted
/// under and the defects admission accepted.
///
/// Writes under this component's own path and never the compiler's world cache,
/// which the contract makes read-only here.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::InterpretationRequest interface
pub fn save(
    root: &Path,
    request: &Request,
    unit: &Unit,
    rows: &[Row],
    defects: BTreeSet<Defect>,
) -> Result<(), String> {
    if rows.is_empty() {
        return Err("a rowless unit remains stale and cannot be memoized".into());
    }
    let mut grounding = Grounding::current(request);
    grounding.defects = defects;
    write_stored(
        root,
        unit,
        &Stored {
            version: MEMO_VERSION,
            facets: unit.facets.clone(),
            rows: rows.to_vec(),
            grounding,
        },
    )
}

/// How many entries under the store were written by another memo version.
pub fn older_entries(root: &Path) -> usize {
    entries(root).filter(|(_, current)| !current).count()
}

/// Delete every entry another memo version wrote, and say how many.
pub fn prune_older(root: &Path) -> Result<usize, String> {
    let mut removed = 0;
    for (path, current) in entries(root).collect::<Vec<_>>() {
        if !current {
            match std::fs::remove_file(&path) {
                Ok(()) => removed += 1,
                // A concurrent prune already removed it.
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("{}: {e}", path.display())),
            }
        }
    }
    Ok(removed)
}

fn entries(root: &Path) -> impl Iterator<Item = (PathBuf, bool)> {
    std::fs::read_dir(root.join(DIR))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .map(|e| {
            let path = e.path();
            let current = std::fs::read(&path)
                .ok()
                .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                .is_some_and(|v| v["version"] == MEMO_VERSION);
            (path, current)
        })
}

/// A request's units sorted by what `prepare` must do with them.
#[derive(Debug, Default)]
pub struct Split {
    /// Own units with no usable stored reading, or whose reading failed
    /// re-grounding: the interpreter is asked for these.
    pub stale: Vec<Unit>,
    /// Own units whose stored reading stands.
    pub reused: Vec<(Unit, Vec<Row>)>,
    /// The subset of `reused` whose recorded grounding context was out of date
    /// and passed a dry admission; its context is rewritten by [`refresh`].
    pub refreshed: Vec<(Unit, Stored)>,
    /// Imported interface units with a stored reading: context that joins the
    /// program.
    pub context: Vec<(Unit, Vec<Row>)>,
    /// Imported interface units with none. Never requested from this source.
    pub uninterpreted_context: Vec<Unit>,
}

/// Sort a request's units into those a caller must interpret and those stored.
///
/// A stored reading is reused outright when its recorded source content id and
/// every recorded interface hash still match. Otherwise admission is dry-run
/// over its rows against the current request: it goes stale if admission
/// refuses, a Guard's target Facet no longer exists, or a defect appears that
/// the reading was not already carrying. Rows are never replaced here; only a
/// fresh reading admitted at ingest replaces them.
pub fn split(request: &Request, input: &DesignInput, root: &Path) -> Split {
    let admitter = Admitter::new(request, input);
    let current = Grounding::current(request);
    let mut out = Split::default();
    for unit in units(request) {
        let stored = load_stored(root, &unit);
        if unit.context {
            match stored {
                Some(stored) => out.context.push((unit, stored.rows)),
                None => out.uninterpreted_context.push(unit),
            }
            continue;
        }
        let Some(mut stored) = stored else {
            out.stale.push(unit);
            continue;
        };
        if stored.grounding.same_context(&current) {
            out.reused.push((unit, stored.rows));
            continue;
        }
        match admitter.admit(&stored.rows) {
            Ok(facts) => {
                let defects: BTreeSet<Defect> = facts
                    .iter()
                    .flat_map(|f| f.defects.iter().cloned())
                    .collect();
                if defects.is_subset(&stored.grounding.defects) {
                    // The accepted defect set is kept whole rather than shrunk,
                    // so a defect that returns later is still one admission
                    // had already accepted.
                    stored.grounding = Grounding {
                        defects: stored.grounding.defects.clone(),
                        ..current.clone()
                    };
                    out.reused.push((unit.clone(), stored.rows.clone()));
                    out.refreshed.push((unit, stored));
                } else {
                    out.stale.push(unit);
                }
            }
            Err(_) => out.stale.push(unit),
        }
    }
    out
}

/// Write back the grounding context of every reading that passed re-grounding.
pub fn refresh(root: &Path, split: &Split) -> Result<usize, String> {
    for (unit, stored) in &split.refreshed {
        write_stored(root, unit, stored)?;
    }
    Ok(split.refreshed.len())
}
