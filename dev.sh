#!/usr/bin/env bash
# Local dev: fresh Anvil chain, deploy the courier contracts, write chain.json, serve
# the game. Anvil's dev accounts are unlocked, so the page plays as any of them.
#
#   ./dev.sh                   # empty chain, game contracts only (no $STAMP pool)
#   ./dev.sh --fork            # fork of Robinhood Chain: the full mainnet deployment against the real
#                              # PoolManager, IMD and IMD/ETH pool, so the trade panel works (no real money)
#   ./dev.sh --fork --wallet   # same, but you log in with your own browser wallet (MetaMask...) as on
#                              # mainnet. The chain gets its own ID, so nothing signed there works elsewhere.
#   ./dev.sh --fork --wallet --staged
#                              # the launch as it will happen: only the couriers at first, with the mint
#                              # open; press Enter in this terminal to reveal them and launch the game
#
# Without --staged, the dev accounts get some couriers each and the collection is revealed at once.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.foundry/bin:$PATH"

FORK=0 WALLET=0 STAGED=0
for a in "$@"; do
  case "$a" in
    --fork) FORK=1 ;;
    --wallet) WALLET=1 ;;
    --staged) STAGED=1 ;;
    *) echo "Unknown option $a (use --fork, --wallet, --staged)" >&2; exit 1 ;;
  esac
done
[ "$STAGED" = 1 ] && [ "$FORK" = 0 ] && { echo "--staged needs --fork" >&2; exit 1; }
FORK_URL="${FORK_URL:-https://robinhood.drpc.org}"
# Chain ID for --wallet: unused by any public chain and never Robinhood Chain's 4663, so a transaction
# or permit signed on the practice chain can't be replayed on a real one.
PRACTICE_CHAIN_ID="${PRACTICE_CHAIN_ID:-466399}"
RPC_PORT="${RPC_PORT:-8600}"
WEB_PORT="${WEB_PORT:-5792}"
RPC="http://127.0.0.1:$RPC_PORT"

for port in "$RPC_PORT" "$WEB_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is busy; set RPC_PORT / WEB_PORT to free ports" >&2
    exit 1
  fi
done

ANVIL_ARGS=(--silent --port "$RPC_PORT" --block-time 1)
[ "$FORK" = 1 ] && ANVIL_ARGS+=(--fork-url "$FORK_URL")
[ "$WALLET" = 1 ] && ANVIL_ARGS+=(--chain-id "$PRACTICE_CHAIN_ID")
anvil "${ANVIL_ARGS[@]}" &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null' EXIT INT TERM
until cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; do sleep 0.2; done

ACCOUNTS=($(cast rpc eth_accounts --rpc-url "$RPC" | jq -r '.[]'))
if [ "$FORK" = 1 ]; then
  # Anvil's dev keys are public, and on mainnet these accounts carry EIP-7702 delegations to sweeper
  # contracts that forward any ETH they receive. Clear them so the fork's dev accounts are plain wallets.
  for a in "${ACCOUNTS[@]}"; do cast rpc anvil_setCode "$a" 0x --rpc-url "$RPC" >/dev/null; done
fi
# The reveal mixes in the previous block's hash, so a fresh chain needs a block or two first.
cast rpc anvil_mine 2 --rpc-url "$RPC" >/dev/null
# A throwaway reveal secret for this local chain only. The dev players (accounts 2-9) get couriers.
export SECRET=$((RANDOM * 32768 + RANDOM))
export FEE_RECIPIENT=${ACCOUNTS[1]} TREASURY=${ACCOUNTS[1]}
export PLAYERS=$(IFS=,; echo "${ACCOUNTS[*]:2}")

deploy() { # <script> [--sig <fn>]: run a forge script as the deployer (account 0) and keep its output in OUT
  OUT=$(cd contracts && forge script "$@" --rpc-url "$RPC" --unlocked --sender "${ACCOUNTS[0]}" --broadcast 2>&1) \
    || { echo "$OUT"; exit 1; }
}
addr() { echo "$OUT" | awk -v k="$1" '$1 == k {print $2; exit}'; }
abi() { jq '.abi' "contracts/out/$1.sol/$1.json"; }

echo "Deploying..."
if [ "$STAGED" = 1 ]; then
  deploy script/DeployFork.s.sol --sig "runCouriers()"
elif [ "$FORK" = 1 ]; then
  deploy script/DeployFork.s.sol --sig "runAll()"
else
  deploy script/Deploy.s.sol
fi
NFT=$(addr CourierNFT)
RENDERER=$(addr Renderer)
[ -n "$NFT" ] || { echo "$OUT"; exit 1; }

NAME=Anvil
[ "$FORK" = 1 ] && NAME="Robinhood Chain (fork)"
if [ "$WALLET" = 1 ]; then
  NAME="Courier practice"
  [ "$FORK" = 1 ] && NAME="Courier practice (Robinhood fork)"
fi
CHAIN_ID=$(cast chain-id --rpc-url "$RPC")

write_chain_json() { # writes web/chain.json from the addresses in OUT (couriers only until the game exists)
  local contracts abis
  contracts=$(jq -n --arg nft "$NFT" --arg renderer "$RENDERER" '{nft: $nft, renderer: $renderer}')
  abis=$(jq -n --argjson nft "$(abi CourierNFT)" --argjson renderer "$(abi CourierRenderer)" '{nft: $nft, renderer: $renderer}')
  local office stage=couriers
  office=$(addr PostOffice)
  if [ -n "$office" ]; then
    stage=game
    contracts=$(echo "$contracts" | jq --arg stamp "$(addr StampToken)" --arg office "$office" '. + {stamp: $stamp, office: $office}')
    abis=$(echo "$abis" | jq --argjson stamp "$(abi StampToken)" --argjson office "$(abi PostOffice)" '. + {stamp: $stamp, office: $office}')
    if [ "$FORK" = 1 ]; then
      # Robinhood Chain addresses, as in contracts/script/export-web.sh.
      contracts=$(echo "$contracts" | jq --arg hook "$(addr StampHook)" --arg router "$(addr Router)" --arg ethRouter "$(addr EthRouter)" \
        '. + {hook: $hook, router: $router, ethRouter: $ethRouter,
              imd: "0x5F7Bb59365ce557C26dbcAa4EE9d39A4b95B7127", poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
              quoter: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94", ethUsd: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9"}')
      abis=$(echo "$abis" | jq --argjson hook "$(abi StampHook)" --argjson router "$(abi StampRouter)" --argjson ethRouter "$(abi StampEthRouter)" \
        '. + {hook: $hook, router: $router, ethRouter: $ethRouter}')
    fi
  fi
  [ "$FORK" = 1 ] && contracts=$(echo "$contracts" | jq '. + {multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"}')
  jq -n --arg rpc "$RPC" --argjson chainId "$CHAIN_ID" --arg name "$NAME" --arg secret "$SECRET" --arg stage "$stage" \
    --argjson wallet "$([ "$WALLET" = 1 ] && echo true || echo false)" --argjson contracts "$contracts" --argjson abis "$abis" \
    '{local: true, wallet: $wallet, stage: $stage, chainId: $chainId, chainName: $name, rpcUrl: $rpc, devSecret: $secret,
      contracts: $contracts, abis: $abis}' \
    > web/chain.json
}
write_chain_json

echo "CourierNFT $NFT"
echo "Chain      $RPC ($NAME, chain ID $CHAIN_ID)"
echo "Game       http://localhost:$WEB_PORT"
if [ "$WALLET" = 1 ]; then
  echo
  echo "Log in with your browser wallet; the page asks it to add \"$NAME\"."
  echo "In the post office panel, \"+10 play ETH\" funds your wallet, and the reveal and time skips act as the owner."
  echo "Transactions and signatures on this chain only work here, never on Robinhood Chain."
  echo "After restarting dev.sh, if MetaMask shows a nonce error: Settings > Advanced > Clear activity tab data."
  echo
fi
if [ "$STAGED" = 1 ]; then
  python3 -m http.server "$WEB_PORT" --bind 127.0.0.1 --directory web >/dev/null 2>&1 &
  WEB_PID=$!
  trap 'kill $ANVIL_PID $WEB_PID 2>/dev/null' EXIT INT TERM
  echo "Stage 1: only the couriers exist and the mint is open. Mint some in the game."
  read -r -p "Press Enter to reveal the couriers and launch the game... " _
  export NFT RENDERER
  deploy script/DeployFork.s.sol --sig "runGame()"
  write_chain_json
  echo "Stage 2: the game is live. Reload the page."
  wait "$WEB_PID"
else
  python3 -m http.server "$WEB_PORT" --bind 127.0.0.1 --directory web
fi
