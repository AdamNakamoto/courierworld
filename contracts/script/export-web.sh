#!/usr/bin/env bash
# Write web/deployments/robinhood.json: the addresses the site needs, the chain's RPCs, and
# the contract ABIs. Commit it and Vercel serves it. After stage 1 (couriers) it holds the NFT
# only, so the site shows the mint; after stage 2 (game) it holds everything.
#   ./script/export-web.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

GAME=deployments/robinhood.json
COURIERS=deployments/robinhood-couriers.json
OUT=../web/deployments/robinhood.json
[ -f "$GAME" ] || [ -f "$COURIERS" ] || { echo "Nothing deployed yet: run deploy-mainnet.sh couriers --broadcast first." >&2; exit 1; }
forge build >/dev/null
mkdir -p "$(dirname "$OUT")"

abi() { jq '.abi' "out/$1.sol/$1.json"; }
CHAIN='{
  local: false,
  chainId: 4663,
  chainName: "Robinhood Chain",
  rpcUrl: "https://robinhood-rpc.publicnode.com",
  walletRpcUrl: "https://robinhood-rpc.publicnode.com",
  logsRpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  logsRelays: ["/api/logs", "https://courier-world-mp.courier-world-mp.workers.dev/logs"],
  explorer: "https://robinhoodchain.blockscout.com"
}'

if [ -f "$GAME" ]; then
  jq -n \
    --slurpfile dep "$GAME" \
    --argjson stampAbi "$(abi StampToken)" \
    --argjson nftAbi "$(abi CourierNFT)" \
    --argjson officeAbi "$(abi PostOffice)" \
    --argjson rendererAbi "$(abi CourierRenderer)" \
    --argjson hookAbi "$(abi StampHook)" \
    --argjson routerAbi "$(abi StampRouter)" \
    --argjson ethRouterAbi "$(abi StampEthRouter)" \
    "\$dep[0] as \$d | $CHAIN + {
      stage: \"game\",
      officeBlock: (\$d.officeBlock // null),
      contracts: {stamp: \$d.stamp, nft: \$d.nft, office: \$d.office, renderer: \$d.renderer,
                  hook: \$d.hook, router: \$d.router, ethRouter: \$d.ethRouter, imd: \$d.imd,
                  poolManager: \"0x8366a39CC670B4001A1121B8F6A443A643e40951\",
                  quoter: \"0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94\",
                  ethUsd: \"0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9\",
                  multicall3: \"0xcA11bde05977b3631167028862bE2a173976CA11\"},
      abis: {stamp: \$stampAbi, nft: \$nftAbi, office: \$officeAbi, renderer: \$rendererAbi,
             hook: \$hookAbi, router: \$routerAbi, ethRouter: \$ethRouterAbi}
    }" > "$OUT"
  # The treasure hunt's payouts, once deployed (script/deploy-drops.sh writes deployments/robinhood-drops.json).
  DROPS=deployments/robinhood-drops.json
  if [ -f "$DROPS" ]; then
    tmp=$(mktemp)
    jq --slurpfile d "$DROPS" --argjson dropsAbi "$(abi TokenDrops)" '.contracts.drops = $d[0].drops | .abis.drops = $dropsAbi' "$OUT" > "$tmp" && mv "$tmp" "$OUT"
  fi
  # Courier Skins, once deployed (script/deploy-skins.sh writes deployments/robinhood-skins.json).
  SKINS=deployments/robinhood-skins.json
  if [ -f "$SKINS" ]; then
    tmp=$(mktemp)
    jq --slurpfile s "$SKINS" --argjson skinsAbi "$(abi CourierSkins)" \
      '.contracts.skins = $s[0].skins | .skinsBlock = $s[0].block | .abis.skins = $skinsAbi' "$OUT" > "$tmp" && mv "$tmp" "$OUT"
  fi
  # The $STAMP sale for skins, once deployed (script/deploy-skins-stamp.sh writes deployments/robinhood-skins-stamp.json).
  SALE=deployments/robinhood-skins-stamp.json
  if [ -f "$SALE" ]; then
    tmp=$(mktemp)
    jq --slurpfile s "$SALE" --argjson saleAbi "$(abi SkinsStampSale)" \
      '.contracts.skinsStamp = $s[0].sale | .abis.skinsStamp = $saleAbi' "$OUT" > "$tmp" && mv "$tmp" "$OUT"
  fi
  # The launchpad, once deployed (script/deploy-pad.sh writes deployments/robinhood-pad.json).
  PAD=deployments/robinhood-pad.json
  if [ -f "$PAD" ]; then
    tmp=$(mktemp)
    jq --slurpfile p "$PAD" --argjson padAbi "$(abi CourierPad)" --argjson padTokenAbi "$(abi PadToken)" \
      '.contracts.pad = $p[0].pad | .contracts.padRouter = $p[0].router | .contracts.padEthRouter = $p[0].ethRouter
       | .padBlock = $p[0].block | .abis.pad = $padAbi | .abis.padToken = $padTokenAbi' "$OUT" > "$tmp" && mv "$tmp" "$OUT"
  fi
  # MOON (deployed by the IMD swarm; deployments/robinhood-moon.json): the game's play-to-earn currency, its reward
  # pool, its shop, and the multiplayer server's voucher-signing address. chain.js carries the few ABI lines it needs.
  MOON=deployments/robinhood-moon.json
  if [ -f "$MOON" ]; then
    tmp=$(mktemp)
    jq --slurpfile m "$MOON" '.contracts.moon = $m[0].moon | .contracts.moonRewards = $m[0].rewards | .contracts.moonShop = $m[0].shop
       | .moonSigner = $m[0].signer' "$OUT" > "$tmp" && mv "$tmp" "$OUT"
  fi
  echo "wrote web/deployments/robinhood.json (stage: game)"
else
  jq -n \
    --slurpfile dep "$COURIERS" \
    --argjson nftAbi "$(abi CourierNFT)" \
    --argjson rendererAbi "$(abi CourierRenderer)" \
    "\$dep[0] as \$d | $CHAIN + {
      stage: \"couriers\",
      contracts: {nft: \$d.nft, renderer: \$d.renderer, multicall3: \"0xcA11bde05977b3631167028862bE2a173976CA11\"},
      abis: {nft: \$nftAbi, renderer: \$rendererAbi}
    }" > "$OUT"
  echo "wrote web/deployments/robinhood.json (stage: couriers)"
fi
