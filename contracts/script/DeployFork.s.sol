// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Script.sol";
import {StampHook} from "../src/StampHook.sol";
import {DeployMainnet} from "./DeployMainnet.s.sol";

/// @notice Dev only (`./dev.sh --fork`): the mainnet deployment on an Anvil fork of Robinhood Chain, with the real
///         PoolManager, IMD and IMD/ETH pool, so the trade panel can be tried without real money. Writes no files.
///   FEE_RECIPIENT=0x... TREASURY=0x... SEED_COMMIT=0x... \
///   forge script script/DeployFork.s.sol --sig "runFork()" --rpc-url <fork> --unlocked --sender <dev account> --broadcast
contract DeployFork is DeployMainnet {
    function runFork() external {
        uint256 startMcap = _usdToImd(vm.envOr("START_MCAP_USD", uint256(3_000)));
        vm.startBroadcast();
        Deployed memory d = _deploy(
            msg.sender,
            vm.envAddress("FEE_RECIPIENT"),
            vm.envAddress("TREASURY"),
            vm.envBytes32("SEED_COMMIT"),
            startMcap,
            vm.envOr("LAUNCH_STAMP", uint256(2_100_000e18))
        );
        vm.stopBroadcast();

        console.log("StampHook", d.hook);
        console.log("Router", StampHook(d.hook).router());
        console.log("EthRouter", StampHook(d.hook).ethRouter());
        console.log("StampToken", d.stamp);
        console.log("CourierNFT", d.nft);
        console.log("PostOffice", d.office);
        console.log("Renderer", d.renderer);
    }
}
