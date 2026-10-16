#!/usr/bin/env bash
# The partner drops: a second TokenDrops for tokens that aren't the Launchpad's (such as $MINE), and its drops.
#
#   ./script/deploy-partner-drops.sh --sender 0x…                                       # dry run on a fork
#   ./script/deploy-partner-drops.sh --broadcast --browser --browser-disable-open       # deploy (2 transactions)
#   ./script/deploy-partner-drops.sh drop --broadcast --browser --browser-disable-open  # start the drop (2: approve,
#                                                                                         create), once the room and
#                                                                                         the site know the contract
#
# Sign with the treasury: it owns both contracts, approves tokens and funds the drops. The voucher key is the first
# drops contract's (deployments/robinhood-drops.json's signer): the room signs for both with DROPS_KEY.
# PARTNER_TOKENS (default $MINE) are the tokens approved at deploy. The drop's numbers are DROP_* (default: the $MINE
# drop: 500 a coin, 20 coins out, 5 a wallet, 33 a day, 30 days, 500,000 in). RPC_URL picks the RPC (default:
# foundry.toml's "robinhood").
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

MINE=0x1583948760169672C2AF7198026F1AEDE048657F
set -a
source ./launch.env
set +a
STEP=deploy
if [ "${1:-}" = "drop" ]; then STEP=drop; shift; fi
BROADCAST=0
for a in "$@"; do [ "$a" = "--broadcast" ] && BROADCAST=1; done
RPC=${RPC_URL:-robinhood}

if [ "$STEP" = deploy ]; then
  F=deployments/robinhood-drops2.json
  # (Once deployed, never again by accident: a second contract would take the site away from the first's drops.)
  if [ "$BROADCAST" = 1 ] && [ -f "$F" ] && [ "${FORCE:-}" != 1 ]; then
    echo "$F already exists (the partner drops are deployed at $(jq -r .drops2 "$F")). Set FORCE=1 to deploy another." >&2
    exit 1
  fi
  DROPS_OWNER=${DROPS_OWNER:-$TREASURY}
  DROPS_SIGNER=${DROPS_SIGNER:-$(jq -r .signer deployments/robinhood-drops.json)}
  STAMP=$(jq -r .stamp deployments/robinhood.json)
  OFFICE=$(jq -r .office deployments/robinhood.json)
  PAD=$(jq -r .pad deployments/robinhood-pad.json)
  PARTNER_TOKENS=${PARTNER_TOKENS:-$MINE}
  export STAMP OFFICE PAD DROPS_SIGNER DROPS_OWNER PARTNER_TOKENS
  if [ "$BROADCAST" = 1 ]; then
    # The first drops contract's own key and launchpad, as the chain has them (the same key signs for both).
    FIRST=$(jq -r .drops deployments/robinhood-drops.json)
    ON_SIGNER=$(cast call "$FIRST" 'signer()(address)' --rpc-url "$RPC") || { echo "Can't reach the RPC." >&2; exit 1; }
    ON_PAD=$(cast call "$FIRST" 'pad()(address)' --rpc-url "$RPC") || { echo "Can't reach the RPC." >&2; exit 1; }
    lc() { echo "$1" | tr '[:upper:]' '[:lower:]'; }
    [ "$(lc "$ON_SIGNER")" = "$(lc "$DROPS_SIGNER")" ] || { echo "DROPS_SIGNER $DROPS_SIGNER isn't the first contract's signer ($ON_SIGNER)." >&2; exit 1; }
    [ "$(lc "$ON_PAD")" = "$(lc "$PAD")" ] || { echo "PAD $PAD isn't the first contract's launchpad ($ON_PAD)." >&2; exit 1; }
    echo "Partner TokenDrops + DropsTokenList on Robinhood Chain with:"
    echo "  STAMP=$STAMP"
    echo "  OFFICE=$OFFICE"
    echo "  PAD=$PAD"
    echo "  DROPS_SIGNER=$DROPS_SIGNER"
    echo "  DROPS_OWNER=$DROPS_OWNER"
    echo "  PARTNER_TOKENS=$PARTNER_TOKENS"
    read -r -p "Type DEPLOY to continue: " ok
    [ "$ok" = "DEPLOY" ] || { echo "Cancelled."; exit 1; }
    # (forge writes the deployment file even when sending fails: only a contract actually on chain counts.)
    rc=0
    forge script script/DeployPartnerDrops.s.sol --tc DeployPartnerDrops --rpc-url "$RPC" "$@" || rc=$?
    [ -f "$F" ] || { echo "No deployment file: the deploy didn't go through." >&2; exit 1; }
    # The addresses the chain actually gave the two contracts (from their receipts: the wallet may have used another
    # nonce than the simulation), and the deploy's own block (a script's block.number is the parent chain's).
    RUN=broadcast/DeployPartnerDrops.s.sol/4663/run-latest.json
    addr_of() { # <contract name>: its creation's receipt address
      local tx
      tx=$(jq -r --arg n "$1" '[.transactions[] | select(.contractName == $n and .transactionType == "CREATE")][0].hash' "$RUN")
      [ -n "$tx" ] && [ "$tx" != null ] && cast receipt "$tx" contractAddress --rpc-url "$RPC"
    }
    if A=$(addr_of TokenDrops) && L=$(addr_of DropsTokenList) && [ -n "$A" ] && [ -n "$L" ]; then
      B=$(cast receipt "$(jq -r '[.transactions[] | select(.contractName == "TokenDrops")][0].hash' "$RUN")" blockNumber --rpc-url "$RPC" || echo null)
      jq --arg a "$A" --arg l "$L" --argjson b "${B:-null}" '.drops2 = $a | .list = $l | .block = $b' "$F" > "$F.tmp" && mv "$F.tmp" "$F"
    else
      A=$(jq -r .drops2 "$F")
    fi
    code=$(cast code "$A" --rpc-url "$RPC") \
      || { echo "Can't reach the RPC to check $A: nothing exported. Check it on the explorer, then run ./script/export-web.sh." >&2; exit 1; }
    if [ "$code" = "0x" ]; then
      echo "No contract at $A: the deploy didn't go through. Nothing exported (check the explorer for the treasury's last transactions)." >&2
      mv "$F" "$F.failed"
      exit 1
    fi
    echo "Partner drops at $A (token list $L)"
    ./script/export-web.sh
    exit "$rc"
  else
    forge script script/DeployPartnerDrops.s.sol --tc DeployPartnerDrops --fork-url "$RPC" "$@"
  fi
else
  DROPS2=${DROPS2:-$(jq -r .drops2 deployments/robinhood-drops2.json)}
  DROP_TOKEN=${DROP_TOKEN:-$MINE}
  DROP_PER_COIN=${DROP_PER_COIN:-500}
  DROP_SPOTS=${DROP_SPOTS:-20}
  DROP_MAX=${DROP_MAX:-5}
  DROP_DAILY=${DROP_DAILY:-33}
  DROP_DAYS=${DROP_DAYS:-30}
  DROP_AMOUNT=${DROP_AMOUNT:-500000}
  export DROPS2 DROP_TOKEN DROP_PER_COIN DROP_SPOTS DROP_MAX DROP_DAILY DROP_DAYS DROP_AMOUNT
  if [ "$BROADCAST" = 1 ]; then
    echo "A partner drop on $DROPS2, starting today (UTC):"
    echo "  token $DROP_TOKEN"
    echo "  $DROP_PER_COIN a coin · $DROP_SPOTS coins out a day · $DROP_MAX a wallet a day · $DROP_DAILY a day for everyone"
    echo "  $DROP_DAYS days · $DROP_AMOUNT put in"
    read -r -p "Type DROP to continue: " ok
    [ "$ok" = "DROP" ] || { echo "Cancelled."; exit 1; }
    forge script script/CreatePartnerDrop.s.sol --rpc-url "$RPC" "$@"
  else
    forge script script/CreatePartnerDrop.s.sol --fork-url "$RPC" "$@"
  fi
fi
