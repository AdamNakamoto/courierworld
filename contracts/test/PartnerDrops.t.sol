// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CourierFixture} from "./PostOffice.t.sol";
import {MockPad, PadCoin} from "./TokenDrops.t.sol";
import {StampToken} from "../src/StampToken.sol";
import {PostOffice} from "../src/PostOffice.sol";
import {TokenDrops, IDropsPad, IDropsPostOffice} from "../src/TokenDrops.sol";
import {DropsTokenList} from "../src/DropsTokenList.sol";

/// The partner drops: a second TokenDrops that asks a DropsTokenList (the Launchpad's tokens, plus the ones the
/// treasury approves) what it can drop, next to the first, against the real post office and $STAMP.
contract PartnerDropsTest is CourierFixture {
    PostOffice office;
    MockPad pad;
    PadCoin launched; // a Launchpad token
    PadCoin partner; // a partner token (not the Launchpad's), like $MINE
    TokenDrops drops; // the first contract: the Launchpad's tokens
    DropsTokenList list;
    TokenDrops drops2; // the partner drops

    uint256 signerKey = 0x5160;
    address signer;
    address carol = makeAddr("carol"); // no post office

    function setUp() public {
        signer = vm.addr(signerKey);
        _couriers();
        stamp = new StampToken(owner, treasury, 100_000e18);
        _mint(alice, 3);
        _reveal();
        office = new PostOffice(stamp, nft, 1000, 2.25e18, OFFICE, treasury, _tiers());
        vm.startPrank(owner);
        stamp.setMinter(address(office));
        nft.setGame(address(office));
        vm.stopPrank();
        vm.warp(30 days);

        pad = new MockPad();
        launched = new PadCoin(treasury);
        partner = new PadCoin(treasury);
        pad.add(address(launched));
        address[] memory tokens = new address[](1);
        tokens[0] = address(partner);
        list = new DropsTokenList(treasury, IDropsPad(address(pad)), tokens);
        drops = new TokenDrops(stamp, IDropsPad(address(pad)), IDropsPostOffice(address(office)), signer, treasury);
        drops2 = new TokenDrops(stamp, IDropsPad(address(list)), IDropsPostOffice(address(office)), signer, treasury);
        vm.startPrank(treasury);
        for (uint256 i; i < 2; ++i) {
            address d = i == 0 ? address(drops) : address(drops2);
            launched.approve(d, type(uint256).max);
            partner.approve(d, type(uint256).max);
            stamp.approve(d, type(uint256).max);
        }
        vm.stopPrank();

        vm.prank(alice);
        office.openOffice{value: OFFICE}(address(0));
        vm.prank(bob);
        office.openOffice{value: OFFICE}(address(0));
    }

    // ---------------------------------------------------------------- helpers

    function _today() internal view returns (uint32) {
        return uint32(vm.getBlockTimestamp() / 1 days);
    }

    function _create(TokenDrops d, address token, uint256 perCoin, uint16 spots, uint16 maxPer, uint256 daily, uint32 days_, uint256 amount)
        internal
        returns (uint256)
    {
        uint32 day = _today();
        vm.prank(treasury);
        return d.createDrop(token, perCoin, spots, maxPer, daily, day, days_, amount);
    }

    function _voucher(TokenDrops d, address player, uint256 id, uint32 day, uint16 coins, uint64 deadline) internal view returns (bytes memory) {
        bytes32 typehash = keccak256("Finds(address player,uint256 drop,uint32 day,uint16 coins,uint64 deadline)");
        bytes32 structHash = keccak256(abi.encode(typehash, player, id, day, coins, deadline));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Courier World Drops"),
                keccak256("1"),
                block.chainid,
                address(d)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _claim(TokenDrops d, address who, uint256 id, uint32 day, uint16 coins) internal returns (uint256) {
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = _voucher(d, who, id, day, coins, deadline);
        vm.prank(who);
        return d.claim(id, day, coins, deadline, sig);
    }

    // ---------------------------------------------------------------- the token list

    function test_ListAnswersForApprovedTokensAndAsksThePadForTheRest() public view {
        (,, uint64 createdAt,,) = list.launches(address(partner));
        assertEq(createdAt, 1);
        (,, createdAt,,) = list.launches(address(launched));
        assertEq(createdAt, pad.created(address(launched)));
        assertGt(createdAt, 0);
        (,, createdAt,,) = list.launches(address(stamp));
        assertEq(createdAt, 0);
        assertTrue(list.approved(address(partner)));
        assertEq(address(list.pad()), address(pad));
        assertEq(list.owner(), treasury);
    }

    function test_OnlyTheOwnerApproves() public {
        PadCoin other = new PadCoin(treasury);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        list.setApproved(address(other), true);
        vm.expectEmit(address(list));
        emit DropsTokenList.TokenApproved(address(other), true);
        vm.prank(treasury);
        list.setApproved(address(other), true);
        (,, uint64 createdAt,,) = list.launches(address(other));
        assertEq(createdAt, 1);
    }

    function test_ZeroAddressesAreRefused() public {
        address[] memory none = new address[](0);
        vm.expectRevert(DropsTokenList.ZeroAddress.selector);
        new DropsTokenList(treasury, IDropsPad(address(0)), none);
        address[] memory zero = new address[](1);
        vm.expectRevert(DropsTokenList.ZeroAddress.selector);
        new DropsTokenList(treasury, IDropsPad(address(pad)), zero);
        vm.prank(treasury);
        vm.expectRevert(DropsTokenList.ZeroAddress.selector);
        list.setApproved(address(0), true);
    }

    function test_OwnershipIsHandedOverNotRenounced() public {
        vm.prank(treasury);
        vm.expectRevert(DropsTokenList.CannotRenounce.selector);
        list.renounceOwnership();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        list.renounceOwnership();
        vm.prank(treasury);
        list.transferOwnership(bob);
        assertEq(list.owner(), treasury); // (two steps: bob has to accept)
        vm.prank(bob);
        list.acceptOwnership();
        assertEq(list.owner(), bob);
    }

    // ---------------------------------------------------------------- the partner drops

    function test_PartnerTokensDropOnlyOnThePartnerContract() public {
        uint32 day = _today();
        vm.prank(treasury);
        vm.expectRevert(TokenDrops.BadToken.selector);
        drops.createDrop(address(partner), 500e18, 20, 5, 33, day, 30, 500_000e18);
        uint256 id = _create(drops2, address(partner), 500e18, 20, 5, 33, 30, 500_000e18);
        assertEq(id, 0);
        TokenDrops.Drop memory d = drops2.drop(id);
        assertEq(d.token, address(partner));
        assertEq(d.endDay, day + 29);
        assertEq(d.left, 500_000e18);
        // Launchpad tokens work on either; anything else on neither.
        _create(drops2, address(launched), 1e18, 5, 5, 5, 1, 5e18);
        PadCoin other = new PadCoin(treasury);
        vm.startPrank(treasury);
        other.approve(address(drops2), type(uint256).max);
        vm.expectRevert(TokenDrops.BadToken.selector);
        drops2.createDrop(address(other), 1e18, 5, 5, 5, day, 1, 5e18);
        vm.stopPrank();
    }

    function test_RemovingATokenStopsNewDropsNotRunningOnes() public {
        uint256 id = _create(drops2, address(partner), 500e18, 20, 5, 33, 30, 500_000e18);
        vm.prank(treasury);
        list.setApproved(address(partner), false);
        uint32 day = _today();
        vm.prank(treasury);
        vm.expectRevert(TokenDrops.BadToken.selector);
        drops2.createDrop(address(partner), 500e18, 20, 5, 33, day, 30, 1e18);
        assertEq(_claim(drops2, alice, id, day, 3), 1_500e18);
        assertEq(partner.balanceOf(alice), 1_500e18);
    }

    /// The $MINE drop as planned: 500 a coin, 20 out, 5 a wallet a day, 33 a day for everyone, 30 days, 500,000 in.
    /// Every day full pays 495,000, and 5,000 is left to withdraw at the end.
    function test_TheMineDropPaysEveryDayAndLeavesTheRest() public {
        uint256 id = _create(drops2, address(partner), 500e18, 20, 5, 33, 30, 500_000e18);
        address[] memory hunters = new address[](7);
        for (uint256 i; i < hunters.length; ++i) {
            hunters[i] = makeAddr(string(abi.encodePacked("hunter", vm.toString(i))));
            vm.deal(hunters[i], 1 ether);
            vm.prank(hunters[i]);
            office.openOffice{value: OFFICE}(address(0));
        }
        uint32 first = _today();
        for (uint32 day = first; day < first + 30; ++day) {
            vm.warp(uint256(day) * 1 days + 1 hours);
            uint256 paid;
            for (uint256 i; i < hunters.length; ++i) paid += _claim(drops2, hunters[i], id, day, 20);
            assertEq(paid, 33 * 500e18); // (6 wallets of 5, and 3 for the seventh: the day's cap)
            assertEq(drops2.paidCoins(id, day), 33);
        }
        uint256 total;
        for (uint256 i; i < hunters.length; ++i) total += partner.balanceOf(hunters[i]);
        assertEq(total, 495_000e18);
        assertEq(drops2.drop(id).left, 5_000e18);
        vm.warp(uint256(first + 32) * 1 days); // (claims for the last day have closed)
        uint32 today = _today();
        vm.prank(treasury);
        drops2.withdraw(id, treasury, today);
        assertEq(partner.balanceOf(address(drops2)), 0);
    }

    // ---------------------------------------------------------------- two contracts, one signer

    function test_AVoucherOnlyWorksOnTheContractItWasSignedFor() public {
        uint256 a = _create(drops, address(launched), 1_000e18, 10, 5, 100, 7, 500_000e18);
        uint256 b = _create(drops2, address(partner), 500e18, 20, 5, 33, 30, 500_000e18);
        assertEq(a, b); // (both drop 0: only the domain tells them apart)
        uint32 day = _today();
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory forFirst = _voucher(drops, alice, 0, day, 4, deadline);
        bytes memory forSecond = _voucher(drops2, alice, 0, day, 4, deadline);
        vm.startPrank(alice);
        vm.expectRevert(TokenDrops.BadSignature.selector);
        drops2.claim(0, day, 4, deadline, forFirst);
        vm.expectRevert(TokenDrops.BadSignature.selector);
        drops.claim(0, day, 4, deadline, forSecond);
        assertEq(drops.claim(0, day, 4, deadline, forFirst), 4_000e18);
        assertEq(drops2.claim(0, day, 4, deadline, forSecond), 2_000e18);
        vm.stopPrank();
        assertEq(launched.balanceOf(alice), 4_000e18);
        assertEq(partner.balanceOf(alice), 2_000e18);
    }

    /// What a game loaded before there were two contracts does with a partner voucher (the room numbers partner
    /// drops from 1000 and sends them apart, but if one reached the first contract): it pays nothing and can't sink a
    /// batch that's checked first.
    function test_AFirstContractNeverPaysAPartnerDropNumber() public {
        _create(drops, address(launched), 1_000e18, 10, 5, 100, 7, 500_000e18);
        uint32 day = _today();
        (uint16 n, uint256 amount) = drops.claimable(1000, alice, day, 5);
        assertEq(n, 0);
        assertEq(amount, 0);
        (n, amount) = drops.claimable(0, alice, day, 5);
        assertEq(n, 5);
    }

    function test_PausingOneContractLeavesTheOther() public {
        uint256 a = _create(drops, address(launched), 1_000e18, 10, 5, 100, 7, 500_000e18);
        uint256 b = _create(drops2, address(partner), 500e18, 20, 5, 33, 30, 500_000e18);
        vm.prank(treasury);
        drops2.setPaused(true);
        uint32 day = _today();
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = _voucher(drops2, alice, b, day, 2, deadline);
        vm.prank(alice);
        vm.expectRevert(TokenDrops.IsPaused.selector);
        drops2.claim(b, day, 2, deadline, sig);
        assertEq(_claim(drops, alice, a, day, 2), 2_000e18);
    }

    function test_NoPostOfficeNoPartnerTokens() public {
        uint256 b = _create(drops2, address(partner), 500e18, 20, 5, 33, 30, 500_000e18);
        uint32 day = _today();
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = _voucher(drops2, carol, b, day, 2, deadline);
        vm.prank(carol);
        vm.expectRevert(TokenDrops.NoOffice.selector);
        drops2.claim(b, day, 2, deadline, sig);
    }
}

/// @notice The partner drops against the live chain: the real CourierPad, post office, $STAMP and $MINE, with the
///         treasury's own $MINE.
///   forge test --match-contract PartnerDropsForkTest --fork-url robinhood
/// Skipped when not forked.
contract PartnerDropsForkTest is Test {
    address constant STAMP = 0xBaB43AF01C32a952ff14B395D026cf1874932Bc5;
    address constant OFFICE = 0x26D80804D0FA2F4598369E0062bFC9536d115D82;
    address constant PAD = 0x90c3aaae34cf4681701452379D3819D6Bc8Fe8CC;
    address constant DROPS = 0xD0e785276840F7175DF12678991605042e89771C;
    address constant MINE = 0x1583948760169672C2AF7198026F1AEDE048657F;
    address constant TREASURY = 0x72215670C2266Bc224949A12C514a77D7fD5D566;
    address constant PEPE = 0x71b12b38ac2AEC30f5B6Fb9d089d9B567d032F0e;
    uint256 constant KEY = 0xD20B;

    TokenDrops drops2;
    DropsTokenList list;

    function setUp() public {
        if (block.chainid != 4663) return; // (each test skips itself)
        address[] memory tokens = new address[](1);
        tokens[0] = MINE;
        list = new DropsTokenList(TREASURY, IDropsPad(PAD), tokens);
        drops2 = new TokenDrops(IERC20(STAMP), IDropsPad(address(list)), IDropsPostOffice(OFFICE), vm.addr(KEY), TREASURY);
    }

    function _wallet(string memory name) internal returns (address w) {
        w = makeAddr(name);
        vm.deal(w, 1 ether);
        (bool ok, bytes memory price) = OFFICE.staticcall(abi.encodeWithSignature("officePrice()"));
        uint256 fee = ok && price.length == 32 ? abi.decode(price, (uint256)) : 0.005 ether;
        vm.prank(w);
        (ok,) = OFFICE.call{value: fee}(abi.encodeWithSignature("openOffice(address)", address(0)));
        require(ok, "couldn't open an office");
    }

    function test_Fork_TheMineDropRunsAndPays() public {
        if (block.chainid != 4663) return;
        // PEPE is a Launchpad token: the list asks the pad. $MINE isn't: the list approves it.
        (,, uint64 createdAt,,) = list.launches(PEPE);
        assertGt(createdAt, 0);
        (,, createdAt,,) = list.launches(MINE);
        assertEq(createdAt, 1);
        (,, createdAt,,) = IDropsPad(PAD).launches(MINE);
        assertEq(createdAt, 0);

        uint32 day = drops2.today();
        uint256 before = IERC20(MINE).balanceOf(TREASURY);
        vm.startPrank(TREASURY);
        IERC20(MINE).approve(address(drops2), 500_000e18);
        uint256 id = drops2.createDrop(MINE, 500e18, 20, 5, 33, day, 30, 500_000e18);
        vm.stopPrank();
        assertEq(IERC20(MINE).balanceOf(address(drops2)), 500_000e18); // (no transfer fee)
        assertEq(IERC20(MINE).balanceOf(TREASURY), before - 500_000e18);

        address hunter = _wallet("mine hunter");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 structHash = keccak256(abi.encode(drops2.FINDS_TYPEHASH(), hunter, id, day, uint16(7), deadline));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Courier World Drops"),
                keccak256("1"),
                block.chainid,
                address(drops2)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        vm.prank(hunter);
        assertEq(drops2.claim(id, day, 7, deadline, abi.encodePacked(r, s, v)), 2_500e18); // (5 a wallet a day)
        assertEq(IERC20(MINE).balanceOf(hunter), 2_500e18);

        // The live drops contract is untouched, and never pays drop 1000.
        (uint16 n, uint256 amount) = TokenDrops(DROPS).claimable(1000, hunter, day, 5);
        assertEq(n, 0);
        assertEq(amount, 0);
    }
}
