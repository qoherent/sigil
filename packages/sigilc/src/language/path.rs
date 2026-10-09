//! Workspace path helpers shared with the TypeScript reader's `path.ts`.
use regex::Regex;

/// Normalize separators and dot segments the way the TypeScript reader does.
pub fn normalize_path(path: &str) -> String {
    let mut normalized = path.replace('\\', "/");
    while normalized.contains("//") {
        normalized = normalized.replace("//", "/");
    }
    if normalized.is_empty() {
        return ".".into();
    }
    let drive = {
        let b = normalized.as_bytes();
        (b.len() >= 2
            && b[0].is_ascii_alphabetic()
            && b[1] == b':'
            && (b.len() == 2 || b[2] == b'/'))
            .then(|| normalized[..2].to_owned())
    };
    let absolute = normalized.starts_with('/') || drive.is_some();
    let body = drive
        .as_ref()
        .map_or(normalized.as_str(), |d| &normalized[d.len()..]);
    let mut parts: Vec<&str> = Vec::new();
    for part in body.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|last| *last != "..") {
                    parts.pop();
                } else if !absolute {
                    parts.push("..");
                }
            }
            other => parts.push(other),
        }
    }
    let joined = parts.join("/");
    if let Some(drive) = drive {
        return if joined.is_empty() {
            format!("{drive}/")
        } else {
            format!("{drive}/{joined}")
        };
    }
    if absolute {
        return format!("/{joined}");
    }
    if joined.is_empty() {
        ".".into()
    } else {
        joined
    }
}

/// Match a workspace-relative glob (`*`, `**`, `?`) against a path.
pub fn glob_matches(pattern: &str, path: &str) -> bool {
    let pattern = pattern.replace('\\', "/");
    let pattern = pattern.strip_prefix("./").unwrap_or(&pattern);
    let chars: Vec<char> = pattern.chars().collect();
    let mut source = String::from("^");
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '*' if chars.get(i + 1) == Some(&'*') => {
                i += 1;
                if chars.get(i + 1) == Some(&'/') {
                    i += 1;
                    source.push_str("(?:.*/)?");
                } else {
                    source.push_str(".*");
                }
            }
            '*' => source.push_str("[^/]*"),
            '?' => source.push_str("[^/]"),
            c => source.push_str(&regex::escape(&c.to_string())),
        }
        i += 1;
    }
    source.push('$');
    Regex::new(&format!("(?s){source}")).is_ok_and(|re| re.is_match(path))
}

pub fn join_path(parts: &[&str]) -> String {
    normalize_path(
        &parts
            .iter()
            .filter(|p| !p.is_empty())
            .copied()
            .collect::<Vec<_>>()
            .join("/"),
    )
}

/// Import paths are root-relative source identities, never directory indexes.
pub fn normalize_import_path(path: &str) -> Option<String> {
    let b = path.as_bytes();
    if path.starts_with(['/', '\\']) || (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':')
    {
        return None;
    }
    let normalized = normalize_path(path);
    if normalized == ".." || normalized.starts_with("../") || !normalized.ends_with(".sigil") {
        return None;
    }
    Some(normalized)
}
