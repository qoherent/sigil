//! The structural input derived from a workspace matches the export the
//! TypeScript reader produced for the same files, except for the Facet ids,
//! which are content ids here.
mod support;
use serde_json::{Value, json};
use std::collections::HashMap;

fn mask(value: &Value, ids: &HashMap<String, String>) -> Value {
    match value {
        Value::Object(map) => map.iter().map(|(k, v)| (k.clone(), mask(v, ids))).collect(),
        Value::Array(items) => Value::Array(items.iter().map(|v| mask(v, ids)).collect()),
        Value::String(s) => ids.get(s).map_or_else(|| value.clone(), |m| json!(m)),
        other => other.clone(),
    }
}

fn facets_by_position(value: &Value) -> HashMap<String, String> {
    value["units"]
        .as_array()
        .unwrap()
        .iter()
        .map(|u| {
            (
                u["id"].as_str().unwrap().to_owned(),
                format!("{}@{}", u["source"], u["proseRange"]["start"]),
            )
        })
        .collect()
}

fn check(golden: Value, root: &support::Workspace) {
    let derived = serde_json::to_value(root.design_input()).unwrap();
    let (golden_ids, derived_ids) = (facets_by_position(&golden), facets_by_position(&derived));
    assert!(
        derived_ids
            .keys()
            .all(|id| id.starts_with("facet:") && !id.contains(".sigil:")),
        "Facet ids are content ids"
    );
    let (golden, derived) = (mask(&golden, &golden_ids), mask(&derived, &derived_ids));
    // The TypeScript golden names the reader's own version differently; every
    // other field must exist on both sides.
    let keys = |v: &Value| -> std::collections::BTreeSet<String> {
        v.as_object().unwrap().keys().cloned().collect()
    };
    let (only_golden, only_derived): (Vec<_>, Vec<_>) = (
        keys(&golden).difference(&keys(&derived)).cloned().collect(),
        keys(&derived).difference(&keys(&golden)).cloned().collect(),
    );
    assert_eq!(only_golden.len(), 1, "{only_golden:?}");
    assert_eq!(only_derived, ["readerVersion"]);
    for field in keys(&golden).intersection(&keys(&derived)) {
        let sort = |v: &Value| {
            let mut items = v.as_array().cloned().unwrap_or_default();
            items.sort_by_key(|i| i["id"].to_string());
            items
        };
        let field = field.as_str();
        if golden[field].is_array() && golden[field][0]["id"].is_string() {
            assert_eq!(sort(&golden[field]), sort(&derived[field]), "{field}");
        } else {
            assert_eq!(golden[field], derived[field], "{field}");
        }
    }
}

#[test]
fn the_shared_design_derives_what_the_typescript_export_carried() {
    check(support::shared_value(), &support::shared_workspace());
}

#[test]
fn the_cycle_design_derives_what_the_typescript_export_carried() {
    check(support::cycle_value(), &support::cycle_workspace());
}

#[test]
fn the_scope_design_derives_what_the_typescript_export_carried() {
    check(support::scope_value(), &support::scope_workspace());
}

#[test]
fn facet_ids_survive_a_move_that_changes_every_offset() {
    let source =
        "component A {\n  goal {\n    Describe A.\n  }\n  interface {\n    Offer A.\n  }\n}\n";
    let root = support::Workspace::new();
    root.write("a.sigil", source.as_bytes());
    let before = root.design_input();
    root.write("a.sigil", format!("\n\n\n{source}").as_bytes());
    let after = root.design_input();
    let ids = |i: &sigilc::structure::DesignInput| {
        let mut ids: Vec<_> = i.units.iter().map(|u| u.id.clone()).collect();
        ids.sort();
        ids
    };
    assert_eq!(ids(&before).len(), 2);
    assert_eq!(ids(&before), ids(&after));
}
