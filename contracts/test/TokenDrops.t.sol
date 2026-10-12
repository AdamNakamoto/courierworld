// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {CourierFixture} from "./PostOffice.t.sol";
import {StampToken} from "../src/StampToken.sol";
import {PostOffice} from "../src/PostOffice.sol";
import {TokenDrops, IDropsPad, IDropsPostOffice} from "../src/TokenDrops.sol";

/// The launchpad as the drops see it: which tokens it launched.
contract MockPad {
    mapping(address => uint64) public created;

    function add(address token) external {
        created[token] = uint64(block.timestamp);
    }

    function launches(address token) external view returns (address, address, uint64, uint64, bool) {
        return (address(0), address(0), created[token], 0, false);
    }
}

contract PadCoin is ERC20 {
    constructor(address to) ERC20("Letter Cat", "LCAT") {
        _mint(to, 1_000_000_000e18);
    }
}

/// A token that calls back into the drops while it's being paid.
contract GreedyCoin is ERC20 {
    TokenDrops public drops;
    bytes public reentry;
    bytes public err;

    constructor(address to) ERC20("Greedy", "GRDY") {
        _mint(to, 1_000_000e18);
    }

    function arm(TokenDrops d, bytes calldata call) external {
        drops = d;
        reentry = call;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (address(drops) != address(0) && from == address(drops) && reentry.length != 0) {
            bytes memory call = reentry;
            reentry = "";
            (bool ok, bytes memory e) = address(drops).call(call);
            if (!ok) err = e;
        }
    }
}

/// Token drops, against the real post office and $STAMP.
contract TokenDropsTest is CourierFixture {
    PostOffice office;
    TokenDrops drops;
    MockPad pad;
    PadCoin coin;

    uint256 signerKey = 0x5160;
    address signer;
    address carol = makeAddr("carol"); // no post office

    uint256 constant PER = 1_000e18;

    function setUp() public {
        signer = vm.addr(signerKey);
        _couriers();
        stamp = new StampToken(owner, treasury, 100_000e18); // the treasury has $STAMP to fund golden stamps with
        _mint(alice, 3);
        _reveal();
        office = new PostOffice(stamp, nft, 1000, 2.25e18, OFFICE, treasury, _tiers());
        vm.startPrank(owner);
        stamp.setMinter(address(office));
        nft.setGame(address(office));
        vm.stopPrank();
        vm.warp(30 days);

        pad = new MockPad();
        coin = new PadCoin(treasury);
        pad.add(address(coin));
        drops = new TokenDrops(stamp, IDropsPad(address(pad)), IDropsPostOffice(address(office)), signer, treasury);
        vm.startPrank(treasury);
        coin.approve(address(drops), type(uint256).max);
        stamp.approve(address(drops), type(uint256).max);
        vm.stopPrank();

        vm.prank(alice);
        office.openOffice{value: OFFICE}(address(0));
        vm.prank(bob);
        office.openOffice{value: OFFICE}(address(0));
    }

    // ---------------------------------------------------------------- helpers

    function _drop(uint16 spots, uint16 maxPer, uint256 daily, uint32 days_, uint256 amount) internal returns (uint256) {
        uint32 day = drops.today(); // (read before the prank: an argument that calls out would use it up)
        vm.prank(treasury);
        return drops.createDrop(address(coin), PER, spots, maxPer, daily, day, days_, amount);
    }

    function _voucher(address player, uint256 id, uint32 day, uint16 coins, uint64 deadline) internal view returns (bytes memory) {
        return _voucherBy(signerKey, player, id, day, coins, deadline);
    }

    function _voucherBy(uint256 key, address player, uint256 id, uint32 day, uint16 coins, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(drops.FINDS_TYPEHASH(), player, id, day, coins, deadline));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Courier World Drops"),
                keccak256("1"),
                block.chainid,
                address(drops)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _claim(address who, uint256 id, uint32 day, uint16 coins) internal returns (uint256) {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _voucher(who, id, day, coins, deadline);
        vm.prank(who);
        return drops.claim(id, day, coins, deadline, sig);
    }

    function claimAs(address who, uint256 id, uint32 day, uint16 coins) external returns (uint256) {
        return _claim(who, id, day, coins);
    }

    // ---------------------------------------------------------------- creating drops

    function test_CreateADrop() public {
        uint32 day = drops.today();
        uint256 id = _drop(10, 5, 100, 7, 500_000e18);
        assertEq(id, 0);
        assertEq(drops.dropCount(), 1);
        TokenDrops.Drop memory d = drops.drop(id);
        assertEq(d.token, address(coin));
        assertEq(d.spots, 10);
        assertEq(d.maxPerWallet, 5);
        assertEq(d.dailyCoins, 100);
        assertEq(d.startDay, day);
        assertEq(d.endDay, day + 6);
        assertEq(d.perCoin, PER);
        assertEq(d.left, 500_000e18);
        assertEq(coin.balanceOf(address(drops)), 500_000e18);
    }

    function test_OnlyLaunchpadTokensOrStamp() public {
        PadCoin other = new PadCoin(treasury);
        uint32 day = drops.today();
        vm.startPrank(treasury);
        other.approve(address(drops), type(uint256).max);
        vm.expectRevert(TokenDrops.BadToken.selector);
        drops.createDrop(address(other), PER, 10, 5, 1000, day, 1, 1e18);
        // $STAMP always lays out the golden stamps, whatever spots it's given.
        uint256 id = drops.createDrop(address(stamp), 10e18, 3, 24, 1000, day, 7, 10_000e18);
        vm.stopPrank();
        assertEq(drops.drop(id).spots, 24);
    }

    function test_BadDropsAreRefused() public {
        uint32 day = drops.today();
        vm.startPrank(treasury);
        vm.expectRevert(TokenDrops.BadDrop.selector);
        drops.createDrop(address(coin), 0, 10, 5, 1000, day, 1, 1e18); // worth nothing
        vm.expectRevert(TokenDrops.BadDrop.selector);
        drops.createDrop(address(coin), PER, 0, 0, 1000, day, 1, 1e18); // no coins
        vm.expectRevert(TokenDrops.BadDrop.selector);
        drops.createDrop(address(coin), PER, 10, 5, 0, day, 1, 1e18); // no cap across everyone (audit 9755203f #1)
        vm.expectRevert(TokenDrops.BadDrop.selector);
        drops.createDrop(address(coin), PER, 10, 5, 4, day, 1, 1e18); // a cap below one wallet's coins
        vm.expectRevert(TokenDrops.BadDrop.selector);
        drops.createDrop(address(coin), PER, 49, 5, 1000, day, 1, 1e18); // more than MAX_SPOTS
        vm.expectRevert(TokenDrops.BadDrop.selector);
        drops.createDrop(address(coin), PER, 10, 11, 1000, day, 1, 1e18); // a wallet paid for more than are out
        vm.expectRevert(TokenDrops.BadDrop.selector);
        drops.createDrop(address(coin), PER, 10, 5, 1000, day, 0, 1e18); // no days
        vm.expectRevert(TokenDrops.BadDrop.selector);
        drops.createDrop(address(coin), PER, 10, 5, 1000, day, 366, 1e18); // more than a year
        vm.expectRevert(TokenDrops.BadDrop.selector);
        drops.createDrop(address(coin), PER, 10, 5, 1000, day - 1, 1, 1e18); // in the past
        vm.stopPrank();
    }

    function test_ActiveDropsInOrder() public {
        uint32 day = drops.today();
        vm.startPrank(treasury);
        drops.createDrop(address(coin), PER, 10, 5, 1000, day, 3, 1e24); // 0: today to day+2
        drops.createDrop(address(coin), PER, 10, 5, 1000, day + 1, 1, 1e24); // 1: tomorrow only
        drops.createDrop(address(stamp), 10e18, 24, 24, 1000, day, 1, 1e21); // 2: today only
        vm.stopPrank();
        uint256[] memory a = drops.activeDrops(day);
        assertEq(a.length, 2);
        assertEq(a[0], 0);
        assertEq(a[1], 2);
        a = drops.activeDrops(day + 1);
        assertEq(a.length, 2);
        assertEq(a[0], 0);
        assertEq(a[1], 1);
        assertEq(drops.activeDrops(day + 3).length, 0);
    }

    // ---------------------------------------------------------------- claiming

    function test_PaysForTheDaysFinds() public {
        uint256 id = _drop(10, 5, 1000, 7, 500_000e18);
        uint32 day = drops.today();
        assertEq(_claim(alice, id, day, 3), 3_000e18);
        assertEq(coin.balanceOf(alice), 3_000e18);
        assertEq(drops.drop(id).left, 497_000e18);
        assertEq(drops.claimed(id, day, alice), 3);
        assertEq(drops.paidCoins(id, day), 3);
    }

    function test_ClaimingAgainPaysOnlyTheNewFinds() public {
        uint256 id = _drop(10, 10, 1000, 7, 500_000e18);
        uint32 day = drops.today();
        _claim(alice, id, day, 3);
        assertEq(_claim(alice, id, day, 5), 2_000e18);
        vm.expectRevert(TokenDrops.NothingToClaim.selector);
        this.claimAs(alice, id, day, 5);
    }

    function test_CapsCoinsPerWalletPerDay() public {
        uint256 id = _drop(10, 4, 1000, 7, 500_000e18);
        uint32 day = drops.today();
        assertEq(_claim(alice, id, day, 10), 4_000e18);
        vm.expectRevert(TokenDrops.NothingToClaim.selector);
        this.claimAs(alice, id, day, 10);
        // Tomorrow is a new day.
        vm.warp(vm.getBlockTimestamp() + 1 days);
        assertEq(_claim(alice, id, day + 1, 2), 2_000e18);
    }

    function test_DailyCoinsAcrossEveryone() public {
        uint256 id = _drop(10, 4, 6, 7, 500_000e18); // a wallet takes 4, everyone together 6
        uint32 day = drops.today();
        assertEq(_claim(alice, id, day, 4), 4_000e18);
        assertEq(_claim(bob, id, day, 4), 2_000e18); // only 2 of the day's 6 left
        vm.expectRevert(TokenDrops.NothingToClaim.selector);
        this.claimAs(bob, id, day, 4);
    }

    function test_PaysWhatTheDropCoversAndTheRestAfterATopUp() public {
        uint256 id = _drop(10, 10, 1000, 7, 2_500e18); // two and a half coins
        uint32 day = drops.today();
        assertEq(_claim(alice, id, day, 5), 2_000e18);
        assertEq(drops.drop(id).left, 500e18);
        vm.prank(treasury);
        drops.topUp(id, 10_000e18);
        assertEq(_claim(alice, id, day, 5), 3_000e18);
    }

    function test_OnlyOfficesCanClaim() public {
        uint256 id = _drop(10, 5, 1000, 7, 500_000e18);
        uint32 day = drops.today();
        vm.expectRevert(TokenDrops.NoOffice.selector);
        this.claimAs(carol, id, day, 1);
    }

    function test_RejectsForgedOrChangedVouchers() public {
        uint256 id = _drop(10, 10, 1000, 7, 500_000e18);
        uint32 day = drops.today();
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory forged = _voucherBy(0xBAD, alice, id, day, 3, deadline);
        vm.prank(alice);
        vm.expectRevert(TokenDrops.BadSignature.selector);
        drops.claim(id, day, 3, deadline, forged);
        bytes memory sig = _voucher(alice, id, day, 3, deadline);
        vm.startPrank(alice);
        vm.expectRevert(TokenDrops.BadSignature.selector);
        drops.claim(id, day, 9, deadline, sig); // more coins than signed
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(TokenDrops.BadSignature.selector);
        drops.claim(id, day, 3, deadline, sig); // someone else's voucher
        // Another drop's voucher doesn't pay this one.
        uint256 other = _drop(10, 10, 1000, 7, 500_000e18);
        vm.prank(alice);
        vm.expectRevert(TokenDrops.BadSignature.selector);
        drops.claim(other, day, 3, deadline, sig);
    }

    function test_DaysAndDeadlines() public {
        uint256 id = _drop(10, 10, 1000, 3, 500_000e18);
        uint32 day = drops.today();
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _voucher(alice, id, day + 1, 1, deadline);
        vm.prank(alice);
        vm.expectRevert(TokenDrops.FutureDay.selector);
        drops.claim(id, day + 1, 1, deadline, sig);
        sig = _voucher(alice, id, day, 1, deadline);
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert(TokenDrops.Expired.selector);
        drops.claim(id, day, 1, deadline, sig);
        // Yesterday's finds still pay today, but not the day after.
        assertEq(_claim(alice, id, day, 2), 2_000e18);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        assertEq(_claim(alice, id, day, 3), 1_000e18);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vm.expectRevert(TokenDrops.TooLate.selector);
        this.claimAs(alice, id, day, 4);
    }

    function test_OnlyOnTheDropsDays() public {
        uint32 day = drops.today();
        vm.prank(treasury);
        uint256 id = drops.createDrop(address(coin), PER, 10, 10, 1000, day + 1, 1, 500_000e18);
        vm.expectRevert(TokenDrops.NotRunning.selector);
        this.claimAs(alice, id, day, 1);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.expectRevert(TokenDrops.NotRunning.selector);
        this.claimAs(alice, id, day + 2, 1);
        assertEq(this.claimAs(alice, id, day + 1, 1), PER); // its one day, claimed the day after
    }

    function test_ClaimManyAcrossDrops() public {
        uint256 a = _drop(10, 10, 1000, 7, 500_000e18);
        uint32 day = drops.today();
        vm.prank(treasury);
        uint256 g = drops.createDrop(address(stamp), 10e18, 24, 24, 1000, day, 7, 10_000e18);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        TokenDrops.Claim[] memory cs = new TokenDrops.Claim[](3);
        cs[0] = TokenDrops.Claim(a, day, 3, deadline, _voucher(alice, a, day, 3, deadline));
        cs[1] = TokenDrops.Claim(g, day, 5, deadline, _voucher(alice, g, day, 5, deadline));
        cs[2] = TokenDrops.Claim(a, day, 3, deadline, _voucher(alice, a, day, 3, deadline)); // nothing new: skipped
        vm.prank(alice);
        drops.claimMany(cs);
        assertEq(coin.balanceOf(alice), 3_000e18);
        assertEq(stamp.balanceOf(alice), 50e18);
        vm.prank(alice);
        vm.expectRevert(TokenDrops.NothingToClaim.selector);
        drops.claimMany(cs);
    }

    function test_NoReentryWhilePaying() public {
        GreedyCoin greedy = new GreedyCoin(treasury);
        pad.add(address(greedy));
        uint32 day = drops.today();
        vm.startPrank(treasury);
        greedy.approve(address(drops), type(uint256).max);
        uint256 id = drops.createDrop(address(greedy), PER, 10, 10, 1000, day, 7, 100_000e18);
        vm.stopPrank();
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _voucher(alice, id, day, 3, deadline);
        greedy.arm(drops, abi.encodeCall(TokenDrops.claim, (id, day, 3, deadline, sig)));
        vm.prank(alice);
        drops.claim(id, day, 3, deadline, sig);
        assertEq(greedy.balanceOf(alice), 3_000e18); // paid once
        assertEq(bytes4(greedy.err()), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
    }

    // ---------------------------------------------------------------- ending and the owner

    function test_EndDropAfterToday() public {
        uint256 id = _drop(10, 10, 1000, 30, 500_000e18);
        uint32 day = drops.today();
        vm.prank(treasury);
        drops.endDrop(id, day);
        assertEq(drops.drop(id).endDay, day);
        assertEq(_claim(alice, id, day, 2), 2_000e18); // today's coins still count
        vm.warp(vm.getBlockTimestamp() + 1 days);
        assertEq(drops.activeDrops(day + 1).length, 0);
        assertEq(_claim(alice, id, day, 3), 1_000e18); // and can be claimed the day after
    }

    function test_EndingADropThatHasntStartedCancelsIt() public {
        uint32 day = drops.today();
        vm.startPrank(treasury);
        uint256 id = drops.createDrop(address(coin), PER, 10, 10, 1000, day + 3, 5, 500_000e18);
        drops.endDrop(id, day);
        vm.stopPrank();
        assertLt(drops.drop(id).endDay, drops.drop(id).startDay);
        for (uint32 d = day; d < day + 10; d++) assertEq(drops.activeDrops(d).length, 0);
        // Nobody can ever claim from it, so it can be withdrawn at once.
        vm.prank(treasury);
        drops.withdraw(id, treasury);
        assertEq(coin.balanceOf(treasury), 1_000_000_000e18);
    }

    function test_WithdrawOnlyOnceNobodyCanClaim() public {
        uint256 id = _drop(10, 10, 1000, 2, 500_000e18); // today and tomorrow
        vm.startPrank(treasury);
        vm.expectRevert(TokenDrops.StillRunning.selector);
        drops.withdraw(id, treasury);
        vm.warp(vm.getBlockTimestamp() + 2 days); // tomorrow's finds can still be claimed today
        vm.expectRevert(TokenDrops.StillRunning.selector);
        drops.withdraw(id, treasury);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        drops.withdraw(id, treasury);
        vm.stopPrank();
        assertEq(drops.drop(id).left, 0);
        assertEq(coin.balanceOf(treasury), 1_000_000_000e18);
    }

    function test_PauseStopsClaimsAndFreesTheTokens() public {
        uint256 id = _drop(10, 10, 1000, 30, 500_000e18);
        uint32 day = drops.today();
        vm.prank(treasury);
        drops.setPaused(true);
        vm.expectRevert(TokenDrops.IsPaused.selector);
        this.claimAs(alice, id, day, 1);
        vm.prank(treasury);
        drops.withdraw(id, treasury);
        assertEq(coin.balanceOf(treasury), 1_000_000_000e18);
        vm.prank(treasury);
        drops.setPaused(false);
        vm.expectRevert(TokenDrops.NothingToClaim.selector); // the drop is empty now
        this.claimAs(alice, id, day, 1);
    }

    function test_NewSignerOnly() public {
        uint256 id = _drop(10, 10, 1000, 7, 500_000e18);
        uint32 day = drops.today();
        vm.prank(treasury);
        drops.setSigner(vm.addr(0xF00D));
        vm.expectRevert(TokenDrops.BadSignature.selector);
        this.claimAs(alice, id, day, 1);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _voucherBy(0xF00D, alice, id, day, 1, deadline);
        vm.prank(alice);
        assertEq(drops.claim(id, day, 1, deadline, sig), PER);
    }

    function test_OwnerOnlyAndNoRenounce() public {
        bytes memory notOwner = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice);
        uint32 day = drops.today();
        vm.startPrank(alice);
        vm.expectRevert(notOwner);
        drops.createDrop(address(coin), PER, 10, 10, 1000, day, 1, 0);
        vm.expectRevert(notOwner);
        drops.topUp(0, 1);
        vm.expectRevert(notOwner);
        drops.endDrop(0, day);
        vm.expectRevert(notOwner);
        drops.withdraw(0, alice);
        vm.expectRevert(notOwner);
        drops.setSigner(alice);
        vm.expectRevert(notOwner);
        drops.setPaused(true);
        vm.stopPrank();
        vm.prank(treasury);
        vm.expectRevert(TokenDrops.NotAllowed.selector);
        drops.renounceOwnership();
        // Two-step handover.
        vm.prank(treasury);
        drops.transferOwnership(bob);
        vm.prank(bob);
        drops.acceptOwnership();
        assertEq(drops.owner(), bob);
    }

    function test_ConstructorChecks() public {
        vm.expectRevert(TokenDrops.ZeroAddress.selector);
        new TokenDrops(stamp, IDropsPad(address(pad)), IDropsPostOffice(address(office)), address(0), treasury);
        vm.expectRevert(TokenDrops.ZeroAddress.selector);
        new TokenDrops(stamp, IDropsPad(address(0)), IDropsPostOffice(address(office)), signer, treasury);
    }

    // ---------------------------------------------------------------- audit 9755203f (on 30ade10)

    /// A wallet with a post office.
    function _player(string memory name) internal returns (address who) {
        who = makeAddr(name);
        vm.deal(who, 1 ether);
        vm.prank(who);
        office.openOffice{value: OFFICE}(address(0));
    }

    /// #1: every player can collect every coin, so the cap across everyone is what bounds a day (it's required).
    function test_ManyWalletsShareTheDailyCap() public {
        uint256 id = _drop(10, 5, 12, 7, 500_000e18);
        uint32 day = drops.today();
        address[4] memory who = [alice, bob, _player("dan"), _player("eve")];
        uint256 paid;
        for (uint256 i; i < 4; i++) {
            (uint16 n,) = drops.claimable(id, who[i], day, 5);
            if (n > 0) paid += this.claimAs(who[i], id, day, 5);
        }
        assertEq(drops.paidCoins(id, day), 12);
        assertEq(paid, 12 * PER);
    }

    /// #2: in a batch, a voucher whose day just closed (sent before midnight, mined after) is skipped, not fatal.
    function test_BatchSkipsAStaleVoucher() public {
        uint32 start = drops.today();
        vm.prank(treasury);
        uint256 id = drops.createDrop(address(coin), PER, 10, 10, 1000, start, 7, 100_000e18);
        uint32 day = start + 1;
        vm.warp(uint256(day + 1) * 1 days - 30); // 23:59:30 on `day`
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        TokenDrops.Claim[] memory cs = new TokenDrops.Claim[](2);
        cs[0] = TokenDrops.Claim(id, day - 1, 3, deadline, _voucher(alice, id, day - 1, 3, deadline));
        cs[1] = TokenDrops.Claim(id, day, 2, deadline, _voucher(alice, id, day, 2, deadline));
        vm.warp(uint256(day + 1) * 1 days + 10); // 00:00:10 the next day
        vm.prank(alice);
        assertEq(drops.claimMany(cs), 2 * PER);
        // An expired voucher in a batch is skipped too; a forged one still sinks it.
        cs[0] = TokenDrops.Claim(id, day, 5, deadline, _voucher(alice, id, day, 5, deadline));
        cs[1] = TokenDrops.Claim(id, day, 9, deadline, _voucherBy(0xBAD, alice, id, day, 9, deadline));
        vm.prank(alice);
        vm.expectRevert(TokenDrops.BadSignature.selector);
        drops.claimMany(cs);
        vm.warp(uint256(deadline) + 1);
        cs[1] = TokenDrops.Claim(id, day + 1, 1, uint64(vm.getBlockTimestamp() + 1 hours), _voucher(alice, id, day + 1, 1, uint64(vm.getBlockTimestamp() + 1 hours)));
        vm.prank(alice);
        assertEq(drops.claimMany(cs), PER); // the expired one skipped, the fresh one paid
    }

    /// #3: a running drop emptied while paused ends after today, so its coins stop going out.
    function test_WithdrawWhilePausedEndsTheDrop() public {
        uint256 id = _drop(10, 5, 1000, 30, 100_000e18);
        uint32 day = drops.today();
        vm.startPrank(treasury);
        drops.setPaused(true);
        drops.withdraw(id, treasury);
        drops.setPaused(false);
        vm.stopPrank();
        assertEq(drops.drop(id).left, 0);
        assertEq(drops.drop(id).endDay, day);
        assertEq(drops.activeDrops(day + 1).length, 0);
    }

    /// #4: the quote says nothing where a claim would fail.
    function test_ClaimableQuotesNothingOutsideTheWindow() public {
        uint32 day = drops.today();
        vm.prank(treasury);
        uint256 id = drops.createDrop(address(coin), PER, 10, 10, 1000, day, 1, 100_000e18);
        (uint16 n,) = drops.claimable(id, alice, day, 3);
        assertEq(n, 3);
        (n,) = drops.claimable(id, alice, day + 1, 3); // not one of its days (and in the future)
        assertEq(n, 0);
        vm.prank(treasury);
        drops.setPaused(true);
        (n,) = drops.claimable(id, alice, day, 3);
        assertEq(n, 0);
        vm.prank(treasury);
        drops.setPaused(false);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        (n,) = drops.claimable(id, alice, day, 3); // too old
        assertEq(n, 0);
    }

    /// #5: an end mined after the intended last day reverts instead of running a day longer.
    function test_EndDropMinedLateReverts() public {
        uint256 id = _drop(10, 5, 1000, 30, 100_000e18);
        uint32 day = drops.today();
        vm.warp(uint256(day + 1) * 1 days + 1); // 00:00:01 the next day
        vm.prank(treasury);
        vm.expectRevert(TokenDrops.TooLate.selector);
        drops.endDrop(id, day);
        vm.prank(treasury);
        drops.endDrop(id, day + 1);
        assertEq(drops.drop(id).endDay, day + 1);
    }

    /// #5: a signer change records the old key.
    function test_SignerChangeRecordsThePrevious() public {
        vm.expectEmit(true, true, false, false, address(drops));
        emit TokenDrops.SignerSet(signer, address(0xF00D));
        vm.prank(treasury);
        drops.setSigner(address(0xF00D));
    }

    /// #6: tokens sent straight here can be swept; the drops' own balances can't.
    function test_SweepTakesOnlyStrays() public {
        uint256 id = _drop(10, 5, 1000, 7, 10_000e18);
        vm.prank(treasury);
        coin.transfer(address(drops), 5_000e18);
        assertEq(drops.held(address(coin)), 10_000e18);
        uint256 before = coin.balanceOf(treasury);
        vm.prank(treasury);
        drops.sweep(address(coin), treasury);
        assertEq(coin.balanceOf(treasury) - before, 5_000e18);
        assertEq(drops.drop(id).left, 10_000e18);
        assertEq(coin.balanceOf(address(drops)), 10_000e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        drops.sweep(address(coin), alice);
    }

    /// #8: two drops of one token keep their tokens apart through claims, a withdraw and a sweep.
    function test_SameTokenDropsStayApart() public {
        uint256 a = _drop(10, 10, 1000, 7, 3_000e18);
        uint256 b = _drop(10, 10, 1000, 7, 7_000e18);
        uint32 day = drops.today();
        assertEq(_claim(alice, a, day, 10), 3_000e18); // drains a
        vm.expectRevert(TokenDrops.NothingToClaim.selector);
        this.claimAs(bob, a, day, 1);
        assertEq(drops.drop(b).left, 7_000e18);
        vm.startPrank(treasury);
        drops.setPaused(true);
        uint256 before = coin.balanceOf(treasury);
        drops.withdraw(b, treasury);
        assertEq(coin.balanceOf(treasury) - before, 7_000e18);
        drops.sweep(address(coin), treasury); // nothing stray
        vm.stopPrank();
        assertEq(coin.balanceOf(address(drops)), 0);
        assertEq(drops.held(address(coin)), 0);
    }

    /// #8: the day edges, to the second.
    function test_DayEdgesToTheSecond() public {
        uint256 id = _drop(10, 10, 1000, 1, 100_000e18); // today only
        uint32 day = drops.today();
        vm.warp(uint256(day + 2) * 1 days - 1); // 23:59:59 the day after: still claimable
        assertEq(this.claimAs(alice, id, day, 1), PER);
        vm.prank(treasury);
        vm.expectRevert(TokenDrops.StillRunning.selector);
        drops.withdraw(id, treasury);
        vm.warp(uint256(day + 2) * 1 days); // 00:00:00 two days on: closed, and the rest can come back
        vm.expectRevert(TokenDrops.TooLate.selector);
        this.claimAs(alice, id, day, 2);
        vm.prank(treasury);
        drops.withdraw(id, treasury);
        assertEq(drops.drop(id).left, 0);
    }

    /// #8: a $STAMP drop pays for the golden stamps.
    function test_StampDropPaysTheGoldenStamps() public {
        uint32 day = drops.today();
        vm.prank(treasury);
        uint256 id = drops.createDrop(address(stamp), 10e18, 3, 24, 1000, day, 7, 10_000e18);
        assertEq(drops.drop(id).spots, 24);
        assertEq(_claim(alice, id, day, 30), 240e18); // a voucher for more than 24 pays 24
        assertEq(stamp.balanceOf(alice), 240e18);
    }

    /// Whatever wallets claim, in any order, a drop never pays more than it holds or than its limits allow.
    function testFuzz_NeverOverpays(uint16[6] memory finds, uint8 daily) public {
        uint256 limit = bound(daily, 8, 30);
        uint256 id = _drop(10, 8, limit, 7, 15_500e18); // 15.5 coins
        uint32 day = drops.today();
        address[2] memory who = [alice, bob];
        uint256 paid;
        for (uint256 i; i < 6; i++) {
            uint16 c = uint16(bound(finds[i], 0, 40));
            (uint16 n, uint256 amount) = drops.claimable(id, who[i % 2], day, c);
            if (n == 0) continue;
            paid += _claim(who[i % 2], id, day, c);
            assertEq(amount, uint256(n) * PER);
        }
        assertEq(coin.balanceOf(alice) + coin.balanceOf(bob), paid);
        assertEq(drops.drop(id).left, 15_500e18 - paid);
        assertLe(drops.claimed(id, day, alice), 8);
        assertLe(drops.claimed(id, day, bob), 8);
        assertLe(drops.paidCoins(id, day), limit);
        assertLe(paid, 15_000e18);
    }
}
