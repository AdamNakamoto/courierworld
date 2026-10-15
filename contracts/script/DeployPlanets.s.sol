// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {CourierPlanets} from "../src/CourierPlanets.sol";
import {DevTransferValidator} from "./DevTransferValidator.sol";

/// @notice Courier Planets: 333 planets bought with $STAMP (all of it to the treasury), each a world of its own in the
///         game, that its owner can open to visitors for a ticket.
///
///   ./script/deploy-planets.sh --broadcast --browser --browser-disable-open
///
/// Env: STAMP (the deployed token), TREASURY (where the $STAMP goes, and the 5% royalty), PLANETS_PRICE (whole $STAMP a
/// planet, 10,000 by default), PLANETS_VALIDATOR (the transfer validator that enforces the royalty: OpenSea's creator
/// fee enforcement registry), PLANETS_BASE (where the metadata lives: base + number + ".json"), PLANETS_OPEN (true to
/// open the sale at once; false by default, so the game and the metadata can go up first). On a bare local chain
/// (./dev.sh without --fork) there's no registry, so it deploys DevTransferValidator instead.
contract DeployPlanets is Script {
    /// OpenSea's StrictAuthorizedTransferSecurityRegistry, the validator its creator fee enforcement uses.
    address constant OPENSEA_REGISTRY = 0xA000027A9B2802E1ddf7000061001e5c005A0000;

    function run() external returns (CourierPlanets planets) {
        address stamp = vm.envAddress("STAMP");
        address treasury = vm.envAddress("TREASURY");
        uint256 price = vm.envOr("PLANETS_PRICE", uint256(10_000)) * 1e18;
        address validator = vm.envOr("PLANETS_VALIDATOR", OPENSEA_REGISTRY);
        string memory base = vm.envOr("PLANETS_BASE", string("https://courierworld.fun/planets/"));
        bool open = vm.envOr("PLANETS_OPEN", false);
        require(stamp.code.length > 0, "STAMP must be a deployed contract");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers(); // the wallet that signs: it owns the planets contract
        if (validator.code.length == 0 && block.chainid != 4663) validator = address(new DevTransferValidator());
        planets = new CourierPlanets(deployer, stamp, treasury, validator, price, base);
        if (open) planets.setSaleOpen(true);
        vm.stopBroadcast();
        console2.log("CourierPlanets", address(planets));
        console2.log("  price ($STAMP)", price / 1e18);
        console2.log("  sale open", open);
        console2.log("  transfer validator", validator);

        // (dev.sh sets DEV_CHAIN: an Anvil fork of Robinhood Chain has its chain ID too, and must not touch the real record.)
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || block.chainid != 4663 || vm.envOr("DEV_CHAIN", false)) return planets;
        string memory json = "planets";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "block", block.number);
        string memory out = vm.serializeAddress(json, "planets", address(planets));
        vm.writeJson(out, "./deployments/robinhood-planets.json");
    }
}
