// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
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

/// A treasury that tries to buy again while it's being paid.
contract GreedyTreasury {
    SkinsStampSale public sale;
    bool public tried;
    bool public refused;

    function setSale(SkinsStampSale sale_) external {
        sale = sale_;
    }

    receive() external payable {
        if (address(sale) == address(0) || tried) return;
        tried = true;
        try sale.buy(1) {} catch {
            refused = true;
        }
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
        sale.buy(n);
        vm.stopPrank();
    }

    function _permit(uint256 key, uint256 value, uint256 deadline) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        address who = vm.addr(key);
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
        sale.buyWithPermit(2, deadline, v, r, s);
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
        sale.buyWithPermit(1, deadline, v, r, s);
        assertEq(skins.ownerOf(1), alice);
    }

    function test_NotEnoughStampOrAllowance() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(sale), 0, STAMP_PRICE));
        sale.buy(1);
        address poor = makeAddr("poor");
        vm.prank(minter);
        stamp.mint(poor, 100e18);
        vm.startPrank(poor);
        stamp.approve(address(sale), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, poor, 100e18, STAMP_PRICE));
        sale.buy(1);
        vm.stopPrank();
        assertEq(skins.totalMinted(), 0);
    }

    function test_ClosedUntilOpened() public {
        vm.prank(owner);
        sale.setOpen(false);
        vm.startPrank(alice);
        stamp.approve(address(sale), STAMP_PRICE);
        vm.expectRevert(SkinsStampSale.Closed.selector);
        sale.buy(1);
        vm.stopPrank();
    }

    function test_FloatRunsOutCleanly() public {
        vm.prank(owner);
        sale.withdrawEth(payable(owner), 0.1 ether - ETH_PRICE); // room for one skin
        _approveAndBuy(alice, 1);
        vm.startPrank(bob);
        stamp.approve(address(sale), STAMP_PRICE);
        vm.expectRevert(SkinsStampSale.NeedsTopUp.selector);
        sale.buy(1);
        vm.stopPrank();
        // Topping up starts it again.
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        (bool ok,) = address(sale).call{value: ETH_PRICE}("");
        assertTrue(ok);
        vm.prank(bob);
        sale.buy(1);
        assertEq(skins.ownerOf(2), bob);
    }

    function test_CourierSkinsRulesStillApply() public {
        vm.startPrank(alice);
        stamp.approve(address(sale), type(uint256).max);
        vm.expectRevert(CourierSkins.BadQuantity.selector);
        sale.buy(0);
        vm.expectRevert(CourierSkins.BadQuantity.selector);
        sale.buy(11);
        vm.stopPrank();
        vm.prank(owner);
        skins.setSaleOpen(false);
        vm.prank(alice);
        vm.expectRevert(CourierSkins.SaleClosed.selector);
        sale.buy(1);
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
        sale.buy(1);
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

    /// A Courier Skins treasury that calls back in while being paid can't buy twice in one go.
    function test_NoReentry() public {
        GreedyTreasury greedy = new GreedyTreasury();
        vm.prank(owner);
        skins.setTreasury(address(greedy));
        greedy.setSale(sale);
        _approveAndBuy(alice, 1);
        assertTrue(greedy.tried());
        assertTrue(greedy.refused());
        assertEq(skins.totalMinted(), 1);
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
/// Skipped when not forked.
contract SkinsStampSaleForkTest is Test {
    CourierSkins constant SKINS = CourierSkins(0x19716dAaDE3F2979aAA4f69cc04e2A5c00e7D23e);
    StampToken constant STAMP = StampToken(0xBaB43AF01C32a952ff14B395D026cf1874932Bc5);

    function test_Fork_BuyWithStampOnTheLiveContracts() public {
        if (block.chainid != 4663) return;
        if (!SKINS.saleOpen()) return; // the sale has closed; nothing left to buy
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
        sale.buyWithPermit(2, deadline, v, r, s);

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
