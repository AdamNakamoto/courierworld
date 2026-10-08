// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {StampHook} from "../src/StampHook.sol";
import {StampToken} from "../src/StampToken.sol";
import {StampEthRouter} from "../src/StampEthRouter.sol";
import {DeployLib} from "../script/DeployLib.sol";
import {RobinhoodConfig} from "../script/DeployMainnet.s.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @notice Runs the hook against the real Robinhood Chain PoolManager, IMD and IMD/ETH pool.
///   forge test --match-contract StampHookForkTest --fork-url robinhood
/// Skipped when not forked.
contract StampHookForkTest is Test {
    StampHook hook;
    StampToken stamp;
    StampEthRouter ethRouter;
    address feeRecipient = makeAddr("feeRecipient");
    address alice = makeAddr("alice");

    function setUp() public {
        if (block.chainid != 4663) return;
        bytes memory initCode = abi.encodePacked(
            type(StampHook).creationCode,
            abi.encode(
                RobinhoodConfig.POOL_MANAGER, RobinhoodConfig.IMD, address(this), feeRecipient,
                DeployLib.startTickForMarketCap(3_000e18, 21_000_000e18), uint256(2_100_000e18),
                StampHook.ImdEthPool(RobinhoodConfig.IMD_ETH_FEE, RobinhoodConfig.IMD_ETH_SPACING, address(0))
            )
        );
        (bytes32 salt, address expected) = DeployLib.mineSalt(address(this), RobinhoodConfig.HOOK_FLAGS, initCode, 0);
        address deployed;
        assembly {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        require(deployed == expected, "hook address");
        hook = StampHook(deployed);
        ethRouter = StampEthRouter(payable(hook.ethRouter()));
        stamp = new StampToken(address(this), address(hook), 2_100_000e18);
        hook.openPool(address(stamp));
        vm.deal(alice, 1 ether);
    }

    function test_Fork_BuyAndSellWithEthThroughRealPools() public {
        if (block.chainid != 4663) return;
        vm.startPrank(alice);
        uint256 got = ethRouter.buyWithEth{value: 0.01 ether}(address(stamp), 1, block.timestamp);
        assertGt(got, 0);
        uint256 fee = hook.pendingProtocolFees(RobinhoodConfig.IMD);
        assertGt(fee, 0);

        stamp.approve(address(ethRouter), type(uint256).max);
        uint256 ethOut = ethRouter.sellForEth(address(stamp), got / 2, 1, block.timestamp);
        vm.stopPrank();
        assertGt(ethOut, 0);
        assertGt(hook.pendingProtocolFees(RobinhoodConfig.IMD), fee);

        hook.collectProtocolFees(RobinhoodConfig.IMD);
        assertGt(IERC20(RobinhoodConfig.IMD).balanceOf(feeRecipient), 0);
    }
}
