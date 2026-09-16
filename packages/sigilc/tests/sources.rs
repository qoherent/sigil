use sigilc::sources::{Selection, capture, discover, hash};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};

struct Workspace(PathBuf);
impl Workspace {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "sigil-sources-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }
    fn write(&self, path: &str, bytes: &[u8]) {
        let target = self.0.join(path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, bytes).unwrap();
    }
}
impl Drop for Workspace {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn source_local_hashes_survive_neighbor_edits_and_scope_membership_changes() {
    let root = Workspace::new();
    root.write("a.ts", b"import { B } from './b'; B.run();");
    root.write("b.py", b"def B(): pass");
    root.write("c.unusual", b"arbitrary-language");
    let before = discover(&root.0, &Selection::default()).unwrap();
    root.write("b.py", b"def Renamed(): return 1");
    let after = discover(&root.0, &Selection::default()).unwrap();
    assert_ne!(before.fingerprint, after.fingerprint);
    assert_eq!(before.files[0], after.files[0]);
    assert_ne!(before.files[1], after.files[1]);
    assert_eq!(before.files[2], after.files[2]);
    root.write("d.py", b"def Renamed(): return 1");
    let duplicate = discover(&root.0, &Selection::default()).unwrap();
    assert_ne!(after.fingerprint, duplicate.fingerprint);
    fs::rename(root.0.join("d.py"), root.0.join("e.py")).unwrap();
    let renamed = discover(&root.0, &Selection::default()).unwrap();
    assert_ne!(duplicate.fingerprint, renamed.fingerprint);
    fs::remove_file(root.0.join("e.py")).unwrap();
    assert_eq!(
        after.fingerprint,
        discover(&root.0, &Selection::default())
            .unwrap()
            .fingerprint
    );
}

#[test]
fn captured_bytes_remain_exact_and_bounded() {
    let root = Workspace::new();
    let bytes = b"\0\xff\r\nexact bytes";
    root.write("a.raw", bytes);
    let captured = capture(&root.0, "a.raw", 1024).unwrap();
    assert_eq!(captured.bytes, bytes);
    assert_eq!(captured.identity.checksum, hash(bytes));
    root.write("a.raw", b"changed");
    assert_eq!(captured.bytes, bytes);
    assert_ne!(
        captured.identity.checksum,
        capture(&root.0, "a.raw", 1024).unwrap().identity.checksum
    );
    assert!(
        capture(&root.0, "a.raw", 2)
            .unwrap_err()
            .contains("byte limit")
    );
    assert!(capture(&root.0, "missing", 1024).is_err());
    assert!(capture(&root.0, "../escape", 1024).is_err());
}

#[test]
fn selection_uses_relative_sigil_globs_and_excludes_internal_and_vendor_trees() {
    let root = Workspace::new();
    for path in [
        "main.ts",
        "src/a.ts",
        "src/b.py",
        "src/deep/a.ts",
        "src/test.ts",
        "vendor/a.ts",
        "nested/.sigil/private",
        ".git/config",
        "target/binary",
    ] {
        root.write(path, b"test");
    }
    let select = Selection {
        include: vec!["**/*.ts".into()],
        exclude: vec!["**/test.ts".into()],
        vendor_dirs: vec!["vendor".into()],
        ..Default::default()
    };
    let result = discover(&root.0, &select).unwrap();
    assert_eq!(
        result
            .files
            .iter()
            .map(|f| f.path.as_str())
            .collect::<Vec<_>>(),
        ["main.ts", "src/a.ts", "src/deep/a.ts"]
    );
    let only = discover(
        &root.0,
        &Selection {
            dirs: vec!["src".into()],
            include: vec!["src/?.ts".into()],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(only.files.len(), 1);
    assert_eq!(only.files[0].path, "src/a.ts");
    let exact = discover(
        &root.0,
        &Selection {
            paths: vec!["src/b.py".into()],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(exact.files.len(), 1);
    assert!(
        discover(
            &root.0,
            &Selection {
                paths: vec!["missing".into()],
                ..Default::default()
            }
        )
        .is_err()
    );
    assert!(
        discover(
            &root.0,
            &Selection {
                include: vec!["*.nothing".into()],
                ..Default::default()
            }
        )
        .is_err()
    );
    let empty = discover(
        &root.0,
        &Selection {
            include: vec!["*.nothing".into()],
            allow_empty: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(empty.intentional_empty);
}

#[test]
fn explicit_files_preserve_filtering_deduplication_and_directory_identity() {
    let root = Workspace::new();
    let paths = [
        "src/a.any",
        "src/b.any",
        "src/test.any",
        "src/other.py",
        "vendor/x.any",
        "nested/.sigil/private.any",
    ];
    for path in paths {
        root.write(path, b"same bytes");
    }
    let filters = || Selection {
        include: vec!["**/*.any".into()],
        exclude: vec!["**/test.any".into()],
        vendor_dirs: vec!["vendor".into()],
        ..Default::default()
    };
    let directory = discover(
        &root.0,
        &Selection {
            dirs: vec!["src".into()],
            ..filters()
        },
    )
    .unwrap();
    let explicit = Selection {
        paths: paths
            .iter()
            .chain(["src/a.any"].iter())
            .map(|p| (*p).into())
            .collect(),
        ..filters()
    };
    let files = discover(&root.0, &explicit).unwrap();
    assert_eq!(files.files, directory.files);
    assert_eq!(files.fingerprint, directory.fingerprint);
    assert_eq!(files.files.len(), 2);
    let mut excluded = Selection {
        paths: vec!["vendor/x.any".into(), "src/test.any".into()],
        ..filters()
    };
    assert!(discover(&root.0, &excluded).is_err());
    excluded.allow_empty = true;
    assert!(discover(&root.0, &excluded).unwrap().intentional_empty);
}

#[cfg(unix)]
#[test]
fn explicit_selection_ignores_unrelated_unreadable_and_non_source_paths() {
    use std::os::unix::fs::PermissionsExt;
    let root = Workspace::new();
    root.write("chosen.any", b"selected");
    root.write("unrelated/not:a:source", b"outside scope");
    root.write("excluded.any", b"do not hash");
    fs::set_permissions(root.0.join("unrelated"), fs::Permissions::from_mode(0o0)).unwrap();
    fs::set_permissions(root.0.join("excluded.any"), fs::Permissions::from_mode(0o0)).unwrap();
    let result = discover(
        &root.0,
        &Selection {
            paths: vec!["chosen.any".into(), "excluded.any".into()],
            exclude: vec!["excluded.any".into()],
            ..Default::default()
        },
    );
    // Restore before assertions so cleanup also works on a failure.
    fs::set_permissions(root.0.join("unrelated"), fs::Permissions::from_mode(0o700)).unwrap();
    fs::set_permissions(
        root.0.join("excluded.any"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    let files = result.unwrap();
    assert_eq!(files.files.len(), 1);
    assert_eq!(files.files[0].checksum, hash(b"selected"));
}

#[cfg(unix)]
#[test]
fn permissions_do_not_change_semantic_identity() {
    use std::os::unix::fs::PermissionsExt;
    let root = Workspace::new();
    root.write("a.py", b"print(1)");
    let before = discover(&root.0, &Selection::default()).unwrap();
    fs::set_permissions(root.0.join("a.py"), fs::Permissions::from_mode(0o700)).unwrap();
    let after = discover(&root.0, &Selection::default()).unwrap();
    assert_eq!(before.fingerprint, after.fingerprint);
}

#[cfg(unix)]
#[test]
fn symlinks_and_special_files_cannot_be_explicit_sources_or_artifact_parents() {
    use sigilc::sources::checked_path;
    use std::os::unix::{fs::symlink, net::UnixListener};
    let root = Workspace::new();
    let outside = Workspace::new();
    root.write("a.ts", b"a");
    outside.write("secret", b"private");
    symlink(&outside.0, root.0.join("escape")).unwrap();
    symlink(root.0.join("a.ts"), root.0.join("alias")).unwrap();
    let _socket = UnixListener::bind(root.0.join("socket")).unwrap();
    let result = discover(&root.0, &Selection::default()).unwrap();
    assert_eq!(result.files.len(), 1);
    for path in ["escape/secret", "alias", "socket"] {
        assert!(capture(&root.0, path, 1024).is_err());
        assert!(
            discover(
                &root.0,
                &Selection {
                    paths: vec![path.into()],
                    ..Default::default()
                }
            )
            .is_err()
        );
    }
    assert!(checked_path(&root.0, "escape/new/file.egg").is_err());
    assert!(
        discover(
            &root.0,
            &Selection {
                dirs: vec!["escape".into()],
                ..Default::default()
            }
        )
        .is_err()
    );
}
