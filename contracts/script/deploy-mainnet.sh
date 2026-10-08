#!/usr/bin/env bash
# Deploy Courier to Robinhood Chain with the settings in launch.env.
#
#   ./script/deploy-mainnet.sh                         # dry run against a fork (no transactions)
#   ./script/deploy-mainnet.sh --broadcast --interactive   # real deploy; prompts for the deployer's private key
#   ./script/deploy-mainnet.sh --broadcast --account <keystore name>
#
# The reveal secret: pass your own as SECRET=..., or one is generated. It is printed once and
# never written to disk. Store it in a password manager: you need it to reveal the collection
# after the mint (CourierNFT.reveal(secret)), and nobody can reveal without it.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

set -a
source ./launch.env
set +a

if [ -z "${SECRET:-}" ]; then
  SECRET=$(cast to-dec "0x$(openssl rand -hex 32)")
  GENERATED=1
fi
export SEED_COMMIT=$(cast keccak "$(cast abi-encode "f(uint256)" "$SECRET")")

BROADCAST=0
for a in "$@"; do [ "$a" = "--broadcast" ] && BROADCAST=1; done

if [ "$BROADCAST" = 1 ]; then
  echo "Deploying to Robinhood Chain with:"
  grep -E '^[A-Z_]+=' launch.env | sed 's/^/  /'
  echo "  SEED_COMMIT=$SEED_COMMIT"
  read -r -p "Type DEPLOY to continue: " ok
  [ "$ok" = "DEPLOY" ] || { echo "Cancelled."; exit 1; }
  forge script script/DeployMainnet.s.sol --rpc-url robinhood "$@"
  ./script/export-web.sh
else
  forge script script/DeployMainnet.s.sol --fork-url robinhood "$@"
fi

if [ "${GENERATED:-0}" = 1 ]; then
  echo
  echo "Reveal secret for this run (save it now; it is not stored anywhere):"
  echo "  $SECRET"
  [ "$BROADCAST" = 1 ] || echo "(dry run: this secret was not used on-chain)"
fi
