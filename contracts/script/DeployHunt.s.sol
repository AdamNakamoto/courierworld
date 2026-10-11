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
        uint256 reward = vm.envOr("HUNT_REWARD", uint256(10e18));
        uint256 maxPerDay = vm.envOr("HUNT_MAX_PER_DAY", uint256(24));
        uint256 dailyLimit = vm.envOr("HUNT_DAILY_LIMIT", uint256(10_000e18));
        // The token and post office are immutable in the hunt: check they're the game's real pair.
        require(office.code.length > 0, "OFFICE has no code");
        require(IGameOffice(office).stamp() == stamp, "OFFICE is not STAMP's post office");
        require(maxPerDay > 0 && maxPerDay <= type(uint16).max, "HUNT_MAX_PER_DAY must be 1 to 65535");

        vm.startBroadcast();
        address owner = vm.envOr("HUNT_OWNER", msg.sender);
        hunt = new StampHunt(IERC20(stamp), IPostOfficeOffices(office), signer, owner, reward, uint16(maxPerDay), dailyLimit);
        vm.stopBroadcast();
        console2.log("StampHunt", address(hunt));
        console2.log("HuntOwner", owner);
        console2.log("Stamp", stamp);
        console2.log("Office", office);
        console2.log("Signer", signer);
        console2.log("RewardPerStamp", reward);
        console2.log("MaxStampsPerDay", maxPerDay);
        console2.log("DailyLimit", dailyLimit);
    }
}

interface IGameOffice {
    function stamp() external view returns (address);
}
