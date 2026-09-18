use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
};

mod support;

const BASE: &str = "base.sigil";
const BASE_GOAL: &str = "facet:base.sigil:29";
const BASE_INTERFACE: &str = "facet:base.sigil:71";
const BASE_CONSTRAINTS: &str = "facet:base.sigil:129";

struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "sigil-claims-cli-{}-{name}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }

    /// The shared design export, written out exactly as `sigil export design`
    /// would produce it.
    fn frontend(&self) -> PathBuf {
        let path = self.0.join("frontend.json");
        fs::write(
            &path,
            serde_json::to_vec_pretty(&support::shared_value()).unwrap(),
        )
        .unwrap();
        path
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn claims(args: &[&str]) -> (i32, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_sigil-claims"))
        .args(args)
        .output()
        .expect("sigil-claims runs");
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

fn json(text: &str) -> serde_json::Value {
    serde_json::from_str(text).unwrap_or_else(|e| panic!("not JSON: {e}\n{text}"))
}

fn clean_artifact() -> String {
    format!(
        "(reading {BASE_GOAL:?} \"no-commitment\")\n\
         (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
         (claim {BASE_CONSTRAINTS:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
    )
}

/// Prepare, then return the scratch root, the export path and the binding path.
fn prepared(name: &str) -> (Scratch, PathBuf, PathBuf) {
    let scratch = Scratch::new(name);
    let frontend = scratch.frontend();
    let out = scratch.0.join("prep");
    let (code, stdout, stderr) = claims(&[
        "prepare",
        "--frontend",
        frontend.to_str().unwrap(),
        "--source",
        BASE,
        "--out",
        out.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let binding = out.join("binding.json");
    assert!(binding.exists());
    (scratch, frontend, binding)
}

// ------------------------------------------------------------------ the flow

#[test]
fn a_full_pass_prepares_interprets_and_ingests() {
    // Covers F1.
    let (scratch, frontend, binding) = prepared("flow");
    let artifact = scratch.0.join("result.egg");
    fs::write(&artifact, clean_artifact()).unwrap();

    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let result = json(&stdout);
    assert_eq!(result["state"], "coherent", "{stdout}");
    assert_eq!(result["findings"], 0);
    assert_eq!(result["source"], BASE);

    // Both artifacts land under the store this component owns.
    let report = Path::new(result["report"].as_str().unwrap());
    let context = Path::new(result["judgmentContext"].as_str().unwrap());
    assert!(report.starts_with(scratch.0.join(".sigil/claims")));
    assert!(context.starts_with(scratch.0.join(".sigil/claims")));
    let context = json(&fs::read_to_string(context).unwrap());
    assert_eq!(
        context["units"].as_array().unwrap().len(),
        3,
        "every unit reaches the judge"
    );
}

#[test]
fn a_design_level_contradiction_exits_one_and_names_its_findings() {
    let (scratch, frontend, binding) = prepared("gate");
    let artifact = scratch.0.join("result.egg");
    fs::write(
        &artifact,
        format!(
            "(reading {BASE_GOAL:?} \"no-commitment\")\n\
             (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
             (claim {BASE_CONSTRAINTS:?} \"Base\" \"provides\" \"value\" \"required\" \"false\")\n"
        ),
    )
    .unwrap();
    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 1, "a gate failure exits 1: {stdout}{stderr}");
    assert_eq!(json(&stdout)["state"], "disjoint");
}

#[test]
fn a_repeat_interpretation_is_reported_only_when_supplied() {
    let (scratch, frontend, binding) = prepared("repeat");
    let first = scratch.0.join("first.egg");
    let second = scratch.0.join("second.egg");
    fs::write(&first, clean_artifact()).unwrap();
    fs::write(
        &second,
        format!(
            "(reading {BASE_GOAL:?} \"no-commitment\")\n\
             (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"result\" \"required\" \"true\")\n\
             (claim {BASE_CONSTRAINTS:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
        ),
    )
    .unwrap();

    let run = |extra: &[&str]| {
        let mut args = vec![
            "ingest",
            "--frontend",
            frontend.to_str().unwrap(),
            "--binding",
            binding.to_str().unwrap(),
            "--claims",
            first.to_str().unwrap(),
            "--root",
            scratch.0.to_str().unwrap(),
        ];
        args.extend_from_slice(extra);
        let (code, stdout, stderr) = claims(&args);
        assert_eq!(code, 0, "{stdout}{stderr}");
        let path = json(&stdout)["report"].as_str().unwrap().to_string();
        json(&fs::read_to_string(path).unwrap())
    };

    let without = run(&[]);
    assert!(
        without.get("disagreements").is_none(),
        "the comparison costs an extra interpretation: {without}"
    );

    let with = run(&["--claims-repeat", second.to_str().unwrap()]);
    let entries = with["disagreements"].as_array().unwrap();
    assert_eq!(entries.len(), 2, "{with}");
    for entry in entries {
        assert_eq!(entry["facet"], BASE_INTERFACE);
        assert_eq!(entry["section"], "interface");
    }
}

// ----------------------------------------------------------- binding refusal

#[test]
fn a_binding_that_does_not_match_the_supplied_export_is_refused() {
    let (scratch, frontend, binding) = prepared("stale-export");
    let artifact = scratch.0.join("result.egg");
    fs::write(&artifact, clean_artifact()).unwrap();

    let mut tampered = json(&fs::read_to_string(&binding).unwrap());
    tampered["exportDigest"] = serde_json::json!("a-different-export");
    fs::write(&binding, serde_json::to_vec(&tampered).unwrap()).unwrap();

    let (code, _, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 2, "{stderr}");
    assert!(stderr.contains("export digest"), "{stderr}");
    assert!(stderr.contains("Prepare a new directory"), "{stderr}");
}

#[test]
fn a_binding_from_a_different_guidance_build_is_refused() {
    let (scratch, frontend, binding) = prepared("stale-guidance");
    let artifact = scratch.0.join("result.egg");
    fs::write(&artifact, clean_artifact()).unwrap();

    let mut tampered = json(&fs::read_to_string(&binding).unwrap());
    tampered["guidanceFingerprint"] = serde_json::json!("guidance-from-another-build");
    fs::write(&binding, serde_json::to_vec(&tampered).unwrap()).unwrap();

    let (code, _, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 2, "{stderr}");
    assert!(stderr.contains("guidance fingerprint"), "{stderr}");
}

// ------------------------------------------------------------- exit contract

#[test]
fn the_tool_names_itself_and_not_the_compiler() {
    let (code, stdout, _) = claims(&["--version"]);
    assert_eq!(code, 0);
    assert!(stdout.starts_with("sigil-claims "), "{stdout}");

    let (code, stdout, _) = claims(&["--help"]);
    assert_eq!(code, 0);
    assert!(stdout.contains("computed design validation"), "{stdout}");
    assert!(
        stdout.contains("never launches a model"),
        "the boundary belongs in the help text: {stdout}"
    );
}

#[test]
fn a_usage_error_exits_two_and_an_unreadable_input_exits_three() {
    for args in [
        vec!["nonsense"],
        vec![],
        vec!["prepare", "--frontend", "f.json"],
        vec!["ingest", "--unknown", "x"],
        vec!["prepare", "--frontend"],
    ] {
        let (code, _, stderr) = claims(&args);
        assert_eq!(code, 2, "{args:?} must be a usage error: {stderr}");
    }

    let (code, _, stderr) = claims(&[
        "prepare",
        "--frontend",
        "/nonexistent/frontend.json",
        "--source",
        BASE,
        "--out",
        "/tmp/unused-claims-out",
    ]);
    assert_eq!(code, 3, "an unreadable input is operational: {stderr}");
}

#[test]
fn an_artifact_carrying_a_rule_is_a_gate_failure_not_a_crash() {
    let (scratch, frontend, binding) = prepared("rule");
    let artifact = scratch.0.join("result.egg");
    fs::write(
        &artifact,
        format!(
            "(claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
             (rule ((holds a b c)) ((reachable a b)))\n"
        ),
    )
    .unwrap();
    let (code, _, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 1, "{stderr}");
    assert!(stderr.contains("claim data only"), "{stderr}");
}

// --------------------------------------------------------------- guidance

#[test]
fn guidance_extracts_to_a_named_directory() {
    let scratch = Scratch::new("extract");
    let out = scratch.0.join("guidance");
    let (code, stdout, stderr) = claims(&[
        "extract-guidance",
        "--out",
        out.to_str().unwrap(),
        "--root",
        std::env::temp_dir().join("elsewhere").to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let written = json(&stdout)["written"].as_array().unwrap().len();
    assert_eq!(written, 4, "{stdout}");
    for name in ["sections.md", "vocabulary.md", "examples.md", "rejected.md"] {
        assert!(out.join(name).exists(), "{name} was not extracted");
    }
}

#[test]
fn guidance_is_refused_when_it_would_land_in_the_workspace_under_validation() {
    let scratch = Scratch::new("refuse");
    let inside = scratch.0.join("guidance");
    let (code, _, stderr) = claims(&[
        "extract-guidance",
        "--out",
        inside.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 2, "{stderr}");
    assert!(!inside.exists(), "a refused extraction writes nothing");
}

// ---------------------------------------------------------- the compiler

#[test]
fn the_compilers_own_command_surface_is_unchanged() {
    let output = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .arg("--help")
        .output()
        .unwrap();
    let help = String::from_utf8_lossy(&output.stdout);
    assert!(help.starts_with("sigilc — deterministic Semantic Worlds compiler"));
    for command in [
        "prepare design",
        "ingest design",
        "compile design",
        "compare",
        "clean",
    ] {
        assert!(
            help.contains(command),
            "{command} vanished from sigilc help"
        );
    }
    assert!(
        !help.contains("sigil-claims"),
        "the compiler must not advertise another binary's commands"
    );
}

// ------------------------------------------------------- ownership annotations

#[test]
fn every_claims_module_is_owned_by_a_tag_the_contract_declares() {
    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let contract = fs::read_to_string(crate_dir.join("claims.sigil")).unwrap();
    let declared: Vec<&str> = contract
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            trimmed.strip_suffix(" {").filter(|name| {
                name.chars().next().is_some_and(|c| c.is_ascii_uppercase())
                    && name.chars().all(|c| c.is_ascii_alphanumeric())
            })
        })
        .collect();
    assert!(
        declared.contains(&"ClaimsCommands"),
        "expected the contract's concepts, got {declared:?}"
    );

    let mut checked = 0;
    for entry in fs::read_dir(crate_dir.join("src/claims")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let name = path.file_name().unwrap().to_str().unwrap().to_owned();
        if name == "mod.rs" {
            continue; // Module declarations only; no entrypoint to own.
        }
        let text = fs::read_to_string(&path).unwrap();
        let annotations: Vec<&str> = text
            .lines()
            .filter(|l| l.contains("@sigil implements"))
            .collect();
        assert!(
            !annotations.is_empty(),
            "{name} carries no ownership annotation"
        );
        for annotation in annotations {
            assert!(
                annotation.contains("packages/sigilc/claims.sigil::SigilComputedClaims::"),
                "{name}: {annotation}"
            );
            let tag = annotation
                .split("SigilComputedClaims::")
                .nth(1)
                .unwrap()
                .split_whitespace()
                .next()
                .unwrap();
            assert!(
                declared.contains(&tag),
                "{name} claims {tag}, which the contract does not declare"
            );
        }
        checked += 1;
    }
    assert!(checked >= 8, "expected every claims module, saw {checked}");
}
