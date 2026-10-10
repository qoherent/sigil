//! The command boundary for computed design validation.
//!
//! Deterministic, like the compiler's: no process launchers and no model
//! options. The external interpretation is an input the caller supplies and can
//! supply again, which is what makes a run reproducible.
use super::{
    canon, context, dialect, findings, guidance, identity, link, memo, prepare, program, vocabulary,
};
use crate::{
    basis::DesignBasis,
    command::{Output, json, store_dir},
    engine,
    structure::{DesignInput, Severity, Stage},
    tree::design_input::load_design,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

const MAX_BINDING_BYTES: u64 = 16_000_000;

pub fn help() -> String {
    r#"sigilc — computed design validation

Commands:
  prepare --source PATH --out NEW_DIR [--root DIR] [--store DIR]
  ingest --binding FILE --claims FILE|- [--claims-repeat FILE|-] [--root DIR] [--store DIR]
  check [--source PATH] [--root DIR] [--store DIR]
  extract-guidance [--implementation] --out DIR [--root DIR]

--root DIR is the workspace; sigilc reads its .sigil configuration and
sources directly (default: the current directory). --store DIR holds the stored
interpretations and the reports (default: ROOT/.sigil).

Flow:
  1. Prepare one source:       sigilc prepare --root . \
                                 --source a.sigil --out claims-a
  2. An external interpreter reads claims-a and writes Datalog claims.
  3. Ingest the result:        sigilc ingest --root . \
                                 --binding claims-a/binding.json --claims claims-a/result.egg

This command never launches a model. Step 3 is the caller's, and passing the
same artifact again reproduces the same report.

Check links every valid stored reading of the workspace into one program and
runs every law over it, so a dependent meets its dependency's private
readings. Run it after each source has been prepared, interpreted and ingested.
--source narrows the report to the findings that source authored part of;
completeness is always the workspace's. A unit with no valid reading, or an
import that did not resolve, makes the state incomplete and a gate failure.

Gate exits: 0 = pass or warning, 1 = a gate failure (a computed Disjoint
verdict, an incomplete check, a refused artifact, or a saturation-limit
breach), 2 = usage, 3 = operational failure.
"#
    .into()
}

/// Parse and run one invocation.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ClaimsCommands interface,constraints
pub fn run(args: &[&str]) -> Output {
    let (command, tail) = match args {
        [] => return Err((2, "Expected a command. Run sigilc --help.".into())),
        ["--help"] | ["-h"] => return Ok((0, help())),
        ["--version"] => {
            return Ok((0, format!("sigilc {}\n", env!("CARGO_PKG_VERSION"))));
        }
        [
            command @ ("prepare" | "ingest" | "check" | "extract-guidance"),
            tail @ ..,
        ] => (*command, tail),
        _ => return Err((2, "Invalid command. Run sigilc --help.".into())),
    };

    let allowed: &[&str] = match command {
        // The store reaches prepare too: past interpretations live in it, and
        // prepare is what decides which units are still stale.
        "prepare" => &["--source", "--out", "--root", "--store"],
        "ingest" => &[
            "--binding",
            "--claims",
            "--claims-repeat",
            "--root",
            "--store",
        ],
        "check" => &["--source", "--root", "--store"],
        _ => &["--out", "--root", "--implementation"],
    };
    let options = parse(tail, allowed)?;
    if options.values().filter(|v| v.as_str() == "-").count() > 1 {
        return Err((2, "only one input may read standard input".into()));
    }
    let required = |flag: &str| required_in(&options, flag);
    let root = options
        .get("--root")
        .cloned()
        .unwrap_or_else(|| ".".to_string());
    let store = store_dir(Path::new(&root), options.get("--store").map(String::as_str));

    match command {
        "extract-guidance" => {
            let out = required("--out")?;
            let implementation = options.contains_key("--implementation");
            let (written, fingerprint) = if implementation {
                (
                    crate::align::guidance::extract(Path::new(&out), Path::new(&root))
                        .map_err(usage)?,
                    crate::align::guidance::fingerprint(),
                )
            } else {
                (
                    guidance::extract(Path::new(&out), Path::new(&root)).map_err(usage)?,
                    guidance::fingerprint(),
                )
            };
            json(
                0,
                &serde_json::json!({
                    "version": findings::REPORT_VERSION,
                    "guidanceFingerprint": fingerprint,
                    "written": written,
                }),
            )
        }
        "prepare" => {
            // Every required flag is resolved before anything is opened, so a
            // missing option is a usage error rather than whatever the
            // filesystem happens to say about the file that was supplied.
            let (source, out) = (required("--source")?, required("--out")?);
            let (input, basis) = workspace(&root, &store)?;
            let request = prepare::project(&input, &basis, &source).map_err(usage)?;

            // Ask only for what is stale. The binding is left whole: it is what
            // ingest recomputes and compares, so narrowing it would make every
            // prepared directory fail its own check. Only the presentation
            // narrows, and a request with nothing stale is valid and asks for
            // nothing. A stored reading whose grounding context moved is
            // re-checked here without a model call; the ones that still hold
            // have their recorded context refreshed.
            let split = memo::split(&request, &input, &store);
            let refreshed = memo::refresh(&store, &split).map_err(operational)?;
            let asked = prepare::presenting(&request, &split.stale);
            let written = prepare::write(&asked, Path::new(&out)).map_err(operational)?;
            let older = memo::older_entries(&store);
            json(
                0,
                &serde_json::json!({
                    "version": findings::REPORT_VERSION,
                    "binding": Path::new(&out).join("binding.json"),
                    "inputs": written,
                    "facets": asked.own_rows().count(),
                    "requestedUnits": split.stale.len(),
                    "reusedUnits": split.reused.len(),
                    "regroundedUnits": refreshed,
                    "uninterpretedContext": split.uninterpreted_context.len(),
                    "bindingDigest": request.binding.digest(),
                    "workspaceDigest": prepare::workspace_digest(&basis),
                    "olderMemoEntries": older,
                    "note": (older > 0).then(|| format!(
                        "{older} stored reading(s) were written by an older memo format and are ignored; every unit they covered will be read again, and they are removed at the next ingest"
                    )),
                }),
            )
        }
        "check" => check(options.get("--source").map(String::as_str), &root, &store),
        _ => ingest(&options, &root, &store),
    }
}

/// Link the workspace's stored readings and run every law over them.
///
/// Reads the store and never writes a reading: a reading whose recorded
/// context moved is re-checked on every run. What it writes is its own report
/// and judgment context, under names ingest's never take.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ClaimsCommands interface,constraints
fn check(source: Option<&str>, root: &str, store: &Path) -> Output {
    let (input, basis) = workspace(root, store)?;
    // A workspace the compiler could not read has no sources to be incomplete
    // about, so linking it would read as a pass. Refuse it instead.
    let unreadable: Vec<String> = input
        .diagnostics
        .iter()
        .filter(|d| matches!(d.stage, Stage::Workspace) && matches!(d.severity, Severity::Error))
        .map(|d| format!("{}: {}", d.code, d.message))
        .collect();
    if !unreadable.is_empty() {
        return Err(operational(format!(
            "the workspace could not be read: {}",
            unreadable.join("; ")
        )));
    }
    if let Some(source) = source
        && !input.sources.iter().any(|s| s.path == source)
    {
        return Err((2, format!("design source not found: {source}")));
    }
    let linked = link::link(&input, &basis, store).map_err(operational)?;
    let world = program::saturate(&linked.request, &linked.facts, engine::Limits::default())
        .map_err(gate)?;
    let mut report = findings::linked_report(&linked, &world, source);
    findings::locate(&mut report, &input, &linked.facts);
    let mut context = context::build(
        &linked.request,
        &linked.facts,
        &world,
        report.identity.clone(),
    );
    context.source = report.source.clone();

    let report_path = findings::store(&report, store, &report.source, findings::LINKED_SUFFIX)
        .map_err(operational)?;
    let context_path = findings::store(&context, store, &report.source, context::LINKED_SUFFIX)
        .map_err(operational)?;

    let code = match report.state {
        findings::State::Disjoint | findings::State::Incomplete => 1,
        _ => 0,
    };
    json(
        code,
        &serde_json::json!({
            "version": report.version,
            "scope": report.source,
            "state": report.state,
            "findings": report.findings.len(),
            "unreadUnits": linked.unread.len(),
            "unresolvedImports": linked.unresolved_imports.len(),
            "report": report_path,
            "judgmentContext": context_path,
            "workspaceDigest": linked.workspace_digest,
            "vocabularyGeneration": vocabulary::VOCABULARY_GENERATION,
            "guidanceFingerprint": report.identity.guidance_fingerprint,
        }),
    )
}

fn ingest(options: &BTreeMap<String, String>, root: &str, store: &Path) -> Output {
    let (binding_path, claims_path) = (
        required_in(options, "--binding")?,
        required_in(options, "--claims")?,
    );
    let (input, basis) = workspace(root, store)?;
    let supplied: prepare::Binding = serde_json::from_slice(
        &crate::command::read(&binding_path, MAX_BINDING_BYTES).map_err(operational)?,
    )
    .map_err(|e| operational(format!("{binding_path}: {e}")))?;

    // The request is recomputed from the workspace now, and the supplied
    // binding has to match it field by field. Only what the request is built
    // from can reject a binding, so an edit to an unrelated source or to a
    // dependency's private sections leaves it intact.
    let request = prepare::project(&input, &basis, &supplied.source).map_err(usage)?;
    if request.binding != supplied {
        return Err((2, mismatch(&request.binding, &supplied)));
    }

    let limits = dialect::Limits::default();
    let first_text = artifact(&claims_path, limits)?;
    // Anything that is not data refuses the whole artifact here. A row that is
    // data but wrong is set aside with the unit it belongs to.
    let parsed = dialect::read(&first_text, limits).map_err(gate)?;
    let resolved = canon::resolve(&request, parsed);

    // Stored rows join first readings before admission, so the program sees the
    // whole design the request presents. A supplied reading for a cached unit
    // is admitted beside the other units' readings, then compared against that
    // stored answer; it never replaces the cache. Reused rows are re-admitted:
    // grounding runs here, so a stored claim naming an entity that has since
    // left the request is refused like any other. Stored readings of imported
    // interface Facets join as context; one this source's request cannot admit
    // is dropped rather than refusing the run, because it was read in its own
    // source's world, not this one's.
    let all_units = memo::units(&request);
    let split = memo::split(&request, &input, store);
    let stale_keys: BTreeSet<String> = split.stale.iter().map(|unit| unit.key.clone()).collect();
    let reused: BTreeMap<String, Vec<dialect::Row>> = split
        .reused
        .into_iter()
        .map(|(unit, rows)| (unit.key, rows))
        .collect();
    let admitter = identity::Admitter::new(&request, &input);
    let handles: BTreeMap<&str, &str> = request
        .rows
        .iter()
        .map(|row| (row.facet.as_str(), row.handle.as_str()))
        .collect();
    let labels: BTreeMap<&str, &str> = request
        .rows
        .iter()
        .map(|row| (row.component.as_str(), row.component_label.as_str()))
        .collect();

    // A unit's issues, by the unit its Facet belongs to. An issue with no unit
    // is a row about nothing this request asked for, refused on its own.
    let unit_of: BTreeMap<&str, usize> = all_units
        .iter()
        .enumerate()
        .filter(|(_, unit)| !unit.context)
        .flat_map(|(index, unit)| unit.facets.iter().map(move |facet| (facet.as_str(), index)))
        .collect();
    let mut issues_of: BTreeMap<usize, Vec<&canon::Issue>> = BTreeMap::new();
    let mut loose: Vec<&canon::Issue> = Vec::new();
    for issue in &resolved.issues {
        match issue.facet.as_deref().and_then(|facet| unit_of.get(facet)) {
            Some(index) => issues_of.entry(*index).or_default().push(issue),
            None => loose.push(issue),
        }
    }

    let mut refusals: Vec<Refusal> = Vec::new();
    let mut unread: Vec<link::Unread> = Vec::new();
    let mut comparison_errors: Vec<String> = Vec::new();
    let mut facts: Vec<identity::Fact> = Vec::new();
    let mut comparison_facts: Vec<identity::Fact> = Vec::new();
    let mut accepted: Vec<(&memo::Unit, Vec<dialect::Row>, BTreeSet<identity::Defect>)> =
        Vec::new();
    let mut has_cached_second_reading = false;
    // Each unit's rows, in one pass over the answer.
    let mut rows_of: BTreeMap<usize, Vec<dialect::Row>> = BTreeMap::new();
    for row in &resolved.rows {
        if let Some(index) = unit_of.get(row.facet()) {
            rows_of.entry(*index).or_default().push(row.clone());
        }
    }
    for (index, unit) in all_units.iter().enumerate().filter(|(_, u)| !u.context) {
        let mut mine = rows_of.remove(&index).unwrap_or_default();
        mine.sort();
        mine.dedup();
        let issues = issues_of.get(&index).map(Vec::as_slice).unwrap_or_default();
        let describe = |refusal: Option<String>| link::Unread {
            source: unit.source.clone(),
            component: labels
                .get(unit.component.as_str())
                .copied()
                .unwrap_or_default()
                .to_owned(),
            section: unit.section.clone(),
            facets: unit.facets.clone(),
            refusal,
        };

        if stale_keys.contains(&unit.key) {
            let mut reasons: Vec<(String, String)> = issues
                .iter()
                .map(|issue| (issue.row.clone(), issue.reason.clone()))
                .collect();
            // Admission runs even when resolution already refused a row, so
            // every mistake in the unit is listed in this one round and the
            // re-ask can answer all of them.
            let mut admitted = Vec::new();
            if !mine.is_empty() {
                let (unit_facts, unit_issues) = admitter.admit_all(&mine);
                reasons.extend(unit_issues.into_iter().map(|i| (i.row, i.reason)));
                if reasons.is_empty() && !unit_facts.iter().any(identity::Fact::satisfies_unit) {
                    reasons.push((
                        String::new(),
                        "none of this unit's rows is usable: every claim has the same subject and object"
                            .into(),
                    ));
                }
                admitted = unit_facts;
            }
            if !reasons.is_empty() {
                for (row, reason) in &reasons {
                    refusals.push(Refusal::new(unit, &handles, row, reason));
                }
                unread.push(describe(Some(
                    reasons
                        .iter()
                        .map(|(_, reason)| reason.as_str())
                        .collect::<Vec<_>>()
                        .join("; "),
                )));
            } else if mine.is_empty() {
                unread.push(describe(None));
            } else {
                comparison_facts.extend(admitted.iter().cloned());
                let defects = admitted
                    .iter()
                    .flat_map(|fact| fact.defects.iter().cloned())
                    .collect();
                facts.extend(admitted);
                accepted.push((unit, mine, defects));
            }
        } else if let Some(stored) = reused.get(&unit.key) {
            match admitter.admit(stored) {
                Ok(stored_facts) => {
                    facts.extend(stored_facts.iter().cloned());
                    if mine.is_empty() {
                        // Rows for a stored unit that did not even resolve are
                        // a mistake in a second reading, reported like one.
                        comparison_errors.extend(issues.iter().map(|i| i.line()));
                        comparison_facts.extend(stored_facts);
                    } else {
                        // A second reading of a cached unit: compared, never
                        // stored, and a mistake in it costs only the comparison.
                        let (second, second_issues) = admitter.admit_all(&mine);
                        if issues.is_empty() && second_issues.is_empty() {
                            comparison_facts.extend(second);
                            has_cached_second_reading = true;
                        } else {
                            comparison_facts.extend(stored_facts);
                            comparison_errors.extend(
                                issues
                                    .iter()
                                    .copied()
                                    .chain(&second_issues)
                                    .map(canon::Issue::line),
                            );
                        }
                    }
                }
                Err(reason) => unread.push(describe(Some(format!(
                    "the stored reading no longer admits: {reason}"
                )))),
            }
        } else {
            return Err(operational(format!(
                "memo did not classify interpretation unit {}",
                unit.key
            )));
        }
    }
    for issue in &loose {
        refusals.push(Refusal::alone(&issue.row, &issue.reason));
    }
    for (_, stored) in &split.context {
        if let Ok(context_facts) = admitter.admit(stored) {
            facts.extend(context_facts.iter().cloned());
            comparison_facts.extend(context_facts);
        }
    }
    facts.sort();
    facts.dedup();
    comparison_facts.sort();
    comparison_facts.dedup();

    // Only first readings of stale units are stored, and only after admission,
    // so a refused unit, a refused artifact or a second reading leaves the
    // cache untouched. Each is stored with the defects admission accepted, so a
    // later re-grounding does not read them as new. Entries another memo
    // version wrote are removed first, and counted.
    let mut pruned = 0;
    let mut stored_units = 0;
    for (unit, mine, defects) in &accepted {
        if stored_units == 0 {
            pruned = memo::prune_older(store).map_err(operational)?;
        }
        memo::save(store, &request, unit, mine, defects.clone()).map_err(operational)?;
        stored_units += 1;
    }

    let mut digests = vec![crate::sources::hash(first_text.as_bytes())];
    let mut comparisons = Vec::new();
    if has_cached_second_reading {
        comparisons.push(comparison_facts);
    }
    if let Some(path) = options.get("--claims-repeat") {
        let text = artifact(path, limits)?;
        digests.push(crate::sources::hash(text.as_bytes()));
        let repeat = dialect::read(&text, limits).map_err(gate)?;
        let repeat = canon::resolve(&request, repeat);
        let (repeat_facts, repeat_issues) = admitter.admit_all(&repeat.rows);
        if repeat.issues.is_empty() && repeat_issues.is_empty() {
            comparisons.push(repeat_facts);
        } else {
            comparison_errors.extend(
                repeat
                    .issues
                    .iter()
                    .chain(&repeat_issues)
                    .map(canon::Issue::line),
            );
        }
    }

    let world = program::saturate(&request, &facts, engine::Limits::default()).map_err(gate)?;
    let mut report = findings::report(&request, &facts, &world, &digests);
    findings::locate(&mut report, &input, &facts);
    let mut disagreements = Vec::new();
    for repeat in &comparisons {
        disagreements.extend(findings::disagreements(&facts, repeat));
    }
    if !comparisons.is_empty() {
        disagreements.sort();
        disagreements.dedup();
        findings::attach(&mut report, disagreements);
    }
    unread.sort();
    findings::mark_unread(&mut report, unread.clone());
    let context = context::build(&request, &facts, &world, report.identity.clone());

    let report_path = findings::write(&report, store).map_err(operational)?;
    let context_path =
        findings::store(&context, store, &context.source, context::SUFFIX).map_err(operational)?;

    let code = match report.state {
        findings::State::Disjoint | findings::State::Incomplete => 1,
        _ => 0,
    };
    let refusal_count = refusals.len();
    refusals.truncate(MAX_REFUSALS);
    json(
        code,
        &serde_json::json!({
            "version": report.version,
            "source": report.source,
            "state": report.state,
            "findings": report.findings.len(),
            "report": report_path,
            "judgmentContext": context_path,
            "vocabularyGeneration": vocabulary::VOCABULARY_GENERATION,
            "guidanceFingerprint": report.identity.guidance_fingerprint,
            "storedUnits": stored_units,
            "prunedMemoEntries": pruned,
            "unreadUnits": unread,
            "refusalCount": refusal_count,
            "refusals": refusals,
            "comparisonErrors": comparison_errors,
        }),
    )
}

/// How many refusals one result lists. The count is always complete.
const MAX_REFUSALS: usize = 200;

/// One row ingest could not accept, and the unit it cost.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Refusal {
    /// The unit refused, or `None` for a row that belongs to no unit.
    #[serde(skip_serializing_if = "Option::is_none")]
    unit: Option<RefusedUnit>,
    row: String,
    reason: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RefusedUnit {
    section: String,
    facets: Vec<String>,
    handles: Vec<String>,
}

impl Refusal {
    fn new(unit: &memo::Unit, handles: &BTreeMap<&str, &str>, row: &str, reason: &str) -> Self {
        Self {
            unit: Some(RefusedUnit {
                section: unit.section.clone(),
                facets: unit.facets.clone(),
                handles: unit
                    .facets
                    .iter()
                    .map(|facet| {
                        handles
                            .get(facet.as_str())
                            .copied()
                            .unwrap_or_default()
                            .to_owned()
                    })
                    .collect(),
            }),
            row: row.to_owned(),
            reason: reason.to_owned(),
        }
    }

    fn alone(row: &str, reason: &str) -> Self {
        Self {
            unit: None,
            row: row.to_owned(),
            reason: reason.to_owned(),
        }
    }
}

/// Name every field that differs, so a caller can see which input moved.
fn mismatch(current: &prepare::Binding, supplied: &prepare::Binding) -> String {
    let mut differences = Vec::new();
    let mut note = |name: &str, a: &str, b: &str| {
        if a != b {
            differences.push(format!("{name} (binding {b}, current {a})"));
        }
    };
    note(
        "source content",
        &current.source_content,
        &supplied.source_content,
    );
    let hashes = |binding: &prepare::Binding| -> BTreeMap<String, String> {
        binding
            .interfaces
            .iter()
            .map(|i| (i.key(), i.hash.clone()))
            .collect()
    };
    let (now, then) = (hashes(current), hashes(supplied));
    for key in now.keys().chain(then.keys()).collect::<BTreeSet<_>>() {
        let (a, b) = (
            now.get(key).map_or("absent", String::as_str),
            then.get(key).map_or("absent", String::as_str),
        );
        note(&format!("interface of {key}"), a, b);
    }
    note(
        "guidance",
        &current.guidance_fingerprint,
        &supplied.guidance_fingerprint,
    );
    note(
        "vocabulary generation",
        &current.vocabulary_generation.to_string(),
        &supplied.vocabulary_generation.to_string(),
    );
    note(
        "format",
        &current.format.to_string(),
        &supplied.format.to_string(),
    );
    if current.facets != supplied.facets {
        differences.push("unit set".into());
    }
    if current.source != supplied.source {
        differences.push("source".into());
    }
    if differences.is_empty() {
        differences.push("binding contents".into());
    }
    format!(
        "binding does not match the current workspace: {}. Prepare a new directory.",
        differences.join(", ")
    )
}

/// The structural input of the workspace at `root` and the content identities
/// its trees bind on, read natively.
fn workspace(root: &str, store: &Path) -> Result<(DesignInput, DesignBasis), (u8, String)> {
    load_design(Path::new(root), store).map_err(operational)
}

fn artifact(path: &str, limits: dialect::Limits) -> Result<String, (u8, String)> {
    let bytes =
        crate::command::read(path, limits.max_document_bytes as u64).map_err(operational)?;
    String::from_utf8(bytes).map_err(|_| gate("claims artifact is not valid UTF-8".to_string()))
}

fn required_in(options: &BTreeMap<String, String>, flag: &str) -> Result<String, (u8, String)> {
    options
        .get(flag)
        .cloned()
        .ok_or_else(|| (2, format!("missing required option: {flag}")))
}

fn parse(tail: &[&str], allowed: &[&str]) -> Result<BTreeMap<String, String>, (u8, String)> {
    let mut options = BTreeMap::new();
    let mut rest = tail;
    while let Some((flag, next)) = rest.split_first() {
        if !allowed.contains(flag) || options.contains_key(*flag) {
            return Err((
                2,
                format!(
                    "unknown or duplicate option: {flag} (accepted: {}; sigilc reads the workspace from --root DIR)",
                    allowed.join(" ")
                ),
            ));
        }
        if *flag == "--implementation" {
            options.insert((*flag).to_string(), "true".to_string());
            rest = next;
            continue;
        }
        let Some((value, remaining)) = next.split_first() else {
            return Err((2, format!("missing value for {flag}")));
        };
        options.insert((*flag).to_string(), (*value).to_string());
        rest = remaining;
    }
    Ok(options)
}

fn usage(message: String) -> (u8, String) {
    (2, message)
}

fn gate(message: String) -> (u8, String) {
    (1, message)
}

fn operational(message: String) -> (u8, String) {
    (3, message)
}
