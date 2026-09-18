//! The command boundary for computed design validation.
//!
//! Deterministic, like the compiler's: no process launchers and no model
//! options. The external interpretation is an input the caller supplies and can
//! supply again, which is what makes a run reproducible.
use super::{context, dialect, findings, guidance, identity, prepare, program, vocabulary};
use crate::{cli::Output, eqval, frontend::DesignInput};
use std::{collections::BTreeMap, path::Path};

const MAX_FRONTEND_BYTES: u64 = 64_000_000;
const MAX_BINDING_BYTES: u64 = 16_000_000;

pub fn help() -> String {
    r#"sigil-claims — computed design validation

Commands:
  prepare --frontend FILE --source PATH --out NEW_DIR
  ingest --frontend FILE --binding FILE --claims FILE|- [--claims-repeat FILE|-] [--root DIR]
  extract-guidance --out DIR [--root DIR]

Flow:
  1. Export structural input:  sigil export design . > frontend.json
  2. Prepare one source:       sigil-claims prepare --frontend frontend.json \
                                 --source a.sigil --out claims-a
  3. An external interpreter reads claims-a and writes Datalog claims.
  4. Ingest the result:        sigil-claims ingest --frontend frontend.json \
                                 --binding claims-a/binding.json --claims claims-a/result.egg

This command never launches a model. Step 3 is the caller's, and passing the
same artifact again reproduces the same report.

Gate exits: 0 = coherent or loose, 1 = disjoint, 2 = usage, 3 = operational
failure.
"#
    .into()
}

/// Parse and run one invocation.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ClaimsCommands interface,constraints
pub fn run(args: &[&str]) -> Output {
    let (command, tail) = match args {
        [] => return Err((2, "Expected a command. Run sigil-claims --help.".into())),
        ["--help"] | ["-h"] => return Ok((0, help())),
        ["--version"] => {
            return Ok((0, format!("sigil-claims {}\n", env!("CARGO_PKG_VERSION"))));
        }
        [
            command @ ("prepare" | "ingest" | "extract-guidance"),
            tail @ ..,
        ] => (*command, tail),
        _ => return Err((2, "Invalid command. Run sigil-claims --help.".into())),
    };

    let allowed: &[&str] = match command {
        "prepare" => &["--frontend", "--source", "--out", "--root"],
        "ingest" => &[
            "--frontend",
            "--binding",
            "--claims",
            "--claims-repeat",
            "--root",
        ],
        _ => &["--out", "--root"],
    };
    let options = parse(tail, allowed)?;
    let required = |flag: &str| required_in(&options, flag);
    let root = options
        .get("--root")
        .cloned()
        .unwrap_or_else(|| ".".to_string());

    match command {
        "extract-guidance" => {
            let out = required("--out")?;
            let written = guidance::extract(Path::new(&out), Path::new(&root)).map_err(usage)?;
            json(
                0,
                &serde_json::json!({
                    "version": findings::REPORT_VERSION,
                    "guidanceFingerprint": guidance::fingerprint(),
                    "written": written,
                }),
            )
        }
        "prepare" => {
            // Every required flag is resolved before anything is opened, so a
            // missing option is a usage error rather than whatever the
            // filesystem happens to say about the file that was supplied.
            let (frontend_path, source, out) = (
                required("--frontend")?,
                required("--source")?,
                required("--out")?,
            );
            let input = frontend(&frontend_path)?;
            let request = prepare::project(&input, &source).map_err(usage)?;
            let written = prepare::write(&request, Path::new(&out)).map_err(operational)?;
            json(
                0,
                &serde_json::json!({
                    "version": findings::REPORT_VERSION,
                    "binding": Path::new(&out).join("binding.json"),
                    "inputs": written,
                    "facets": request.rows.len(),
                    "bindingDigest": request.binding.digest(),
                }),
            )
        }
        _ => ingest(&options, &root),
    }
}

fn ingest(options: &BTreeMap<String, String>, root: &str) -> Output {
    let (frontend_path, binding_path, claims_path) = (
        required_in(options, "--frontend")?,
        required_in(options, "--binding")?,
        required_in(options, "--claims")?,
    );
    let input = frontend(&frontend_path)?;
    let supplied: prepare::Binding = serde_json::from_slice(
        &crate::cli::read(&binding_path, MAX_BINDING_BYTES).map_err(operational)?,
    )
    .map_err(|e| operational(format!("{binding_path}: {e}")))?;

    // The request is recomputed from the export now, and the supplied binding
    // has to match it exactly. A stale binding cannot be paired with a fresh
    // export, and a guidance change invalidates the pair the same way.
    let request = prepare::project(&input, &supplied.source).map_err(usage)?;
    if request.binding != supplied {
        return Err((2, mismatch(&request.binding, &supplied)));
    }

    let limits = dialect::Limits::default();
    let first_text = artifact(&claims_path, limits)?;
    let rows = dialect::parse(&first_text, limits).map_err(gate)?;
    let facts = identity::admit(&request, &input, &rows).map_err(gate)?;

    let mut digests = vec![crate::sources::hash(first_text.as_bytes())];
    let repeat = match options.get("--claims-repeat") {
        Some(path) => {
            let text = artifact(path, limits)?;
            digests.push(crate::sources::hash(text.as_bytes()));
            let rows = dialect::parse(&text, limits).map_err(gate)?;
            Some(identity::admit(&request, &input, &rows).map_err(gate)?)
        }
        None => None,
    };

    let world = program::saturate(&request, &facts, eqval::Limits::default()).map_err(gate)?;
    let mut report = findings::report(&request, &facts, &world, &digests);
    if let Some(repeat) = &repeat {
        findings::attach(&mut report, findings::disagreements(&facts, repeat));
    }
    let context = context::build(&request, &facts, &world, report.identity.clone());

    let report_path = findings::write(&report, Path::new(root)).map_err(operational)?;
    let context_path = findings::store(&context, Path::new(root), &context.source, ".context.json")
        .map_err(operational)?;

    let code = match report.state {
        findings::State::Disjoint => 1,
        _ => 0,
    };
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
        }),
    )
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
        "export digest",
        &current.export_digest,
        &supplied.export_digest,
    );
    note(
        "guidance fingerprint",
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
    if current.closure != supplied.closure {
        differences.push("resolved closure".into());
    }
    if current.facets != supplied.facets {
        differences.push("declared Facets".into());
    }
    if differences.is_empty() {
        differences.push("binding contents".into());
    }
    format!(
        "binding does not match the supplied export: {}. Prepare a new directory.",
        differences.join(", ")
    )
}

fn frontend(path: &str) -> Result<DesignInput, (u8, String)> {
    let bytes = crate::cli::read(path, MAX_FRONTEND_BYTES).map_err(operational)?;
    DesignInput::parse(&bytes).map_err(operational)
}

fn artifact(path: &str, limits: dialect::Limits) -> Result<String, (u8, String)> {
    let bytes = crate::cli::read(path, limits.max_document_bytes as u64).map_err(operational)?;
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
            return Err((2, format!("unknown or duplicate option: {flag}")));
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

fn json(code: u8, value: &impl serde::Serialize) -> Output {
    Ok((
        code,
        serde_json::to_string_pretty(value).map_err(|e| operational(e.to_string()))? + "\n",
    ))
}
