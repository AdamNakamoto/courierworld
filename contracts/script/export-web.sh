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
                hook: $d.hook, router: $d.router, ethRouter: $d.ethRouter, imd: $d.imd},
    abis: {stamp: $stampAbi, nft: $nftAbi, office: $officeAbi, renderer: $rendererAbi,
           hook: $hookAbi, router: $routerAbi, ethRouter: $ethRouterAbi}
  }' > "$OUT"
echo "wrote web/deployments/robinhood.json"
