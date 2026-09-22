use sigilc::claims::{guidance, vocabulary};
use std::{fs, path::PathBuf};

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn repo_root() -> PathBuf {
    crate_dir().join("..").join("..").canonicalize().unwrap()
}

fn skill_text(name: &str) -> String {
    let path = repo_root().join("integrations/skills/sigil-egglog/references").join(name);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn bundle_text(name: &str) -> &'static str {
    guidance::document(name)
        .unwrap_or_else(|| panic!("guidance bundle is missing {name}"))
        .text
}

fn inline_code(text: &str) -> Vec<String> {
    let prose: String = text
        .lines()
        .scan(false, |fenced, line| {
            if line.trim_start().starts_with("```") {
                *fenced = !*fenced;
                return Some("");
            }
            Some(if *fenced { "" } else { line })
        })
        .collect::<Vec<_>>()
        .join("\n");
    prose
        .split('`')
        .skip(1)
        .step_by(2)
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .collect()
}

#[test]
fn skill_names_every_returned_row_kind_and_invents_none() {
    let dialect = skill_text("dialect.md");
    let quoted = inline_code(&dialect);
    let mentions = |name: &str| quoted.iter().any(|token| token == name);
    let compiled: Vec<&str> = vocabulary::RETURNED.iter().map(|row| row.name).collect();

    for name in &compiled {
        assert!(
            mentions(name),
            "skill dialect is missing returned-row kind {name}; compiled vocabulary still publishes it"
        );
    }
    for token in &quoted {
        if compiled.contains(&token.as_str()) {
            continue;
        }
        // Routing and language words, not row kinds.
        let allowed = [
            "rule",
            "command",
            "schedule",
            "ruleset",
            "run",
            "vocabulary.md",
            "sigil-understand",
        ];
        assert!(
            allowed.contains(&token.as_str()) || token.contains(' '),
            "skill dialect names {token} as if it were a row kind; compiled vocabulary does not"
        );
    }
}

#[test]
fn skill_and_guidance_agree_on_refusal_tokens() {
    let dialect = skill_text("dialect.md");
    let published = bundle_text("vocabulary.md");
    let tokens = ["rule", "command", "schedule"];
    for token in tokens {
        assert!(
            dialect.contains(token),
            "skill dialect is missing refusal token {token}"
        );
        let plural = format!("{token}s");
        assert!(
            published.contains(token) || published.contains(&plural),
            "compiled vocabulary.md is missing refusal token {token} while the skill teaches it"
        );
    }
    assert!(
        dialect.contains("refused"),
        "skill dialect is missing whole-artifact refuse"
    );
    assert!(
        published.contains("refused"),
        "compiled vocabulary.md is missing whole-artifact refuse while the skill teaches it"
    );
    assert!(
        dialect.contains("quoted string literal") || dialect.contains("quoted string literals"),
        "skill dialect is missing non-literal / quoted-string refusal"
    );
    assert!(
        published.contains("quoted string literal"),
        "compiled vocabulary.md is missing quoted string literal while the skill teaches it"
    );
}

#[test]
fn named_law_excerpts_occur_in_the_named_source() {
    let language = skill_text("language.md");
    let mut named = 0usize;
    let lines: Vec<&str> = language.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        let Some(name) = line
            .strip_prefix("From `")
            .and_then(|rest| rest.strip_suffix("`:"))
        else {
            i += 1;
            continue;
        };
        let relative = match name {
            "kernel.egg" => "src/kernel.egg",
            "design.egg" => "src/design.egg",
            "comparison.egg" => "src/comparison.egg",
            "claims.egg" => "src/claims/claims.egg",
            other => panic!("skill names unknown law file {other}"),
        };
        i += 1;
        while i < lines.len() && lines[i].trim().is_empty() {
            i += 1;
        }
        assert!(
            i < lines.len() && lines[i].trim() == "```lisp",
            "From `{name}`: must be followed by a lisp excerpt"
        );
        i += 1;
        let mut excerpt = String::new();
        while i < lines.len() && lines[i].trim() != "```" {
            if !excerpt.is_empty() {
                excerpt.push('\n');
            }
            excerpt.push_str(lines[i]);
            i += 1;
        }
        assert!(i < lines.len(), "unclosed lisp excerpt for {name}");
        let source = crate_dir().join(relative);
        let source = fs::read_to_string(&source).unwrap_or_else(|e| panic!("{}: {e}", source.display()));
        assert!(
            source.contains(&excerpt),
            "excerpt named to {name} does not occur in that law file:\n{excerpt}"
        );
        named += 1;
        i += 1;
    }
    assert!(
        named >= 4,
        "expected excerpts named to each law file, found {named}"
    );
}
