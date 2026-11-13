# Optional: source ./activate.sh to use pi/tuios/tools from any directory.
OOMAGENT_PI_CHECKOUT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ -d "$OOMAGENT_PI_CHECKOUT/.portable/bin" ]]; then
  export PATH="$OOMAGENT_PI_CHECKOUT/.portable/bin:$PATH"
else
  printf 'Run bash setup.sh first.\n' >&2
fi
unset OOMAGENT_PI_CHECKOUT
