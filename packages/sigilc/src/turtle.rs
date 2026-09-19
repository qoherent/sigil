use crate::sources::hash;
use rio_api::{
    model::{Literal, Subject, Term, Triple},
    parser::TriplesParser,
};
use rio_turtle::TurtleParser;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const ONTOLOGY: &str = "https://sigil.dev/ontology/1#";
pub const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
pub const XSD: &str = "http://www.w3.org/2001/XMLSchema#";
pub const LANG_STRING: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
pub const CLASSES: &[&str] = &[
    "Component",
    "Tag",
    "Capability",
    "Artifact",
    "Boundary",
    "Actor",
    "System",
    "Goal",
    "Interface",
    "State",
    "Logic",
    "Constraint",
    "Decision",
    "Case",
    "Contract",
    "Proposition",
    "Dependency",
];
pub const ENTITY_PREDICATES: &[&str] = &[
    "owns",
    "provides",
    "requires",
    "dependsOn",
    "excludes",
    "delegates",
    "routesThrough",
    "persistsAt",
    "authorityFor",
    "trusts",
    "invokes",
    "reads",
    "writes",
    "uses",
    "hasContract",
    "from",
    "to",
    "target",
    "initialState",
    "transitionsTo",
];
const TEXT_PREDICATES: &[&str] = &["label", "description", "section", "relation"];
const BOOLEAN_PREDICATES: &[&str] = &["required", "exclusive", "assumed", "expected"];
const NUMBER_PREDICATES: &[&str] = &["cost", "latencyBudgetMs", "latencyMs", "risk"];

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Object {
    Iri {
        value: String,
    },
    Literal {
        value: String,
        datatype: String,
        language: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Assertion {
    pub subject: String,
    pub predicate: String,
    pub object: Object,
}

impl Assertion {
    pub fn id(&self) -> String {
        hash(&serde_json::to_vec(&("sigil-fact-v1", self)).expect("assertion serialization"))
    }
}

#[derive(Debug, Clone, Copy)]
pub struct TurtleLimits {
    pub max_document_bytes: usize,
    pub max_assertions: usize,
}
impl Default for TurtleLimits {
    fn default() -> Self {
        Self {
            max_document_bytes: 1_000_000,
            max_assertions: 100_000,
        }
    }
}

pub fn vocabulary() -> BTreeMap<&'static str, &'static str> {
    [
        (ENTITY_PREDICATES, "entity"),
        (TEXT_PREDICATES, "text"),
        (BOOLEAN_PREDICATES, "boolean"),
        (NUMBER_PREDICATES, "number"),
    ]
    .into_iter()
    .flat_map(|(names, range)| names.iter().map(move |name| (*name, range)))
    .collect()
}

/// This version changes when the accepted assertion profile becomes incompatible.
pub fn ontology_document() -> serde_json::Value {
    serde_json::json!({
        "version": 1, "namespace": ONTOLOGY,
        "classes": CLASSES, "predicates": vocabulary(),
        "numericRange": {"min": 0, "max": 9_007_199_254_740_991_u64, "riskMax": 1},
    })
}

pub fn ontology_fingerprint() -> String {
    hash(&serde_json::to_vec(&ontology_document()).expect("fixed ontology serialization"))
}

// @sigil implements packages/sigilc/turtle.sigil::SigilTurtleInput::AssertionValidation interface
pub fn parse(source: &[u8], limits: TurtleLimits) -> Result<Vec<Assertion>, String> {
    if source.len() > limits.max_document_bytes {
        return Err("Turtle document exceeds byte limit".into());
    }
    let mut assertions = BTreeSet::new();
    let mut count = 0;
    TurtleParser::new(source, None)
        .parse_all(&mut |triple| -> Result<(), Box<dyn std::error::Error>> {
            count += 1;
            if count > limits.max_assertions {
                return Err("Turtle document exceeds assertion limit".into());
            }
            assertions.insert(normalize(triple)?);
            Ok(())
        })
        .map_err(|e| e.to_string())?;
    Ok(assertions.into_iter().collect())
}

fn normalize(triple: Triple<'_>) -> Result<Assertion, String> {
    let Subject::NamedNode(subject) = triple.subject else {
        return Err(
            "subject must be a named resource; blank nodes and triple terms are forbidden".into(),
        );
    };
    let object = match triple.object {
        Term::NamedNode(node) => Object::Iri { value: node.iri.into() },
        Term::Literal(Literal::Simple { value }) => Object::Literal { value: value.into(), datatype: format!("{XSD}string"), language: String::new() },
        Term::Literal(Literal::LanguageTaggedString { value, language }) => Object::Literal { value: value.into(), datatype: LANG_STRING.into(), language: language.to_ascii_lowercase() },
        Term::Literal(Literal::Typed { value, datatype }) => Object::Literal { value: value.into(), datatype: datatype.iri.into(), language: String::new() },
        _ => return Err("object must be a named resource or literal; blank nodes and triple terms are forbidden".into()),
    };
    validate(Assertion {
        subject: subject.iri.into(),
        predicate: triple.predicate.iri.into(),
        object,
    })
}

/// Also used when loading restricted cached assertions; no raw cache is trusted.
pub fn validate(mut assertion: Assertion) -> Result<Assertion, String> {
    oxiri::Iri::parse(assertion.subject.as_str()).map_err(|e| e.to_string())?;
    match &mut assertion.object {
        Object::Iri { value } => {
            oxiri::Iri::parse(value.as_str()).map_err(|e| e.to_string())?;
        }
        Object::Literal {
            datatype, language, ..
        } => {
            oxiri::Iri::parse(datatype.as_str()).map_err(|e| e.to_string())?;
            if !language.is_empty() {
                oxilangtag::LanguageTag::parse(language.as_str()).map_err(|e| e.to_string())?;
                *language = language.to_ascii_lowercase();
            }
        }
    }
    if assertion.predicate == RDF_TYPE {
        return match &assertion.object {
            Object::Iri { value }
                if value
                    .strip_prefix(ONTOLOGY)
                    .is_some_and(|class| CLASSES.contains(&class)) =>
            {
                Ok(assertion)
            }
            _ => Err("unknown Sigil class".into()),
        };
    }
    let name = assertion
        .predicate
        .strip_prefix(ONTOLOGY)
        .ok_or("unknown predicate namespace")?;
    if ENTITY_PREDICATES.contains(&name) {
        return match assertion.object {
            Object::Iri { .. } => Ok(assertion),
            _ => Err(format!("{name} requires an entity")),
        };
    }
    let Object::Literal {
        value,
        datatype,
        language,
    } = &mut assertion.object
    else {
        return Err(format!("unknown predicate or literal expected: {name}"));
    };
    if TEXT_PREDICATES.contains(&name) {
        if !(datatype == &format!("{XSD}string") && language.is_empty()
            || datatype == LANG_STRING && !language.is_empty())
        {
            return Err(format!("{name} requires text"));
        }
        if name == "relation"
            && (!language.is_empty() || !ENTITY_PREDICATES.contains(&value.as_str()))
        {
            return Err("contract relation must name a fixed entity predicate".into());
        }
    } else if BOOLEAN_PREDICATES.contains(&name) {
        if datatype != &format!("{XSD}boolean") || !language.is_empty() {
            return Err(format!("{name} requires boolean"));
        }
        *value = match value.as_str() {
            "true" | "1" => "true",
            "false" | "0" => "false",
            _ => return Err("invalid boolean literal".into()),
        }
        .into();
    } else if NUMBER_PREDICATES.contains(&name) {
        if !language.is_empty() {
            return Err("numeric literal has language tag".into());
        }
        let kind = datatype
            .strip_prefix(XSD)
            .ok_or("invalid numeric datatype")?;
        let pattern = match kind {
            "integer" => r"^[+-]?[0-9]+$",
            "decimal" => r"^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$",
            "double" => r"^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$",
            _ => return Err("unsupported numeric datatype".into()),
        };
        if !regex::Regex::new(pattern)
            .expect("fixed numeric grammar")
            .is_match(value)
        {
            return Err("invalid numeric lexical form".into());
        }
        let number: f64 = value.parse().map_err(|_| "invalid number")?;
        const MAX: f64 = 9_007_199_254_740_991.0;
        if !number.is_finite() || !(0.0..=MAX).contains(&number) || (name == "risk" && number > 1.0)
        {
            return Err(format!("{name} outside finite numeric range"));
        }
        if kind == "integer"
            && value
                .parse::<i128>()
                .map_or(true, |n| !(0..=9_007_199_254_740_991).contains(&n))
        {
            return Err("integer exceeds exact numeric range".into());
        }
        *value = if number == 0.0 {
            "0".into()
        } else {
            number.to_string()
        };
    } else {
        return Err(format!("unknown Sigil predicate: {name}"));
    }
    Ok(assertion)
}
