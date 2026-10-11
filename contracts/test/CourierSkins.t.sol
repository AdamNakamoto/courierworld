// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {CourierSkins, ICreatorToken} from "../src/CourierSkins.sol";

/// Acts like OpenSea's strict registry: owners may move their own skins; any other caller needs the
/// marketplace's fee check (here, `authorize`) for that transfer.
contract StrictValidator {
    error UnauthorizedTransfer();

    mapping(address => bool) public authorized;

    function authorize(address operator, bool ok) external {
        authorized[operator] = ok;
    }

    function validateTransfer(address caller, address from, address, uint256) external view {
        if (caller != from && !authorized[caller]) revert UnauthorizedTransfer();
    }
}

/// Exposes the shuffle for any seed.
contract ShuffleHarness is CourierSkins {
    constructor(address validator, uint256 seed_) CourierSkins(msg.sender, msg.sender, 1, bytes32(0), validator, "") {
        seed = seed_ == 0 ? 1 : seed_;
    }

    function shuffle(uint256 x) external view returns (uint256) {
        return _shuffle(x);
    }

    function designAt(uint256 slot) external pure returns (uint256) {
        return _designAt(slot);
    }
}

/// Puts ETH into an address without calling it (SELFDESTRUCT in the creating transaction).
contract ForceSend {
    constructor(address payable to) payable {
        selfdestruct(to);
    }
}

contract CourierSkinsTest is Test {
    CourierSkins skins;
    StrictValidator validator;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address market = makeAddr("market");

    uint256 constant PRICE = 0.004 ether;
    uint256 constant SECRET = 424242;

    function setUp() public {
        validator = new StrictValidator();
        skins = new CourierSkins(owner, treasury, PRICE, keccak256(abi.encode(SECRET)), address(validator), "https://courierworld.fun/skins/");
        vm.prank(owner);
        skins.setSaleOpen(true);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function _mint(address who, uint256 n) internal {
        vm.prank(who);
        skins.mint{value: PRICE * n}(n);
    }

    /// Close the sale, wait a block, reveal: the order the contract requires.
    function _reveal() internal {
        vm.prank(owner);
        skins.setSaleOpen(false);
        vm.roll(block.number + 1);
        vm.prank(owner);
        skins.reveal(SECRET);
    }

    // ---------------------------------------------------------------- mint

    function test_MintPaysTheTreasury() public {
        _mint(alice, 3);
        assertEq(skins.balanceOf(alice), 3);
        assertEq(skins.ownerOf(3), alice);
        assertEq(treasury.balance, 3 * PRICE);
        assertEq(address(skins).balance, 0);
    }

    function test_MintRules() public {
        vm.startPrank(alice);
        vm.expectRevert(CourierSkins.WrongPayment.selector);
        skins.mint{value: PRICE}(2);
        vm.expectRevert(CourierSkins.BadQuantity.selector);
        skins.mint{value: 0}(0);
        vm.expectRevert(CourierSkins.BadQuantity.selector);
        skins.mint{value: PRICE * 11}(11);
        vm.stopPrank();
        vm.prank(owner);
        skins.setSaleOpen(false);
        vm.prank(alice);
        vm.expectRevert(CourierSkins.SaleClosed.selector);
        skins.mint{value: PRICE}(1);
    }

    function test_SellsOutAt999() public {
        for (uint256 i = 0; i < 99; i++) _mint(alice, 10);
        _mint(alice, 9);
        assertEq(skins.totalMinted(), 999);
        vm.prank(bob);
        vm.expectRevert(CourierSkins.SoldOut.selector);
        skins.mint{value: PRICE}(1);
    }

    // ---------------------------------------------------------------- reveal

    function test_RevealNeedsTheSecretAndEndsTheSale() public {
        _mint(alice, 2);
        vm.expectRevert(CourierSkins.NotRevealed.selector);
        skins.designOf(1);
        vm.prank(owner);
        skins.setSaleOpen(false);
        vm.roll(block.number + 1);
        vm.prank(owner);
        vm.expectRevert(CourierSkins.BadSecret.selector);
        skins.reveal(1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        skins.reveal(SECRET);

        _reveal();
        assertFalse(skins.saleOpen());
        assertTrue(skins.seed() != 0);
        vm.startPrank(owner);
        vm.expectRevert(CourierSkins.AlreadyRevealed.selector);
        skins.reveal(SECRET);
        vm.expectRevert(CourierSkins.AlreadyRevealed.selector);
        skins.setSaleOpen(true);
        vm.stopPrank();
    }

    /// Audit 25e6a0b3 #1: the reveal's entropy must not exist while anyone can still mint.
    function test_RevealNeedsTheSaleClosedInAnEarlierBlock() public {
        _mint(alice, 2);
        uint256 b = block.number + 3; // explicit numbers: via-IR may reuse one read of block.number
        vm.roll(b);
        vm.startPrank(owner);
        vm.expectRevert(CourierSkins.SaleStillOpen.selector);
        skins.reveal(SECRET);
        skins.setSaleOpen(false);
        assertEq(skins.saleClosedAt(), b);
        vm.expectRevert(CourierSkins.RevealTooSoon.selector);
        skins.reveal(SECRET);
        // Reopening and closing again moves the reveal to after the new close.
        vm.roll(b + 1);
        skins.setSaleOpen(true);
        skins.setSaleOpen(false);
        assertEq(skins.saleClosedAt(), b + 1);
        vm.expectRevert(CourierSkins.RevealTooSoon.selector);
        skins.reveal(SECRET);
        vm.roll(b + 2);
        skins.reveal(SECRET);
        vm.stopPrank();
        assertTrue(skins.seed() != 0);
    }

    /// The audit's proof: the owner computes the seed from the secret and the current block, mints the next
    /// ten, and reveals in the same block. The reveal now refuses, so the prediction is worthless.
    function test_OwnerCantMintKnowingTheDesigns() public {
        _mint(alice, 5);
        vm.roll(block.number + 10);
        vm.deal(owner, 1 ether);
        vm.startPrank(owner);
        skins.mint{value: PRICE * 10}(10);
        vm.expectRevert(CourierSkins.SaleStillOpen.selector);
        skins.reveal(SECRET);
        skins.setSaleOpen(false);
        vm.expectRevert(CourierSkins.RevealTooSoon.selector);
        skins.reveal(SECRET);
        vm.stopPrank();
    }

    /// The full mint deals the whole deck: every design exactly as often as its supply.
    function test_FullMintMatchesEverySupply() public {
        for (uint256 i = 0; i < 99; i++) _mint(alice, 10);
        _mint(alice, 9);
        _reveal();
        uint256[16] memory count;
        for (uint256 id = 1; id <= 999; id++) count[skins.designOf(id)]++;
        uint256 total;
        for (uint256 d = 0; d < 16; d++) {
            assertEq(count[d], skins.supplyOf(d), "design count");
            total += skins.supplyOf(d);
        }
        assertEq(total, 999);
    }

    /// Neighbouring tokens don't come in runs of the same design.
    function test_DesignsAreShuffled() public {
        _mint(alice, 10);
        _mint(alice, 10);
        _reveal();
        uint256 same;
        for (uint256 id = 1; id < 20; id++) {
            if (skins.designOf(id) == skins.designOf(id + 1)) same++;
        }
        assertLt(same, 10);
    }

    function testFuzz_DifferentSeedsGiveAValidDeal(uint256 secret) public {
        CourierSkins s = new CourierSkins(owner, treasury, PRICE, keccak256(abi.encode(secret)), address(validator), "x/");
        vm.prank(owner);
        s.setSaleOpen(true);
        vm.prank(alice);
        s.mint{value: PRICE * 10}(10);
        vm.prank(owner);
        s.setSaleOpen(false);
        vm.roll(block.number + 1);
        vm.prank(owner);
        s.reveal(secret);
        for (uint256 id = 1; id <= 10; id++) assertLt(s.designOf(id), 16);
    }

    /// For any seed, the shuffle sends 0..998 to 0..998 with no two the same, so every design is dealt
    /// exactly its supply over the full deck.
    /// forge-config: default.fuzz.runs = 48
    function testFuzz_ShuffleIsABijection(uint256 seed) public {
        ShuffleHarness h = new ShuffleHarness(address(validator), seed);
        uint256[4] memory seen; // a 999-bit set
        uint256[16] memory count;
        for (uint256 x = 0; x < 999; x++) {
            uint256 y = h.shuffle(x);
            assertLt(y, 999);
            uint256 bit = 1 << (y & 255);
            assertEq(seen[y >> 8] & bit, 0, "two inputs share a slot");
            seen[y >> 8] |= bit;
            count[h.designAt(y)]++;
        }
        for (uint256 d = 0; d < 16; d++) assertEq(count[d], h.supplyOf(d));
    }

    // ---------------------------------------------------------------- metadata

    function test_TokenURIBeforeAndAfterReveal() public {
        _mint(alice, 1);
        string memory sealedJson = _json(skins.tokenURI(1));
        assertTrue(_has(sealedJson, '"name":"Courier Skin #1"'));
        assertTrue(_has(sealedJson, "https://courierworld.fun/skins/mystery.png"));
        _reveal();
        string memory json = _json(skins.tokenURI(1));
        uint256 d = skins.designOf(1);
        assertTrue(_has(json, string.concat('"name":"', skins.designName(d), " #1")));
        assertTrue(_has(json, string.concat('"value":"', skins.rarityOf(d), '"')));
        assertTrue(_has(json, '"trait_type":"Type"'));
    }

    /// Audit 25e6a0b3 #3: the reveal and an image move tell marketplaces to re-read every token (ERC-4906).
    function test_RevealAndImageMovesRefreshMarketplaces() public {
        _mint(alice, 3);
        assertTrue(skins.supportsInterface(0x49064906));
        vm.prank(owner);
        skins.setSaleOpen(false);
        vm.roll(block.number + 1);
        vm.expectEmit(address(skins));
        emit CourierSkins.BatchMetadataUpdate(1, 3);
        vm.prank(owner);
        skins.reveal(SECRET);
        vm.expectEmit(address(skins));
        emit CourierSkins.BatchMetadataUpdate(1, 3);
        vm.prank(owner);
        skins.setImageBase("ipfs://new/");
    }

    function test_DesignTable() public view {
        assertEq(skins.designName(0), "Night Rider");
        assertEq(skins.designName(15), "Moonwedge Neon");
        assertEq(skins.rarityOf(4), "Common");
        assertEq(skins.rarityOf(10), "Rare");
        assertEq(skins.rarityOf(11), "Legendary");
        assertEq(skins.supplyOf(0), 120);
        assertEq(skins.supplyOf(5), 60);
        assertEq(skins.supplyOf(9), 40);
        assertEq(skins.supplyOf(12), 20);
        assertEq(skins.supplyOf(15), 13);
    }

    function test_ImagesCanBeMovedUntilFrozen() public {
        vm.startPrank(owner);
        skins.setImageBase("ipfs://abc/");
        skins.freezeImages();
        vm.expectRevert(CourierSkins.ImagesAreFrozen.selector);
        skins.setImageBase("https://elsewhere/");
        vm.stopPrank();
        assertEq(skins.imageBase(), "ipfs://abc/");
    }

    function test_CollectionMetadataLinksTheGame() public {
        string memory json = _json(skins.contractURI());
        assertTrue(_has(json, '"name":"Courier Skins"'));
        assertTrue(_has(json, '"external_link":"https://courierworld.fun/"'));
        assertTrue(_has(json, "https://x.com/PlayCourierWld"));
        assertTrue(_has(json, '"image":"https://courierworld.fun/skins/collection.png"'));
        assertTrue(_has(json, '"banner_image":"https://courierworld.fun/skins/banner.png"'));

        vm.prank(owner);
        vm.expectEmit(address(skins));
        emit CourierSkins.ContractURIUpdated();
        skins.setContractURI("ipfs://collection.json");
        assertEq(skins.contractURI(), "ipfs://collection.json");
        vm.prank(owner);
        skins.setContractURI("");
        assertTrue(_has(_json(skins.contractURI()), '"external_link":"https://courierworld.fun/"'));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        skins.setContractURI("x");
    }

    function test_TokensOfOwner() public {
        _mint(alice, 2);
        _mint(bob, 1);
        _mint(alice, 1);
        uint256[] memory ids = skins.tokensOfOwner(alice);
        assertEq(ids.length, 3);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
        assertEq(ids[2], 4);
    }

    // ---------------------------------------------------------------- royalty

    /// Audit 25e6a0b3 #5: never free, for the owner or anyone.
    function test_PriceCantBeZero() public {
        vm.prank(owner);
        vm.expectRevert(CourierSkins.ZeroPrice.selector);
        skins.setPrice(0);
        vm.expectRevert(CourierSkins.ZeroPrice.selector);
        new CourierSkins(owner, treasury, 0, bytes32(0), address(validator), "");
        vm.prank(alice);
        vm.expectRevert(CourierSkins.WrongPayment.selector);
        skins.mint{value: 0}(1);
    }

    /// Audit 25e6a0b3 #6: ETH forced in without a call leaves with the next mint.
    function test_ForcedEthGoesToTheTreasury() public {
        new ForceSend{value: 1 ether}(payable(address(skins)));
        assertEq(address(skins).balance, 1 ether);
        _mint(alice, 1);
        assertEq(address(skins).balance, 0);
        assertEq(treasury.balance, 1 ether + PRICE);
    }

    function test_RoyaltyIsFivePercentToTheTreasury() public {
        _mint(alice, 1);
        (address to, uint256 amount) = skins.royaltyInfo(1, 1 ether);
        assertEq(to, treasury);
        assertEq(amount, 0.05 ether);
        address newTreasury = makeAddr("newTreasury");
        vm.prank(owner);
        skins.setTreasury(newTreasury);
        (to, amount) = skins.royaltyInfo(1, 1 ether);
        assertEq(to, newTreasury);
        assertEq(amount, 0.05 ether);
    }

    function test_InterfacesForMarketplaces() public view {
        assertTrue(skins.supportsInterface(type(IERC721).interfaceId));
        assertTrue(skins.supportsInterface(type(IERC2981).interfaceId));
        assertTrue(skins.supportsInterface(0xad0d7f6c)); // ICreatorToken
        assertEq(type(ICreatorToken).interfaceId, bytes4(0xad0d7f6c));
        (bytes4 fn, bool isView) = skins.getTransferValidationFunction();
        assertEq(fn, bytes4(keccak256("validateTransfer(address,address,address,uint256)")));
        assertTrue(isView);
        assertEq(skins.getTransferValidator(), address(validator));
    }

    // ---------------------------------------------------------------- enforcement

    function test_HoldersCanMoveTheirOwnSkins() public {
        _mint(alice, 1);
        vm.prank(alice);
        skins.transferFrom(alice, bob, 1);
        assertEq(skins.ownerOf(1), bob);
        vm.prank(bob);
        skins.safeTransferFrom(bob, alice, 1);
        assertEq(skins.ownerOf(1), alice);
    }

    function test_MarketplacesNeedTheFeeCheck() public {
        _mint(alice, 1);
        vm.prank(alice);
        skins.setApprovalForAll(market, true);
        // An approved marketplace that skips the royalty can't move the skin.
        vm.prank(market);
        vm.expectRevert(StrictValidator.UnauthorizedTransfer.selector);
        skins.transferFrom(alice, bob, 1);
        // Once the sale goes through the fee check, it can.
        validator.authorize(market, true);
        vm.prank(market);
        skins.transferFrom(alice, bob, 1);
        assertEq(skins.ownerOf(1), bob);
    }

    function test_SafeTransfersWithDataAreCheckedToo() public {
        _mint(alice, 1);
        vm.prank(alice);
        skins.setApprovalForAll(market, true);
        vm.prank(market);
        vm.expectRevert(StrictValidator.UnauthorizedTransfer.selector);
        skins.safeTransferFrom(alice, bob, 1, "sale");
        vm.prank(alice);
        skins.safeTransferFrom(alice, bob, 1, "gift");
        assertEq(skins.ownerOf(1), bob);
    }

    function test_EnforcementCanMoveButNeverBeSwitchedOff() public {
        vm.startPrank(owner);
        vm.expectRevert(CourierSkins.NotAContract.selector);
        skins.setTransferValidator(address(0));
        vm.expectRevert(CourierSkins.NotAContract.selector);
        skins.setTransferValidator(makeAddr("eoa"));
        StrictValidator next = new StrictValidator();
        skins.setTransferValidator(address(next));
        vm.stopPrank();
        assertEq(skins.getTransferValidator(), address(next));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        skins.setTransferValidator(address(validator));

        vm.expectRevert(CourierSkins.NotAContract.selector);
        new CourierSkins(owner, treasury, PRICE, bytes32(0), address(0), "");
    }

    // ---------------------------------------------------------------- owner

    function test_RenounceOnlyWhenFinished() public {
        _mint(alice, 1);
        vm.startPrank(owner);
        vm.expectRevert(CourierSkins.NotFinished.selector);
        skins.renounceOwnership();
        vm.stopPrank();
        _reveal();
        vm.startPrank(owner);
        vm.expectRevert(CourierSkins.NotFinished.selector);
        skins.renounceOwnership();
        skins.freezeImages();
        skins.renounceOwnership();
        vm.stopPrank();
        assertEq(skins.owner(), address(0));
    }

    function test_OwnerOnly() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        skins.setPrice(1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        skins.setTreasury(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        skins.setSaleOpen(false);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        skins.setImageBase("x");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        skins.freezeImages();
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers

    function _json(string memory uri) internal pure returns (string memory) {
        bytes memory u = bytes(uri);
        bytes memory prefix = bytes("data:application/json;base64,");
        bytes memory b64 = new bytes(u.length - prefix.length);
        for (uint256 i = 0; i < b64.length; i++) b64[i] = u[i + prefix.length];
        return string(_decode(string(b64)));
    }

    function _decode(string memory s) internal pure returns (bytes memory) {
        bytes memory table = bytes("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
        bytes memory input = bytes(s);
        uint8[128] memory rev;
        for (uint8 i = 0; i < 64; i++) rev[uint8(table[i])] = i;
        uint256 pad = 0;
        if (input.length > 0 && input[input.length - 1] == "=") pad++;
        if (input.length > 1 && input[input.length - 2] == "=") pad++;
        bytes memory out = new bytes((input.length / 4) * 3 - pad);
        uint256 o;
        for (uint256 i = 0; i < input.length; i += 4) {
            uint256 n = (uint256(rev[uint8(input[i])]) << 18) | (uint256(rev[uint8(input[i + 1])]) << 12)
                | (uint256(input[i + 2] == "=" ? 0 : rev[uint8(input[i + 2])]) << 6)
                | uint256(input[i + 3] == "=" ? 0 : rev[uint8(input[i + 3])]);
            if (o < out.length) out[o++] = bytes1(uint8(n >> 16));
            if (o < out.length) out[o++] = bytes1(uint8(n >> 8));
            if (o < out.length) out[o++] = bytes1(uint8(n));
        }
        return out;
    }

    function _has(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length && ok; j++) {
                if (h[i + j] != n[j]) ok = false;
            }
            if (ok) return true;
        }
        return false;
    }
}

/// The registry's side of OpenSea's fee-checked sales, called by the SignedZone around a transfer.
interface IAuthorizer {
    function beforeAuthorizedTransfer(address token, uint256 tokenId) external;
    function afterAuthorizedTransfer(address token, uint256 tokenId) external;
}

/// Stand-in for the SignedZone's calls around a sale.
contract ZoneFlow {
    function sell(address registry, address token, address market, address from, address to, uint256 id) external {
        IAuthorizer(registry).beforeAuthorizedTransfer(token, id);
        MarketMove(market).move(token, from, to, id);
        IAuthorizer(registry).afterAuthorizedTransfer(token, id);
    }
}

/// Stand-in for the marketplace moving the sold token.
contract MarketMove {
    function move(address token, address from, address to, uint256 id) external {
        IERC721(token).transferFrom(from, to, id);
    }
}

/// @notice Against OpenSea's real creator fee enforcement registry on Robinhood Chain.
///   forge test --match-contract CourierSkinsForkTest --fork-url robinhood
/// Skipped when not forked.
contract CourierSkinsForkTest is Test {
    address constant REGISTRY = 0xA000027A9B2802E1ddf7000061001e5c005A0000; // StrictAuthorizedTransferSecurityRegistry
    address constant SEAPORT = 0x0000000000000068F116a894984e2DB1123eB395; // Seaport 1.6
    bytes4 constant UNAUTHORIZED = 0x1de5204e; // StrictAuthorizedTransferSecurityRegistry__UnauthorizedTransfer()
    address constant SIGNED_ZONE = 0x000056F7000000EcE9003ca63978907a00FFD100; // OpenSea's SignedZone

    CourierSkins skins;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        if (block.chainid != 4663) return;
        skins = new CourierSkins(owner, makeAddr("treasury"), 0.004 ether, bytes32(0), REGISTRY, "https://courierworld.fun/skins/");
        vm.prank(owner);
        skins.setSaleOpen(true);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        skins.mint{value: 0.008 ether}(2);
    }

    function test_Fork_HolderTransfersPass() public {
        if (block.chainid != 4663) return;
        vm.prank(alice);
        skins.transferFrom(alice, bob, 1);
        assertEq(skins.ownerOf(1), bob);
    }

    /// A real OpenSea sale, as one transaction like Seaport runs it: the SignedZone (which checks the order pays
    /// the creator fee) authorizes the token on the live registry, the approved marketplace moves it, and the
    /// zone clears the flag. The registry keeps the flag in transient storage, so it only lives inside that
    /// transaction; the zone and Seaport addresses get stand-in code that makes exactly those calls.
    function test_Fork_SaleAuthorizedByOpenSeaGoesThrough() public {
        if (block.chainid != 4663) return;
        vm.etch(SIGNED_ZONE, address(new ZoneFlow()).code);
        vm.etch(SEAPORT, address(new MarketMove()).code);
        vm.prank(alice);
        skins.setApprovalForAll(SEAPORT, true);
        ZoneFlow(SIGNED_ZONE).sell(REGISTRY, address(skins), SEAPORT, alice, bob, 2);
        assertEq(skins.ownerOf(2), bob);
        // Without the zone, the same marketplace is refused.
        vm.prank(bob);
        skins.setApprovalForAll(SEAPORT, true);
        vm.prank(SEAPORT);
        vm.expectRevert(UNAUTHORIZED);
        skins.transferFrom(bob, alice, 2);
    }

    /// Only an authorizer on the collection's list (OpenSea's zone on the default list) can authorize.
    function test_Fork_StrangersCantAuthorize() public {
        if (block.chainid != 4663) return;
        vm.etch(SEAPORT, address(new MarketMove()).code);
        ZoneFlow stranger = new ZoneFlow();
        vm.prank(alice);
        skins.setApprovalForAll(SEAPORT, true);
        vm.expectRevert();
        stranger.sell(REGISTRY, address(skins), SEAPORT, alice, bob, 1);
        assertEq(skins.ownerOf(1), alice);
    }

    /// Seaport, or any approved operator, can't move a skin outside OpenSea's fee-checked flow.
    function test_Fork_MarketplaceWithoutFeeCheckReverts() public {
        if (block.chainid != 4663) return;
        vm.prank(alice);
        skins.setApprovalForAll(SEAPORT, true);
        vm.prank(SEAPORT);
        vm.expectRevert(UNAUTHORIZED);
        skins.transferFrom(alice, bob, 2);

        address otherMarket = makeAddr("otherMarket");
        vm.prank(alice);
        skins.setApprovalForAll(otherMarket, true);
        vm.prank(otherMarket);
        vm.expectRevert(UNAUTHORIZED);
        skins.transferFrom(alice, bob, 2);
        assertEq(skins.ownerOf(2), alice);
    }
}
