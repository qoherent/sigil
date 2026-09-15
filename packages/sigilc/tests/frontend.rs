use serde_json::{Value, json};
use sigilc::frontend::DesignInput;

fn fixture() -> Value {
    let mut value: Value = serde_json::from_str(include_str!(
        "../../core/tests/fixtures/design-input-080.json"
    ))
    .unwrap();
    value["diagnostics"] = json!([{"code":"SIGIL_MISSING_GOAL","stage":"structure","severity":"warning","message":"fixture diagnostic","filePath":"base.sigil","related":[]}]);
    value
}

fn parse(value: &Value) -> Result<DesignInput, String> {
    DesignInput::parse(&serde_json::to_vec(value).unwrap())
}

#[test]
fn accepts_structural_transport_without_fabricating_unresolved_identity() {
    let input = parse(&fixture()).unwrap();
    assert!(input.imports[0].names[0].entity.is_some());
    let mut loose = fixture();
    loose["imports"][0]["names"][0]["entity"] = Value::Null;
    loose["imports"][0]["names"][0]["status"] = json!("unresolved");
    loose["imports"][0]["names"][0]["uses"] = json!([]);
    loose["references"][2]["tag"] = Value::Null;
    loose["references"][2]["status"] = json!("ambiguous");
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
        ("/schemaVersion", json!(1)),
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
        ("/units/0/range/start", json!(130)),
        ("/units/0/range/end", json!(999999)),
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
