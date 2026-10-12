#!/usr/bin/env bash
# Deploy the treasure hunt's payouts (TokenDrops): golden stamps and token drops, funded by the treasury.
#
#   DROPS_SIGNER=0x… ./script/deploy-drops.sh --sender 0x…                                  # dry run on a fork
#   DROPS_SIGNER=0x… ./script/deploy-drops.sh --broadcast --browser --browser-disable-open  # deploy
#
# DROPS_SIGNER is the address of the multiplayer server's voucher key (the key itself lives only in the server's
# secrets). Sign with the treasury: it becomes the owner, which funds, ends and withdraws drops. RPC_URL picks
# the RPC (default: foundry.toml's "robinhood").
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

[ -n "${DROPS_SIGNER:-}" ] || { echo "Set DROPS_SIGNER to the voucher key's address." >&2; exit 1; }
STAMP=$(jq -r .stamp deployments/robinhood.json)
OFFICE=$(jq -r .office deployments/robinhood.json)
PAD=$(jq -r .pad deployments/robinhood-pad.json)
export STAMP OFFICE PAD DROPS_SIGNER

BROADCAST=0
for a in "$@"; do [ "$a" = "--broadcast" ] && BROADCAST=1; done

if [ "$BROADCAST" = 1 ]; then
  echo "TokenDrops on Robinhood Chain with:"
  echo "  STAMP=$STAMP"
  echo "  OFFICE=$OFFICE"
  echo "  PAD=$PAD"
  echo "  DROPS_SIGNER=$DROPS_SIGNER"
  read -r -p "Type DEPLOY to continue: " ok
  [ "$ok" = "DEPLOY" ] || { echo "Cancelled."; exit 1; }
  forge script script/DeployTokenDrops.s.sol --tc DeployTokenDrops --rpc-url "${RPC_URL:-robinhood}" "$@"
  ./script/export-web.sh
else
  forge script script/DeployTokenDrops.s.sol --tc DeployTokenDrops --fork-url "${RPC_URL:-robinhood}" "$@"
fi
