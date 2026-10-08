#!/usr/bin/env bash
# Local dev: fresh Anvil chain, deploy the courier contracts, write chain.json, serve
# the game. Anvil's dev accounts are unlocked, so the page plays as any of them.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.foundry/bin:$PATH"

RPC_PORT="${RPC_PORT:-8600}"
WEB_PORT="${WEB_PORT:-5792}"
RPC="http://127.0.0.1:$RPC_PORT"

for port in "$RPC_PORT" "$WEB_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is busy; set RPC_PORT / WEB_PORT to free ports" >&2
    exit 1
  fi
done

anvil --silent --port "$RPC_PORT" --block-time 1 &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null' EXIT INT TERM
until cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; do sleep 0.2; done

ACCOUNTS=($(cast rpc eth_accounts --rpc-url "$RPC" | jq -r '.[]'))
# A throwaway reveal secret for this local chain only.
SECRET=$((RANDOM * 32768 + RANDOM))
COMMIT=$(cast keccak "$(cast abi-encode "f(uint256)" "$SECRET")")

echo "Deploying..."
OUT=$(cd contracts && TREASURY=${ACCOUNTS[1]} SEED_COMMIT=$COMMIT OPEN_SALE=true \
  forge script script/Deploy.s.sol --rpc-url "$RPC" --unlocked --sender "${ACCOUNTS[0]}" --broadcast 2>&1)
STAMP=$(echo "$OUT" | awk '/StampToken/ {print $2}')
NFT=$(echo "$OUT" | awk '/CourierNFT/ {print $2}')
OFFICE=$(echo "$OUT" | awk '/PostOffice/ {print $2}')
RENDERER=$(echo "$OUT" | awk '/Renderer/ {print $2}')
[ -n "$OFFICE" ] || { echo "$OUT"; exit 1; }

jq -n \
  --arg rpc "$RPC" --argjson chainId "$(cast chain-id --rpc-url "$RPC")" \
  --arg stamp "$STAMP" --arg nft "$NFT" --arg office "$OFFICE" --arg renderer "$RENDERER" --arg secret "$SECRET" \
  --slurpfile stampAbi <(jq '.abi' contracts/out/StampToken.sol/StampToken.json) \
  --slurpfile nftAbi <(jq '.abi' contracts/out/CourierNFT.sol/CourierNFT.json) \
  --slurpfile officeAbi <(jq '.abi' contracts/out/PostOffice.sol/PostOffice.json) \
  --slurpfile rendererAbi <(jq '.abi' contracts/out/CourierRenderer.sol/CourierRenderer.json) \
  '{
    local: true, chainId: $chainId, chainName: "Anvil", rpcUrl: $rpc, devSecret: $secret,
    contracts: {stamp: $stamp, nft: $nft, office: $office, renderer: $renderer},
    abis: {stamp: $stampAbi[0], nft: $nftAbi[0], office: $officeAbi[0], renderer: $rendererAbi[0]}
  }' > web/chain.json

echo "PostOffice $OFFICE"
echo "Chain      $RPC"
echo "Game       http://localhost:$WEB_PORT"
python3 -m http.server "$WEB_PORT" --bind 127.0.0.1 --directory web
