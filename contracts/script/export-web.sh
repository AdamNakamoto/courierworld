#!/usr/bin/env bash
# After DeployMainnet, write web/deployments/robinhood.json: the addresses the site
# needs, the chain's RPCs, and the contract ABIs. Commit it and Vercel serves it.
#   ./script/export-web.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

DEP=deployments/robinhood.json
OUT=../web/deployments/robinhood.json
[ -f "$DEP" ] || { echo "No $DEP yet: run DeployMainnet with --broadcast first." >&2; exit 1; }
forge build >/dev/null
mkdir -p "$(dirname "$OUT")"

abi() { jq '.abi' "out/$1.sol/$1.json"; }
jq -n \
  --slurpfile dep "$DEP" \
  --argjson stampAbi "$(abi StampToken)" \
  --argjson nftAbi "$(abi CourierNFT)" \
  --argjson officeAbi "$(abi PostOffice)" \
  --argjson rendererAbi "$(abi CourierRenderer)" \
  --argjson hookAbi "$(abi StampHook)" \
  --argjson routerAbi "$(abi StampRouter)" \
  --argjson ethRouterAbi "$(abi StampEthRouter)" \
  '$dep[0] as $d | {
    local: false,
    chainId: 4663,
    chainName: "Robinhood Chain",
    rpcUrl: "https://robinhood-rpc.publicnode.com",
    walletRpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    contracts: {stamp: $d.stamp, nft: $d.nft, office: $d.office, renderer: $d.renderer,
                hook: $d.hook, router: $d.router, ethRouter: $d.ethRouter, imd: $d.imd,
                poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
                quoter: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
                ethUsd: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9",
                multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"},
    abis: {stamp: $stampAbi, nft: $nftAbi, office: $officeAbi, renderer: $rendererAbi,
           hook: $hookAbi, router: $routerAbi, ethRouter: $ethRouterAbi}
  }' > "$OUT"
echo "wrote web/deployments/robinhood.json"
