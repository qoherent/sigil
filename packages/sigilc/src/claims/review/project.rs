//! The projection: one linked check's results, named by bundle-local aliases.
//!
//! Each entry the view renders from a report or context item is built together
//! with that item and kept beside it, so the view never pairs two lists by
//! position.
use super::super::{
    context::{Context, Coverage, DUPLICATE_PROPOSITION, Obligation},
    findings::{Class, Finding},
    identity::Body,
    link::Unread,
    program::ASSERTED,
};
use super::{
    Inputs,
    evidence::{
        ClaimEntry, ConclusionEntry, CoverageTotals, Derivation, EntityEntry, FindingEntry,
        ObligationEntry, SimplificationEntry, UnitCoverage, UnitEntry, UnreadEntry,
    },
};
use crate::locations::{Location, sha256};
use std::collections::{BTreeMap, BTreeSet};

/// Bundle-local names, assigned from sorted canonical identities.
pub(super) struct Names {
    entities: BTreeMap<String, String>,
    units: BTreeMap<String, String>,
    claims: BTreeMap<String, String>,
    /// Step claim id to its ordinal, so a step reads as one wherever it is named.
    pub steps: BTreeMap<String, u32>,
    /// Claim id to the alias of the unit that asserts it.
    claim_unit: BTreeMap<String, String>,
}

impl Names {
    /// How the view writes an identity: its alias, or the value quoted when it
    /// names nothing this bundle aliases.
    pub fn of(&self, id: &str) -> String {
        if let Some(alias) = self.entities.get(id).or_else(|| self.units.get(id)) {
            return alias.clone();
        }
        match (self.claims.get(id), self.steps.get(id)) {
            (Some(alias), Some(ordinal)) => format!("{alias}:step{ordinal}"),
            (Some(alias), None) => alias.clone(),
            _ => format!("{id:?}"),
        }
    }

    pub fn claim(&self, id: &str) -> String {
        self.claims
            .get(id)
            .cloned()
            .unwrap_or_else(|| format!("{id:?}"))
    }

    /// A claim with the unit that asserts it, such as `C3@U2`.
    pub fn at(&self, claim: &str) -> String {
        match self.claim_unit.get(claim) {
            Some(unit) => format!("{}@{unit}", self.claim(claim)),
            None => self.claim(claim),
        }
    }

    fn unit(&self, facet: &str) -> String {
        self.units.get(facet).cloned().unwrap_or_default()
    }
}

/// Everything the view and the evidence are written from.
pub(super) struct Projection<'a> {
    pub names: Names,
    pub totals: CoverageTotals,
    pub entities: Vec<EntityEntry>,
    pub units: Vec<UnitEntry>,
    pub claims: Vec<ClaimEntry>,
    pub conclusions: Vec<ConclusionEntry>,
    pub obligations: Vec<(ObligationEntry, &'a Obligation)>,
    pub findings: Vec<(FindingEntry, &'a Finding)>,
    /// Each entry with its claim ids in alias order.
    pub simplifications: Vec<(SimplificationEntry, Vec<String>)>,
    pub unread: Vec<(UnreadEntry, &'a Unread)>,
}

struct EntityRow {
    kind: String,
    label: String,
    owner: Option<String>,
    source: String,
}

pub(super) fn project<'a>(inputs: &Inputs<'a>) -> Projection<'a> {
    let Inputs {
        input,
        linked,
        world,
        report,
        context,
        ..
    } = *inputs;

    // Declared entities, then the flow graphs the program minted. A step is
    // not listed here: its identity is its declaring claim's.
    let mut entity_rows: BTreeMap<String, EntityRow> = BTreeMap::new();
    for entity in &linked.request.entities {
        entity_rows.entry(entity.id.clone()).or_insert(EntityRow {
            kind: entity.kind.clone(),
            label: entity.label.clone(),
            owner: entity.owner.clone(),
            source: entity.source.clone(),
        });
    }
    for graph in world.graphs() {
        entity_rows.entry(graph.id).or_insert(EntityRow {
            kind: "Graph".into(),
            label: graph.label,
            owner: Some(graph.owner).filter(|o| !o.is_empty()),
            source: graph.source,
        });
    }

    let mut claim_at: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    let mut steps = BTreeMap::new();
    for (u, unit) in context.units.iter().enumerate() {
        for (a, asserted) in unit.asserted.iter().enumerate() {
            claim_at.insert(asserted.claim.clone(), (u, a));
            if let Body::Step { ordinal } = asserted.body {
                steps.insert(asserted.claim.clone(), ordinal);
            }
        }
    }
    let units = aliases("U", context.units.iter().map(|u| &u.facet));
    let claim_unit = claim_at
        .iter()
        .map(|(claim, (u, _))| (claim.clone(), units[&context.units[*u].facet].clone()))
        .collect();
    let names = Names {
        entities: aliases("E", entity_rows.keys()),
        units,
        claims: aliases("C", claim_at.keys()),
        steps,
        claim_unit,
    };
    let facet_of_claim = |claim: &str| claim_at.get(claim).map(|(u, _)| &context.units[*u].facet);

    // Coverage, with what is unread or refused taking precedence over the
    // context's own account of a unit nothing was linked for.
    let unread_of: BTreeMap<&str, bool> = report
        .unread
        .iter()
        .flatten()
        .flat_map(|u| {
            u.facets
                .iter()
                .map(move |f| (f.as_str(), u.refusal.is_some()))
        })
        .collect();
    let coverage = |facet: &str, coverage: Coverage| match unread_of.get(facet) {
        Some(true) => UnitCoverage::Refused,
        Some(false) => UnitCoverage::Unread,
        None => match coverage {
            Coverage::Interpreted => UnitCoverage::Interpreted,
            Coverage::ReadWithoutCommitment => UnitCoverage::ReadWithoutCommitment,
            Coverage::Uninterpreted => UnitCoverage::Uninterpreted,
        },
    };
    let mut totals = CoverageTotals {
        units: context.units.len(),
        interpreted: 0,
        read_without_commitment: 0,
        uninterpreted: 0,
        unread: 0,
        refused: 0,
        unresolved_imports: report
            .unresolved_imports
            .as_deref()
            .unwrap_or_default()
            .len(),
    };
    for unit in &context.units {
        match coverage(&unit.facet, unit.coverage) {
            UnitCoverage::Interpreted => totals.interpreted += 1,
            UnitCoverage::ReadWithoutCommitment => totals.read_without_commitment += 1,
            UnitCoverage::Uninterpreted => totals.uninterpreted += 1,
            UnitCoverage::Unread => totals.unread += 1,
            UnitCoverage::Refused => totals.refused += 1,
        }
    }

    let entities: Vec<EntityEntry> = entity_rows
        .iter()
        .map(|(id, row)| EntityEntry {
            alias: names.entities[id].clone(),
            id: id.clone(),
            kind: row.kind.clone(),
            label: row.label.clone(),
            owner: row.owner.as_deref().map(|o| names.of(o)),
            source: row.source.clone(),
        })
        .collect();

    // Each source is hashed once, however many units it holds.
    let digests: BTreeMap<&str, String> = input
        .sources
        .iter()
        .map(|s| (s.path.as_str(), sha256(s.text.as_bytes())))
        .collect();
    let input_unit: BTreeMap<&str, &crate::structure::Unit> =
        input.units.iter().map(|u| (u.id.as_str(), u)).collect();
    let mut unit_entries: Vec<UnitEntry> = context
        .units
        .iter()
        .enumerate()
        .map(|(u, unit)| {
            let located = input_unit.get(unit.facet.as_str());
            UnitEntry {
                alias: names.unit(&unit.facet),
                facet: unit.facet.clone(),
                source: located.map(|i| i.source.clone()).unwrap_or_default(),
                component: names.of(&unit.component),
                section: unit.section.clone(),
                coverage: coverage(&unit.facet, unit.coverage),
                location: located.and_then(|i| {
                    let digest = digests.get(i.source.as_str())?;
                    Some(Location::with_digest(
                        "design",
                        &i.source,
                        digest.clone(),
                        i.prose_range.clone(),
                    ))
                }),
                context: format!("/units/{u}"),
            }
        })
        .collect();
    unit_entries.sort_by(|a, b| number(&a.alias).cmp(&number(&b.alias)));

    // Claim aliases follow `claim_at`'s order, so these come out in alias order.
    let claims: Vec<ClaimEntry> = claim_at
        .iter()
        .map(|(id, (u, a))| ClaimEntry {
            alias: names.claim(id),
            id: id.clone(),
            unit: names.unit(&context.units[*u].facet),
            context: format!("/units/{u}/asserted/{a}"),
        })
        .collect();

    let conclusions = conclusions(inputs, &names);

    let mut raised: Vec<(&Obligation, (usize, usize))> = context
        .units
        .iter()
        .enumerate()
        .flat_map(|(u, unit)| {
            unit.obligations
                .iter()
                .enumerate()
                .map(move |(o, obligation)| (obligation, (u, o)))
        })
        .collect();
    raised.sort_by(|(a, x), (b, y)| {
        (
            &a.promise.claim,
            &a.subject,
            &a.relation,
            &a.object,
            a.filled,
            x,
        )
            .cmp(&(
                &b.promise.claim,
                &b.subject,
                &b.relation,
                &b.object,
                b.filled,
                y,
            ))
    });
    let obligations: Vec<(ObligationEntry, &Obligation)> = raised
        .into_iter()
        .enumerate()
        .map(|(n, (obligation, (u, o)))| {
            let entry = ObligationEntry {
                alias: format!("O{}", n + 1),
                claim: names.claim(&obligation.promise.claim),
                filled: obligation.filled,
                context: format!("/units/{u}/obligations/{o}"),
            };
            (entry, obligation)
        })
        .collect();

    let findings: Vec<(FindingEntry, &Finding)> = report
        .findings
        .iter()
        .enumerate()
        .map(|(n, finding)| {
            // Unit aliases follow facet order, so a set of facets is already
            // in alias order.
            let mut facets: BTreeSet<&str> = finding
                .claims
                .iter()
                .filter_map(|c| facet_of_claim(c).map(String::as_str))
                .collect();
            if names.units.contains_key(&finding.object) {
                facets.insert(&finding.object);
            }
            let unmet = if finding.class == Class::UnmetObligation {
                obligations
                    .iter()
                    .filter(|(_, obligation)| {
                        !obligation.filled
                            && finding.claims.contains(&obligation.promise.claim)
                            && obligation.subject == finding.subject
                            && obligation.object == finding.object
                    })
                    .map(|(entry, _)| entry.alias.clone())
                    .collect()
            } else {
                Vec::new()
            };
            let entry = FindingEntry {
                alias: format!("F{}", n + 1),
                report: format!("/findings/{n}"),
                claims: finding.claims.iter().map(|c| names.claim(c)).collect(),
                units: facets.into_iter().map(|f| names.unit(f)).collect(),
                obligations: unmet,
            };
            (entry, finding)
        })
        .collect();

    let simplifications = simplifications(context, &names);

    let unread: Vec<(UnreadEntry, &Unread)> = report
        .unread
        .iter()
        .flatten()
        .enumerate()
        .map(|(n, u)| {
            let entry = UnreadEntry {
                report: format!("/unread/{n}"),
                units: u.facets.iter().map(|f| names.unit(f)).collect(),
            };
            (entry, u)
        })
        .collect();

    Projection {
        names,
        totals,
        entities,
        units: unit_entries,
        claims,
        conclusions,
        obligations,
        findings,
        simplifications,
        unread,
    }
}

/// Conclusions the laws inferred. One a claim states directly is that claim
/// again, so it is not repeated.
fn conclusions(inputs: &Inputs, names: &Names) -> Vec<ConclusionEntry> {
    let (world, context) = (inputs.world, inputs.context);
    let mut derived_at: BTreeMap<(String, String, String, String, String), Vec<String>> =
        BTreeMap::new();
    for (u, unit) in context.units.iter().enumerate() {
        for (d, derived) in unit.derived.iter().enumerate() {
            derived_at
                .entry((
                    derived.subject.clone(),
                    derived.relation.clone(),
                    derived.object.clone(),
                    derived.law.clone(),
                    derived.witness.clone(),
                ))
                .or_default()
                .push(format!("/units/{u}/derived/{d}"));
        }
    }
    let mut inferred: BTreeMap<Fact, BTreeSet<(String, String, Vec<String>)>> = BTreeMap::new();
    // The aliases that state each fact: the claims asserting it, then the
    // conclusion inferring it.
    let mut stated_by: BTreeMap<Fact, Vec<String>> = BTreeMap::new();
    for reason in world.reasons() {
        let fact = (reason.subject, reason.relation, reason.object);
        if reason.law == ASSERTED {
            if let Some(alias) = names.claims.get(&reason.witness) {
                stated_by.entry(fact).or_default().push(alias.clone());
            }
            continue;
        }
        let full = (fact.0, fact.1, fact.2, reason.law, reason.witness);
        let pointers = derived_at.get(&full).cloned().unwrap_or_default();
        let (subject, relation, object, law, witness) = full;
        inferred
            .entry((subject, relation, object))
            .or_default()
            .insert((law, witness, pointers));
    }
    for (n, fact) in inferred.keys().enumerate() {
        stated_by
            .entry(fact.clone())
            .or_default()
            .push(format!("D{}", n + 1));
    }
    inferred
        .iter()
        .enumerate()
        .map(|(n, ((subject, relation, object), derivations))| {
            let alias = format!("D{}", n + 1);
            let derivations = derivations
                .iter()
                .map(|(law, witness, context)| Derivation {
                    premises: premises(
                        &stated_by,
                        (subject, relation, object),
                        law,
                        witness,
                        &alias,
                    ),
                    law: law.clone(),
                    witness: witness.clone(),
                    context: context.clone(),
                })
                .collect();
            ConclusionEntry {
                alias,
                subject: subject.clone(),
                relation: relation.clone(),
                object: object.clone(),
                derivations,
            }
        })
        .collect()
}

type Fact = (String, String, String);

/// The claims and conclusions one derivation combined, read back from the law
/// that produced it in `claims.egg`.
fn premises(
    stated_by: &BTreeMap<Fact, Vec<String>>,
    (subject, _, object): (&String, &String, &String),
    law: &str,
    witness: &str,
    own: &str,
) -> Vec<String> {
    let fact = |s: &str, p: &str, o: &str| (s.to_owned(), p.to_owned(), o.to_owned());
    let facts: Vec<Fact> = match law {
        "dependency-direct" => vec![fact(subject, "dependsOn", object)],
        "dependency-transitive" => vec![
            fact(subject, "reachable", witness),
            fact(witness, "dependsOn", object),
        ],
        "delegated-capability" => vec![
            fact(subject, "delegates", witness),
            fact(witness, "provides", object),
        ],
        "flow-end-direct" => vec![fact(subject, "to", object)],
        // The next step reaches an end by any of its own derivations.
        "flow-end-transitive" => std::iter::once(fact(subject, "to", object))
            .chain(
                stated_by
                    .keys()
                    .filter(|(s, p, _)| s == object && p == "flow-end")
                    .cloned(),
            )
            .collect(),
        _ => Vec::new(),
    };
    let mut found: Vec<String> = facts
        .iter()
        .filter_map(|f| stated_by.get(f))
        .flatten()
        .filter(|alias| alias.as_str() != own)
        .cloned()
        .collect();
    found.sort_by(|a, b| (&a[..1], number(a)).cmp(&(&b[..1], number(b))));
    found.dedup();
    found
}

fn aliases<'a>(
    prefix: &str,
    ids: impl IntoIterator<Item = &'a String>,
) -> BTreeMap<String, String> {
    let sorted: BTreeSet<&String> = ids.into_iter().collect();
    sorted
        .into_iter()
        .enumerate()
        .map(|(n, id)| (id.clone(), format!("{prefix}{}", n + 1)))
        .collect()
}

/// The numeric part of an alias, so `C10` sorts after `C9`.
pub(super) fn number(alias: &str) -> usize {
    alias
        .trim_start_matches(|c: char| c.is_ascii_alphabetic())
        .parse()
        .unwrap_or_default()
}

/// Candidates, with every pair of duplicate propositions that share a claim
/// folded into one group. Each group keeps every candidate it folds.
fn simplifications(context: &Context, names: &Names) -> Vec<(SimplificationEntry, Vec<String>)> {
    // Union-find over the claims of duplicate-proposition pairs.
    let mut parent: BTreeMap<String, String> = BTreeMap::new();
    fn find(parent: &mut BTreeMap<String, String>, id: &str) -> String {
        let up = parent
            .entry(id.to_owned())
            .or_insert_with(|| id.to_owned())
            .clone();
        if up == id {
            return up;
        }
        let root = find(parent, &up);
        parent.insert(id.to_owned(), root.clone());
        root
    }
    for candidate in &context.simplification {
        if candidate.kind == DUPLICATE_PROPOSITION
            && let [first, rest @ ..] = candidate.claims.as_slice()
        {
            for other in rest {
                let (a, b) = (find(&mut parent, first), find(&mut parent, other));
                // The smaller root wins, so a group's root never depends on
                // the order the pairs arrive in.
                match a.cmp(&b) {
                    std::cmp::Ordering::Less => parent.insert(b, a),
                    std::cmp::Ordering::Greater => parent.insert(a, b),
                    std::cmp::Ordering::Equal => None,
                };
            }
        }
    }

    let mut groups: BTreeMap<(String, BTreeSet<String>), BTreeSet<usize>> = BTreeMap::new();
    let mut members: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let ids: Vec<String> = parent.keys().cloned().collect();
    for id in ids {
        let root = find(&mut parent, &id);
        members.entry(root).or_default().insert(id);
    }
    for (n, candidate) in context.simplification.iter().enumerate() {
        let claims: BTreeSet<String> = if candidate.kind == DUPLICATE_PROPOSITION {
            candidate
                .claims
                .first()
                .map(|c| members[&find(&mut parent, c)].clone())
                .unwrap_or_default()
        } else {
            candidate.claims.iter().cloned().collect()
        };
        groups
            .entry((candidate.kind.clone(), claims))
            .or_default()
            .insert(n);
    }
    groups
        .into_iter()
        .enumerate()
        .map(|(n, ((kind, claims), candidates))| {
            let mut ids: Vec<String> = claims.into_iter().collect();
            ids.sort_by_key(|id| number(&names.claim(id)));
            let entry = SimplificationEntry {
                alias: format!("S{}", n + 1),
                kind,
                claims: ids.iter().map(|c| names.claim(c)).collect(),
                context: candidates
                    .into_iter()
                    .map(|i| format!("/simplification/{i}"))
                    .collect(),
            };
            (entry, ids)
        })
        .collect()
}
