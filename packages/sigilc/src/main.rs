use sigilc::turtle::{CLASSES, ONTOLOGY, ontology_document, vocabulary};
use std::{
    io::{self, Write},
    process::ExitCode,
};

fn root_help() -> String {
    r#"sigilc — deterministic Semantic Worlds compiler

Commands:
  scope --frontend FILE --scope FILE
  ontology [--format text|json]
  prepare design --frontend FILE --source PATH --out NEW_DIR [--scope FILE]
  ingest design --frontend FILE --source PATH --binding FILE --turtle FILE|- [--scope FILE]
  stale design --frontend FILE [--scope FILE]
  compile design --frontend FILE [--scope FILE] [--limits FILE] [--allow-empty]
  entities --frontend FILE [--scope FILE] [--limits FILE] [--allow-empty]
  prepare implementation --frontend FILE --source PATH --out NEW_DIR [--scope FILE]
  ingest implementation --frontend FILE --source PATH --binding FILE --turtle FILE|- [--scope FILE]
  stale implementation --frontend FILE (--selection FILE | --scope FILE)
  compile implementation --frontend FILE (--selection FILE | --scope FILE)
  compare --frontend FILE (--selection FILE | --scope FILE) [--limits FILE]
  clean [--root DIR]

Scope and semantic compilation flow:
  1. Export structural input: sigil export design . > frontend.json
  2. Resolve ordered roots: sigilc scope --frontend frontend.json --scope scope.json
  3. Inspect freshness: sigilc stale design --frontend frontend.json --scope scope.json
  4. Prepare/ingest only stale, missing or dependency-invalid rows, then compile,
     export entities and compare.
  5. Compile Design and export entities.
  6. Prepare and ingest Implementation sources.
  7. Compile Implementation and compare semantic worlds.

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
