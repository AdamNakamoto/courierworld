// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {CourierFish} from "../src/CourierFish.sol";
import {DevTransferValidator} from "../script/DevTransferValidator.sol";
import {MockOffices} from "./CourierFish.t.sol";

/// Players minting fish with the server's vouchers (honest ones, growing a day's catch a little at a time) and with a
/// leaked key's (any counts, any species, past and future days, expired), one voucher at a time or two in a batch;
/// the owner pausing, changing the daily limit and shrinking caps; holders passing fish on; and time passing. Every
/// call's outcome is predicted by a model of the contract: a revert other than the one expected (or a success where
/// one was expected), or a different number minted, is recorded and fails `invariant_noSurprises`.
contract FishHandler is Test {
    CourierFish public fish;
    MockOffices public offices;
    address public owner;
    uint256 signerKey;
    address[] public players; // the last one has no post office
    uint32 public firstDay;

    // ---- the model
    mapping(address => mapping(uint32 => mapping(uint256 => uint256))) public mClaimed;
    mapping(address => mapping(uint32 => uint256)) public mClaimedOn;
    mapping(uint256 => mapping(uint32 => uint256)) public mMintedOn;
    mapping(uint256 => uint256) public mMinted;
    uint32 public mMaxPerDay = 10;
    bool public mPaused;

    bytes4 public surprise;
    string public surpriseAt;
    mapping(bytes4 => uint256) public outcomes;
    uint256 public mints;
    uint256 public batchMints;
    uint256 public fishMinted;
    uint256 public transfers;
    uint256 public capped; // catches a capped species had no room for

    bytes4 constant SUCCEEDED = 0xffffffff;
    bytes4 constant EMPTY = 0xeeeeeeee; // a revert with no data

    function _err(bytes memory e) internal pure returns (bytes4) {
        return e.length < 4 ? EMPTY : bytes4(e);
    }

    constructor(CourierFish fish_, MockOffices offices_, address owner_, uint256 signerKey_) {
        fish = fish_;
        offices = offices_;
        owner = owner_;
        signerKey = signerKey_;
        for (uint256 i; i < 5; ++i) {
            address p = makeAddr(string.concat("angler", vm.toString(i)));
            players.push(p);
            if (i < 4) offices.setOpen(p, true);
        }
        firstDay = _today();
    }

    function _now() internal view returns (uint256) {
        return vm.getBlockTimestamp();
    }

    function _today() internal view returns (uint32) {
        return uint32(_now() / 1 days);
    }

    /// `expected` / `got`: a revert's selector, or 0 for success (counted as SUCCEEDED); an empty revert is EMPTY.
    function _check(bytes4 expected, bytes4 got, string memory where) internal {
        if (expected == 0) expected = SUCCEEDED;
        if (got == 0) got = SUCCEEDED;
        ++outcomes[got];
        if (expected != got && surprise == 0) {
            surprise = got;
            surpriseAt = where;
        }
    }

    function _sign(address player, uint32 day, uint256[] memory ids, uint256[] memory counts, uint64 deadline)
        internal
        view
        returns (CourierFish.Voucher memory v)
    {
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Catch(address player,uint32 day,uint256[] ids,uint256[] counts,uint64 deadline)"),
            player, day, keccak256(abi.encodePacked(ids)), keccak256(abi.encodePacked(counts)), deadline
        ));
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Courier World Fish"), keccak256("1"), block.chainid, address(fish)
        ));
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(signerKey, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        v = CourierFish.Voucher(day, ids, counts, deadline, abi.encodePacked(r, s, vv));
    }

    /// The species' caps as the contract has them now.
    function _caps(uint256 id) internal view returns (uint256 maxSupply, uint256 dailyCap) {
        (uint32 m,, uint32 d,) = fish.species(id);
        return (m, d);
    }

    /// What one voucher does, per the model: its revert (stale ones skipped in a batch return 0, as in the contract),
    /// and the fish it mints of each species. Changes the model only if `commit`.
    function _model(address p, CourierFish.Voucher memory v, bool skipStale, bool commit)
        internal
        returns (bytes4 err, uint256 minted, uint256[] memory amounts)
    {
        amounts = new uint256[](v.ids.length);
        uint32 now_ = _today();
        if (_now() > v.deadline) return (skipStale ? bytes4(0) : CourierFish.Expired.selector, 0, amounts);
        if (v.day > now_) return (skipStale ? bytes4(0) : CourierFish.FutureDay.selector, 0, amounts);
        if (uint256(now_) >= uint256(v.day) + 7) return (skipStale ? bytes4(0) : CourierFish.TooLate.selector, 0, amounts);
        uint256 total;
        uint256 allow = mMaxPerDay > mClaimedOn[p][v.day] ? mMaxPerDay - mClaimedOn[p][v.day] : 0;
        for (uint256 i; i < v.ids.length; ++i) {
            uint256 id = v.ids[i];
            uint256 had = mClaimed[p][v.day][id];
            if (v.counts[i] <= had) continue;
            uint256 add = v.counts[i] - had;
            (uint256 maxSupply, uint256 dailyCap) = _caps(id);
            uint256 room = add > allow ? allow : add;
            allow -= room;
            total += room;
            if (dailyCap != 0) {
                uint256 dayLeft = dailyCap > mMintedOn[id][v.day] ? dailyCap - mMintedOn[id][v.day] : 0;
                if (room > dayLeft) room = dayLeft;
            }
            if (maxSupply != 0 && room > maxSupply - mMinted[id]) room = maxSupply - mMinted[id];
            amounts[i] = room;
            minted += room;
        }
        // (The contract marks every new count claimed as it goes, so catches past a limit are spent even when the voucher
        // mints nothing; a mint call that mints nothing at all reverts, which undoes that, but in a batch it stands.)
        if (commit) {
            for (uint256 i; i < v.ids.length; ++i) {
                uint256 id = v.ids[i];
                if (v.counts[i] > mClaimed[p][v.day][id]) mClaimed[p][v.day][id] = v.counts[i];
                mMintedOn[id][v.day] += amounts[i];
                mMinted[id] += amounts[i];
            }
            mClaimedOn[p][v.day] += total;
            capped += total - minted;
        }
        if (total == 0) return (0, 0, amounts);
    }

    /// A voucher for two species of a day: an honest one (the day's counts grow by a few) or a leaked key's (any counts).
    function _voucher(address p, uint256 a, uint256 b, uint256 n1, uint256 n2, uint256 dayBack, uint256 mode)
        internal
        view
        returns (CourierFish.Voucher memory)
    {
        uint256 x = 1 + (a % 23);
        uint256 y = x + 1 + (b % (24 - x));
        uint32 day = mode % 11 == 0 ? _today() + 1 : uint32(_today() - bound(dayBack, 0, 8));
        if (day < firstDay) day = firstDay;
        uint256[] memory ids = new uint256[](2);
        uint256[] memory counts = new uint256[](2);
        ids[0] = x;
        ids[1] = y;
        bool leaked = mode % 3 == 0;
        counts[0] = leaked ? bound(n1, 0, 14) : mClaimed[p][day][x] + bound(n1, 0, 3);
        counts[1] = leaked ? bound(n2, 0, 14) : mClaimed[p][day][y] + bound(n2, 0, 3);
        uint64 deadline = mode % 9 == 0 ? uint64(_now() - 1) : uint64(_now() + 1 hours);
        return _sign(p, day, ids, counts, deadline);
    }

    function _balances(address p) internal view returns (uint256[] memory b) {
        b = new uint256[](25);
        for (uint256 id = 1; id <= 24; ++id) b[id] = fish.balanceOf(p, id);
    }

    function mint(uint256 who, uint256 a, uint256 b, uint256 n1, uint256 n2, uint256 dayBack, uint256 mode) external {
        address p = players[who % players.length];
        CourierFish.Voucher memory v = _voucher(p, a, b, n1, n2, dayBack, mode);
        bytes4 expected;
        uint256 minted;
        uint256[] memory amounts;
        (bool hasOffice,,,,,,,,) = offices.offices(p);
        if (mPaused) expected = CourierFish.IsPaused.selector;
        else if (!hasOffice) expected = CourierFish.NoOffice.selector;
        else {
            (expected, minted, amounts) = _model(p, v, false, false);
            if (expected == 0 && minted == 0) expected = CourierFish.NothingToMint.selector;
        }
        uint256[] memory before = _balances(p);
        vm.prank(p);
        try fish.mint(v) returns (uint256 got) {
            _check(expected, 0, "mint");
            if (expected == 0) {
                _model(p, v, false, true);
                if (got != minted) _check(bytes4(0x00000002), bytes4(0x00000001), "mint count");
                for (uint256 i; i < v.ids.length; ++i) {
                    assertEq(fish.balanceOf(p, v.ids[i]) - before[v.ids[i]], amounts[i], "minted what the model says");
                    (, uint256 dailyCap) = _caps(v.ids[i]);
                    if (dailyCap != 0 && amounts[i] > 0) assertLe(fish.mintedOn(v.ids[i], v.day), dailyCap, "a day's cap");
                }
                assertLe(fish.claimedOn(p, v.day), mMaxPerDay, "the daily limit");
                ++mints;
                fishMinted += got;
            }
        } catch (bytes memory e) {
            _check(expected, _err(e), "mint");
        }
    }

    /// Two vouchers in one batch: stale ones are skipped; any other revert (or nothing minted at all) reverts both.
    function mintMany(uint256 who, uint256 a, uint256 b, uint256 n1, uint256 n2, uint256 dayBack, uint256 mode) external {
        address p = players[who % players.length];
        CourierFish.Voucher[] memory vs = new CourierFish.Voucher[](2);
        vs[0] = _voucher(p, a, b, n1, n2, dayBack, mode);
        vs[1] = _voucher(p, b, a, n2, n1, dayBack / 2, mode / 7);
        (bool hasOffice,,,,,,,,) = offices.offices(p);
        bytes4 expected;
        uint256 total;
        if (mPaused) expected = CourierFish.IsPaused.selector;
        else if (!hasOffice) expected = CourierFish.NoOffice.selector;
        else {
            // The second voucher sees the first one's effects, so model them in order, then undo (the real call may
            // revert): snapshot the few values they touch.
            Snap memory snap = _snap(p, vs);
            uint256 m;
            (expected, m,) = _model(p, vs[0], true, true);
            total = m;
            if (expected == 0) {
                (expected, m,) = _model(p, vs[1], true, true);
                total += m;
            }
            _restore(p, vs, snap);
            if (expected == 0 && total == 0) expected = CourierFish.NothingToMint.selector;
        }
        vm.prank(p);
        try fish.mintMany(vs) returns (uint256 got) {
            _check(expected, 0, "mintMany");
            if (expected == 0) {
                _model(p, vs[0], true, true);
                _model(p, vs[1], true, true);
                if (got != total) _check(bytes4(0x00000002), bytes4(0x00000001), "mintMany count");
                ++batchMints;
                fishMinted += got;
            }
        } catch (bytes memory e) {
            _check(expected, _err(e), "mintMany");
        }
    }

    struct Snap {
        uint256[4] claimed;
        uint256[2] claimedOn;
        uint256[4] mintedOn;
        uint256[4] minted;
        uint256 cappedWas;
    }

    function _snap(address p, CourierFish.Voucher[] memory vs) internal view returns (Snap memory s) {
        for (uint256 k; k < 2; ++k) {
            s.claimedOn[k] = mClaimedOn[p][vs[k].day];
            for (uint256 i; i < 2; ++i) {
                s.claimed[k * 2 + i] = mClaimed[p][vs[k].day][vs[k].ids[i]];
                s.mintedOn[k * 2 + i] = mMintedOn[vs[k].ids[i]][vs[k].day];
                s.minted[k * 2 + i] = mMinted[vs[k].ids[i]];
            }
        }
        s.cappedWas = capped;
    }

    /// (In reverse order, so a value both vouchers touch ends at its first, untouched snapshot.)
    function _restore(address p, CourierFish.Voucher[] memory vs, Snap memory s) internal {
        for (uint256 k = 2; k > 0; --k) {
            mClaimedOn[p][vs[k - 1].day] = s.claimedOn[k - 1];
            for (uint256 i = 2; i > 0; --i) {
                mClaimed[p][vs[k - 1].day][vs[k - 1].ids[i - 1]] = s.claimed[(k - 1) * 2 + i - 1];
                mMintedOn[vs[k - 1].ids[i - 1]][vs[k - 1].day] = s.mintedOn[(k - 1) * 2 + i - 1];
                mMinted[vs[k - 1].ids[i - 1]] = s.minted[(k - 1) * 2 + i - 1];
            }
        }
        capped = s.cappedWas;
    }

    /// Holders pass fish on (always allowed: the holder moves its own).
    function give(uint256 from, uint256 to, uint256 id, uint256 amount) external {
        address a = players[from % players.length];
        address b = players[to % players.length];
        id = 1 + (id % 24);
        amount = bound(amount, 0, fish.balanceOf(a, id));
        vm.prank(a);
        try fish.safeTransferFrom(a, b, id, amount, "") {
            _check(0, 0, "give");
            ++transfers;
        } catch (bytes memory e) {
            _check(0, _err(e), "give");
        }
    }

    function passTime(uint256 secs) external {
        vm.warp(_now() + bound(secs, 1 hours, 2 days));
    }

    /// The owner: pause or resume, change the daily limit (sometimes out of range), shrink a capped species (sometimes
    /// trying to grow it), change a daily cap.
    function configure(uint256 mode, uint256 limit, uint256 id, uint256 supply, uint256 daily) external {
        vm.startPrank(owner);
        if (mode % 4 == 0) {
            mPaused = !mPaused;
            fish.setPaused(mPaused);
        } else if (mode % 4 == 1) {
            limit = bound(limit, 0, 55);
            bytes4 expected = limit == 0 || limit > 50 ? CourierFish.BadLimit.selector : bytes4(0);
            try fish.setMaxPerDay(uint32(limit)) {
                _check(expected, 0, "setMaxPerDay");
                mMaxPerDay = uint32(limit);
            } catch (bytes memory e) {
                _check(expected, _err(e), "setMaxPerDay");
            }
        } else {
            id = 16 + (id % 9); // the capped ones
            (uint32 maxSupply, uint32 minted, uint32 dailyCap,) = fish.species(id);
            supply = mode % 4 == 2 ? bound(supply, minted, maxSupply) : bound(supply, 0, uint256(maxSupply) + 5);
            daily = bound(daily, 0, 25);
            bytes4 expected = supply == 0 || supply > maxSupply || supply < minted ? CourierFish.SupplyCanOnlyShrink.selector : bytes4(0);
            try fish.setSpecies(id, supply, daily) {
                _check(expected, 0, "setSpecies");
            } catch (bytes memory e) {
                _check(expected, _err(e), "setSpecies");
            }
            dailyCap; // (read only to keep the tuple whole)
        }
        vm.stopPrank();
    }

    function playerCount() external view returns (uint256) {
        return players.length;
    }
}

/// forge-config: default.invariant.fail-on-revert = true
contract CourierFishInvariantTest is Test {
    CourierFish fish;
    MockOffices offices;
    FishHandler handler;
    address owner = makeAddr("owner");

    function setUp() public {
        vm.warp(1_790_000_000);
        offices = new MockOffices();
        uint256 key = 0x51617;
        fish = new CourierFish(owner, offices, vm.addr(key), makeAddr("treasury"), address(new DevTransferValidator()), 10, "x/");
        vm.startPrank(owner);
        for (uint256 id = 1; id <= 15; ++id) fish.setSpecies(id, 0, 0);
        // (smaller caps than the real lineup, so runs reach them)
        for (uint256 id = 16; id <= 20; ++id) fish.setSpecies(id, 40, 6);
        for (uint256 id = 21; id <= 23; ++id) fish.setSpecies(id, 12, 2);
        fish.setSpecies(24, 4, 1);
        vm.stopPrank();
        handler = new FishHandler(fish, offices, owner, key);
        targetContract(address(handler));
    }

    function invariant_noSurprises() public view {
        assertEq(handler.surprise(), bytes4(0), handler.surpriseAt());
    }

    /// Every fish was minted by a voucher, the model agrees on every species' total, no capped species passes its
    /// total, and every fish is in a player's wallet.
    function invariant_suppliesHold() public view {
        for (uint256 id = 1; id <= 24; ++id) {
            (uint32 maxSupply, uint32 minted,,) = fish.species(id);
            assertEq(minted, handler.mMinted(id));
            if (maxSupply != 0) assertLe(minted, maxSupply);
            uint256 held;
            for (uint256 j; j < handler.playerCount(); ++j) held += fish.balanceOf(handler.players(j), id);
            assertEq(held, minted, "every fish is in a player's wallet");
        }
    }

    function invariant_settingsStay() public view {
        assertEq(fish.owner(), owner);
        assertEq(fish.maxPerDay(), handler.mMaxPerDay());
        assertEq(fish.paused(), handler.mPaused());
        (, uint256 fee) = fish.royaltyInfo(1, 10_000);
        assertEq(fee, 500);
    }

    function afterInvariant() public view {
        console2.log("mints", handler.mints(), "batch mints", handler.batchMints());
        console2.log("fish minted", handler.fishMinted(), "past a cap", handler.capped());
        console2.log("transfers", handler.transfers(), "succeeded", handler.outcomes(0xffffffff));
        console2.log("NothingToMint", handler.outcomes(CourierFish.NothingToMint.selector));
        console2.log("Expired", handler.outcomes(CourierFish.Expired.selector), "TooLate", handler.outcomes(CourierFish.TooLate.selector));
        console2.log("FutureDay", handler.outcomes(CourierFish.FutureDay.selector), "IsPaused", handler.outcomes(CourierFish.IsPaused.selector));
        console2.log("NoOffice", handler.outcomes(CourierFish.NoOffice.selector), "SupplyCanOnlyShrink", handler.outcomes(CourierFish.SupplyCanOnlyShrink.selector));
    }
}
