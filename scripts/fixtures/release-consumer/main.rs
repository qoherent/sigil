//! Source-independent release smoke harness.
//!
//! The build workflow compiles this file on the matching target runner and
//! uploads only the resulting executable, the tested archive, and the small
//! fixture directory. The consumer process does not check out the repository or
//! invoke Deno, Node, npm, Cargo, or a compiler from the host PATH.

use std::env;
use std::ffi::{OsStr, OsString};
use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

struct RemoveOnDrop(PathBuf);

impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn main() {
    if is_hostile_shim() {
        std::process::exit(97);
    }
    if let Err(error) = run() {
        eprintln!("release artifact consumer failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let arguments: Vec<String> = env::args().collect();
    let distribution = required_argument(&arguments, "--distribution")?;
    let fixture = required_argument(&arguments, "--fixture")?;
    let distribution = PathBuf::from(distribution);
    let fixture = PathBuf::from(fixture);
    let executable_name = if cfg!(windows) { "sigil.exe" } else { "sigil" };
    let cli = distribution.join("bin").join(executable_name);
    if !cli.is_file() {
        return Err(format!("archive is missing {}", cli.display()));
    }

    let scratch = unique_temp_dir("sigil-artifact-consumer")?;
    fs::create_dir_all(&scratch).map_err(io_error)?;
    let _cleanup = RemoveOnDrop(scratch.clone());
    let unrelated = scratch.join("unrelated working directory");
    let home = scratch.join("empty home");
    let cache = scratch.join("empty cache");
    let shims = scratch.join("hostile shims");
    let target = scratch.join("fixture project");
    let marker = shims.join("unexpected-invocation.log");
    for path in [&unrelated, &home, &cache, &shims, &target] {
        fs::create_dir_all(path).map_err(io_error)?;
    }
    install_hostile_shims(&shims)?;
    install_fixture(&fixture, &target)?;
    reject_source_and_cache_roots(&distribution, &fixture, &home, &cache)?;

    let path = isolated_path(&shims);
    let environment = isolated_environment(&path, &home, &cache, &marker);

    let version = run_cli(&cli, &["--version"], &unrelated, &environment)?;
    if !version.status.success() {
        return Err(format!(
            "version failed with {}: {}",
            exit_code(&version),
            output_text(&version)
        ));
    }
    let version_output = stdout_text(&version);
    let version_text = version_output.trim();
    if !is_semver(version_text) {
        return Err(format!("version returned invalid text: {version_text:?}"));
    }

    let compiler = distribution.join("bin").join(if cfg!(windows) {
        "sigilc.exe"
    } else {
        "sigilc"
    });
    let compiler_version = run_cli(&compiler, &["--version"], &unrelated, &environment)?;
    if !compiler_version.status.success() || !stdout_text(&compiler_version).starts_with("sigilc ")
    {
        return Err(format!(
            "native compiler version failed: {}",
            output_text(&compiler_version)
        ));
    }
    let target_text = path_string(&target);
    let exported = run_cli(
        &cli,
        &["export", "design", &target_text, "--root", &target_text],
        &unrelated,
        &environment,
    )?;
    if !exported.status.success() {
        return Err(format!(
            "structural Design export failed: {}",
            output_text(&exported)
        ));
    }
    let structural = compact(&stdout_text(&exported));
    if !structural.contains("\"schemaVersion\":2")
        || !structural.contains("\"languageVersion\":\"0.8.0\"")
    {
        return Err("expected Sigil 0.8 schema-2 structural export".into());
    }
    let frontend = unrelated.join("frontend.json");
    fs::write(&frontend, &exported.stdout).map_err(io_error)?;
    let frontend_text = path_string(&frontend);
    let design = run_cli(
        &compiler,
        &[
            "compile",
            "design",
            "--root",
            &target_text,
            "--frontend",
            &frontend_text,
        ],
        &unrelated,
        &environment,
    )?;
    if !design.status.success() || !compact(&stdout_text(&design)).contains("\"state\":\"Loose\"") {
        return Err(format!(
            "unreconstructed Design must be Loose with exit 0: {}",
            output_text(&design)
        ));
    }
    let selection = unrelated.join("selection.json");
    fs::write(&selection, b"{\"paths\":[\"main.sigil\"]}").map_err(io_error)?;
    let selection_text = path_string(&selection);
    let comparison = run_cli(
        &compiler,
        &[
            "compare",
            "--root",
            &target_text,
            "--frontend",
            &frontend_text,
            "--selection",
            &selection_text,
        ],
        &unrelated,
        &environment,
    )?;
    if comparison.status.code() != Some(3)
        || !compact(&stdout_text(&comparison)).contains("\"comparison\":null")
    {
        return Err(format!(
            "unavailable comparison must be unset with exit 3: {}",
            output_text(&comparison)
        ));
    }

    if marker.is_file() {
        let invocations = fs::read_to_string(&marker).map_err(io_error)?;
        if !invocations.trim().is_empty() {
            return Err(format!(
                "packaged CLI invoked forbidden host tools: {invocations}"
            ));
        }
    }
    println!(
        "{{\"artifactConsumer\":true,\"version\":\"{version_text}\",\"design\":\"Loose\",\"comparison\":null,\"hostToolsInvoked\":false}}"
    );
    Ok(())
}

fn required_argument(arguments: &[String], name: &str) -> Result<String, String> {
    let index = arguments
        .iter()
        .position(|argument| argument == name)
        .ok_or_else(|| format!("missing {name}"))?;
    arguments
        .get(index + 1)
        .cloned()
        .ok_or_else(|| format!("missing value for {name}"))
}

fn unique_temp_dir(prefix: &str) -> Result<PathBuf, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    Ok(env::temp_dir().join(format!("{prefix}-{}-{nanos}", std::process::id())))
}

fn install_fixture(source: &Path, target: &Path) -> Result<(), String> {
    let sigil = target.join(".sigil");
    fs::create_dir_all(&sigil).map_err(io_error)?;
    fs::copy(source.join("main.sigil"), target.join("main.sigil")).map_err(io_error)?;
    fs::copy(
        source.join("fixture-config.json"),
        sigil.join("config.json"),
    )
    .map_err(io_error)?;
    Ok(())
}

fn reject_source_and_cache_roots(
    distribution: &Path,
    fixture: &Path,
    home: &Path,
    cache: &Path,
) -> Result<(), String> {
    for name in [
        "packages",
        "node_modules",
        "deno.json",
        "Cargo.toml",
        "repos",
        "lib",
    ] {
        if distribution.join(name).exists() {
            return Err(format!(
                "distribution unexpectedly contains source/dependency root {}",
                distribution.join(name).display()
            ));
        }
    }
    if fixture.join("node_modules").exists() || fixture.join(".git").exists() {
        return Err("fixture unexpectedly contains source/dependency state".to_owned());
    }
    if fs::read_dir(home).map_err(io_error)?.next().is_some()
        || fs::read_dir(cache).map_err(io_error)?.next().is_some()
    {
        return Err("isolated home/cache was not empty before the child ran".to_owned());
    }
    Ok(())
}

fn install_hostile_shims(shims: &Path) -> Result<(), String> {
    let consumer = env::current_exe().map_err(io_error)?;
    for name in [
        "deno", "node", "npm", "npx", "cargo", "rustc", "tsc", "tsgo",
    ] {
        let filename = if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.to_owned()
        };
        let path = shims.join(filename);
        fs::copy(&consumer, &path).map_err(io_error)?;
        make_executable(&path)?;
    }
    Ok(())
}

fn is_hostile_shim() -> bool {
    let Some(name) = env::current_exe()
        .ok()
        .and_then(|path| path.file_stem().map(|value| value.to_owned()))
        .and_then(|value| value.into_string().ok())
    else {
        return false;
    };
    let name = name.to_ascii_lowercase();
    let forbidden = [
        "deno", "node", "npm", "npx", "cargo", "rustc", "tsc", "tsgo",
    ];
    if !forbidden.contains(&name.as_str()) {
        return false;
    }
    if let Some(marker) = env::var_os("SIGIL_SHIM_MARKER") {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(marker) {
            use std::io::Write;
            let _ = writeln!(file, "{name}");
        }
    }
    true
}

fn make_executable(path: &Path) -> Result<(), String> {
    #[cfg(not(unix))]
    let _ = path;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path).map_err(io_error)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).map_err(io_error)?;
    }
    Ok(())
}

fn isolated_path(shims: &Path) -> OsString {
    if cfg!(windows) {
        let system_root =
            env::var_os("SystemRoot").unwrap_or_else(|| OsString::from(r"C:\Windows"));
        let system32 = PathBuf::from(&system_root).join("System32");
        let mut value = shims.as_os_str().to_os_string();
        value.push(";");
        value.push(system32);
        value.push(";");
        value.push(&system_root);
        value
    } else {
        let mut value = shims.as_os_str().to_os_string();
        value.push(":/usr/local/bin:/usr/bin:/bin");
        value
    }
}

fn isolated_environment(
    path: &OsStr,
    home: &Path,
    cache: &Path,
    marker: &Path,
) -> Vec<(OsString, OsString)> {
    let mut values = vec![
        (OsString::from("PATH"), path.to_os_string()),
        (OsString::from("HOME"), home.as_os_str().to_os_string()),
        (
            OsString::from("USERPROFILE"),
            home.as_os_str().to_os_string(),
        ),
        (OsString::from("DENO_DIR"), cache.as_os_str().to_os_string()),
        (OsString::from("TMPDIR"), cache.as_os_str().to_os_string()),
        (OsString::from("TEMP"), cache.as_os_str().to_os_string()),
        (OsString::from("TMP"), cache.as_os_str().to_os_string()),
        (
            OsString::from("SIGIL_SHIM_MARKER"),
            marker.as_os_str().to_os_string(),
        ),
    ];
    if cfg!(windows) {
        for name in ["SystemRoot", "WINDIR", "ComSpec"] {
            if let Some(value) = env::var_os(name) {
                values.push((OsString::from(name), value));
            }
        }
    }
    values
}

fn run_cli(
    cli: &Path,
    arguments: &[&str],
    cwd: &Path,
    environment: &[(OsString, OsString)],
) -> Result<Output, String> {
    let mut command = Command::new(cli);
    command
        .args(arguments)
        .current_dir(cwd)
        .env_clear()
        .envs(environment.iter().map(|(key, value)| (key, value)));
    command.output().map_err(io_error)
}

fn stdout_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn output_text(output: &Output) -> String {
    let stdout = stdout_text(output);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.trim().is_empty() {
        stdout
    } else {
        format!("{stdout}{stderr}")
    }
}

fn exit_code(output: &Output) -> String {
    output
        .status
        .code()
        .map(|code| code.to_string())
        .unwrap_or_else(|| "signal".to_owned())
}

fn compact(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn is_semver(value: &str) -> bool {
    let mut parts = value.split('.');
    parts.next().is_some_and(|part| {
        !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
    }) && parts.next().is_some_and(|part| {
        !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
    }) && parts.next().is_some_and(|part| {
        !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
    }) && parts.next().is_none()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn io_error(error: io::Error) -> String {
    error.to_string()
}
