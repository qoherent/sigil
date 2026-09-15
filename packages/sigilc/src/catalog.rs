//! Identity validation is separate from graph meaning and source freshness.
use crate::{
    eqval::DesignState,
    frontend::{DesignInput, EntityType, encode_identifier, normalized_path},
    sources::hash,
    turtle::{self, Assertion, ONTOLOGY, Object, RDF_TYPE, XSD},
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Entry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub label: Object,
    pub aliases: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct Catalog {
    entries: Vec<Entry>,
    fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Provisional,
    Authoritative,
}

#[derive(Debug, Serialize)]
pub struct FrozenCatalog {
    pub schema_version: u32,
    pub status: Status,
    pub design_fingerprint: String,
    pub catalog: Catalog,
}

struct Identity {
    source: String,
    entry: Entry,
    internal: bool,
}

pub struct DesignIdentities(BTreeMap<String, Identity>);

/// The local name is an identity key; it need not equal the display label.
pub fn domain_id(source: &str, name: &str) -> Result<String, String> {
    normalized_path(source)?;
    if !source.ends_with(".sigil") || name.trim().is_empty() {
        return Err("domain identity requires a Design source and nonempty local name".into());
    }
    Ok(format!(
        "urn:sigil:entity:{}:{}",
        encode_identifier(source),
        encode_identifier(name)
    ))
}

fn text(value: &str) -> Object {
    Object::Literal {
        value: value.into(),
        datatype: format!("{XSD}string"),
        language: String::new(),
    }
}

fn reserved(input: &DesignInput) -> Result<BTreeMap<String, Identity>, String> {
    input.validate()?;
    let mut ids = BTreeMap::new();
    for entity in &input.entities {
        ids.insert(
            entity.id.clone(),
            Identity {
                source: entity.source.clone(),
                internal: false,
                entry: Entry {
                    id: entity.id.clone(),
                    kind: match entity.kind {
                        EntityType::Component => "Component",
                        EntityType::Tag => "Tag",
                    }
                    .into(),
                    label: text(&entity.label),
                    aliases: vec![entity.label.clone()],
                },
            },
        );
    }
    for unit in &input.units {
        ids.insert(
            unit.id.clone(),
            Identity {
                source: unit.source.clone(),
                internal: true,
                entry: Entry {
                    id: unit.id.clone(),
                    kind: "Contract".into(),
                    label: text(""),
                    aliases: vec![],
                },
            },
        );
    }
    Ok(ids)
}

fn matches_declaration(entry: &Entry, assertion: &Assertion) -> bool {
    if assertion.predicate == RDF_TYPE {
        assertion.object
            == (Object::Iri {
                value: format!("{ONTOLOGY}{}", entry.kind),
            })
    } else {
        assertion.object == entry.label
    }
}

/// Validate one projection before publication; cross-file references are checked
/// after assembly, so source publication order does not allocate identities.
// @sigil implements packages/sigilc/catalog.sigil::SigilEntityCatalog::SourceOwnership interface
pub fn validate_design(
    source: &str,
    input: &DesignInput,
    assertions: &[Assertion],
) -> Result<(), String> {
    declarations(source, input, assertions).map(|_| ())
}

fn declarations(
    source: &str,
    input: &DesignInput,
    assertions: &[Assertion],
) -> Result<BTreeMap<String, Identity>, String> {
    let reserved = reserved(input)?;
    if !input.sources.iter().any(|s| s.path == source) {
        return Err(format!("Design source is not selected: {source}"));
    }
    let prefix = format!("urn:sigil:entity:{}:", encode_identifier(source));
    let mut declared: BTreeMap<String, (BTreeSet<String>, BTreeSet<Object>)> = BTreeMap::new();
    let mut unit_relations: BTreeMap<String, BTreeSet<Object>> = BTreeMap::new();
    for assertion in assertions {
        turtle::validate(assertion.clone())?;
        if let Some(unit) = reserved.get(&assertion.subject).filter(|i| i.internal) {
            let property = assertion.predicate.strip_prefix(ONTOLOGY);
            if unit.source != source
                || !(assertion.predicate == RDF_TYPE
                    || property.is_some_and(|p| {
                        [
                            "required",
                            "assumed",
                            "from",
                            "target",
                            "relation",
                            "expected",
                            "description",
                            "section",
                        ]
                        .contains(&p)
                    }))
            {
                return Err(format!(
                    "invalid or foreign interpretation-unit assertion: {}",
                    assertion.subject
                ));
            }
            if assertion.predicate == format!("{ONTOLOGY}relation") {
                unit_relations
                    .entry(assertion.subject.clone())
                    .or_default()
                    .insert(assertion.object.clone());
            }
        }
        if let Object::Iri { value } = &assertion.object
            && reserved.get(value).is_some_and(|i| i.internal)
            && assertion.predicate != format!("{ONTOLOGY}hasContract")
        {
            return Err(format!(
                "interpretation unit is not a domain endpoint: {value}"
            ));
        }
        let is_type = assertion.predicate == RDF_TYPE;
        if !is_type && assertion.predicate != format!("{ONTOLOGY}label") {
            continue;
        }
        if let Some(identity) = reserved.get(&assertion.subject) {
            if identity.source != source || !matches_declaration(&identity.entry, assertion) {
                return Err(format!(
                    "foreign or changed reserved declaration: {}",
                    assertion.subject
                ));
            }
            continue;
        }
        let name = assertion.subject.strip_prefix(&prefix).ok_or_else(|| {
            format!(
                "declaration is not owned by {source}: {}",
                assertion.subject
            )
        })?;
        // Restrict to the same canonical percent encoding used for frontend IDs.
        if name.is_empty() || !canonical_name(name) {
            return Err(format!("noncanonical domain local name: {name}"));
        }
        let (types, labels) = declared.entry(assertion.subject.clone()).or_default();
        if is_type {
            let Object::Iri { value } = &assertion.object else {
                unreachable!()
            };
            let kind = value.strip_prefix(ONTOLOGY).expect("validated class");
            if ["Component", "Tag"].contains(&kind) {
                return Err("Component and Tag identities are reserved by the frontend".into());
            }
            types.insert(kind.into());
        } else {
            let Object::Literal { value, .. } = &assertion.object else {
                unreachable!()
            };
            if value.trim().is_empty() {
                return Err("empty domain label".into());
            }
            labels.insert(assertion.object.clone());
        }
    }
    for (unit, relations) in unit_relations {
        if relations.len() > 1 {
            return Err(format!(
                "interpretation unit has conflicting relations: {unit}"
            ));
        }
    }
    declared
        .into_iter()
        .map(|(id, (types, labels))| {
            if types.len() != 1 || labels.len() != 1 {
                return Err(format!("entity requires one type and label: {id}"));
            }
            Ok((
                id.clone(),
                Identity {
                    source: source.into(),
                    internal: false,
                    entry: Entry {
                        id,
                        kind: types.into_iter().next().unwrap(),
                        label: labels.into_iter().next().unwrap(),
                        aliases: vec![],
                    },
                },
            ))
        })
        .collect()
}

fn canonical_name(name: &str) -> bool {
    let mut bytes = Vec::new();
    let mut input = name.bytes();
    while let Some(byte) = input.next() {
        if byte == b'%' {
            let Some(a) = input.next().and_then(|b| char::from(b).to_digit(16)) else {
                return false;
            };
            let Some(b) = input.next().and_then(|b| char::from(b).to_digit(16)) else {
                return false;
            };
            bytes.push((a * 16 + b) as u8);
        } else {
            bytes.push(byte);
        }
    }
    String::from_utf8(bytes).is_ok_and(|s| !s.trim().is_empty() && encode_identifier(&s) == name)
}

impl DesignIdentities {
    /// Receives only the current index-selected projections, never a cache union.
    pub fn collect(
        input: &DesignInput,
        projections: &BTreeMap<String, Vec<Assertion>>,
    ) -> Result<Self, String> {
        let mut ids = reserved(input)?;
        for (source, facts) in projections {
            for (id, identity) in declarations(source, input, facts)? {
                if ids.insert(id.clone(), identity).is_some() {
                    return Err(format!("identity collision: {id}"));
                }
            }
        }
        for facts in projections.values() {
            for fact in facts {
                check_references(fact, |id| ids.contains_key(id))?;
            }
        }
        Ok(Self(ids))
    }

    // @sigil implements packages/sigilc/catalog.sigil::SigilEntityCatalog::FrozenIdentity interface
    pub fn freeze(
        self,
        state: DesignState,
        design_fingerprint: String,
        all_design_fresh: bool,
    ) -> Result<FrozenCatalog, String> {
        if !all_design_fresh {
            return Err("catalog requires every selected Design projection to be fresh".into());
        }
        let status = match state {
            DesignState::Disjoint => return Err("Disjoint Design has no usable catalog".into()),
            DesignState::Loose => Status::Provisional,
            DesignState::Coherent => Status::Authoritative,
        };
        let entries: Vec<_> = self
            .0
            .into_values()
            .filter(|i| !i.internal)
            .map(|i| i.entry)
            .collect();
        let fingerprint =
            hash(&serde_json::to_vec(&("sigil-catalog-v1", &entries)).map_err(|e| e.to_string())?);
        Ok(FrozenCatalog {
            schema_version: 1,
            status,
            design_fingerprint,
            catalog: Catalog {
                entries,
                fingerprint,
            },
        })
    }
}

fn check_references(fact: &Assertion, contains: impl Fn(&str) -> bool) -> Result<(), String> {
    for id in std::iter::once(fact.subject.as_str()).chain(match &fact.object {
        Object::Iri { value } if fact.predicate != RDF_TYPE => Some(value.as_str()),
        _ => None,
    }) {
        if !contains(id) {
            return Err(format!("unknown domain identity: {id}"));
        }
    }
    Ok(())
}

impl Catalog {
    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }
    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    // @sigil implements packages/sigilc/catalog.sigil::SigilEntityCatalog::ImplementationIdentity interface
    pub fn validate_implementation(&self, assertions: &[Assertion]) -> Result<(), String> {
        let ids: BTreeMap<_, _> = self.entries.iter().map(|e| (e.id.as_str(), e)).collect();
        for fact in assertions {
            turtle::validate(fact.clone())?;
            check_references(fact, |id| ids.contains_key(id))?;
            if (fact.predicate == RDF_TYPE || fact.predicate == format!("{ONTOLOGY}label"))
                && !matches_declaration(ids[fact.subject.as_str()], fact)
            {
                return Err(format!(
                    "Implementation mutates catalog identity: {}",
                    fact.subject
                ));
            }
        }
        Ok(())
    }
}
