// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TokenDrops} from "../src/TokenDrops.sol";

/// @notice Start a drop on the partner drops contract: approves the token and creates the drop, starting today (UTC).
///
///   ./script/deploy-partner-drops.sh drop --broadcast --browser --browser-disable-open
///
/// (Sign straight away: it starts the drop on the UTC day it was simulated, so signing after midnight reverts it.)
///
/// Env: DROPS2 (the partner drops contract), DROP_TOKEN, DROP_PER_COIN (whole tokens a coin), DROP_SPOTS (coins out a
/// day), DROP_MAX (coins a wallet is paid for a day), DROP_DAILY (coins paid a day, everyone together), DROP_DAYS,
/// DROP_AMOUNT (whole tokens to put in). Sign with the drops' owner (the treasury), which pays the tokens in.
contract CreatePartnerDrop is Script {
    function run() external returns (uint256 id) {
        TokenDrops drops = TokenDrops(vm.envAddress("DROPS2"));
        address token = vm.envAddress("DROP_TOKEN");
        uint256 perCoin = vm.envUint("DROP_PER_COIN") * 1e18;
        uint256 spots = vm.envUint("DROP_SPOTS");
        uint256 maxPerWallet = vm.envUint("DROP_MAX");
        uint256 daily = vm.envUint("DROP_DAILY");
        uint256 days_ = vm.envUint("DROP_DAYS");
        uint256 amount = vm.envUint("DROP_AMOUNT") * 1e18;
        require(maxPerWallet >= 1 && maxPerWallet <= spots, "DROP_MAX must be 1 to DROP_SPOTS");
        require(daily >= maxPerWallet && daily <= 10_000 && days_ >= 1 && days_ <= 365, "check DROP_DAILY and DROP_DAYS");
        require(amount >= perCoin * daily * days_, "DROP_AMOUNT doesn't cover every day's coins");
        uint32 today = drops.today();
        // (The game's block for the partner drops has 36 coins a day, shared by the drops running: web/drop-pick.js.)
        uint256 used;
        uint256[] memory running = drops.activeDrops(today);
        for (uint256 i; i < running.length; ++i) {
            TokenDrops.Drop memory d = drops.drop(running[i]);
            if (d.token != address(drops.stamp())) used += d.spots;
        }
        require(spots >= 1 && used + spots <= 36, "DROP_SPOTS must be 1 to the coins still free today (36 in all)");

        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        require(sender == drops.owner(), "sign with the drops' owner (the treasury)");
        require(IERC20(token).balanceOf(sender) >= amount, "the treasury doesn't hold DROP_AMOUNT of the token");
        if (IERC20(token).allowance(sender, address(drops)) < amount) IERC20(token).approve(address(drops), amount);
        id = drops.createDrop(token, perCoin, uint16(spots), uint16(maxPerWallet), daily, today, uint32(days_), amount);
        vm.stopBroadcast();
        console2.log("partner drop", id);
        console2.log("  in the game: drop", 1000 + id);
        console2.log("  days", today, today + days_ - 1);
    }
}
