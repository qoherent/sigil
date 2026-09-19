use serde_json::{Value, json};
use sigilc::frontend::DesignInput;

fn fixture() -> Value {
    json!({
        "schemaVersion": 1, "frontendVersion": "0.7.1",
        "sources": [{"path":"a.sigil", "text":"component A {}\n"}],
        "context": [
            {"path":".sigil/config.json","text":"{}"},
            {"path":".sigil/local.json","text":null},
            {"path":".sigil/glossary.json","text":null}
        ],
        "diagnostics": [{"code":"SIGIL_MISSING_GOAL", "severity":"warning", "message":"Missing goal", "filePath":"a.sigil"}],
        "imports": [{"source":"a.sigil", "target":null,"names":[{"name":"Unknown","entity":null}]}],
        "entities": [{"id":"urn:sigil:component:a.sigil:A", "type":"Component", "label":"A", "source":"a.sigil", "owner":null, "exported":true}],
        "units": [{"id":"urn:sigil:unit:a.sigil:1:1", "source":"a.sigil", "owner":"urn:sigil:component:a.sigil:A", "form":"component", "section":"goal", "tag":null, "range":{"start":{"line":1,"column":1},"end":{"line":1,"column":15}}}]
    })
}

fn parse(value: &Value) -> Result<DesignInput, String> {
    DesignInput::parse(&serde_json::to_vec(value).unwrap())
}

#[test]
fn accepts_structural_transport_without_fabricating_unresolved_identity() {
    let input = parse(&fixture()).unwrap();
    assert!(input.imports[0].names[0].entity.is_none());
    let mut loose = fixture();
    loose["units"][0]["owner"] = Value::Null;
    assert!(parse(&loose).is_ok());
}

#[test]
fn rejects_semantic_or_production_fields_at_every_boundary() {
    for field in [
        "closure",
        "obligations",
        "inferredFacts",
        "implementationRequirements",
        "implementationResult",
        "rules",
        "ranking",
        "model",
        "prompt",
        "symbolMap",
    ] {
        for pointer in [
            "",
            "/sources/0",
            "/context/0",
            "/diagnostics/0",
            "/imports/0",
            "/imports/0/names/0",
            "/entities/0",
            "/units/0",
            "/units/0/range",
            "/units/0/range/start",
        ] {
            let mut value = fixture();
            value
                .pointer_mut(pointer)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert(field.into(), json!([]));
            assert!(
                parse(&value).unwrap_err().contains("unknown field"),
                "{pointer}: {field}"
            );
        }
    }
}

#[test]
fn rejects_invalid_structural_inputs() {
    for (pointer, replacement) in [
        ("/schemaVersion", json!(2)),
        ("/sources/0/path", json!("../a.sigil")),
        ("/sources/0/path", json!("C:/a.sigil")),
        ("/sources/0/path", json!(".sigil/worlds/a.sigil")),
        ("/sources/0/path", json!("src/a.ts")),
        ("/context/0/path", json!("neighbor.ts")),
        ("/entities/0/source", json!("absent.sigil")),
        ("/entities/0/type", json!("Obligation")),
        ("/entities/0/owner", json!("other")),
        ("/entities/0/label", json!("")),
        ("/units/0/owner", json!("unknown")),
        ("/units/0/section", json!("proof")),
        ("/units/0/range/start/line", json!(0)),
        ("/units/0/range/end/line", json!(0)),
        ("/imports/0/target", json!("absent.sigil")),
        ("/imports/0/names/0/entity", json!("unknown")),
    ] {
        let mut value = fixture();
        *value.pointer_mut(pointer).unwrap() = replacement;
        assert!(parse(&value).is_err(), "{pointer}");
    }
    for field in ["sources", "context", "entities", "units"] {
        let mut value = fixture();
        let duplicate = value[field][0].clone();
        value[field].as_array_mut().unwrap().push(duplicate);
        assert!(parse(&value).unwrap_err().contains("duplicate"), "{field}");
    }
}
