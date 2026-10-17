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
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {CourierCars, ICreatorToken} from "../src/CourierCars.sol";
import {StampToken} from "../src/StampToken.sol";
import {DeployCars} from "../script/DeployCars.s.sol";

/// A contract wallet that tries to buy again while its companion is being minted to it.
contract CarGreedyBuyer is IERC1155Receiver {
    CourierCars public shop;
    bool public tried;
    bytes public buyError;

    constructor(CourierCars shop_) {
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

/// Acts like OpenSea's strict registry: holders may move their own companions; any other caller needs the
/// marketplace's fee check (here, `authorize`). Counts the checks it's asked for.
contract CarStrictValidator1155 {
    error UnauthorizedTransfer();

    mapping(address => bool) public authorized;
    uint256 public checks;

    function authorize(address operator, bool ok) external {
        authorized[operator] = ok;
    }

    function validateTransfer(address caller, address from, address, uint256, uint256) external {
        ++checks;
        if (caller != from && !authorized[caller]) revert UnauthorizedTransfer();
    }
}

/// A validator that refuses every transfer.
contract CarRefuseAll {
    function validateTransfer(address, address, address, uint256, uint256) external pure {
        revert("no transfers");
    }
}

/// A contract with no way to receive ERC-1155 tokens.
contract CarNoReceiver {
    function go(CourierCars shop, uint256 id, uint256 cost) external {
        shop.stamp().approve(address(shop), cost);
        shop.buy(id, 1, cost);
    }
}

contract CourierCarsTest is Test {
    StampToken stamp;
    CourierCars shop;
    CarStrictValidator1155 validator;

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
        validator = new CarStrictValidator1155();
        shop = new CourierCars(owner, address(stamp), treasury, address(validator), "https://courierworld.fun/cars/");
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
        emit CourierCars.Bought(alice, CAT, 3, 300e18);
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
        vm.expectRevert(abi.encodeWithSelector(CourierCars.PriceChanged.selector, 120e18));
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
        vm.expectRevert(CourierCars.SoldOut.selector);
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
        vm.expectRevert(CourierCars.WalletLimit.selector);
        shop.buy(UFO, 1, 250e18);
        // Bob holds two from her, and can still buy his own two.
        _buy(bob, UFO, 2);
        assertEq(shop.balanceOf(bob, UFO), 4);
    }

    function test_walletLimitOnOneBuy() public {
        vm.prank(alice);
        stamp.approve(address(shop), 750e18);
        vm.prank(alice);
        vm.expectRevert(CourierCars.WalletLimit.selector);
        shop.buy(UFO, 3, 750e18);
    }

    function test_closedKind() public {
        vm.prank(owner);
        shop.setKind(CAT, 100e18, 300, 0, false);
        vm.prank(alice);
        stamp.approve(address(shop), 100e18);
        vm.prank(alice);
        vm.expectRevert(CourierCars.Closed.selector);
        shop.buy(CAT, 1, 100e18);
    }

    function test_unknownKind() public {
        vm.prank(alice);
        vm.expectRevert(CourierCars.UnknownKind.selector);
        shop.buy(999, 1, 1e30);
    }

    function test_quantityBounds() public {
        vm.prank(alice);
        stamp.approve(address(shop), type(uint256).max);
        vm.startPrank(alice);
        vm.expectRevert(CourierCars.BadQuantity.selector);
        shop.buy(CAT, 0, 1e30);
        vm.expectRevert(CourierCars.BadQuantity.selector);
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
        CarGreedyBuyer greedy = new CarGreedyBuyer(shop);
        stamp.mint(address(greedy), 1_000e18);
        greedy.go(CAT, 100e18);
        assertTrue(greedy.tried());
        assertEq(bytes4(greedy.buyError()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(shop.balanceOf(address(greedy), CAT), 1);
        assertEq(stamp.balanceOf(treasury), 100e18);
    }

    function test_contractThatCantReceiveRevertsWholeBuy() public {
        CarNoReceiver nr = new CarNoReceiver();
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
        vm.stopPrank();
    }

    function test_supplyCanOnlyShrink() public {
        _buy(alice, MECHA, 1);
        vm.prank(owner);
        vm.expectRevert(CourierCars.SupplyCanOnlyShrink.selector);
        shop.setKind(MECHA, 2500e18, 31, 1, true); // grow
        _buy(bob, CAT, 3);
        vm.prank(owner);
        vm.expectRevert(CourierCars.SupplyCanOnlyShrink.selector);
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
        vm.expectRevert(CourierCars.SoldOut.selector);
        shop.buy(MECHA, 1, 2500e18);
    }

    function test_badSettings() public {
        vm.startPrank(owner);
        vm.expectRevert(CourierCars.BadPrice.selector);
        shop.setKind(5, 0, 10, 0, true);
        vm.expectRevert(CourierCars.BadPrice.selector);
        shop.setKind(5, uint256(type(uint128).max) + 1, 10, 0, true);
        vm.expectRevert(CourierCars.BadSupply.selector);
        shop.setKind(5, 1e18, 0, 0, true);
        vm.expectRevert(CourierCars.BadSupply.selector);
        shop.setKind(5, 1e18, uint256(type(uint32).max) + 1, 0, true);
        vm.expectRevert(CourierCars.BadSupply.selector);
        shop.setKind(5, 1e18, 10, uint256(type(uint32).max) + 1, true);
        vm.expectRevert(CourierCars.ZeroAddress.selector);
        shop.setTreasury(address(0));
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
        (uint256[] memory ids, CourierCars.Kind[] memory list) = shop.allKinds();
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
        assertEq(shop.uri(CAT), "https://courierworld.fun/cars/1.json");
        vm.prank(owner);
        shop.setBase("ipfs://abc/");
        assertEq(shop.uri(MECHA), "ipfs://abc/31.json");
        (address to, uint256 fee) = shop.royaltyInfo(CAT, 1000e18);
        assertEq(to, treasury);
        assertEq(fee, 50e18);

        assertTrue(shop.supportsInterface(type(IERC1155).interfaceId));
        assertTrue(shop.supportsInterface(type(IERC2981).interfaceId));
        assertEq(shop.name(), "Courier Cars");
        assertEq(shop.symbol(), "CAR");
    }

    function test_ownershipTransferIsTwoStep() public {
        vm.prank(owner);
        shop.transferOwnership(alice);
        assertEq(shop.owner(), owner);
        vm.prank(alice);
        shop.acceptOwnership();
        assertEq(shop.owner(), alice);
    }

    // ---------------------------------------------------------------- after the audit (IMD job 145af84f)

    function test_setTreasuryMovesTheRoyalty() public {
        address next = makeAddr("next");
        vm.prank(owner);
        shop.setTreasury(next);
        (address to, uint256 fee) = shop.royaltyInfo(CAT, 1000e18);
        assertEq(to, next);
        assertEq(fee, 50e18);
    }

    /// The royalty is a fixed 5%, always to the treasury: there's no way to change the rate or send it elsewhere.
    function test_royaltyIsFixedAndFollowsTheTreasury() public {
        assertEq(shop.ROYALTY_BPS(), 500);
        (address to, uint256 fee) = shop.royaltyInfo(CAT, 1000e18);
        assertEq(to, treasury);
        assertEq(fee, 50e18);
        address next = makeAddr("next");
        vm.prank(owner);
        shop.setTreasury(next);
        (to, fee) = shop.royaltyInfo(MECHA, 2000e18);
        assertEq(to, next);
        assertEq(fee, 100e18);
        (bool ok,) = address(shop).call(abi.encodeWithSignature("setRoyalty(address,uint96)", owner, uint96(1000)));
        assertFalse(ok); // (no such function)
    }

    function test_cannotRenounce() public {
        vm.prank(owner);
        vm.expectRevert(CourierCars.CannotRenounce.selector);
        shop.renounceOwnership();
        assertEq(shop.owner(), owner);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        shop.renounceOwnership();
    }

    function test_treasuryCantBeTheShop() public {
        vm.prank(owner);
        vm.expectRevert(CourierCars.BadTreasury.selector);
        shop.setTreasury(address(shop));
        address next = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        vm.expectRevert(CourierCars.BadTreasury.selector);
        new CourierCars(owner, address(stamp), next, address(validator), "x/");
    }


    function test_badPermitRevertsPermitFailed() public {
        uint256 deadline = block.timestamp + 1 hours;
        // Signed for less than the buy needs.
        (uint8 v, bytes32 r, bytes32 s) = _permit(alicePk, address(shop), 249e18, deadline);
        vm.prank(alice);
        vm.expectRevert(CourierCars.PermitFailed.selector);
        shop.buyWithPermit(UFO, 1, 250e18, deadline, v, r, s);
        // Signed for another spender.
        (v, r, s) = _permit(alicePk, bob, 250e18, deadline);
        vm.prank(alice);
        vm.expectRevert(CourierCars.PermitFailed.selector);
        shop.buyWithPermit(UFO, 1, 250e18, deadline, v, r, s);
        assertEq(stamp.nonces(alice), 0, "nothing was used up");
    }

    function test_expiredPermitRevertsPermitFailed() public {
        uint256 deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _permit(alicePk, address(shop), 250e18, deadline);
        vm.prank(alice);
        vm.expectRevert(CourierCars.PermitFailed.selector);
        shop.buyWithPermit(UFO, 1, 250e18, deadline, v, r, s);
    }

    function test_permitForTheExactCostLeavesNoAllowance() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(alicePk, address(shop), 250e18, deadline);
        vm.prank(alice);
        shop.buyWithPermit(UFO, 1, 250e18, deadline, v, r, s);
        assertEq(stamp.allowance(alice, address(shop)), 0);
    }

    function test_permitSlackStaysApprovedButOnlyForItsOwnBuys() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(alicePk, address(shop), 400e18, deadline);
        vm.prank(alice);
        shop.buyWithPermit(UFO, 1, 400e18, deadline, v, r, s);
        assertEq(stamp.allowance(alice, address(shop)), 150e18);
        // Bob can't spend Alice's leftover allowance: his buy pulls from his own wallet.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(shop), 0, 250e18));
        shop.buy(UFO, 1, 250e18);
        assertEq(stamp.balanceOf(alice), 100_000e18 - 250e18);
    }

    function test_rescueReturnsTokensSentByMistake() public {
        vm.prank(bob);
        stamp.transfer(address(shop), 77e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        shop.rescue(stamp, alice);
        vm.prank(owner);
        vm.expectRevert(CourierCars.ZeroAddress.selector);
        shop.rescue(stamp, address(0));
        vm.prank(owner);
        shop.rescue(stamp, bob);
        assertEq(stamp.balanceOf(address(shop)), 0);
        assertEq(stamp.balanceOf(bob), 100_000e18);
    }

    function test_contractURI() public {
        assertEq(shop.contractURI(), "https://courierworld.fun/cars/collection.json");
        vm.expectEmit(false, false, false, false);
        emit CourierCars.ContractURIUpdated();
        vm.prank(owner);
        shop.setBase("ipfs://new/");
        assertEq(shop.contractURI(), "ipfs://new/collection.json");
    }

    function test_newKindAnnouncesItsURI() public {
        vm.expectEmit(true, false, false, true);
        emit IERC1155.URI("https://courierworld.fun/cars/7.json", 7);
        vm.prank(owner);
        shop.setKind(7, 1e18, 10, 0, true);
    }

    function test_batchTransferAndBalances() public {
        _buy(alice, CAT, 3);
        _buy(alice, UFO, 2);
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        (ids[0], ids[1], amounts[0], amounts[1]) = (CAT, UFO, 2, 1);
        vm.prank(alice);
        shop.safeBatchTransferFrom(alice, bob, ids, amounts, "");
        address[] memory who = new address[](4);
        uint256[] memory which = new uint256[](4);
        (who[0], who[1], who[2], who[3]) = (alice, alice, bob, bob);
        (which[0], which[1], which[2], which[3]) = (CAT, UFO, CAT, UFO);
        uint256[] memory bal = shop.balanceOfBatch(who, which);
        assertEq(bal[0], 1);
        assertEq(bal[1], 1);
        assertEq(bal[2], 2);
        assertEq(bal[3], 1);
        assertEq(shop.bought(bob, CAT), 0, "receiving isn't buying");
    }

    // ---------------------------------------------------------------- royalty enforcement

    function test_marketplacesSeeTheEnforcement() public view {
        assertTrue(shop.supportsInterface(0xad0d7f6c), "ICreatorToken (v3)");
        assertEq(shop.getTransferValidator(), address(validator));
        (bytes4 fn, bool isView) = shop.getTransferValidationFunction();
        assertEq(fn, bytes4(keccak256("validateTransfer(address,address,address,uint256,uint256)")));
        assertFalse(isView, "the registry counts down authorized amounts");
    }

    function test_holdersCanMoveTheirOwnCompanions() public {
        _buy(alice, CAT, 2);
        vm.prank(alice);
        shop.safeTransferFrom(alice, bob, CAT, 1, "");
        assertEq(shop.balanceOf(bob, CAT), 1);
        assertEq(validator.checks(), 1);
    }

    function test_marketplacesNeedTheFeeCheck() public {
        _buy(alice, CAT, 2);
        address market = makeAddr("market");
        vm.prank(alice);
        shop.setApprovalForAll(market, true);
        vm.prank(market);
        vm.expectRevert(CarStrictValidator1155.UnauthorizedTransfer.selector);
        shop.safeTransferFrom(alice, bob, CAT, 1, "");
        validator.authorize(market, true);
        vm.prank(market);
        shop.safeTransferFrom(alice, bob, CAT, 1, "");
        assertEq(shop.balanceOf(bob, CAT), 1);
    }

    function test_batchTransfersAreCheckedKindByKind() public {
        _buy(alice, CAT, 2);
        _buy(alice, UFO, 1);
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        (ids[0], ids[1], amounts[0], amounts[1]) = (CAT, UFO, 2, 1);
        address market = makeAddr("market");
        vm.prank(alice);
        shop.setApprovalForAll(market, true);
        vm.prank(market);
        vm.expectRevert(CarStrictValidator1155.UnauthorizedTransfer.selector);
        shop.safeBatchTransferFrom(alice, bob, ids, amounts, "");
        uint256 before = validator.checks();
        vm.prank(alice);
        shop.safeBatchTransferFrom(alice, bob, ids, amounts, "");
        assertEq(validator.checks() - before, 2);
    }

    /// Buys mint, and mints never ask the validator: not even one that refuses everything can stop a sale.
    function test_buysNeverTouchTheValidator() public {
        CarRefuseAll refuse = new CarRefuseAll();
        vm.prank(owner);
        shop.setTransferValidator(address(refuse));
        _buy(alice, CAT, 1);
        assertEq(shop.balanceOf(alice, CAT), 1);
        vm.prank(alice);
        vm.expectRevert("no transfers");
        shop.safeTransferFrom(alice, bob, CAT, 1, "");
    }

    function test_enforcementCanMoveButNeverBeSwitchedOff() public {
        vm.startPrank(owner);
        vm.expectRevert(CourierCars.NotAContract.selector);
        shop.setTransferValidator(address(0));
        vm.expectRevert(CourierCars.NotAContract.selector);
        shop.setTransferValidator(makeAddr("eoa"));
        CarStrictValidator1155 next = new CarStrictValidator1155();
        vm.expectEmit(false, false, false, true);
        emit ICreatorToken.TransferValidatorUpdated(address(validator), address(next));
        shop.setTransferValidator(address(next));
        vm.stopPrank();
        assertEq(shop.getTransferValidator(), address(next));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        shop.setTransferValidator(address(validator));
        vm.expectRevert(CourierCars.NotAContract.selector);
        new CourierCars(owner, address(stamp), treasury, makeAddr("eoa"), "x/");
    }

    /// The deploy script's lineup, as it will go on sale: 19 cars in four tiers, each with a wallet limit.
    function test_deployLineup() public {
        DeployCars script = new DeployCars();
        DeployCars.Lineup[19] memory l = script.lineup();
        uint256[19] memory ids = [uint256(1), 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 21, 22, 23, 24, 31, 32, 33, 34];
        for (uint256 i; i < 19; ++i) {
            assertEq(l[i].id, ids[i]);
            // Common 1-6, Rare 11-15, Epic 21-24, Legendary 31-34 (web/car-kinds.js TIER_TERMS).
            (uint256 p, uint256 sup, uint256 lim) = ids[i] < 10 ? (500, 300, 5) : ids[i] < 20 ? (1500, 100, 3) : ids[i] < 30 ? (4000, 30, 2) : (10000, 10, 1);
            assertEq(l[i].price, p);
            assertEq(l[i].supply, sup);
            assertEq(l[i].perWallet, lim);
        }
        // And it runs: deployed by the broadcaster, who owns it, with the whole lineup open (set in one call).
        vm.setEnv("STAMP", vm.toString(address(stamp)));
        vm.setEnv("TREASURY", vm.toString(treasury));
        CourierCars deployed = script.run();
        assertEq(deployed.owner(), DEFAULT_SENDER);
        assertEq(deployed.kindCount(), 19);
        assertEq(deployed.treasury(), treasury);
        assertEq(deployed.name(), "Courier Cars");
        assertEq(deployed.symbol(), "CAR");
        (uint128 price, uint32 maxSupply,, uint32 perWallet, bool open,) = deployed.kinds(34);
        assertEq(price, 10000e18);
        assertEq(maxSupply, 10);
        assertEq(perWallet, 1);
        assertTrue(open);
        (price, maxSupply,, perWallet, open,) = deployed.kinds(1);
        assertEq(price, 500e18);
        assertEq(maxSupply, 300);
        assertEq(perWallet, 5);
        assertTrue(open);
        (address to, uint256 fee) = deployed.royaltyInfo(34, 1000e18);
        assertEq(to, treasury);
        assertEq(fee, 50e18);
        assertGt(deployed.getTransferValidator().code.length, 0);
    }

    /// setKinds: the owner only, the lists the same length, each kind under setKind's own rules.
    function test_setKinds() public {
        uint256[] memory ids = new uint256[](2);
        uint256[] memory prices = new uint256[](2);
        uint256[] memory supplies = new uint256[](2);
        uint256[] memory limits = new uint256[](2);
        (ids[0], ids[1], prices[0], prices[1], supplies[0], supplies[1], limits[0], limits[1]) = (101, 102, 5e18, 7e18, 10, 20, 1, 2);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        shop.setKinds(ids, prices, supplies, limits, true);
        vm.prank(owner);
        shop.setKinds(ids, prices, supplies, limits, true);
        (uint128 price, uint32 maxSupply,, uint32 perWallet, bool open,) = shop.kinds(102);
        assertEq(price, 7e18);
        assertEq(maxSupply, 20);
        assertEq(perWallet, 2);
        assertTrue(open);
        // Same rules as setKind: a supply can only shrink.
        supplies[0] = 11;
        vm.prank(owner);
        vm.expectRevert(CourierCars.SupplyCanOnlyShrink.selector);
        shop.setKinds(ids, prices, supplies, limits, true);
        // Lists of different lengths are refused.
        uint256[] memory one = new uint256[](1);
        vm.prank(owner);
        vm.expectRevert(CourierCars.BadLength.selector);
        shop.setKinds(ids, prices, one, limits, true);
        prices[0] = 0;
        supplies[0] = 10;
        vm.prank(owner);
        vm.expectRevert(CourierCars.BadPrice.selector);
        shop.setKinds(ids, prices, supplies, limits, true);
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

/// The registry's side of OpenSea's fee-checked ERC-1155 sales, called by the SignedZone around a transfer.
interface IAuthorizer1155 {
    function beforeAuthorizedTransferWithAmount(address token, uint256 tokenId, uint256 amount) external;
    function afterAuthorizedTransferWithAmount(address token, uint256 tokenId) external;
}

/// Stand-in for the SignedZone's calls around a sale of `amount` of kind `id`.
contract CompanionZoneFlow {
    function sell(address registry, address token, address market, address from, address to, uint256 id, uint256 amount) external {
        IAuthorizer1155(registry).beforeAuthorizedTransferWithAmount(token, id, amount);
        CompanionMarketMove(market).move(token, from, to, id, amount);
        IAuthorizer1155(registry).afterAuthorizedTransferWithAmount(token, id);
    }
}

/// Stand-in for the marketplace moving what was sold.
contract CompanionMarketMove {
    function move(address token, address from, address to, uint256 id, uint256 amount) external {
        IERC1155(token).safeTransferFrom(from, to, id, amount, "");
    }
}

/// @notice Against OpenSea's real creator fee enforcement registry on Robinhood Chain.
///   forge test --match-contract CourierCarsForkTest --fork-url robinhood
/// Skipped when not forked.
contract CourierCarsForkTest is Test {
    address constant REGISTRY = 0xA000027A9B2802E1ddf7000061001e5c005A0000; // StrictAuthorizedTransferSecurityRegistry
    address constant SEAPORT = 0x0000000000000068F116a894984e2DB1123eB395; // Seaport 1.6
    bytes4 constant UNAUTHORIZED = 0x1de5204e; // StrictAuthorizedTransferSecurityRegistry__UnauthorizedTransfer()
    address constant SIGNED_ZONE = 0x000056F7000000EcE9003ca63978907a00FFD100; // OpenSea's SignedZone
    uint256 constant CAT = 1;

    StampToken stamp;
    CourierCars shop;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        if (block.chainid != 4663) return;
        stamp = new StampToken(owner, address(0), 0);
        vm.prank(owner);
        stamp.setMinter(address(this));
        stamp.mint(alice, 1000e18);
        shop = new CourierCars(owner, address(stamp), makeAddr("treasury"), REGISTRY, "https://courierworld.fun/cars/");
        vm.prank(owner);
        shop.setKind(CAT, 100e18, 300, 5, true);
        vm.startPrank(alice);
        stamp.approve(address(shop), 300e18);
        shop.buy(CAT, 3, 300e18);
        vm.stopPrank();
    }

    function test_Fork_HolderTransfersPass() public {
        if (block.chainid != 4663) return;
        vm.prank(alice);
        shop.safeTransferFrom(alice, bob, CAT, 1, "");
        assertEq(shop.balanceOf(bob, CAT), 1);
    }

    /// A real OpenSea sale, as one transaction like Seaport runs it: the SignedZone (which checks the order pays the
    /// creator fee) authorizes an amount of the kind on the live registry, the approved marketplace moves it, and the
    /// zone clears the authorization. The zone and Seaport addresses get stand-in code that makes exactly those calls.
    function test_Fork_SaleAuthorizedByOpenSeaGoesThrough() public {
        if (block.chainid != 4663) return;
        vm.etch(SIGNED_ZONE, address(new CompanionZoneFlow()).code);
        vm.etch(SEAPORT, address(new CompanionMarketMove()).code);
        vm.prank(alice);
        shop.setApprovalForAll(SEAPORT, true);
        CompanionZoneFlow(SIGNED_ZONE).sell(REGISTRY, address(shop), SEAPORT, alice, bob, CAT, 2);
        assertEq(shop.balanceOf(bob, CAT), 2);
        // Without the zone, the same marketplace is refused.
        vm.prank(SEAPORT);
        vm.expectRevert(UNAUTHORIZED);
        shop.safeTransferFrom(alice, bob, CAT, 1, "");
    }

    /// The zone authorizes an amount: a marketplace can't move more than was sold.
    function test_Fork_SaleCantMoveMoreThanAuthorized() public {
        if (block.chainid != 4663) return;
        vm.etch(SEAPORT, address(new CompanionMarketMove()).code);
        vm.prank(alice);
        shop.setApprovalForAll(SEAPORT, true);
        vm.startPrank(SIGNED_ZONE);
        IAuthorizer1155(REGISTRY).beforeAuthorizedTransferWithAmount(address(shop), CAT, 1);
        vm.stopPrank();
        vm.expectRevert(UNAUTHORIZED);
        CompanionMarketMove(SEAPORT).move(address(shop), alice, bob, CAT, 2);
        assertEq(shop.balanceOf(alice, CAT), 3);
    }

    /// Only an authorizer on the collection's list (OpenSea's zone on the default list) can authorize.
    function test_Fork_StrangersCantAuthorize() public {
        if (block.chainid != 4663) return;
        vm.etch(SEAPORT, address(new CompanionMarketMove()).code);
        CompanionZoneFlow stranger = new CompanionZoneFlow();
        vm.prank(alice);
        shop.setApprovalForAll(SEAPORT, true);
        vm.expectRevert();
        stranger.sell(REGISTRY, address(shop), SEAPORT, alice, bob, CAT, 1);
        assertEq(shop.balanceOf(alice, CAT), 3);
    }

    /// Seaport, or any approved operator, can't move a companion outside OpenSea's fee-checked flow.
    function test_Fork_MarketplaceWithoutFeeCheckReverts() public {
        if (block.chainid != 4663) return;
        address otherMarket = makeAddr("otherMarket");
        vm.startPrank(alice);
        shop.setApprovalForAll(SEAPORT, true);
        shop.setApprovalForAll(otherMarket, true);
        vm.stopPrank();
        vm.prank(SEAPORT);
        vm.expectRevert(UNAUTHORIZED);
        shop.safeTransferFrom(alice, bob, CAT, 1, "");
        vm.prank(otherMarket);
        vm.expectRevert(UNAUTHORIZED);
        shop.safeTransferFrom(alice, bob, CAT, 1, "");
        assertEq(shop.balanceOf(alice, CAT), 3);
    }
}
