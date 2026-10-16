// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TokenDrops, IDropsPad, IDropsPostOffice} from "../src/TokenDrops.sol";
import {DropsTokenList} from "../src/DropsTokenList.sol";
import {NoLaunchpad} from "./DeployTokenDrops.s.sol";
import {DevPartnerToken} from "./DevPartnerToken.sol";

/// @notice The partner drops: a second TokenDrops, for tokens that aren't the Launchpad's (such as $MINE), next to the
///         first. It asks a DropsTokenList (the Launchpad's tokens, plus the ones the treasury approves) which tokens
///         it can drop. The game and the room number its drops from 1000 and give them their own block of spots
///         (web/drop-pick.js), so neither contract's coins move the other's.
///
///   ./script/deploy-partner-drops.sh --broadcast --browser --browser-disable-open
///
/// Env: STAMP and OFFICE (the game), PAD (the launchpad; a stub that launched nothing on a local chain without one),
/// DROPS_SIGNER (the multiplayer server's voucher key, its address: the same key as the first drops contract's),
/// DROPS_OWNER (the treasury, which funds the drops and approves tokens; default the deployer), PARTNER_TOKENS (the
/// tokens to approve, comma separated; on a local chain without them, a stand-in token is made for the owner).
contract DeployPartnerDrops is Script {
    function run() external returns (TokenDrops drops, DropsTokenList list) {
        address stamp = vm.envAddress("STAMP");
        address office = vm.envAddress("OFFICE");
        address pad = vm.envOr("PAD", address(0));
        address signer = vm.envAddress("DROPS_SIGNER");
        address[] memory tokens = vm.envOr("PARTNER_TOKENS", ",", new address[](0));
        require(office.code.length > 0 && IGameOffice(office).stamp() == stamp, "OFFICE is not STAMP's post office");
        bool live = block.chainid == 4663 && !vm.envOr("DEV_CHAIN", false);
        require(!live || tokens.length > 0, "set PARTNER_TOKENS on Robinhood Chain");
        for (uint256 i; i < tokens.length; ++i) {
            require(tokens[i].code.length > 0 && tokens[i] != stamp, "PARTNER_TOKENS must be deployed tokens, not $STAMP");
        }

        require(!live || vm.envOr("DROPS_OWNER", address(0)) != address(0), "set DROPS_OWNER (the treasury) on Robinhood Chain");
        vm.startBroadcast();
        address owner = vm.envOr("DROPS_OWNER", msg.sender);
        if (tokens.length == 0) {
            tokens = new address[](1);
            tokens[0] = address(new DevPartnerToken(owner));
            console2.log("DevPartnerToken", tokens[0]);
        }
        if (pad == address(0)) {
            require(!live, "PAD is required on Robinhood Chain");
            pad = address(new NoLaunchpad());
        }
        list = new DropsTokenList(owner, IDropsPad(pad), tokens);
        drops = new TokenDrops(IERC20(stamp), IDropsPad(address(list)), IDropsPostOffice(office), signer, owner);
        vm.stopBroadcast();
        console2.log("TokenDrops (partner)", address(drops));
        console2.log("  token list", address(list));
        console2.log("  owner", owner);
        console2.log("  signer", signer);
        for (uint256 i; i < tokens.length; ++i) console2.log("  approved", tokens[i]);

        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || !live) return (drops, list);
        string memory json = "drops2";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "signer", signer);
        vm.serializeAddress(json, "list", address(list));
        vm.serializeAddress(json, "tokens", tokens);
        string memory out = vm.serializeAddress(json, "drops2", address(drops));
        vm.writeJson(out, "./deployments/robinhood-drops2.json");
    }
}

interface IGameOffice {
    function stamp() external view returns (address);
}
