mod support;
use sigilc::store::clean_in;
use support::Workspace;

#[test]
fn clean_removes_worlds_and_trees_and_preserves_claims_readings() {
    let root = Workspace::new();
    root.write(".sigil/worlds/index.json", b"old index");
    root.write(".sigil/worlds/.lock", b"old lock");
    root.write(".sigil/trees/cache.json", b"cached tree");
    root.write(".sigil/claims/interpretations/a.egg", b"saved reading");
    let removed = clean_in(&root.0, &root.0.join(".sigil")).unwrap();
    assert_eq!(removed, [".sigil/trees", ".sigil/worlds"]);
    assert!(!root.0.join(".sigil/worlds").exists());
    assert!(!root.0.join(".sigil/trees").exists());
    assert_eq!(
        std::fs::read(root.0.join(".sigil/claims/interpretations/a.egg")).unwrap(),
        b"saved reading"
    );
    assert!(root.0.join(".sigil/config.json").is_file());
}

#[test]
fn clean_tolerates_absent_worlds_and_does_not_create_cache_directories() {
    let root = Workspace::new();
    let store = root.0.join("absent-store");
    assert!(clean_in(&root.0, &store).unwrap().is_empty());
    assert!(!store.exists());
    root.write(".sigil/trees/cache.json", b"cached tree");
    assert_eq!(
        clean_in(&root.0, &root.0.join(".sigil")).unwrap(),
        [".sigil/trees"]
    );
    assert!(!root.0.join(".sigil/worlds").exists());
}

#[cfg(unix)]
#[test]
fn clean_removes_cache_symlinks_without_following_their_targets() {
    let root = Workspace::new();
    root.write("keep/reading.egg", b"authored bytes");
    std::os::unix::fs::symlink(root.0.join("keep"), root.0.join(".sigil/worlds")).unwrap();
    std::os::unix::fs::symlink(root.0.join("keep"), root.0.join(".sigil/trees")).unwrap();
    clean_in(&root.0, &root.0.join(".sigil")).unwrap();
    assert!(!root.0.join(".sigil/worlds").exists());
    assert!(!root.0.join(".sigil/trees").exists());
    assert_eq!(
        std::fs::read(root.0.join("keep/reading.egg")).unwrap(),
        b"authored bytes"
    );
}
