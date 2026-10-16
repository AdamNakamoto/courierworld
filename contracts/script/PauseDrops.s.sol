// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {TokenDrops} from "../src/TokenDrops.sol";

/// @notice Pause (or resume) claims on the treasure hunt's drops contracts, without the site: if the room's voucher key
///         leaked, say. While paused, nothing can be claimed and the owner can withdraw any drop.
///
///   ./script/pause-drops.sh on  --broadcast --browser --browser-disable-open   # pause both
///   ./script/pause-drops.sh off --broadcast --browser --browser-disable-open   # resume both
///
/// Env: DROPS (comma separated: the contracts), DROPS_PAUSE (true to pause, false to resume). Sign with their owner
/// (the treasury). A contract already in that state is skipped.
contract PauseDrops is Script {
    function run() external {
        address[] memory list = vm.envAddress("DROPS", ",");
        bool on = vm.envBool("DROPS_PAUSE");
        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        for (uint256 i; i < list.length; ++i) {
            TokenDrops d = TokenDrops(list[i]);
            require(d.owner() == sender, "sign with the drops' owner (the treasury)");
            if (d.paused() == on) {
                console2.log(on ? "already paused" : "already running", list[i]);
                continue;
            }
            d.setPaused(on);
            console2.log(on ? "paused" : "resumed", list[i]);
        }
        vm.stopBroadcast();
    }
}
