#!/bin/sh
set -eu

REPOSITORY="qoherent/sigil"
DEFAULT_VERSION="__SIGIL_VERSION__"
VERSION="${SIGIL_VERSION:-$DEFAULT_VERSION}"
INSTALL_ROOT="${SIGIL_INSTALL_DIR:-$HOME/.local/share/sigil}"
BIN_DIR="${SIGIL_BIN_DIR:-$HOME/.local/bin}"

fail() {
  echo "sigil installer: $*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"

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

asset="sigil-${arch}-${os}.tar.gz"
base="https://github.com/${REPOSITORY}/releases/download/cli-v${VERSION}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

curl -fL --retry 3 -o "$tmp/$asset" "$base/$asset"
curl -fL --retry 3 -o "$tmp/checksums.txt" "$base/checksums.txt"
expected="$(awk -v name="$asset" '$2 == name { print $1 }' "$tmp/checksums.txt")"
[ -n "$expected" ] || fail "checksum entry for $asset is missing"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
else
  fail "sha256sum or shasum is required"
fi
[ "$actual" = "$expected" ] || fail "checksum verification failed for $asset"

tar -xzf "$tmp/$asset" -C "$tmp"
source_dir="$tmp/sigil-$VERSION"
[ -x "$source_dir/bin/sigil" ] || fail "archive does not contain bin/sigil"
versions="$INSTALL_ROOT/versions"
destination="$versions/$VERSION"
mkdir -p "$versions" "$BIN_DIR"
replacement="$versions/.sigil-$VERSION-$$"
rm -rf "$replacement"
mv "$source_dir" "$replacement"
rm -rf "$destination"
mv "$replacement" "$destination"

wrapper="$BIN_DIR/.sigil-$$"
cat >"$wrapper" <<EOF
#!/bin/sh
exec "$destination/bin/sigil" "\$@"
EOF
chmod +x "$wrapper"
mv "$wrapper" "$BIN_DIR/sigil"

echo "Installed Sigil $VERSION to $destination"
echo "Run: sigil skill install"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Add $BIN_DIR to PATH to use the sigil command." ;;
esac
