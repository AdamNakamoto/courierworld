// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StampHunt, IPostOfficeOffices} from "../src/StampHunt.sol";

/// Deploys the golden stamp hunt next to a running game. Settings come from the environment:
///   STAMP, OFFICE      the game's token and post office
///   HUNT_SIGNER        the multiplayer server's voucher key (its address)
///   HUNT_OWNER         who can top up, withdraw and change the settings (default: the deployer)
///   HUNT_REWARD        $STAMP per golden stamp, in wei (default 10 $STAMP)
///   HUNT_MAX_PER_DAY   stamps paid per wallet per day (default 24)
///   HUNT_DAILY_LIMIT   $STAMP paid for one day's finds across everyone, in wei (default 10,000; 0 = none)
/// The pool starts empty: the owner deposits $STAMP into it afterwards.
contract DeployHunt is Script {
    function run() external returns (StampHunt hunt) {
        address stamp = vm.envAddress("STAMP");
        address office = vm.envAddress("OFFICE");
        address signer = vm.envAddress("HUNT_SIGNER");
        vm.startBroadcast();
        address owner = vm.envOr("HUNT_OWNER", msg.sender);
        hunt = new StampHunt(
            IERC20(stamp),
            IPostOfficeOffices(office),
            signer,
            owner,
            vm.envOr("HUNT_REWARD", uint256(10e18)),
            uint16(vm.envOr("HUNT_MAX_PER_DAY", uint256(24))),
            vm.envOr("HUNT_DAILY_LIMIT", uint256(10_000e18))
        );
        vm.stopBroadcast();
        console2.log("StampHunt", address(hunt));
        console2.log("HuntOwner", owner);
    }
}
