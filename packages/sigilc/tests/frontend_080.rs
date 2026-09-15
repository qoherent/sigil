use serde_json::{Value, json};
use sigilc::frontend::DesignInput;
fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../core/tests/fixtures/design-input-080.json"
    ))
    .unwrap()
}
fn parse(value: &Value) -> Result<DesignInput, String> {
    DesignInput::parse(&serde_json::to_vec(value).unwrap())
}
#[test]
fn accepts_shared_exporter_fixture_with_all_structural_relations() {
    let input = parse(&fixture()).unwrap();
    assert_eq!(input.language_version, "0.8.0");
    assert_eq!(input.references.len(), 4);
    assert_eq!(input.links.len(), 1);
    assert_eq!(input.introductions.len(), 3);
}
#[test]
fn rejects_old_versions_forged_owners_and_non_utf8_boundaries() {
    for (pointer, replacement) in [
        ("/schemaVersion", json!(1)),
        ("/languageVersion", json!("0.7.0")),
        ("/entities/0/range/start", json!(1)), // inside original BOM
        ("/units/0/range/end", json!(99999)),
        (
            "/groups/0/owner",
            json!("urn:sigil:component:consumer.sigil:Consumer"),
        ),
        ("/references/0/tag", json!("missing")),
        (
            "/imports/0/names/0/entity",
            json!("urn:sigil:component:base.sigil:Base"),
        ),
        ("/imports/0/names/0/name", json!("result")),
        ("/links/0/facet", json!("missing")),
    ] {
        let mut value = fixture();
        *value.pointer_mut(pointer).unwrap() = replacement;
        assert!(parse(&value).is_err(), "{pointer}");
    }
}
#[test]
fn rejects_unknown_fields_and_duplicate_occurrences() {
    for pointer in [
        "",
        "/groups/0",
        "/introductions/0",
        "/references/0",
        "/links/0",
        "/units/0",
        "/imports/0/names/0",
    ] {
        let mut value = fixture();
        value
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("inferredCalls".into(), json!([]));
        assert!(parse(&value).is_err(), "{pointer}");
    }
    for field in [
        "entities",
        "units",
        "groups",
        "introductions",
        "references",
        "links",
        "imports",
    ] {
        let mut value = fixture();
        let duplicate = value[field][0].clone();
        value[field].as_array_mut().unwrap().push(duplicate);
        assert!(parse(&value).is_err(), "{field}");
    }
}
