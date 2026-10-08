// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {StampToken} from "../src/StampToken.sol";
import {CourierNFT} from "../src/CourierNFT.sol";
import {PostOffice} from "../src/PostOffice.sol";

contract PostOfficeTest is Test {
    StampToken stamp;
    CourierNFT nft;
    PostOffice office;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant SECRET = 0xC0FFEE;
    uint256 constant PRICE = 0.003 ether;
    uint256 constant OFFICE = 0.005 ether;

    function setUp() public {
        vm.roll(100);
        vm.startPrank(owner);
        stamp = new StampToken(owner, address(0), 0);
        nft = new CourierNFT(owner, treasury, PRICE, keccak256(abi.encode(SECRET)));
        office = new PostOffice(stamp, nft, 1000, 2.5e18, OFFICE, treasury, owner);
        stamp.setMinter(address(office));
        nft.setGame(address(office));
        office.addTier(2, 3, 0); // Kiosk
        office.addTier(4, 7, 100e18); // Branch
        office.addTier(6, 14, 400e18); // Depot
        nft.setSaleOpen(true);
        vm.stopPrank();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function _mint(address who, uint256 n) internal {
        while (n > 0) {
            uint256 k = n > 10 ? 10 : n;
            vm.prank(who);
            nft.mint{value: PRICE * k}(k);
            n -= k;
        }
    }

    function _reveal() internal {
        vm.prank(owner);
        nft.reveal(SECRET);
    }

    function _open(address who, address referrer) internal {
        vm.prank(who);
        office.openOffice{value: OFFICE}(referrer);
    }

    /// First minted courier owned by `who` with the given ride.
    function _find(address who, uint8 ride) internal view returns (uint256) {
        for (uint256 id = 1; id <= nft.totalMinted(); id++) {
            if (nft.ownerOf(id) == who && nft.rideOf(id) == ride) return id;
        }
        revert("no courier with that ride");
    }

    function _earn(address who, uint256 secs) internal {
        vm.warp(block.timestamp + secs);
        vm.prank(who);
        office.claim();
    }

    // ------------------------------------------------------------------ mint & reveal

    function test_MintChargesPriceAndCountsUp() public {
        _mint(alice, 3);
        assertEq(nft.balanceOf(alice), 3);
        assertEq(nft.totalMinted(), 3);
        assertEq(treasury.balance, 3 * PRICE);
        assertEq(address(nft).balance, 0);
    }

    function test_MintRules() public {
        vm.startPrank(alice);
        vm.expectRevert(CourierNFT.WrongPayment.selector);
        nft.mint{value: PRICE}(2);
        vm.expectRevert(CourierNFT.BadQuantity.selector);
        nft.mint{value: PRICE * 11}(11);
        vm.stopPrank();

        vm.prank(owner);
        nft.setSaleOpen(false);
        vm.prank(alice);
        vm.expectRevert(CourierNFT.SaleClosed.selector);
        nft.mint{value: PRICE}(1);
    }

    function test_SupplyCapsAt3333() public {
        vm.deal(alice, 100 ether);
        for (uint256 i = 0; i < 333; i++) _mint(alice, 10);
        _mint(alice, 3);
        assertEq(nft.totalMinted(), 3333);
        vm.prank(alice);
        vm.expectRevert(CourierNFT.SoldOut.selector);
        nft.mint{value: PRICE}(1);
    }

    function test_RevealNeedsTheCommittedSecretAndEndsTheSale() public {
        _mint(alice, 1);
        vm.startPrank(owner);
        vm.expectRevert(CourierNFT.BadSecret.selector);
        nft.reveal(SECRET + 1);
        nft.reveal(SECRET); // straight from an open sale: the reveal closes it
        assertFalse(nft.saleOpen());
        vm.expectRevert(CourierNFT.AlreadyRevealed.selector);
        nft.setSaleOpen(true);
        vm.expectRevert(CourierNFT.AlreadyRevealed.selector);
        nft.reveal(SECRET);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(CourierNFT.SaleClosed.selector);
        nft.mint{value: PRICE}(1);
    }

    function test_RidesAreHiddenUntilReveal() public {
        _mint(alice, 1);
        vm.expectRevert(CourierNFT.NotRevealed.selector);
        nft.rideOf(1);
        _reveal();
        assertLt(nft.rideOf(1), 5);
    }

    function test_RideDistributionRoughlyMatchesWeights() public {
        vm.deal(alice, 100 ether);
        for (uint256 i = 0; i < 100; i++) _mint(alice, 10);
        _reveal();
        uint256[5] memory n;
        for (uint256 id = 1; id <= 1000; id++) n[nft.rideOf(id)]++;
        // 45 / 25 / 17 / 9 / 4 %, with generous slack for 1,000 samples.
        assertApproxEqAbs(n[0], 450, 60);
        assertApproxEqAbs(n[1], 250, 50);
        assertApproxEqAbs(n[2], 170, 45);
        assertApproxEqAbs(n[3], 90, 35);
        assertApproxEqAbs(n[4], 40, 25);
    }

    function test_TokenURIBeforeAndAfterReveal() public {
        _mint(alice, 1);
        vm.startPrank(owner);
        nft.setUnrevealedURI("ipfs://sealed.json");
        nft.setBaseURI("ipfs://cid/");
        vm.stopPrank();
        assertEq(nft.tokenURI(1), "ipfs://sealed.json");
        _reveal();
        assertEq(nft.tokenURI(1), "ipfs://cid/1.json");
    }

    function test_RoyaltyIsFivePercentToTreasury() public {
        _mint(alice, 1);
        (address to, uint256 amount) = nft.royaltyInfo(1, 1 ether);
        assertEq(to, treasury);
        assertEq(amount, 0.05 ether);
    }

    // ------------------------------------------------------------------ offices & duty

    function test_OpenOfficeStartsATraineeEarningEverything() public {
        _open(alice, address(0));
        (,,,,,, uint256 power,,) = office.offices(alice);
        assertEq(power, office.TRAINEE_POWER());
        vm.warp(block.timestamp + 100);
        assertApproxEqAbs(office.pendingRewards(alice), 250e18, 1e6);
    }

    function test_AssignAddsRidePowerAndLocksTheNFT() public {
        _mint(alice, 20);
        _reveal();
        _open(alice, address(0));
        uint256 id = _find(alice, 2); // bicycle: 260 power, 2 routes

        vm.prank(alice);
        office.assign(id);
        (,, uint8 onDuty, uint16 routesUsed,,, uint256 power,,) = office.offices(alice);
        assertEq(onDuty, 1);
        assertEq(routesUsed, 2);
        assertEq(power, 60 + 260);
        assertEq(office.dutyOf(id), alice);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CourierNFT.CourierOnDuty.selector, id));
        nft.transferFrom(alice, bob, id);

        vm.prank(alice);
        office.unassign(id);
        (,,,,,, power,,) = office.offices(alice);
        assertEq(power, 60);
        vm.prank(alice);
        nft.transferFrom(alice, bob, id);
        assertEq(nft.ownerOf(id), bob);
    }

    function test_SlotsAndRoutesAreEnforced() public {
        _mint(alice, 40);
        _reveal();
        _open(alice, address(0));
        // Kiosk: 2 slots, 3 routes. A bike (2) + a moped (3) needs 5 routes.
        uint256 bike = _find(alice, 2);
        uint256 moped = _find(alice, 3);
        uint256 walker = _find(alice, 0);
        vm.startPrank(alice);
        office.assign(bike);
        vm.expectRevert(PostOffice.NotEnoughRoutes.selector);
        office.assign(moped);
        office.assign(walker); // 3 routes used, 2 slots used
        uint256 other = _find(alice, 1);
        vm.expectRevert(PostOffice.NoFreeSlot.selector);
        office.assign(other);
        vm.stopPrank();
    }

    function test_CannotAssignSomeoneElsesCourier() public {
        _mint(bob, 1);
        _reveal();
        _open(alice, address(0));
        vm.prank(alice);
        vm.expectRevert(PostOffice.NotCourierOwner.selector);
        office.assign(1);
    }

    // ------------------------------------------------------------------ rewards

    function test_RewardsSplitByDeliveryPower() public {
        _mint(alice, 20);
        _reveal();
        _open(alice, address(0));
        _open(bob, address(0));
        uint256 walker = _find(alice, 0); // 100 power
        vm.prank(alice);
        office.assign(walker);
        // alice 160, bob 60 → 160/220 and 60/220 of 2.5/block over 220 blocks.
        vm.warp(block.timestamp + 220);
        assertApproxEqAbs(office.pendingRewards(alice), 400e18, 1e6);
        assertApproxEqAbs(office.pendingRewards(bob), 150e18, 1e6);
    }

    function test_HalvingAndCap() public {
        _open(alice, address(0));
        vm.warp(block.timestamp + office.HALVING_INTERVAL() + 100);
        assertEq(office.rewardPerBlock(), 1.25e18);
        vm.warp(block.timestamp + office.HALVING_INTERVAL() * 70);
        vm.prank(alice);
        office.claim();
        assertLe(stamp.totalMinted(), stamp.MAX_SUPPLY());
        assertApproxEqAbs(stamp.totalMinted(), stamp.MAX_SUPPLY(), 1e18);
    }

    function test_ReferrerGetsTwoAndAHalfPercent() public {
        _open(bob, address(0));
        _open(alice, bob);
        vm.warp(block.timestamp + 100);
        uint256 pending = office.pendingRewards(alice);
        vm.prank(alice);
        office.claim();
        assertEq(stamp.balanceOf(bob), pending * 250 / 10_000);
        assertEq(stamp.balanceOf(alice), pending - pending * 250 / 10_000);
    }

    // ------------------------------------------------------------------ spending

    function test_LevelUpBurnsStampAndRaisesPowerOnDuty() public {
        _mint(alice, 20);
        _reveal();
        _open(alice, address(0));
        uint256 id = _find(alice, 0); // walker, 100 power
        vm.startPrank(alice);
        office.assign(id);
        vm.stopPrank();
        _earn(alice, 1000);

        vm.startPrank(alice);
        stamp.approve(address(office), type(uint256).max);
        uint256 before = stamp.balanceOf(alice);
        office.levelUp(id); // level 1 → 2 costs 25
        vm.stopPrank();

        assertEq(office.levelOf(id), 1);
        assertEq(office.courierPower(id), 112);
        assertEq(before - stamp.balanceOf(alice), 25e18);
        assertEq(stamp.totalBurned(), 18.75e18);
        assertEq(stamp.balanceOf(treasury), 6.25e18);
        (,,,,,, uint256 power,,) = office.offices(alice);
        assertEq(power, 60 + 112);

        vm.prank(alice);
        office.levelUp(id); // level 2 → 3 costs 25 × 4
        assertEq(before - stamp.balanceOf(alice), 125e18);
    }

    function test_LevelStaysWithTheNFT() public {
        _mint(alice, 1);
        _reveal();
        _open(alice, address(0));
        _earn(alice, 1000);
        vm.startPrank(alice);
        stamp.approve(address(office), type(uint256).max);
        office.levelUp(1);
        nft.transferFrom(alice, bob, 1);
        vm.stopPrank();
        assertEq(office.levelOf(1), 1);
        vm.prank(alice);
        vm.expectRevert(PostOffice.NotCourierOwner.selector);
        office.levelUp(1);
    }

    function test_MaxLevelIsTen() public {
        _mint(alice, 1);
        _reveal();
        _open(alice, address(0));
        _earn(alice, 20_000);
        vm.startPrank(alice);
        stamp.approve(address(office), type(uint256).max);
        for (uint256 i = 0; i < 9; i++) office.levelUp(1);
        assertEq(office.levelOf(1), 9);
        vm.expectRevert(PostOffice.MaxLevel.selector);
        office.levelUp(1);
        vm.stopPrank();
    }

    function test_UpgradeOfficeAddsSlotsWithCooldown() public {
        _open(alice, address(0));
        _earn(alice, 1000);
        vm.startPrank(alice);
        stamp.approve(address(office), type(uint256).max);
        office.upgradeOffice();
        (, uint8 tier,,,,,,,) = office.offices(alice);
        assertEq(tier, 1);
        vm.expectRevert(abi.encodeWithSelector(PostOffice.CooldownActive.selector, block.timestamp + 24 hours));
        office.upgradeOffice();
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ money out

    function test_SalesGoStraightToTreasury() public {
        _mint(alice, 2);
        _open(alice, address(0));
        assertEq(treasury.balance, 2 * PRICE + OFFICE);
        assertEq(address(nft).balance, 0);
        assertEq(address(office).balance, 0);
    }

    function test_RenouncedContractsHaveNoAdmin() public {
        _mint(alice, 1);
        vm.startPrank(owner);
        office.renounceOwnership(); // at deploy
        nft.reveal(SECRET);
        nft.freezeRenderer();
        nft.renounceOwnership(); // after the reveal
        vm.stopPrank();
        assertEq(office.owner(), address(0));
        assertEq(nft.owner(), address(0));

        bytes memory notOwner = abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", owner);
        vm.startPrank(owner);
        vm.expectRevert(notOwner);
        office.setOfficePrice(0);
        vm.expectRevert(notOwner);
        office.setTreasury(owner);
        vm.expectRevert(notOwner);
        office.addTier(20, 80, 1e18);
        vm.expectRevert(notOwner);
        nft.setPrice(0);
        vm.expectRevert(notOwner);
        nft.setTreasury(owner);
        vm.stopPrank();

        // The game keeps running with nobody in charge.
        _open(alice, address(0));
        _earn(alice, 1 hours);
        assertGt(stamp.balanceOf(alice), 0);
    }

    function testFuzz_ClaimsNeverExceedEmission(uint32 gap1, uint32 gap2) public {
        gap1 = uint32(bound(gap1, 1, 60 days));
        gap2 = uint32(bound(gap2, 1, 60 days));
        _mint(alice, 10);
        _reveal();
        _open(alice, address(0));
        _open(bob, alice);
        uint256 walker = _find(alice, 0);
        vm.prank(alice);
        office.assign(walker);
        _earn(bob, gap1);
        _earn(alice, gap2);
        _earn(bob, 1);
        assertLe(stamp.totalMinted(), office.totalEmitted());
    }
}
