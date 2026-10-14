//! The review view: the linked check's computed evidence in a form a judge can
//! read whole, with an evidence file that maps every alias in it back to exact
//! identities and source bytes.
//!
//! Each test drives the `sigilc` binary against a real `.sigil` workspace,
//! except the last, which builds the bundle from a design loaded in-process so
//! it can change a file between loading and emitting.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::PathBuf,
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
};

mod support;
use support::Workspace;

fn claims(args: &[&str]) -> (i32, Value, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(args)
        .output()
        .expect("sigilc runs");
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    (
        output.status.code().unwrap_or(-1),
        serde_json::from_str(&stdout).unwrap_or(Value::Null),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

struct Run {
    ws: Workspace,
    /// Each Facet's prose as `prepare` presented it, independent of anything
    /// the check later writes.
    presented: std::cell::RefCell<BTreeMap<String, String>>,
}

struct Prepared {
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

/// What one `check` wrote, read back from disk.
struct Checked {
    code: i32,
    summary: Value,
    view: String,
    evidence: Value,
    report: Value,
    context: Value,
}

impl Run {
    fn new() -> Self {
        Self {
            ws: Workspace::new(),
            presented: Default::default(),
        }
    }

    fn write(&self, path: &str, text: &str) {
        self.ws.write(path, text.as_bytes());
    }

    fn root(&self) -> &str {
        self.ws.0.to_str().unwrap()
    }

    /// Prepare a source and answer it with `rows`, plus a `reading` for every
    /// presented Facet the rows do not name, so every unit is stored.
    fn read(&self, source: &str, rows: &dyn Fn(&Prepared) -> String) {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let out = self.ws.0.join(format!("prep-{n}"));
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
        let prepared = Prepared { targets };
        self.presented
            .borrow_mut()
            .extend(prepared.targets.iter().cloned());
        let mut artifact = rows(&prepared);
        for (facet, _) in &prepared.targets {
            if !artifact.contains(&format!("{facet:?}")) {
                artifact.push_str(&format!("(reading {facet:?} \"no-commitment\")\n"));
            }
        }
        let file = self.ws.0.join(format!("result-{n}.egg"));
        fs::write(&file, artifact).unwrap();
        let (code, summary, stderr) = claims(&[
            "ingest",
            "--binding",
            out.join("binding.json").to_str().unwrap(),
            "--claims",
            file.to_str().unwrap(),
            "--root",
            self.root(),
        ]);
        assert!(code <= 1, "{summary}{stderr}");
        assert_eq!(summary["refusalCount"], 0, "{summary}");
    }

    fn check(&self, source: Option<&str>) -> Checked {
        let mut args = vec!["check", "--root", self.root()];
        if let Some(source) = source {
            args.extend(["--source", source]);
        }
        let (code, summary, stderr) = claims(&args);
        assert!(code <= 1, "{summary}{stderr}");
        let read = |key: &str| {
            fs::read(
                summary[key]
                    .as_str()
                    .unwrap_or_else(|| panic!("check names its {key}: {summary}")),
            )
            .unwrap()
        };
        let json = |key: &str| serde_json::from_slice::<Value>(&read(key)).unwrap();
        Checked {
            code,
            view: String::from_utf8(read("reviewView")).unwrap(),
            evidence: json("reviewEvidence"),
            report: json("report"),
            context: json("judgmentContext"),
            summary,
        }
    }
}

impl Checked {
    fn entries(&self, list: &str) -> &Vec<Value> {
        self.evidence[list].as_array().unwrap()
    }

    /// The line of the view an alias opens.
    fn line(&self, alias: &str) -> &str {
        let found: Vec<&str> = self
            .view
            .lines()
            .filter(|l| l.split_whitespace().next() == Some(alias))
            .collect();
        assert_eq!(
            found.len(),
            1,
            "one line opens with {alias}:\n{}",
            self.view
        );
        found[0]
    }

    /// The alias of the one claim whose context body satisfies `pick`.
    fn claim(&self, pick: impl Fn(&Value) -> bool) -> String {
        let found: Vec<String> = self
            .entries("claims")
            .iter()
            .filter(|c| {
                pick(
                    &self
                        .context
                        .pointer(c["context"].as_str().unwrap())
                        .expect("claim pointer resolves")["body"],
                )
            })
            .map(|c| c["alias"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(found.len(), 1, "one claim matches: {found:?}");
        found[0].clone()
    }

    fn alias_of(&self, list: &str, field: &str, id: &str) -> String {
        self.entries(list)
            .iter()
            .find(|e| e[field] == id)
            .unwrap_or_else(|| panic!("{list} names {id}"))["alias"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    fn entity(&self, label: &str) -> String {
        let found: Vec<&Value> = self
            .entries("entities")
            .iter()
            .filter(|e| e["label"] == label)
            .collect();
        assert_eq!(found.len(), 1, "one entity labelled {label}");
        found[0]["alias"].as_str().unwrap().to_owned()
    }

    /// The unit entry whose prose holds `needle`.
    fn unit(&self, needle: &str) -> &Value {
        let found: Vec<&Value> = self
            .entries("units")
            .iter()
            .filter(|u| {
                self.context
                    .pointer(u["context"].as_str().unwrap())
                    .unwrap()["prose"]
                    .as_str()
                    .unwrap()
                    .contains(needle)
            })
            .collect();
        assert_eq!(found.len(), 1, "one unit holds `{needle}`");
        found[0]
    }
}

/// A unit's prose, read from `bytes` only when they are the bytes the
/// evidence names. An alias the evidence does not carry resolves to nothing.
fn resolve(evidence: &Value, alias: &str, bytes: &[u8]) -> Option<String> {
    let unit = evidence["units"]
        .as_array()?
        .iter()
        .find(|u| u["alias"] == alias)?;
    let location = &unit["location"];
    if location["source_digest"] != sha256(bytes) {
        return None;
    }
    let (start, end) = (
        location["range"]["start"].as_u64()? as usize,
        location["range"]["end"].as_u64()? as usize,
    );
    String::from_utf8(bytes.get(start..end)?.to_vec()).ok()
}

const ROOMS: &str = "rooms.sigil";
const BOOKING: &str = "booking.sigil";
const CALENDAR: &str = "calendar.sigil";

const ROOMS_SOURCE: &str = "component Rooms {
  goal {
    Own the room catalog.
  }
  interface {
    Rooms exposes a *mark* on every room.
  }
  state {
    Rooms owns the mark of every room.
  }
  logic {
    Rooms archives a room by setting the mark.
  }
  constraints {
    Rooms keeps every room addressable.

    Rooms reads the marker once and never imports framework code.
  }
  decisions {
    Rooms lets an owner restore the mark.
  }
}
";

const BOOKING_SOURCE: &str = "@rooms.sigil from Rooms import { mark }
component Booking {
  goal {
    Book a room.
  }
  logic {
    Booking sets the mark when a booking is cancelled.
  }
  constraints {
    Booking owns the mark, and only Booking may set it.
  }
}
";

/// Never read, so its units stay unread.
const CALENDAR_SOURCE: &str = "component Calendar {
  goal {
    Show the room calendar.
  }
}
";

/// Every body variant the vocabulary admits, plus one proposition authored in
/// two units and a claim in a non-committing role.
fn rooms_rows(p: &Prepared) -> String {
    let interface = p.facet("Rooms exposes");
    let state = p.facet("Rooms owns the mark");
    let logic = p.facet("Rooms archives");
    let addressable = p.facet("addressable");
    let marker = p.facet("marker");
    let decisions = p.facet("restore");
    format!(
        "(claim {interface:?} \"Rooms\" \"provides\" \"mark\" \"required\" \"true\")
(measure {interface:?} \"mark\" \"latencyMs\" \"250\")
(claim {state:?} \"Rooms\" \"owns\" \"mark\" \"required\" \"true\")
(claim {state:?} \"Rooms\" \"provides\" \"mark\" \"required\" \"true\")
(step {logic:?} \"1\")
(claim {logic:?} \"step:1\" \"writes\" \"mark\" \"required\" \"true\")
(guard {logic:?} \"step:1\" \"input\" \"roomId\")
(end {logic:?} \"1\")
(reading {addressable:?} \"unresolved\")
(undeclared {marker:?} \"mark\")
(undeclared {marker:?} \"framework code\")
(claim {decisions:?} \"Rooms\" \"excludes\" \"mark\" \"permitted\" \"false\")
"
    )
}

/// Booking claims the mark exclusively while Rooms owns it.
fn booking_rows(p: &Prepared) -> String {
    let goal = p.facet("Book a room");
    let rule = p.facet("Booking owns the mark");
    let logic = p.facet("Booking sets the mark");
    format!(
        "(claim {goal:?} \"Booking\" \"dependsOn\" \"Rooms\" \"required\" \"true\")
(claim {rule:?} \"Booking\" \"owns\" \"mark\" \"required\" \"true\")
(property {rule:?} \"mark\" \"exclusive\" \"true\")
(step {logic:?} \"1\")
(claim {logic:?} \"step:1\" \"writes\" \"mark\" \"required\" \"true\")
(end {logic:?} \"1\")
"
    )
}

fn design() -> Run {
    let run = Run::new();
    run.write(ROOMS, ROOMS_SOURCE);
    run.write(BOOKING, BOOKING_SOURCE);
    run.write(CALENDAR, CALENDAR_SOURCE);
    run.read(ROOMS, &rooms_rows);
    run.read(BOOKING, &booking_rows);
    run
}

/// Every alias the view mentions.
fn aliases_in(view: &str) -> BTreeSet<String> {
    let token = regex::Regex::new(r"\b[EUCDOFS][0-9]+\b").unwrap();
    token
        .find_iter(view)
        .map(|m| m.as_str().to_owned())
        .collect()
}

// ------------------------------------------------------------------- AE7

#[test]
fn check_writes_a_deterministic_view_whose_every_alias_resolves() {
    let run = design();
    let first = run.check(None);
    assert_eq!(first.code, 1, "an ownership conflict: {}", first.summary);
    assert_eq!(first.summary["state"], "disjoint");

    // The existing artifacts keep their schemas and versions.
    let report: sigilc::claims::findings::Report =
        serde_json::from_value(first.report.clone()).unwrap();
    assert_eq!(report.version, 6);
    let context: sigilc::claims::context::Context =
        serde_json::from_value(first.context.clone()).unwrap();
    assert_eq!(context.version, 1);
    assert!(context.units.iter().all(|u| !u.prose.is_empty()));

    // Every alias in the view is defined by the evidence, and no definition
    // goes unused by it.
    let defined: BTreeSet<String> = [
        "entities",
        "units",
        "claims",
        "conclusions",
        "obligations",
        "findings",
        "simplifications",
    ]
    .iter()
    .flat_map(|list| first.entries(list))
    .map(|e| e["alias"].as_str().unwrap().to_owned())
    .collect();
    assert_eq!(aliases_in(&first.view), defined, "{}", first.view);

    // The evidence binds the exact bytes of the view, report and context.
    let artifact = |key: &str, name: &str| {
        let entry = &first.evidence["artifacts"][key];
        let path = PathBuf::from(first.summary[name].as_str().unwrap());
        assert_eq!(entry["file"], path.file_name().unwrap().to_str().unwrap());
        assert_eq!(entry["sha256"], sha256(&fs::read(path).unwrap()), "{key}");
    };
    artifact("view", "reviewView");
    artifact("report", "report");
    artifact("context", "judgmentContext");
    assert_eq!(
        first.evidence["computation"]["workspaceDigest"],
        first.summary["workspaceDigest"]
    );

    // An unchanged workspace and store produce the same bytes.
    let second = run.check(None);
    assert_eq!(second.view, first.view);
    assert_eq!(second.evidence, first.evidence);

    // The view is much smaller than the context it summarises.
    let context_bytes = serde_json::to_vec(&first.context).unwrap().len();
    assert!(first.view.len() * 2 < context_bytes, "{}", first.view);
}

#[test]
fn every_body_variant_survives_rendering_and_independent_promises_stay_apart() {
    let run = design();
    let checked = run.check(None);
    let mark = checked.entity("mark");
    let rooms = checked.entity("Rooms");

    let line = |pick: &dyn Fn(&Value) -> bool| checked.line(&checked.claim(pick)).to_owned();
    let is = |kind: &'static str| move |b: &Value| b["kind"] == kind;

    // A permitted claim expected not to hold keeps both columns.
    let excluded = line(&|b| b["relation"] == "excludes");
    assert!(
        excluded.contains(&format!("{rooms} excludes {mark}")),
        "{excluded}"
    );
    assert!(excluded.contains("permitted"), "{excluded}");
    assert!(excluded.contains("expected false"), "{excluded}");
    // A required claim expected to hold is the unmarked default.
    let owned =
        line(&|b| b["relation"] == "owns" && b["subject"].as_str().unwrap().ends_with("Rooms"));
    assert!(owned.ends_with(&format!("{rooms} owns {mark}")), "{owned}");

    let measure = line(&is("measure"));
    assert!(
        measure.contains(&format!("{mark} latencyMs = 250")),
        "{measure}"
    );
    let property = line(&is("property"));
    assert!(
        property.contains(&format!("{mark} exclusive = true")),
        "{property}"
    );
    let reading = line(&|b| b["kind"] == "reading" && b["outcome"] == "unresolved");
    assert!(reading.contains("reading unresolved"), "{reading}");

    // A step is named by its claim alias wherever a row names it.
    let rooms_logic = checked.unit("Rooms archives")["facet"]
        .as_str()
        .unwrap()
        .to_owned();
    let step_alias = checked
        .entries("claims")
        .iter()
        .find(|c| {
            let body = &checked
                .context
                .pointer(c["context"].as_str().unwrap())
                .unwrap()["body"];
            body["kind"] == "step" && c["unit"] == checked.alias_of("units", "facet", &rooms_logic)
        })
        .unwrap()["alias"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(checked.line(&step_alias).contains("step 1"));
    let guard = line(&is("guard"));
    assert!(
        guard.contains("guard step 1: input = \"roomId\""),
        "{guard}"
    );
    let writes = checked
        .view
        .lines()
        .filter(|l| l.contains(&format!("{step_alias}:step1 writes {mark}")))
        .count();
    assert_eq!(writes, 1, "{}", checked.view);

    let undeclared = line(&|b| b["kind"] == "undeclared" && b["declared"].is_null());
    assert!(
        undeclared.contains("undeclared \"framework code\""),
        "{undeclared}"
    );
    let unreferenced = line(&|b| b["kind"] == "undeclared" && !b["declared"].is_null());
    assert!(
        unreferenced.contains("undeclared \"mark\""),
        "{unreferenced}"
    );
    assert!(unreferenced.contains(&mark), "{unreferenced}");

    // One proposition authored in two units stays two claims under two units,
    // and a simplification group names both.
    let provides: Vec<String> = checked
        .entries("claims")
        .iter()
        .filter(|c| {
            checked
                .context
                .pointer(c["context"].as_str().unwrap())
                .unwrap()["body"]["relation"]
                == "provides"
        })
        .map(|c| c["alias"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(provides.len(), 2);
    let units: BTreeSet<String> = checked
        .entries("claims")
        .iter()
        .filter(|c| provides.contains(&c["alias"].as_str().unwrap().to_owned()))
        .map(|c| c["unit"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(units.len(), 2, "the two claims sit in two units");
    let group = checked
        .entries("simplifications")
        .iter()
        .find(|s| s["kind"] == "duplicate-proposition")
        .expect("a duplicate-proposition group");
    let mut members: Vec<String> = group["claims"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap().to_owned())
        .collect();
    members.sort();
    let mut expected = provides.clone();
    expected.sort();
    assert_eq!(members, expected);
    for alias in &provides {
        assert!(
            checked
                .line(group["alias"].as_str().unwrap())
                .contains(alias.as_str()),
            "{}",
            checked.view
        );
    }

    // Every finding is listed with its claims, and the ownership conflict
    // reaches the view.
    assert_eq!(
        checked.entries("findings").len(),
        checked.report["findings"].as_array().unwrap().len()
    );
    assert!(
        checked.view.contains("exclusive-ownership"),
        "{}",
        checked.view
    );
}

// ------------------------------------------------------------------- AE4

#[test]
fn every_unit_stays_addressable_whatever_its_coverage() {
    let run = design();
    let checked = run.check(None);
    let units = checked.entries("units");
    assert_eq!(
        units.len(),
        checked.context["units"].as_array().unwrap().len(),
        "one entry per context unit"
    );

    let coverage = |needle: &str| {
        checked.unit(needle)["coverage"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    assert_eq!(coverage("Rooms exposes"), "interpreted");
    assert_eq!(coverage("Own the room catalog"), "read-without-commitment");
    assert_eq!(coverage("Show the room calendar"), "unread");
    assert_eq!(coverage("restore the mark"), "interpreted");

    // Every unit's line in the view carries its coverage, and a
    // non-committing role says so.
    for unit in units {
        let line = checked.line(unit["alias"].as_str().unwrap());
        assert!(line.contains(unit["coverage"].as_str().unwrap()), "{line}");
    }
    let decisions = checked.unit("restore the mark")["alias"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(checked.line(&decisions).contains("non-committing"));
    assert_eq!(checked.evidence["scope"]["coverage"]["unread"], 1);

    // A unit with no claim and no finding still resolves to its exact prose.
    let calendar = checked.unit("Show the room calendar");
    assert_eq!(
        resolve(
            &checked.evidence,
            calendar["alias"].as_str().unwrap(),
            CALENDAR_SOURCE.as_bytes()
        )
        .as_deref()
        .map(str::trim),
        Some("Show the room calendar.")
    );
    for unit in units {
        let bytes = fs::read(run.ws.0.join(unit["source"].as_str().unwrap())).unwrap();
        let prose = resolve(&checked.evidence, unit["alias"].as_str().unwrap(), &bytes)
            .expect("every unit resolves against the bytes the check read");
        let context = checked
            .context
            .pointer(unit["context"].as_str().unwrap())
            .unwrap();
        assert_eq!(context["prose"].as_str().unwrap().trim(), prose.trim());
        // And it is the prose `prepare` presented for that Facet, which the
        // evidence did not produce.
        if let Some(presented) = run.presented.borrow().get(unit["facet"].as_str().unwrap()) {
            let words = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");
            assert_eq!(words(presented), words(&prose));
        }
    }
}

#[test]
fn a_refused_reading_and_an_unresolved_import_reach_the_evidence_and_the_view() {
    let run = design();
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
    run.read("lonely.sigil", &|_| String::new());

    // Rewrite one stored Rooms reading so it names an entity outside its
    // source's request. Its recorded context still matches, so the memo
    // reuses it without admitting it.
    let state = run.check(None).unit("Rooms owns the mark")["facet"]
        .as_str()
        .unwrap()
        .to_owned();
    let memo = run.ws.0.join(".sigil/claims/interpretations");
    let mut corrupted = 0;
    for entry in fs::read_dir(&memo).unwrap().flatten() {
        let text = fs::read_to_string(entry.path()).unwrap();
        if text.contains(&state) && text.contains("\"Rooms\"") {
            fs::write(entry.path(), text.replace("\"Rooms\"", "\"Ghost\"")).unwrap();
            corrupted += 1;
        }
    }
    assert_eq!(corrupted, 1);
    let checked = run.check(None);

    // The refused unit is refused in the evidence, the totals and the view,
    // and the view carries the report's refusal reason.
    let refused = checked.unit("Rooms owns the mark");
    assert_eq!(refused["coverage"], "refused", "{refused}");
    let alias = refused["alias"].as_str().unwrap();
    assert!(checked.line(alias).contains("refused"), "{}", checked.view);
    assert!(
        checked.evidence["scope"]["coverage"]["refused"]
            .as_u64()
            .unwrap()
            >= 1
    );
    let entry = checked
        .entries("unread")
        .iter()
        .find(|u| u["units"].as_array().unwrap().iter().any(|a| a == alias))
        .expect("the refused unit is listed as unread");
    let reported = checked
        .report
        .pointer(entry["report"].as_str().unwrap())
        .expect("unread pointer resolves");
    let refusal = reported["refusal"].as_str().unwrap();
    assert!(refusal.contains("Ghost"), "{reported}");
    let lines: Vec<&str> = checked
        .view
        .lines()
        .filter(|l| l.starts_with("Refused ") && l.contains(alias))
        .collect();
    assert_eq!(lines.len(), 1, "{}", checked.view);
    assert!(lines[0].contains(refusal), "{}", lines[0]);

    // The unresolved import is counted, pointed at in the report, and named
    // in the view.
    let imports = checked.report["unresolvedImports"].as_array().unwrap();
    assert!(!imports.is_empty(), "{}", checked.report);
    assert_eq!(
        checked.evidence["scope"]["coverage"]["unresolvedImports"],
        imports.len()
    );
    let pointers = checked.entries("unresolvedImports");
    assert_eq!(pointers.len(), imports.len());
    for pointer in pointers {
        let import = checked
            .report
            .pointer(pointer.as_str().unwrap())
            .expect("unresolved-import pointer resolves");
        assert_eq!(import["source"], "lonely.sigil", "{import}");
    }
    assert!(
        checked
            .view
            .lines()
            .any(|l| l.starts_with("Unresolved import in lonely.sigil")),
        "{}",
        checked.view
    );
}

#[test]
fn a_source_filter_narrows_findings_but_not_the_computation_context() {
    let run = design();
    let whole = run.check(None);
    let filtered = run.check(Some(CALENDAR));

    assert!(
        filtered.summary["reviewView"]
            .as_str()
            .unwrap()
            .ends_with("calendar.sigil.linked.review.md")
    );
    assert_eq!(filtered.evidence["scope"]["reportFilter"], CALENDAR);
    assert!(whole.evidence["scope"]["reportFilter"].is_null());
    assert_eq!(filtered.evidence["scope"]["computation"], "workspace");
    assert!(
        filtered.view.contains("report filter: calendar.sigil"),
        "{}",
        filtered.view
    );

    // Calendar authored only the gap its own unread goal leaves, yet the view
    // still carries every unit, claim and coverage gap of the workspace.
    assert_eq!(
        filtered.entries("findings").len(),
        filtered.report["findings"].as_array().unwrap().len()
    );
    assert!(filtered.entries("findings").len() < whole.entries("findings").len());
    assert!(
        !filtered.view.contains("exclusive-ownership"),
        "{}",
        filtered.view
    );
    assert!(whole.view.contains("exclusive-ownership"));
    for list in ["units", "claims", "entities"] {
        assert_eq!(filtered.entries(list), whole.entries(list), "{list}");
    }
    assert_eq!(
        filtered.evidence["scope"]["coverage"],
        whole.evidence["scope"]["coverage"]
    );
}

#[test]
fn moving_prose_reuses_readings_but_changes_exact_source_identity() {
    let run = design();
    let before = run.check(None);

    // Rewrap one Facet and move the file's text down a line: the readings
    // still hold, but every byte coordinate moved.
    let moved = format!(
        "\n{}",
        ROOMS_SOURCE.replace(
            "Rooms owns the mark of every room.",
            "Rooms owns the mark\n    of every room."
        )
    );
    run.write(ROOMS, &moved);
    let after = run.check(None);
    assert_eq!(after.summary["unreadUnits"], before.summary["unreadUnits"]);
    assert_eq!(
        after.evidence["computation"]["identity"]["interpretations"],
        before.evidence["computation"]["identity"]["interpretations"],
        "every reading was reused"
    );

    let state = |checked: &Checked| checked.unit("Rooms owns the mark").clone();
    let (old, new) = (state(&before), state(&after));
    assert_eq!(
        old["facet"], new["facet"],
        "content identity survives the move"
    );
    assert_ne!(
        old["location"]["source_digest"],
        new["location"]["source_digest"]
    );
    assert_ne!(old["location"]["range"], new["location"]["range"]);

    // The old bundle cannot read the new revision, and the new one can.
    let bytes = moved.as_bytes();
    assert_eq!(
        resolve(&before.evidence, old["alias"].as_str().unwrap(), bytes),
        None
    );
    assert_eq!(
        resolve(&after.evidence, new["alias"].as_str().unwrap(), bytes)
            .as_deref()
            .map(str::trim),
        Some("Rooms owns the mark\n    of every room.")
    );
    assert_eq!(resolve(&after.evidence, "U999", bytes), None);

    let digest = |checked: &Checked| -> BTreeMap<String, String> {
        checked.evidence["inputs"]["sources"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| {
                (
                    s["path"].as_str().unwrap().to_owned(),
                    s["sha256"].as_str().unwrap().to_owned(),
                )
            })
            .collect()
    };
    let (old, new) = (digest(&before), digest(&after));
    assert_ne!(old[ROOMS], new[ROOMS]);
    assert_eq!(new[ROOMS], sha256(bytes));
    assert_eq!(old[BOOKING], new[BOOKING]);
}

#[test]
fn the_evidence_records_the_bytes_the_check_loaded_not_what_is_on_disk_later() {
    use sigilc::claims::{context, findings, link, program, review};

    let run = design();
    let store = run.ws.0.join(".sigil");
    let (input, basis) = run.ws.load();
    let loaded = fs::read(run.ws.0.join(".sigil/config.json")).unwrap();

    // The configuration changes after the design was loaded, and a source is
    // added that the loaded design never saw.
    run.write(".sigil/config.json", &format!("{}\n", support::CONFIG));
    run.write(
        "late.sigil",
        "component Late {\n  goal {\n    Arrive late.\n  }\n}\n",
    );

    let linked = link::link(&input, &basis, &store).unwrap();
    let world = program::saturate(
        &linked.request,
        &linked.facts,
        sigilc::engine::Limits::default(),
    )
    .unwrap();
    let mut report = findings::linked_report(&linked, &world, None);
    findings::locate(&mut report, &input, &linked.facts);
    let context = context::build(
        &linked.request,
        &linked.facts,
        &world,
        report.identity.clone(),
    );
    let bundle = review::build(&review::Inputs {
        input: &input,
        linked: &linked,
        world: &world,
        report: &report,
        context: &context,
        filter: None,
        report_artifact: review::Artifact::new("workspace.linked.json", b"report"),
        context_artifact: review::Artifact::new("workspace.linked.context.json", b"context"),
    });
    let evidence = serde_json::to_value(&bundle.evidence).unwrap();

    let context_files: BTreeMap<String, Value> = evidence["inputs"]["context"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| (c["path"].as_str().unwrap().to_owned(), c.clone()))
        .collect();
    let config = &context_files[".sigil/config.json"];
    assert_eq!(config["present"], true);
    assert_eq!(config["sha256"], sha256(&loaded));
    assert_ne!(
        config["sha256"],
        sha256(&fs::read(run.ws.0.join(".sigil/config.json")).unwrap())
    );
    // Absent optional context is recorded as absent, not left out.
    let glossary = &context_files[".sigil/glossary.json"];
    assert_eq!(glossary["present"], false);
    assert!(glossary["sha256"].is_null());

    let sources: BTreeSet<&str> = evidence["inputs"]["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["path"].as_str().unwrap())
        .collect();
    assert_eq!(sources, BTreeSet::from([BOOKING, CALENDAR, ROOMS]));
    assert_eq!(evidence["artifacts"]["report"]["sha256"], sha256(b"report"));
    assert_eq!(
        evidence["artifacts"]["view"]["sha256"],
        sha256(bundle.view.as_bytes())
    );
}

// ------------------------------------------------------------ conclusions

const LEDGER_SOURCE: &str = "component Ledger {
  interface {
    Ledger provides an *entry*.
  }
}
";

const BILLING_SOURCE: &str = "@ledger.sigil from Ledger import { entry }
component Billing {
  goal {
    Billing depends on Ledger.
  }
  interface {
    Billing provides a *charge*.
  }
}
";

const SHOP_SOURCE: &str = "@billing.sigil from Billing import { charge }
component Shop {
  goal {
    Shop depends on Billing and hands charging to it.
  }
  logic {
    Shop takes an order, then charges it, and the charge ends the order.
  }
}
";

#[test]
fn a_conclusion_witnessed_by_a_component_or_graph_still_names_its_premises() {
    let run = Run::new();
    run.write("ledger.sigil", LEDGER_SOURCE);
    run.write("billing.sigil", BILLING_SOURCE);
    run.write("shop.sigil", SHOP_SOURCE);
    run.read("ledger.sigil", &|p| {
        let iface = p.facet("Ledger provides");
        format!("(claim {iface:?} \"Ledger\" \"provides\" \"entry\" \"required\" \"true\")\n")
    });
    run.read("billing.sigil", &|p| {
        let goal = p.facet("depends on Ledger");
        let iface = p.facet("Billing provides");
        format!(
            "(claim {goal:?} \"Billing\" \"dependsOn\" \"Ledger\" \"required\" \"true\")
(claim {iface:?} \"Billing\" \"provides\" \"charge\" \"required\" \"true\")
"
        )
    });
    run.read("shop.sigil", &|p| {
        let goal = p.facet("Shop depends");
        let logic = p.facet("takes an order");
        format!(
            "(claim {goal:?} \"Shop\" \"dependsOn\" \"Billing\" \"required\" \"true\")
(claim {goal:?} \"Shop\" \"delegates\" \"Billing\" \"required\" \"true\")
(step {logic:?} \"1\")
(step {logic:?} \"2\")
(claim {logic:?} \"step:1\" \"to\" \"step:2\" \"required\" \"true\")
(end {logic:?} \"2\")
"
        )
    });
    let checked = run.check(None);

    let claim = |relation: &str, subject: &str| {
        checked.claim(|b| {
            b["relation"] == relation && b["subject"].as_str().unwrap().ends_with(subject)
        })
    };
    let step = |ordinal: u64| -> String {
        let alias = checked.claim(|b| b["kind"] == "step" && b["ordinal"] == ordinal);
        checked
            .entries("claims")
            .iter()
            .find(|c| c["alias"] == alias.as_str())
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    // The premises of the one derivation by `law` about `subject`, and the
    // alias of the conclusion it supports.
    let derived = |law: &str, subject: &str| -> (String, Vec<String>) {
        let found: Vec<(String, Vec<String>)> = checked
            .entries("conclusions")
            .iter()
            .filter(|c| c["subject"].as_str().unwrap().ends_with(subject))
            .flat_map(|c| {
                c["derivations"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|d| d["law"] == law)
                    .map(|d| {
                        let premises = d["premises"].as_array().unwrap();
                        (
                            c["alias"].as_str().unwrap().to_owned(),
                            premises
                                .iter()
                                .map(|a| a.as_str().unwrap().to_owned())
                                .collect(),
                        )
                    })
            })
            .collect();
        assert_eq!(found.len(), 1, "one {law} derivation about {subject}");
        found[0].clone()
    };

    let (shop_reaches_billing, premises) = derived("dependency-direct", "Shop");
    assert_eq!(premises, [claim("dependsOn", "Shop")]);
    let (_, premises) = derived("dependency-direct", "Billing");
    assert_eq!(premises, [claim("dependsOn", "Billing")]);
    let (_, premises) = derived("dependency-transitive", "Shop");
    assert_eq!(
        premises,
        [claim("dependsOn", "Billing"), shop_reaches_billing]
    );
    let (_, premises) = derived("delegated-capability", "Shop");
    assert_eq!(
        premises,
        [claim("delegates", "Shop"), claim("provides", "Billing")]
    );

    let (first, second) = (step(1), step(2));
    let (second_ends, premises) = derived("flow-end-direct", &second);
    assert_eq!(premises, [claim("to", &second)]);
    let (_, premises) = derived("flow-end-transitive", &first);
    assert_eq!(premises, [claim("to", &first), second_ends]);

    // The view names each conclusion's premises on its line.
    for c in checked.entries("conclusions") {
        let line = checked.line(c["alias"].as_str().unwrap());
        assert!(line.contains(" · from "), "{line}");
    }
}

// ------------------------------------------------------------- file names

#[test]
fn sources_whose_paths_differ_only_by_a_separator_keep_separate_artifacts() {
    let run = Run::new();
    run.write(
        "a/b.sigil",
        "component Nested {\n  goal {\n    Stay nested.\n  }\n}\n",
    );
    run.write(
        "a_b.sigil",
        "component Flat {\n  goal {\n    Stay flat.\n  }\n}\n",
    );
    run.read("a/b.sigil", &|_| String::new());
    run.read("a_b.sigil", &|_| String::new());

    let nested = run.check(Some("a/b.sigil"));
    let flat = run.check(Some("a_b.sigil"));
    let name = |checked: &Checked, key: &str| {
        PathBuf::from(checked.summary[key].as_str().unwrap())
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_owned()
    };
    assert_eq!(name(&nested, "report"), "a%2Fb.sigil.linked.json");
    assert_eq!(name(&flat, "report"), "a_b.sigil.linked.json");
    for key in ["report", "judgmentContext", "reviewView", "reviewEvidence"] {
        assert_ne!(name(&nested, key), name(&flat, key), "{key}");
    }
    // The second check overwrote nothing the first wrote.
    assert_eq!(nested.report["source"], "a/b.sigil");
    let reread: Value =
        serde_json::from_slice(&fs::read(nested.summary["report"].as_str().unwrap()).unwrap())
            .unwrap();
    assert_eq!(reread["source"], "a/b.sigil");
    // The evidence names its own file and the view by the same encoded names.
    assert_eq!(
        nested.evidence["artifacts"]["view"]["file"],
        name(&nested, "reviewView")
    );
}

// ------------------------------------------------- obligations and groups

const JOURNAL_LEDGER_SOURCE: &str = "component Ledger {
  goal {
    Ledger keeps a *journal*.
  }
  interface {
    Ledger provides an *entry*.
  }
}
";

const ENTRY_BILLING_SOURCE: &str = "@ledger.sigil from Ledger import { entry }
component Billing {
  goal {
    Billing depends on Ledger for an entry behind each charge.
  }
  interface {
    Billing provides a *charge*.
  }
}
";

const LOOSE_SHOP_SOURCE: &str = "@billing.sigil from Billing import { charge }
component Shop {
  goal {
    Shop depends on Billing and hands charging to it.
  }
  interface {
    Shop offers each charge Billing makes.
  }
  logic {
    Shop takes an order, then charges it.
  }
}
";

/// Every obligation state, a note two findings share, a duplicate stated in
/// three units, and a claim the laws already derive. Unit and claim placement
/// is checked against what `prepare` presented and where each row was written,
/// not against the evidence's own pointers.
#[test]
fn obligations_notes_and_groups_reach_the_view_as_the_rows_placed_them() {
    let run = Run::new();
    run.write("ledger.sigil", JOURNAL_LEDGER_SOURCE);
    run.write("billing.sigil", ENTRY_BILLING_SOURCE);
    run.write("shop.sigil", LOOSE_SHOP_SOURCE);
    run.read("ledger.sigil", &|p| {
        let goal = p.facet("journal");
        let iface = p.facet("Ledger provides");
        format!(
            "(claim {goal:?} \"Ledger\" \"requires\" \"journal\" \"required\" \"true\")
(claim {iface:?} \"Ledger\" \"provides\" \"entry\" \"required\" \"true\")
"
        )
    });
    run.read("billing.sigil", &|p| {
        let goal = p.facet("depends on Ledger for");
        let iface = p.facet("Billing provides");
        format!(
            "(claim {goal:?} \"Billing\" \"dependsOn\" \"Ledger\" \"required\" \"true\")
(claim {goal:?} \"Billing\" \"requires\" \"entry\" \"required\" \"true\")
(claim {goal:?} \"Billing\" \"provides\" \"charge\" \"required\" \"true\")
(claim {iface:?} \"Billing\" \"provides\" \"charge\" \"required\" \"true\")
"
        )
    });
    run.read("shop.sigil", &|p| {
        let goal = p.facet("Shop depends");
        let iface = p.facet("Shop offers");
        let logic = p.facet("takes an order");
        format!(
            "(claim {goal:?} \"Shop\" \"dependsOn\" \"Billing\" \"required\" \"true\")
(claim {goal:?} \"Shop\" \"delegates\" \"Billing\" \"required\" \"true\")
(claim {iface:?} \"Billing\" \"provides\" \"charge\" \"required\" \"true\")
(claim {iface:?} \"Shop\" \"provides\" \"charge\" \"required\" \"true\")
(step {logic:?} \"1\")
(step {logic:?} \"2\")
(claim {logic:?} \"step:1\" \"to\" \"step:2\" \"required\" \"true\")
"
        )
    });
    let checked = run.check(None);
    let presented = run.presented.borrow();
    let words = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");

    // Each unit's bytes are the prose `prepare` presented for its Facet.
    let units = checked.entries("units");
    assert_eq!(units.len(), presented.len());
    for unit in units {
        let facet = unit["facet"].as_str().unwrap();
        let bytes = fs::read(run.ws.0.join(unit["source"].as_str().unwrap())).unwrap();
        let resolved = resolve(&checked.evidence, unit["alias"].as_str().unwrap(), &bytes)
            .expect("every unit resolves");
        assert_eq!(words(&resolved), words(&presented[facet]), "{facet}");
    }
    // Each claim sits under the unit its row was written for.
    let facet_of_unit: BTreeMap<&str, &str> = units
        .iter()
        .map(|u| (u["alias"].as_str().unwrap(), u["facet"].as_str().unwrap()))
        .collect();
    let written_in = |claim: &str| -> &str {
        let entry = checked
            .entries("claims")
            .iter()
            .find(|c| c["alias"] == claim)
            .unwrap();
        &presented[facet_of_unit[entry["unit"].as_str().unwrap()]]
    };
    let claim = |relation: &str, subject: &str, object: &str| {
        checked.claim(|b| {
            b["relation"] == relation
                && b["subject"].as_str().unwrap().ends_with(subject)
                && b["object"].as_str().unwrap().ends_with(object)
        })
    };
    assert!(written_in(&claim("requires", "Ledger", "journal")).contains("journal"));
    assert!(written_in(&claim("requires", "Billing", "entry")).contains("depends on Ledger"));
    assert!(written_in(&claim("provides", "Shop", "charge")).contains("Shop offers"));

    // A filled and an unmet obligation, each labelled, and the unmet finding
    // names only the unmet one.
    let obligation = |claim: &str| -> (String, bool) {
        let entry = checked
            .entries("obligations")
            .iter()
            .find(|o| o["claim"] == claim)
            .unwrap_or_else(|| panic!("an obligation for {claim}"));
        (
            entry["alias"].as_str().unwrap().to_owned(),
            entry["filled"].as_bool().unwrap(),
        )
    };
    let (filled, is_filled) = obligation(&claim("requires", "Billing", "entry"));
    let (unmet, is_filled_too) = obligation(&claim("requires", "Ledger", "journal"));
    assert!(is_filled && !is_filled_too);
    assert!(
        checked.line(&filled).ends_with("· filled"),
        "{}",
        checked.view
    );
    assert!(
        checked.line(&unmet).ends_with("· unmet"),
        "{}",
        checked.view
    );
    let unmet_findings: Vec<&Value> = checked
        .entries("findings")
        .iter()
        .filter(|f| !f["obligations"].as_array().unwrap().is_empty())
        .collect();
    assert_eq!(unmet_findings.len(), 1, "{}", checked.view);
    assert_eq!(unmet_findings[0]["obligations"], serde_json::json!([unmet]));
    let unmet_line = checked.line(unmet_findings[0]["alias"].as_str().unwrap());
    assert!(!unmet_line.contains("note"), "{unmet_line}");

    // Two steps that reach no end share one note, written once.
    let unreached: Vec<&str> = checked
        .view
        .lines()
        .filter(|l| l.contains("unreached-step"))
        .collect();
    assert_eq!(unreached.len(), 2, "{}", checked.view);
    let note = |line: &str| line.rsplit("· ").next().unwrap().to_owned();
    assert_eq!(note(unreached[0]), note(unreached[1]));
    let label = format!("{}:", note(unreached[0]));
    assert_eq!(
        checked
            .view
            .lines()
            .filter(|l| l.starts_with(&label))
            .count(),
        1,
        "{}",
        checked.view
    );

    // One proposition stated in three units folds into one group of three.
    let groups: Vec<&Value> = checked
        .entries("simplifications")
        .iter()
        .filter(|s| s["kind"] == "duplicate-proposition")
        .collect();
    assert_eq!(groups.len(), 1, "{}", checked.view);
    let members: BTreeSet<&str> = groups[0]["claims"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap())
        .collect();
    assert_eq!(members.len(), 3);
    let in_units: BTreeSet<&str> = checked
        .entries("claims")
        .iter()
        .filter(|c| members.contains(c["alias"].as_str().unwrap()))
        .map(|c| c["unit"].as_str().unwrap())
        .collect();
    assert_eq!(in_units.len(), 3, "the three claims sit in three units");
    assert!(
        groups[0]["context"].as_array().unwrap().len() >= 2,
        "the group keeps every pair it folds"
    );

    // A claim the laws already derive is marked as such.
    let subsumed = checked
        .entries("simplifications")
        .iter()
        .find(|s| s["kind"] == "subsumed-claim")
        .unwrap_or_else(|| panic!("a subsumed-claim candidate: {}", checked.view));
    assert_eq!(
        subsumed["claims"],
        serde_json::json!([claim("provides", "Shop", "charge")])
    );
    assert!(
        checked
            .line(subsumed["alias"].as_str().unwrap())
            .ends_with("(already derived by another route)"),
        "{}",
        checked.view
    );
}
