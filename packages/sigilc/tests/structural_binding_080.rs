mod support;
use serde_json::{Value, json};
use sigilc::{frontend::DesignInput, inputs::DesignSnapshot, scope::Scope};
use support::Workspace;
fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../core/tests/fixtures/design-input-080.json"
    ))
    .unwrap()
}
fn capture(root: &Workspace, value: &Value) -> DesignSnapshot {
    for s in value["sources"]
        .as_array()
        .unwrap()
        .iter()
        .chain(value["context"].as_array().unwrap())
    {
        if let Some(text) = s["text"].as_str() {
            root.write(s["path"].as_str().unwrap(), text.as_bytes());
        }
    }
    DesignSnapshot::capture(
        &root.0,
        DesignInput::parse(&serde_json::to_vec(value).unwrap()).unwrap(),
        100_000,
    )
    .unwrap()
}
#[test]
fn preparation_and_scope_retain_all_selected_provider_provenance() {
    let root = Workspace::new();
    let value = fixture();
    let snapshot = capture(&root, &value);
    let preparation = snapshot.preparation("consumer.sigil").unwrap();
    for field in [
        "entities",
        "units",
        "imports",
        "groups",
        "introductions",
        "references",
        "links",
    ] {
        assert_eq!(preparation[field], value[field], "{field}");
    }
    let mut input = DesignInput::parse(&serde_json::to_vec(&value).unwrap()).unwrap();
    let scope: Scope = serde_json::from_value(json!({"version":1,"design":{"paths":["consumer.sigil"]},"implementation":{"paths":[],"allowEmpty":true}})).unwrap();
    scope.resolve(&root.0, &mut input).unwrap();
    input.validate().unwrap();
    assert_eq!(input.references.len(), 4);
    assert_eq!(input.links.len(), 1);
}
#[test]
fn structural_only_changes_invalidate_prepared_binding() {
    let root = Workspace::new();
    let original = fixture();
    let first = capture(&root, &original).binding("consumer.sigil").unwrap();
    for field in ["link", "reference", "selection"] {
        let mut value = original.clone();
        match field {
            "link" => value["links"][0]["title"] = json!("additional interpretation evidence"),
            "reference" => {
                value["references"][2]["status"] = json!("ambiguous");
                value["references"][2]["tag"] = Value::Null;
                value["imports"][0]["names"][0]["uses"] = json!([]);
            }
            "selection" => {
                value["imports"][0]["names"][0]["status"] = json!("ambiguous");
                value["imports"][0]["names"][0]["uses"] = json!([]);
                value["references"][2]["status"] = json!("ambiguous");
                value["references"][2]["tag"] = Value::Null;
            }
            _ => unreachable!(),
        }
        assert_ne!(
            first,
            capture(&root, &value).binding("consumer.sigil").unwrap(),
            "{field}"
        );
    }
}

#[test]
fn compilation_carries_descriptive_relations_without_turning_imports_into_calls() {
    use sigilc::{
        design,
        eqval::{DesignState, Limits},
        store::{LockedStore, StoreLimits},
        turtle::{self, TurtleLimits},
    };
    let root = Workspace::new();
    let value = fixture();
    let snapshot = capture(&root, &value);
    let mut store = LockedStore::open(&root.0, StoreLimits::default()).unwrap();
    for source in &snapshot.input().sources {
        let mut body = "@prefix s: <https://sigil.dev/ontology/1#> .\n".to_owned();
        for unit in snapshot
            .input()
            .units
            .iter()
            .filter(|u| u.source == source.path)
        {
            let owner = unit.owner.as_deref().unwrap();
            body.push_str(&format!("<{owner}> s:uses <{owner}> . <{}> a s:Contract; s:from <{owner}>; s:relation \"uses\"; s:target <{owner}>; s:expected true .\n", unit.id));
        }
        let facts = turtle::parse(body.as_bytes(), TurtleLimits::default()).unwrap();
        let binding = snapshot.binding(&source.path).unwrap();
        let prepared = store.prepare(binding.clone()).unwrap();
        store.publish(&prepared, &binding, &facts).unwrap();
    }
    let report = design::compile(&snapshot, &store, Limits::default(), false).unwrap();
    assert_eq!(report.world.state, DesignState::Coherent);
    let structure = report.world.structure.as_ref().unwrap();
    for field in [
        "imports",
        "groups",
        "introductions",
        "references",
        "links",
        "units",
    ] {
        assert_eq!(structure[field], value[field]);
    }
    assert!(
        !report.world.closure.tables["known"]
            .iter()
            .any(|r| r[1] == "dependsOn" || r[1] == "invokes")
    );
}

#[test]
fn frontend_implementation_locations_retain_captured_source_digest() {
    use sigilc::{
        design,
        eqval::Limits,
        report,
        store::{LockedStore, StoreLimits},
    };
    let root = Workspace::new();
    let mut value = fixture();
    value["diagnostics"] = json!([{
        "code": "OWNERSHIP_UNKNOWN_TAG", "message": "Unknown Tag", "severity": "warning",
        "stage": "host", "filePath": "implementation.ts", "related": [],
        "sourceDigest": "a".repeat(64),
        "implementationRange": {"start": {"line": 1, "column": 1}, "end": {"line": 1, "column": 4}}
    }]);
    let snapshot = capture(&root, &value);
    let store = LockedStore::open(&root.0, StoreLimits::default()).unwrap();
    let compiled = design::compile(&snapshot, &store, Limits::default(), false).unwrap();
    let diagnostics = report::design(snapshot.input(), &compiled.world, &[], &Default::default());
    let finding = diagnostics
        .items
        .iter()
        .find(|f| f.code == "OWNERSHIP_UNKNOWN_TAG")
        .unwrap();
    assert_eq!(
        finding.locations[0].source_digest.as_deref(),
        Some("a".repeat(64).as_str())
    );
    assert_eq!(finding.locations[0].coordinate_system, "utf16-lines");
}
