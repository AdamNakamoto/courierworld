#!/usr/bin/env bash
# Deploy the $STAMP sale for Courier Skins (SkinsStampSale), with the settings in launch.env.
#
#   ./script/deploy-skins-stamp.sh                          # dry run against a fork
#   ./script/deploy-skins-stamp.sh --broadcast --browser    # deploy, signing in your browser wallet
#
# Sign with the wallet that owns Courier Skins: it becomes the sale's owner, and the float it sends comes back
# to it (the Courier Skins treasury) as skins sell for $STAMP.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

set -a
source ./launch.env
set +a
SKINS=$(jq -r .skins deployments/robinhood-skins.json)
STAMP=$(jq -r .stamp deployments/robinhood.json)
export SKINS STAMP

BROADCAST=0
for a in "$@"; do [ "$a" = "--broadcast" ] && BROADCAST=1; done

if [ "$BROADCAST" = 1 ]; then
  echo "SkinsStampSale on Robinhood Chain with:"
  echo "  SKINS=$SKINS"
  echo "  STAMP=$STAMP"
  grep -E '^(TREASURY|SKINS_STAMP_[A-Z_]+)=' launch.env | sed 's/^/  /'
  read -r -p "Type DEPLOY to continue: " ok
  [ "$ok" = "DEPLOY" ] || { echo "Cancelled."; exit 1; }
  forge script script/DeploySkinsStampSale.s.sol --rpc-url robinhood "$@"
  ./script/export-web.sh
else
  forge script script/DeploySkinsStampSale.s.sol --fork-url robinhood "$@"
fi
