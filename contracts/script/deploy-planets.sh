#!/usr/bin/env bash
# Deploy Courier Planets (333 planets bought with $STAMP, all of it to the treasury), with the sale closed (PLANETS_OPEN=true opens it).
#
#   ./script/deploy-planets.sh                          # dry run against a fork
#   ./script/deploy-planets.sh --broadcast --browser --browser-disable-open   # deploy, signing in your browser
#                                                         wallet at http://127.0.0.1:9545
#
# Sign with the treasury wallet: it becomes the owner (it sets the price and opens the sale), and gets the 5% royalty.
# RPC_URL picks the RPC (default: foundry.toml's "robinhood").
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

set -a
source ./launch.env
set +a
STAMP=$(jq -r .stamp deployments/robinhood.json)
export STAMP

BROADCAST=0
for a in "$@"; do [ "$a" = "--broadcast" ] && BROADCAST=1; done

if [ "$BROADCAST" = 1 ]; then
  echo "CourierPlanets on Robinhood Chain with:"
  echo "  STAMP=$STAMP"
  grep -E '^(TREASURY|PLANETS_[A-Z_]+)=' launch.env | sed 's/^/  /'
  read -r -p "Type DEPLOY to continue: " ok
  [ "$ok" = "DEPLOY" ] || { echo "Cancelled."; exit 1; }
  # (forge writes the deployment file even when sending fails, or exits with an error after sending: either way,
  #  only a contract actually on chain counts, so the check below runs whatever forge says.)
  rc=0
  forge script script/DeployPlanets.s.sol --rpc-url "${RPC_URL:-robinhood}" "$@" || rc=$?
  F=deployments/robinhood-planets.json
  [ -f "$F" ] || { echo "No deployment file: the deploy didn't go through." >&2; exit 1; }
  A=$(jq -r .planets "$F")
  code=$(cast code "$A" --rpc-url "${RPC_URL:-robinhood}") \
    || { echo "Can't reach the RPC to check $A: nothing exported. Check it on the explorer, then run ./script/export-web.sh." >&2; exit 1; }
  if [ "$code" = "0x" ]; then
    echo "No contract at $A: the deploy didn't go through. Nothing exported." >&2
    git checkout -- "$F" 2>/dev/null || rm -f "$F"
    exit 1
  fi
  # (A script's block.number on Robinhood Chain is the parent chain's: record the deploy's own block, where log
  #  scans for the planets start.)
  TX=$(jq -r '.transactions[0].hash' broadcast/DeployPlanets.s.sol/4663/run-latest.json)
  if B=$(cast receipt "$TX" blockNumber --rpc-url "${RPC_URL:-robinhood}"); then
    jq --argjson b "$B" '.block = $b' "$F" > "$F.tmp" && mv "$F.tmp" "$F"
  fi
  ./script/export-web.sh
  exit "$rc"
else
  forge script script/DeployPlanets.s.sol --fork-url "${RPC_URL:-robinhood}" "$@"
fi
