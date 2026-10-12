// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TokenDrops, IDropsPad, IDropsPostOffice} from "../src/TokenDrops.sol";

/// @dev Local chains without the launchpad: no token counts as launched, so only $STAMP drops can be made.
contract NoLaunchpad {
    function launches(address) external pure returns (address, address, uint64, uint64, bool) {}
}

/// @notice The treasure hunt's payouts: golden stamps ($STAMP) and token drops, next to a running game.
///
///   ./script/deploy-drops.sh --broadcast --browser --browser-disable-open
///
/// Env: STAMP and OFFICE (the game), PAD (the launchpad; a stub that launched nothing on a local chain without
/// one), DROPS_SIGNER (the multiplayer server's voucher key, its address), DROPS_OWNER (the treasury, which funds
/// the drops; default the deployer).
contract DeployTokenDrops is Script {
    function run() external returns (TokenDrops drops) {
        address stamp = vm.envAddress("STAMP");
        address office = vm.envAddress("OFFICE");
        address pad = vm.envOr("PAD", address(0));
        address signer = vm.envAddress("DROPS_SIGNER");
        require(office.code.length > 0 && IGameOffice(office).stamp() == stamp, "OFFICE is not STAMP's post office");

        // On Robinhood Chain the owner (the treasury, which funds the drops) must be named: no defaulting to the deployer.
        bool live = block.chainid == 4663 && !vm.envOr("DEV_CHAIN", false);
        require(!live || vm.envOr("DROPS_OWNER", address(0)) != address(0), "set DROPS_OWNER (the treasury) on Robinhood Chain");
        vm.startBroadcast();
        address owner = vm.envOr("DROPS_OWNER", msg.sender);
        if (pad == address(0)) {
            require(block.chainid != 4663 || vm.envOr("DEV_CHAIN", false), "PAD is required on Robinhood Chain");
            pad = address(new NoLaunchpad());
        }
        drops = new TokenDrops(IERC20(stamp), IDropsPad(pad), IDropsPostOffice(office), signer, owner);
        vm.stopBroadcast();
        console2.log("TokenDrops", address(drops));
        console2.log("  owner", owner);
        console2.log("  signer", signer);
        console2.log("  pad", pad);

        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || block.chainid != 4663 || vm.envOr("DEV_CHAIN", false)) {
            return drops;
        }
        string memory json = "drops";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "signer", signer);
        string memory out = vm.serializeAddress(json, "drops", address(drops));
        vm.writeJson(out, "./deployments/robinhood-drops.json");
    }
}

interface IGameOffice {
    function stamp() external view returns (address);
}
