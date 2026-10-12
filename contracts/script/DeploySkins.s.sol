// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {CourierSkins} from "../src/CourierSkins.sol";
import {DevTransferValidator} from "./DevTransferValidator.sol";

/// @notice Courier Skins on Robinhood Chain: 999 blind-minted outfits and rides, with the 5% royalty enforced.
///
///   ./script/deploy-skins.sh --broadcast --browser
///
/// Env: SEED_COMMIT (keccak256(abi.encode(secret)); keep the secret until the reveal), TREASURY (mint money and
/// royalties), SKINS_PRICE (0.004 ether), SKINS_VALIDATOR (OpenSea's creator fee enforcement registry),
/// SKINS_IMAGES (where the pictures live), OPEN_SALE (false: open it later with setSaleOpen).
/// On a bare local chain (./dev.sh without --fork) there's no registry, so it deploys DevTransferValidator instead.
contract DeploySkins is Script {
    /// OpenSea's StrictAuthorizedTransferSecurityRegistry, the validator its creator fee enforcement uses.
    address constant OPENSEA_REGISTRY = 0xA000027A9B2802E1ddf7000061001e5c005A0000;

    function run() external returns (CourierSkins skins) {
        address treasury = vm.envAddress("TREASURY");
        bytes32 commit = vm.envBytes32("SEED_COMMIT");
        address validator = vm.envOr("SKINS_VALIDATOR", OPENSEA_REGISTRY);
        uint256 price = vm.envOr("SKINS_PRICE", uint256(0.004 ether));
        string memory images = vm.envOr("SKINS_IMAGES", string("https://courierworld.fun/skins/"));

        vm.startBroadcast();
        if (validator.code.length == 0 && block.chainid != 4663) validator = address(new DevTransferValidator());
        skins = new CourierSkins(msg.sender, treasury, price, commit, validator, images);
        if (vm.envOr("OPEN_SALE", false)) skins.setSaleOpen(true);
        vm.stopBroadcast();
        console2.log("CourierSkins", address(skins));
        console2.log("Validator", validator);

        // (dev.sh sets DEV_CHAIN: an Anvil fork of Robinhood Chain has its chain ID too, and must not touch the real record.)
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || block.chainid != 4663 || vm.envOr("DEV_CHAIN", false)) return skins;
        string memory json = "skins";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "block", block.number);
        vm.serializeAddress(json, "treasury", treasury);
        string memory out = vm.serializeAddress(json, "skins", address(skins));
        vm.writeJson(out, "./deployments/robinhood-skins.json");
    }
}

