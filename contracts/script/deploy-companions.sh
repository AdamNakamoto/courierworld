#!/usr/bin/env bash
# Deploy Courier Companions (companions bought with $STAMP, all of it to the treasury), with the first lineup on sale.
#
#   ./script/deploy-companions.sh                          # dry run against a fork
#   ./script/deploy-companions.sh --broadcast --browser    # deploy, signing in your browser wallet
#
# Sign with the treasury wallet: it becomes the owner (it sets prices and the lineup), and gets the 5% royalty.
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
  echo "CourierCompanions on Robinhood Chain with:"
  echo "  STAMP=$STAMP"
  grep -E '^(TREASURY|COMPANIONS_[A-Z_]+)=' launch.env | sed 's/^/  /'
  read -r -p "Type DEPLOY to continue: " ok
  [ "$ok" = "DEPLOY" ] || { echo "Cancelled."; exit 1; }
  forge script script/DeployCompanions.s.sol --rpc-url robinhood "$@"
  ./script/export-web.sh
else
  forge script script/DeployCompanions.s.sol --fork-url robinhood "$@"
fi
