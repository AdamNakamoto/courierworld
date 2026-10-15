// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC1155Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {CourierFish, IFishPostOffice} from "../src/CourierFish.sol";
import {DeployFish} from "../script/DeployFish.s.sol";

/// Stands in for the post office: which wallets have an office open.
contract MockOffices is IFishPostOffice {
    mapping(address => bool) public open;

    function setOpen(address who, bool o) external {
        open[who] = o;
    }

    function offices(address owner) external view returns (bool, uint8, uint8, uint16, uint64, address, uint256, uint256, uint256) {
        return (open[owner], 0, 0, 0, 0, address(0), 0, 0, 0);
    }
}

/// Acts like OpenSea's strict registry: holders move their own; any other caller needs the fee check (`authorize`).
contract StrictFishValidator {
    error UnauthorizedTransfer();

    mapping(address => bool) public authorized;

    function authorize(address operator, bool ok) external {
        authorized[operator] = ok;
    }

    function validateTransfer(address caller, address from, address, uint256, uint256) external view {
        if (caller != from && !authorized[caller]) revert UnauthorizedTransfer();
    }
}

contract Coin is ERC20 {
    constructor() ERC20("Coin", "C") {
        _mint(msg.sender, 1e24);
    }
}

/// A contract wallet (with an office) that tries to mint again while its fish arrive.
contract GreedyAngler is IERC1155Receiver {
    CourierFish public fish;
    CourierFish.Voucher internal held;
    bool public tried;
    bytes public err;

    constructor(CourierFish fish_) {
        fish = fish_;
    }

    function go(CourierFish.Voucher calldata v) external {
        held = v;
        fish.mint(v);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external returns (bytes4) {
        if (!tried) {
            tried = true;
            try fish.mint(held) {} catch (bytes memory e) {
                err = e;
            }
        }
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC1155Receiver).interfaceId;
    }
}

/// A contract with no way to receive ERC-1155 tokens.
contract NoFishReceiver {
    function go(CourierFish fish, CourierFish.Voucher calldata v) external {
        fish.mint(v);
    }
}

abstract contract FishFixture is Test {
    CourierFish fish;
    MockOffices offices;
    StrictFishValidator validator;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    uint256 signerKey = 0x51617;
    address signer;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 constant SARDINE = 1;
    uint256 constant BOOT = 8;
    uint256 constant BOTTLE = 15;
    uint256 constant LIONFISH = 16;
    uint256 constant SQUID = 22;
    uint256 constant STAMPFISH = 24;

    function _deploy() internal {
        vm.warp(1_790_000_000); // a real-looking day, so day - 7 doesn't underflow
        signer = vm.addr(signerKey);
        offices = new MockOffices();
        validator = new StrictFishValidator();
        fish = new CourierFish(owner, offices, signer, treasury, address(validator), 10, "https://courierworld.fun/fish/");
        vm.startPrank(owner);
        for (uint256 id = 1; id <= 15; ++id) fish.setSpecies(id, 0, 0);
        for (uint256 id = 16; id <= 20; ++id) fish.setSpecies(id, 500, 20);
        for (uint256 id = 21; id <= 23; ++id) fish.setSpecies(id, 100, 5);
        fish.setSpecies(24, 21, 1);
        vm.stopPrank();
        offices.setOpen(alice, true);
        offices.setOpen(bob, true);
    }

    function _today() internal view returns (uint32) {
        return uint32(vm.getBlockTimestamp() / 1 days);
    }

    function _voucher(address player, uint32 day, uint256[] memory ids, uint256[] memory counts) internal view returns (CourierFish.Voucher memory) {
        return _voucherBy(signerKey, player, day, ids, counts, uint64(vm.getBlockTimestamp() + 1 hours));
    }

    function _voucherBy(uint256 key, address player, uint32 day, uint256[] memory ids, uint256[] memory counts, uint64 deadline)
        internal
        view
        returns (CourierFish.Voucher memory v)
    {
        // (no call to the contract here: it would use up a vm.prank made before building the voucher)
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Catch(address player,uint32 day,uint256[] ids,uint256[] counts,uint64 deadline)"), player, day, keccak256(abi.encodePacked(ids)), keccak256(abi.encodePacked(counts)), deadline
        ));
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Courier World Fish"), keccak256("1"), block.chainid, address(fish)
        ));
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        v = CourierFish.Voucher(day, ids, counts, deadline, abi.encodePacked(r, s, vv));
    }

    function _one(uint256 a) internal pure returns (uint256[] memory x) {
        x = new uint256[](1);
        x[0] = a;
    }

    function _two(uint256 a, uint256 b) internal pure returns (uint256[] memory x) {
        x = new uint256[](2);
        x[0] = a;
        x[1] = b;
    }
}

contract CourierFishTest is FishFixture {
    function setUp() public {
        _deploy();
    }

    // ---------------------------------------------------------------- minting

    function test_mintsTheDaysCatch() public {
        uint32 day = _today();
        CourierFish.Voucher memory v = _voucher(alice, day, _two(SARDINE, LIONFISH), _two(3, 1));
        vm.expectEmit(true, true, false, true);
        emit CourierFish.Minted(alice, day, _two(SARDINE, LIONFISH), _two(3, 1));
        vm.prank(alice);
        assertEq(fish.mint(v), 4);
        assertEq(fish.balanceOf(alice, SARDINE), 3);
        assertEq(fish.balanceOf(alice, LIONFISH), 1);
        (, uint32 minted,,) = fish.species(LIONFISH);
        assertEq(minted, 1);
        assertEq(fish.claimedOn(alice, day), 4);
        assertEq(fish.mintedOn(LIONFISH, day), 1);
    }

    function test_aLaterVoucherMintsOnlyWhatsNew() public {
        uint32 day = _today();
        vm.prank(alice);
        fish.mint(_voucher(alice, day, _one(SARDINE), _one(2)));
        vm.prank(alice);
        assertEq(fish.mint(_voucher(alice, day, _two(SARDINE, BOOT), _two(5, 1))), 4);
        assertEq(fish.balanceOf(alice, SARDINE), 5);
        assertEq(fish.balanceOf(alice, BOOT), 1);
        // The same voucher again mints nothing.
        CourierFish.Voucher memory again = _voucher(alice, day, _two(SARDINE, BOOT), _two(5, 1));
        vm.prank(alice);
        vm.expectRevert(CourierFish.NothingToMint.selector);
        fish.mint(again);
    }

    function test_voucherRules() public {
        uint32 day = _today();
        CourierFish.Voucher memory v = _voucher(alice, day, _two(LIONFISH, SARDINE), _two(1, 1));
        vm.prank(alice);
        vm.expectRevert(CourierFish.BadVoucher.selector); // out of order
        fish.mint(v);
        v = _voucher(alice, day, _two(SARDINE, SARDINE), _two(1, 2));
        vm.prank(alice);
        vm.expectRevert(CourierFish.BadVoucher.selector); // twice
        fish.mint(v);
        v = _voucher(alice, day, _two(SARDINE, BOOT), _one(1));
        vm.prank(alice);
        vm.expectRevert(CourierFish.BadVoucher.selector); // a count missing
        fish.mint(v);
        v = _voucher(alice, day, new uint256[](0), new uint256[](0));
        vm.prank(alice);
        vm.expectRevert(CourierFish.BadVoucher.selector); // empty
        fish.mint(v);
        v = _voucher(alice, day, _one(99), _one(1));
        vm.prank(alice);
        vm.expectRevert(CourierFish.UnknownSpecies.selector);
        fish.mint(v);
    }

    function test_onlyTheServersVoucherForYouMints() public {
        uint32 day = _today();
        CourierFish.Voucher memory forAlice = _voucher(alice, day, _one(SARDINE), _one(1));
        vm.prank(bob);
        vm.expectRevert(CourierFish.BadSignature.selector); // someone else's
        fish.mint(forAlice);
        CourierFish.Voucher memory forged = _voucherBy(0xBAD, alice, day, _one(SARDINE), _one(1), uint64(vm.getBlockTimestamp() + 1 hours));
        vm.prank(alice);
        vm.expectRevert(CourierFish.BadSignature.selector);
        fish.mint(forged);
        forAlice.signature = hex"1234";
        vm.prank(alice);
        vm.expectRevert(CourierFish.BadSignature.selector); // malformed
        fish.mint(forAlice);
        forAlice = _voucher(alice, day, _one(SARDINE), _one(1));
        forAlice.counts[0] = 9; // tampered
        vm.prank(alice);
        vm.expectRevert(CourierFish.BadSignature.selector);
        fish.mint(forAlice);
    }

    function test_theClaimWindow() public {
        uint32 day = _today();
        CourierFish.Voucher memory v = _voucherBy(signerKey, alice, day, _one(SARDINE), _one(1), uint64(vm.getBlockTimestamp() + 30 days));
        CourierFish.Voucher memory future = _voucherBy(signerKey, alice, day + 1, _one(SARDINE), _one(1), uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(alice);
        vm.expectRevert(CourierFish.FutureDay.selector);
        fish.mint(future);
        vm.warp(vm.getBlockTimestamp() + 6 days); // the last day it can be minted
        vm.prank(alice);
        fish.mint(v);
        CourierFish.Voucher memory late = _voucherBy(signerKey, bob, day, _one(SARDINE), _one(1), uint64(vm.getBlockTimestamp() + 30 days));
        vm.warp((uint256(day) + 7) * 1 days); // the first second it can't
        vm.prank(bob);
        vm.expectRevert(CourierFish.TooLate.selector);
        fish.mint(late);
        CourierFish.Voucher memory expired = _voucherBy(signerKey, bob, _today(), _one(SARDINE), _one(1), uint64(vm.getBlockTimestamp() - 1));
        vm.prank(bob);
        vm.expectRevert(CourierFish.Expired.selector);
        fish.mint(expired);
    }

    function test_needsAnOfficeAndNoPause() public {
        address carol = makeAddr("carol");
        CourierFish.Voucher memory v = _voucher(carol, _today(), _one(SARDINE), _one(1));
        vm.prank(carol);
        vm.expectRevert(CourierFish.NoOffice.selector);
        fish.mint(v);
        vm.prank(owner);
        fish.setPaused(true);
        v = _voucher(alice, _today(), _one(SARDINE), _one(1));
        vm.prank(alice);
        vm.expectRevert(CourierFish.IsPaused.selector);
        fish.mint(v);
        vm.prank(owner);
        fish.setPaused(false);
        vm.prank(alice);
        fish.mint(v);
    }

    // ---------------------------------------------------------------- limits

    function test_dailyLimit() public {
        uint32 day = _today();
        CourierFish.Voucher memory v = _voucher(alice, day, _one(SARDINE), _one(11));
        vm.prank(alice);
        assertEq(fish.mint(v), 10, "a day's catch past the limit mints only the limit");
        assertEq(fish.claimedOn(alice, day), 10);
        // The next day is a new day.
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vm.prank(alice);
        fish.mint(_voucher(alice, day + 1, _one(SARDINE), _one(10)));
        assertEq(fish.balanceOf(alice, SARDINE), 20);
    }

    /// A leaked key signing a different mix for the same day still can't pass the day's limit.
    function test_aLeakedKeyCantMixPastTheDailyLimit() public {
        uint32 day = _today();
        vm.prank(alice);
        fish.mint(_voucher(alice, day, _one(SARDINE), _one(10)));
        CourierFish.Voucher memory other = _voucher(alice, day, _one(BOOT), _one(1));
        vm.prank(alice);
        vm.expectRevert(CourierFish.NothingToMint.selector);
        fish.mint(other);
        assertEq(fish.balanceOf(alice, BOOT), 0);
    }

    /// The owner lowering the limit after a catch: the day's fish mint up to the new limit, the rest are spent.
    function test_aLoweredLimitMintsUpToItInsteadOfReverting() public {
        uint32 day = _today();
        CourierFish.Voucher memory v = _voucher(alice, day, _two(SARDINE, BOOT), _two(6, 4));
        vm.prank(owner);
        fish.setMaxPerDay(5);
        uint256[] memory q = fish.mintable(alice, day, _two(SARDINE, BOOT), _two(6, 4));
        assertEq(q[0] + q[1], 5, "mintable says 5");
        vm.prank(alice);
        assertEq(fish.mint(v), 5);
        assertEq(fish.balanceOf(alice, SARDINE), 5);
        assertEq(fish.balanceOf(alice, BOOT), 0);
        assertEq(fish.claimed(alice, day, BOOT), 4, "the rest are spent");
    }

    function test_capsBoundRareFish() public {
        uint32 day = _today();
        // The legendary: one a day across everyone.
        vm.prank(alice);
        fish.mint(_voucher(alice, day, _one(STAMPFISH), _one(1)));
        CourierFish.Voucher memory v = _voucher(bob, day, _two(SARDINE, STAMPFISH), _two(1, 1));
        vm.prank(bob);
        assertEq(fish.mint(v), 1, "only the sardine: the day's stampfish is taken");
        assertEq(fish.balanceOf(bob, STAMPFISH), 0);
        assertEq(fish.claimedOn(bob, day), 2, "the stampfish still counts against bob's day");
        // A voucher with nothing left to mint at all reverts, and spends nothing.
        address carol = makeAddr("carol");
        offices.setOpen(carol, true);
        v = _voucher(carol, day, _one(STAMPFISH), _one(1));
        vm.prank(carol);
        vm.expectRevert(CourierFish.NothingToMint.selector);
        fish.mint(v);
        assertEq(fish.claimed(carol, day, STAMPFISH), 0);
    }

    function test_maxSupplyIsForever() public {
        // 21 stampfish over 21 days, then none.
        for (uint256 i; i < 21; ++i) {
            address p = vm.addr(1000 + i);
            offices.setOpen(p, true);
            CourierFish.Voucher memory v = _voucher(p, _today(), _one(STAMPFISH), _one(1));
            vm.prank(p);
            fish.mint(v);
            vm.warp(vm.getBlockTimestamp() + 1 days);
        }
        (, uint32 minted,,) = fish.species(STAMPFISH);
        assertEq(minted, 21);
        CourierFish.Voucher memory more = _voucher(alice, _today(), _one(STAMPFISH), _one(1));
        vm.prank(alice);
        vm.expectRevert(CourierFish.NothingToMint.selector);
        fish.mint(more);
    }

    function test_mintManySkipsStaleButNotForged() public {
        uint32 day = _today();
        CourierFish.Voucher[] memory vs = new CourierFish.Voucher[](3);
        vs[0] = _voucherBy(signerKey, alice, day, _one(SARDINE), _one(2), uint64(vm.getBlockTimestamp() + 30 days));
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vs[1] = _voucher(alice, day + 1, _one(BOOT), _one(3));
        vs[2] = _voucherBy(signerKey, alice, day + 1, _one(BOTTLE), _one(1), uint64(vm.getBlockTimestamp() - 1)); // expired
        vm.prank(alice);
        assertEq(fish.mintMany(vs), 5);
        assertEq(fish.balanceOf(alice, BOTTLE), 0);
        vs[2] = _voucherBy(0xBAD, alice, day + 1, _one(BOTTLE), _one(1), uint64(vm.getBlockTimestamp() + 1 hours));
        vm.prank(alice);
        vm.expectRevert(CourierFish.BadSignature.selector);
        fish.mintMany(vs);
    }

    function test_mintableQuotesWhatAMintWouldGive() public {
        uint32 day = _today();
        vm.prank(alice);
        fish.mint(_voucher(alice, day, _two(SARDINE, STAMPFISH), _two(2, 1)));
        uint256[] memory q = fish.mintable(bob, day, _two(SARDINE, STAMPFISH), _two(3, 1));
        assertEq(q[0], 3);
        assertEq(q[1], 0, "the day's stampfish is gone");
        q = fish.mintable(alice, day, _two(SARDINE, STAMPFISH), _two(5, 1));
        assertEq(q[0], 3);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        q = fish.mintable(bob, day, _one(SARDINE), _one(3));
        assertEq(q[0], 0, "too late");
    }

    function test_reentrantMintIsBlocked() public {
        GreedyAngler angler = new GreedyAngler(fish);
        offices.setOpen(address(angler), true);
        uint32 day = _today();
        angler.go(_voucher(address(angler), day, _two(SARDINE, BOOT), _two(1, 1)));
        assertTrue(angler.tried());
        assertEq(bytes4(angler.err()), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(fish.balanceOf(address(angler), SARDINE), 1);
    }

    function test_aWalletThatCantReceiveRevertsTheMint() public {
        NoFishReceiver nope = new NoFishReceiver();
        offices.setOpen(address(nope), true);
        CourierFish.Voucher memory v = _voucher(address(nope), _today(), _one(SARDINE), _one(1));
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155InvalidReceiver.selector, address(nope)));
        nope.go(fish, v);
        assertEq(fish.claimed(address(nope), _today(), SARDINE), 0);
    }

    // ---------------------------------------------------------------- the owner

    function test_speciesRules() public {
        vm.startPrank(owner);
        vm.expectRevert(CourierFish.SupplyCanOnlyShrink.selector);
        fish.setSpecies(STAMPFISH, 22, 1); // grow
        vm.expectRevert(CourierFish.SupplyCanOnlyShrink.selector);
        fish.setSpecies(STAMPFISH, 0, 1); // uncap
        fish.setSpecies(STAMPFISH, 20, 2); // shrink, and change the daily cap
        fish.setSpecies(SARDINE, 1000, 0); // cap a common one
        vm.expectRevert(CourierFish.SupplyCanOnlyShrink.selector);
        fish.setSpecies(SARDINE, 0, 0); // and it stays capped
        fish.setSpecies(25, 0, 0); // a new species
        vm.stopPrank();
        (uint32 maxSupply,, uint32 dailyCap, bool exists) = fish.species(STAMPFISH);
        assertEq(maxSupply, 20);
        assertEq(dailyCap, 2);
        assertTrue(exists);
        assertEq(fish.speciesCount(), 25);
        vm.prank(alice);
        fish.mint(_voucher(alice, _today(), _one(LIONFISH), _one(3)));
        vm.prank(owner);
        vm.expectRevert(CourierFish.SupplyCanOnlyShrink.selector);
        fish.setSpecies(LIONFISH, 2, 20); // below what's minted
        vm.prank(owner);
        fish.setSpecies(LIONFISH, 3, 20); // retired: exactly what's minted
    }

    function test_setSpeciesMany() public {
        uint256[] memory ids = _two(30, 31);
        vm.prank(owner);
        vm.expectRevert(CourierFish.BadSupply.selector);
        fish.setSpeciesMany(ids, _one(5), _two(1, 1));
        vm.prank(owner);
        fish.setSpeciesMany(ids, _two(0, 50), _two(0, 3));
        (uint32 m30,,, bool e30) = fish.species(30);
        (uint32 m31,, uint32 d31,) = fish.species(31);
        assertTrue(e30);
        assertEq(m30, 0);
        assertEq(m31, 50);
        assertEq(d31, 3);
        // The same rules as one at a time: a capped species can't grow.
        vm.prank(owner);
        vm.expectRevert(CourierFish.SupplyCanOnlyShrink.selector);
        fish.setSpeciesMany(_one(31), _one(51), _one(3));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        fish.setSpeciesMany(ids, _two(0, 0), _two(0, 0));
    }

    function test_ownerControls() public {
        vm.startPrank(owner);
        vm.expectRevert(CourierFish.BadLimit.selector);
        fish.setMaxPerDay(0);
        vm.expectRevert(CourierFish.BadLimit.selector);
        fish.setMaxPerDay(51);
        fish.setMaxPerDay(2);
        address newSigner = vm.addr(0x5160);
        vm.expectEmit(true, true, false, false);
        emit CourierFish.SignerSet(signer, newSigner);
        fish.setSigner(newSigner);
        vm.expectRevert(CourierFish.ZeroAddress.selector);
        fish.setSigner(address(0));
        vm.stopPrank();
        CourierFish.Voucher memory v = _voucher(alice, _today(), _one(SARDINE), _one(1));
        vm.prank(alice);
        vm.expectRevert(CourierFish.BadSignature.selector); // the old key no longer counts
        fish.mint(v);
        v = _voucherBy(0x5160, alice, _today(), _one(SARDINE), _one(3), uint64(vm.getBlockTimestamp() + 1 hours));
        vm.prank(alice);
        assertEq(fish.mint(v), 2, "now 2 a day");
    }

    function test_ownerOnly() public {
        bytes memory no = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice);
        vm.startPrank(alice);
        vm.expectRevert(no);
        fish.setSpecies(30, 0, 0);
        vm.expectRevert(no);
        fish.setSigner(alice);
        vm.expectRevert(no);
        fish.setPaused(true);
        vm.expectRevert(no);
        fish.setMaxPerDay(20);
        vm.expectRevert(no);
        fish.setTreasury(alice);
        vm.expectRevert(no);
        fish.setBase("x/");
        vm.expectRevert(no);
        fish.setTransferValidator(address(validator));
        vm.stopPrank();
        vm.prank(owner);
        vm.expectRevert(CourierFish.CannotRenounce.selector);
        fish.renounceOwnership();
    }

    function test_royaltyIsFixedAndFollowsTheTreasury() public {
        (address to, uint256 fee) = fish.royaltyInfo(SARDINE, 10_000);
        assertEq(to, treasury);
        assertEq(fee, 500);
        address next = makeAddr("next");
        vm.prank(owner);
        fish.setTreasury(next);
        (to, fee) = fish.royaltyInfo(SARDINE, 10_000);
        assertEq(to, next);
        assertEq(fee, 500);
        vm.prank(owner);
        vm.expectRevert(CourierFish.BadTreasury.selector);
        fish.setTreasury(address(fish));
    }

    function test_rescue() public {
        Coin coin = new Coin();
        coin.transfer(address(fish), 5e18);
        vm.prank(owner);
        fish.rescue(coin, bob);
        assertEq(coin.balanceOf(bob), 5e18);
    }

    function test_constructorChecks() public {
        vm.expectRevert(CourierFish.ZeroAddress.selector);
        new CourierFish(owner, IFishPostOffice(address(0)), signer, treasury, address(validator), 10, "x/");
        vm.expectRevert(CourierFish.ZeroAddress.selector);
        new CourierFish(owner, offices, address(0), treasury, address(validator), 10, "x/");
        vm.expectRevert(CourierFish.BadLimit.selector);
        new CourierFish(owner, offices, signer, treasury, address(validator), 0, "x/");
        vm.expectRevert(CourierFish.NotAContract.selector);
        new CourierFish(owner, offices, signer, treasury, makeAddr("eoa"), 10, "x/");
    }

    // ---------------------------------------------------------------- royalty enforcement and reading

    function test_holdersMoveTheirOwnButMarketplacesNeedTheFeeCheck() public {
        vm.prank(alice);
        fish.mint(_voucher(alice, _today(), _one(SARDINE), _one(3)));
        vm.prank(alice);
        fish.safeTransferFrom(alice, bob, SARDINE, 1, "");
        address market = makeAddr("market");
        vm.prank(alice);
        fish.setApprovalForAll(market, true);
        vm.prank(market);
        vm.expectRevert(StrictFishValidator.UnauthorizedTransfer.selector);
        fish.safeTransferFrom(alice, bob, SARDINE, 1, "");
        validator.authorize(market, true);
        vm.prank(market);
        fish.safeTransferFrom(alice, bob, SARDINE, 1, "");
        assertEq(fish.balanceOf(bob, SARDINE), 2);
    }

    function test_marketplacesSeeTheEnforcement() public view {
        assertTrue(fish.supportsInterface(0xad0d7f6c), "ICreatorToken (v3)");
        assertTrue(fish.supportsInterface(type(IERC1155).interfaceId));
        assertTrue(fish.supportsInterface(type(IERC2981).interfaceId));
        (bytes4 fn, bool isView) = fish.getTransferValidationFunction();
        assertEq(fn, bytes4(keccak256("validateTransfer(address,address,address,uint256,uint256)")));
        assertFalse(isView);
    }

    function test_metadataAndLists() public {
        assertEq(fish.name(), "Courier Fish");
        assertEq(fish.symbol(), "FISH");
        assertEq(fish.uri(STAMPFISH), "https://courierworld.fun/fish/24.json");
        assertEq(fish.contractURI(), "https://courierworld.fun/fish/collection.json");
        (uint256[] memory ids, CourierFish.Species[] memory list) = fish.allSpecies();
        assertEq(ids.length, 24);
        assertEq(ids[23], STAMPFISH);
        assertEq(list[23].maxSupply, 21);
        assertEq(list[15].dailyCap, 20);
        assertEq(list[0].maxSupply, 0);
    }

    /// The deploy script: owned by the wallet that broadcasts, the 24 species with their caps, 10 a day.
    function test_deployScript() public {
        DeployFish script = new DeployFish();
        vm.setEnv("POST_OFFICE", vm.toString(address(offices)));
        vm.setEnv("FISH_SIGNER", vm.toString(signer));
        vm.setEnv("TREASURY", vm.toString(treasury));
        CourierFish deployed = script.run();
        assertEq(deployed.owner(), DEFAULT_SENDER);
        assertEq(deployed.signer(), signer);
        assertEq(deployed.maxPerDay(), 10);
        assertEq(deployed.speciesCount(), 24);
        (uint32 cap,, uint32 daily,) = deployed.species(24);
        assertEq(cap, 21);
        assertEq(daily, 1);
        (cap,, daily,) = deployed.species(21);
        assertEq(cap, 100);
        assertEq(daily, 5);
        (cap,, daily,) = deployed.species(9);
        assertEq(cap, 0);
        assertGt(deployed.getTransferValidator().code.length, 0);
    }

    // ---------------------------------------------------------------- fuzz

    /// Whatever vouchers a (leaked) key signs for a day, a wallet never gets more than the daily limit, and no capped
    /// species passes its daily cap or its total.
    function testFuzz_noVoucherPassesTheLimits(uint256 seed) public {
        uint32 day = _today();
        for (uint256 round; round < 6; ++round) {
            uint256 a = 1 + (uint256(keccak256(abi.encode(seed, round, "a"))) % 23);
            uint256 b = a + 1 + (uint256(keccak256(abi.encode(seed, round, "b"))) % (24 - a));
            uint256[] memory counts = _two(uint256(keccak256(abi.encode(seed, round, "x"))) % 12, uint256(keccak256(abi.encode(seed, round, "y"))) % 12);
            CourierFish.Voucher memory v = _voucher(alice, day, _two(a, b), counts);
            vm.prank(alice);
            try fish.mint(v) {} catch {}
        }
        assertLe(fish.claimedOn(alice, day), 10);
        uint256 held;
        for (uint256 id = 1; id <= 24; ++id) {
            held += fish.balanceOf(alice, id);
            (uint32 maxSupply, uint32 minted, uint32 dailyCap,) = fish.species(id);
            if (dailyCap != 0) assertLe(fish.mintedOn(id, day), dailyCap);
            if (maxSupply != 0) assertLe(minted, maxSupply);
        }
        assertLe(held, 10);
    }
}

interface IFishAuthorizer {
    function beforeAuthorizedTransferWithAmount(address token, uint256 tokenId, uint256 amount) external;
    function afterAuthorizedTransferWithAmount(address token, uint256 tokenId) external;
}

/// Stand-in for the SignedZone's calls around a sale of `amount` of species `id`.
contract FishZoneFlow {
    function sell(address registry, address token, address market, address from, address to, uint256 id, uint256 amount) external {
        IFishAuthorizer(registry).beforeAuthorizedTransferWithAmount(token, id, amount);
        FishMarketMove(market).move(token, from, to, id, amount);
        IFishAuthorizer(registry).afterAuthorizedTransferWithAmount(token, id);
    }
}

/// Stand-in for the marketplace moving what was sold.
contract FishMarketMove {
    function move(address token, address from, address to, uint256 id, uint256 amount) external {
        IERC1155(token).safeTransferFrom(from, to, id, amount, "");
    }
}

/// @notice Against OpenSea's real creator fee enforcement registry on Robinhood Chain.
///   forge test --match-contract CourierFishForkTest --fork-url robinhood
/// Skipped when not forked.
contract CourierFishForkTest is FishFixture {
    address constant REGISTRY = 0xA000027A9B2802E1ddf7000061001e5c005A0000;
    address constant SEAPORT = 0x0000000000000068F116a894984e2DB1123eB395;
    bytes4 constant UNAUTHORIZED = 0x1de5204e;
    address constant SIGNED_ZONE = 0x000056F7000000EcE9003ca63978907a00FFD100;

    function setUp() public {
        if (block.chainid != 4663) return; // (each test skips itself)
        signer = vm.addr(signerKey);
        offices = new MockOffices();
        fish = new CourierFish(owner, offices, signer, treasury, REGISTRY, 10, "x/");
        vm.prank(owner);
        fish.setSpecies(SARDINE, 0, 0);
        offices.setOpen(alice, true);
        CourierFish.Voucher memory v = _voucher(alice, _today(), _one(SARDINE), _one(3));
        vm.prank(alice);
        fish.mint(v);
    }

    function test_Fork_HolderTransfersPass() public {
        vm.skip(block.chainid != 4663);
        vm.prank(alice);
        fish.safeTransferFrom(alice, bob, SARDINE, 1, "");
        assertEq(fish.balanceOf(bob, SARDINE), 1);
    }

    function test_Fork_SaleAuthorizedByOpenSeaGoesThrough() public {
        vm.skip(block.chainid != 4663);
        vm.etch(SIGNED_ZONE, address(new FishZoneFlow()).code);
        vm.etch(SEAPORT, address(new FishMarketMove()).code);
        vm.prank(alice);
        fish.setApprovalForAll(SEAPORT, true);
        FishZoneFlow(SIGNED_ZONE).sell(REGISTRY, address(fish), SEAPORT, alice, bob, SARDINE, 2);
        assertEq(fish.balanceOf(bob, SARDINE), 2);
    }

    function test_Fork_MarketplaceWithoutFeeCheckReverts() public {
        vm.skip(block.chainid != 4663);
        vm.prank(alice);
        fish.setApprovalForAll(SEAPORT, true);
        vm.prank(SEAPORT);
        vm.expectRevert(UNAUTHORIZED);
        fish.safeTransferFrom(alice, bob, SARDINE, 1, "");
        assertEq(fish.balanceOf(alice, SARDINE), 3);
    }

    /// On Robinhood Chain the deploy script keeps OpenSea's registry as the validator, and sets up all 24 species.
    function test_Fork_DeployScriptUsesTheRegistry() public {
        vm.skip(block.chainid != 4663);
        vm.setEnv("POST_OFFICE", "0x26D80804D0FA2F4598369E0062bFC9536d115D82"); // the live post office
        vm.setEnv("FISH_SIGNER", vm.toString(signer));
        vm.setEnv("TREASURY", vm.toString(treasury));
        CourierFish deployed = new DeployFish().run();
        assertEq(deployed.getTransferValidator(), REGISTRY);
        assertEq(deployed.speciesCount(), 24);
    }
}
