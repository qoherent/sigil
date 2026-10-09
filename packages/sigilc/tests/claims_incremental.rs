//! Claims over trees: what `prepare` requests after an edit, what `ingest`
//! accepts after one, and how a stored reading is re-grounded without a model.
//!
//! Every test drives the `sigil-claims` binary against a real `.sigil`
//! workspace, the way a caller does.
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
};

mod support;
use support::Workspace;

fn claims(args: &[&str]) -> (i32, Value, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_sigil-claims"))
        .args(args)
        .output()
        .expect("sigil-claims runs");
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    (
        output.status.code().unwrap_or(-1),
        serde_json::from_str(&stdout).unwrap_or(Value::Null),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

struct Run {
    ws: Workspace,
    store: Option<PathBuf>,
}

/// What one `prepare` produced.
struct Prepared {
    out: PathBuf,
    summary: Value,
}

impl Prepared {
    fn requested(&self) -> u64 {
        self.summary["requestedUnits"].as_u64().unwrap()
    }
    fn reused(&self) -> u64 {
        self.summary["reusedUnits"].as_u64().unwrap()
    }
    fn regrounded(&self) -> u64 {
        self.summary["regroundedUnits"].as_u64().unwrap()
    }
    fn request(&self) -> Value {
        serde_json::from_slice(&fs::read(self.out.join("request.json")).unwrap()).unwrap()
    }
    /// The presented interpretation targets, as `(facet id, section, prose)`.
    fn targets(&self) -> Vec<(String, String, String)> {
        self.request()["rows"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|r| r["context"] != true)
            .map(|r| {
                (
                    r["facet"].as_str().unwrap().to_owned(),
                    r["section"].as_str().unwrap().to_owned(),
                    r["prose"].as_str().unwrap().to_owned(),
                )
            })
            .collect()
    }
    fn prose(&self) -> Vec<String> {
        let mut prose: Vec<_> = self
            .targets()
            .into_iter()
            .map(|t| t.2.trim().to_owned())
            .collect();
        prose.sort();
        prose
    }
    fn facet(&self, needle: &str) -> String {
        let found: Vec<_> = self
            .targets()
            .into_iter()
            .filter(|t| t.2.contains(needle))
            .collect();
        assert_eq!(found.len(), 1, "one Facet holds `{needle}`: {found:?}");
        found[0].0.clone()
    }
    fn binding(&self) -> PathBuf {
        self.out.join("binding.json")
    }
}

impl Run {
    fn new() -> Self {
        Self {
            ws: Workspace::new(),
            store: None,
        }
    }

    fn write(&self, path: &str, text: &str) {
        self.ws.write(path, text.as_bytes());
    }

    fn root(&self) -> &str {
        self.ws.0.to_str().unwrap()
    }

    fn store_args(&self) -> Vec<String> {
        self.store
            .iter()
            .flat_map(|s| ["--store".to_owned(), s.display().to_string()])
            .collect()
    }

    fn prepare(&self, source: &str) -> Prepared {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let out = self
            .ws
            .0
            .join(format!("prep-{}", NEXT.fetch_add(1, Ordering::Relaxed)));
        let mut args = vec![
            "prepare".to_owned(),
            "--source".into(),
            source.into(),
            "--out".into(),
            out.display().to_string(),
            "--root".into(),
            self.root().into(),
        ];
        args.extend(self.store_args());
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        let (code, summary, stderr) = claims(&args);
        assert_eq!(code, 0, "{summary}{stderr}");
        Prepared { out, summary }
    }

    fn ingest(&self, binding: &Path, artifact: &str) -> (i32, Value, String) {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let file = self.ws.0.join(format!(
            "result-{}.egg",
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::write(&file, artifact).unwrap();
        let mut args = vec![
            "ingest".to_owned(),
            "--binding".into(),
            binding.display().to_string(),
            "--claims".into(),
            file.display().to_string(),
            "--root".into(),
            self.root().into(),
        ];
        args.extend(self.store_args());
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        claims(&args)
    }

    /// A `reading` row for every presented target.
    fn readings(prepared: &Prepared) -> String {
        prepared
            .targets()
            .iter()
            .map(|(facet, _, _)| format!("(reading {facet:?} \"no-commitment\")\n"))
            .collect()
    }

    /// Prepare a source and answer every presented unit with a reading.
    fn read(&self, source: &str) -> Prepared {
        let prepared = self.prepare(source);
        let (code, summary, stderr) = self.ingest(&prepared.binding(), &Self::readings(&prepared));
        assert_eq!(code, 0, "{summary}{stderr}");
        prepared
    }

    fn store_dir(&self) -> PathBuf {
        self.store
            .clone()
            .unwrap_or_else(|| self.ws.0.join(".sigil"))
    }

    fn report(&self, source: &str) -> Value {
        let path = self
            .store_dir()
            .join("claims")
            .join(format!("{source}.json"));
        serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
    }
}

fn laws(report: &Value) -> Vec<String> {
    report["findings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["law"].as_str().unwrap().to_owned())
        .collect()
}

const A: &str = "a.sigil";
const B: &str = "b.sigil";

fn a_source(interface: &str) -> String {
    format!(
        "component A {{
  goal {{
    Provide the shared vocabulary.
  }}
  interface {{
    {interface}
  }}
  state {{
    The *private ledger* is kept.
  }}
  logic {{
    Read the private ledger.

    Write the private ledger.
  }}
  constraints {{
    The private ledger never leaves A.
  }}
}}
"
    )
}

const A_INTERFACE: &str = "A *X* is exposed and a *Y* too.";

fn b_source(goal: &str) -> String {
    format!(
        "@a.sigil from A import {{ X, Y }}
component B {{
  goal {{
    {goal}
  }}
  constraints {{
    Never drop X.

    Keep it quick.
  }}
}}
"
    )
}

const B_GOAL: &str = "Use X well.";

fn pair() -> Run {
    let run = Run::new();
    run.write(A, &a_source(A_INTERFACE));
    run.write(B, &b_source(B_GOAL));
    run
}

// ------------------------------------------------------------------- AE1

#[test]
fn reformatting_every_source_makes_prepare_request_nothing() {
    let run = pair();
    run.read(A);
    run.read(B);

    run.write(
        A,
        &format!(
            "\n\n{}\n\n",
            a_source(A_INTERFACE)
                .replace(
                    "Provide the shared vocabulary.",
                    "Provide   the\n      shared vocabulary."
                )
                .replace(
                    "Read the private ledger.",
                    "Read\n    the private    ledger."
                )
                .replace("  ", "      ")
        ),
    );
    run.write(
        B,
        &format!(
            "\n{}",
            b_source(B_GOAL).replace("Keep it quick.", "Keep   it\n quick.")
        ),
    );
    for source in [A, B] {
        let prepared = run.prepare(source);
        assert_eq!(prepared.requested(), 0, "{source}: {}", prepared.summary);
        assert!(prepared.reused() > 0);
        assert!(prepared.targets().is_empty());
    }
}

// ------------------------------------------------------------------- AE3

#[test]
fn swapping_non_logic_facets_requests_nothing_and_swapping_logic_requests_its_section() {
    let run = Run::new();
    let source = |constraints: [&str; 3], logic: [&str; 3]| {
        format!(
            "component C {{
  goal {{
    Do the work.
  }}
  constraints {{
    {}

    {}

    {}
  }}
  logic {{
    {}

    {}

    {}
  }}
}}
",
            constraints[0], constraints[1], constraints[2], logic[0], logic[1], logic[2]
        )
    };
    let constraints = ["Rule one.", "Rule two.", "Rule three."];
    let logic = ["First step.", "Second step.", "Third step."];
    run.write("c.sigil", &source(constraints, logic));
    run.read("c.sigil");

    run.write(
        "c.sigil",
        &source(["Rule three.", "Rule one.", "Rule two."], logic),
    );
    let prepared = run.prepare("c.sigil");
    assert_eq!(prepared.requested(), 0, "{}", prepared.summary);

    run.write(
        "c.sigil",
        &source(constraints, ["Second step.", "First step.", "Third step."]),
    );
    let prepared = run.prepare("c.sigil");
    assert_eq!(prepared.requested(), 1, "{}", prepared.summary);
    assert_eq!(
        prepared.prose(),
        vec!["First step.", "Second step.", "Third step."],
        "exactly the Logic section, whole"
    );
    assert!(prepared.targets().iter().all(|t| t.1 == "logic"));
}

// ------------------------------------------------------------------- AE6

/// B names `X` (referenced in its goal) and `Y` (visible through A's
/// interface, never referenced), then both are read.
fn read_with_claims(run: &Run) -> Prepared {
    run.read(A);
    let prepared = run.prepare(B);
    let goal = prepared.facet("Use X");
    let readings: String = prepared
        .targets()
        .iter()
        .filter(|t| t.0 != goal)
        .map(|(facet, _, _)| format!("(reading {facet:?} \"no-commitment\")\n"))
        .collect();
    let (code, summary, stderr) = run.ingest(
        &prepared.binding(),
        &format!("(claim {goal:?} \"B\" \"uses\" \"X\" \"required\" \"true\")\n{readings}"),
    );
    assert_eq!(code, 0, "{summary}{stderr}");
    prepared
}

#[test]
fn changing_an_interface_while_its_tag_survives_regrounds_without_a_request() {
    let run = pair();
    read_with_claims(&run);

    run.write(
        A,
        &a_source("A *X* is exposed, now described at more length, and a *Y* too."),
    );
    let prepared = run.prepare(B);
    assert_eq!(prepared.requested(), 0, "{}", prepared.summary);
    assert!(prepared.regrounded() > 0, "the stored context is refreshed");
    // The edited interface unit is A's to read: it is not asked of B.
    assert!(prepared.targets().is_empty());
    assert_eq!(prepared.summary["uninterpretedContext"], 1);

    // The refresh was written back: a second prepare re-checks nothing.
    let again = run.prepare(B);
    assert_eq!(again.requested(), 0);
    assert_eq!(again.regrounded(), 0);
}

#[test]
fn an_edited_interface_is_requested_by_its_own_source_and_listed_for_its_dependent() {
    let run = pair();
    read_with_claims(&run);
    run.write(
        A,
        &a_source("A *X* is exposed, now described at more length, and a *Y* too."),
    );

    // B is prepared and ingested first: nothing to read, one context gap.
    let prepared = run.prepare(B);
    assert_eq!(prepared.requested(), 0);
    let (code, summary, stderr) = run.ingest(&prepared.binding(), "");
    assert_eq!(code, 0, "{summary}{stderr}");
    let report = run.report(B);
    let context: Vec<_> = report["findings"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["law"] == "uninterpreted-context")
        .collect();
    assert_eq!(context.len(), 1, "{report}");
    assert!(
        context[0]["component"]
            .as_str()
            .unwrap()
            .contains("a.sigil")
    );

    // A's own prepare asks for exactly the edited interface Facet.
    let own = run.prepare(A);
    assert_eq!(own.requested(), 1, "{}", own.summary);
    assert_eq!(own.prose().len(), 1);
    assert!(own.prose()[0].contains("described at more length"));
    let (code, summary, stderr) = run.ingest(&own.binding(), &Run::readings(&own));
    assert_eq!(code, 0, "{summary}{stderr}");

    // Once A has read it, B has no gap left.
    let prepared = run.prepare(B);
    let (code, summary, stderr) = run.ingest(&prepared.binding(), "");
    assert_eq!(code, 0, "{summary}{stderr}");
    assert!(!laws(&run.report(B)).contains(&"uninterpreted-context".to_owned()));
}

#[test]
fn removing_the_tag_requests_only_the_facet_whose_rows_name_it() {
    let run = pair();
    read_with_claims(&run);

    run.write(A, &a_source("A *Y* is exposed."));
    let prepared = run.prepare(B);
    assert_eq!(prepared.requested(), 1, "{}", prepared.summary);
    assert_eq!(prepared.prose(), vec![B_GOAL], "{:?}", prepared.prose());
    assert!(prepared.reused() >= 2, "the other B units are reused");
}

// ------------------------------------------------------------------- AE8

#[test]
fn editing_a_guards_target_requests_the_target_and_the_guards_unit() {
    let run = Run::new();
    let source = |rule: &str| {
        format!(
            "component C {{
  constraints {{
    {rule}

    An unrelated rule.
  }}
  logic {{
    Do the guarded thing.
  }}
}}
"
        )
    };
    run.write("c.sigil", &source("Only when allowed."));
    let prepared = run.prepare("c.sigil");
    let rule = prepared.facet("Only when allowed");
    let logic = prepared.facet("Do the guarded thing");
    let other = prepared.facet("An unrelated rule");
    let (code, summary, stderr) = run.ingest(
        &prepared.binding(),
        &format!(
            "(step {logic:?} \"1\")\n(guard {logic:?} \"step:1\" \"constraint\" {rule:?})\n\
             (reading {rule:?} \"no-commitment\")\n(reading {other:?} \"no-commitment\")\n"
        ),
    );
    assert_eq!(code, 0, "{summary}{stderr}");
    assert_eq!(run.prepare("c.sigil").requested(), 0);

    run.write("c.sigil", &source("Only when explicitly allowed."));
    let prepared = run.prepare("c.sigil");
    assert_eq!(prepared.requested(), 2, "{}", prepared.summary);
    assert_eq!(
        prepared.prose(),
        vec!["Do the guarded thing.", "Only when explicitly allowed."]
    );
}

#[test]
fn renaming_a_local_tag_requests_only_the_units_whose_rows_name_it() {
    let run = Run::new();
    let source = |tag: &str| {
        format!(
            "component C {{
  goal {{
    Keep things steady.
  }}
  interface {{
    The *{tag}* exists.
  }}
  constraints {{
    The alpha is stable.

    An unrelated rule.
  }}
}}
"
        )
    };
    run.write("c.sigil", &source("alpha"));
    let prepared = run.prepare("c.sigil");
    let named = prepared.facet("The alpha is stable");
    let readings: String = prepared
        .targets()
        .iter()
        .filter(|t| t.0 != named)
        .map(|(facet, _, _)| format!("(reading {facet:?} \"no-commitment\")\n"))
        .collect();
    let (code, summary, stderr) = run.ingest(
        &prepared.binding(),
        &format!("(claim {named:?} \"C\" \"uses\" \"alpha\" \"required\" \"true\")\n{readings}"),
    );
    assert_eq!(code, 0, "{summary}{stderr}");

    run.write("c.sigil", &source("beta"));
    let prepared = run.prepare("c.sigil");
    assert_eq!(
        prepared.prose(),
        vec!["The *beta* exists.", "The alpha is stable."],
        "the changed definition and the one unit that names the old Tag: {}",
        prepared.summary
    );
    assert_eq!(prepared.reused(), 2, "the goal and the unrelated rule");
}

#[test]
fn a_defect_admission_already_accepted_does_not_force_a_reread() {
    let run = pair();
    run.read(A);
    let prepared = run.prepare(B);
    let goal = prepared.facet("Use X");
    let readings: String = prepared
        .targets()
        .iter()
        .filter(|t| t.0 != goal)
        .map(|(facet, _, _)| format!("(reading {facet:?} \"no-commitment\")\n"))
        .collect();
    // `B uses B` asserts nothing: admitted and flagged degenerate, beside a
    // reading that makes the unit usable.
    let (code, summary, stderr) = run.ingest(
        &prepared.binding(),
        &format!(
            "(claim {goal:?} \"B\" \"uses\" \"B\" \"required\" \"true\")\n\
             (reading {goal:?} \"no-commitment\")\n{readings}"
        ),
    );
    assert_eq!(code, 0, "{summary}{stderr}");
    assert!(laws(&run.report(B)).contains(&"degenerate-claim".to_owned()));

    // An unrelated change to A's interface.
    run.write(A, &a_source("A *X* is exposed and a *Y* too, plus a note."));
    let prepared = run.prepare(B);
    assert_eq!(prepared.requested(), 0, "{}", prepared.summary);
    assert!(prepared.regrounded() >= 1);
}

#[test]
fn a_constraint_naming_a_visible_but_unreferenced_entity_refuses_its_unit() {
    let run = pair();
    run.read(A);
    let prepared = run.prepare(B);
    let rule = prepared.facet("Keep it quick");
    let readings: String = prepared
        .targets()
        .iter()
        .filter(|t| t.0 != rule)
        .map(|(facet, _, _)| format!("(reading {facet:?} \"no-commitment\")\n"))
        .collect();
    let (code, summary, stderr) = run.ingest(
        &prepared.binding(),
        &format!("(claim {rule:?} \"B\" \"uses\" \"X\" \"required\" \"true\")\n{readings}"),
    );
    // The name is declared but this Facet never references it, so the unit is
    // refused and read again; the other units are stored.
    assert_eq!(code, 1, "{summary}{stderr}");
    assert_eq!(summary["state"], "incomplete", "{summary}");
    assert_eq!(summary["refusalCount"], 1, "{summary}");
    assert!(
        summary["refusals"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("not on this Facet's list"),
        "{summary}"
    );
    assert_eq!(
        run.prepare(B).requested(),
        1,
        "only the refused unit is asked"
    );
}

#[test]
fn a_constraint_naming_an_entity_that_is_not_visible_is_refused_not_admitted() {
    let run = pair();
    run.read(A);
    let prepared = run.prepare(B);
    let rule = prepared.facet("Keep it quick");
    let (code, summary, stderr) = run.ingest(
        &prepared.binding(),
        &format!("(claim {rule:?} \"B\" \"uses\" \"private ledger\" \"required\" \"true\")\n"),
    );
    assert_eq!(code, 1, "{stderr}");
    assert!(
        summary["refusals"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("private ledger"),
        "{summary}"
    );
}

// ----------------------------------------------------------- black box

#[test]
fn a_dependents_request_names_nothing_private_to_its_dependency() {
    let run = pair();
    let prepared = run.prepare(B);
    let request = prepared.request();
    let rows = request["rows"].as_array().unwrap();
    let context: Vec<_> = rows.iter().filter(|r| r["context"] == true).collect();
    assert_eq!(context.len(), 1);
    assert_eq!(context[0]["section"], "interface");
    let text = request.to_string();
    for private in [
        "private ledger",
        "Read the private",
        "never leaves A",
        "shared vocabulary",
    ] {
        assert!(!text.contains(private), "{private} leaked: {text}");
    }
    assert!(request["flows"].as_array().unwrap().is_empty());
}

#[test]
fn a_dependencys_flow_cannot_be_answered_from_a_dependents_run() {
    // The cross-component step laws (step-excluded-action, step-negated-action,
    // unguarded-flow, and exclusive-foreign-write when the owner states
    // exclusivity only in a private section) need the dependency's steps in
    // the program. A dependent's request never presents them, so an interpreter
    // cannot return a step for them and none of those laws can fire across the
    // boundary.
    let run = pair();
    run.read(A);
    let a_input = run.ws.design_input();
    let a_logic = a_input
        .units
        .iter()
        .find(|u| u.source == A && format!("{:?}", u.section) == "Logic")
        .unwrap()
        .id
        .clone();
    let prepared = run.prepare(B);
    let (code, summary, stderr) =
        run.ingest(&prepared.binding(), &format!("(step {a_logic:?} \"1\")\n"));
    assert_eq!(code, 1, "{stderr}");
    let refusal = &summary["refusals"][0];
    assert!(refusal["unit"].is_null(), "no unit of B's: {summary}");
    assert!(
        refusal["reason"]
            .as_str()
            .unwrap()
            .contains("did not ask about"),
        "{summary}"
    );
}

// ------------------------------------------------------------- binding

#[test]
fn an_unrelated_edit_between_prepare_and_ingest_does_not_reject() {
    let run = pair();
    run.read(A);
    let prepared = run.prepare(B);
    run.write(
        "unrelated.sigil",
        "component Other { goal { Elsewhere. } }\n",
    );
    // A dependency's private sections do not reach the binding either.
    run.write(
        A,
        &a_source(A_INTERFACE).replace(
            "The private ledger never leaves A.",
            "Different private rule.",
        ),
    );
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &Run::readings(&prepared));
    assert_eq!(code, 0, "{summary}{stderr}");
}

#[test]
fn editing_the_selected_source_rejects_and_names_the_field() {
    let run = pair();
    run.read(A);
    let prepared = run.prepare(B);
    run.write(B, &b_source("Use X very well."));
    let (code, _, stderr) = run.ingest(&prepared.binding(), &Run::readings(&prepared));
    assert_eq!(code, 2, "{stderr}");
    assert!(stderr.contains("source content"), "{stderr}");
}

#[test]
fn editing_an_imported_interface_rejects_and_names_the_component() {
    let run = pair();
    run.read(A);
    let prepared = run.prepare(B);
    run.write(A, &a_source("A *X* is exposed and a *Y* too, and more."));
    let (code, _, stderr) = run.ingest(&prepared.binding(), &Run::readings(&prepared));
    assert_eq!(code, 2, "{stderr}");
    assert!(stderr.contains("interface of a.sigil::A"), "{stderr}");
}

#[test]
fn prepare_reports_a_workspace_digest_that_follows_every_source() {
    let run = pair();
    let first = run.prepare(B).summary["workspaceDigest"].clone();
    assert!(first.as_str().is_some_and(|d| !d.is_empty()));
    assert_eq!(run.prepare(B).summary["workspaceDigest"], first);
    run.write(
        "unrelated.sigil",
        "component Other { goal { Elsewhere. } }\n",
    );
    assert_ne!(run.prepare(B).summary["workspaceDigest"], first);
}

// --------------------------------------------------------------- store

#[test]
fn two_runs_with_different_stores_never_share_readings() {
    let mut run = pair();
    run.store = Some(run.ws.0.join("store-one"));
    run.read(A);
    assert_eq!(run.prepare(A).requested(), 0);

    run.store = Some(run.ws.0.join("store-two"));
    let prepared = run.prepare(A);
    assert!(prepared.requested() > 0, "{}", prepared.summary);
    assert_eq!(prepared.reused(), 0);

    // And the default store, `<root>/.sigil`, holds neither.
    run.store = None;
    assert_eq!(run.prepare(A).reused(), 0);
}

#[test]
fn a_store_holding_the_previous_memo_format_reads_as_empty_once() {
    let run = pair();
    let dir = run.store_dir().join("claims/interpretations");
    fs::create_dir_all(&dir).unwrap();
    // The v4 entry layout: no version, offset-era ids, positional Guard targets.
    fs::write(
        dir.join("00aa.json"),
        br#"{"facets":["facet:a.sigil:12"],"rows":[],"constraintTargets":{}}"#,
    )
    .unwrap();

    let prepared = run.prepare(A);
    let units = prepared.targets().len() as u64;
    assert_eq!(prepared.reused(), 0);
    assert!(prepared.requested() >= 1 && units >= prepared.requested());
    assert_eq!(prepared.summary["olderMemoEntries"], 1);
    assert!(
        prepared.summary["note"]
            .as_str()
            .unwrap()
            .contains("read again")
    );

    let (code, summary, stderr) = run.ingest(&prepared.binding(), &Run::readings(&prepared));
    assert_eq!(code, 0, "{summary}{stderr}");
    assert_eq!(summary["prunedMemoEntries"], 1);
    assert!(!dir.join("00aa.json").exists());

    // Once, not every run.
    let again = run.prepare(A);
    assert_eq!(again.requested(), 0);
    assert_eq!(again.summary["olderMemoEntries"], 0);
}
