// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VmSafe} from "forge-std/Vm.sol";
import {CourierNFT} from "../src/CourierNFT.sol";
import {CourierDeployer} from "./DeployMainnet.s.sol";

/// @notice Stage 1 on Robinhood Chain: the Courier NFT and its on-chain art, ready to mint. The game
///         (DeployMainnet.s.sol) follows once the mint is over and the couriers are revealed.
///
///   ./script/deploy-mainnet.sh couriers --broadcast --interactive
///
/// Env: SEED_COMMIT (keccak256(abi.encode(secret)); keep the secret until the reveal), TREASURY (mint money and
/// royalties; default FEE_RECIPIENT), MINT_PRICE (0.003 ether), OPEN_SALE (false: open it later with setSaleOpen).
contract DeployCouriers is CourierDeployer {
    function run() external {
        address treasury = vm.envOr("TREASURY", vm.envAddress("FEE_RECIPIENT"));
        bytes32 commit = vm.envBytes32("SEED_COMMIT");

        vm.startBroadcast();
        Couriers memory c =
            _deployCouriers(msg.sender, treasury, vm.envOr("MINT_PRICE", uint256(0.003 ether)), commit);
        if (vm.envOr("OPEN_SALE", false)) CourierNFT(c.nft).setSaleOpen(true);
        vm.stopBroadcast();
        _log(c, Game(address(0), address(0), address(0)));

        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) return;
        string memory json = "couriers";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "nft", c.nft);
        vm.serializeAddress(json, "renderer", c.renderer);
        string memory out = vm.serializeAddress(json, "treasury", treasury);
        vm.writeJson(out, "./deployments/robinhood-couriers.json");
    }
}
