//! Interpretation robustness: what ingest does with a mistake in an answer.
//!
//! A whole refusal is for anything that is not data. A data mistake costs only
//! the unit it is in, every refusal is reported at once, and a refused unit is
//! left unread so the next `prepare` asks for it again. Every test drives the
//! `sigil-claims` binary against a real `.sigil` workspace.
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
}

struct Prepared {
    out: PathBuf,
    summary: Value,
}

/// A presented Facet: its handle and its prose.
struct Target {
    handle: String,
    prose: String,
}

impl Prepared {
    fn request(&self) -> Value {
        serde_json::from_slice(&fs::read(self.out.join("request.json")).unwrap()).unwrap()
    }
    fn targets(&self) -> Vec<Target> {
        self.request()["rows"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|r| r["context"] != true)
            .map(|r| Target {
                handle: r["handle"].as_str().unwrap().to_owned(),
                prose: r["prose"].as_str().unwrap().to_owned(),
            })
            .collect()
    }
    fn handle(&self, needle: &str) -> String {
        let found: Vec<_> = self
            .targets()
            .into_iter()
            .filter(|t| t.prose.contains(needle))
            .collect();
        assert_eq!(found.len(), 1, "one Facet holds `{needle}`");
        found[0].handle.clone()
    }
    fn requested(&self) -> u64 {
        self.summary["requestedUnits"].as_u64().unwrap()
    }
    fn binding(&self) -> PathBuf {
        self.out.join("binding.json")
    }
}

impl Run {
    fn new() -> Self {
        Self {
            ws: Workspace::new(),
        }
    }
    fn write(&self, path: &str, text: &str) {
        self.ws.write(path, text.as_bytes());
    }
    fn root(&self) -> &str {
        self.ws.0.to_str().unwrap()
    }
    fn prepare(&self, source: &str) -> Prepared {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let out = self
            .ws
            .0
            .join(format!("prep-{}", NEXT.fetch_add(1, Ordering::Relaxed)));
        let (code, summary, stderr) = claims(&[
            "prepare",
            "--source",
            source,
            "--out",
            out.to_str().unwrap(),
            "--root",
            self.root(),
        ]);
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
        claims(&[
            "ingest",
            "--binding",
            binding.to_str().unwrap(),
            "--claims",
            file.to_str().unwrap(),
            "--root",
            self.root(),
        ])
    }
    fn check(&self) -> (i32, Value, String) {
        claims(&["check", "--root", self.root()])
    }
    fn memo_files(&self) -> Vec<String> {
        let dir = self.ws.0.join(".sigil/claims/interpretations");
        fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| fs::read_to_string(e.path()).unwrap())
            .collect()
    }
}

/// A reading row for every target the rows do not already name.
fn pad(prepared: &Prepared, mut rows: String, skip: &[&str]) -> String {
    for target in prepared.targets() {
        if skip.contains(&target.handle.as_str()) || rows.contains(&format!("{:?}", target.handle))
        {
            continue;
        }
        rows.push_str(&format!(
            "(reading {:?} \"no-commitment\")\n",
            target.handle
        ));
    }
    rows
}

const BOOKING: &str = "booking.sigil";

fn booking(extra_constraint: &str) -> String {
    format!(
        "component Booking {{
  goal {{
    Book a room.
  }}
  logic {{
    Check the *request form* and reject a bad one.

    Then commit the booking and return it.
  }}
  constraints {{
    A booking needs a *request form*.
    {extra_constraint}
  }}
}}
"
    )
}

fn pair() -> Run {
    let run = Run::new();
    run.write(BOOKING, &booking("Never double book a room."));
    run
}

// ------------------------------------------------------------------- AE1

#[test]
fn one_bad_name_refuses_only_its_facet_and_the_next_prepare_asks_for_it() {
    let run = pair();
    let prepared = run.prepare(BOOKING);
    let rule = prepared.handle("Never double book");
    let answer = pad(
        &prepared,
        format!(
            "(claim {rule:?} \"Booking\" \"requires\" \"requireUser\" \"required\" \"true\")\n"
        ),
        &[],
    );
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 1, "{summary}{stderr}");
    assert_eq!(summary["state"], "incomplete");
    assert_eq!(summary["refusalCount"], 1);
    let refusal = &summary["refusals"][0];
    assert_eq!(refusal["unit"]["handles"][0], rule.as_str());
    assert!(
        refusal["reason"].as_str().unwrap().contains("requireUser"),
        "{summary}"
    );
    assert_eq!(
        summary["storedUnits"], 2,
        "the goal and the Logic section are stored; only the constraint is refused"
    );

    // The linked check says the same unit is unread.
    let (code, check, _) = run.check();
    assert_eq!(code, 1, "{check}");
    assert_eq!(check["state"], "incomplete");

    let again = run.prepare(BOOKING);
    assert_eq!(again.requested(), 1, "{}", again.summary);
    let asked = again.targets();
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0].handle, rule, "the handle is the same on a re-ask");
}

#[test]
fn a_tag_as_the_subject_of_a_requirement_refuses_its_facet() {
    let run = Run::new();
    run.write(
        BOOKING,
        "component Booking {
  goal {
    Book a room with a *request form*.
  }
  constraints {
    A request form needs a signed booking.
  }
}
",
    );
    let prepared = run.prepare(BOOKING);
    let rule = prepared.handle("A request form needs");
    let answer = pad(
        &prepared,
        format!(
            "(claim {rule:?} \"request form\" \"requires\" \"Booking\" \"required\" \"true\")\n"
        ),
        &[],
    );
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 1, "{summary}{stderr}");
    assert_eq!(summary["refusalCount"], 1);
    let refusal = &summary["refusals"][0];
    assert_eq!(refusal["unit"]["handles"][0], rule.as_str());
    assert!(
        refusal["reason"]
            .as_str()
            .unwrap()
            .contains("must be a component or a step"),
        "{summary}"
    );
}

// ------------------------------------------------------------------- AE2

#[test]
fn a_rule_among_valid_rows_refuses_the_whole_answer_and_stores_nothing() {
    let run = pair();
    let prepared = run.prepare(BOOKING);
    let answer = pad(
        &prepared,
        "(rule ((holds a b c)) ((reachable a b)))\n".into(),
        &[],
    );
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 1, "{summary}{stderr}");
    assert!(
        summary.is_null(),
        "a whole refusal has no structured result"
    );
    assert!(stderr.contains("claim data only"), "{stderr}");
    assert!(run.memo_files().is_empty(), "nothing is stored");
}

// ------------------------------------------------------------------- AE3

#[test]
fn a_bad_step_reference_refuses_the_whole_logic_section_and_only_it() {
    let run = pair();
    let prepared = run.prepare(BOOKING);
    let first = prepared.handle("Check the *request form*");
    let second = prepared.handle("Then commit");
    let answer = pad(
        &prepared,
        format!(
            "(step {first:?} \"1\")\n\
             (claim {first:?} \"step:1\" \"to\" \"step:9\" \"required\" \"true\")\n\
             (step {second:?} \"1\")\n\
             (end {second:?} \"1\")\n"
        ),
        &[],
    );
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 1, "{summary}{stderr}");
    let refusal = &summary["refusals"][0];
    assert_eq!(refusal["unit"]["section"], "logic");
    assert_eq!(
        refusal["unit"]["handles"].as_array().unwrap().len(),
        2,
        "both Facets of the section: {summary}"
    );
    assert_eq!(
        summary["storedUnits"], 2,
        "the section's two Facets are one unit; the goal and the constraint are stored"
    );
    let again = run.prepare(BOOKING);
    assert_eq!(again.requested(), 1, "one Logic unit is asked again");
    assert_eq!(again.targets().len(), 2);
}

// -------------------------------------------------------------- reporting

#[test]
fn every_refusal_of_one_answer_is_reported_at_once() {
    let run = pair();
    let prepared = run.prepare(BOOKING);
    let goal = prepared.handle("Book a room");
    let rule = prepared.handle("Never double book");
    let answer = pad(
        &prepared,
        format!(
            "(claim {goal:?} \"Booking\" \"requires\" \"nothing\" \"required\" \"true\")\n\
             (claim {rule:?} \"Booking\" \"offers\" \"request form\" \"required\" \"true\")\n"
        ),
        &[],
    );
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 1, "{summary}{stderr}");
    assert_eq!(summary["refusalCount"], 2, "{summary}");
    let handles: Vec<&str> = summary["refusals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["unit"]["handles"][0].as_str().unwrap())
        .collect();
    assert!(handles.contains(&goal.as_str()) && handles.contains(&rule.as_str()));
}

#[test]
fn the_refusals_listed_are_capped_but_the_count_is_complete() {
    let run = pair();
    let prepared = run.prepare(BOOKING);
    let goal = prepared.handle("Book a room");
    let mut rows = String::new();
    for index in 0..250 {
        rows.push_str(&format!(
            "(claim {goal:?} \"Booking\" \"requires\" \"thing {index}\" \"required\" \"true\")\n"
        ));
    }
    let (_, summary, stderr) = run.ingest(&prepared.binding(), &pad(&prepared, rows, &[]));
    assert_eq!(summary["refusalCount"], 250, "{stderr}");
    assert_eq!(summary["refusals"].as_array().unwrap().len(), 200);
}

#[test]
fn a_unit_whose_only_claim_asserts_nothing_is_refused_as_unusable() {
    let run = pair();
    let prepared = run.prepare(BOOKING);
    let goal = prepared.handle("Book a room");
    let answer = pad(
        &prepared,
        format!("(claim {goal:?} \"Booking\" \"provides\" \"Booking\" \"required\" \"true\")\n"),
        &[],
    );
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 1, "{summary}{stderr}");
    assert!(
        summary["refusals"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("none of this unit's rows is usable"),
        "{summary}"
    );
    assert_eq!(run.prepare(BOOKING).requested(), 1);
}

#[test]
fn a_row_about_no_unit_is_refused_alone_and_the_clean_units_are_stored() {
    let run = pair();
    let prepared = run.prepare(BOOKING);
    let answer = pad(
        &prepared,
        "(claim \"#99\" \"Booking\" \"provides\" \"Booking\" \"required\" \"true\")\n".into(),
        &[],
    );
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 0, "{summary}{stderr}");
    assert_eq!(summary["refusalCount"], 1);
    assert!(summary["refusals"][0]["unit"].is_null(), "{summary}");
    assert_eq!(
        summary["storedUnits"], 3,
        "the goal, the Logic section and the constraint are all read"
    );
}

#[test]
fn a_bare_number_is_a_mistake_in_one_unit_not_a_whole_refusal() {
    let run = pair();
    let prepared = run.prepare(BOOKING);
    let first = prepared.handle("Check the *request form*");
    let answer = pad(&prepared, format!("(step {first:?} 1)\n"), &[]);
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 1, "{summary}{stderr}");
    assert_eq!(summary["refusals"][0]["unit"]["section"], "logic");
}

// ------------------------------------------------------------------- AE6

#[test]
fn a_reading_given_in_handles_is_stored_and_reused_under_full_ids() {
    let run = pair();
    let prepared = run.prepare(BOOKING);
    let (code, summary, stderr) =
        run.ingest(&prepared.binding(), &pad(&prepared, String::new(), &[]));
    assert_eq!(code, 0, "{summary}{stderr}");
    for stored in run.memo_files() {
        assert!(!stored.contains("\"#"), "a handle was stored: {stored}");
    }

    // A new Facet moves where handles fall, and everything already read is
    // still reused, because it is keyed by the Facet's own id.
    run.write(
        BOOKING,
        &booking("Never double book a room.\n\n    Keep a log."),
    );
    let again = run.prepare(BOOKING);
    assert_eq!(again.requested(), 1, "{}", again.summary);
}

// ------------------------------------------------------- a second reading

#[test]
fn a_mistake_in_a_second_reading_costs_only_the_comparison() {
    let run = pair();
    let prepared = run.prepare(BOOKING);
    run.ingest(&prepared.binding(), &pad(&prepared, String::new(), &[]));
    let goal = prepared.handle("Book a room");
    let (code, summary, stderr) = run.ingest(
        &prepared.binding(),
        &format!("(claim {goal:?} \"Booking\" \"requires\" \"nothing\" \"required\" \"true\")\n"),
    );
    assert_eq!(code, 0, "{summary}{stderr}");
    assert_eq!(summary["refusalCount"], 0, "{summary}");
    assert!(
        !summary["comparisonErrors"].as_array().unwrap().is_empty(),
        "{summary}"
    );
    assert_eq!(
        run.prepare(BOOKING).requested(),
        0,
        "nothing is asked again"
    );
}

// ------------------------------------------------------------------- AE4

const ROOMS: &str = "rooms.sigil";

fn rooms() -> Run {
    let run = Run::new();
    run.write(
        ROOMS,
        "component Rooms {
  interface {
    Rooms keeps a *mark* on every room.
  }
  constraints {
    Rooms must not import framework code.

    Rooms reads the marker once.

    Rooms keeps the mark.
  }
}
",
    );
    run
}

fn laws_of(report: &Value) -> Vec<(String, String)> {
    report["findings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| {
            (
                f["class"].as_str().unwrap().to_owned(),
                f["law"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

fn report_of(run: &Run, name: &str) -> Value {
    let path = run.ws.0.join(".sigil/claims").join(name);
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

#[test]
fn a_name_the_design_never_declares_is_a_warning_and_never_fails_it() {
    let run = rooms();
    let prepared = run.prepare(ROOMS);
    let rule = prepared.handle("framework code");
    let answer = pad(
        &prepared,
        format!("(undeclared {rule:?} \"framework code\")\n"),
        &[],
    );
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 0, "{summary}{stderr}");
    assert_eq!(summary["state"], "loose", "{summary}");
    let report = report_of(&run, "rooms.sigil.json");
    assert!(
        laws_of(&report).contains(&("gap".to_owned(), "undeclared-name".to_owned())),
        "{report}"
    );

    // The author's own view of the linked check keeps it.
    let (code, check, _) = claims(&["check", "--root", run.root(), "--source", ROOMS]);
    assert_eq!(code, 0, "{check}");
    let linked = report_of(&run, "rooms.sigil.linked.json");
    assert!(laws_of(&linked).contains(&("gap".to_owned(), "undeclared-name".to_owned())));
}

#[test]
fn a_declared_name_the_facet_never_references_is_called_unreferenced() {
    let run = rooms();
    let prepared = run.prepare(ROOMS);
    let rule = prepared.handle("marker");
    let answer = pad(&prepared, format!("(undeclared {rule:?} \"mark\")\n"), &[]);
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 0, "{summary}{stderr}");
    let report = report_of(&run, "rooms.sigil.json");
    assert!(
        laws_of(&report).contains(&("gap".to_owned(), "unreferenced-name".to_owned())),
        "{report}"
    );
}

#[test]
fn an_undeclared_row_must_name_something_off_the_list_and_in_the_prose() {
    let run = rooms();
    let prepared = run.prepare(ROOMS);
    let kept = prepared.handle("Rooms keeps the mark");

    // The name is on the Facet's own list: state the claim instead.
    let answer = pad(&prepared, format!("(undeclared {kept:?} \"mark\")\n"), &[]);
    let (_, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert!(
        summary["refusals"][0]["reason"]
            .as_str()
            .unwrap_or(&stderr)
            .contains("is on this Facet's list"),
        "{summary}"
    );

    // The name is not in the prose, so the finding would trace to nothing.
    let run = rooms();
    let prepared = run.prepare(ROOMS);
    let rule = prepared.handle("framework code");
    let answer = pad(
        &prepared,
        format!("(undeclared {rule:?} \"retry policy\")\n"),
        &[],
    );
    let (_, summary, _) = run.ingest(&prepared.binding(), &answer);
    assert!(
        summary["refusals"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("does not contain"),
        "{summary}"
    );
}

#[test]
fn an_off_list_name_refuses_its_unit_and_is_never_reported_as_ungrounded() {
    let run = rooms();
    let prepared = run.prepare(ROOMS);
    let rule = prepared.handle("framework code");
    let answer = pad(
        &prepared,
        format!("(claim {rule:?} \"Rooms\" \"uses\" \"room owner\" \"required\" \"true\")\n"),
        &[],
    );
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 1, "{summary}{stderr}");
    assert_eq!(summary["refusalCount"], 1, "{summary}");
    let report = report_of(&run, "rooms.sigil.json");
    assert_eq!(report["version"], 5);
    assert!(
        !laws_of(&report)
            .iter()
            .any(|(_, law)| law == "ungrounded-claim"),
        "a name off the list is a refusal, not a finding: {report}"
    );
}

#[test]
fn one_unit_lists_its_resolution_and_admission_mistakes_together() {
    let run = pair();
    let prepared = run.prepare(BOOKING);
    let rule = prepared.handle("Never double book");
    let answer = pad(
        &prepared,
        format!(
            "(step {rule:?} \"1\")\n\
             (claim {rule:?} \"Booking\" \"requires\" \"requireUser\" \"required\" \"true\")\n"
        ),
        &[],
    );
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 1, "{summary}{stderr}");
    assert_eq!(
        summary["refusalCount"], 2,
        "both mistakes in one round: {summary}"
    );
    let reasons: Vec<&str> = summary["refusals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["reason"].as_str().unwrap())
        .collect();
    assert!(
        reasons.iter().any(|r| r.contains("not Logic prose")),
        "{summary}"
    );
    assert!(
        reasons.iter().any(|r| r.contains("requireUser")),
        "{summary}"
    );
    for refusal in summary["refusals"].as_array().unwrap() {
        assert_eq!(refusal["unit"]["section"], "constraints", "{summary}");
    }
}

#[test]
fn a_contradiction_keeps_the_state_disjoint_while_a_unit_is_unread() {
    let run = Run::new();
    run.write(
        "quote.sigil",
        "component Quote {
  goal {
    Price a stay.
  }
  interface {
    Quote provides a *price*.
  }
  constraints {
    Quote never provides the price.
  }
}
",
    );
    let prepared = run.prepare("quote.sigil");
    let offers = prepared.handle("provides a");
    let never = prepared.handle("never provides");
    let goal = prepared.handle("Price a stay");
    let answer = pad(
        &prepared,
        format!(
            "(claim {offers:?} \"Quote\" \"provides\" \"price\" \"required\" \"true\")\n\
             (claim {never:?} \"Quote\" \"provides\" \"price\" \"required\" \"false\")\n"
        ),
        &[goal.as_str()],
    );
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 1, "{summary}{stderr}");
    assert_eq!(
        summary["state"], "disjoint",
        "a gating finding outranks an unread unit: {summary}"
    );
    assert!(
        !summary["unreadUnits"].as_array().unwrap().is_empty(),
        "{summary}"
    );
}

// ------------------------------------------------- handles and step forms

#[test]
fn a_flow_across_two_facets_resolves_handles_and_ends_where_the_prose_says() {
    let run = pair();
    let prepared = run.prepare(BOOKING);
    let first = prepared.handle("Check the *request form*");
    let second = prepared.handle("Then commit");
    let answer = pad(
        &prepared,
        format!(
            "(step {first:?} \"1\")\n\
             (step {second:?} \"1\")\n\
             (claim {first:?} \"step:1\" \"to\" \"step:{second}.1\" \"required\" \"true\")\n\
             (end {second:?} \"1\")\n"
        ),
        &[],
    );
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 0, "{summary}{stderr}");
    assert_eq!(summary["refusalCount"], 0, "{summary}");
    let report = report_of(&run, "booking.sigil.json");
    assert!(
        !laws_of(&report)
            .iter()
            .any(|(_, law)| law == "unreached-step"),
        "the first step reaches the end through the second: {report}"
    );
}

#[test]
fn a_step_reference_from_a_constraint_is_a_mistake_in_that_constraint() {
    let run = pair();
    let prepared = run.prepare(BOOKING);
    let rule = prepared.handle("Never double book");
    let answer = pad(
        &prepared,
        format!("(claim {rule:?} \"step:1\" \"reads\" \"request form\" \"required\" \"true\")\n"),
        &[],
    );
    let (code, summary, stderr) = run.ingest(&prepared.binding(), &answer);
    assert_eq!(code, 1, "{summary}{stderr}");
    assert_eq!(summary["refusals"][0]["unit"]["section"], "constraints");
    assert_eq!(summary["storedUnits"], 2, "the Logic section is unaffected");
}
