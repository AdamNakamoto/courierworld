// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

import {CourierPad, IPostOfficeOpen} from "../src/CourierPad.sol";
import {PadToken} from "../src/PadToken.sol";
import {StampRouter} from "../src/StampRouter.sol";
import {StampEthRouter} from "../src/StampEthRouter.sol";
import {StampToken} from "../src/StampToken.sol";
import {DeployLib} from "../script/DeployLib.sol";
import {MockIMD} from "./StampHook.t.sol";

/// The post office as the launchpad sees it: who has an office open.
contract MockOffices {
    mapping(address => bool) public isOpen;

    function setOpen(address who, bool open) external {
        isOpen[who] = open;
    }

    function offices(address who)
        external
        view
        returns (bool, uint8, uint8, uint16, uint64, address, uint256, uint256, uint256)
    {
        return (isOpen[who], 0, 0, 0, 0, address(0), 0, 0, 0);
    }
}

/// @dev Runs twice (see the two contracts at the end): with IMD as each pool's currency0 and as its currency1, since
///      the order on mainnet depends on each token's address and every code path has a branch for each.
abstract contract CourierPadTest is Test {
    using StateLibrary for IPoolManager;

    PoolManager pm;
    MockIMD imd;
    MockOffices offices;
    StampToken stamp;
    CourierPad pad;
    StampRouter router;
    StampEthRouter ethRouter;
    PoolSwapTest extRouter;
    PoolModifyLiquidityTest lp;
    PadToken token; // alice's launch

    address owner = makeAddr("owner");
    address feeRecipient = makeAddr("feeRecipient");
    address treasury = makeAddr("treasury");
    uint256 aliceKey = 0xA11CE;
    address alice;
    address bob = makeAddr("bob");
    address carol = makeAddr("carol"); // no post office

    uint256 constant STAMP_FEE = 500e18;
    uint256 constant START_MCAP = 635e18; // IMD, for the whole 1B (like PepesFamily's launches)
    uint256 constant SUPPLY = 1_000_000_000e18;
    uint256 constant DROP = 50_000_000e18;
    int24 constant FULL_100 = 887_200;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    string constant META = '{"image":"ipfs://bafy","description":"A cat that delivers letters"}';

    /// @dev Where the mock IMD lives: a low address makes it currency0, a high one currency1.
    function _imdAddress() internal pure virtual returns (address);

    function setUp() public {
        vm.warp(1_800_000_000);
        alice = vm.addr(aliceKey);
        pm = new PoolManager(address(this));
        vm.etch(_imdAddress(), address(new MockIMD()).code);
        imd = MockIMD(_imdAddress());
        extRouter = new PoolSwapTest(pm);
        lp = new PoolModifyLiquidityTest(pm);
        vm.deal(address(this), 1_000_000 ether);
        imd.mint(address(this), 10_000_000e18);
        imd.approve(address(lp), type(uint256).max);

        // IMD/ETH at 1:1 for the ETH router.
        PoolKey memory imdEth = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(imd)), 10_000, 100, IHooks(address(0)));
        pm.initialize(imdEth, TickMath.getSqrtPriceAtTick(0));
        lp.modifyLiquidity{value: 20_000 ether}(imdEth, ModifyLiquidityParams(-FULL_100, FULL_100, 10_000e18, 0), "");

        stamp = new StampToken(owner, address(0), 0);
        vm.prank(owner);
        stamp.setMinter(address(this));
        offices = new MockOffices();

        pad = CourierPad(_padWith(feeRecipient));
        router = StampRouter(pad.router());
        ethRouter = StampEthRouter(payable(pad.ethRouter()));

        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            address u = users[i];
            if (u != carol) offices.setOpen(u, true);
            stamp.mint(u, 10_000e18);
            imd.mint(u, 100_000e18);
            vm.deal(u, 100 ether);
            vm.startPrank(u);
            imd.approve(address(router), type(uint256).max);
            imd.approve(address(extRouter), type(uint256).max);
            vm.stopPrank();
        }
        token = _launch(alice, "Letter Cat", "LCAT");
        for (uint256 i; i < 3; i++) {
            vm.startPrank(users[i]);
            token.approve(address(router), type(uint256).max);
            token.approve(address(ethRouter), type(uint256).max);
            token.approve(address(extRouter), type(uint256).max);
            vm.stopPrank();
        }
    }

    receive() external payable {}

    function _padWith(address feeTo) internal returns (address h) {
        bytes memory initCode = abi.encodePacked(
            type(CourierPad).creationCode,
            abi.encode(
                pm,
                address(imd),
                address(stamp),
                IPostOfficeOpen(address(offices)),
                owner,
                feeTo,
                treasury,
                STAMP_FEE,
                DeployLib.startTickForMarketCap(START_MCAP, SUPPLY),
                CourierPad.ImdEthPool(10_000, 100, address(0))
            )
        );
        (bytes32 salt, address expected) = DeployLib.mineSalt(address(this), uint160(0x28CC), initCode, 0);
        assembly {
            h := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        require(h == expected, "pad address");
    }

    function _launch(address who, string memory name, string memory symbol) internal returns (PadToken t) {
        vm.startPrank(who);
        stamp.approve(address(pad), pad.stampFee());
        t = PadToken(pad.launch(name, symbol, META, pad.stampFee()));
        vm.stopPrank();
    }

    function _key() internal view returns (PoolKey memory) {
        return pad.poolKey(address(token));
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

    function _fees() internal view returns (uint256) {
        return pad.pendingProtocolFees(address(imd));
    }

    /// @dev `fee` is 4% of `gross` rounded up: never less, at most 1 wei more.
    function _assertFourPercentUp(uint256 fee, uint256 gross, string memory mode) internal pure {
        assertGe(fee * 10_000, gross * 400, mode);
        assertLt((fee - 1) * 10_000, gross * 400, mode);
    }

    function _stampPermit(uint256 key, uint256 value, uint256 deadline) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        address holder = vm.addr(key);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                holder,
                address(pad),
                value,
                stamp.nonces(holder),
                deadline
            )
        );
        (v, r, s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", stamp.DOMAIN_SEPARATOR(), structHash)));
    }

    // ------------------------------------------------------------------ launching

    function test_LaunchSplitsTheSupply() public view {
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(treasury), DROP, "5% to the treasury for drops");
        assertEq(token.balanceOf(address(pad)), 0);
        // The other 95% went into the pool, except a rounding buffer (< 1.1e9 wei) that was burned.
        assertEq(token.balanceOf(address(pm)) + token.balanceOf(DEAD), SUPPLY - DROP);
        assertLt(token.balanceOf(DEAD), 1.1e9);
    }

    function test_TheTokenIsPlainAndOwnerless() public view {
        assertEq(token.name(), "Letter Cat");
        assertEq(token.symbol(), "LCAT");
        assertEq(token.decimals(), 18);
        assertEq(token.metadata(), META);
        assertEq(token.creator(), alice);
        assertEq(token.pad(), address(pad));
        assertEq(token.owner(), address(0));
        (, string memory domainName,,,,,) = token.eip712Domain();
        assertEq(domainName, "Letter Cat"); // permit signatures are made for the token's name
    }

    function test_TheLaunchIsRecorded() public view {
        assertEq(pad.tokenCount(), 1);
        assertEq(pad.allTokens(0), address(token));
        (address quote, address creator, uint64 createdAt,,) = pad.launches(address(token));
        assertEq(quote, address(imd));
        assertEq(creator, alice);
        assertEq(createdAt, block.timestamp);
        assertEq(pad.launchTick(address(token)), pad.startTick());
        assertEq(pad.tokenOfPool(_key().toId()), address(token));
    }

    function test_LaunchBurnsTheStampFee() public {
        uint256 supply = stamp.totalSupply();
        uint256 before = stamp.balanceOf(bob);
        _launch(bob, "Bob Coin", "BOB");
        assertEq(stamp.balanceOf(bob), before - STAMP_FEE);
        assertEq(stamp.totalSupply(), supply - STAMP_FEE);
        assertEq(stamp.balanceOf(address(pad)), 0);
    }

    function test_StartsAtTheConfiguredMarketCap() public view {
        // Within one tick spacing (2%) of the 635 IMD aimed for.
        assertApproxEqRel(pad.marketCap(address(token)), START_MCAP, 0.03e18);
    }

    function test_LaunchNeedsAPostOffice() public {
        vm.startPrank(carol);
        stamp.approve(address(pad), STAMP_FEE);
        vm.expectRevert(CourierPad.NoPostOffice.selector);
        pad.launch("Carol", "CAR", META, STAMP_FEE);
        vm.stopPrank();
    }

    function test_LaunchNeedsTheStamp() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(pad), 0, STAMP_FEE));
        pad.launch("Bob Coin", "BOB", META, STAMP_FEE);
        address poor = makeAddr("poor");
        offices.setOpen(poor, true);
        stamp.mint(poor, 1e18);
        vm.startPrank(poor);
        stamp.approve(address(pad), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, poor, 1e18, STAMP_FEE));
        pad.launch("Poor", "POOR", META, STAMP_FEE);
        vm.stopPrank();
        assertEq(pad.tokenCount(), 1);
    }

    /// A fee rise mined before a launch can't take more than the launcher agreed to, even with an open approval.
    function test_FeeChangeNeverChargesMoreThanAgreed() public {
        vm.prank(bob);
        stamp.approve(address(pad), type(uint256).max);
        vm.prank(owner);
        pad.setStampFee(2_000e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CourierPad.FeeChanged.selector, 2_000e18));
        pad.launch("Bob Coin", "BOB", META, STAMP_FEE);
        assertEq(stamp.balanceOf(bob), 10_000e18);
        // A cut is fine: it charges the new, lower fee.
        vm.prank(owner);
        pad.setStampFee(100e18);
        vm.prank(bob);
        pad.launch("Bob Coin", "BOB", META, STAMP_FEE);
        assertEq(stamp.balanceOf(bob), 10_000e18 - 100e18);
    }

    function test_FreeWhenTheFeeIsZero() public {
        vm.prank(owner);
        pad.setStampFee(0);
        vm.prank(bob);
        PadToken t = PadToken(pad.launch("Bob Coin", "BOB", META, 0));
        assertEq(t.balanceOf(treasury), DROP);
        assertEq(stamp.balanceOf(bob), 10_000e18);
    }

    function test_LaunchWithPermitInOneTransaction() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _stampPermit(aliceKey, STAMP_FEE, deadline);
        vm.prank(alice);
        PadToken t = PadToken(pad.launchWithPermit("Second", "SEC", META, STAMP_FEE, deadline, v, r, s));
        assertEq(t.creator(), alice);
        assertEq(stamp.balanceOf(alice), 10_000e18 - 2 * STAMP_FEE);
        assertEq(stamp.allowance(alice, address(pad)), 0);
    }

    /// Someone submitting the permit first doesn't stop the launch: the allowance is there.
    function test_PermitUsedFirstStillLaunches() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _stampPermit(aliceKey, STAMP_FEE, deadline);
        stamp.permit(alice, address(pad), STAMP_FEE, deadline, v, r, s);
        vm.prank(alice);
        pad.launchWithPermit("Second", "SEC", META, STAMP_FEE, deadline, v, r, s);
        assertEq(pad.tokenCount(), 2);
    }

    /// A permit that fails with no allowance to fall back on says why.
    function test_FailedPermitSaysWhy() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _stampPermit(aliceKey, STAMP_FEE, deadline);
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ERC20Permit.ERC2612ExpiredSignature.selector, deadline));
        pad.launchWithPermit("Second", "SEC", META, STAMP_FEE, deadline, v, r, s);
    }

    function test_NameSymbolAndMetadataLimits() public {
        vm.startPrank(bob);
        stamp.approve(address(pad), type(uint256).max);
        vm.expectRevert(CourierPad.BadMetadata.selector);
        pad.launch("", "BOB", META, STAMP_FEE);
        vm.expectRevert(CourierPad.BadMetadata.selector);
        pad.launch("Bob", "", META, STAMP_FEE);
        vm.expectRevert(CourierPad.BadMetadata.selector);
        pad.launch("123456789012345678901234567890123", "BOB", META, STAMP_FEE); // 33 bytes
        vm.expectRevert(CourierPad.BadMetadata.selector);
        pad.launch("Bob", "1234567890123", META, STAMP_FEE); // 13 bytes
        vm.expectRevert(CourierPad.BadMetadata.selector);
        pad.launch("Bob", "BOB", string(new bytes(2049)), STAMP_FEE);
        // The limits themselves are fine.
        pad.launch("12345678901234567890123456789012", "123456789012", string(new bytes(2048)), STAMP_FEE);
        vm.stopPrank();
        assertEq(pad.tokenCount(), 2);
    }

    /// Every start price the owner can set launches, and the pool trades both ways from it.
    function test_EveryAllowedStartPriceLaunchesAndTrades() public {
        int24 lo = pad.MIN_START_TICK();
        int24 hi = pad.MAX_START_TICK();
        vm.startPrank(owner);
        vm.expectRevert(CourierPad.BadTick.selector);
        pad.setStartTick(lo - 200);
        vm.expectRevert(CourierPad.BadTick.selector);
        pad.setStartTick(hi + 200);
        vm.expectRevert(CourierPad.BadTick.selector);
        pad.setStartTick(100); // not on the tick spacing
        vm.stopPrank();
        int24[3] memory ticks = [lo, int24(0), hi];
        // Buys sized to each start price: at the top tick the whole pool is worth a few billionths of an IMD.
        uint256[3] memory buys = [uint256(1_000e18), 1e18, 1_000];
        for (uint256 i; i < 3; i++) {
            vm.prank(owner);
            pad.setStartTick(ticks[i]);
            PadToken t = _launch(bob, "Edge", "EDGE");
            assertEq(t.balanceOf(treasury), DROP);
            assertEq(t.balanceOf(address(pm)) + t.balanceOf(DEAD), SUPPLY - DROP);
            vm.startPrank(bob);
            uint256 got = router.buy(address(t), buys[i], 1, block.timestamp);
            assertGt(got, 0);
            t.approve(address(router), got);
            assertGt(router.sell(address(t), got, 1, block.timestamp), 0);
            vm.stopPrank();
        }
    }

    /// Launched tokens keep the start price they launched at.
    function test_StartPriceChangesOnlyAffectNewLaunches() public {
        uint160 before = pad.launchSqrtPrice(address(token));
        vm.prank(owner);
        pad.setStartTick(0);
        assertEq(pad.launchSqrtPrice(address(token)), before);
        PadToken t = _launch(bob, "Bob Coin", "BOB");
        assertEq(pad.launchTick(address(t)), 0);
        assertEq(pad.launchTick(address(token)), DeployLib.startTickForMarketCap(START_MCAP, SUPPLY));
    }

    function test_NobodyCanAddLiquidityOrReuseTheHook() public {
        PoolKey memory k = _key();
        vm.expectRevert();
        lp.modifyLiquidity(k, ModifyLiquidityParams(-200, 200, 1e18, 0), "");
        PoolKey memory other = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(token)), 0, 200, IHooks(address(pad)));
        vm.expectRevert();
        pm.initialize(other, TickMath.getSqrtPriceAtTick(0));
    }

    function test_UnknownTokens() public {
        vm.expectRevert(CourierPad.UnknownToken.selector);
        pad.poolKey(address(stamp));
        vm.expectRevert(CourierPad.UnknownToken.selector);
        pad.price(address(stamp));
        vm.expectRevert(CourierPad.UnknownToken.selector);
        pad.sellPriceLimit(address(stamp));
    }

    // ------------------------------------------------------------------ the 4% fee

    function test_BuyPaysFourPercentToProtocol() public {
        vm.prank(bob);
        uint256 out = router.buy(address(token), 1_000e18, 1, block.timestamp);
        assertGt(out, 0);
        assertEq(token.balanceOf(bob), out);
        assertEq(_fees(), 40e18);
    }

    function test_SellPaysFourPercentOfTheOutput() public {
        vm.startPrank(bob);
        uint256 got = router.buy(address(token), 10_000e18, 1, block.timestamp);
        uint256 feesAfterBuy = _fees();
        uint256 imdBefore = imd.balanceOf(bob);
        router.sell(address(token), got / 2, 1, block.timestamp);
        vm.stopPrank();
        uint256 received = imd.balanceOf(bob) - imdBefore;
        _assertFourPercentUp(_fees() - feesAfterBuy, received + _fees() - feesAfterBuy, "router sell");
    }

    /// Exact fees in all four modes through a generic v4 router.
    function test_EveryModePaysExactlyFourPercentRoundedUp() public {
        uint256 before = _fees();
        uint256 imdBefore = imd.balanceOf(bob);
        _extSwap(bob, true, -1_000e18);
        assertEq(imdBefore - imd.balanceOf(bob), 1_000e18);
        assertEq(_fees() - before, 40e18, "exact-in buy");

        before = _fees();
        imdBefore = imd.balanceOf(bob);
        _extSwap(bob, true, 1_000_000e18);
        _assertFourPercentUp(_fees() - before, imdBefore - imd.balanceOf(bob), "exact-out buy");

        before = _fees();
        imdBefore = imd.balanceOf(bob);
        _extSwap(bob, false, -500_000e18);
        uint256 fee = _fees() - before;
        _assertFourPercentUp(fee, imd.balanceOf(bob) - imdBefore + fee, "exact-in sell");

        before = _fees();
        imdBefore = imd.balanceOf(bob);
        _extSwap(bob, false, 1e18);
        assertEq(imd.balanceOf(bob) - imdBefore, 1e18);
        _assertFourPercentUp(_fees() - before, 1e18 + _fees() - before, "exact-out sell");
    }

    function test_DustSwapsStillPayTheFee() public {
        uint256 before = _fees();
        _extSwap(bob, true, -24); // 4% of 24 wei is 0.96 wei: rounds up to 1
        assertEq(_fees() - before, 1);
    }

    function test_PartialFillIsRejected() public {
        PoolKey memory key = _key();
        (uint160 sqrtP,,,) = IPoolManager(address(pm)).getSlot0(key.toId());
        bool zeroForOne = _imdIs0();
        uint160 limit = zeroForOne ? sqrtP - sqrtP / 1000 : sqrtP + sqrtP / 1000;
        vm.prank(bob, bob);
        vm.expectRevert();
        extRouter.swap(key, SwapParams(zeroForOne, -10_000e18, limit), PoolSwapTest.TestSettings(false, false), "");
        _extSwap(bob, true, -10_000e18);
    }

    function test_EthRouterBuysAndSellsThroughImd() public {
        vm.startPrank(bob);
        uint256 got = ethRouter.buyWithEth{value: 1 ether}(address(token), 1, block.timestamp);
        assertGt(got, 0);
        uint256 fee = _fees();
        assertGt(fee, 0);
        uint256 ethBefore = bob.balance;
        uint256 ethOut = ethRouter.sellForEth(address(token), got / 2, 1, block.timestamp);
        vm.stopPrank();
        assertEq(bob.balance - ethBefore, ethOut);
        assertGt(_fees(), fee);
    }

    function test_FeesFromEveryPoolGoToTheProtocolAddress() public {
        PadToken t2 = _launch(bob, "Bob Coin", "BOB");
        vm.startPrank(bob);
        router.buy(address(token), 5_000e18, 1, block.timestamp);
        router.buy(address(t2), 2_500e18, 1, block.timestamp);
        vm.stopPrank();
        pad.collectProtocolFees(address(imd));
        assertEq(imd.balanceOf(feeRecipient), 300e18);
        assertEq(_fees(), 0);
    }

    function test_CollectInsideAnotherCallersUnlock() public {
        vm.prank(bob);
        router.buy(address(token), 1_000e18, 1, block.timestamp);
        pm.unlock("");
        assertEq(imd.balanceOf(feeRecipient), 40e18);
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        pad.collectProtocolFees(address(imd));
        return "";
    }

    /// Trading one token leaves the others' prices alone.
    function test_PoolsAreIndependent() public {
        PadToken t2 = _launch(bob, "Bob Coin", "BOB");
        uint256 p2 = pad.price(address(t2));
        vm.prank(bob);
        router.buy(address(token), 50_000e18, 1, block.timestamp);
        assertGt(pad.price(address(token)), p2);
        assertEq(pad.price(address(t2)), p2);
    }

    function test_SellsBeforeAnyBuyCannotFill() public {
        vm.prank(treasury);
        token.transfer(bob, 1_000e18);
        vm.prank(bob);
        vm.expectRevert();
        router.sell(address(token), 1_000e18, 1, block.timestamp);
        vm.prank(carol);
        router.buy(address(token), 1_000e18, 1, block.timestamp);
        vm.prank(bob);
        assertGt(router.sell(address(token), 1_000e18, 1, block.timestamp), 0);
    }

    /// A sell bigger than the pool's IMD stops at the launch price, and the price view never reads 0.
    function test_PriceSurvivesSellsPastTheLaunchPrice() public {
        uint256 p0 = pad.price(address(token));
        vm.prank(bob);
        router.buy(address(token), 1e18, 1, block.timestamp);
        vm.prank(treasury);
        token.transfer(bob, 10_000_000e18); // far more than the pool can pay for
        uint256 all = token.balanceOf(bob);
        vm.prank(bob);
        assertGt(router.sell(address(token), all, 1, block.timestamp), 0);
        assertGt(token.balanceOf(bob), 0, "only what the pool could pay for was sold");
        assertEq(pad.price(address(token)), p0);
        _extSwap(bob, false, -int256(token.balanceOf(bob)));
        assertEq(pad.price(address(token)), p0);
        assertGt(pad.marketCap(address(token)), 0);
        vm.prank(carol);
        assertGt(router.buy(address(token), 1e18, 1, block.timestamp), 0);
    }

    /// Every token bought can be sold back, in any order, and the fees add up to what the trades paid.
    function testFuzz_BuysAndSellsSettle(uint96[4] memory buys) public {
        address[2] memory who = [bob, carol];
        uint256 feeSum;
        for (uint256 i; i < 4; i++) {
            uint256 amt = bound(buys[i], 1e15, 20_000e18);
            address u = who[i % 2];
            uint256 before = _fees();
            vm.prank(u);
            router.buy(address(token), amt, 1, block.timestamp);
            feeSum += _fees() - before;
        }
        for (uint256 i; i < 2; i++) {
            uint256 bal = token.balanceOf(who[i]);
            uint256 before = _fees();
            vm.prank(who[i]);
            assertGt(router.sell(address(token), bal, 1, block.timestamp), 0);
            feeSum += _fees() - before;
            assertEq(token.balanceOf(who[i]), 0, "sold everything");
        }
        assertEq(_fees(), feeSum);
        pad.collectProtocolFees(address(imd));
        assertEq(imd.balanceOf(feeRecipient), feeSum);
    }

    // ------------------------------------------------------------------ admin

    function test_OwnerSettings() public {
        address vault = makeAddr("vault");
        vm.startPrank(owner);
        pad.setStampFee(1_000e18);
        pad.setDropRecipient(vault);
        vm.expectRevert(CourierPad.ZeroAddress.selector);
        pad.setDropRecipient(address(0));
        vm.expectRevert(CourierPad.ZeroAddress.selector);
        pad.setFeeRecipient(address(0));
        vm.stopPrank();
        assertEq(pad.stampFee(), 1_000e18);
        vm.startPrank(bob);
        stamp.approve(address(pad), 1_000e18);
        PadToken t = PadToken(pad.launch("Bob Coin", "BOB", META, 1_000e18));
        vm.stopPrank();
        assertEq(t.balanceOf(vault), DROP);
    }

    function test_OwnerOnly() public {
        vm.startPrank(bob);
        vm.expectRevert(CourierPad.NotOwner.selector);
        pad.setStampFee(0);
        vm.expectRevert(CourierPad.NotOwner.selector);
        pad.setStartTick(0);
        vm.expectRevert(CourierPad.NotOwner.selector);
        pad.setDropRecipient(bob);
        vm.expectRevert(CourierPad.NotOwner.selector);
        pad.setFeeRecipient(bob);
        vm.expectRevert(CourierPad.NotOwner.selector);
        pad.transferOwnership(bob);
        vm.expectRevert(CourierPad.NotOwner.selector);
        pad.renounceOwnership();
        vm.stopPrank();
    }

    /// The recipients can move their own fees and drops (e.g. to a new wallet), even after the renounce.
    function test_RecipientsCanMoveTheirOwn() public {
        vm.prank(owner);
        pad.renounceOwnership();
        vm.prank(feeRecipient);
        pad.setFeeRecipient(bob);
        vm.prank(treasury);
        pad.setDropRecipient(bob);
        assertEq(pad.feeRecipient(), bob);
        assertEq(pad.dropRecipient(), bob);
        // And launching keeps working without an owner.
        PadToken t = _launch(alice, "Ownerless", "OWN");
        assertEq(t.balanceOf(bob), DROP);
    }

    function test_OwnershipMovesInTwoSteps() public {
        vm.prank(owner);
        pad.transferOwnership(bob);
        assertEq(pad.owner(), owner);
        vm.prank(carol);
        vm.expectRevert(CourierPad.NotOwner.selector);
        pad.acceptOwnership();
        vm.prank(bob);
        pad.acceptOwnership();
        assertEq(pad.owner(), bob);
        vm.prank(bob);
        pad.setStampFee(0);
    }

    function test_ConstructorChecks() public {
        CourierPad.ImdEthPool memory ie = CourierPad.ImdEthPool(10_000, 100, address(0));
        IPostOfficeOpen po = IPostOfficeOpen(address(offices));
        vm.expectRevert(CourierPad.ZeroAddress.selector);
        new CourierPad(pm, address(imd), address(stamp), po, owner, feeRecipient, address(0), 0, 0, ie);
        vm.expectRevert(CourierPad.ZeroAddress.selector);
        new CourierPad(pm, address(imd), address(0), po, owner, feeRecipient, treasury, 0, 0, ie);
    }
}

contract CourierPadImdFirstTest is CourierPadTest {
    function _imdAddress() internal pure override returns (address) {
        return address(0x1000);
    }
}

contract CourierPadImdSecondTest is CourierPadTest {
    function _imdAddress() internal pure override returns (address) {
        return address(uint160(type(uint160).max) - 0x1000);
    }
}
