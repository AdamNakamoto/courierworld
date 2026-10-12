// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Errors} from "@openzeppelin/contracts/utils/Errors.sol";
import {CourierSkins} from "../src/CourierSkins.sol";
import {StampToken} from "../src/StampToken.sol";
import {SkinsStampSale} from "../src/SkinsStampSale.sol";

/// Like OpenSea's strict registry: owners may move their own skins; anyone else needs authorizing.
contract OwnersOnlyValidator {
    error UnauthorizedTransfer();

    function validateTransfer(address caller, address from, address, uint256) external pure {
        if (caller != from) revert UnauthorizedTransfer();
    }
}

/// A treasury that tries to buy again, both ways, while it's being paid.
contract GreedyTreasury {
    SkinsStampSale public sale;
    bool public tried;
    bytes public buyError;
    bytes public permitError;

    function setSale(SkinsStampSale sale_) external {
        sale = sale_;
    }

    receive() external payable {
        if (address(sale) == address(0) || tried) return;
        tried = true;
        try sale.buy(1, type(uint256).max) {} catch (bytes memory e) {
            buyError = e;
        }
        try sale.buyWithPermit(1, type(uint256).max, 0, 0, 0, 0) {} catch (bytes memory e) {
            permitError = e;
        }
    }
}

/// A contract that buys skins for itself.
contract ContractBuyer {
    function buy(SkinsStampSale sale, uint256 n) external {
        sale.stamp().approve(address(sale), sale.stampPrice() * n);
        sale.buy(n, sale.stampPrice() * n);
    }
}

contract SkinsStampSaleTest is Test {
    CourierSkins skins;
    StampToken stamp;
    SkinsStampSale sale;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address minter = makeAddr("minter");
    uint256 aliceKey = 0xA11CE;
    address alice;
    address bob = makeAddr("bob");

    uint256 constant ETH_PRICE = 0.004 ether;
    uint256 constant STAMP_PRICE = 150e18;

    function setUp() public {
        alice = vm.addr(aliceKey);
        skins = new CourierSkins(owner, treasury, ETH_PRICE, bytes32(0), address(new OwnersOnlyValidator()), "");
        vm.prank(owner);
        skins.setSaleOpen(true);
        stamp = new StampToken(owner, address(0), 0);
        vm.prank(owner);
        stamp.setMinter(minter);
        vm.startPrank(minter);
        stamp.mint(alice, 10_000e18);
        stamp.mint(bob, 10_000e18);
        vm.stopPrank();
        sale = new SkinsStampSale(owner, address(skins), address(stamp), treasury, STAMP_PRICE);
        vm.prank(owner);
        sale.setOpen(true);
        vm.deal(owner, 10 ether);
        vm.prank(owner);
        (bool ok,) = address(sale).call{value: 0.1 ether}(""); // the float: 25 skins
        assertTrue(ok);
    }

    function _approveAndBuy(address who, uint256 n) internal {
        vm.startPrank(who);
        stamp.approve(address(sale), STAMP_PRICE * n);
        sale.buy(n, STAMP_PRICE * n);
        vm.stopPrank();
    }

    function _permit(uint256 key, uint256 value, uint256 deadline) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        return _permitFor(vm.addr(key), key, value, deadline);
    }

    /// A permit for `who`'s $STAMP, signed with `key` (someone else's, to make a bad one).
    function _permitFor(address who, uint256 key, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                who, address(sale), value, stamp.nonces(who), deadline
            )
        );
        (v, r, s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", stamp.DOMAIN_SEPARATOR(), structHash)));
    }

    function test_BuyPaysStampToTheTreasuryAndGivesTheSkins() public {
        uint256 treasuryEth = treasury.balance;
        _approveAndBuy(alice, 3);
        assertEq(skins.ownerOf(1), alice);
        assertEq(skins.ownerOf(3), alice);
        assertEq(skins.balanceOf(alice), 3);
        assertEq(skins.balanceOf(address(sale)), 0);
        assertEq(stamp.balanceOf(treasury), 450e18);
        assertEq(stamp.balanceOf(alice), 10_000e18 - 450e18);
        // The float paid the mint, at Courier Skins' price, and that ETH went to the treasury.
        assertEq(address(sale).balance, 0.1 ether - 3 * ETH_PRICE);
        assertEq(treasury.balance, treasuryEth + 3 * ETH_PRICE);
        assertEq(skins.totalMinted(), 3);
    }

    function test_SameSupplyAsEthMints() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        skins.mint{value: 2 * ETH_PRICE}(2);
        _approveAndBuy(alice, 2);
        assertEq(skins.ownerOf(2), bob);
        assertEq(skins.ownerOf(3), alice);
        assertEq(skins.ownerOf(4), alice);
        assertEq(skins.totalMinted(), 4);
    }

    function test_BuyWithPermitInOneTransaction() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(aliceKey, 2 * STAMP_PRICE, deadline);
        vm.prank(alice);
        sale.buyWithPermit(2, 2 * STAMP_PRICE, deadline, v, r, s);
        assertEq(skins.balanceOf(alice), 2);
        assertEq(stamp.balanceOf(treasury), 300e18);
        assertEq(stamp.allowance(alice, address(sale)), 0);
    }

    /// Someone submitting the permit first (to spoil it) doesn't stop the buy: the allowance is there.
    function test_PermitUsedFirstStillBuys() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(aliceKey, STAMP_PRICE, deadline);
        stamp.permit(alice, address(sale), STAMP_PRICE, deadline, v, r, s);
        vm.prank(alice);
        sale.buyWithPermit(1, STAMP_PRICE, deadline, v, r, s);
        assertEq(skins.ownerOf(1), alice);
    }

    function test_NotEnoughStampOrAllowance() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(sale), 0, STAMP_PRICE));
        sale.buy(1, STAMP_PRICE);
        address poor = makeAddr("poor");
        vm.prank(minter);
        stamp.mint(poor, 100e18);
        vm.startPrank(poor);
        stamp.approve(address(sale), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, poor, 100e18, STAMP_PRICE));
        sale.buy(1, STAMP_PRICE);
        vm.stopPrank();
        assertEq(skins.totalMinted(), 0);
    }

    function test_ClosedUntilOpened() public {
        vm.prank(owner);
        sale.setOpen(false);
        vm.startPrank(alice);
        stamp.approve(address(sale), STAMP_PRICE);
        vm.expectRevert(SkinsStampSale.Closed.selector);
        sale.buy(1, STAMP_PRICE);
        vm.stopPrank();
    }

    function test_FloatRunsOutCleanly() public {
        vm.prank(owner);
        sale.withdrawEth(payable(owner), 0.1 ether - ETH_PRICE); // room for one skin
        _approveAndBuy(alice, 1);
        vm.startPrank(bob);
        stamp.approve(address(sale), STAMP_PRICE);
        vm.expectRevert(SkinsStampSale.NeedsTopUp.selector);
        sale.buy(1, STAMP_PRICE);
        vm.stopPrank();
        // Topping up starts it again.
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        (bool ok,) = address(sale).call{value: ETH_PRICE}("");
        assertTrue(ok);
        vm.prank(bob);
        sale.buy(1, STAMP_PRICE);
        assertEq(skins.ownerOf(2), bob);
    }

    function test_CourierSkinsRulesStillApply() public {
        vm.startPrank(alice);
        stamp.approve(address(sale), type(uint256).max);
        vm.expectRevert(CourierSkins.BadQuantity.selector);
        sale.buy(0, 0);
        vm.expectRevert(CourierSkins.BadQuantity.selector);
        sale.buy(11, 11 * STAMP_PRICE);
        vm.stopPrank();
        vm.prank(owner);
        skins.setSaleOpen(false);
        vm.prank(alice);
        vm.expectRevert(CourierSkins.SaleClosed.selector);
        sale.buy(1, STAMP_PRICE);
        // A failed buy takes no $STAMP.
        assertEq(stamp.balanceOf(alice), 10_000e18);
    }

    function test_FollowsCourierSkinsPrice() public {
        vm.prank(owner);
        skins.setPrice(0.01 ether);
        _approveAndBuy(alice, 2);
        assertEq(address(sale).balance, 0.1 ether - 0.02 ether);
    }

    function test_OwnerSetsTheStampPriceAndTreasury() public {
        address vault = makeAddr("vault");
        vm.startPrank(owner);
        sale.setStampPrice(99e18);
        sale.setTreasury(vault);
        vm.expectRevert(SkinsStampSale.ZeroPrice.selector);
        sale.setStampPrice(0);
        vm.expectRevert(SkinsStampSale.ZeroAddress.selector);
        sale.setTreasury(address(0));
        vm.stopPrank();
        vm.startPrank(alice);
        stamp.approve(address(sale), 99e18);
        sale.buy(1, 99e18);
        vm.stopPrank();
        assertEq(stamp.balanceOf(vault), 99e18);
    }

    function test_OwnerWithdrawsTheFloatAndStrayTokens() public {
        vm.prank(alice);
        stamp.transfer(address(sale), 5e18);
        uint256 before = owner.balance;
        vm.startPrank(owner);
        sale.withdrawEth(payable(owner), 0.05 ether);
        sale.withdrawToken(address(stamp), owner, 5e18);
        vm.stopPrank();
        assertEq(owner.balance, before + 0.05 ether);
        assertEq(stamp.balanceOf(owner), 5e18);
    }

    function test_OwnerOnly() public {
        bytes memory notOwner = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice);
        vm.startPrank(alice);
        vm.expectRevert(notOwner);
        sale.setStampPrice(1);
        vm.expectRevert(notOwner);
        sale.setOpen(false);
        vm.expectRevert(notOwner);
        sale.setTreasury(alice);
        vm.expectRevert(notOwner);
        sale.withdrawEth(payable(alice), 1);
        vm.expectRevert(notOwner);
        sale.withdrawToken(address(stamp), alice, 1);
        vm.expectRevert(notOwner);
        sale.withdrawSkin(1, alice);
        vm.expectRevert(notOwner);
        sale.renounceOwnership();
        vm.stopPrank();
    }

    function test_ConstructorChecks() public {
        vm.expectRevert(SkinsStampSale.ZeroAddress.selector);
        new SkinsStampSale(owner, address(0), address(stamp), treasury, 1);
        vm.expectRevert(SkinsStampSale.ZeroAddress.selector);
        new SkinsStampSale(owner, address(skins), address(stamp), address(0), 1);
        vm.expectRevert(SkinsStampSale.ZeroPrice.selector);
        new SkinsStampSale(owner, address(skins), address(stamp), treasury, 0);
    }

    /// A Courier Skins treasury that calls back in while being paid can't buy again in one go, either way.
    function test_NoReentry() public {
        GreedyTreasury greedy = new GreedyTreasury();
        vm.prank(owner);
        skins.setTreasury(address(greedy));
        greedy.setSale(sale);
        _approveAndBuy(alice, 1);
        assertTrue(greedy.tried());
        bytes memory guard = abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(greedy.buyError(), guard);
        assertEq(greedy.permitError(), guard);
        assertEq(skins.totalMinted(), 1);
    }

    // ---------------------------------------------------------------- price changes (audit d11a6b1, findings 1-2)

    /// A price rise mined before the buy can't take more than the buyer agreed to, even with an open approval.
    function test_RepriceNeverOverchargesAStandingAllowance() public {
        vm.prank(alice);
        stamp.approve(address(sale), type(uint256).max);
        vm.prank(owner);
        sale.setStampPrice(1000e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SkinsStampSale.PriceChanged.selector, 1000e18));
        sale.buy(2, 2 * STAMP_PRICE);
        assertEq(stamp.balanceOf(alice), 10_000e18);
        assertEq(skins.totalMinted(), 0);
        // A cut is fine: it charges the new, lower price.
        vm.prank(owner);
        sale.setStampPrice(100e18);
        vm.prank(alice);
        sale.buy(2, 2 * STAMP_PRICE);
        assertEq(stamp.balanceOf(alice), 10_000e18 - 200e18);
        assertEq(stamp.balanceOf(treasury), 200e18);
    }

    /// A permit signed at the old price still works after a cut (it covers the new cost) ...
    function test_PermitSurvivesAPriceCut() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(aliceKey, 2 * STAMP_PRICE, deadline);
        vm.prank(owner);
        sale.setStampPrice(100e18);
        vm.prank(alice);
        sale.buyWithPermit(2, 2 * STAMP_PRICE, deadline, v, r, s);
        assertEq(skins.balanceOf(alice), 2);
        assertEq(stamp.balanceOf(alice), 10_000e18 - 200e18);
        assertEq(stamp.nonces(alice), 1);
    }

    /// ... and after a rise it says the price changed, taking nothing.
    function test_PermitAfterARiseSaysThePriceChanged() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(aliceKey, 2 * STAMP_PRICE, deadline);
        vm.prank(owner);
        sale.setStampPrice(151e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SkinsStampSale.PriceChanged.selector, 151e18));
        sale.buyWithPermit(2, 2 * STAMP_PRICE, deadline, v, r, s);
        assertEq(stamp.balanceOf(alice), 10_000e18);
        assertEq(stamp.nonces(alice), 0);
    }

    /// A permit that fails with no allowance to fall back on says why, rather than blaming the allowance.
    function test_FailedPermitSaysWhy() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(aliceKey, STAMP_PRICE, deadline);
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ERC20Permit.ERC2612ExpiredSignature.selector, deadline));
        sale.buyWithPermit(1, STAMP_PRICE, deadline, v, r, s);
        // Signed by someone else.
        deadline = vm.getBlockTimestamp() + 1 hours;
        (v, r, s) = _permitFor(alice, 0xBAD, STAMP_PRICE, deadline);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ERC20Permit.ERC2612InvalidSigner.selector, vm.addr(0xBAD), alice));
        sale.buyWithPermit(1, STAMP_PRICE, deadline, v, r, s);
    }

    /// With an allowance in place, a garbage or expired permit doesn't matter.
    function test_GarbagePermitWithAnAllowanceStillBuys() public {
        vm.startPrank(alice);
        stamp.approve(address(sale), STAMP_PRICE);
        sale.buyWithPermit(1, STAMP_PRICE, 0, 0, 0, 0);
        vm.stopPrank();
        assertEq(skins.ownerOf(1), alice);
        assertEq(stamp.balanceOf(treasury), STAMP_PRICE);
    }

    // ---------------------------------------------------------------- owner (audit d11a6b1, findings 3-4)

    /// A skin someone sends to the sale by mistake can be returned.
    function test_OwnerReturnsASkinSentByMistake() public {
        vm.deal(bob, 1 ether);
        vm.startPrank(bob);
        skins.mint{value: ETH_PRICE}(1);
        skins.transferFrom(bob, address(sale), 1);
        vm.stopPrank();
        assertEq(skins.ownerOf(1), address(sale));
        vm.startPrank(owner);
        vm.expectRevert(SkinsStampSale.ZeroAddress.selector);
        sale.withdrawSkin(1, address(0));
        sale.withdrawSkin(1, bob);
        vm.stopPrank();
        assertEq(skins.ownerOf(1), bob);
    }

    /// No renouncing while the sale is open or the float holds ETH: nobody could pause it or take the ETH out after.
    function test_RenounceOnlyOnceFinished() public {
        vm.startPrank(owner);
        vm.expectRevert(SkinsStampSale.NotFinished.selector);
        sale.renounceOwnership();
        sale.setOpen(false);
        vm.expectRevert(SkinsStampSale.NotFinished.selector);
        sale.renounceOwnership();
        sale.withdrawEth(payable(owner), address(sale).balance);
        sale.renounceOwnership();
        vm.stopPrank();
        assertEq(sale.owner(), address(0));
    }

    function test_OwnershipMovesInTwoSteps() public {
        address next = makeAddr("next");
        vm.prank(owner);
        sale.transferOwnership(next);
        assertEq(sale.owner(), owner);
        vm.prank(next);
        sale.acceptOwnership();
        assertEq(sale.owner(), next);
        vm.prank(next);
        sale.setOpen(false);
        assertFalse(sale.open());
    }

    function test_CantWithdrawMoreThanTheFloat() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Errors.InsufficientBalance.selector, 0.1 ether, 1 ether));
        sale.withdrawEth(payable(owner), 1 ether);
    }

    // ---------------------------------------------------------------- edges

    /// The 999 cap holds through the sale: a buy past it takes no $STAMP, one that fits goes through.
    function test_SoldOutThroughTheSale() public {
        vm.deal(bob, 10 ether);
        vm.startPrank(bob);
        for (uint256 i = 0; i < 99; i++) skins.mint{value: 10 * ETH_PRICE}(10);
        skins.mint{value: 5 * ETH_PRICE}(5);
        vm.stopPrank();
        assertEq(skins.totalMinted(), 995);
        vm.startPrank(alice);
        stamp.approve(address(sale), type(uint256).max);
        vm.expectRevert(CourierSkins.SoldOut.selector);
        sale.buy(5, 5 * STAMP_PRICE);
        assertEq(stamp.balanceOf(alice), 10_000e18);
        sale.buy(4, 4 * STAMP_PRICE);
        vm.stopPrank();
        assertEq(skins.totalMinted(), 999);
        assertEq(skins.ownerOf(999), alice);
    }

    function test_AContractCanBuy() public {
        ContractBuyer buyer = new ContractBuyer();
        vm.prank(minter);
        stamp.mint(address(buyer), 1_000e18);
        buyer.buy(sale, 2);
        assertEq(skins.balanceOf(address(buyer)), 2);
        assertEq(stamp.balanceOf(treasury), 2 * STAMP_PRICE);
    }

    function test_TheTreasuryCanBuy() public {
        vm.prank(minter);
        stamp.mint(treasury, 1_000e18);
        _approveAndBuy(treasury, 1);
        assertEq(skins.ownerOf(1), treasury);
        assertEq(stamp.balanceOf(treasury), 1_000e18);
    }

    function testFuzz_Buy(uint8 n) public {
        uint256 q = bound(n, 1, 10);
        _approveAndBuy(alice, q);
        assertEq(skins.balanceOf(alice), q);
        assertEq(stamp.balanceOf(treasury), STAMP_PRICE * q);
        assertEq(address(sale).balance, 0.1 ether - ETH_PRICE * q);
    }
}

/// @notice Against the live Courier Skins, $STAMP and OpenSea's transfer validator on Robinhood Chain:
///   forge test --match-contract SkinsStampSaleForkTest --fork-url robinhood
/// Skipped when not forked; fails once Courier Skins' sale has closed (the $STAMP sale can't sell then either).
contract SkinsStampSaleForkTest is Test {
    CourierSkins constant SKINS = CourierSkins(0x19716dAaDE3F2979aAA4f69cc04e2A5c00e7D23e);
    StampToken constant STAMP = StampToken(0xBaB43AF01C32a952ff14B395D026cf1874932Bc5);

    function test_Fork_BuyWithStampOnTheLiveContracts() public {
        vm.skip(block.chainid != 4663);
        assertTrue(SKINS.saleOpen(), "Courier Skins' sale has closed: nothing left to buy");
        address owner = makeAddr("owner");
        address treasury = makeAddr("stampTreasury");
        uint256 key = 0xB0B;
        address buyer = vm.addr(key);
        SkinsStampSale sale = new SkinsStampSale(owner, address(SKINS), address(STAMP), treasury, 150e18);
        vm.prank(owner);
        sale.setOpen(true);
        vm.deal(address(sale), 0.1 ether);
        deal(address(STAMP), buyer, 1_000e18);
        uint256 first = SKINS.totalMinted() + 1;
        address skinsTreasury = SKINS.treasury();
        uint256 ethBefore = skinsTreasury.balance;

        // One signature, one transaction.
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                buyer, address(sale), 300e18, STAMP.nonces(buyer), deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", STAMP.DOMAIN_SEPARATOR(), structHash)));
        vm.prank(buyer);
        sale.buyWithPermit(2, 300e18, deadline, v, r, s);

        assertEq(SKINS.ownerOf(first), buyer);
        assertEq(SKINS.ownerOf(first + 1), buyer);
        assertEq(STAMP.balanceOf(treasury), 300e18);
        assertEq(skinsTreasury.balance, ethBefore + 2 * SKINS.price());
        // And the buyer can move them on like any holder.
        vm.prank(buyer);
        SKINS.transferFrom(buyer, makeAddr("friend"), first);
        assertEq(SKINS.ownerOf(first), makeAddr("friend"));
    }
}
