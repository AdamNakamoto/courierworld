// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {SkinsStampSale, ICourierSkinsMint} from "../src/SkinsStampSale.sol";

/// @notice The $STAMP sale for Courier Skins: buy skins with $STAMP, out of the same 999.
///
///   ./script/deploy-skins-stamp.sh --broadcast --browser
///
/// Env: SKINS and STAMP (the deployed contracts), TREASURY (where the $STAMP goes), SKINS_STAMP_PRICE ($STAMP per
/// skin, 18 decimals), SKINS_STAMP_FLOAT (ETH sent with the deploy to pay the skins' ETH price; it goes on to
/// the Courier Skins treasury as skins sell, and is topped up by sending ETH to the sale). Opens at once.
contract DeploySkinsStampSale is Script {
    function run() external returns (SkinsStampSale sale) {
        address skins = vm.envAddress("SKINS");
        address stamp = vm.envAddress("STAMP");
        address treasury = vm.envAddress("TREASURY");
        uint256 price = vm.envOr("SKINS_STAMP_PRICE", uint256(150e18));
        uint256 float_ = vm.envOr("SKINS_STAMP_FLOAT", uint256(0));
        require(skins.code.length > 0 && stamp.code.length > 0, "SKINS and STAMP must be deployed contracts");
        require(ICourierSkinsMint(skins).price() > 0, "SKINS isn't Courier Skins");

        vm.startBroadcast();
        sale = new SkinsStampSale(msg.sender, skins, stamp, treasury, price);
        sale.setOpen(true);
        if (float_ > 0) {
            (bool ok,) = address(sale).call{value: float_}("");
            require(ok, "float");
        }
        vm.stopBroadcast();
        console2.log("SkinsStampSale", address(sale));
        console2.log("  $STAMP per skin", price / 1e18);
        console2.log("  float (wei)", float_);

        // (dev.sh sets DEV_CHAIN: an Anvil fork of Robinhood Chain has its chain ID too, and must not touch the real record.)
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || block.chainid != 4663 || vm.envOr("DEV_CHAIN", false)) return sale;
        string memory json = "sale";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "block", block.number);
        vm.serializeUint(json, "stampPrice", price);
        string memory out = vm.serializeAddress(json, "sale", address(sale));
        vm.writeJson(out, "./deployments/robinhood-skins-stamp.json");
    }
}
