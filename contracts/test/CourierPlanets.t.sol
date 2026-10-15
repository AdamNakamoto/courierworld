// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors, IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {CourierPlanets, ICreatorToken} from "../src/CourierPlanets.sol";
import {StampToken} from "../src/StampToken.sol";
import {DeployPlanets} from "../script/DeployPlanets.s.sol";

/// Acts like OpenSea's strict registry: holders may move their own planets; any other caller needs the marketplace's
/// fee check (here, `authorize`).
contract StrictValidator721 {
    error UnauthorizedTransfer();

    mapping(address => bool) public authorized;

    function authorize(address operator, bool ok) external {
        authorized[operator] = ok;
    }

    function validateTransfer(address caller, address from, address, uint256) external view {
        if (caller != from && !authorized[caller]) revert UnauthorizedTransfer();
    }
}

/// A contract wallet that tries to buy again while its planet is being minted to it.
contract GreedyPlanetBuyer is IERC721Receiver {
    CourierPlanets public planets;
    bool public tried;
    bytes public buyError;

    constructor(CourierPlanets planets_) {
        planets = planets_;
    }

    function go(uint256 cost) external {
        planets.stamp().approve(address(planets), type(uint256).max);
        planets.buy(1, cost);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (!tried) {
            tried = true;
            try planets.buy(1, type(uint256).max) {} catch (bytes memory e) {
                buyError = e;
            }
        }
        return this.onERC721Received.selector;
    }
}

/// A contract with no way to receive ERC-721 tokens.
contract NoPlanetReceiver {
    function go(CourierPlanets planets, uint256 cost) external {
        planets.stamp().approve(address(planets), cost);
        planets.buy(1, cost);
    }
}

contract CourierPlanetsTest is Test {
    StampToken stamp;
    CourierPlanets planets;
    StrictValidator721 validator;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    uint256 alicePk = 0xA11CE;
    address alice;
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    uint256 constant PRICE = 10_000e18;

    function setUp() public {
        alice = vm.addr(alicePk);
        stamp = new StampToken(owner, address(0), 0);
        vm.prank(owner);
        stamp.setMinter(address(this));
        stamp.mint(alice, 100_000e18);
        stamp.mint(bob, 100_000e18);
        stamp.mint(carol, 10_000e18);
        validator = new StrictValidator721();
        planets = new CourierPlanets(owner, address(stamp), treasury, address(validator), PRICE, "https://courierworld.fun/planets/");
        vm.prank(owner);
        planets.setSaleOpen(true);
    }

    function _buy(address who, uint256 qty) internal {
        vm.startPrank(who);
        stamp.approve(address(planets), PRICE * qty);
        planets.buy(qty, PRICE * qty);
        vm.stopPrank();
    }

    function _permit(uint256 pk, address spender, uint256 value, uint256 deadline) internal view returns (uint8, bytes32, bytes32) {
        address holder = vm.addr(pk);
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
            holder, spender, value, stamp.nonces(holder), deadline
        ));
        return vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", stamp.DOMAIN_SEPARATOR(), structHash)));
    }

    // ---------------------------------------------------------------- buying

    function test_buyPaysTheTreasuryAndMintsInOrder() public {
        _buy(alice, 2);
        assertEq(planets.ownerOf(1), alice);
        assertEq(planets.ownerOf(2), alice);
        assertEq(planets.totalMinted(), 2);
        assertEq(planets.bought(alice), 2);
        assertEq(stamp.balanceOf(treasury), 2 * PRICE);
        assertEq(stamp.balanceOf(address(planets)), 0);
        _buy(bob, 1);
        assertEq(planets.ownerOf(3), bob);
    }

    function test_buyRules() public {
        vm.startPrank(alice);
        stamp.approve(address(planets), type(uint256).max);
        vm.expectRevert(CourierPlanets.BadQuantity.selector);
        planets.buy(0, 0);
        vm.expectRevert(CourierPlanets.BadQuantity.selector);
        planets.buy(4, 4 * PRICE);
        vm.expectRevert(abi.encodeWithSelector(CourierPlanets.PriceChanged.selector, PRICE));
        planets.buy(1, PRICE - 1);
        planets.buy(3, 3 * PRICE);
        vm.expectRevert(CourierPlanets.WalletLimit.selector);
        planets.buy(1, PRICE);
        vm.stopPrank();
        vm.prank(owner);
        planets.setSaleOpen(false);
        vm.prank(bob);
        vm.expectRevert(CourierPlanets.SaleClosed.selector);
        planets.buy(1, PRICE);
    }

    function test_walletLimitCountsBuysNotHoldings() public {
        _buy(alice, 3);
        vm.prank(alice);
        planets.transferFrom(alice, bob, 1);
        vm.startPrank(alice);
        stamp.approve(address(planets), PRICE);
        vm.expectRevert(CourierPlanets.WalletLimit.selector);
        planets.buy(1, PRICE);
        vm.stopPrank();
        vm.prank(owner);
        planets.setPerWallet(0);
        _buy(alice, 1);
        assertEq(planets.bought(alice), 4);
    }

    function test_sellsOutAt333() public {
        vm.prank(owner);
        planets.setPerWallet(0);
        stamp.mint(bob, 333 * PRICE);
        vm.startPrank(bob);
        stamp.approve(address(planets), type(uint256).max);
        for (uint256 i; i < 111; ++i) planets.buy(3, 3 * PRICE);
        assertEq(planets.totalMinted(), 333);
        vm.expectRevert(CourierPlanets.SoldOut.selector);
        planets.buy(1, PRICE);
        vm.stopPrank();
        assertEq(planets.ownerOf(333), bob);
    }

    function test_priceChangeCantChargeMore() public {
        vm.prank(alice);
        stamp.approve(address(planets), 2 * PRICE);
        vm.prank(owner);
        planets.setPrice(PRICE * 2);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CourierPlanets.PriceChanged.selector, PRICE * 2));
        planets.buy(1, PRICE);
    }

    function test_buyWithPermit() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(alicePk, address(planets), PRICE, deadline);
        vm.prank(alice);
        planets.buyWithPermit(1, PRICE, deadline, v, r, s);
        assertEq(planets.ownerOf(1), alice);
        assertEq(stamp.allowance(alice, address(planets)), 0);
    }

    function test_frontRunPermitStillBuys() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(alicePk, address(planets), PRICE, deadline);
        stamp.permit(alice, address(planets), PRICE, deadline, v, r, s); // someone else submits it first
        vm.prank(alice);
        planets.buyWithPermit(1, PRICE, deadline, v, r, s);
        assertEq(planets.ownerOf(1), alice);
    }

    function test_badPermitRevertsPermitFailed() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(alicePk, address(planets), PRICE - 1, deadline);
        vm.prank(alice);
        vm.expectRevert(CourierPlanets.PermitFailed.selector);
        planets.buyWithPermit(1, PRICE, deadline, v, r, s);
    }

    function test_reentrantBuyIsBlocked() public {
        GreedyPlanetBuyer greedy = new GreedyPlanetBuyer(planets);
        stamp.mint(address(greedy), 2 * PRICE);
        greedy.go(PRICE);
        assertEq(planets.balanceOf(address(greedy)), 1);
        assertTrue(greedy.tried());
        assertEq(bytes4(greedy.buyError()), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(stamp.balanceOf(treasury), PRICE);
    }

    function test_aWalletThatCantReceiveRevertsTheWholeBuy() public {
        NoPlanetReceiver nope = new NoPlanetReceiver();
        stamp.mint(address(nope), PRICE);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(nope)));
        nope.go(planets, PRICE);
        assertEq(stamp.balanceOf(treasury), 0);
        assertEq(planets.totalMinted(), 0);
    }

    // ---------------------------------------------------------------- tickets and visits

    function test_onlyThePlanetsOwnerSetsItsTicket() public {
        _buy(alice, 1);
        vm.prank(bob);
        vm.expectRevert(CourierPlanets.NotPlanetOwner.selector);
        planets.setTicket(1, 50e18, true);
        vm.prank(alice);
        vm.expectRevert(CourierPlanets.TicketTooDear.selector);
        planets.setTicket(1, 1_000e18 + 1, true);
        vm.prank(alice);
        planets.setTicket(1, 50e18, true);
        (uint128 p, bool open) = planets.tickets(1);
        assertEq(p, 50e18);
        assertTrue(open);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 7));
        planets.setTicket(7, 1, true);
    }

    function test_visitSplitsTheTicket() public {
        _buy(alice, 1);
        vm.prank(alice);
        planets.setTicket(1, 100e18, true);
        uint256 aliceBefore = stamp.balanceOf(alice);
        uint256 treasuryBefore = stamp.balanceOf(treasury);
        vm.startPrank(bob);
        stamp.approve(address(planets), 100e18);
        vm.expectEmit(true, true, true, true);
        emit CourierPlanets.Visited(1, bob, alice, 100e18, 80e18, 20e18);
        planets.visit(1, 100e18);
        vm.stopPrank();
        assertEq(stamp.balanceOf(alice) - aliceBefore, 80e18);
        assertEq(stamp.balanceOf(treasury) - treasuryBefore, 20e18);
        assertEq(stamp.balanceOf(address(planets)), 0);
    }

    function test_visitRules() public {
        _buy(alice, 1);
        vm.startPrank(bob);
        stamp.approve(address(planets), type(uint256).max);
        vm.expectRevert(CourierPlanets.Closed.selector);
        planets.visit(1, 1_000e18);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 2));
        planets.visit(2, 1_000e18);
        vm.stopPrank();
        vm.prank(alice);
        planets.setTicket(1, 100e18, true);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CourierPlanets.PriceChanged.selector, 100e18));
        planets.visit(1, 99e18);
    }

    function test_freePlanetVisitMovesNothing() public {
        _buy(alice, 1);
        vm.prank(alice);
        planets.setTicket(1, 0, true);
        uint256 before = stamp.balanceOf(bob);
        vm.prank(bob);
        vm.expectEmit(true, true, true, true);
        emit CourierPlanets.Visited(1, bob, alice, 0, 0, 0);
        planets.visit(1, 0);
        assertEq(stamp.balanceOf(bob), before);
    }

    function test_visitWithPermit() public {
        _buy(bob, 1);
        vm.prank(bob);
        planets.setTicket(1, 250e18, true);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(alicePk, address(planets), 250e18, deadline);
        vm.prank(alice);
        planets.visitWithPermit(1, 250e18, deadline, v, r, s);
        assertEq(stamp.allowance(alice, address(planets)), 0);
        (v, r, s) = _permit(alicePk, address(planets), 249e18, deadline);
        vm.prank(alice);
        vm.expectRevert(CourierPlanets.PermitFailed.selector);
        planets.visitWithPermit(1, 250e18, deadline, v, r, s);
    }

    function test_treasuryShareIsCapped() public {
        vm.prank(owner);
        vm.expectRevert(CourierPlanets.ShareTooHigh.selector);
        planets.setTreasuryShare(5001);
        vm.prank(owner);
        planets.setTreasuryShare(0);
        _buy(alice, 1);
        vm.prank(alice);
        planets.setTicket(1, 10e18, true);
        uint256 before = stamp.balanceOf(alice);
        vm.startPrank(bob);
        stamp.approve(address(planets), 10e18);
        planets.visit(1, 10e18);
        vm.stopPrank();
        assertEq(stamp.balanceOf(alice) - before, 10e18);
    }

    function test_aPlanetThatChangesHandsStartsClosed() public {
        _buy(alice, 1);
        vm.prank(alice);
        planets.setTicket(1, 500e18, true);
        vm.expectEmit(true, false, false, true);
        emit CourierPlanets.TicketSet(1, 0, false);
        vm.prank(alice);
        planets.transferFrom(alice, bob, 1);
        (uint128 p, bool open) = planets.tickets(1);
        assertEq(p, 0);
        assertFalse(open);
        vm.startPrank(carol);
        stamp.approve(address(planets), type(uint256).max);
        vm.expectRevert(CourierPlanets.Closed.selector);
        planets.visit(1, 500e18);
        vm.stopPrank();
    }

    function test_aPlanetCantBeSentToTheContract() public {
        _buy(alice, 1);
        vm.startPrank(alice);
        vm.expectRevert(CourierPlanets.BadReceiver.selector);
        planets.transferFrom(alice, address(planets), 1);
        vm.expectRevert(CourierPlanets.BadReceiver.selector);
        planets.safeTransferFrom(alice, address(planets), 1);
        vm.stopPrank();
        assertEq(planets.ownerOf(1), alice);
    }

    // ---------------------------------------------------------------- royalty enforcement

    function test_marketplacesSeeTheEnforcement() public view {
        assertTrue(planets.supportsInterface(0xad0d7f6c), "ICreatorToken (v3)");
        assertTrue(planets.supportsInterface(0x49064906), "ERC-4906");
        assertTrue(planets.supportsInterface(type(IERC721).interfaceId));
        assertTrue(planets.supportsInterface(type(IERC2981).interfaceId));
        (bytes4 fn, bool isView) = planets.getTransferValidationFunction();
        assertEq(fn, bytes4(keccak256("validateTransfer(address,address,address,uint256)")));
        assertTrue(isView);
    }

    function test_holdersMoveTheirOwnButMarketplacesNeedTheFeeCheck() public {
        _buy(alice, 2);
        vm.prank(alice);
        planets.transferFrom(alice, bob, 1);
        assertEq(planets.ownerOf(1), bob);
        address market = makeAddr("market");
        vm.prank(alice);
        planets.setApprovalForAll(market, true);
        vm.prank(market);
        vm.expectRevert(StrictValidator721.UnauthorizedTransfer.selector);
        planets.transferFrom(alice, bob, 2);
        validator.authorize(market, true);
        vm.prank(market);
        planets.transferFrom(alice, bob, 2);
        assertEq(planets.ownerOf(2), bob);
    }

    function test_enforcementCanMoveButNeverBeSwitchedOff() public {
        vm.startPrank(owner);
        vm.expectRevert(CourierPlanets.NotAContract.selector);
        planets.setTransferValidator(address(0));
        vm.expectRevert(CourierPlanets.NotAContract.selector);
        planets.setTransferValidator(makeAddr("eoa"));
        StrictValidator721 next = new StrictValidator721();
        planets.setTransferValidator(address(next));
        vm.stopPrank();
        assertEq(planets.getTransferValidator(), address(next));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        planets.setTransferValidator(address(validator));
    }

    // ---------------------------------------------------------------- the owner

    function test_royaltyFollowsTheTreasury() public {
        (address to, uint256 fee) = planets.royaltyInfo(1, 1000e18);
        assertEq(to, treasury);
        assertEq(fee, 50e18);
        address next = makeAddr("next");
        vm.prank(owner);
        planets.setTreasury(next);
        (to,) = planets.royaltyInfo(1, 1000e18);
        assertEq(to, next);
        vm.prank(owner);
        vm.expectRevert(CourierPlanets.BadTreasury.selector);
        planets.setTreasury(address(planets));
        vm.prank(owner);
        vm.expectRevert(CourierPlanets.ZeroAddress.selector);
        planets.setTreasury(address(0));
        (, fee) = planets.royaltyInfo(1, 1000e18);
        assertEq(fee, 50e18, "the rate never changes");
    }

    function test_aNewTreasuryGetsTheSalesAndTheTicketShare() public {
        address next = makeAddr("next");
        vm.prank(owner);
        planets.setTreasury(next);
        _buy(alice, 1);
        assertEq(stamp.balanceOf(next), PRICE);
        vm.prank(alice);
        planets.setTicket(1, 100e18, true);
        vm.startPrank(bob);
        stamp.approve(address(planets), 100e18);
        planets.visit(1, 100e18);
        vm.stopPrank();
        assertEq(stamp.balanceOf(next), PRICE + 20e18);
        assertEq(stamp.balanceOf(treasury), 0);
    }

    function test_cannotRenounce() public {
        vm.prank(owner);
        vm.expectRevert(CourierPlanets.CannotRenounce.selector);
        planets.renounceOwnership();
        assertEq(planets.owner(), owner);
    }

    function test_ownerOnly() public {
        vm.startPrank(alice);
        bytes memory no = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice);
        vm.expectRevert(no);
        planets.setSaleOpen(false);
        vm.expectRevert(no);
        planets.setPrice(1);
        vm.expectRevert(no);
        planets.setPerWallet(10);
        vm.expectRevert(no);
        planets.setTreasury(alice);
        vm.expectRevert(no);
        planets.setTreasuryShare(0);
        vm.expectRevert(no);
        planets.setBase("x/");
        vm.expectRevert(no);
        planets.rescue(stamp, alice);
        vm.stopPrank();
        vm.prank(owner);
        vm.expectRevert(CourierPlanets.ZeroPrice.selector);
        planets.setPrice(0);
    }

    function test_rescueReturnsTokensSentByMistake() public {
        vm.prank(bob);
        stamp.transfer(address(planets), 77e18);
        vm.prank(owner);
        planets.rescue(stamp, bob);
        assertEq(stamp.balanceOf(bob), 100_000e18);
        assertEq(stamp.balanceOf(address(planets)), 0);
    }

    function test_constructorChecks() public {
        vm.expectRevert(CourierPlanets.ZeroAddress.selector);
        new CourierPlanets(owner, address(0), treasury, address(validator), PRICE, "x/");
        vm.expectRevert(CourierPlanets.ZeroPrice.selector);
        new CourierPlanets(owner, address(stamp), treasury, address(validator), 0, "x/");
        vm.expectRevert(CourierPlanets.NotAContract.selector);
        new CourierPlanets(owner, address(stamp), treasury, makeAddr("eoa"), PRICE, "x/");
        address next = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        vm.expectRevert(CourierPlanets.BadTreasury.selector);
        new CourierPlanets(owner, address(stamp), next, address(validator), PRICE, "x/");
    }

    // ---------------------------------------------------------------- reading

    function test_metadataAndLists() public {
        assertEq(planets.name(), "Courier Planets");
        assertEq(planets.symbol(), "PLANET");
        assertEq(planets.contractURI(), "https://courierworld.fun/planets/collection.json");
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 1));
        planets.tokenURI(1);
        _buy(alice, 2);
        _buy(bob, 1);
        assertEq(planets.tokenURI(2), "https://courierworld.fun/planets/2.json");
        uint256[] memory mine = planets.planetsOf(alice);
        assertEq(mine.length, 2);
        assertEq(mine[1], 2);
        vm.prank(bob);
        planets.setTicket(3, 5e18, true);
        (address[] memory owners, CourierPlanets.Ticket[] memory list) = planets.allPlanets();
        assertEq(owners.length, 3);
        assertEq(owners[2], bob);
        assertEq(list[2].price, 5e18);
        assertTrue(list[2].open);
        vm.expectEmit(false, false, false, true);
        emit CourierPlanets.BatchMetadataUpdate(1, 3);
        vm.prank(owner);
        planets.setBase("ipfs://new/");
        assertEq(planets.tokenURI(1), "ipfs://new/1.json");
    }

    function test_planetsOfFollowsTransfers() public {
        _buy(alice, 2);
        _buy(bob, 1);
        vm.prank(alice);
        planets.transferFrom(alice, bob, 1);
        uint256[] memory a = planets.planetsOf(alice);
        uint256[] memory b = planets.planetsOf(bob);
        assertEq(a.length, 1);
        assertEq(a[0], 2);
        assertEq(b.length, 2);
        assertEq(b[0], 1);
        assertEq(b[1], 3, "the last planet is listed too");
        assertEq(planets.planetsOf(carol).length, 0);
    }

    /// The deploy script: owned by the wallet that broadcasts it, sale closed, the price and treasury as set.
    function test_deployScript() public {
        DeployPlanets script = new DeployPlanets();
        vm.setEnv("STAMP", vm.toString(address(stamp)));
        vm.setEnv("TREASURY", vm.toString(treasury));
        CourierPlanets deployed = script.run();
        assertEq(deployed.owner(), DEFAULT_SENDER);
        assertEq(deployed.price(), 10_000e18);
        assertEq(deployed.treasury(), treasury);
        assertFalse(deployed.saleOpen());
        assertEq(deployed.perWallet(), 3);
        assertEq(deployed.treasuryBps(), 2000);
        assertGt(deployed.getTransferValidator().code.length, 0);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_visitSplitAddsUp(uint128 price, uint16 bps) public {
        price = uint128(bound(price, 0, 1_000e18));
        bps = uint16(bound(bps, 0, 5000));
        vm.prank(owner);
        planets.setTreasuryShare(bps);
        _buy(alice, 1);
        vm.prank(alice);
        planets.setTicket(1, price, true);
        uint256 a0 = stamp.balanceOf(alice);
        uint256 t0 = stamp.balanceOf(treasury);
        uint256 b0 = stamp.balanceOf(bob);
        vm.startPrank(bob);
        stamp.approve(address(planets), price);
        planets.visit(1, price);
        vm.stopPrank();
        assertEq(b0 - stamp.balanceOf(bob), price);
        assertEq((stamp.balanceOf(alice) - a0) + (stamp.balanceOf(treasury) - t0), price);
        assertLe(stamp.balanceOf(treasury) - t0, (uint256(price) * 5000) / 10_000);
    }
}

/// The registry's side of OpenSea's fee-checked sales, called by the SignedZone around a transfer.
interface IPlanetAuthorizer {
    function beforeAuthorizedTransfer(address token, uint256 tokenId) external;
    function afterAuthorizedTransfer(address token, uint256 tokenId) external;
}

/// Stand-in for the SignedZone's calls around a sale.
contract PlanetZoneFlow {
    function sell(address registry, address token, address market, address from, address to, uint256 id) external {
        IPlanetAuthorizer(registry).beforeAuthorizedTransfer(token, id);
        PlanetMarketMove(market).move(token, from, to, id);
        IPlanetAuthorizer(registry).afterAuthorizedTransfer(token, id);
    }
}

/// Stand-in for the marketplace moving the sold planet.
contract PlanetMarketMove {
    function move(address token, address from, address to, uint256 id) external {
        IERC721(token).transferFrom(from, to, id);
    }
}

/// @notice Against OpenSea's real creator fee enforcement registry on Robinhood Chain.
///   forge test --match-contract CourierPlanetsForkTest --fork-url robinhood
/// Skipped when not forked.
contract CourierPlanetsForkTest is Test {
    address constant REGISTRY = 0xA000027A9B2802E1ddf7000061001e5c005A0000;
    address constant SEAPORT = 0x0000000000000068F116a894984e2DB1123eB395;
    bytes4 constant UNAUTHORIZED = 0x1de5204e;
    address constant SIGNED_ZONE = 0x000056F7000000EcE9003ca63978907a00FFD100;

    StampToken stamp;
    CourierPlanets planets;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        if (block.chainid != 4663) return; // (each test skips itself)
        stamp = new StampToken(owner, address(0), 0);
        vm.prank(owner);
        stamp.setMinter(address(this));
        stamp.mint(alice, 30_000e18);
        planets = new CourierPlanets(owner, address(stamp), makeAddr("treasury"), REGISTRY, 10_000e18, "x/");
        vm.prank(owner);
        planets.setSaleOpen(true);
        vm.startPrank(alice);
        stamp.approve(address(planets), 20_000e18);
        planets.buy(2, 20_000e18);
        vm.stopPrank();
    }

    function test_Fork_HolderTransfersPass() public {
        vm.skip(block.chainid != 4663);
        vm.prank(alice);
        planets.transferFrom(alice, bob, 1);
        assertEq(planets.ownerOf(1), bob);
    }

    function test_Fork_SaleAuthorizedByOpenSeaGoesThrough() public {
        vm.skip(block.chainid != 4663);
        vm.etch(SIGNED_ZONE, address(new PlanetZoneFlow()).code);
        vm.etch(SEAPORT, address(new PlanetMarketMove()).code);
        vm.prank(alice);
        planets.setApprovalForAll(SEAPORT, true);
        PlanetZoneFlow(SIGNED_ZONE).sell(REGISTRY, address(planets), SEAPORT, alice, bob, 2);
        assertEq(planets.ownerOf(2), bob);
    }

    /// On Robinhood Chain the deploy script keeps OpenSea's registry as the validator (no stand-in).
    function test_Fork_DeployScriptUsesTheRegistry() public {
        vm.skip(block.chainid != 4663);
        vm.setEnv("STAMP", vm.toString(address(stamp)));
        vm.setEnv("TREASURY", vm.toString(makeAddr("treasury")));
        CourierPlanets deployed = new DeployPlanets().run();
        assertEq(deployed.getTransferValidator(), REGISTRY);
        assertFalse(deployed.saleOpen());
    }

    function test_Fork_MarketplaceWithoutFeeCheckReverts() public {
        vm.skip(block.chainid != 4663);
        vm.prank(alice);
        planets.setApprovalForAll(SEAPORT, true);
        vm.prank(SEAPORT);
        vm.expectRevert(UNAUTHORIZED);
        planets.transferFrom(alice, bob, 2);
        assertEq(planets.ownerOf(2), alice);
    }
}
