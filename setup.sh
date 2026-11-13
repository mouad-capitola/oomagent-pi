#!/usr/bin/env bash
# Install only Pi/TUIOS/tools. Never clone application repos or copy credentials.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ "${1:-}" == --help ]]; then
  printf 'Usage: bash setup.sh [--skip-system-packages]\nUbuntu 24.04+ / WSL2, x86_64 or arm64. Installs into .portable/.\n'
  exit 0
fi
if [[ "$(uname -s)" != Linux ]]; then
  printf 'This installer targets Ubuntu/WSL2, not the existing Mac installation.\n' >&2; exit 1
fi
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --skip-system-packages ) ]]; then
  printf 'Unknown argument. Use --help.\n' >&2; exit 1
fi
source "$ROOT/portable/versions.sh"
STATE="$ROOT/.portable"
if [[ -L "$STATE" ]]; then printf 'Refusing symlink: .portable\n' >&2; exit 1; fi
umask 077
mkdir -p "$STATE/downloads" "$STATE/bin" "$STATE/state"
# A failed run is resumable. Concurrent installers must never edit one runtime.
if ! mkdir "$STATE/setup.lock" 2>/dev/null; then
  printf 'Setup already running (or interrupted). Check .portable/setup.lock before retrying.\n' >&2; exit 1
fi
trap 'rmdir "$STATE/setup.lock"' EXIT
if [[ "${1:-}" != --skip-system-packages ]]; then
  SUDO=(); if [[ "$EUID" != 0 ]]; then SUDO=(sudo); fi
  "${SUDO[@]}" apt-get update
  "${SUDO[@]}" apt-get install -y ca-certificates curl git xz-utils unzip build-essential pkg-config python3 openjdk-21-jre-headless ripgrep fd-find gh neovim
fi
for tool in curl git tar xz sha256sum java; do
  command -v "$tool" >/dev/null || { printf 'Missing prerequisite: %s\n' "$tool" >&2; exit 1; }
done
fetch() {
  local url="$1" hash="$2" file="$3"
  if [[ -f "$file" ]] && printf '%s  %s\n' "$hash" "$file" | sha256sum --check --status; then return; fi
  curl --fail --location --retry 3 --proto '=https' --proto-redir '=https' "$url" -o "$file.part"
  printf '%s  %s\n' "$hash" "$file.part" | sha256sum --check --status || { printf 'Checksum mismatch: %s\n' "$url" >&2; exit 1; }
  mv "$file.part" "$file"
}
fetch "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz" "$NODE_SHA" "$STATE/downloads/node.tar.xz"
mkdir -p "$STATE/node"
tar -xJf "$STATE/downloads/node.tar.xz" --strip-components=1 -C "$STATE/node"
export PATH="$STATE/bin:$STATE/node/bin:$PATH"
fetch "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-$ARCH-unknown-linux-gnu.tar.gz" "$UV_SHA" "$STATE/downloads/uv.tar.gz"
tar -xzf "$STATE/downloads/uv.tar.gz" --strip-components=1 -C "$STATE/bin" "uv-$ARCH-unknown-linux-gnu/uv" "uv-$ARCH-unknown-linux-gnu/uvx"
TUIOS_ARCH="$ARCH"; [[ "$ARCH" != aarch64 ]] || TUIOS_ARCH=arm64
fetch "https://github.com/Gaurav-Gosain/tuios/releases/download/v$TUIOS_VERSION/tuios_${TUIOS_VERSION}_Linux_$TUIOS_ARCH.tar.gz" "$TUIOS_SHA" "$STATE/downloads/tuios.tar.gz"
mkdir -p "$STATE/tuios"
tar -xzf "$STATE/downloads/tuios.tar.gz" -C "$STATE/tuios"
fetch "https://github.com/lightpanda-io/browser/releases/download/$LIGHTPANDA_VERSION/lightpanda-$ARCH-linux" "$LIGHTPANDA_SHA" "$STATE/bin/lightpanda"
chmod 700 "$STATE/bin/lightpanda"

RUNTIME="$STATE/pi-source"
if [[ ! -d "$RUNTIME" ]]; then
  git clone --depth 1 --branch v1.5.2 https://github.com/earendil-works/pi.git "$RUNTIME"
fi
[[ "$(git -C "$RUNTIME" rev-parse HEAD)" == "$PI_COMMIT" ]] || { printf 'Unexpected Pi source revision; refusing to overwrite it.\n' >&2; exit 1; }
PATCH="$ROOT/portable/pi-1.5.2-chat-frame.patch"
if git -C "$RUNTIME" apply --check "$PATCH" 2>/dev/null; then
  git -C "$RUNTIME" apply "$PATCH"
elif ! git -C "$RUNTIME" apply --reverse --check "$PATCH" 2>/dev/null; then
  printf 'Pi patch does not match; source left untouched.\n' >&2; exit 1
fi
# Ignore dependency lifecycle scripts. Only the reviewed upstream build is run.
(cd "$RUNTIME" && npm ci --ignore-scripts && npm run hydrate:model-data && npm run build:offline)

export UV_PYTHON_INSTALL_DIR="$STATE/python-downloads"
export UV_PROJECT_ENVIRONMENT="$STATE/python"
uv python install "$PYTHON_VERSION"
uv sync --project "$ROOT/portable/python" --python "$PYTHON_VERSION" --frozen --no-dev
mkdir -p "$STATE/browser"
cp "$ROOT/portable/browser/package.json" "$ROOT/portable/browser/package-lock.json" "$STATE/browser/"
(cd "$STATE/browser" && npm ci --ignore-scripts)
export PLAYWRIGHT_BROWSERS_PATH="$STATE/browsers"
if [[ "${1:-}" == --skip-system-packages ]]; then
  "$STATE/browser/node_modules/.bin/playwright" install chromium
else
  "$STATE/browser/node_modules/.bin/playwright" install --with-deps chromium
fi

fetch "https://github.com/zaproxy/zaproxy/releases/download/v$ZAP_VERSION/ZAP_${ZAP_VERSION}_Linux.tar.gz" "$ZAP_SHA" "$STATE/downloads/zap.tar.gz"
mkdir -p "$STATE/zap"
tar -xzf "$STATE/downloads/zap.tar.gz" --strip-components=1 -C "$STATE/zap"
mkdir -p "$STATE/state/zap/plugin"
while read -r tag asset hash; do
  [[ -n "$tag" && "$tag" != \#* ]] || continue
  fetch "https://github.com/zaproxy/zap-extensions/releases/download/$tag/$asset" "$hash" "$STATE/state/zap/plugin/$asset"
done < "$ROOT/portable/zap-addons.txt"
node "$ROOT/portable/configure.mjs"
printf '\nInstalled. Start ./pi or ./tuios. In Pi use /login; GitHub: ./tools gh auth login.\n'
printf 'Optional Exa key: edit .portable/state/local.env (never commit it).\n'
"$ROOT/tools" doctor
