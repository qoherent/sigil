//! The deterministic command boundary. No process launchers or model options.
use crate::command::{Output, json, store_dir};
use std::path::Path;

pub fn help() -> String {
    crate::claims::cli::help().replace(
        "Commands:\n",
        "Commands:\n  align check [--root DIR] [--store DIR]\n  align prepare --out NEW_DIR [--root DIR] [--store DIR]\n  align ingest --binding FILE --claims FILE [--root DIR] [--store DIR]\n  tree [--source PATH] [--diff] [--root DIR] [--store DIR]\n  clean [--root DIR] [--store DIR]\n",
    )
}

pub fn run(args: &[&str]) -> Output {
    if args.first() == Some(&"align") {
        return crate::align::cli::run(&args[1..]);
    }
    if matches!(
        args.first(),
        Some(&("prepare" | "ingest" | "check" | "extract-guidance"))
    ) {
        return crate::claims::cli::run(args);
    }
    if args.first() == Some(&"tree") {
        return crate::tree::command::run(&args[1..]);
    }
    if args.first() == Some(&"clean") {
        let (root, store) = match args {
            ["clean"] => (".", None),
            ["clean", "--root", root] => (*root, None),
            ["clean", "--store", store] => (".", Some(*store)),
            ["clean", "--root", root, "--store", store]
            | ["clean", "--store", store, "--root", root] => (*root, Some(*store)),
            _ => return Err((2, "Usage: sigilc clean [--root DIR] [--store DIR]".into())),
        };
        let store = store_dir(Path::new(root), store);
        let removed =
            crate::store::clean_in(Path::new(root), &store).map_err(|message| (3, message))?;
        return json(0, &serde_json::json!({"version": 2, "removed": removed}));
    }
    Err((2, "Invalid command or options. Run sigilc --help.".into()))
}
