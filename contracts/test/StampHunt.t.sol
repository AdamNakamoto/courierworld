// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CourierFixture} from "./PostOffice.t.sol";
import {StampToken} from "../src/StampToken.sol";
import {PostOffice} from "../src/PostOffice.sol";
import {StampHunt, IPostOfficeOffices} from "../src/StampHunt.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// The golden stamp hunt, against the real post office.
contract StampHuntTest is CourierFixture {
    PostOffice office;
    StampHunt hunt;

    address funder = makeAddr("funder");
    uint256 signerKey = 0xA11CE;
    address signer = vm.addr(0xA11CE);

    uint256 constant REWARD = 10e18;

    function setUp() public {
        _couriers();
        // A token with an allocation, so there's $STAMP to fund the pool with.
        stamp = new StampToken(owner, funder, 100_000e18);
        _mint(alice, 3);
        _reveal();
        office = new PostOffice(stamp, nft, 1000, 2.25e18, OFFICE, treasury, _tiers()); // the mainnet rate fits beside an allocation
        vm.startPrank(owner);
        stamp.setMinter(address(office));
        nft.setGame(address(office));
        vm.stopPrank();
        vm.warp(30 days);

        hunt = new StampHunt(stamp, IPostOfficeOffices(address(office)), signer, owner, REWARD, 24, 0);
        vm.startPrank(funder);
        stamp.approve(address(hunt), type(uint256).max);
        hunt.deposit(1_000e18);
        vm.stopPrank();

        vm.prank(alice);
        office.openOffice{value: OFFICE}(address(0));
    }

    function _voucher(address player, uint32 day, uint16 stamps, uint64 deadline) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(hunt.FINDS_TYPEHASH(), player, day, stamps, deadline));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Courier World Stamp Hunt"),
                keccak256("1"),
                block.chainid,
                address(hunt)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _claim(address who, uint32 day, uint16 stamps) internal returns (uint256) {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _voucher(who, day, stamps, deadline);
        vm.prank(who);
        return hunt.claim(day, stamps, deadline, sig);
    }

    function test_PaysForTheDaysFinds() public {
        uint32 day = hunt.today();
        assertEq(_claim(alice, day, 3), 30e18);
        assertEq(stamp.balanceOf(alice), 30e18);
        assertEq(hunt.pool(), 970e18);
        assertEq(hunt.claimed(alice, day), 3);
    }

    function test_ClaimingAgainPaysOnlyTheNewFinds() public {
        uint32 day = hunt.today();
        _claim(alice, day, 3);
        assertEq(_claim(alice, day, 5), 20e18);
        assertEq(stamp.balanceOf(alice), 50e18);
        vm.expectRevert(StampHunt.NothingToClaim.selector);
        this.claimAs(alice, day, 5);
    }

    function claimAs(address who, uint32 day, uint16 stamps) external returns (uint256) {
        return _claim(who, day, stamps);
    }

    function test_OnlyOfficesCanClaim() public {
        uint32 day = hunt.today();
        vm.expectRevert(StampHunt.NoOffice.selector);
        this.claimAs(bob, day, 2);
    }

    function test_RejectsForgedOrChangedVouchers() public {
        uint32 day = hunt.today();
        uint64 deadline = uint64(block.timestamp + 1 hours);
        // Signed for alice's 2 stamps; she claims 9 with it.
        bytes memory sig = _voucher(alice, day, 2, deadline);
        vm.prank(alice);
        vm.expectRevert(StampHunt.BadSignature.selector);
        hunt.claim(day, 9, deadline, sig);
        // Signed by someone else.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, keccak256("anything"));
        vm.prank(alice);
        vm.expectRevert(StampHunt.BadSignature.selector);
        hunt.claim(day, 2, deadline, abi.encodePacked(r, s, v));
    }

    function test_VouchersExpireAndCantBeForTheFuture() public {
        uint32 day = hunt.today();
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _voucher(alice, day, 2, deadline);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(alice);
        vm.expectRevert(StampHunt.Expired.selector);
        hunt.claim(day, 2, deadline, sig);
        uint32 tomorrow = hunt.today() + 1;
        vm.expectRevert(StampHunt.FutureDay.selector);
        this.claimAs(alice, tomorrow, 2);
    }

    function test_CapsStampsPerWalletPerDay() public {
        uint32 day = hunt.today();
        assertEq(_claim(alice, day, 100), 24 * REWARD);
    }

    function test_PaysWhatThePoolCoversAndTheRestAfterATopUp() public {
        vm.prank(owner);
        hunt.withdraw(owner, 975e18); // 25 left: two stamps' worth
        uint32 day = hunt.today();
        assertEq(_claim(alice, day, 6), 20e18);
        vm.expectRevert(StampHunt.PoolEmpty.selector);
        this.claimAs(alice, day, 6);
        vm.prank(funder);
        hunt.deposit(100e18);
        assertEq(_claim(alice, day, 6), 40e18);
        assertEq(hunt.claimed(alice, day), 6);
    }

    function test_DailyLimitAcrossEveryone() public {
        vm.prank(owner);
        hunt.setLimits(24, 50e18);
        vm.prank(bob);
        office.openOffice{value: OFFICE}(address(0));
        uint32 day = hunt.today();
        assertEq(_claim(alice, day, 4), 40e18);
        assertEq(_claim(bob, day, 4), 10e18);
        vm.warp(block.timestamp + 1 days);
        assertEq(_claim(bob, hunt.today(), 4), 40e18);
    }

    function test_OwnerControls() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        hunt.withdraw(alice, 1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        hunt.setReward(1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        hunt.setSigner(alice);
        vm.stopPrank();

        vm.startPrank(owner);
        hunt.setReward(5e18);
        vm.expectRevert(StampHunt.ZeroReward.selector);
        hunt.setReward(0);
        hunt.setSigner(makeAddr("new key"));
        vm.stopPrank();
        // Vouchers from the old key stop working.
        uint32 day = hunt.today();
        vm.expectRevert(StampHunt.BadSignature.selector);
        this.claimAs(alice, day, 2);
    }
}
