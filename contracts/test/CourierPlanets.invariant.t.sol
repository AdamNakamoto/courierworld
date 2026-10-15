// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {CourierPlanets} from "../src/CourierPlanets.sol";
import {StampToken} from "../src/StampToken.sol";
import {DevTransferValidator} from "../script/DevTransferValidator.sol";

/// Random buyers buying planets (with an approval or a permit, sometimes offering too little), passing them to each
/// other, setting tickets (sometimes on planets they don't own, or dearer than allowed), visiting (with an approval or
/// a permit), a marketplace that skips the fee check trying to move planets, and the owner changing the price, the
/// wallet limit, the sale and the treasury's share between calls. Every call's outcome is predicted first: a revert
/// other than the one expected (or a success where one was expected) is recorded, and `invariant_noSurprises` fails on
/// it, so nothing is hidden by the fuzzer ignoring reverts.
contract PlanetsHandler is Test {
    CourierPlanets public planets;
    StampToken public stamp;
    address public owner;
    address public treasury;
    address public market = makeAddr("market"); // approved by every buyer, never through the fee check
    address public early = makeAddr("early"); // bought planets before the run (see `seed`)
    address[] public buyers;
    uint256[] keys;
    uint256 public salesPaid; // $STAMP the buys moved, by the handler's own count
    uint256 public ticketsPaid; // $STAMP visitors paid
    uint256 public ticketsToOwners;
    uint256 public ticketsToTreasury;
    uint256 public minted; // planets bought, by the handler's own count
    /// Who set each planet's ticket, if it has one: it must always be the planet's current owner.
    mapping(uint256 id => address) public setBy;
    bytes4 public surprise; // the first unexpected outcome (a revert's selector, or SUCCEEDED), if any
    string public surpriseAt;
    uint256 public buys;
    uint256 public permitBuys;
    uint256 public visits;
    uint256 public permitVisits;
    uint256 public paidVisits;
    uint256 public transfers;
    uint256 public closedByTransfer; // tickets a change of hands cleared

    mapping(bytes4 outcome => uint256) public outcomes; // every predicted outcome, tallied (0: success)

    bytes4 constant SUCCEEDED = 0xffffffff; // a call that should have reverted didn't

    constructor(CourierPlanets planets_, StampToken stamp_, address owner_, address treasury_) {
        planets = planets_;
        stamp = stamp_;
        owner = owner_;
        treasury = treasury_;
        for (uint256 i; i < 4; ++i) {
            (address b, uint256 pk) = makeAddrAndKey(string.concat("buyer", vm.toString(i)));
            buyers.push(b);
            keys.push(pk);
            vm.prank(b);
            planets_.setApprovalForAll(market, true);
        }
    }

    function _check(bytes4 expected, bytes4 got, string memory where) internal {
        ++outcomes[got];
        if (expected != got && surprise == 0) {
            surprise = got;
            surpriseAt = where;
        }
    }

    /// Top a wallet up to `amount` (only the shortfall: $STAMP is capped at 21M, and failed calls leave theirs behind).
    function _fund(address b, uint256 amount) internal {
        uint256 have = stamp.balanceOf(b);
        if (have < amount) stamp.mint(b, amount - have);
    }

    function _sign(uint256 who, uint256 value) internal view returns (uint256 deadline, uint8 v, bytes32 r, bytes32 s) {
        address b = buyers[who % buyers.length];
        deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
            b, address(planets), value, stamp.nonces(b), deadline
        ));
        (v, r, s) = vm.sign(keys[who % keys.length], keccak256(abi.encodePacked("\x19\x01", stamp.DOMAIN_SEPARATOR(), structHash)));
    }

    // ---------------------------------------------------------------- buying

    /// What a buy of `qty` by `b` for at most `maxCost` should revert with (0: it should go through).
    function _expectedBuy(address b, uint256 qty, uint256 maxCost) internal view returns (bytes4) {
        if (!planets.saleOpen()) return CourierPlanets.SaleClosed.selector;
        if (qty == 0 || qty > 3) return CourierPlanets.BadQuantity.selector;
        if (planets.totalMinted() + qty > 333) return CourierPlanets.SoldOut.selector;
        uint256 limit = planets.perWallet();
        if (limit != 0 && planets.bought(b) + qty > limit) return CourierPlanets.WalletLimit.selector;
        if (planets.price() * qty > maxCost) return CourierPlanets.PriceChanged.selector;
        return 0;
    }

    function _bought(address b, uint256 qty, uint256 cost, uint256 firstId) internal {
        salesPaid += cost;
        minted += qty;
        ++buys;
        for (uint256 i; i < qty; ++i) assertEq(planets.ownerOf(firstId + i), b, "bought planets go to the buyer, in order");
    }

    function buy(uint256 who, uint256 qty, uint256 slack) external {
        address b = buyers[who % buyers.length];
        qty = bound(qty, 0, 4);
        uint256 cost = planets.price() * qty;
        // Mostly a fair offer (the cost plus up to 1,000 $STAMP of slack), one time in five 1 wei short.
        uint256 maxCost = slack % 5 == 0 && cost > 0 ? cost - 1 : cost + bound(slack, 0, 1e21);
        _fund(b, cost);
        vm.prank(b);
        stamp.approve(address(planets), maxCost);
        bytes4 expected = _expectedBuy(b, qty, maxCost);
        uint256 firstId = planets.totalMinted() + 1;
        vm.prank(b);
        try planets.buy(qty, maxCost) {
            _check(expected, 0, "buy");
            _bought(b, qty, cost, firstId);
        } catch (bytes memory err) {
            _check(expected, bytes4(err), "buy");
        }
        vm.prank(b);
        stamp.approve(address(planets), 0);
    }

    function buyWithPermit(uint256 who, uint256 qty, uint256 slack) external {
        address b = buyers[who % buyers.length];
        qty = bound(qty, 0, 4);
        bool badSignature = slack % 5 == 0; // one time in five
        uint256 cost = planets.price() * qty;
        uint256 maxCost = cost + bound(slack, 0, 1e21);
        _fund(b, cost);
        // A bad signature is one for a different amount than the buy names: the permit fails, and with no allowance
        // left from before (every action clears it), the buy has to revert PermitFailed (if nothing else stops it).
        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) = _sign(who, badSignature ? maxCost + 1 : maxCost);
        bytes4 expected = _expectedBuy(b, qty, maxCost);
        if (expected == 0 && badSignature) expected = CourierPlanets.PermitFailed.selector;
        uint256 firstId = planets.totalMinted() + 1;
        vm.prank(b);
        try planets.buyWithPermit(qty, maxCost, deadline, v, r, s) {
            _check(expected, 0, "buyWithPermit");
            _bought(b, qty, cost, firstId);
            ++permitBuys;
            assertEq(stamp.allowance(b, address(planets)), maxCost - cost);
        } catch (bytes memory err) {
            _check(expected, bytes4(err), "buyWithPermit");
        }
        vm.prank(b);
        stamp.approve(address(planets), 0);
    }

    // ---------------------------------------------------------------- moving planets

    /// A holder moving a planet to another buyer (always allowed), or one time in four the marketplace moving it
    /// without the fee check (always refused). A planet that changes hands closes to visitors.
    function transfer(uint256 which, uint256 to, uint256 mode) external {
        uint256 total = planets.totalMinted();
        if (total == 0) return;
        uint256 id = bound(which, 1, total);
        address from = planets.ownerOf(id);
        address dest = buyers[to % buyers.length];
        bool viaMarket = mode % 4 == 0;
        (uint128 p, bool o) = planets.tickets(id);
        bool hadTicket = o || p != 0;
        vm.prank(viaMarket ? market : from);
        try planets.transferFrom(from, dest, id) {
            _check(viaMarket ? DevTransferValidator.UnauthorizedTransfer.selector : bytes4(0), 0, "transfer");
            ++transfers;
            if (hadTicket) ++closedByTransfer;
            delete setBy[id];
            assertEq(planets.ownerOf(id), dest);
            (p, o) = planets.tickets(id);
            assertEq(p, 0, "a planet that changes hands loses its price");
            assertFalse(o, "a planet that changes hands closes");
        } catch (bytes memory err) {
            _check(viaMarket ? DevTransferValidator.UnauthorizedTransfer.selector : bytes4(0), bytes4(err), "transfer");
            assertEq(planets.ownerOf(id), from);
        }
    }

    // ---------------------------------------------------------------- tickets and visits

    /// A planet's owner setting its ticket (open four times in five, sometimes dearer than allowed), or one time in four
    /// someone else trying to; sometimes a planet that doesn't exist yet.
    function setTicket(uint256 which, uint256 who, uint256 price, uint256 mode) external {
        uint256 id = bound(which, 1, planets.totalMinted() + 1);
        price = bound(price, 0, 1_100e18);
        if (mode % 6 == 0) price = 0; // free planets too
        bool open = mode % 5 != 0;
        bool exists = id <= planets.totalMinted();
        address planetOwner = exists ? planets.ownerOf(id) : address(0);
        address caller = mode % 4 == 0 || !exists ? buyers[who % buyers.length] : planetOwner;
        bytes4 expected = !exists ? IERC721Errors.ERC721NonexistentToken.selector
            : caller != planetOwner ? CourierPlanets.NotPlanetOwner.selector
            : price > 1_000e18 ? CourierPlanets.TicketTooDear.selector : bytes4(0);
        vm.prank(caller);
        try planets.setTicket(id, price, open) {
            _check(expected, 0, "setTicket");
            (uint128 p, bool o) = planets.tickets(id);
            assertEq(p, price);
            assertEq(o, open);
            if (o || p != 0) setBy[id] = caller;
            else delete setBy[id];
        } catch (bytes memory err) {
            _check(expected, bytes4(err), "setTicket");
        }
    }

    /// What a visit to `id` for at most `maxPrice` should revert with (0: it should go through).
    function _expectedVisit(uint256 id, uint256 maxPrice) internal view returns (bytes4) {
        if (id > planets.totalMinted()) return IERC721Errors.ERC721NonexistentToken.selector;
        (uint128 p, bool o) = planets.tickets(id);
        if (!o) return CourierPlanets.Closed.selector;
        if (p > maxPrice) return CourierPlanets.PriceChanged.selector;
        return 0;
    }

    struct Balances {
        uint256 visitor;
        uint256 planetOwner;
        uint256 treasury;
    }

    function _balances(address visitor, address planetOwner) internal view returns (Balances memory) {
        return Balances(stamp.balanceOf(visitor), planetOwner == address(0) ? 0 : stamp.balanceOf(planetOwner), stamp.balanceOf(treasury));
    }

    /// After a visit that went through: the visitor paid the ticket, exactly split between the planet's owner and the
    /// treasury (its share as set, never more than half).
    function _visited(uint256 id, address visitor, address planetOwner, Balances memory before) internal {
        (uint128 price,) = planets.tickets(id);
        uint256 toTreasury = (uint256(price) * planets.treasuryBps()) / 10_000;
        uint256 toOwner = price - toTreasury;
        assertLe(toTreasury, uint256(price) / 2, "the treasury never takes more than half");
        assertEq(stamp.balanceOf(treasury) - before.treasury, toTreasury);
        if (visitor == planetOwner) {
            assertEq(before.visitor - stamp.balanceOf(visitor), toTreasury, "visiting your own planet costs only the treasury's share");
        } else {
            assertEq(before.visitor - stamp.balanceOf(visitor), price);
            assertEq(stamp.balanceOf(planetOwner) - before.planetOwner, toOwner);
        }
        ticketsPaid += price;
        ticketsToOwners += toOwner;
        ticketsToTreasury += toTreasury;
        ++visits;
        if (price > 0) ++paidVisits;
    }

    function visit(uint256 who, uint256 which, uint256 slack) external {
        address visitor = buyers[who % buyers.length];
        uint256 id = bound(which, 1, planets.totalMinted() + 1);
        uint256 price;
        if (id <= planets.totalMinted()) (price,) = planets.tickets(id);
        // Mostly enough (the ticket plus up to 100 $STAMP), one time in five 1 wei short.
        uint256 maxPrice = slack % 5 == 0 && price > 0 ? price - 1 : price + bound(slack, 0, 100e18);
        _fund(visitor, price);
        vm.prank(visitor);
        stamp.approve(address(planets), maxPrice);
        bytes4 expected = _expectedVisit(id, maxPrice);
        address planetOwner = id <= planets.totalMinted() ? planets.ownerOf(id) : address(0);
        Balances memory before = _balances(visitor, planetOwner);
        vm.prank(visitor);
        try planets.visit(id, maxPrice) {
            _check(expected, 0, "visit");
            _visited(id, visitor, planetOwner, before);
        } catch (bytes memory err) {
            _check(expected, bytes4(err), "visit");
        }
        vm.prank(visitor);
        stamp.approve(address(planets), 0);
    }

    function visitWithPermit(uint256 who, uint256 which, uint256 slack) external {
        address visitor = buyers[who % buyers.length];
        uint256 id = bound(which, 1, planets.totalMinted() + 1);
        uint256 price;
        if (id <= planets.totalMinted()) (price,) = planets.tickets(id);
        bool badSignature = slack % 5 == 0;
        uint256 maxPrice = price + bound(slack, 0, 100e18);
        _fund(visitor, price);
        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) = _sign(who, badSignature ? maxPrice + 1 : maxPrice);
        bytes4 expected = _expectedVisit(id, maxPrice);
        // (A free ticket needs no allowance, so a bad permit doesn't matter to it.)
        if (expected == 0 && badSignature && price > 0) expected = CourierPlanets.PermitFailed.selector;
        address planetOwner = id <= planets.totalMinted() ? planets.ownerOf(id) : address(0);
        Balances memory before = _balances(visitor, planetOwner);
        vm.prank(visitor);
        try planets.visitWithPermit(id, maxPrice, deadline, v, r, s) {
            _check(expected, 0, "visitWithPermit");
            _visited(id, visitor, planetOwner, before);
            ++permitVisits;
        } catch (bytes memory err) {
            _check(expected, bytes4(err), "visitWithPermit");
        }
        vm.prank(visitor);
        stamp.approve(address(planets), 0);
    }

    // ---------------------------------------------------------------- the owner

    /// The owner changing the price (1 wei up to twice the launch price), the wallet limit, the sale (open four times
    /// in five) and the treasury's share of tickets (sometimes above the cap, to try it).
    function configure(uint256 price, uint256 perWallet, uint256 bps, uint256 mode) external {
        price = bound(price, 1, 20_000e18);
        perWallet = bound(perWallet, 0, 5);
        bps = bound(bps, 0, 6000);
        vm.startPrank(owner);
        planets.setPrice(price);
        planets.setPerWallet(perWallet);
        planets.setSaleOpen(mode % 5 != 0);
        try planets.setTreasuryShare(uint16(bps)) {
            _check(bps > 5000 ? CourierPlanets.ShareTooHigh.selector : bytes4(0), 0, "setTreasuryShare");
        } catch (bytes memory err) {
            _check(bps > 5000 ? CourierPlanets.ShareTooHigh.selector : bytes4(0), bytes4(err), "setTreasuryShare");
        }
        vm.stopPrank();
        assertEq(planets.price(), price);
        assertEq(planets.perWallet(), perWallet);
    }

    /// Before a run only: `early` buys `n` planets, so the run starts near the sell-out.
    function seed(uint256 n) external {
        uint256 cost = planets.price() * n;
        _fund(early, cost);
        vm.startPrank(early);
        stamp.approve(address(planets), cost);
        for (uint256 left = n; left > 0;) {
            uint256 q = left < 3 ? left : 3;
            planets.buy(q, planets.price() * q);
            left -= q;
        }
        vm.stopPrank();
        salesPaid += cost;
        minted += n;
    }

    function buyerCount() external view returns (uint256) {
        return buyers.length;
    }
}

/// (The handler predicts every outcome and never reverts itself, so a revert in it is a failure too.)
/// forge-config: default.invariant.fail-on-revert = true
contract CourierPlanetsInvariantTest is Test {
    StampToken stamp;
    CourierPlanets planets;
    PlanetsHandler handler;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");

    function setUp() public virtual {
        stamp = new StampToken(owner, address(0), 0);
        planets = new CourierPlanets(owner, address(stamp), treasury, address(new DevTransferValidator()), 10_000e18, "https://courierworld.fun/planets/");
        handler = new PlanetsHandler(planets, stamp, owner, treasury);
        vm.startPrank(owner);
        stamp.setMinter(address(handler));
        planets.setSaleOpen(true);
        planets.setPrice(100e18); // cheap enough that runs reach a sell-out
        vm.stopPrank();
        targetContract(address(handler));
        bytes4[] memory calls = new bytes4[](7);
        calls[0] = PlanetsHandler.buy.selector;
        calls[1] = PlanetsHandler.buyWithPermit.selector;
        calls[2] = PlanetsHandler.transfer.selector;
        calls[3] = PlanetsHandler.setTicket.selector;
        calls[4] = PlanetsHandler.visit.selector;
        calls[5] = PlanetsHandler.visitWithPermit.selector;
        calls[6] = PlanetsHandler.configure.selector;
        targetSelector(FuzzSelector(address(handler), calls));
    }

    /// Every call did exactly what was predicted: the right revert, or success.
    function invariant_noSurprises() public view {
        assertEq(handler.surprise(), bytes4(0), handler.surpriseAt());
    }

    /// Never more than 333 planets; every one was bought, is numbered 1 to totalMinted, and is in a buyer's wallet.
    function invariant_supplyHolds() public view {
        uint256 total = planets.totalMinted();
        assertLe(total, 333);
        assertEq(total, handler.minted());
        uint256 held = planets.balanceOf(handler.early());
        uint256 bought = planets.bought(handler.early());
        for (uint256 j; j < handler.buyerCount(); ++j) {
            held += planets.balanceOf(handler.buyers(j));
            bought += planets.bought(handler.buyers(j));
        }
        assertEq(held, total, "every planet is in a buyer's wallet (or the early buyer's)");
        for (uint256 j; j < handler.buyerCount(); ++j) {
            address b = handler.buyers(j);
            uint256[] memory mine = planets.planetsOf(b);
            assertEq(mine.length, planets.balanceOf(b));
            for (uint256 k; k < mine.length; ++k) assertEq(planets.ownerOf(mine[k]), b, "planetsOf lists only the wallet's own");
        }
        assertEq(bought, total, "the purchase counts add up to what was minted");
        (address[] memory owners,) = planets.allPlanets();
        assertEq(owners.length, total);
        for (uint256 i; i < total; ++i) assertTrue(owners[i] != address(0));
    }

    /// Every $STAMP paid went where it should: sales all to the treasury; tickets split exactly between planet owners
    /// and the treasury. The contract never keeps any.
    function invariant_stampGoesWhereItShould() public view {
        assertEq(stamp.balanceOf(treasury), handler.salesPaid() + handler.ticketsToTreasury());
        assertEq(handler.ticketsPaid(), handler.ticketsToOwners() + handler.ticketsToTreasury());
        assertEq(stamp.balanceOf(address(planets)), 0);
    }

    /// Every ticket is within the cap, and was set by the planet's current owner: no new owner inherits a price.
    function invariant_ticketsBelongToTheirOwners() public view {
        (address[] memory owners, CourierPlanets.Ticket[] memory list) = planets.allPlanets();
        for (uint256 i; i < owners.length; ++i) {
            assertLe(list[i].price, planets.MAX_TICKET());
            if (list[i].open || list[i].price != 0) assertEq(handler.setBy(i + 1), owners[i], "a ticket set by someone else");
        }
        assertLe(planets.treasuryBps(), planets.MAX_TREASURY_BPS());
    }

    /// The owner, the treasury and the royalty never move unless the owner moves them (and the handler never does).
    function invariant_ownerAndTreasuryStay() public view {
        assertEq(planets.owner(), owner);
        assertEq(planets.treasury(), treasury);
        (address to, uint256 fee) = planets.royaltyInfo(1, 10_000);
        assertEq(to, treasury);
        assertEq(fee, 500);
    }

    function afterInvariant() public view {
        // (Shown with -vv: proof the fuzzer reached the interesting paths.)
        console2.log("minted", planets.totalMinted(), "buys", handler.buys());
        console2.log("permit buys", handler.permitBuys(), "transfers", handler.transfers());
        console2.log("visits", handler.visits(), "paid", handler.paidVisits());
        console2.log("permit visits", handler.permitVisits(), "closed by transfer", handler.closedByTransfer());
        console2.log("calls that succeeded", handler.outcomes(0));
        console2.log("SaleClosed", handler.outcomes(CourierPlanets.SaleClosed.selector), "BadQuantity", handler.outcomes(CourierPlanets.BadQuantity.selector));
        console2.log("SoldOut", handler.outcomes(CourierPlanets.SoldOut.selector), "WalletLimit", handler.outcomes(CourierPlanets.WalletLimit.selector));
        console2.log("PriceChanged", handler.outcomes(CourierPlanets.PriceChanged.selector), "PermitFailed", handler.outcomes(CourierPlanets.PermitFailed.selector));
        console2.log("NotPlanetOwner", handler.outcomes(CourierPlanets.NotPlanetOwner.selector), "TicketTooDear", handler.outcomes(CourierPlanets.TicketTooDear.selector));
        console2.log("Closed", handler.outcomes(CourierPlanets.Closed.selector), "ShareTooHigh", handler.outcomes(CourierPlanets.ShareTooHigh.selector));
        console2.log("Nonexistent", handler.outcomes(IERC721Errors.ERC721NonexistentToken.selector), "Unauthorized", handler.outcomes(DevTransferValidator.UnauthorizedTransfer.selector));
    }
}

/// The same, starting with 325 of the 333 planets sold (to a wallet outside the run, with no wallet limit), so the
/// fuzzer works at the sell-out: the last buys, the partial ones that would go past 333, and everything after.
/// forge-config: default.invariant.fail-on-revert = true
contract CourierPlanetsSellOutInvariantTest is CourierPlanetsInvariantTest {
    function setUp() public override {
        super.setUp();
        vm.prank(owner);
        planets.setPerWallet(0);
        handler.seed(325);
        vm.prank(owner);
        planets.setPerWallet(3);
    }
}
