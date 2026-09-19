mod support;
use serde_json::{Value, json};
use sigilc::{
    frontend::DesignInput,
    inputs::DesignSnapshot,
    scope::{ResolvedScope, Scope},
};
use support::Workspace;

const PATHS: &[&str] = &["a.sigil", "b.sigil", "exp.sigil", "unrelated.sigil"];
fn workspace() -> Workspace {
    let root = Workspace::new();
    for path in PATHS {
        root.write(path, b"// captured authored source");
    }
    root.write("source.any", b"arbitrary implementation bytes");
    root
}
fn input(root: &Workspace) -> DesignInput {
    let mut value = serde_json::to_value(root.input(
        PATHS,
        json!([
            {"source":"a.sigil","target":"b.sigil","names":[]},
            {"source":"b.sigil","target":"a.sigil","names":[]}
        ]),
    ))
    .unwrap();
    value["entities"] = json!([
        {"id":"urn:sigil:component:a.sigil:A","type":"Component","label":"A","source":"a.sigil","owner":null,"exported":true}
    ]);
    value["units"] = json!([
        {"id":"urn:sigil:unit:exp.sigil:1:1","source":"exp.sigil","owner":"urn:sigil:component:a.sigil:A","form":"expand","section":"goal","tag":null,"range":{"start":{"line":1,"column":1},"end":{"line":1,"column":4}}}
    ]);
    DesignInput::parse(&serde_json::to_vec(&value).unwrap()).unwrap()
}
fn definition(paths: &[&str]) -> Value {
    json!({"version":1,"design":{"paths":paths},"implementation":{"paths":["source.any"]}})
}
fn resolve(root: &Workspace, input: &mut DesignInput, paths: &[&str]) -> ResolvedScope {
    serde_json::from_value::<Scope>(definition(paths))
        .unwrap()
        .resolve(&root.0, input)
        .unwrap()
}

#[test]
fn focus_order_and_membership_are_separate_and_bindings_reuse_full_world_inputs() {
    let root = workspace();
    let full = DesignSnapshot::capture(&root.0, input(&root), 10_000).unwrap();
    let mut first_input = input(&root);
    let first = resolve(&root, &mut first_input, &["exp.sigil", "b.sigil"]);
    assert_eq!(
        first.report.design.focus_order,
        ["exp.sigil", "b.sigil", "a.sigil"]
    );
    assert_eq!(first.report.design.sources.len(), 3);
    assert!(
        first
            .report
            .design
            .dependencies
            .iter()
            .any(|d| d.source == "exp.sigil" && d.target == "a.sigil" && d.reason == "owner")
    );
    assert_eq!(first_input.units.len(), 1);
    let scoped = DesignSnapshot::capture(&root.0, first_input, 10_000).unwrap();
    for path in &first.report.design.sources {
        assert_eq!(full.binding(path).unwrap(), scoped.binding(path).unwrap());
    }
    let mut second_input = input(&root);
    second_input.sources.reverse();
    second_input.imports.reverse();
    let second = resolve(&root, &mut second_input, &["b.sigil", "exp.sigil"]);
    assert_eq!(
        second.report.design.focus_order,
        ["b.sigil", "exp.sigil", "a.sigil"]
    );
    assert_eq!(
        first.report.membership_fingerprint,
        second.report.membership_fingerprint
    );
    assert_ne!(
        first.report.order_fingerprint,
        second.report.order_fingerprint
    );
    let reordered = DesignSnapshot::capture(&root.0, second_input, 10_000).unwrap();
    assert_eq!(
        scoped.fingerprint().unwrap(),
        reordered.fingerprint().unwrap()
    );
    let mut again_input = input(&root);
    let again = resolve(&root, &mut again_input, &["b.sigil", "exp.sigil"]);
    assert_eq!(
        second.report.order_fingerprint,
        again.report.order_fingerprint
    );
    root.write("a.sigil", b"// changed owner declaration");
    let changed = DesignSnapshot::capture(&root.0, input(&root), 10_000).unwrap();
    assert_ne!(
        full.binding("exp.sigil").unwrap(),
        changed.binding("exp.sigil").unwrap()
    );
    assert_eq!(
        full.binding("unrelated.sigil").unwrap(),
        changed.binding("unrelated.sigil").unwrap()
    );
}

#[test]
fn unresolved_graph_widens_visibly_and_diagnostics_remain_attributable() {
    let root = workspace();
    let mut value = serde_json::to_value(input(&root)).unwrap();
    value["imports"][0]["target"] = Value::Null;
    value["diagnostics"] = json!([
        {"code":"UNRESOLVED","severity":"error","message":"missing import","filePath":"a.sigil"},
        {"code":"GLOBAL","severity":"error","message":"global"},
        {"code":"CONFIG","severity":"warning","message":"config","filePath":".sigil/config.json"}
    ]);
    let mut input = DesignInput::parse(&serde_json::to_vec(&value).unwrap()).unwrap();
    let result = resolve(&root, &mut input, &["exp.sigil"]);
    assert!(result.report.design.conservative_full_bundle);
    assert_eq!(result.report.design.sources.len(), PATHS.len());
    assert_eq!(input.diagnostics.len(), 3);
    value["imports"][0]["target"] = json!("b.sigil");
    value["diagnostics"][0]["filePath"] = json!("unrelated.sigil");
    let mut input = DesignInput::parse(&serde_json::to_vec(&value).unwrap()).unwrap();
    resolve(&root, &mut input, &["exp.sigil"]);
    assert_eq!(input.diagnostics.len(), 2); // Excluded file only; globals/config stay.
}

#[test]
fn invalid_or_empty_roots_never_silently_select_a_different_world() {
    let root = workspace();
    for paths in [
        vec![],
        vec!["missing.sigil"],
        vec!["a.sigil", "a.sigil"],
        vec!["../a.sigil"],
        vec!["/a.sigil"],
    ] {
        let scope: Scope = serde_json::from_value(definition(&paths)).unwrap();
        assert!(scope.resolve(&root.0, &mut input(&root)).is_err());
    }
    for pointer in ["", "/design", "/implementation"] {
        let mut value = definition(&["a.sigil"]);
        value
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unknown".into(), json!(true));
        assert!(serde_json::from_value::<Scope>(value).is_err());
    }
    let mut empty = definition(&[]);
    empty["design"]["allowEmpty"] = json!(true);
    empty["implementation"] = json!({"include":["nothing.matches"],"allowEmpty":true});
    let scope: Scope = serde_json::from_value(empty).unwrap();
    let mut input = input(&root);
    let result = scope.resolve(&root.0, &mut input).unwrap();
    assert!(result.report.design.intentional_empty);
    assert!(result.report.implementation_intentional_empty);
    assert!(input.sources.is_empty());
}
