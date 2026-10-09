use sigilc::turtle::{CLASSES, ONTOLOGY, ontology_document, vocabulary};
use std::{
    io::{self, Write},
    process::ExitCode,
};

fn root_help() -> String {
    r#"sigilc — deterministic Semantic Worlds compiler

Commands (every command that reads a workspace takes [--root DIR] [--store DIR]):
  scope --scope FILE
  ontology [--format text|json]
  prepare design --source PATH --out NEW_DIR [--scope FILE]
  ingest design --source PATH --binding FILE --turtle FILE|- [--scope FILE]
  stale design [--scope FILE]
  compile design [--scope FILE] [--limits FILE] [--allow-empty]
  entities [--scope FILE] [--limits FILE] [--allow-empty]
  prepare implementation --source PATH --out NEW_DIR [--scope FILE]
  ingest implementation --source PATH --binding FILE --turtle FILE|- [--scope FILE]
  stale implementation (--selection FILE | --scope FILE)
  compile implementation (--selection FILE | --scope FILE)
  compare (--selection FILE | --scope FILE) [--limits FILE]
  tree [--source PATH] [--diff] [--root DIR] [--store DIR]
  clean [--root DIR] [--store DIR]

--root DIR is the workspace: sigilc reads its .sigil configuration, glossary and
sources directly (default: the current directory). --store DIR holds the
disposable projections and tree cache (default: ROOT/.sigil).

`tree` prints the resolved Merkle trees as deterministic JSON, for one source or
every source; --diff prints the Facets added, removed and changed since the
previous tree recorded for each source.

Scope and semantic compilation flow:
  1. Resolve ordered roots: sigilc scope --root . --scope scope.json
  2. Inspect freshness: sigilc stale design --root . --scope scope.json
  3. Prepare/ingest only stale, missing or dependency-invalid rows, then compile,
     export entities and compare.
  4. Compile Design and export entities.
  5. Prepare and ingest Implementation sources.
  6. Compile Implementation and compare semantic worlds.

Gate exits: 0 = Coherent/Loose (Design), Closed/Converged (Implementation).
1 = Disjoint (Design), Drift (Implementation). Loose/Converged are warnings.
2 = usage; 3 = operational failure or unavailable comparison.
"#
    .into()
}

fn main() -> ExitCode {
    match run() {
        Ok((code, output)) => match io::stdout().write_all(output.as_bytes()) {
            Ok(()) => ExitCode::from(code),
            Err(error) => {
                let _ = writeln!(io::stderr(), "{error}");
                ExitCode::from(3)
            }
        },
        Err((code, message)) => {
            let _ = writeln!(io::stderr(), "{message}");
            ExitCode::from(code)
        }
    }
}

fn run() -> sigilc::cli::Output {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let args: Vec<_> = args.iter().map(String::as_str).collect();
    let output = match args.as_slice() {
        ["--version"] => format!("sigilc {}\n", env!("CARGO_PKG_VERSION")),
        ["--help"] | ["-h"] => root_help(),
        ["ontology", "--format", "json"] => {
            serde_json::to_string_pretty(&ontology_document()).map_err(|e| (3, e.to_string()))?
                + "\n"
        }
        ["ontology"] | ["ontology", "--format", "text"] => {
            let properties = vocabulary()
                .into_iter()
                .map(|(name, range)| format!("{name} ({range})"))
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "RDF 1.1 Turtle: @prefix sigil: <{ONTOLOGY}> .\nClasses: {}.\nProperties: {properties}.\nUse named resources and direct assertions only; no blank nodes, rules, derived relations, or evidence claims.\nNumbers are finite and nonnegative, at most 9007199254740991; risk is at most 1.\n",
                CLASSES.join(", ")
            )
        }
        _ => return sigilc::cli::run(&args),
    };
    Ok((0, output))
}
