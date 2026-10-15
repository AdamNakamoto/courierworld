#!/usr/bin/env bash
# Deploy Courier Fish (fish caught in the bay, minted free from the multiplayer room's vouchers), with its 24 species.
#
#   FISH_SIGNER=0x… ./script/deploy-fish.sh                          # dry run against a fork
#   FISH_SIGNER=0x… ./script/deploy-fish.sh --broadcast --browser --browser-disable-open   # deploy, signing in your
#                                                                       browser wallet at http://127.0.0.1:9545
#
# Sign with the treasury wallet: it becomes the owner (it can pause, replace the server's key, add species and shrink
# caps) and gets the 5% royalty. FISH_SIGNER is the address of the room's FISH_KEY (set that key as a Worker secret
# first; the key itself never goes here). RPC_URL picks the RPC (default: foundry.toml's "robinhood").
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

set -a
source ./launch.env
set +a
POST_OFFICE=$(jq -r .office deployments/robinhood.json)
export POST_OFFICE
[ -n "${FISH_SIGNER:-}" ] || { echo "Set FISH_SIGNER to the address of the room's FISH_KEY." >&2; exit 1; }
export FISH_SIGNER

BROADCAST=0
for a in "$@"; do [ "$a" = "--broadcast" ] && BROADCAST=1; done

if [ "$BROADCAST" = 1 ]; then
  echo "CourierFish on Robinhood Chain with:"
  echo "  POST_OFFICE=$POST_OFFICE"
  echo "  FISH_SIGNER=$FISH_SIGNER"
  grep -E '^(TREASURY|FISH_[A-Z_]+)=' launch.env | sed 's/^/  /'
  read -r -p "Type DEPLOY to continue: " ok
  [ "$ok" = "DEPLOY" ] || { echo "Cancelled."; exit 1; }
  # (forge writes the deployment file even when sending fails, or exits with an error after sending: either way,
  #  only a contract actually on chain counts, so the check below runs whatever forge says.)
  rc=0
  forge script script/DeployFish.s.sol --rpc-url "${RPC_URL:-robinhood}" "$@" || rc=$?
  F=deployments/robinhood-fish.json
  [ -f "$F" ] || { echo "No deployment file: the deploy didn't go through." >&2; exit 1; }
  A=$(jq -r .fish "$F")
  code=$(cast code "$A" --rpc-url "${RPC_URL:-robinhood}") \
    || { echo "Can't reach the RPC to check $A: nothing exported. Check it on the explorer, then run ./script/export-web.sh." >&2; exit 1; }
  if [ "$code" = "0x" ]; then
    echo "No contract at $A: the deploy didn't go through. Nothing exported." >&2
    git checkout -- "$F" 2>/dev/null || rm -f "$F"
    exit 1
  fi
  # (A script's block.number on Robinhood Chain is the parent chain's: record the deploy's own block, where log
  #  scans for the fish start.)
  TX=$(jq -r '.transactions[0].hash' broadcast/DeployFish.s.sol/4663/run-latest.json)
  if B=$(cast receipt "$TX" blockNumber --rpc-url "${RPC_URL:-robinhood}"); then
    jq --argjson b "$B" '.block = $b' "$F" > "$F.tmp" && mv "$F.tmp" "$F"
  fi
  ./script/export-web.sh
  exit "$rc"
else
  forge script script/DeployFish.s.sol --fork-url "${RPC_URL:-robinhood}" "$@"
fi
