// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {CourierCars} from "../src/CourierCars.sol";
import {StampToken} from "../src/StampToken.sol";
import {DevTransferValidator} from "../script/DevTransferValidator.sol";

/// Random buyers buying random kinds (with an approval or a permit, sometimes offering too little), passing
/// companions to each other, and the owner adding kinds and changing prices, supplies and limits between buys. Every
/// call's outcome is predicted first: a revert other than the one expected (or a success where one was expected) is
/// recorded, and `invariant_noSurprises` fails on it, so nothing is hidden by the fuzzer ignoring reverts.
contract CarHandler is Test {
    CourierCars public shop;
    StampToken public stamp;
    address public owner;
    address[] public buyers;
    uint256[] keys;
    uint256[] public ids;
    uint256 public paid; // $STAMP the buys moved, by the handler's own count
    mapping(uint256 id => uint256) public boughtTotal; // companions bought, by the handler's own count
    bytes4 public surprise; // the first unexpected outcome (a revert's selector, or SUCCEEDED), if any
    string public surpriseAt;
    uint256 public buys;
    uint256 public permitBuys;
    uint256 public transfers;

    mapping(bytes4 outcome => uint256) public outcomes; // every predicted outcome, tallied (0: success)

    bytes4 constant SUCCEEDED = 0xffffffff; // a call that should have reverted didn't

    constructor(CourierCars shop_, StampToken stamp_, address owner_) {
        shop = shop_;
        stamp = stamp_;
        owner = owner_;
        for (uint256 i; i < 4; ++i) {
            (address b, uint256 pk) = makeAddrAndKey(string.concat("buyer", vm.toString(i)));
            buyers.push(b);
            keys.push(pk);
        }
        for (uint256 i; i < 6; ++i) ids.push(i + 1); // 1-5 on sale from the start; 6 only once `configure` adds it
    }

    /// What a buy of `qty` of `id` by `b` for at most `maxCost` should revert with (0: it should go through).
    function _expectedBuy(address b, uint256 id, uint256 qty, uint256 maxCost) internal view returns (bytes4) {
        (uint128 price, uint32 maxSupply, uint32 minted, uint32 perWallet, bool open, bool exists) = shop.kinds(id);
        if (!exists) return CourierCars.UnknownKind.selector;
        if (!open) return CourierCars.Closed.selector;
        if (uint256(minted) + qty > maxSupply) return CourierCars.SoldOut.selector;
        if (perWallet != 0 && shop.bought(b, id) + qty > perWallet) return CourierCars.WalletLimit.selector;
        if (uint256(price) * qty > maxCost) return CourierCars.PriceChanged.selector;
        return 0;
    }

    function _check(bytes4 expected, bytes4 got, string memory where) internal {
        ++outcomes[got];
        if (expected != got && surprise == 0) {
            surprise = got;
            surpriseAt = where;
        }
    }

    function _pick(uint256 who, uint256 which, uint256 qty) internal view returns (address b, uint256 id, uint256 q, uint256 price) {
        b = buyers[who % buyers.length];
        id = ids[which % ids.length];
        q = bound(qty, 1, 10);
        (price,,,,,) = shop.kinds(id);
    }

    function _bought(uint256 id, uint256 qty, uint256 cost) internal {
        paid += cost;
        boughtTotal[id] += qty;
        ++buys;
    }

    /// Top a buyer up to `amount` (only the shortfall: $STAMP is capped at 21M, and failed buys leave theirs behind).
    function _fund(address b, uint256 amount) internal {
        uint256 have = stamp.balanceOf(b);
        if (have < amount) stamp.mint(b, amount - have);
    }

    function buy(uint256 who, uint256 which, uint256 qty, uint256 slack) external {
        (address b, uint256 id, uint256 q, uint256 price) = _pick(who, which, qty);
        uint256 cost = price * q;
        // Mostly a fair offer (the cost plus up to 1,000 $STAMP of slack), one time in five 1 wei short.
        uint256 maxCost = slack % 5 == 0 && cost > 0 ? cost - 1 : cost + bound(slack, 0, 1e21);
        _fund(b, cost);
        vm.prank(b);
        stamp.approve(address(shop), maxCost);
        bytes4 expected = _expectedBuy(b, id, q, maxCost);
        vm.prank(b);
        try shop.buy(id, q, maxCost) {
            _check(expected, 0, "buy");
            _bought(id, q, cost);
        } catch (bytes memory err) {
            _check(expected, bytes4(err), "buy");
        }
        vm.prank(b);
        stamp.approve(address(shop), 0);
    }

    function buyWithPermit(uint256 who, uint256 which, uint256 qty, uint256 slack) external {
        (address b, uint256 id, uint256 q, uint256 price) = _pick(who, which, qty);
        bool badSignature = slack % 5 == 0; // one time in five
        uint256 cost = price * q;
        uint256 maxCost = cost + bound(slack, 0, 1e21);
        _fund(b, cost);
        uint256 deadline = block.timestamp + 1 hours;
        // A bad signature is one for a different amount than the buy names: the permit fails, and with no allowance
        // left from before (every action clears it), the buy has to revert PermitFailed (if nothing else stops it).
        uint256 signedFor = badSignature ? maxCost + 1 : maxCost;
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
            b, address(shop), signedFor, stamp.nonces(b), deadline
        ));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(keys[who % keys.length], keccak256(abi.encodePacked("\x19\x01", stamp.DOMAIN_SEPARATOR(), structHash)));
        bytes4 expected = _expectedBuy(b, id, q, maxCost);
        if (expected == 0 && badSignature && cost > 0) expected = CourierCars.PermitFailed.selector;
        vm.prank(b);
        try shop.buyWithPermit(id, q, maxCost, deadline, v, r, s) {
            _check(expected, 0, "buyWithPermit");
            _bought(id, q, cost);
            ++permitBuys;
            // Whatever the permit allowed beyond the cost is still approved, to this shop only.
            assertEq(stamp.allowance(b, address(shop)), maxCost - cost);
        } catch (bytes memory err) {
            _check(expected, bytes4(err), "buyWithPermit");
        }
        vm.prank(b);
        stamp.approve(address(shop), 0);
    }

    /// Companions passed between buyers: the holder's balance moves, but no one's purchase count does.
    function transfer(uint256 from, uint256 to, uint256 which, uint256 amount) external {
        address a = buyers[from % buyers.length];
        address b = buyers[to % buyers.length];
        uint256 id = ids[which % ids.length];
        amount = bound(amount, 0, shop.balanceOf(a, id));
        uint256 boughtA = shop.bought(a, id);
        uint256 boughtB = shop.bought(b, id);
        vm.prank(a);
        try shop.safeTransferFrom(a, b, id, amount, "") {
            _check(0, 0, "transfer");
            ++transfers;
        } catch (bytes memory err) {
            _check(0, bytes4(err), "transfer");
        }
        assertEq(shop.bought(a, id), boughtA);
        assertEq(shop.bought(b, id), boughtB);
    }

    /// The owner adding or changing a kind: mostly a new price, limit or sale state at the same supply (on sale four
    /// times in five); one time in eight a shrink it's allowed; and one time in eight any supply at all, to try
    /// growing it or cutting below what's been minted.
    function configure(uint256 which, uint256 price, uint256 supply, uint256 perWallet, uint256 mode) external {
        uint256 id = ids[which % ids.length];
        price = bound(price, 1, 5_000e18); // from 1 wei to well above the lineup's dearest (3,000 $STAMP)
        perWallet = bound(perWallet, 0, 20);
        bool open = mode % 5 != 0;
        (, uint32 maxSupply, uint32 minted,,, bool exists) = shop.kinds(id);
        if (!exists || mode % 8 == 0) supply = bound(supply, 1, 500);
        else if (mode % 8 == 1) supply = bound(supply, minted == 0 ? 1 : minted, maxSupply);
        else supply = maxSupply;
        bytes4 expected = exists && (supply > maxSupply || supply < minted) ? CourierCars.SupplyCanOnlyShrink.selector : bytes4(0);
        vm.prank(owner);
        try shop.setKind(id, price, supply, perWallet, open) {
            _check(expected, 0, "configure");
            (uint128 p, uint32 ms, uint32 m, uint32 pw, bool o, bool e) = shop.kinds(id);
            assertEq(p, price);
            assertEq(ms, supply);
            assertEq(m, minted, "configuring never mints");
            assertEq(pw, perWallet);
            assertEq(o, open);
            assertTrue(e);
        } catch (bytes memory err) {
            _check(expected, bytes4(err), "configure");
        }
    }

    function buyerCount() external view returns (uint256) {
        return buyers.length;
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }
}

/// (The handler predicts every outcome and never reverts itself, so a revert in it is a failure too.)
/// forge-config: default.invariant.fail-on-revert = true
contract CourierCarsInvariantTest is Test {
    StampToken stamp;
    CourierCars shop;
    CarHandler handler;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");

    function setUp() public {
        stamp = new StampToken(owner, address(0), 0);
        shop = new CourierCars(owner, address(stamp), treasury, address(new DevTransferValidator()), "https://courierworld.fun/cars/");
        handler = new CarHandler(shop, stamp, owner);
        vm.prank(owner);
        stamp.setMinter(address(handler));
        vm.startPrank(owner);
        for (uint256 i = 1; i <= 5; ++i) shop.setKind(i, i * 100e18, 50 * i, i % 3, true);
        vm.stopPrank();
        targetContract(address(handler));
    }

    /// Every call did exactly what was predicted: the right revert, or success.
    function invariant_noSurprises() public view {
        assertEq(handler.surprise(), bytes4(0), handler.surpriseAt());
    }

    /// No kind ever has more minted than its supply; every minted companion was bought, at most once per buy, and is in
    /// a buyer's wallet.
    function invariant_supplyHolds() public view {
        for (uint256 i; i < handler.idCount(); ++i) {
            uint256 id = handler.ids(i);
            (, uint32 maxSupply, uint32 minted,,,) = shop.kinds(id);
            assertLe(minted, maxSupply);
            assertEq(minted, handler.boughtTotal(id));
            uint256 held;
            uint256 bought;
            for (uint256 j; j < handler.buyerCount(); ++j) {
                held += shop.balanceOf(handler.buyers(j), id);
                bought += shop.bought(handler.buyers(j), id);
            }
            assertEq(held, minted, "every companion is in a buyer's wallet");
            assertEq(bought, minted, "the purchase counts add up to what was minted");
        }
    }

    /// Every $STAMP paid went to the treasury; the shop never keeps any.
    function invariant_allStampToTheTreasury() public view {
        assertEq(stamp.balanceOf(treasury), handler.paid());
        assertEq(stamp.balanceOf(address(shop)), 0);
    }

    /// The owner, the treasury and the royalty never move unless the owner moves them (and the handler never does).
    function invariant_ownerAndTreasuryStay() public view {
        assertEq(shop.owner(), owner);
        assertEq(shop.treasury(), treasury);
        (address to,) = shop.royaltyInfo(1, 1e18);
        assertEq(to, treasury);
    }

    function afterInvariant() public view {
        // (Shown with -vv: proof the fuzzer reached the interesting paths.)
        console2.log("buys", handler.buys(), "permit buys", handler.permitBuys());
        console2.log("transfers", handler.transfers());
        console2.log("calls that succeeded", handler.outcomes(0));
        console2.log("UnknownKind", handler.outcomes(CourierCars.UnknownKind.selector), "Closed", handler.outcomes(CourierCars.Closed.selector));
        console2.log("SoldOut", handler.outcomes(CourierCars.SoldOut.selector), "WalletLimit", handler.outcomes(CourierCars.WalletLimit.selector));
        console2.log("PriceChanged", handler.outcomes(CourierCars.PriceChanged.selector), "PermitFailed", handler.outcomes(CourierCars.PermitFailed.selector));
        console2.log("SupplyCanOnlyShrink", handler.outcomes(CourierCars.SupplyCanOnlyShrink.selector));
    }
}
