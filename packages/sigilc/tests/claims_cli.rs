use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
};

mod support;
use support::{BASE, base_constraints, base_goal, base_interface};

struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "sigilc-cli-{}-{name}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }

    /// Write the shared design fixture, or a variant of its sources, as the workspace.
    fn workspace(&self, edit: impl Fn(&str, String) -> String) {
        let mut value = support::shared_value();
        for item in value["sources"].as_array_mut().unwrap() {
            let path = item["path"].as_str().unwrap().to_owned();
            let text = edit(&path, item["text"].as_str().unwrap().to_owned());
            item["text"] = serde_json::json!(text);
        }
        for item in value["sources"]
            .as_array()
            .unwrap()
            .iter()
            .chain(value["context"].as_array().unwrap())
        {
            if let Some(text) = item["text"].as_str() {
                let path = self.0.join(item["path"].as_str().unwrap());
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                fs::write(path, text).unwrap();
            }
        }
    }

    fn design_input(&self) -> sigilc::structure::DesignInput {
        sigilc::tree::design_input::load_design_input(&self.0, &self.0.join(".sigil")).unwrap()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn claims(args: &[&str]) -> (i32, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(args)
        .output()
        .expect("sigilc runs");
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
    let base_constraints = base_constraints();
    let base_goal = base_goal();
    let base_interface = base_interface();
    format!(
        "(reading {base_goal:?} \"no-commitment\")\n\
         (claim {base_interface:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
         (claim {base_constraints:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
    )
}

/// Prepare the shared design, then return the scratch workspace and the binding path.
fn prepared(name: &str) -> (Scratch, PathBuf) {
    let scratch = Scratch::new(name);
    scratch.workspace(|_, text| text);
    prepare_base(name, scratch)
}

/// The same design with Base's Constraints section written as a Logic section,
/// which provides a cached Step for admission.
fn prepared_with_cached_logic(name: &str) -> (Scratch, PathBuf) {
    let scratch = Scratch::new(name);
    scratch.workspace(|path, text| {
        if path == BASE {
            assert!(text.contains("constraints {"));
            text.replacen("constraints {", "logic {", 1)
        } else {
            text
        }
    });
    prepare_base(name, scratch)
}

fn prepare_base(_name: &str, scratch: Scratch) -> (Scratch, PathBuf) {
    let out = scratch.0.join("prep");
    let (code, stdout, stderr) = claims(&[
        "prepare",
        "--source",
        BASE,
        "--out",
        out.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let binding = out.join("binding.json");
    assert!(binding.exists());
    (scratch, binding)
}

// ------------------------------------------------------------------ the flow

#[test]
fn a_full_pass_prepares_interprets_and_ingests() {
    // Covers F1.
    let (scratch, binding) = prepared("flow");
    let artifact = scratch.0.join("result.egg");
    fs::write(&artifact, clean_artifact()).unwrap();

    let (code, stdout, stderr) = claims(&[
        "ingest",
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
    let base_constraints = base_constraints();
    let base_goal = base_goal();
    let base_interface = base_interface();
    let (scratch, binding) = prepared("gate");
    let artifact = scratch.0.join("result.egg");
    fs::write(
        &artifact,
        format!(
            "(reading {base_goal:?} \"no-commitment\")\n\
             (claim {base_interface:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
             (claim {base_constraints:?} \"Base\" \"provides\" \"value\" \"required\" \"false\")\n"
        ),
    )
    .unwrap();
    let (code, stdout, stderr) = claims(&[
        "ingest",
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
    let base_constraints = base_constraints();
    let base_goal = base_goal();
    let base_interface = base_interface();
    let (scratch, binding) = prepared("repeat");
    let first = scratch.0.join("first.egg");
    let second = scratch.0.join("second.egg");
    fs::write(&first, clean_artifact()).unwrap();
    fs::write(
        &second,
        format!(
            "(reading {base_goal:?} \"no-commitment\")\n\
             (claim {base_interface:?} \"Base\" \"provides\" \"result\" \"required\" \"true\")\n\
             (claim {base_constraints:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
        ),
    )
    .unwrap();

    let run = |extra: &[&str]| {
        let mut args = vec![
            "ingest",
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
        assert_eq!(entry["facet"], base_interface);
        assert_eq!(entry["section"], "interface");
    }
}

#[test]
fn a_supplied_cached_unit_is_compared_without_replacing_its_saved_reading() {
    let base_constraints = base_constraints();
    let base_goal = base_goal();
    let base_interface = base_interface();
    let (scratch, binding) = prepared("cached-repeat");
    let first = scratch.0.join("first.egg");
    fs::write(&first, clean_artifact()).unwrap();
    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        first.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");

    let out = scratch.0.join("prep-again");
    let (code, stdout, stderr) = claims(&[
        "prepare",
        "--source",
        BASE,
        "--out",
        out.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    assert_eq!(json(&stdout)["facets"], 0, "all first readings are cached");

    let second = scratch.0.join("second.egg");
    fs::write(
        &second,
        format!(
            "(reading {base_goal:?} \"no-commitment\")\n\
             (claim {base_interface:?} \"Base\" \"provides\" \"result\" \"required\" \"true\")\n\
             (claim {base_constraints:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
        ),
    )
    .unwrap();
    let second_binding = out.join("binding.json");
    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--binding",
        second_binding.to_str().unwrap(),
        "--claims",
        second.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let result = json(&stdout);
    let report = json(&fs::read_to_string(result["report"].as_str().unwrap()).unwrap());
    let disagreements = report["disagreements"].as_array().unwrap();
    assert_eq!(disagreements.len(), 2, "{report}");
    assert!(
        disagreements
            .iter()
            .any(|entry| { entry["facet"] == base_interface && entry["onlyIn"] == "first" })
    );
    assert!(
        disagreements
            .iter()
            .any(|entry| { entry["facet"] == base_interface && entry["onlyIn"] == "repeat" })
    );

    let context = json(&fs::read_to_string(result["judgmentContext"].as_str().unwrap()).unwrap());
    let interface = context["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|unit| unit["facet"] == base_interface)
        .unwrap();
    assert!(
        interface["asserted"]
            .as_array()
            .unwrap()
            .iter()
            .any(|claim| {
                claim["body"]["object"]
                    .as_str()
                    .is_some_and(|object| object.ends_with(":tag:value"))
            }),
        "the second reading must not replace the cached first reading: {context}"
    );

    // An explicit repeat is a separate comparison input. It must not suppress
    // the cached-unit second reading already carried by --claims.
    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--binding",
        second_binding.to_str().unwrap(),
        "--claims",
        second.to_str().unwrap(),
        "--claims-repeat",
        first.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let report = json(&fs::read_to_string(json(&stdout)["report"].as_str().unwrap()).unwrap());
    let disagreements = report["disagreements"].as_array().unwrap();
    assert_eq!(disagreements.len(), 2, "{report}");
}

#[test]
fn a_cached_logic_step_is_available_when_admitting_a_second_reading() {
    let (scratch, binding) = prepared_with_cached_logic("cached-step-admission");
    let input = scratch.design_input();
    let base_constraints = support::facet_in(&input, BASE, "logic");
    let base_goal = support::facet_in(&input, BASE, "goal");
    let base_interface = support::facet_in(&input, BASE, "interface");
    let first = scratch.0.join("first.egg");
    fs::write(
        &first,
        format!(
            "(reading {base_goal:?} \"no-commitment\")\n\
             (claim {base_interface:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
             (step {base_constraints:?} \"1\")\n"
        ),
    )
    .unwrap();
    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        first.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");

    let out = scratch.0.join("prep-again");
    let (code, stdout, stderr) = claims(&[
        "prepare",
        "--source",
        BASE,
        "--out",
        out.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    assert_eq!(json(&stdout)["facets"], 0);

    let second = scratch.0.join("second.egg");
    fs::write(
        &second,
        format!(
            "(reading {base_goal:?} \"no-commitment\")\n\
             (claim {base_goal:?} \"step:1\" \"reads\" \"Base\" \"required\" \"true\")\n"
        ),
    )
    .unwrap();
    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--binding",
        out.join("binding.json").to_str().unwrap(),
        "--claims",
        second.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(
        code, 0,
        "the stored Logic Step must be composed with the supplied Goal before admission: {stdout}{stderr}"
    );
}

#[test]
fn a_claim_for_a_facet_outside_the_request_is_refused_on_its_own() {
    let (scratch, binding) = prepared("foreign-facet");
    let artifact = scratch.0.join("result.egg");
    fs::write(
        &artifact,
        format!(
            "{}(claim \"facet:foreign.sigil:0\" \"Base\" \"provides\" \"value\" \"required\" \"true\")\n",
            clean_artifact()
        ),
    )
    .unwrap();

    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    // The row belongs to no unit, so it costs no unit: the clean rows beside it
    // are still read.
    assert_eq!(code, 0, "{stderr}");
    let result: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(result["refusalCount"], 1, "{stdout}");
    let refusal = &result["refusals"][0];
    assert!(refusal["unit"].is_null(), "{stdout}");
    assert!(
        refusal["reason"]
            .as_str()
            .unwrap()
            .contains("did not ask about"),
        "{stdout}"
    );
    assert!(
        refusal["row"]
            .as_str()
            .unwrap()
            .contains("facet:foreign.sigil:0"),
        "{stdout}"
    );
}

// ----------------------------------------------------------- binding refusal

#[test]
fn a_binding_that_does_not_match_the_current_source_is_refused() {
    let (scratch, binding) = prepared("stale-export");
    let artifact = scratch.0.join("result.egg");
    fs::write(&artifact, clean_artifact()).unwrap();

    let mut tampered = json(&fs::read_to_string(&binding).unwrap());
    tampered["sourceContent"] = serde_json::json!("a-different-source");
    fs::write(&binding, serde_json::to_vec(&tampered).unwrap()).unwrap();

    let (code, _, stderr) = claims(&[
        "ingest",
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 2, "{stderr}");
    assert!(stderr.contains("source content"), "{stderr}");
    assert!(stderr.contains("Prepare a new directory"), "{stderr}");
}

#[test]
fn a_binding_from_a_different_guidance_build_is_refused() {
    let (scratch, binding) = prepared("stale-guidance");
    let artifact = scratch.0.join("result.egg");
    fs::write(&artifact, clean_artifact()).unwrap();

    let mut tampered = json(&fs::read_to_string(&binding).unwrap());
    tampered["guidanceFingerprint"] = serde_json::json!("guidance-from-another-build");
    fs::write(&binding, serde_json::to_vec(&tampered).unwrap()).unwrap();

    let (code, _, stderr) = claims(&[
        "ingest",
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 2, "{stderr}");
    assert!(stderr.contains("guidance"), "{stderr}");
}

// ------------------------------------------------------------- exit contract

#[test]
fn the_tool_reports_the_merged_version_and_boundary() {
    let (code, stdout, _) = claims(&["--version"]);
    assert_eq!(code, 0);
    assert!(stdout.trim() == "sigilc 0.3.0", "{stdout}");

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
        vec![
            "ingest",
            "--frontend",
            "f.json",
            "--binding",
            "b",
            "--claims",
            "c",
        ],
    ] {
        let (code, _, stderr) = claims(&args);
        assert_eq!(code, 2, "{args:?} must be a usage error: {stderr}");
        if args.contains(&"--frontend") {
            assert!(stderr.contains("--root"), "{stderr}");
        }
    }

    let (code, _, stderr) = claims(&[
        "prepare",
        "--root",
        "/nonexistent/workspace",
        "--source",
        BASE,
        "--out",
        "/tmp/unused-claims-out",
    ]);
    assert_eq!(code, 3, "an unreadable input is operational: {stderr}");
}

#[test]
fn an_artifact_carrying_a_rule_is_a_gate_failure_not_a_crash() {
    let base_interface = base_interface();
    let (scratch, binding) = prepared("rule");
    let artifact = scratch.0.join("result.egg");
    fs::write(
        &artifact,
        format!(
            "(claim {base_interface:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
             (rule ((holds a b c)) ((reachable a b)))\n"
        ),
    )
    .unwrap();
    let (code, _, stderr) = claims(&[
        "ingest",
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
fn the_merged_compiler_exposes_design_commands_without_retired_worlds() {
    let output = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(output.status.success());
    let help = String::from_utf8_lossy(&output.stdout);
    assert!(help.starts_with("sigilc"));
    for command in [
        "align prepare --out",
        "prepare --source",
        "ingest --binding",
        "check",
        "extract-guidance",
        "tree",
        "clean",
    ] {
        assert!(help.contains(command), "missing merged command: {command}");
    }
    assert!(help.contains("extract-guidance [--implementation]"));
    for retired in [
        "prepare design",
        "compile design",
        "compare",
        "ontology",
        "stale",
    ] {
        assert!(!help.contains(retired), "retired command: {retired}");
    }
}

// ------------------------------------------------------- ownership annotations

#[test]
fn every_claims_module_is_owned_by_a_tag_the_contract_declares() {
    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    // The subsystem is owned by two contracts: the claims component, and the
    // vocabulary component that owns the accepted set and the atom discipline.
    // An annotation must name one of them and a Tag that contract declares.
    let tags_of = |contract: &str| -> Vec<String> {
        contract
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                trimmed
                    .strip_suffix(" {")
                    .filter(|name| {
                        name.chars().next().is_some_and(|c| c.is_ascii_uppercase())
                            && name.chars().all(|c| c.is_ascii_alphanumeric())
                    })
                    .map(str::to_owned)
            })
            .collect()
    };
    let owners: Vec<(&str, Vec<String>)> = vec![
        (
            "packages/sigilc/claims.sigil::SigilComputedClaims::",
            tags_of(&fs::read_to_string(crate_dir.join("claims.sigil")).unwrap()),
        ),
        (
            "packages/sigilc/vocabulary.sigil::SigilClaimsVocabulary::",
            tags_of(&fs::read_to_string(crate_dir.join("vocabulary.sigil")).unwrap()),
        ),
    ];
    assert!(
        owners[0].1.contains(&"ClaimsCommands".to_owned()),
        "expected the claims contract's concepts, got {:?}",
        owners[0].1
    );
    assert!(
        owners[1].1.contains(&"AcceptedVocabulary".to_owned()),
        "expected the vocabulary contract's concepts, got {:?}",
        owners[1].1
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
            let owner = owners
                .iter()
                .find(|(prefix, _)| annotation.contains(prefix))
                .unwrap_or_else(|| panic!("{name}: {annotation} names neither owning contract"));
            let tag = annotation
                .split(owner.0)
                .nth(1)
                .unwrap()
                .split_whitespace()
                .next()
                .unwrap();
            assert!(
                owner.1.iter().any(|declared| declared == tag),
                "{name} claims {tag}, which {} does not declare",
                owner.0
            );
        }
        checked += 1;
    }
    assert!(checked >= 8, "expected every claims module, saw {checked}");
}
