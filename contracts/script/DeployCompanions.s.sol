// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {CourierCompanions} from "../src/CourierCompanions.sol";

/// @notice Courier Companions: companions that follow your courier, bought with $STAMP (all of it to the treasury),
///         and the first lineup on sale.
///
///   ./script/deploy-companions.sh --broadcast --browser
///
/// Env: STAMP (the deployed token), TREASURY (where the $STAMP goes, and the 5% royalty), COMPANIONS_BASE (where the
/// metadata lives: base + id + ".json").
contract DeployCompanions is Script {
    struct Lineup {
        uint256 id;
        uint256 price; // whole $STAMP
        uint256 supply;
        uint256 perWallet; // 0: no limit
    }

    /// The first lineup: pets (1-3), space buddies (11-13), legendaries (21-22), and the expensive originals: a
    /// mecha guardian and a colossus (31-32) and three anime-style companions (41-43). (The game's companions.js
    /// draws each id.)
    function lineup() internal pure returns (Lineup[13] memory l) {
        l[0] = Lineup(1, 100, 300, 0); // cat
        l[1] = Lineup(2, 100, 300, 0); // dog
        l[2] = Lineup(3, 100, 300, 0); // frog
        l[3] = Lineup(11, 250, 150, 0); // mini UFO
        l[4] = Lineup(12, 250, 150, 0); // robot drone
        l[5] = Lineup(13, 250, 150, 0); // little Martian
        l[6] = Lineup(21, 500, 50, 2); // golden stamp spirit
        l[7] = Lineup(22, 500, 50, 2); // mini rocket
        l[8] = Lineup(31, 2500, 30, 1); // mecha guardian
        l[9] = Lineup(32, 2500, 30, 1); // colossus
        l[10] = Lineup(41, 3000, 25, 1); // anime companion: Sakura
        l[11] = Lineup(42, 3000, 25, 1); // anime companion: Luna
        l[12] = Lineup(43, 3000, 25, 1); // anime companion: Hana
    }

    function run() external returns (CourierCompanions shop) {
        address stamp = vm.envAddress("STAMP");
        address treasury = vm.envAddress("TREASURY");
        string memory base = vm.envOr("COMPANIONS_BASE", string("https://courierworld.fun/companions/"));
        require(stamp.code.length > 0, "STAMP must be a deployed contract");

        vm.startBroadcast();
        shop = new CourierCompanions(msg.sender, stamp, treasury, base);
        Lineup[13] memory l = lineup();
        for (uint256 i; i < l.length; ++i) shop.setKind(l[i].id, l[i].price * 1e18, l[i].supply, l[i].perWallet, true);
        vm.stopBroadcast();
        console2.log("CourierCompanions", address(shop));
        console2.log("  kinds on sale", l.length);

        // (dev.sh sets DEV_CHAIN: an Anvil fork of Robinhood Chain has its chain ID too, and must not touch the real record.)
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || block.chainid != 4663 || vm.envOr("DEV_CHAIN", false)) return shop;
        string memory json = "companions";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "block", block.number);
        string memory out = vm.serializeAddress(json, "companions", address(shop));
        vm.writeJson(out, "./deployments/robinhood-companions.json");
    }
}
