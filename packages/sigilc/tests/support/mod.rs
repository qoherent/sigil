#![allow(dead_code)]
use serde_json::{Value, json};
use sigilc::frontend::DesignInput;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};

pub struct Workspace(pub PathBuf);
impl Workspace {
    pub fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "sigil-inputs-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }
    pub fn write(&self, path: &str, bytes: &[u8]) {
        let path = self.0.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
    pub fn input(&self, paths: &[&str], imports: Value) -> DesignInput {
        DesignInput::parse(&serde_json::to_vec(&json!({
            "schemaVersion": 2, "languageVersion":"0.8.0", "frontendVersion":"test",
            "sources": paths.iter().map(|p| json!({"path":p,"text":fs::read_to_string(self.0.join(p)).unwrap()})).collect::<Vec<_>>(),
            "context": ([".sigil/config.json",".sigil/local.json",".sigil/glossary.json"].iter().map(|p| json!({"path":p,"text":fs::read_to_string(self.0.join(p)).ok()})).collect::<Vec<_>>()),
            "diagnostics":[], "entities":[], "units":[], "imports":imports,
            "groups":[], "introductions":[], "references":[], "links":[],
        })).unwrap()).unwrap()
    }
}
impl Drop for Workspace {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

pub fn component(path: &str, name: &str, text: &str) -> Value {
    let start = text.find(&format!("component {name} {{")).unwrap();
    let name_start = start + "component ".len();
    let mut depth = 0;
    let end = text[start..]
        .char_indices()
        .find_map(|(i, c)| {
            if c == '{' {
                depth += 1;
            }
            if c == '}' {
                depth -= 1;
                if depth == 0 {
                    return Some(start + i + 1);
                }
            }
            None
        })
        .unwrap();
    json!({"id":format!("urn:sigil:component:{path}:{name}"),"type":"Component","label":name,
        "source":path,"owner":null,"range":{"start":start,"end":end},
        "nameRange":{"start":name_start,"end":name_start+name.len()},
        "identityResolved":true,"valid":true,"complete":true})
}
pub fn unit(path: &str, name: &str, text: &str, prose: &str) -> Value {
    let start = text.find(prose).unwrap();
    let end = start + prose.len();
    json!({"id":format!("facet:{path}:{start}"),"source":path,"owner":format!("urn:sigil:component:{path}:{name}"),
        "section":"goal","range":{"start":start,"end":end},"proseRange":{"start":start,"end":end},
        "grouping":null,"introductions":[],"references":[],"links":[],"payload":null,"valid":true,"complete":true})
}
pub fn shared_value() -> Value {
    serde_json::from_str(include_str!(
        "../../../core/tests/fixtures/design-input-080.json"
    ))
    .unwrap()
}
pub fn shared_workspace() -> Workspace {
    let root = Workspace::new();
    let value = shared_value();
    for item in value["sources"]
        .as_array()
        .unwrap()
        .iter()
        .chain(value["context"].as_array().unwrap())
    {
        if let Some(text) = item["text"].as_str() {
            root.write(item["path"].as_str().unwrap(), text.as_bytes());
        }
    }
    root
}

pub fn cycle_value() -> Value {
    serde_json::from_str(include_str!(
        "../../../core/tests/fixtures/design-cycle-080.json"
    ))
    .unwrap()
}
pub fn cycle_workspace() -> Workspace {
    let root = Workspace::new();
    let value = cycle_value();
    for item in value["sources"]
        .as_array()
        .unwrap()
        .iter()
        .chain(value["context"].as_array().unwrap())
    {
        if let Some(text) = item["text"].as_str() {
            root.write(item["path"].as_str().unwrap(), text.as_bytes());
        }
    }
    root
}
pub fn cycle_input(root: &Workspace) -> DesignInput {
    let mut value = cycle_value();
    for item in value["sources"].as_array_mut().unwrap() {
        item["text"] =
            json!(fs::read_to_string(root.0.join(item["path"].as_str().unwrap())).unwrap());
    }
    for item in value["context"].as_array_mut().unwrap() {
        item["text"] = json!(fs::read_to_string(root.0.join(item["path"].as_str().unwrap())).ok());
    }
    DesignInput::parse(&serde_json::to_vec(&value).unwrap()).unwrap()
}
pub fn missing_cycle_provider() -> Value {
    let mut value = cycle_value();
    value["sources"]
        .as_array_mut()
        .unwrap()
        .retain(|s| s["path"] != "b.sigil");
    for field in [
        "entities",
        "units",
        "imports",
        "groups",
        "introductions",
        "references",
        "links",
    ] {
        value[field]
            .as_array_mut()
            .unwrap()
            .retain(|r| r["source"] != "b.sigil");
    }
    let import = value["imports"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|i| i["source"] == "a.sigil")
        .unwrap();
    import["target"] = Value::Null;
    import["providerId"] = Value::Null;
    import["status"] = json!("unresolved-path");
    for n in import["names"].as_array_mut().unwrap() {
        n["entity"] = Value::Null;
        n["status"] = json!("unresolved");
        n["uses"] = json!([]);
    }
    for r in value["references"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .filter(|r| r["source"] == "a.sigil")
    {
        r["tag"] = Value::Null;
        r["status"] = json!("ambiguous");
    }
    value["diagnostics"] = json!([{"code":"SIGIL_UNRESOLVED_IMPORT_PATH","stage":"resolution","severity":"error","message":"Missing b.sigil","filePath":"a.sigil","related":[]}]);
    value
}
