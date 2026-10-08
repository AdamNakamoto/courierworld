#!/usr/bin/env bash
# Local dev: fresh Anvil chain, deploy the courier contracts, write chain.json, serve
# the game. Anvil's dev accounts are unlocked, so the page plays as any of them.
#
#   ./dev.sh          # empty chain, game contracts only (no $STAMP pool)
#   ./dev.sh --fork   # fork of Robinhood Chain: the full mainnet deployment against the real
#                     # PoolManager, IMD and IMD/ETH pool, so the trade panel works (no real money)
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.foundry/bin:$PATH"

FORK=0
[ "${1:-}" = "--fork" ] && FORK=1
FORK_URL="${FORK_URL:-https://robinhood.drpc.org}"
RPC_PORT="${RPC_PORT:-8600}"
WEB_PORT="${WEB_PORT:-5792}"
RPC="http://127.0.0.1:$RPC_PORT"

for port in "$RPC_PORT" "$WEB_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is busy; set RPC_PORT / WEB_PORT to free ports" >&2
    exit 1
  fi
done

if [ "$FORK" = 1 ]; then
  anvil --silent --port "$RPC_PORT" --block-time 1 --fork-url "$FORK_URL" &
else
  anvil --silent --port "$RPC_PORT" --block-time 1 &
fi
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null' EXIT INT TERM
until cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; do sleep 0.2; done

ACCOUNTS=($(cast rpc eth_accounts --rpc-url "$RPC" | jq -r '.[]'))
if [ "$FORK" = 1 ]; then
  # Anvil's dev keys are public, and on mainnet these accounts carry EIP-7702 delegations to sweeper
  # contracts that forward any ETH they receive. Clear them so the fork's dev accounts are plain wallets.
  for a in "${ACCOUNTS[@]}"; do cast rpc anvil_setCode "$a" 0x --rpc-url "$RPC" >/dev/null; done
fi
# A throwaway reveal secret for this local chain only.
SECRET=$((RANDOM * 32768 + RANDOM))
COMMIT=$(cast keccak "$(cast abi-encode "f(uint256)" "$SECRET")")

echo "Deploying..."
if [ "$FORK" = 1 ]; then
  OUT=$(cd contracts && FEE_RECIPIENT=${ACCOUNTS[1]} TREASURY=${ACCOUNTS[1]} SEED_COMMIT=$COMMIT OPEN_SALE=true \
    forge script script/DeployFork.s.sol --sig "runFork()" --rpc-url "$RPC" --unlocked --sender "${ACCOUNTS[0]}" --broadcast 2>&1) \
    || { echo "$OUT"; exit 1; }
else
  OUT=$(cd contracts && TREASURY=${ACCOUNTS[1]} SEED_COMMIT=$COMMIT OPEN_SALE=true \
    forge script script/Deploy.s.sol --rpc-url "$RPC" --unlocked --sender "${ACCOUNTS[0]}" --broadcast 2>&1) \
    || { echo "$OUT"; exit 1; }
fi
addr() { echo "$OUT" | awk -v k="$1" '$1 == k {print $2; exit}'; }
OFFICE=$(addr PostOffice)
[ -n "$OFFICE" ] || { echo "$OUT"; exit 1; }

abi() { jq '.abi' "contracts/out/$1.sol/$1.json"; }
CONTRACTS=$(jq -n --arg stamp "$(addr StampToken)" --arg nft "$(addr CourierNFT)" --arg office "$OFFICE" \
  --arg renderer "$(addr Renderer)" '{stamp: $stamp, nft: $nft, office: $office, renderer: $renderer}')
ABIS=$(jq -n --argjson stamp "$(abi StampToken)" --argjson nft "$(abi CourierNFT)" --argjson office "$(abi PostOffice)" \
  --argjson renderer "$(abi CourierRenderer)" '{stamp: $stamp, nft: $nft, office: $office, renderer: $renderer}')
NAME=Anvil
if [ "$FORK" = 1 ]; then
  NAME="Robinhood Chain (fork)"
  # Robinhood Chain addresses, as in contracts/script/export-web.sh.
  CONTRACTS=$(echo "$CONTRACTS" | jq --arg hook "$(addr StampHook)" --arg router "$(addr Router)" --arg ethRouter "$(addr EthRouter)" \
    '. + {hook: $hook, router: $router, ethRouter: $ethRouter,
          imd: "0x5F7Bb59365ce557C26dbcAa4EE9d39A4b95B7127", poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
          quoter: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94", ethUsd: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9",
          multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"}')
  ABIS=$(echo "$ABIS" | jq --argjson hook "$(abi StampHook)" --argjson router "$(abi StampRouter)" --argjson ethRouter "$(abi StampEthRouter)" \
    '. + {hook: $hook, router: $router, ethRouter: $ethRouter}')
fi

jq -n --arg rpc "$RPC" --argjson chainId "$(cast chain-id --rpc-url "$RPC")" --arg name "$NAME" --arg secret "$SECRET" \
  --argjson contracts "$CONTRACTS" --argjson abis "$ABIS" \
  '{local: true, chainId: $chainId, chainName: $name, rpcUrl: $rpc, devSecret: $secret, contracts: $contracts, abis: $abis}' \
  > web/chain.json

echo "PostOffice $OFFICE"
echo "Chain      $RPC ($NAME)"
echo "Game       http://localhost:$WEB_PORT"
python3 -m http.server "$WEB_PORT" --bind 127.0.0.1 --directory web
