#!/usr/bin/env bash
# Deploy Courier to Robinhood Chain in two stages, with the settings in launch.env.
#
#   ./script/deploy-mainnet.sh rehearse                              # both stages on a fork, no transactions
#   ./script/deploy-mainnet.sh couriers                              # stage 1 dry run against a fork
#   ./script/deploy-mainnet.sh couriers --broadcast --interactive    # stage 1: the NFT, ready to mint
#   ./script/deploy-mainnet.sh game                                  # stage 2 dry run (after the reveal)
#   ./script/deploy-mainnet.sh game --broadcast --interactive        # stage 2: token, pool, post office; renounce all
#
# Signing: --browser opens a local page (http://127.0.0.1:9545) where you connect MetaMask or another browser wallet
# and approve each transaction in it, so no private key is typed anywhere. Or --account <keystore name> for a
# Foundry keystore, or --interactive to paste a key. Run both stages from the same wallet: stage 2 links the game to
# the NFT, which only the NFT's owner can do.
#
# The reveal secret (stage 1): pass your own as SECRET=..., or one is generated. It is printed once and never
# written to disk. Store it in a password manager: the collection can only be revealed with it
# (CourierNFT.reveal(secret)), and the game can only launch after the reveal.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

STAGE="${1:-}"
shift || true
case "$STAGE" in
  couriers | game | rehearse) ;;
  *) echo "Usage: $0 couriers|game|rehearse [--broadcast --browser | --account <name> | --interactive]" >&2; exit 1 ;;
esac

set -a
source ./launch.env
set +a

BROADCAST=0
for a in "$@"; do [ "$a" = "--broadcast" ] && BROADCAST=1; done
if [ "$BROADCAST" = 1 ] && [ "$STAGE" = rehearse ]; then echo "rehearse never broadcasts" >&2; exit 1; fi

if [ "$STAGE" != game ] && [ -z "${SECRET:-}" ]; then
  SECRET=$(cast to-dec "0x$(openssl rand -hex 32)")
  GENERATED=1
fi
[ -n "${SECRET:-}" ] && export SECRET SEED_COMMIT=$(cast keccak "$(cast abi-encode "f(uint256)" "$SECRET")")

case "$STAGE" in
  couriers) SCRIPT=(script/DeployCouriers.s.sol) ;;
  game) SCRIPT=(script/DeployMainnet.s.sol) ;;
  rehearse) SCRIPT=(script/DeployFork.s.sol --sig "runAll()") ;;
esac

if [ "$BROADCAST" = 1 ]; then
  echo "Stage \"$STAGE\" on Robinhood Chain with:"
  grep -E '^[A-Z_]+=' launch.env | sed 's/^/  /'
  [ "$STAGE" = couriers ] && echo "  SEED_COMMIT=$SEED_COMMIT"
  read -r -p "Type DEPLOY to continue: " ok
  [ "$ok" = "DEPLOY" ] || { echo "Cancelled."; exit 1; }
  forge script "${SCRIPT[@]}" --rpc-url robinhood "$@"
  ./script/export-web.sh
else
  forge script "${SCRIPT[@]}" --fork-url robinhood "$@"
fi

if [ "${GENERATED:-0}" = 1 ] && [ "$STAGE" = couriers ]; then
  echo
  echo "Reveal secret for this run (save it now; it is not stored anywhere):"
  echo "  $SECRET"
  [ "$BROADCAST" = 1 ] || echo "(dry run: this secret was not used on-chain)"
fi
