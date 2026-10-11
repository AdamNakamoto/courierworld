#!/usr/bin/env bash
# Deploy Courier Skins to Robinhood Chain, with the settings in launch.env.
#
#   ./script/deploy-skins.sh                          # dry run against a fork
#   ./script/deploy-skins.sh --broadcast --browser    # deploy, signing in your browser wallet
#
# The reveal secret: pass your own as SECRET=..., or one is generated. It is printed once, in this terminal, and
# never written to disk. Store it in a password manager: the skins can only be revealed with it
# (CourierSkins.reveal(secret)). Run this in your own terminal, so the secret is never pasted anywhere else.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

set -a
source ./launch.env
set +a

BROADCAST=0
for a in "$@"; do [ "$a" = "--broadcast" ] && BROADCAST=1; done

if [ -z "${SECRET:-}" ]; then
  SECRET=$(cast to-dec "0x$(openssl rand -hex 32)")
  GENERATED=1
fi
export SECRET SEED_COMMIT=$(cast keccak "$(cast abi-encode "f(uint256)" "$SECRET")")

if [ "$BROADCAST" = 1 ]; then
  echo "Courier Skins on Robinhood Chain with:"
  grep -E '^(TREASURY|SKINS_[A-Z_]+)=' launch.env | sed 's/^/  /'
  echo "  SEED_COMMIT=$SEED_COMMIT"
  read -r -p "Type DEPLOY to continue: " ok
  [ "$ok" = "DEPLOY" ] || { echo "Cancelled."; exit 1; }
  forge script script/DeploySkins.s.sol --rpc-url robinhood "$@"
  ./script/export-web.sh
else
  forge script script/DeploySkins.s.sol --fork-url robinhood "$@"
fi

if [ "${GENERATED:-0}" = 1 ]; then
  echo
  echo "Reveal secret for this run (save it now; it is not stored anywhere):"
  echo "  $SECRET"
  [ "$BROADCAST" = 1 ] || echo "(dry run: this secret was not used on-chain)"
fi
