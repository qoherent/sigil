#![allow(dead_code)]
//! Workspaces on disk. Every fixture is a real `.sigil` workspace in a
//! tempdir: the tests read it the way the commands do, through the trees.
use serde_json::Value;
use sigilc::{
    inputs::{DesignBasis, DesignSnapshot},
    structure::DesignInput,
    tree::design_input::{load_design, load_design_input},
};
use std::{
    fs,
    path::PathBuf,
    sync::{
        OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
};

pub const CONFIG: &str =
    r#"{"sigilVersion":"0.9.0","workspace":{"name":"test"},"files":{"include":["**/*.sigil"]}}"#;

pub struct Workspace(pub PathBuf);
impl Workspace {
    /// An empty workspace that selects every `.sigil` file beneath it.
    pub fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "sigil-inputs-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        let root = Self(path.canonicalize().unwrap());
        root.write(".sigil/config.json", CONFIG.as_bytes());
        root
    }
    pub fn write(&self, path: &str, bytes: &[u8]) {
        let path = self.0.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
    /// Write every file a design fixture carries: its sources and its context.
    pub fn write_fixture(&self, fixture: &Value) {
        for item in fixture["sources"]
            .as_array()
            .unwrap()
            .iter()
            .chain(fixture["context"].as_array().unwrap())
        {
            if let Some(text) = item["text"].as_str() {
                self.write(item["path"].as_str().unwrap(), text.as_bytes());
            }
        }
    }
    /// The binding snapshot of this workspace as it is on disk now.
    pub fn snapshot(&self) -> DesignSnapshot {
        DesignSnapshot::load(&self.0, &self.0.join(".sigil")).unwrap()
    }
    /// The structural input and binding basis, before any scope narrows them.
    pub fn load(&self) -> (DesignInput, DesignBasis) {
        load_design(&self.0, &self.0.join(".sigil")).unwrap()
    }
    /// The structural input of this workspace as it is on disk now.
    pub fn design_input(&self) -> DesignInput {
        load_design_input(&self.0, &self.0.join(".sigil")).unwrap()
    }
}
impl Drop for Workspace {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

/// The claims request for `source`, with the tree identities read from the
/// sources `input` carries. For tests that adjust a derived `DesignInput` by
/// hand and still need the binding basis a workspace would give.
pub fn project(
    input: &DesignInput,
    source: &str,
) -> Result<sigilc::claims::prepare::Request, String> {
    let root = Workspace::new();
    for item in &input.sources {
        root.write(&item.path, item.text.as_bytes());
    }
    let (_, basis) = root.load();
    sigilc::claims::prepare::project(input, &basis, source)
}

/// The rows of `artifact` in the form admission reads: read, then resolved
/// against `request` the way ingest does it. Any row that does not resolve is
/// a bug in the test, so it panics with the reason.
pub fn resolved(
    request: &sigilc::claims::prepare::Request,
    artifact: &str,
) -> Vec<sigilc::claims::dialect::Row> {
    let parsed =
        sigilc::claims::dialect::read(artifact, sigilc::claims::dialect::Limits::default())
            .unwrap();
    assert!(parsed.errors.is_empty(), "{:?}", parsed.errors);
    let resolved = sigilc::claims::canon::resolve(request, parsed);
    assert!(resolved.issues.is_empty(), "{:?}", resolved.issues);
    resolved.rows
}

/// The id of the one Facet `source` holds in `section`.
pub fn facet_in(input: &DesignInput, source: &str, section: &str) -> String {
    let mut found = input
        .units
        .iter()
        .filter(|u| u.source == source && serde_json::to_value(u.section).unwrap() == section);
    let unit = found
        .next()
        .unwrap_or_else(|| panic!("no {section} Facet in {source}"));
    assert!(
        found.next().is_none(),
        "more than one {section} Facet in {source}"
    );
    unit.id.clone()
}

/// The id of the Facet in `source` whose prose contains `needle`.
pub fn facet_with(input: &DesignInput, source: &str, needle: &str) -> String {
    let text = &input
        .sources
        .iter()
        .find(|s| s.path == source)
        .unwrap()
        .text;
    let mut found = input.units.iter().filter(|u| {
        u.source == source && text[u.prose_range.start..u.prose_range.end].contains(needle)
    });
    let unit = found
        .next()
        .unwrap_or_else(|| panic!("no Facet with `{needle}` in {source}"));
    assert!(
        found.next().is_none(),
        "more than one Facet with `{needle}`"
    );
    unit.id.clone()
}

fn fixture(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}
pub fn shared_value() -> Value {
    fixture(include_str!(
        "../../../core/tests/fixtures/design-input-080.json"
    ))
}
pub fn shared_workspace() -> Workspace {
    let root = Workspace::new();
    root.write_fixture(&shared_value());
    root
}

/// The shared 0.9 design fixture, derived from its workspace on disk.
pub fn shared_input() -> DesignInput {
    shared_workspace().design_input()
}
pub const BASE: &str = "base.sigil";
pub const CONSUMER: &str = "consumer.sigil";

/// Facet ids are content ids, so they are looked up from the derived input
/// once rather than written down.
fn shared_id(cell: &'static OnceLock<String>, source: &str, section: &str) -> &'static str {
    cell.get_or_init(|| facet_in(&shared_input(), source, section))
}
pub fn base_goal() -> &'static str {
    static CELL: OnceLock<String> = OnceLock::new();
    shared_id(&CELL, BASE, "goal")
}
pub fn base_interface() -> &'static str {
    static CELL: OnceLock<String> = OnceLock::new();
    shared_id(&CELL, BASE, "interface")
}
pub fn base_constraints() -> &'static str {
    static CELL: OnceLock<String> = OnceLock::new();
    shared_id(&CELL, BASE, "constraints")
}
pub fn consumer_goal() -> &'static str {
    static CELL: OnceLock<String> = OnceLock::new();
    shared_id(&CELL, CONSUMER, "goal")
}
pub fn consumer_interface() -> &'static str {
    static CELL: OnceLock<String> = OnceLock::new();
    shared_id(&CELL, CONSUMER, "interface")
}

pub fn cycle_value() -> Value {
    fixture(include_str!(
        "../../../core/tests/fixtures/design-cycle-080.json"
    ))
}
pub fn cycle_workspace() -> Workspace {
    let root = Workspace::new();
    root.write_fixture(&cycle_value());
    root
}
pub fn cycle_input(root: &Workspace) -> DesignInput {
    root.design_input()
}
/// The cycle workspace after `b.sigil`, which `a.sigil` imports, is deleted.
pub fn missing_cycle_provider_workspace() -> Workspace {
    let root = cycle_workspace();
    fs::remove_file(root.0.join("b.sigil")).unwrap();
    root
}

pub fn scope_value() -> Value {
    fixture(include_str!(
        "../../../core/tests/fixtures/design-scope-080.json"
    ))
}
pub fn scope_workspace() -> Workspace {
    let root = Workspace::new();
    root.write_fixture(&scope_value());
    root
}
