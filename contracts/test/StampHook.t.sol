// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";

import {StampHook} from "../src/StampHook.sol";
import {StampRouter} from "../src/StampRouter.sol";
import {StampEthRouter} from "../src/StampEthRouter.sol";
import {StampToken} from "../src/StampToken.sol";
import {CourierNFT} from "../src/CourierNFT.sol";
import {PostOffice} from "../src/PostOffice.sol";
import {DeployLib} from "../script/DeployLib.sol";

contract MockIMD {
    string public name = "Identity.md";
    string public symbol = "IMD";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address s, uint256 amt) external returns (bool) {
        allowance[msg.sender][s] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function transferFrom(address f, address to, uint256 amt) external returns (bool) {
        if (allowance[f][msg.sender] != type(uint256).max) allowance[f][msg.sender] -= amt;
        balanceOf[f] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

contract StampHookTest is Test {
    PoolManager pm;
    MockIMD imd;
    StampHook hook;
    StampToken stamp;
    StampRouter router;
    StampEthRouter ethRouter;
    PoolSwapTest extRouter;
    PoolModifyLiquidityTest lp;

    address owner = makeAddr("owner");
    address feeRecipient = makeAddr("feeRecipient");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant LAUNCH = 2_100_000e18; // 10% of the 21M cap
    uint256 constant START_MCAP = 50_000e18; // IMD, for the full 21M
    int24 constant FULL_100 = 887_200;

    function setUp() public {
        vm.warp(1_800_000_000);
        pm = new PoolManager(address(this));
        imd = new MockIMD();
        extRouter = new PoolSwapTest(pm);
        lp = new PoolModifyLiquidityTest(pm);
        vm.deal(address(this), 1_000_000 ether);
        imd.mint(address(this), 10_000_000e18);
        imd.approve(address(lp), type(uint256).max);

        // IMD/ETH at 1:1 for the ETH router.
        PoolKey memory imdEth = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(imd)), 10_000, 100, IHooks(address(0)));
        pm.initialize(imdEth, TickMath.getSqrtPriceAtTick(0));
        lp.modifyLiquidity{value: 20_000 ether}(imdEth, ModifyLiquidityParams(-FULL_100, FULL_100, 10_000e18, 0), "");

        // The hook lives at a mined address carrying its permission flags.
        bytes memory initCode = abi.encodePacked(
            type(StampHook).creationCode,
            abi.encode(
                pm, address(imd), owner, feeRecipient, DeployLib.startTickForMarketCap(START_MCAP, 21_000_000e18), LAUNCH,
                StampHook.ImdEthPool(10_000, 100, address(0))
            )
        );
        (bytes32 salt, address expected) = DeployLib.mineSalt(address(this), _flags(), initCode, 0);
        address deployed;
        assembly {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        require(deployed == expected, "hook address");
        hook = StampHook(deployed);
        router = StampRouter(hook.router());
        ethRouter = StampEthRouter(payable(hook.ethRouter()));

        stamp = new StampToken(owner, address(hook), LAUNCH);
        vm.prank(owner);
        hook.openPool(address(stamp));

        for (uint256 i; i < 2; i++) {
            address u = i == 0 ? alice : bob;
            imd.mint(u, 100_000e18);
            vm.deal(u, 100 ether);
            vm.startPrank(u);
            imd.approve(address(router), type(uint256).max);
            imd.approve(address(extRouter), type(uint256).max);
            stamp.approve(address(router), type(uint256).max);
            stamp.approve(address(ethRouter), type(uint256).max);
            stamp.approve(address(extRouter), type(uint256).max);
            vm.stopPrank();
        }
    }

    receive() external payable {}

    function _flags() internal pure returns (uint160) {
        return uint160(0x28CC); // beforeInitialize, beforeAddLiquidity, before/afterSwap, both return deltas
    }

    function _key() internal view returns (PoolKey memory) {
        return hook.poolKey(address(stamp));
    }

    function _imdIs0() internal view returns (bool) {
        return Currency.unwrap(_key().currency0) == address(imd);
    }

    function _extSwap(address who, bool buy, int256 amountSpecified) internal {
        bool zeroForOne = buy == _imdIs0();
        PoolKey memory key = _key();
        vm.prank(who, who);
        extRouter.swap(
            key,
            SwapParams(zeroForOne, amountSpecified, zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    // ------------------------------------------------------------------ launch

    function test_LaunchLocksTheAllocation() public view {
        assertEq(stamp.balanceOf(address(hook)), 0);
        // Everything went into the pool except a rounding buffer (< 1.1e9 wei), which was burned.
        address dead = 0x000000000000000000000000000000000000dEaD;
        assertEq(stamp.balanceOf(address(pm)) + stamp.balanceOf(dead), LAUNCH);
        assertLt(stamp.balanceOf(dead), 1.1e9);
        assertEq(stamp.totalMinted(), LAUNCH);
        assertEq(hook.token(), address(stamp));
    }

    function test_OpenPoolOnlyOnceAndOnlyOwner() public {
        vm.expectRevert(StampHook.NotOwner.selector);
        hook.openPool(address(stamp));
        vm.prank(owner);
        vm.expectRevert(StampHook.AlreadyLaunched.selector);
        hook.openPool(address(stamp));
    }

    function test_DonationBeforeLaunchCannotBlockOpenPool() public {
        bytes memory initCode = abi.encodePacked(
            type(StampHook).creationCode,
            abi.encode(
                pm, address(imd), owner, alice, DeployLib.startTickForMarketCap(START_MCAP, 21_000_000e18), LAUNCH,
                StampHook.ImdEthPool(10_000, 100, address(0))
            )
        );
        (bytes32 salt,) = DeployLib.mineSalt(address(this), _flags(), initCode, 0);
        address h;
        assembly {
            h := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        StampToken s2 = new StampToken(owner, h, LAUNCH);
        vm.prank(owner);
        s2.setMinter(address(this));
        s2.mint(h, 1); // someone sends 1 wei to the hook before the launch

        vm.prank(owner);
        StampHook(h).openPool(address(s2));
        address dead = 0x000000000000000000000000000000000000dEaD;
        assertEq(s2.balanceOf(h), 0);
        assertEq(s2.balanceOf(address(pm)) + s2.balanceOf(dead), LAUNCH + 1);
    }

    function test_NobodyCanAddLiquidityOrReuseTheHook() public {
        PoolKey memory k = _key();
        vm.expectRevert();
        lp.modifyLiquidity(k, ModifyLiquidityParams(-200, 200, 1e18, 0), "");
        PoolKey memory other = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(stamp)), 0, 200, IHooks(address(hook)));
        vm.expectRevert();
        pm.initialize(other, TickMath.getSqrtPriceAtTick(0));
    }

    // ------------------------------------------------------------------ the 4% tax

    function test_BuyPaysFourPercentToProtocol() public {
        vm.prank(alice);
        uint256 out = router.buy(address(stamp), 1_000e18, 1, block.timestamp);
        assertGt(out, 0);
        assertEq(stamp.balanceOf(alice), out);
        assertEq(hook.pendingProtocolFees(address(imd)), 40e18);
    }

    function test_SellPaysFourPercentOfTheOutput() public {
        vm.startPrank(alice);
        uint256 got = router.buy(address(stamp), 10_000e18, 1, block.timestamp);
        uint256 feesAfterBuy = hook.pendingProtocolFees(address(imd));
        uint256 imdBefore = imd.balanceOf(alice);
        router.sell(address(stamp), got / 2, 1, block.timestamp);
        vm.stopPrank();
        uint256 received = imd.balanceOf(alice) - imdBefore;
        uint256 sellFee = hook.pendingProtocolFees(address(imd)) - feesAfterBuy;
        // The seller gets 96% of what the pool paid; the protocol the other 4%.
        assertApproxEqRel(sellFee * 96, received * 4, 1e12);
    }

    function test_EveryRouteAndDirectionIsTaxed() public {
        // Exact-in buy, exact-out buy, exact-in sell, exact-out sell through a generic v4 router.
        uint256 before = hook.pendingProtocolFees(address(imd));
        _extSwap(alice, true, -1_000e18);
        assertEq(hook.pendingProtocolFees(address(imd)) - before, 40e18, "exact-in buy");

        before = hook.pendingProtocolFees(address(imd));
        _extSwap(alice, true, 1_000e18); // exact out: 1,000 STAMP
        assertGt(hook.pendingProtocolFees(address(imd)), before, "exact-out buy");

        before = hook.pendingProtocolFees(address(imd));
        _extSwap(alice, false, -500e18); // sell 500 STAMP
        assertGt(hook.pendingProtocolFees(address(imd)), before, "exact-in sell");

        before = hook.pendingProtocolFees(address(imd));
        _extSwap(alice, false, 1e18); // exact out: 1 IMD
        assertApproxEqAbs(hook.pendingProtocolFees(address(imd)) - before, uint256(1e18) * 400 / 9600, 1, "exact-out sell");
    }

    function test_EthRouterBuysAndSellsThroughImd() public {
        vm.startPrank(alice);
        uint256 got = ethRouter.buyWithEth{value: 1 ether}(address(stamp), 1, block.timestamp);
        assertGt(got, 0);
        uint256 fee = hook.pendingProtocolFees(address(imd));
        assertGt(fee, 0);
        uint256 ethBefore = alice.balance;
        uint256 ethOut = ethRouter.sellForEth(address(stamp), got / 2, 1, block.timestamp);
        vm.stopPrank();
        assertEq(alice.balance - ethBefore, ethOut);
        assertGt(hook.pendingProtocolFees(address(imd)), fee);
    }

    function test_FeesGoToTheProtocolAddress() public {
        vm.prank(alice);
        router.buy(address(stamp), 5_000e18, 1, block.timestamp);
        hook.collectProtocolFees(address(imd));
        assertEq(imd.balanceOf(feeRecipient), 200e18);
        assertEq(hook.pendingProtocolFees(address(imd)), 0);
    }

    function test_SlippageAndDeadline() public {
        vm.startPrank(alice);
        vm.expectRevert(StampRouter.Slippage.selector);
        router.buy(address(stamp), 1e18, type(uint256).max, block.timestamp);
        vm.expectRevert(StampRouter.Expired.selector);
        router.buy(address(stamp), 1e18, 1, block.timestamp - 1);
        vm.stopPrank();
    }

    /// The STAMP-only launch: the pool holds no IMD until someone buys, so an early sell can't fill.
    function test_SellsBeforeAnyBuyCannotFill() public {
        deal(address(stamp), bob, 100e18);
        vm.prank(bob);
        vm.expectRevert();
        router.sell(address(stamp), 100e18, 1, block.timestamp);

        // After a buy brings IMD in, the same sell goes through.
        vm.prank(alice);
        router.buy(address(stamp), 1_000e18, 1, block.timestamp);
        vm.prank(bob);
        assertGt(router.sell(address(stamp), 100e18, 1, block.timestamp), 0);
    }

    // ------------------------------------------------------------------ admin

    function test_FeeRecipientAndOwnership() public {
        vm.expectRevert(StampHook.NotOwner.selector);
        hook.setFeeRecipient(bob);
        vm.prank(owner);
        hook.setFeeRecipient(bob);
        assertEq(hook.feeRecipient(), bob);

        vm.prank(owner);
        hook.transferOwnership(alice);
        assertEq(hook.owner(), owner);
        vm.prank(alice);
        hook.acceptOwnership();
        assertEq(hook.owner(), alice);
    }

    // ------------------------------------------------------------------ with the game

    function test_GameTransfersAreNotTaxedAndSupplyStaysCapped() public {
        // Emissions sized so launch allocation + all emissions = 21M exactly.
        CourierNFT nft = new CourierNFT(owner, owner, 0.003 ether, keccak256(abi.encode(uint256(1))));
        uint256 reward = (stamp.MAX_SUPPLY() - LAUNCH) / (2 * 4_200_000);
        assertEq(reward, 2.25e18);
        PostOffice office = new PostOffice(stamp, nft, 1000, reward, 0.005 ether, owner, owner);
        vm.startPrank(owner);
        stamp.setMinter(address(office));
        office.addTier(2, 3, 0);
        vm.stopPrank();

        vm.prank(alice);
        office.openOffice{value: 0.005 ether}(address(0));
        vm.warp(block.timestamp + 1000);
        vm.prank(alice);
        office.claim();
        uint256 earned = stamp.balanceOf(alice);
        assertApproxEqAbs(earned, 2_250e18, 1e6);

        // Plain transfers (wallet to wallet, or spending in the game) pay no tax.
        vm.prank(alice);
        stamp.transfer(bob, 100e18);
        assertEq(stamp.balanceOf(bob), 100e18);

        // Run every halving out: the cap holds.
        vm.warp(block.timestamp + 4_200_000 * 80);
        vm.prank(alice);
        office.claim();
        assertLe(stamp.totalMinted(), stamp.MAX_SUPPLY());
        assertApproxEqAbs(stamp.totalMinted(), stamp.MAX_SUPPLY(), 1e18);
    }

    function test_PostOfficeRejectsEmissionsPastTheCap() public {
        CourierNFT nft = new CourierNFT(owner, owner, 0.003 ether, keccak256(abi.encode(uint256(1))));
        vm.expectRevert(PostOffice.InvalidSetting.selector);
        new PostOffice(stamp, nft, 1000, 2.5e18, 0.005 ether, owner, owner); // 21M of emissions + 2.1M allocation
    }
}
