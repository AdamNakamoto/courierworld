// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {CourierFish, IFishPostOffice} from "../src/CourierFish.sol";
import {DevTransferValidator} from "./DevTransferValidator.sol";

/// @notice Courier Fish: fish caught in the bay, minted from the game server's vouchers (free, gas only), with the
///         24 species of web/fish-kinds.js. Common and uncommon fish never run out; rare, epic and legendary ones have
///         a fixed total and a daily cap.
///
///   ./script/deploy-fish.sh --broadcast --browser --browser-disable-open
///
/// Env: POST_OFFICE (the live post office: only wallets with an office open can mint), FISH_SIGNER (the address of the
/// multiplayer room's FISH_KEY), TREASURY (the 5% royalty), FISH_VALIDATOR (OpenSea's creator fee enforcement
/// registry by default), FISH_PER_DAY (fish a wallet can mint for a day's catch, 10 by default), FISH_BASE (where the
/// metadata lives: base + id + ".json"). The wallet that signs owns the contract. On a bare local chain (./dev.sh
/// without --fork) there's no registry, so it deploys DevTransferValidator instead.
contract DeployFish is Script {
    /// OpenSea's StrictAuthorizedTransferSecurityRegistry, the validator its creator fee enforcement uses.
    address constant OPENSEA_REGISTRY = 0xA000027A9B2802E1ddf7000061001e5c005A0000;

    function run() external returns (CourierFish fish) {
        address postOffice = vm.envAddress("POST_OFFICE");
        address signer = vm.envAddress("FISH_SIGNER");
        address treasury = vm.envAddress("TREASURY");
        address validator = vm.envOr("FISH_VALIDATOR", OPENSEA_REGISTRY);
        uint256 perDay = vm.envOr("FISH_PER_DAY", uint256(10));
        string memory base = vm.envOr("FISH_BASE", string("https://courierworld.fun/fish/"));
        require(postOffice.code.length > 0, "POST_OFFICE must be a deployed contract");
        require(perDay > 0 && perDay <= 50, "FISH_PER_DAY must be 1 to 50");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers(); // the wallet that signs: it owns the fish contract
        if (validator.code.length == 0 && block.chainid != 4663) validator = address(new DevTransferValidator());
        fish = new CourierFish(deployer, IFishPostOffice(postOffice), signer, treasury, validator, uint32(perDay), base);
        // The lineup (web/fish-kinds.js): ids 1-8 common, 9-15 uncommon (never run out), 16-20 rare (500 each, 20 a
        // day), 21-23 epic (100 each, 5 a day), 24 legendary (21 ever, 1 a day).
        // (All in one transaction: two for the whole deploy.)
        uint256[] memory ids = new uint256[](24);
        uint256[] memory supplies = new uint256[](24);
        uint256[] memory daily = new uint256[](24);
        for (uint256 i; i < 24; ++i) {
            uint256 id = i + 1;
            ids[i] = id;
            (supplies[i], daily[i]) = id <= 15 ? (0, 0) : id <= 20 ? (500, 20) : id <= 23 ? (100, 5) : (21, 1);
        }
        fish.setSpeciesMany(ids, supplies, daily);
        vm.stopBroadcast();
        console2.log("CourierFish", address(fish));
        console2.log("  signer", signer);
        console2.log("  fish a wallet a day", perDay);
        console2.log("  transfer validator", validator);

        // (dev.sh sets DEV_CHAIN: an Anvil fork of Robinhood Chain has its chain ID too, and must not touch the real record.)
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || block.chainid != 4663 || vm.envOr("DEV_CHAIN", false)) return fish;
        string memory json = "fish";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "block", block.number);
        string memory out = vm.serializeAddress(json, "fish", address(fish));
        vm.writeJson(out, "./deployments/robinhood-fish.json");
    }
}
