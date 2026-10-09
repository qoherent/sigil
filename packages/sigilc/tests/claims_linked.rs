//! The linked check: every valid stored reading of the workspace joined into
//! one program, with every law run over it.
//!
//! Each test drives the `sigil-claims` binary against a real `.sigil`
//! workspace. Interpretation is per source and sees only imported interfaces;
//! `check` is what lets a dependency's private readings meet a dependent's.
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
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
    targets: Vec<(String, String)>,
}

impl Prepared {
    /// The one presented target whose prose holds `needle`.
    fn facet(&self, needle: &str) -> String {
        let found: Vec<_> = self
            .targets
            .iter()
            .filter(|(_, prose)| prose.contains(needle))
            .collect();
        assert_eq!(found.len(), 1, "one Facet holds `{needle}`: {found:?}");
        found[0].0.clone()
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

    fn store(&self) -> PathBuf {
        self.ws.0.join(".sigil")
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
        let request: Value =
            serde_json::from_slice(&fs::read(out.join("request.json")).unwrap()).unwrap();
        let targets = request["rows"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|r| r["context"] != true)
            .map(|r| {
                (
                    r["facet"].as_str().unwrap().to_owned(),
                    r["prose"].as_str().unwrap().to_owned(),
                )
            })
            .collect();
        Prepared { out, targets }
    }

    fn ingest(&self, prepared: &Prepared, artifact: &str) -> (i32, Value, String) {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let file = self.ws.0.join(format!(
            "result-{}.egg",
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::write(&file, artifact).unwrap();
        claims(&[
            "ingest",
            "--binding",
            prepared.out.join("binding.json").to_str().unwrap(),
            "--claims",
            file.to_str().unwrap(),
            "--root",
            self.root(),
        ])
    }

    /// Prepare a source and answer it with `rows`, plus a `reading` for every
    /// presented Facet the rows do not name, so every unit is stored.
    fn read(&self, source: &str, rows: &dyn Fn(&Prepared) -> String) -> Prepared {
        let prepared = self.prepare(source);
        let mut artifact = rows(&prepared);
        for (facet, _) in &prepared.targets {
            if !artifact.contains(&format!("{facet:?}")) {
                artifact.push_str(&format!("(reading {facet:?} \"no-commitment\")\n"));
            }
        }
        // A local contradiction is a gate failure (1); the reading is stored
        // either way.
        let (code, summary, stderr) = self.ingest(&prepared, &artifact);
        assert!(code <= 1, "{summary}{stderr}");
        prepared
    }

    fn check(&self, source: Option<&str>) -> (i32, Value, String) {
        let mut args = vec!["check", "--root", self.root()];
        if let Some(source) = source {
            args.extend(["--source", source]);
        }
        claims(&args)
    }

    /// The linked report a `check` wrote.
    fn report(&self, summary: &Value) -> Value {
        serde_json::from_slice(&fs::read(summary["report"].as_str().unwrap()).unwrap()).unwrap()
    }

    /// Every stored reading, by file name, with its bytes.
    fn memo(&self) -> BTreeMap<String, Vec<u8>> {
        let dir = self.store().join("claims/interpretations");
        fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| {
                (
                    e.file_name().to_string_lossy().into_owned(),
                    fs::read(e.path()).unwrap(),
                )
            })
            .collect()
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

fn unread_sources(report: &Value) -> Vec<String> {
    report["unread"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|u| u["source"].as_str().unwrap().to_owned())
                .collect()
        })
        .unwrap_or_default()
}

const ROOMS: &str = "rooms.sigil";
const BOOKING: &str = "booking.sigil";

fn rooms_source(private_state: &str) -> String {
    format!(
        "component Rooms {{
  goal {{
    Own the room catalog.
  }}
  interface {{
    Rooms exposes a *Mark* on every room.
  }}
  state {{
    {private_state}
  }}
  logic {{
    Rooms archives a room by setting the Mark.
  }}
  constraints {{
    Rooms keeps every room addressable.
  }}
}}
"
    )
}

const ROOMS_STATE: &str = "Rooms owns the Mark of every room.";

fn booking_source(constraint: &str) -> String {
    format!(
        "@rooms.sigil from Rooms import {{ Mark }}
component Booking {{
  goal {{
    Book a room.
  }}
  logic {{
    Booking sets the Mark when a booking is cancelled.
  }}
  constraints {{
    {constraint}
  }}
}}
"
    )
}

const BOOKING_RULE: &str = "Booking owns the Mark, and only Booking may set it.";

fn pair() -> Run {
    let run = Run::new();
    run.write(ROOMS, &rooms_source(ROOMS_STATE));
    run.write(BOOKING, &booking_source(BOOKING_RULE));
    run
}

/// Rooms' reading: it owns the Mark (private), and its Logic step writes it.
fn rooms_rows(p: &Prepared) -> String {
    let state = p.facet("Rooms owns the Mark");
    let logic = p.facet("Rooms archives a room");
    format!(
        "(claim {state:?} \"Rooms\" \"owns\" \"Mark\" \"required\" \"true\")
(step {logic:?} \"1\")
(claim {logic:?} \"step:1\" \"writes\" \"Mark\" \"required\" \"true\")
(end {logic:?} \"1\")
"
    )
}

/// Booking's reading: it depends on Rooms, claims the Mark exclusively, and
/// its own Logic step writes it.
fn booking_rows(p: &Prepared) -> String {
    let goal = p.facet("Book a room");
    let rule = p.facet("Booking owns the Mark");
    let logic = p.facet("Booking sets the Mark");
    format!(
        "(claim {goal:?} \"Booking\" \"dependsOn\" \"Rooms\" \"required\" \"true\")
(claim {rule:?} \"Booking\" \"owns\" \"Mark\" \"required\" \"true\")
(property {rule:?} \"Mark\" \"exclusive\" \"true\")
(step {logic:?} \"1\")
(claim {logic:?} \"step:1\" \"writes\" \"Mark\" \"required\" \"true\")
(end {logic:?} \"1\")
"
    )
}

fn read_both(run: &Run) {
    run.read(ROOMS, &rooms_rows);
    run.read(BOOKING, &booking_rows);
}

// ------------------------------------------------------------------- AE1

#[test]
fn a_dependents_ownership_claim_meets_its_dependencys_private_reading() {
    let run = pair();
    read_both(&run);

    // Booking's own ingest saw only Rooms' interface and says nothing.
    let local: Value =
        serde_json::from_slice(&fs::read(run.store().join("claims/booking.sigil.json")).unwrap())
            .unwrap();
    assert!(!laws(&local).contains(&"exclusive-ownership".to_owned()));
    assert_eq!(local["state"], "loose");

    let (code, summary, stderr) = run.check(None);
    assert_eq!(code, 1, "{summary}{stderr}");
    assert_eq!(summary["state"], "disjoint");
    let report = run.report(&summary);
    assert_eq!(report["version"], 5);
    assert!(laws(&report).contains(&"exclusive-ownership".to_owned()));

    // Both authors see the finding in their own view.
    for source in [BOOKING, ROOMS] {
        let (code, summary, stderr) = run.check(Some(source));
        assert_eq!(code, 1, "{source}: {summary}{stderr}");
        assert!(
            laws(&run.report(&summary)).contains(&"exclusive-ownership".to_owned()),
            "{source}"
        );
    }
}

// ------------------------------------------------------------------- AE2

#[test]
fn a_dependents_constraint_forbids_what_its_dependencys_private_step_does() {
    let run = pair();
    run.read(ROOMS, &rooms_rows);
    run.read(BOOKING, &|p| {
        let goal = p.facet("Book a room");
        let rule = p.facet("Booking owns the Mark");
        format!(
            "(claim {goal:?} \"Booking\" \"dependsOn\" \"Rooms\" \"required\" \"true\")
(claim {rule:?} \"Booking\" \"excludes\" \"Mark\" \"required\" \"true\")
"
        )
    });
    let (code, summary, stderr) = run.check(None);
    assert_eq!(code, 0, "flow laws are warnings: {summary}{stderr}");
    assert_eq!(summary["state"], "loose");
    assert!(laws(&run.report(&summary)).contains(&"step-excluded-action".to_owned()));
}

#[test]
fn a_constraint_that_a_flow_must_not_write_meets_the_private_step_that_does() {
    let run = pair();
    run.read(ROOMS, &rooms_rows);
    run.read(BOOKING, &|p| {
        let goal = p.facet("Book a room");
        let rule = p.facet("Booking owns the Mark");
        format!(
            "(claim {goal:?} \"Booking\" \"dependsOn\" \"Rooms\" \"required\" \"true\")
(claim {rule:?} \"Booking\" \"writes\" \"Mark\" \"required\" \"false\")
"
        )
    });
    let (code, summary, stderr) = run.check(None);
    assert_eq!(code, 0, "{summary}{stderr}");
    assert!(laws(&run.report(&summary)).contains(&"step-negated-action".to_owned()));
}

#[test]
fn a_step_writing_state_a_dependency_privately_marks_exclusive_is_a_foreign_write() {
    let run = pair();
    run.write(
        ROOMS,
        &rooms_source("Rooms owns the Mark of every room, and nothing else may set it."),
    );
    run.read(ROOMS, &|p| {
        let state = p.facet("Rooms owns the Mark");
        format!(
            "(claim {state:?} \"Rooms\" \"owns\" \"Mark\" \"required\" \"true\")
(property {state:?} \"Mark\" \"exclusive\" \"true\")
"
        )
    });
    run.read(BOOKING, &|p| {
        let logic = p.facet("Booking sets the Mark");
        format!(
            "(step {logic:?} \"1\")
(claim {logic:?} \"step:1\" \"writes\" \"Mark\" \"required\" \"true\")
(end {logic:?} \"1\")
"
        )
    });
    let (code, summary, stderr) = run.check(None);
    assert_eq!(code, 0, "{summary}{stderr}");
    assert!(laws(&run.report(&summary)).contains(&"exclusive-foreign-write".to_owned()));
}

// ------------------------------------------------------------------- AE8

#[test]
fn a_cross_component_unguarded_flow_says_the_dependency_cannot_guard_it() {
    let run = pair();
    run.read(ROOMS, &rooms_rows);
    run.read(BOOKING, &|p| {
        let goal = p.facet("Book a room");
        let rule = p.facet("Booking owns the Mark");
        format!(
            "(claim {goal:?} \"Booking\" \"dependsOn\" \"Rooms\" \"required\" \"true\")
(claim {rule:?} \"Booking\" \"requires\" \"Mark\" \"required\" \"true\")
"
        )
    });
    let (code, summary, stderr) = run.check(None);
    assert_eq!(code, 0, "{summary}{stderr}");
    let report = run.report(&summary);
    let unguarded: Vec<_> = report["findings"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["law"] == "unguarded-flow")
        .collect();
    assert!(!unguarded.is_empty(), "{report}");
    let detail = unguarded[0]["detail"].as_str().unwrap();
    assert!(detail.contains("interface"), "{detail}");
    assert!(detail.contains("cannot guard"), "{detail}");
}

// ------------------------------------------------------------------- AE3

#[test]
fn an_unread_dependency_makes_the_check_incomplete_and_names_it() {
    let run = pair();
    run.read(BOOKING, &booking_rows);
    let (code, summary, stderr) = run.check(None);
    assert_eq!(code, 1, "{summary}{stderr}");
    assert_eq!(summary["state"], "incomplete");
    let report = run.report(&summary);
    assert_eq!(report["state"], "incomplete");
    assert!(unread_sources(&report).iter().all(|s| s == ROOMS));
    assert!(!unread_sources(&report).is_empty(), "{report}");
    assert!(!report["unread"][0]["facets"].as_array().unwrap().is_empty());
}

#[test]
fn a_facet_the_reader_skipped_keeps_the_check_incomplete() {
    let run = pair();
    run.read(BOOKING, &|_| String::new());
    // Rooms' reader answers only its state Facet: the rest are never stored.
    let prepared = run.prepare(ROOMS);
    let state = prepared.facet("Rooms owns the Mark");
    let (code, summary, stderr) = run.ingest(
        &prepared,
        &format!("(claim {state:?} \"Rooms\" \"owns\" \"Mark\" \"required\" \"true\")\n"),
    );
    // Ingest itself already says the source is not fully read.
    assert_eq!(code, 1, "{summary}{stderr}");
    assert_eq!(summary["state"], "incomplete");
    assert!(!summary["unreadUnits"].as_array().unwrap().is_empty());
    let (code, summary, _) = run.check(None);
    assert_eq!(code, 1);
    assert_eq!(summary["state"], "incomplete");
    assert!(unread_sources(&run.report(&summary)).contains(&ROOMS.to_owned()));
}

#[test]
fn a_gating_finding_wins_over_incompleteness() {
    let run = pair();
    run.read(ROOMS, &rooms_rows);
    run.read(BOOKING, &booking_rows);
    // An edit leaves one Rooms unit unread while the conflict still stands.
    run.write(
        ROOMS,
        &rooms_source(ROOMS_STATE).replace("addressable", "reachable"),
    );
    let (code, summary, _) = run.check(None);
    assert_eq!(code, 1);
    assert_eq!(summary["state"], "disjoint");
    assert!(!unread_sources(&run.report(&summary)).is_empty());
}

#[test]
fn an_empty_store_lists_every_unit_and_is_incomplete() {
    let run = pair();
    let (code, summary, _) = run.check(None);
    assert_eq!(code, 1);
    assert_eq!(summary["state"], "incomplete");
    let sources = unread_sources(&run.report(&summary));
    assert!(sources.contains(&ROOMS.to_owned()) && sources.contains(&BOOKING.to_owned()));
}

// ------------------------------------------------------------------- AE4

#[test]
fn editing_a_dependencys_private_section_makes_only_that_unit_unread() {
    let run = pair();
    read_both(&run);
    let (code, _, _) = run.check(None);
    assert_eq!(code, 1); // the planted conflict
    run.write(
        ROOMS,
        &rooms_source(ROOMS_STATE).replace("addressable", "reachable"),
    );
    let (_, summary, _) = run.check(None);
    let report = run.report(&summary);
    let unread = report["unread"].as_array().unwrap();
    assert_eq!(unread.len(), 1, "{report}");
    assert_eq!(unread[0]["source"], ROOMS);
    assert_eq!(unread[0]["section"], "constraints");
}

// ------------------------------------------------------------------- AE5

#[test]
fn a_contradiction_inside_the_dependency_stays_out_of_the_dependents_view() {
    let run = pair();
    run.write(
        ROOMS,
        &rooms_source(ROOMS_STATE).replace(
            "Rooms keeps every room addressable.",
            "Rooms hides the Mark of an archived room.",
        ),
    );
    run.read(ROOMS, &|p| {
        let state = p.facet("Rooms owns the Mark");
        let rule = p.facet("Rooms hides the Mark");
        format!(
            "(claim {state:?} \"Rooms\" \"uses\" \"Mark\" \"required\" \"true\")
(claim {rule:?} \"Rooms\" \"excludes\" \"Mark\" \"required\" \"true\")
"
        )
    });
    run.read(BOOKING, &|p| {
        let goal = p.facet("Book a room");
        format!("(claim {goal:?} \"Booking\" \"dependsOn\" \"Rooms\" \"required\" \"true\")\n")
    });
    let (_, workspace, _) = run.check(None);
    assert!(laws(&run.report(&workspace)).contains(&"excluded-use".to_owned()));
    let (_, rooms, _) = run.check(Some(ROOMS));
    assert!(laws(&run.report(&rooms)).contains(&"excluded-use".to_owned()));
    let (_, booking, _) = run.check(Some(BOOKING));
    assert!(!laws(&run.report(&booking)).contains(&"excluded-use".to_owned()));
}

// ------------------------------------------------------------------- AE6

#[test]
fn ingest_keeps_its_local_verdict_and_writes_no_linked_report() {
    let run = pair();
    let prepared = run.prepare(BOOKING);
    let mut artifact = booking_rows(&prepared);
    for (facet, _) in &prepared.targets {
        if !artifact.contains(&format!("{facet:?}")) {
            artifact.push_str(&format!("(reading {facet:?} \"no-commitment\")\n"));
        }
    }
    let (code, summary, stderr) = run.ingest(&prepared, &artifact);
    assert_eq!(code, 0, "{summary}{stderr}");
    assert_eq!(summary["state"], "loose");
    let report: Value =
        serde_json::from_slice(&fs::read(summary["report"].as_str().unwrap()).unwrap()).unwrap();
    assert!(laws(&report).contains(&"uninterpreted-context".to_owned()));
    assert!(
        report.get("unread").is_none(),
        "ingest never lists unread units"
    );
    let claims_dir = run.store().join("claims");
    let linked: Vec<_> = fs::read_dir(claims_dir)
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().contains(".linked."))
        .collect();
    assert!(linked.is_empty());
}

// ----------------------------------------------------------- stored data

#[test]
fn checking_never_writes_the_stored_readings() {
    let run = pair();
    read_both(&run);
    // Move Rooms' interface so Booking's stored context is out of date.
    run.write(
        ROOMS,
        &rooms_source(ROOMS_STATE).replace("on every room", "on each room"),
    );
    let before = run.memo();
    let (_, summary, _) = run.check(None);
    assert!(summary.is_object());
    assert_eq!(run.memo(), before);
}

#[test]
fn two_checks_of_an_unchanged_store_write_the_same_report() {
    let run = pair();
    read_both(&run);
    let (_, first, _) = run.check(None);
    let first_bytes = fs::read(first["report"].as_str().unwrap()).unwrap();
    let (_, second, _) = run.check(None);
    assert_eq!(
        first_bytes,
        fs::read(second["report"].as_str().unwrap()).unwrap()
    );
}

#[test]
fn a_stored_reading_that_admission_refuses_is_unread_and_the_check_still_reports() {
    let run = pair();
    let rooms = run.read(ROOMS, &rooms_rows);
    run.read(BOOKING, &booking_rows);
    // Rewrite one stored Rooms reading so it names an entity that is not in
    // its source's request. Its recorded context still matches, so the memo
    // reuses it without admitting it.
    let state = rooms.facet("Rooms owns the Mark");
    let memo = run.store().join("claims/interpretations");
    let mut corrupted = 0;
    for entry in fs::read_dir(&memo).unwrap().flatten() {
        let text = fs::read_to_string(entry.path()).unwrap();
        if text.contains(&state) && text.contains("\"Rooms\"") {
            fs::write(entry.path(), text.replace("\"Rooms\"", "\"Ghost\"")).unwrap();
            corrupted += 1;
        }
    }
    assert_eq!(corrupted, 1);
    let (code, summary, stderr) = run.check(None);
    assert_eq!(code, 1, "{summary}{stderr}");
    assert_eq!(summary["state"], "incomplete");
    let report = run.report(&summary);
    let unread = report["unread"].as_array().unwrap();
    assert_eq!(unread.len(), 1, "{report}");
    assert!(unread[0]["refusal"].as_str().unwrap().contains("Ghost"));
}

// ------------------------------------------------------- workspace shape

#[test]
fn imports_that_form_a_cycle_both_link() {
    let run = Run::new();
    run.write(
        "a.sigil",
        "@b.sigil from B import { Y }
component A {
  goal {
    Offer an *X* to B.
  }
  interface {
    A exposes the X.
  }
}
",
    );
    run.write(
        "b.sigil",
        "@a.sigil from A import { X }
component B {
  goal {
    Offer a *Y* to A.
  }
  interface {
    B exposes the Y.
  }
}
",
    );
    run.read("a.sigil", &|_| String::new());
    run.read("b.sigil", &|_| String::new());
    let (code, summary, stderr) = run.check(None);
    assert_eq!(code, 0, "{summary}{stderr}");
    assert!(
        run.report(&summary)["unread"]
            .as_array()
            .is_none_or(Vec::is_empty)
    );
}

#[test]
fn an_unresolved_import_makes_the_check_incomplete() {
    let run = pair();
    run.write(
        "lonely.sigil",
        "@missing.sigil from Nowhere import { Thing }
component Lonely {
  goal {
    Wait for a provider.
  }
}
",
    );
    read_both(&run);
    run.read("lonely.sigil", &|_| String::new());
    let (code, summary, _) = run.check(None);
    assert_eq!(code, 1);
    let report = run.report(&summary);
    assert_eq!(report["state"], "disjoint"); // the planted conflict still wins
    assert_eq!(report["unresolvedImports"][0]["source"], "lonely.sigil");
}

#[test]
fn a_source_outside_the_workspace_is_a_usage_error() {
    let run = pair();
    let (code, _, stderr) = run.check(Some("nope.sigil"));
    assert_eq!(code, 2, "{stderr}");
}

#[test]
fn a_root_without_configuration_is_an_operational_failure() {
    let empty = std::env::temp_dir().join(format!("sigil-linked-empty-{}", std::process::id()));
    fs::create_dir_all(&empty).unwrap();
    let (code, _, _) = claims(&["check", "--root", empty.to_str().unwrap()]);
    let _ = fs::remove_dir_all(&empty);
    assert_eq!(code, 3);
}
