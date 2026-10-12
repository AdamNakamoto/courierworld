// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";

import {CourierPad, IPostOfficeOpen} from "../src/CourierPad.sol";
import {DeployLib} from "./DeployLib.sol";
import {RobinhoodConfig, IAggregatorV3} from "./DeployMainnet.s.sol";

/// @notice The in-game launchpad, at a mined CREATE2 address carrying its hook flags.
///
///   ./script/deploy-pad.sh --broadcast --browser --browser-disable-open
///
/// Env: STAMP and POST_OFFICE (the deployed game), FEE_RECIPIENT (the 4% trading fee, in IMD), TREASURY (the 5% of
/// every launch, for drops), PAD_STAMP_FEE ($STAMP burned per launch, 18 decimals), PAD_START_MCAP_USD (every
/// launch's starting market cap for its 1B supply, converted to IMD at deploy time; the owner can change it later).
/// The deployer becomes the owner.
contract DeployCourierPad is Script {
    function run() external returns (CourierPad pad) {
        address stamp = vm.envAddress("STAMP");
        address office = vm.envAddress("POST_OFFICE");
        address feeTo = vm.envAddress("FEE_RECIPIENT");
        address drops = vm.envOr("TREASURY", feeTo);
        uint256 stampFee = vm.envUint("PAD_STAMP_FEE");
        uint256 startMcap = _usdToImd(vm.envOr("PAD_START_MCAP_USD", uint256(5_000)));
        int24 startTick = DeployLib.startTickForMarketCap(startMcap, 1_000_000_000e18);
        require(stamp.code.length > 0 && office.code.length > 0, "STAMP and POST_OFFICE must be deployed contracts");

        bytes memory initCode = abi.encodePacked(
            type(CourierPad).creationCode,
            abi.encode(
                RobinhoodConfig.POOL_MANAGER,
                RobinhoodConfig.IMD,
                stamp,
                IPostOfficeOpen(office),
                msg.sender,
                feeTo,
                drops,
                stampFee,
                startTick,
                CourierPad.ImdEthPool(RobinhoodConfig.IMD_ETH_FEE, RobinhoodConfig.IMD_ETH_SPACING, address(0))
            )
        );
        (bytes32 salt, address expected) =
            DeployLib.mineSalt(CREATE2_FACTORY, RobinhoodConfig.HOOK_FLAGS, initCode, vm.envOr("SALT_START", uint256(0)));
        require(expected.code.length == 0, "already deployed at mined address");

        vm.startBroadcast();
        (bool ok,) = CREATE2_FACTORY.call(abi.encodePacked(salt, initCode));
        vm.stopBroadcast();
        require(ok && expected.code.length > 0, "pad deploy failed");
        pad = CourierPad(expected);

        console2.log("CourierPad", address(pad));
        console2.log("  Router", pad.router());
        console2.log("  EthRouter", pad.ethRouter());
        console2.log("  owner", pad.owner());
        console2.log("  fees to", pad.feeRecipient());
        console2.log("  5% drops to", pad.dropRecipient());
        console2.log("  $STAMP per launch", stampFee / 1e18);
        console2.log("  start market cap (IMD wei)", startMcap);

        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || block.chainid != 4663) return pad;
        string memory json = "pad";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "block", block.number);
        vm.serializeAddress(json, "router", pad.router());
        vm.serializeAddress(json, "ethRouter", pad.ethRouter());
        string memory out = vm.serializeAddress(json, "pad", address(pad));
        vm.writeJson(out, "./deployments/robinhood-pad.json");
    }

    /// @dev US dollars to IMD wei, through the IMD/ETH pool and Chainlink ETH/USD (as the game's deploy does).
    function _usdToImd(uint256 usd) internal view returns (uint256) {
        PoolKey memory imdEth = PoolKey(
            Currency.wrap(address(0)), Currency.wrap(RobinhoodConfig.IMD), RobinhoodConfig.IMD_ETH_FEE,
            RobinhoodConfig.IMD_ETH_SPACING, IHooks(address(0))
        );
        (uint160 sqrtP,,,) = StateLibrary.getSlot0(RobinhoodConfig.POOL_MANAGER, imdEth.toId());
        (, int256 ethUsd,, uint256 updatedAt,) = IAggregatorV3(RobinhoodConfig.ETH_USD).latestRoundData();
        require(ethUsd > 0 && block.timestamp - updatedAt < 1 days, "stale ETH/USD");
        uint256 imdPerEthX = FullMath.mulDiv(FullMath.mulDiv(usd * 1e26, sqrtP, 1 << 96), sqrtP, 1 << 96);
        return imdPerEthX / uint256(ethUsd);
    }
}
