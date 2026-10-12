#!/usr/bin/env bash
# Deploy the in-game launchpad (CourierPad), with the settings in launch.env.
#
#   ./script/deploy-pad.sh --sender 0x…                                     # dry run against a fork
#   ./script/deploy-pad.sh --broadcast --browser --browser-disable-open     # deploy, signing in your browser wallet
#
# Sign with the wallet that should own the launchpad (it can change the $STAMP fee and the start price).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

set -a
source ./launch.env
set +a
STAMP=$(jq -r .stamp deployments/robinhood.json)
POST_OFFICE=$(jq -r .office deployments/robinhood.json)
export STAMP POST_OFFICE

BROADCAST=0
for a in "$@"; do [ "$a" = "--broadcast" ] && BROADCAST=1; done

if [ "$BROADCAST" = 1 ]; then
  echo "CourierPad on Robinhood Chain with:"
  echo "  STAMP=$STAMP"
  echo "  POST_OFFICE=$POST_OFFICE"
  grep -E '^(FEE_RECIPIENT|TREASURY|PAD_[A-Z_]+)=' launch.env | sed 's/^/  /'
  read -r -p "Type DEPLOY to continue: " ok
  [ "$ok" = "DEPLOY" ] || { echo "Cancelled."; exit 1; }
  forge script script/DeployCourierPad.s.sol --rpc-url robinhood "$@"
  ./script/export-web.sh
else
  forge script script/DeployCourierPad.s.sol --fork-url robinhood "$@"
fi
