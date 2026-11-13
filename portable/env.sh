# Sourced by the launchers; ROOT is their checkout, never a fixed home directory.
STATE="$ROOT/.portable"
if [[ ! -x "$STATE/node/bin/node" || ! -f "$STATE/agent/settings.json" ]]; then
  printf 'Run bash "%s/setup.sh" first (inside Ubuntu/WSL2).\n' "$ROOT" >&2
  exit 1
fi
export OOMAGENT_PI_ROOT="$ROOT"
export PATH="$STATE/bin:$STATE/node/bin:$STATE/python/bin:$STATE/browser/node_modules/.bin:$PATH"
export PI_CODING_AGENT_DIR="$STATE/agent"
unset PI_CODING_AGENT_SESSION_DIR PI_MANAGED_INSTALL_ROOT PI_SESSION_ID PI_SESSION_FILE PI_PACKAGE_DIR
export PI_SKIP_VERSION_CHECK=1
# Do not let upstream self-update silently replace the custom chat frame.
export PI_SELF_UPDATE_COMMAND=false
export PLAYWRIGHT_BROWSERS_PATH="$STATE/browsers"
export LIGHTPANDA_DISABLE_TELEMETRY=true
export UV_PYTHON_INSTALL_DIR="$STATE/python-downloads"
# An optional local shell file, owned and edited by the user, never copied from Mac.
if [[ -f "$STATE/state/local.env" ]]; then
  set -a
  source "$STATE/state/local.env"
  set +a
fi
