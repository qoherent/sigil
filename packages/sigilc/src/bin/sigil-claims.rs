//! Computed design validation, beside the compiler and sharing its runtime.
//!
//! Cargo discovers this target because it lives under `src/bin/`, so no
//! manifest change is needed — which matters: `Cargo.toml` is one of the files
//! `eqval::fingerprint()` hashes, and editing it would invalidate every stored
//! world.
use std::{
    io::{self, Write},
    process::ExitCode,
};

fn main() -> ExitCode {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let args: Vec<_> = args.iter().map(String::as_str).collect();
    match sigilc::claims::cli::run(&args) {
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
