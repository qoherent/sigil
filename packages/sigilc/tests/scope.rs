mod support;
use serde_json::{Value, json};
use sigilc::{
    basis::DesignBasis,
    claims::prepare,
    scope::{ResolvedScope, Scope},
    structure::DesignInput,
};
use support::Workspace;

fn workspace() -> Workspace {
    let root = support::cycle_workspace();
    root.write("source.any", b"arbitrary implementation bytes");
    root
}
fn input(root: &Workspace) -> DesignInput {
    support::cycle_input(root)
}
fn full(root: &Workspace) -> DesignBasis {
    root.load().1
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
fn focus_order_and_membership_are_separate_and_source_basis_is_reusable() {
    let root = workspace();
    let full = full(&root);
    let full_input = input(&root);
    let mut first_input = input(&root);
    let first = resolve(&root, &mut first_input, &["c.sigil", "b.sigil"]);
    assert_eq!(
        first.report.design.focus_order,
        ["c.sigil", "b.sigil", "a.sigil"]
    );
    assert_eq!(first.report.design.sources.len(), 3);
    assert!(
        first
            .report
            .design
            .dependencies
            .iter()
            .any(|d| d.source == "c.sigil" && d.target == "a.sigil" && d.reason == "import")
    );
    assert_eq!(first_input.units.len(), 9);
    assert_eq!(first_input.references.len(), 3);
    for path in &first.report.design.sources {
        assert_eq!(
            prepare::project(&full_input, &full, path).unwrap().binding,
            prepare::project(&first_input, &full, path).unwrap().binding,
            "narrowing membership preserves the source's interpretation binding"
        );
    }
    let mut second_input = input(&root);
    second_input.sources.reverse();
    second_input.imports.reverse();
    let second = resolve(&root, &mut second_input, &["b.sigil", "c.sigil"]);
    assert_eq!(
        second.report.design.focus_order,
        ["b.sigil", "c.sigil", "a.sigil"]
    );
    assert_eq!(
        first.report.membership_fingerprint,
        second.report.membership_fingerprint
    );
    assert_ne!(
        first.report.order_fingerprint,
        second.report.order_fingerprint
    );
    for path in &first.report.design.sources {
        assert_eq!(
            prepare::project(&first_input, &full, path).unwrap().binding,
            prepare::project(&second_input, &full, path)
                .unwrap()
                .binding,
            "root priority does not change the source's interpretation binding"
        );
    }
    let mut again_input = input(&root);
    let again = resolve(&root, &mut again_input, &["b.sigil", "c.sigil"]);
    assert_eq!(
        second.report.order_fingerprint,
        again.report.order_fingerprint
    );
    let edit = |from: &str, to: &str| {
        let text = std::fs::read_to_string(root.0.join("a.sigil")).unwrap();
        root.write("a.sigil", text.replacen(from, to, 1).as_bytes());
    };
    // A provider's private change reaches no importer; its interface does.
    edit("Describe A.", "Describe A in detail.");
    let private = self::full(&root);
    assert_eq!(
        full.sources["c.sigil"].imports,
        private.sources["c.sigil"].imports
    );
    assert_ne!(
        full.sources["a.sigil"].identity,
        private.sources["a.sigil"].identity
    );
    edit("A *a* exists.", "A *a* exists today.");
    let changed = self::full(&root);
    assert_ne!(
        full.sources["c.sigil"].imports,
        changed.sources["c.sigil"].imports
    );
    assert_eq!(
        full.sources["unrelated.sigil"].identity,
        changed.sources["unrelated.sigil"].identity
    );
}

#[test]
fn an_unresolved_import_never_widens_the_world_and_diagnostics_remain_attributable() {
    let extra = |file: Option<&str>| -> Vec<sigilc::structure::Diagnostic> {
        let mut config = json!({"code":"CONFIG","stage":"workspace","severity":"warning","message":"config","filePath":".sigil/config.json","related":[]});
        let mut global = json!({"code":"GLOBAL","stage":"workspace","severity":"error","message":"global","related":[]});
        if let Some(file) = file {
            global["filePath"] = json!(file);
        }
        config["related"] = json!([]);
        [global, config]
            .into_iter()
            .map(|d| serde_json::from_value(d).unwrap())
            .collect()
    };
    // `a.sigil` imports the deleted `b.sigil`: the import resolves to nothing. It
    // makes `a.sigil` invalid and adds no source to anyone's closure.
    let root = support::missing_cycle_provider_workspace();
    root.write("source.any", b"arbitrary implementation bytes");
    let mut partial = input(&root);
    assert_eq!(
        partial.diagnostics.len(),
        1,
        "the unresolved import is reported"
    );
    partial.diagnostics.extend(extra(None));
    let result = resolve(&root, &mut partial, &["c.sigil"]);
    assert_eq!(
        result.report.design.sources.iter().collect::<Vec<_>>(),
        ["a.sigil", "c.sigil"],
        "the unrelated source stays out"
    );
    assert_eq!(partial.diagnostics.len(), 3);
    // A diagnostic on a file the scope excludes is dropped; global and context ones stay.
    let root = workspace();
    let mut scoped = input(&root);
    assert!(scoped.diagnostics.is_empty());
    scoped.diagnostics.extend(extra(Some("unrelated.sigil")));
    resolve(&root, &mut scoped, &["c.sigil"]);
    assert_eq!(scoped.diagnostics.len(), 1);
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
