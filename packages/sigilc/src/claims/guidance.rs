//! Compiled-in interpreter guidance. Nothing on disk is read, so nothing on
//! disk can widen what the tool accepts.
use crate::sources::hash;
use std::path::{Component, Path, PathBuf};

/// One guidance document, as it ships and as it extracts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Document {
    pub name: &'static str,
    pub text: &'static str,
}

const SECTIONS: &str = include_str!("guidance/sections.md");
const VOCABULARY: &str = include_str!("guidance/vocabulary.md");
const EXAMPLES: &str = include_str!("guidance/examples.md");
const REJECTED: &str = include_str!("guidance/rejected.md");

/// The bundle handed to the external interpreter, in reading order.
pub const BUNDLE: &[Document] = &[
    Document {
        name: "sections.md",
        text: SECTIONS,
    },
    Document {
        name: "vocabulary.md",
        text: VOCABULARY,
    },
    Document {
        name: "examples.md",
        text: EXAMPLES,
    },
    Document {
        name: "rejected.md",
        text: REJECTED,
    },
];

pub fn document(name: &str) -> Option<&'static Document> {
    BUNDLE.iter().find(|doc| doc.name == name)
}

/// Identity of everything that decides what the interpreter is told and what the
/// tool derives: the guidance text, the vocabulary definition, the laws, and the
/// compiler's own accepted ontology.
///
/// This is the claims-side analogue of `eqval::fingerprint()`, and it is
/// deliberately separate from it: that value covers the compiler's runtime and
/// must not move, so this component hashes its own sources instead. The
/// compiler's ontology is folded in even though this crate does not own it,
/// because `vocabulary::relations()` reads `turtle::vocabulary()` at runtime:
/// without this, a compiler change that widens the accepted predicate set
/// would silently widen what this tool accepts too, with no move in the
/// fingerprint the binding staleness check depends on.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::CompiledGuidance interface,constraints
pub fn fingerprint() -> String {
    hash(
        format!(
            "{}{}",
            concat!(
                include_str!("guidance/sections.md"),
                include_str!("guidance/vocabulary.md"),
                include_str!("guidance/examples.md"),
                include_str!("guidance/rejected.md"),
                include_str!("vocabulary.rs"),
                include_str!("claims.egg")
            ),
            crate::turtle::ontology_fingerprint()
        )
        .as_bytes(),
    )
}

/// Write an editable copy of the bundle to an operator-named directory.
///
/// Refused when the destination lies inside the workspace under validation:
/// guidance is trusted because it was released with the binary, so a copy that
/// could be mistaken for workspace input has no business being there. This
/// affects only what the interpreter is told; no extracted file is ever read
/// back, so editing one cannot widen what the tool accepts.
pub fn extract(out: &Path, workspace_root: &Path) -> Result<Vec<PathBuf>, String> {
    if contains(workspace_root, out)? {
        return Err(format!(
            "refusing to write guidance inside the workspace under validation: {}",
            out.display()
        ));
    }
    std::fs::create_dir_all(out).map_err(|e| format!("{}: {e}", out.display()))?;
    let mut written = Vec::new();
    for doc in BUNDLE {
        let path = out.join(doc.name);
        std::fs::write(&path, doc.text).map_err(|e| format!("{}: {e}", path.display()))?;
        written.push(path);
    }
    Ok(written)
}

/// Whether `inner` resolves to `root` or somewhere beneath it.
///
/// Resolves the nearest existing ancestor, because the destination usually does
/// not exist yet; a purely lexical comparison would be defeated by `..`.
fn contains(root: &Path, inner: &Path) -> Result<bool, String> {
    let root = resolve(root)?;
    let inner = resolve(inner)?;
    Ok(inner.starts_with(&root))
}

fn resolve(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(path)
    };
    let mut existing = absolute.as_path();
    let mut tail = Vec::new();
    loop {
        match existing.canonicalize() {
            Ok(mut resolved) => {
                for part in tail.iter().rev() {
                    resolved.push(part);
                }
                return Ok(resolved);
            }
            Err(_) => match existing.parent() {
                Some(parent) => {
                    match existing.file_name() {
                        Some(name) => tail.push(name.to_owned()),
                        // A root or prefix component cannot be canonicalized and
                        // has no file name; fall back to the lexical form.
                        None => return Ok(normalize(&absolute)),
                    }
                    existing = parent;
                }
                None => return Ok(normalize(&absolute)),
            },
        }
    }
}

fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}
