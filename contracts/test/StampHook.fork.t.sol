// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {StampHook} from "../src/StampHook.sol";
import {StampToken} from "../src/StampToken.sol";
import {StampEthRouter} from "../src/StampEthRouter.sol";
import {CourierNFT, ICourierRenderer} from "../src/CourierNFT.sol";
import {PostOffice} from "../src/PostOffice.sol";
import {CourierSVG} from "../src/CourierSVG.sol";
import {CourierRenderer, ICourierSeed} from "../src/CourierRenderer.sol";
import {DeployLib} from "../script/DeployLib.sol";
import {RobinhoodConfig, CourierDeployer} from "../script/DeployMainnet.s.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// IMD's own admin functions on Robinhood Chain (its owner is a single wallet).
interface IImdAdmin {
    function owner() external view returns (address);
    function setBlocked(address account, bool blocked) external;
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

    /// Final check 19b34b9b finding 3: IMD's owner can block an address; a blocked fee recipient moves its own
    /// fees to a new one, with the hook already renounced.
    function test_Fork_BlockedFeeRecipientMovesItsFees() public {
        if (block.chainid != 4663) return;
        hook.renounceOwnership();
        vm.prank(alice);
        ethRouter.buyWithEth{value: 0.01 ether}(address(stamp), 1, block.timestamp);
        IImdAdmin imd = IImdAdmin(RobinhoodConfig.IMD);
        vm.prank(imd.owner());
        imd.setBlocked(feeRecipient, true);
        vm.expectRevert();
        hook.collectProtocolFees(RobinhoodConfig.IMD);

        address next = makeAddr("next");
        vm.prank(feeRecipient);
        hook.setFeeRecipient(next);
        hook.collectProtocolFees(RobinhoodConfig.IMD);
        assertGt(IERC20(RobinhoodConfig.IMD).balanceOf(next), 0);
        assertEq(hook.pendingProtocolFees(RobinhoodConfig.IMD), 0);
    }
}

/// @notice The real launch stages (the deploy script's own functions) against the live PoolManager.
///   forge test --match-contract LaunchStagesForkTest --fork-url robinhood
/// Skipped when not forked.
contract LaunchStagesForkTest is Test, CourierDeployer {
    uint256 constant SECRET = 42;
    address treasury = makeAddr("treasury");
    address feeRecipient = makeAddr("feeRecipient");

    /// External, so a revert inside stage 2 can be expected.
    function stageTwo(Couriers memory c) external returns (Game memory) {
        return _deployGame(address(this), feeRecipient, treasury, 3_000e18, 2_100_000e18, 0.005 ether, 1_100, c);
    }

    /// Re-check ca28d248 finding 2: stage 2 links, freezes and renounces the renderer the NFT actually uses.
    function test_Fork_StageTwoRenouncesTheRendererTheNftUses() public {
        if (block.chainid != 4663) return;
        Couriers memory c = _deployCouriers(address(this), treasury, 0.003 ether, keccak256(abi.encode(SECRET)));
        CourierNFT nft = CourierNFT(c.nft);
        nft.reveal(SECRET);

        // The renderer is swapped between the stages; stage 2 refuses the stale address.
        CourierRenderer swapped = new CourierRenderer(ICourierSeed(c.nft), new CourierSVG(), address(this));
        nft.setRenderer(ICourierRenderer(address(swapped)));
        vm.expectRevert(bytes("the NFT uses a different renderer"));
        this.stageTwo(c);

        c.renderer = address(nft.renderer());
        Game memory g = this.stageTwo(c);
        assertEq(PostOffice(g.office).treasury(), nft.treasury());
        assertEq(swapped.owner(), address(0));
        assertEq(address(swapped.office()), g.office);
        assertTrue(nft.rendererFrozen());
        assertEq(nft.owner(), address(0));
        assertEq(StampToken(g.stamp).owner(), address(0));
        assertEq(StampHook(g.hook).owner(), address(0));
        assertEq(nft.game(), g.office);
    }

    /// Final check 19b34b9b finding 4: one treasury for the whole game; stage 2 refuses a different one.
    function test_Fork_StageTwoRefusesADifferentTreasury() public {
        if (block.chainid != 4663) return;
        Couriers memory c = _deployCouriers(address(this), makeAddr("elsewhere"), 0.003 ether, keccak256(abi.encode(SECRET)));
        CourierNFT(c.nft).reveal(SECRET);
        vm.expectRevert(bytes("the NFT's treasury differs from TREASURY"));
        this.stageTwo(c);
    }
}
