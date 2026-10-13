// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC1155Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {CourierCompanions} from "../src/CourierCompanions.sol";
import {StampToken} from "../src/StampToken.sol";

/// A contract wallet that tries to buy again while its companion is being minted to it.
contract GreedyBuyer is IERC1155Receiver {
    CourierCompanions public shop;
    bool public tried;
    bytes public buyError;

    constructor(CourierCompanions shop_) {
        shop = shop_;
    }

    function go(uint256 id, uint256 cost) external {
        shop.stamp().approve(address(shop), type(uint256).max);
        shop.buy(id, 1, cost);
    }

    function onERC1155Received(address, address, uint256 id, uint256, bytes calldata) external returns (bytes4) {
        if (!tried) {
            tried = true;
            try shop.buy(id, 1, type(uint256).max) {} catch (bytes memory e) {
                buyError = e;
            }
        }
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 i) external pure returns (bool) {
        return i == type(IERC1155Receiver).interfaceId;
    }
}

/// A contract with no way to receive ERC-1155 tokens.
contract NoReceiver {
    function go(CourierCompanions shop, uint256 id, uint256 cost) external {
        shop.stamp().approve(address(shop), cost);
        shop.buy(id, 1, cost);
    }
}

contract CourierCompanionsTest is Test {
    StampToken stamp;
    CourierCompanions shop;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    uint256 alicePk = 0xA11CE;
    address alice;
    address bob = makeAddr("bob");

    uint256 constant CAT = 1;
    uint256 constant UFO = 11;
    uint256 constant MECHA = 31;

    function setUp() public {
        alice = vm.addr(alicePk);
        stamp = new StampToken(owner, address(0), 0);
        vm.prank(owner);
        stamp.setMinter(address(this));
        stamp.mint(alice, 100_000e18);
        stamp.mint(bob, 100_000e18);
        shop = new CourierCompanions(owner, address(stamp), treasury, "https://courierworld.fun/companions/");
        vm.startPrank(owner);
        shop.setKind(CAT, 100e18, 300, 0, true);
        shop.setKind(UFO, 250e18, 150, 2, true);
        shop.setKind(MECHA, 2500e18, 30, 1, true);
        vm.stopPrank();
    }

    function _buy(address who, uint256 id, uint256 qty) internal {
        (uint128 price,,,,,) = shop.kinds(id);
        vm.startPrank(who);
        stamp.approve(address(shop), uint256(price) * qty);
        shop.buy(id, qty, uint256(price) * qty);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- buying

    function test_buyPaysTheTreasuryAndMints() public {
        vm.prank(alice);
        stamp.approve(address(shop), 300e18);
        vm.expectEmit(true, true, false, true);
        emit CourierCompanions.Bought(alice, CAT, 3, 300e18);
        vm.prank(alice);
        shop.buy(CAT, 3, 300e18);
        assertEq(shop.balanceOf(alice, CAT), 3);
        assertEq(stamp.balanceOf(treasury), 300e18);
        assertEq(stamp.balanceOf(address(shop)), 0, "the shop never holds $STAMP");
        assertEq(stamp.balanceOf(alice), 100_000e18 - 300e18);
        (,, uint32 minted,,,) = shop.kinds(CAT);
        assertEq(minted, 3);
        assertEq(shop.bought(alice, CAT), 3);
    }

    function test_priceRiseAboveMaxCostReverts() public {
        vm.prank(alice);
        stamp.approve(address(shop), type(uint256).max);
        vm.prank(owner);
        shop.setKind(CAT, 120e18, 300, 0, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CourierCompanions.PriceChanged.selector, 120e18));
        shop.buy(CAT, 1, 100e18);
        vm.prank(alice);
        shop.buy(CAT, 1, 120e18);
        assertEq(stamp.balanceOf(treasury), 120e18);
    }

    function test_cheaperThanMaxCostChargesThePrice() public {
        vm.prank(alice);
        stamp.approve(address(shop), type(uint256).max);
        vm.prank(alice);
        shop.buy(CAT, 2, 1_000e18);
        assertEq(stamp.balanceOf(treasury), 200e18);
    }

    function test_soldOut() public {
        vm.prank(owner);
        shop.setKind(77, 10e18, 5, 0, true);
        _buy(alice, 77, 5);
        vm.prank(bob);
        stamp.approve(address(shop), 10e18);
        vm.prank(bob);
        vm.expectRevert(CourierCompanions.SoldOut.selector);
        shop.buy(77, 1, 10e18);
    }

    function test_walletLimitCountsPurchasesNotHoldings() public {
        _buy(alice, UFO, 2);
        // Giving them away doesn't let her buy more.
        vm.prank(alice);
        shop.safeTransferFrom(alice, bob, UFO, 2, "");
        vm.prank(alice);
        stamp.approve(address(shop), 250e18);
        vm.prank(alice);
        vm.expectRevert(CourierCompanions.WalletLimit.selector);
        shop.buy(UFO, 1, 250e18);
        // Bob holds two from her, and can still buy his own two.
        _buy(bob, UFO, 2);
        assertEq(shop.balanceOf(bob, UFO), 4);
    }

    function test_walletLimitOnOneBuy() public {
        vm.prank(alice);
        stamp.approve(address(shop), 750e18);
        vm.prank(alice);
        vm.expectRevert(CourierCompanions.WalletLimit.selector);
        shop.buy(UFO, 3, 750e18);
    }

    function test_closedKind() public {
        vm.prank(owner);
        shop.setKind(CAT, 100e18, 300, 0, false);
        vm.prank(alice);
        stamp.approve(address(shop), 100e18);
        vm.prank(alice);
        vm.expectRevert(CourierCompanions.Closed.selector);
        shop.buy(CAT, 1, 100e18);
    }

    function test_unknownKind() public {
        vm.prank(alice);
        vm.expectRevert(CourierCompanions.UnknownKind.selector);
        shop.buy(999, 1, 1e30);
    }

    function test_quantityBounds() public {
        vm.prank(alice);
        stamp.approve(address(shop), type(uint256).max);
        vm.startPrank(alice);
        vm.expectRevert(CourierCompanions.BadQuantity.selector);
        shop.buy(CAT, 0, 1e30);
        vm.expectRevert(CourierCompanions.BadQuantity.selector);
        shop.buy(CAT, 11, 1e30);
        shop.buy(CAT, 10, 1e30);
        vm.stopPrank();
        assertEq(shop.balanceOf(alice, CAT), 10);
    }

    function test_needsAllowanceAndBalance() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(shop), 0, 100e18));
        shop.buy(CAT, 1, 100e18);
        address poor = makeAddr("poor");
        vm.prank(poor);
        stamp.approve(address(shop), 100e18);
        vm.prank(poor);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, poor, 0, 100e18));
        shop.buy(CAT, 1, 100e18);
        // Nothing changed for a failed buy.
        (,, uint32 minted,,,) = shop.kinds(CAT);
        assertEq(minted, 0);
        assertEq(shop.bought(poor, CAT), 0);
    }

    function test_buyWithPermit() public {
        uint256 cost = 250e18;
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(alicePk, address(shop), cost, deadline);
        vm.prank(alice);
        shop.buyWithPermit(UFO, 1, cost, deadline, v, r, s);
        assertEq(shop.balanceOf(alice, UFO), 1);
        assertEq(stamp.balanceOf(treasury), cost);
    }

    function test_permitUsedFirstStillBuys() public {
        uint256 cost = 250e18;
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(alicePk, address(shop), cost, deadline);
        // Someone sees the permit and submits it first: the buy still works on the allowance it set.
        stamp.permit(alice, address(shop), cost, deadline, v, r, s);
        vm.prank(alice);
        shop.buyWithPermit(UFO, 1, cost, deadline, v, r, s);
        assertEq(shop.balanceOf(alice, UFO), 1);
    }

    function test_reentrantBuyIsRefused() public {
        GreedyBuyer greedy = new GreedyBuyer(shop);
        stamp.mint(address(greedy), 1_000e18);
        greedy.go(CAT, 100e18);
        assertTrue(greedy.tried());
        assertEq(bytes4(greedy.buyError()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(shop.balanceOf(address(greedy), CAT), 1);
        assertEq(stamp.balanceOf(treasury), 100e18);
    }

    function test_contractThatCantReceiveRevertsWholeBuy() public {
        NoReceiver nr = new NoReceiver();
        stamp.mint(address(nr), 1_000e18);
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155InvalidReceiver.selector, address(nr)));
        nr.go(shop, CAT, 100e18);
        assertEq(stamp.balanceOf(treasury), 0, "no $STAMP moves when the mint fails");
        (,, uint32 minted,,,) = shop.kinds(CAT);
        assertEq(minted, 0);
    }

    // ---------------------------------------------------------------- the owner

    function test_onlyOwnerConfigures() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        shop.setKind(5, 1e18, 1, 0, true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        shop.setTreasury(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        shop.setBase("x");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        shop.setRoyalty(alice, 100);
        vm.stopPrank();
    }

    function test_supplyCanOnlyShrink() public {
        _buy(alice, MECHA, 1);
        vm.prank(owner);
        vm.expectRevert(CourierCompanions.SupplyCanOnlyShrink.selector);
        shop.setKind(MECHA, 2500e18, 31, 1, true); // grow
        _buy(bob, CAT, 3);
        vm.prank(owner);
        vm.expectRevert(CourierCompanions.SupplyCanOnlyShrink.selector);
        shop.setKind(CAT, 100e18, 2, 0, true); // below the three minted
    }

    function test_supplyCanShrinkToMintedButNotBelow() public {
        _buy(alice, MECHA, 1);
        vm.prank(owner);
        shop.setKind(MECHA, 2500e18, 1, 1, true);
        (, uint32 maxSupply,,,,) = shop.kinds(MECHA);
        assertEq(maxSupply, 1);
        vm.prank(bob);
        stamp.approve(address(shop), 2500e18);
        vm.prank(bob);
        vm.expectRevert(CourierCompanions.SoldOut.selector);
        shop.buy(MECHA, 1, 2500e18);
    }

    function test_badSettings() public {
        vm.startPrank(owner);
        vm.expectRevert(CourierCompanions.BadPrice.selector);
        shop.setKind(5, 0, 10, 0, true);
        vm.expectRevert(CourierCompanions.BadPrice.selector);
        shop.setKind(5, uint256(type(uint128).max) + 1, 10, 0, true);
        vm.expectRevert(CourierCompanions.BadSupply.selector);
        shop.setKind(5, 1e18, 0, 0, true);
        vm.expectRevert(CourierCompanions.BadSupply.selector);
        shop.setKind(5, 1e18, uint256(type(uint32).max) + 1, 0, true);
        vm.expectRevert(CourierCompanions.BadSupply.selector);
        shop.setKind(5, 1e18, 10, uint256(type(uint32).max) + 1, true);
        vm.expectRevert(CourierCompanions.ZeroAddress.selector);
        shop.setTreasury(address(0));
        vm.expectRevert(CourierCompanions.RoyaltyTooHigh.selector);
        shop.setRoyalty(treasury, 1001);
        vm.stopPrank();
    }

    function test_newTreasuryGetsTheNextSales() public {
        address next = makeAddr("next");
        vm.prank(owner);
        shop.setTreasury(next);
        _buy(alice, CAT, 1);
        assertEq(stamp.balanceOf(next), 100e18);
        assertEq(stamp.balanceOf(treasury), 0);
    }

    function test_kindsListedInOrder() public view {
        assertEq(shop.kindCount(), 3);
        (uint256[] memory ids, CourierCompanions.Kind[] memory list) = shop.allKinds();
        assertEq(ids[0], CAT);
        assertEq(ids[1], UFO);
        assertEq(ids[2], MECHA);
        assertEq(list[2].price, 2500e18);
        assertEq(list[1].perWallet, 2);
    }

    function test_editingAKindDoesntListItTwice() public {
        vm.prank(owner);
        shop.setKind(CAT, 90e18, 250, 5, true);
        assertEq(shop.kindCount(), 3);
        (uint128 price, uint32 maxSupply,, uint32 perWallet, bool open, bool exists) = shop.kinds(CAT);
        assertEq(price, 90e18);
        assertEq(maxSupply, 250);
        assertEq(perWallet, 5);
        assertTrue(open && exists);
    }

    function test_uriRoyaltyAndInterfaces() public {
        assertEq(shop.uri(CAT), "https://courierworld.fun/companions/1.json");
        vm.prank(owner);
        shop.setBase("ipfs://abc/");
        assertEq(shop.uri(MECHA), "ipfs://abc/31.json");
        (address to, uint256 fee) = shop.royaltyInfo(CAT, 1000e18);
        assertEq(to, treasury);
        assertEq(fee, 50e18);
        vm.prank(owner);
        shop.setRoyalty(owner, 1000);
        (to, fee) = shop.royaltyInfo(CAT, 1000e18);
        assertEq(to, owner);
        assertEq(fee, 100e18);
        assertTrue(shop.supportsInterface(type(IERC1155).interfaceId));
        assertTrue(shop.supportsInterface(type(IERC2981).interfaceId));
        assertEq(shop.name(), "Courier Companions");
        assertEq(shop.symbol(), "COMPANION");
    }

    function test_ownershipTransferIsTwoStep() public {
        vm.prank(owner);
        shop.transferOwnership(alice);
        assertEq(shop.owner(), owner);
        vm.prank(alice);
        shop.acceptOwnership();
        assertEq(shop.owner(), alice);
    }

    // ---------------------------------------------------------------- fuzz

    /// Whatever the price and quantity, the buyer pays exactly price × quantity, all to the treasury, and the counts add up.
    function testFuzz_paysExactlyAndCounts(uint96 price, uint8 qty, uint32 supply) public {
        qty = uint8(bound(qty, 1, 10));
        supply = uint32(bound(supply, qty, 1_000_000));
        price = uint96(bound(price, 1, 1e24));
        vm.prank(owner);
        shop.setKind(500, price, supply, 0, true);
        uint256 cost = uint256(price) * qty;
        stamp.mint(bob, cost);
        uint256 before = stamp.balanceOf(bob);
        vm.prank(bob);
        stamp.approve(address(shop), cost);
        vm.prank(bob);
        shop.buy(500, qty, cost);
        assertEq(before - stamp.balanceOf(bob), cost);
        assertEq(stamp.balanceOf(treasury), cost);
        assertEq(shop.balanceOf(bob, 500), qty);
        (,, uint32 minted,,,) = shop.kinds(500);
        assertEq(minted, qty);
    }

    function _permit(uint256 pk, address spender, uint256 value, uint256 deadline) internal view returns (uint8, bytes32, bytes32) {
        address holder = vm.addr(pk);
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
            holder, spender, value, stamp.nonces(holder), deadline
        ));
        return vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", stamp.DOMAIN_SEPARATOR(), structHash)));
    }
}
