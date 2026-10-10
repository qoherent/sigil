#!/bin/sh
set -eu

REPOSITORY="qoherent/sigil"
DEFAULT_VERSION="__SIGIL_VERSION__"
VERSION="${SIGIL_VERSION:-$DEFAULT_VERSION}"
INSTALL_ROOT="${SIGIL_INSTALL_DIR:-$HOME/.local/share/sigil}"
BIN_DIR="${SIGIL_BIN_DIR:-$HOME/.local/bin}"

fail() { echo "sigil installer: $*" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || fail "tar is required"
command -v curl >/dev/null 2>&1 || [ -n "${SIGIL_ARCHIVE_PATH:-}" ] || fail "curl is required"

case "$(uname -s)" in
  Darwin) os="apple-darwin" ;;
  Linux) os="unknown-linux-gnu" ;;
  *) fail "unsupported operating system: $(uname -s)" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch="aarch64" ;;
  x86_64|amd64) arch="x86_64" ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

archive="${SIGIL_ARCHIVE_PATH:-}"
checksums="${SIGIL_CHECKSUMS_PATH:-}"
if [ -n "$archive" ] || [ -n "$checksums" ]; then
  [ -n "$archive" ] && [ -n "$checksums" ] || fail "SIGIL_ARCHIVE_PATH and SIGIL_CHECKSUMS_PATH must be supplied together"
  [ -f "$archive" ] || fail "local archive does not exist"
  [ -f "$checksums" ] || fail "local checksums file does not exist"
else
  asset="sigil-${arch}-${os}.tar.gz"
  base="https://github.com/${REPOSITORY}/releases/download/cli-v${VERSION}"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT HUP INT TERM
  archive="$tmp/$asset"
  checksums="$tmp/checksums.txt"
  curl -fL --retry 3 -o "$archive" "$base/$asset"
  curl -fL --retry 3 -o "$checksums" "$base/checksums.txt"
fi

asset_name="$(basename "$archive")"
expected="$(awk -v name="$asset_name" '$2 == name { print $1 }' "$checksums")"
[ -n "$expected" ] || fail "checksum entry for $asset_name is missing"
if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$archive" | awk '{print $1}')"; else actual="$(shasum -a 256 "$archive" | awk '{print $1}')"; fi
[ "$actual" = "$expected" ] || fail "checksum verification failed for $asset_name"

if [ -z "${tmp:-}" ]; then tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT HUP INT TERM; fi
tar -tzf "$archive" | while IFS= read -r entry; do
  case "$entry" in
    /*|../*|*/../*|*"/.."|*"//"*) fail "archive contains an unsafe path: $entry" ;;
    sigil-$VERSION|sigil-$VERSION/*) ;;
    *) fail "archive contains an unexpected top-level path: $entry" ;;
  esac
done
link_entry="$(tar -tvzf "$archive" | awk 'substr($0,1,1) == "l" || substr($0,1,1) == "h" { print; exit }')"
[ -z "$link_entry" ] || fail "archive contains a symbolic link: $link_entry"
tar -xzf "$archive" -C "$tmp"
source_dir="$tmp/sigil-$VERSION"
[ -d "$source_dir" ] || fail "archive does not contain sigil-$VERSION"
[ -x "$source_dir/bin/sigil" ] || fail "archive does not contain bin/sigil"
[ -x "$source_dir/bin/sigilc" ] || fail "archive does not contain bin/sigilc"
[ ! -e "$source_dir/lib/sigil/runtime" ] || fail "archive contains obsolete runtime payloads"
if find "$source_dir" -type l -print -quit | grep . >/dev/null 2>&1; then fail "archive contains a symbolic link"; fi
archive_prefix="$(printf '%.16s' "$actual")"
destination="$INSTALL_ROOT/versions/${VERSION}-${archive_prefix}"
mkdir -p "$INSTALL_ROOT/versions" "$BIN_DIR"
if [ -e "$destination" ]; then
  diff -qr "$source_dir" "$destination" >/dev/null || fail "existing installation differs from verified archive"
else
  mv "$source_dir" "$destination"
fi
[ "$("$destination/bin/sigil" --version)" = "$VERSION" ] || fail "language executable version check failed"
"$destination/bin/sigilc" --version >/dev/null || fail "native compiler failed; existing installation remains selected"
for name in sigil sigilc; do
  ln -s "$destination/bin/$name" "$BIN_DIR/.$name-wrapper.$$"
done
mv -f "$BIN_DIR/.sigil-wrapper.$$" "$BIN_DIR/sigil"
mv -f "$BIN_DIR/.sigilc-wrapper.$$" "$BIN_DIR/sigilc"
if [ -L "$BIN_DIR/sigil-claims" ]; then
  claims_target="$(readlink "$BIN_DIR/sigil-claims")"
  case "$claims_target" in
    */versions/*/bin/sigil-claims) rm -f "$BIN_DIR/sigil-claims" ;;
  esac
fi
echo "Installed Sigil $VERSION to $destination"
