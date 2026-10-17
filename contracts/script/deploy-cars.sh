#!/usr/bin/env bash
# Deploy Courier Cars (cars bought with $STAMP, all of it to the treasury: the Courier Companions contract deployed
# again with its names changed), with the whole lineup on sale. Two transactions.
#
#   ./script/deploy-cars.sh                          # dry run against a fork
#   ./script/deploy-cars.sh --broadcast --browser --browser-disable-open   # deploy, signing in your browser wallet at
#                                                                           http://127.0.0.1:9545
#
# Sign with the treasury wallet: it becomes the owner (it sets prices and the lineup), and gets the 5% royalty.
# RPC_URL picks the RPC (default: foundry.toml's "robinhood").
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

set -a
source ./launch.env
set +a
STAMP=$(jq -r .stamp deployments/robinhood.json)
export STAMP
F=deployments/robinhood-cars.json
RPC=${RPC_URL:-robinhood}

BROADCAST=0
for a in "$@"; do [ "$a" = "--broadcast" ] && BROADCAST=1; done

if [ "$BROADCAST" = 1 ]; then
  if [ -f "$F" ] && [ "${FORCE:-}" != 1 ]; then
    echo "$F already exists (Courier Cars is deployed at $(jq -r .cars "$F")). Set FORCE=1 to deploy another." >&2
    exit 1
  fi
  echo "CourierCars on Robinhood Chain with:"
  echo "  STAMP=$STAMP"
  grep -E '^(TREASURY|CARS_[A-Z_]+)=' launch.env | sed 's/^/  /'
  read -r -p "Type DEPLOY to continue: " ok
  [ "$ok" = "DEPLOY" ] || { echo "Cancelled."; exit 1; }
  # (forge writes the deployment file even when sending fails: only a contract actually on chain counts.)
  rc=0
  forge script script/DeployCars.s.sol --rpc-url "$RPC" "$@" || rc=$?
  [ -f "$F" ] || { echo "No deployment file: the deploy didn't go through." >&2; exit 1; }
  # The address the chain actually gave it (the wallet may use another nonce than the simulation), and its block.
  # (No run file if forge stopped before sending anything: then the code check below still runs.)
  RUN=broadcast/DeployCars.s.sol/4663/run-latest.json
  TX=$({ [ -f "$RUN" ] && jq -r '[.transactions[] | select(.contractName == "CourierCars" and .transactionType == "CREATE")][0].hash // "null"' "$RUN"; } || echo null)
  if [ "$TX" != null ] && A=$(cast receipt "$TX" contractAddress --rpc-url "$RPC") && [ -n "$A" ]; then
    B=$(cast receipt "$TX" blockNumber --rpc-url "$RPC" || echo null)
    jq --arg a "$A" --argjson b "${B:-null}" '.cars = $a | .block = $b' "$F" > "$F.tmp" && mv "$F.tmp" "$F"
  else
    A=$(jq -r .cars "$F")
  fi
  code=$(cast code "$A" --rpc-url "$RPC") \
    || { echo "Can't reach the RPC to check $A: nothing exported. Check it on the explorer, then run ./script/export-web.sh." >&2; exit 1; }
  if [ "$code" = "0x" ]; then
    echo "No contract at $A: the deploy didn't go through. Nothing exported." >&2
    mv "$F" "$F.failed"
    exit 1
  fi
  echo "Courier Cars at $A"
  # The lineup is the second transaction, sent to the address forge expected: if the wallet used another nonce, or
  # that transaction didn't go through, the contract is there with nothing on sale. Not exported till it has.
  kinds=$(cast call "$A" "kindCount()(uint256)" --rpc-url "$RPC" 2>/dev/null || echo "?")
  if [ "$kinds" != 19 ]; then
    echo "It has $kinds kinds on sale, not 19: the lineup didn't reach it. Nothing exported. Put it on sale (signing with the owner, the treasury wallet), then export:" >&2
    echo "  forge script script/DeployCars.s.sol --sig \"lineupOn(address)\" $A --rpc-url $RPC --broadcast --browser --browser-disable-open" >&2
    echo "  ./script/export-web.sh" >&2
    exit 1
  fi
  ./script/export-web.sh
  exit "$rc"
else
  forge script script/DeployCars.s.sol --fork-url "$RPC" "$@"
fi
