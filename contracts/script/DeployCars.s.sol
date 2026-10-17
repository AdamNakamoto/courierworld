// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {CourierCars} from "../src/CourierCars.sol";
import {DevTransferValidator} from "./DevTransferValidator.sol";

/// @notice Courier Cars: cars a courier drives, bought with $STAMP (all of it to the treasury), and the first lineup on
///         sale (the Courier Companions contract, deployed again with its names changed: src/CourierCars.sol).
///
///   ./script/deploy-cars.sh --broadcast --browser --browser-disable-open
///
/// Env: STAMP (the deployed token), TREASURY (where the $STAMP goes, and the 5% royalty), CARS_VALIDATOR (the transfer
/// validator that enforces the royalty: OpenSea's creator fee enforcement registry), CARS_BASE (where the metadata
/// lives: base + id + ".json"). On a bare local chain (./dev.sh without --fork) there's no registry, so it deploys
/// DevTransferValidator instead.
contract DeployCars is Script {
    /// OpenSea's StrictAuthorizedTransferSecurityRegistry, the validator its creator fee enforcement uses.
    address constant OPENSEA_REGISTRY = 0xA000027A9B2802E1ddf7000061001e5c005A0000;

    struct Lineup {
        uint256 id;
        uint256 price; // whole $STAMP
        uint256 supply;
        uint256 perWallet; // per address (every kind has one, so a single buyer can't sweep a kind)
    }

    /// The first lineup (web/car-kinds.js: ids, names and tiers; TIER_TERMS: Common 500 $STAMP, 300 of each, 5 a
    /// wallet; Rare 1,500, 100, 3; Epic 4,000, 30, 2; Legendary 10,000, 10, 1). The game draws each id: web/cars.js.
    function lineup() public pure returns (Lineup[19] memory l) {
        l[0] = Lineup(1, 500, 300, 5); // Courier Van (Common)
        l[1] = Lineup(2, 500, 300, 5); // City Taxi (Common)
        l[2] = Lineup(3, 500, 300, 5); // Hatchback (Common)
        l[3] = Lineup(4, 500, 300, 5); // Pickup Truck (Common)
        l[4] = Lineup(5, 500, 300, 5); // Trail 4x4 (Common)
        l[5] = Lineup(6, 500, 300, 5); // Camper Van (Common)
        l[6] = Lineup(11, 1500, 100, 3); // Ice-Cream Truck (Rare)
        l[7] = Lineup(12, 1500, 100, 3); // Monster Truck (Rare)
        l[8] = Lineup(13, 1500, 100, 3); // Tuk-Tuk (Rare)
        l[9] = Lineup(14, 1500, 100, 3); // Double-Decker Bus (Rare)
        l[10] = Lineup(15, 1500, 100, 3); // Tractor (Rare)
        l[11] = Lineup(21, 4000, 30, 2); // Sports Car (Epic)
        l[12] = Lineup(22, 4000, 30, 2); // Convertible (Epic)
        l[13] = Lineup(23, 4000, 30, 2); // Race Car (Epic)
        l[14] = Lineup(24, 4000, 30, 2); // Muscle Car (Epic)
        l[15] = Lineup(31, 10000, 10, 1); // Hover Car (Legendary)
        l[16] = Lineup(32, 10000, 10, 1); // Golden Limo (Legendary)
        l[17] = Lineup(33, 10000, 10, 1); // Neon Cyber Car (Legendary)
        l[18] = Lineup(34, 10000, 10, 1); // Rocket Car (Legendary)
    }

    function run() external returns (CourierCars shop) {
        address stamp = vm.envAddress("STAMP");
        address treasury = vm.envAddress("TREASURY");
        address validator = vm.envOr("CARS_VALIDATOR", OPENSEA_REGISTRY);
        string memory base = vm.envOr("CARS_BASE", string("https://courierworld.fun/cars/"));
        require(stamp.code.length > 0, "STAMP must be a deployed contract");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers(); // the wallet that signs: it owns the shop and opens the lineup
        if (validator.code.length == 0 && block.chainid != 4663) validator = address(new DevTransferValidator());
        shop = new CourierCars(deployer, stamp, treasury, validator, base);
        uint256 n = putOnSale(shop); // (all in one transaction: two for the whole deploy)
        vm.stopBroadcast();
        console2.log("CourierCars", address(shop));
        console2.log("  kinds on sale", n);
        console2.log("  transfer validator", validator);

        // (dev.sh sets DEV_CHAIN: an Anvil fork of Robinhood Chain has its chain ID too, and must not touch the real record.)
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || block.chainid != 4663 || vm.envOr("DEV_CHAIN", false)) return shop;
        string memory json = "cars";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "block", block.number);
        string memory out = vm.serializeAddress(json, "cars", address(shop));
        vm.writeJson(out, "./deployments/robinhood-cars.json");
    }

    /// The lineup, open, in one setKinds call. Returns how many kinds.
    function putOnSale(CourierCars shop) internal returns (uint256) {
        Lineup[19] memory l = lineup();
        uint256[] memory ids = new uint256[](l.length);
        uint256[] memory prices = new uint256[](l.length);
        uint256[] memory supplies = new uint256[](l.length);
        uint256[] memory perWallets = new uint256[](l.length);
        for (uint256 i; i < l.length; ++i) (ids[i], prices[i], supplies[i], perWallets[i]) = (l[i].id, l[i].price * 1e18, l[i].supply, l[i].perWallet);
        shop.setKinds(ids, prices, supplies, perWallets, true);
        return l.length;
    }

    /// Only the lineup, for a Courier Cars contract already deployed (if the deploy's second transaction didn't reach
    /// it), signed by its owner: forge script script/DeployCars.s.sol --sig "lineupOn(address)" <cars> ...
    function lineupOn(CourierCars shop) external {
        require(address(shop).code.length > 0, "no contract there");
        vm.startBroadcast();
        uint256 n = putOnSale(shop);
        vm.stopBroadcast();
        console2.log("kinds on sale", n);
    }
}
