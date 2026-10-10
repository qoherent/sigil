mod support;
use serde_json::{Value, json};
use std::{fs, process::Command};
use support::Workspace;
fn run(ws: &Workspace, args: &[&str]) -> (i32, Value, String) {
    let o = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(args)
        .args(["--root", ws.0.to_str().unwrap()])
        .output()
        .unwrap();
    (
        o.status.code().unwrap(),
        serde_json::from_slice(&o.stdout).unwrap_or(Value::Null),
        String::from_utf8_lossy(&o.stderr).into_owned(),
    )
}
fn workspace(exclude: Vec<&str>) -> Workspace {
    let ws = Workspace::new();
    let mut config: Value = serde_json::from_str(support::CONFIG).unwrap();
    config["tools"] =
        json!({"sigilc":{"implementation":{"dirs":["src"],"exclude":exclude,"allowEmpty":true}}});
    ws.write(".sigil/config.json", config.to_string().as_bytes());
    ws.write("search.sigil",b"component SearchService {\n interface {\n  Search {\n   Return *search results*.\n  }\n }\n}\n");
    ws.write("src/service.rs", b"fn search() {}\n");
    ws
}
fn design(ws: &Workspace, mode: &str) {
    let out = ws.0.join("design-prep");
    let r = run(
        ws,
        &[
            "prepare",
            "--source",
            "search.sigil",
            "--out",
            out.to_str().unwrap(),
        ],
    );
    assert_eq!(r.0, 0, "{r:?}");
    let request: Value =
        serde_json::from_slice(&fs::read(out.join("request.json")).unwrap()).unwrap();
    let mut rows = String::new();
    for f in request["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["context"] != true)
    {
        let id = f["facet"].as_str().unwrap();
        if mode == "loose" {
            rows.push_str(&format!(
                "(property {id:?} \"search results\" \"required\" \"true\")\n"
            ));
        } else {
            rows.push_str(&format!("(claim {id:?} \"SearchService\" \"provides\" \"search results\" \"required\" \"true\")\n"));
            if mode == "disjoint" {
                rows.push_str(&format!("(claim {id:?} \"SearchService\" \"provides\" \"search results\" \"required\" \"false\")\n"));
            }
        }
    }
    let artifact = out.join("answer.egg");
    fs::write(&artifact, rows).unwrap();
    let r = run(
        ws,
        &[
            "ingest",
            "--binding",
            out.join("binding.json").to_str().unwrap(),
            "--claims",
            artifact.to_str().unwrap(),
        ],
    );
    assert!(r.0 <= 1, "{r:?}");
}
fn code(ws: &Workspace, readings: &[(&str, &str)]) {
    let out = ws.0.join("code-prep");
    let r = run(ws, &["align", "prepare", "--out", out.to_str().unwrap()]);
    assert_eq!(r.0, 0, "{r:?}");
    for input in r.1["inputs"].as_array().unwrap() {
        let dir = std::path::PathBuf::from(input.as_str().unwrap());
        let b: Value =
            serde_json::from_slice(&fs::read(dir.join("binding.json")).unwrap()).unwrap();
        if let Some((_, rows)) = readings.iter().find(|(p, _)| b["path"] == *p) {
            let a = dir.join("answer.egg");
            fs::write(&a, rows).unwrap();
            let r = run(
                ws,
                &[
                    "align",
                    "ingest",
                    "--binding",
                    dir.join("binding.json").to_str().unwrap(),
                    "--claims",
                    a.to_str().unwrap(),
                ],
            );
            assert_eq!(r.0, 0, "{r:?}");
        }
    }
}
const CLEAN: &str = "(element \"search\" \"function\") (realizes \"search\" \"SearchService\") (realizes \"search\" \"search results\")";
fn check(ws: &Workspace) -> (i32, Value) {
    let r = run(ws, &["align", "check"]);
    assert!(r.0 <= 1, "{r:?}");
    let report: Value =
        serde_json::from_slice(&fs::read(r.1["report"].as_str().expect("report path")).unwrap())
            .unwrap();
    assert_eq!(report["version"], 1);
    let typed: sigilc::align::report::Report = serde_json::from_value(report.clone()).unwrap();
    assert_eq!(typed.version, sigilc::align::report::REPORT_VERSION);
    assert!(fs::metadata(r.1["judgmentContext"].as_str().unwrap()).is_ok());
    (r.0, report)
}
#[test]
fn closed_and_converged_have_success_exits() {
    for (mode, state) in [("coherent", "closed"), ("loose", "converged")] {
        let ws = workspace(vec![]);
        design(&ws, mode);
        let clean = if mode == "loose" {
            format!("{CLEAN} (act \"search\" \"owns\" \"search results\")")
        } else {
            CLEAN.into()
        };
        code(&ws, &[("src/service.rs", &clean)]);
        let (exit, r) = check(&ws);
        assert_eq!(exit, 0);
        assert_eq!(r["state"], state);
        assert!(r["findings"].as_array().unwrap().is_empty());
    }
}
#[test]
fn undesigned_whole_files_elements_and_helpers_are_reported() {
    let ws = workspace(vec![]);
    design(&ws, "coherent");
    ws.write("src/log.rs", b"fn log() {}\n");
    let rows = format!(
        "{CLEAN} (element \"normalize\" \"function\") (realizes \"normalize\" \"search results\") (element \"orphan\" \"function\")"
    );
    code(
        &ws,
        &[
            ("src/service.rs", &rows),
            ("src/log.rs", "(element \"log\" \"function\")"),
        ],
    );
    let (exit, r) = check(&ws);
    assert_eq!(exit, 1);
    assert_eq!(r["state"], "drift");
    assert_eq!(r["undesignedFiles"], json!(["src/log.rs"]));
    let elements = r["undesignedElements"].as_array().unwrap();
    assert!(elements.iter().any(|v| v == "src/service.rs::orphan"));
    assert!(!elements.iter().any(|v| v == "src/service.rs::normalize"));
    let f = r["findings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["law"] == "undesigned-file")
        .unwrap();
    assert_eq!(f["locations"][0]["source"], "src/log.rs");
    assert_eq!(f["locations"][0]["range"]["start"], 0);
    assert_eq!(
        f["locations"][0]["source_digest"].as_str().unwrap().len(),
        64
    );
}
#[test]
fn excludes_remove_code_from_judgment_and_count_it() {
    let ws = workspace(vec!["src/log.rs"]);
    design(&ws, "coherent");
    ws.write("src/log.rs", b"fn log() {}\n");
    code(&ws, &[("src/service.rs", CLEAN)]);
    let (exit, r) = check(&ws);
    assert_eq!(exit, 0);
    assert_eq!(
        r["selection"]["implementation"]["exclusions"][0],
        json!({"pattern":"src/log.rs","removed":1})
    );
}
#[test]
fn missing_provide_is_located_and_empty_selection_still_judges_promises() {
    for empty in [false, true] {
        let ws = workspace(vec![]);
        design(&ws, "coherent");
        if empty {
            fs::remove_file(ws.0.join("src/service.rs")).unwrap();
        } else {
            code(
                &ws,
                &[(
                    "src/service.rs",
                    "(element \"test\" \"test\") (realizes \"test\" \"search results\")",
                )],
            );
        }
        let (exit, r) = check(&ws);
        assert_eq!(exit, 1);
        assert_eq!(r["state"], "drift");
        let f = r["findings"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["law"] == "provides")
            .unwrap();
        assert_eq!(f["locations"][0]["side"], "design");
        assert_eq!(f["locations"][0]["source"], "search.sigil");
        assert!(f["locations"][0]["range"]["start"].as_u64().unwrap() > 0);
        assert!(f["detail"].as_str().unwrap().contains("search results"));
    }
}
#[test]
fn unread_design_disjoint_design_unread_and_unpresentable_files_are_incomplete() {
    for reason in [
        "design-incomplete",
        "design-disjoint",
        "unread-files",
        "unpresentable-files",
    ] {
        let ws = workspace(vec![]);
        if reason != "design-incomplete" {
            design(
                &ws,
                if reason == "design-disjoint" {
                    "disjoint"
                } else {
                    "coherent"
                },
            );
        }
        if reason != "unread-files" {
            code(&ws, &[("src/service.rs", CLEAN)]);
        }
        if reason == "unpresentable-files" {
            ws.write("src/binary.rs", &[255]);
        }
        let (exit, r) = check(&ws);
        assert_eq!(exit, 1);
        assert_eq!(r["state"], "incomplete");
        assert!(
            r["incompleteReasons"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == reason),
            "{r}"
        );
        if reason.starts_with("design-") {
            assert!(r["findings"].as_array().unwrap().is_empty());
            assert!(r["unanswered"].as_array().unwrap().is_empty());
        }
    }
}
#[test]
fn outside_components_not_judged_but_full_design_remains_gate() {
    let ws = workspace(vec![]);
    ws.write(
        "other.sigil",
        b"component Other {\n interface {\n  Work {\n   Return *other result*.\n  }\n }\n}\n",
    );
    let mut config: Value =
        serde_json::from_slice(&fs::read(ws.0.join(".sigil/config.json")).unwrap()).unwrap();
    config["tools"]["sigilc"]["implementation"]["design"] = json!(["search.sigil"]);
    ws.write(".sigil/config.json", config.to_string().as_bytes());
    design(&ws, "coherent");
    code(&ws, &[("src/service.rs", CLEAN)]);
    let (_, r) = check(&ws);
    assert_eq!(r["state"], "incomplete");
    assert_eq!(r["selection"]["outsideComponents"][0]["label"], "Other");
    assert!(
        r["unanswered"]
            .as_array()
            .unwrap()
            .iter()
            .all(|v| !v.to_string().contains("other result"))
    );
    let out = ws.0.join("other-prep");
    let r = run(
        &ws,
        &[
            "prepare",
            "--source",
            "other.sigil",
            "--out",
            out.to_str().unwrap(),
        ],
    );
    assert_eq!(r.0, 0, "{r:?}");
    let request: Value =
        serde_json::from_slice(&fs::read(out.join("request.json")).unwrap()).unwrap();
    let facet = request["rows"][0]["facet"].as_str().unwrap();
    let answer = out.join("answer.egg");
    fs::write(
        &answer,
        format!("(claim {facet:?} \"Other\" \"provides\" \"other result\" \"required\" \"true\")"),
    )
    .unwrap();
    assert_eq!(
        run(
            &ws,
            &[
                "ingest",
                "--binding",
                out.join("binding.json").to_str().unwrap(),
                "--claims",
                answer.to_str().unwrap()
            ]
        )
        .0,
        0
    );
    let (exit, r) = check(&ws);
    assert_eq!(exit, 0);
    assert_eq!(r["state"], "closed");
    assert!(r["unanswered"].as_array().unwrap().is_empty());
}
#[test]
fn usage_and_operational_failures_keep_compiler_exit_conventions() {
    let ws = workspace(vec![]);
    assert_eq!(run(&ws, &["align", "check", "--unknown", "x"]).0, 2);
    ws.write(".sigil/claims/workspace.align.json", b"");
    fs::remove_file(ws.0.join(".sigil/claims/workspace.align.json")).unwrap();
    fs::create_dir(ws.0.join(".sigil/claims/workspace.align.json")).unwrap();
    design(&ws, "coherent");
    code(&ws, &[("src/service.rs", CLEAN)]);
    assert_eq!(run(&ws, &["align", "check"]).0, 3);
}
#[test]
fn complete_slotted_design_and_implementation_saturate_with_default_limits() {
    use sigilc::{
        align::{self, dialect::Row as CRow},
        claims::{self, dialect::Row as DRow},
        structure::EntityType,
    };
    let ws = Workspace::new();
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/slotted");
    for file in fs::read_dir(fixture)
        .unwrap()
        .flatten()
        .map(|f| f.path())
        .filter(|p| p.extension().is_some_and(|e| e == "sigil"))
    {
        ws.write(
            file.file_name().unwrap().to_str().unwrap(),
            &fs::read(&file).unwrap(),
        );
    }
    let mut config: Value = serde_json::from_str(support::CONFIG).unwrap();
    config["tools"] = json!({"sigilc":{"implementation":{"dirs":["src"]}}});
    ws.write(".sigil/config.json", config.to_string().as_bytes());
    let (input, basis) = ws.load();
    let store = ws.0.join(".sigil");
    let mut promise_count = 0;
    for source in &input.sources {
        let request = claims::prepare::project(&input, &basis, &source.path).unwrap();
        let mut rows = Vec::new();
        for facet in request.own_rows() {
            rows.push(DRow::Reading {
                facet: facet.facet.clone(),
                outcome: "no-commitment".into(),
            });
            if facet.section == "interface" {
                for tag in request.entities.iter().filter(|e| {
                    e.kind == "Tag"
                        && e.owner.as_deref() == Some(facet.component.as_str())
                        && facet.names.contains(&e.label)
                }) {
                    rows.push(DRow::Claim {
                        facet: facet.facet.clone(),
                        subject: facet.component.clone(),
                        relation: "provides".into(),
                        object: tag.id.clone(),
                        modality: "required".into(),
                        expected: "true".into(),
                    });
                    promise_count += 1;
                }
            }
            if facet.prose.contains("must last at most 7 days") {
                let tag = request
                    .entities
                    .iter()
                    .find(|e| {
                        e.label == "booking request"
                            && e.owner.as_deref() == Some(facet.component.as_str())
                    })
                    .unwrap();
                for (property, number) in [("maxDurationDays", "7"), ("maxLeadDays", "180")] {
                    rows.push(DRow::Measure {
                        facet: facet.facet.clone(),
                        subject: tag.id.clone(),
                        property: property.into(),
                        number: number.into(),
                    });
                    promise_count += 1;
                }
            }
        }
        claims::identity::admit(&request, &input, &rows).unwrap();
        for unit in claims::memo::units(&request)
            .into_iter()
            .filter(|u| !u.context)
        {
            let owned: Vec<_> = rows
                .iter()
                .filter(|r| unit.facets.iter().any(|f| f == r.facet()))
                .cloned()
                .collect();
            claims::memo::save(&store, &request, &unit, &owned, Default::default()).unwrap();
        }
    }
    assert_eq!(input.sources.len(), 7);
    assert!(
        promise_count > 30,
        "full Slotted promise fixture: {promise_count}"
    );
    for component in input
        .entities
        .iter()
        .filter(|e| e.kind == EntityType::Component)
    {
        ws.write(
            &format!("src/{}.rs", component.label),
            format!("fn {}() {{}}\n", component.label.to_lowercase()).as_bytes(),
        );
    }
    let workspace = align::prepare::load(&ws.0, &store).unwrap();
    assert!(workspace.linked.unread.is_empty());
    let requests = workspace.requests(&ws.0).unwrap();
    for request in &requests {
        let component = input
            .entities
            .iter()
            .find(|e| {
                e.kind == EntityType::Component
                    && request.binding.path == format!("src/{}.rs", e.label)
            })
            .unwrap();
        let mut rows = vec![
            CRow::Element {
                name: "work".into(),
                kind: "function".into(),
            },
            CRow::Realizes {
                element: "work".into(),
                design_name: component.id.clone(),
            },
        ];
        for tag in input
            .entities
            .iter()
            .filter(|e| e.owner.as_deref() == Some(component.id.as_str()))
        {
            rows.push(CRow::Realizes {
                element: "work".into(),
                design_name: tag.id.clone(),
            });
        }
        if component.label == "Booking" {
            rows.push(CRow::Measure {
                element: "work".into(),
                measure_name: "durationDays".into(),
                number: "7".into(),
            });
            rows.push(CRow::Measure {
                element: "work".into(),
                measure_name: "leadDays".into(),
                number: "180".into(),
            });
        }
        let admitted = align::admit::admit(request, &rows).unwrap();
        align::memo::save(&store, request, &admitted).unwrap();
    }
    let (exit, r) = check(&ws);
    assert_eq!(exit, 0, "{r}");
    assert_eq!(r["state"], "closed");
    assert!(r["iterations"].as_u64().unwrap() < 10000);
    println!(
        "Slotted linked sources={}, Facets={}, promises={}, implementation files={}, align iterations={}",
        input.sources.len(),
        input.units.len(),
        promise_count,
        requests.len(),
        r["iterations"]
    );
    let booking = requests
        .iter()
        .find(|r| r.binding.path == "src/Booking.rs")
        .unwrap();
    let mut admitted = align::memo::load(&store, booking).unwrap();
    for row in &mut admitted.rows {
        if let CRow::Measure {
            measure_name,
            number,
            ..
        } = row
            && measure_name == "leadDays"
        {
            *number = "365".into();
        }
    }
    let planted = align::admit::admit(booking, &admitted.rows).unwrap();
    align::memo::save(&store, booking, &planted).unwrap();
    let (exit, r) = check(&ws);
    assert_eq!(exit, 1);
    assert_eq!(r["state"], "drift");
    assert!(
        r["findings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["law"] == "numeric-budget")
    );
}
#[test]
fn design_check_publishes_editor_locations_with_version_six() {
    let ws = workspace(vec![]);
    design(&ws, "disjoint");
    let (exit, summary, error) = run(&ws, &["check"]);
    assert_eq!(exit, 1, "{error}");
    let report: Value =
        serde_json::from_slice(&fs::read(summary["report"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(report["version"], 6);
    let location = &report["findings"][0]["locations"][0];
    assert_eq!(location["coordinate_system"], "utf8-bytes");
    assert_eq!(location["side"], "design");
    assert_eq!(location["source"], "search.sigil");
    let bytes = fs::read(ws.0.join("search.sigil")).unwrap();
    use sha2::{Digest, Sha256};
    assert_eq!(
        location["source_digest"],
        Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    let start = location["range"]["start"].as_u64().unwrap() as usize;
    let end = location["range"]["end"].as_u64().unwrap() as usize;
    assert!(
        std::str::from_utf8(&bytes[start..end])
            .unwrap()
            .contains("Return *search results*")
    );
}
#[test]
fn invalid_persisted_code_measure_becomes_unread_instead_of_panicking() {
    let ws = workspace(vec![]);
    design(&ws, "coherent");
    let rows = format!("{CLEAN} (measure \"search\" \"leadDays\" \"180\")");
    code(&ws, &[("src/service.rs", &rows)]);
    let path = fs::read_dir(ws.0.join(".sigil/claims/implementation"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let mut stored: sigilc::align::memo::Stored =
        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    for row in &mut stored.rows {
        if let sigilc::align::dialect::Row::Measure { number, .. } = row {
            *number = "oops".into();
        }
    }
    fs::write(&path, serde_json::to_vec(&stored).unwrap()).unwrap();
    let (exit, r) = check(&ws);
    assert_eq!(exit, 1);
    assert_eq!(r["state"], "incomplete");
    assert_eq!(r["unreadFiles"], json!(["src/service.rs"]));
}
#[test]
fn exclusive_ownership_finding_locates_design_and_both_code_sides() {
    let ws = workspace(vec![]);
    ws.write("panel.sigil",b"component SearchPanel {\n state {\n  SearchPanel exclusively owns *active request*.\n }\n}\n");
    design(&ws, "coherent");
    let out = ws.0.join("panel-prep");
    let r = run(
        &ws,
        &[
            "prepare",
            "--source",
            "panel.sigil",
            "--out",
            out.to_str().unwrap(),
        ],
    );
    assert_eq!(r.0, 0, "{r:?}");
    let request: Value =
        serde_json::from_slice(&fs::read(out.join("request.json")).unwrap()).unwrap();
    let facet = request["rows"][0]["facet"].as_str().unwrap();
    let answer = out.join("answer.egg");
    fs::write(&answer,format!("(claim {facet:?} \"SearchPanel\" \"owns\" \"active request\" \"required\" \"true\") (property {facet:?} \"active request\" \"exclusive\" \"true\") (property {facet:?} \"active request\" \"required\" \"true\")")).unwrap();
    assert_eq!(
        run(
            &ws,
            &[
                "ingest",
                "--binding",
                out.join("binding.json").to_str().unwrap(),
                "--claims",
                answer.to_str().unwrap()
            ]
        )
        .0,
        0
    );
    ws.write("src/panel.rs", b"struct Panel {}\n");
    ws.write("src/cache.rs", b"struct Cache {}\n");
    code(
        &ws,
        &[
            ("src/service.rs", CLEAN),
            (
                "src/panel.rs",
                "(element \"panel\" \"state\") (realizes \"panel\" \"SearchPanel\") (act \"panel\" \"owns\" \"active request\")",
            ),
            (
                "src/cache.rs",
                "(element \"cache\" \"state\") (act \"cache\" \"owns\" \"active request\")",
            ),
        ],
    );
    let (exit, r) = check(&ws);
    assert_eq!(exit, 1);
    let f = r["findings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["law"] == "exclusive-ownership")
        .unwrap();
    assert_eq!(f["claims"].as_array().unwrap().len(), 2);
    for path in ["panel.sigil", "src/panel.rs", "src/cache.rs"] {
        assert!(
            f["locations"]
                .as_array()
                .unwrap()
                .iter()
                .any(|l| l["source"] == path),
            "{f}"
        );
    }
    for path in ["src/panel.rs", "src/cache.rs"] {
        assert!(
            f["codeRows"].as_array().unwrap().iter().any(
                |row| row["path"] == path && row["element"].as_str().unwrap().starts_with(path)
            )
        );
    }
}
#[test]
fn excluding_unpresentable_code_resolves_incomplete_without_reasking_read_files() {
    let ws = workspace(vec![]);
    design(&ws, "coherent");
    code(&ws, &[("src/service.rs", CLEAN)]);
    ws.write("src/binary.rs", &[255]);
    assert_eq!(check(&ws).1["state"], "incomplete");
    let mut config: Value =
        serde_json::from_slice(&fs::read(ws.0.join(".sigil/config.json")).unwrap()).unwrap();
    config["tools"]["sigilc"]["implementation"]["exclude"] = json!(["src/binary.rs"]);
    ws.write(".sigil/config.json", config.to_string().as_bytes());
    let (exit, r) = check(&ws);
    assert_eq!(exit, 0);
    assert_eq!(r["state"], "closed");
    assert_eq!(
        r["selection"]["implementation"]["exclusions"][0]["removed"],
        1
    );
}
