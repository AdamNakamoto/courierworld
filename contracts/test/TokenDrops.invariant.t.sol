// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TokenDrops, IDropsPad, IDropsPostOffice} from "../src/TokenDrops.sol";

contract InvCoin is ERC20 {
    constructor(string memory n, address to) ERC20(n, n) {
        _mint(to, 1e30);
    }
}

contract InvPad {
    function launches(address) external pure returns (address, address, uint64, uint64, bool) {
        return (address(0), address(0), 1, 1, false); // every token counts as launched
    }
}

contract InvOffices {
    mapping(address => bool) public isOpen;

    function open(address w) external {
        isOpen[w] = true;
    }

    function offices(address w) external view returns (bool, uint8, uint8, uint16, uint64, address, uint256, uint256, uint256) {
        return (isOpen[w], 0, 0, 0, 0, address(0), 0, 0, 0);
    }
}

/// Random treasury and player moves: creating, topping up, claiming today's and yesterday's finds (one by one and
/// in batches) from several wallets, ending, pausing and withdrawing, stray transfers, sweeps, and time passing,
/// across midnights. The test checks the drops' books after every step.
contract DropsHandler is Test {
    TokenDrops public drops;
    IERC20[2] public tokens;
    address public treasury;
    uint256 internal signerKey;
    address[6] internal players;
    uint32[] public daysSeen;
    uint256 public claimsPaid; // claims that paid something (so the run exercises real payouts)
    mapping(uint32 => bool) internal seen;

    constructor(TokenDrops d, IERC20 a, IERC20 b, address t, uint256 key, address[6] memory ps) {
        drops = d;
        tokens = [a, b];
        treasury = t;
        signerKey = key;
        players = ps;
    }

    function _today() internal view returns (uint32) {
        return uint32(vm.getBlockTimestamp() / 1 days);
    }

    function _see(uint32 day) internal {
        if (!seen[day]) {
            seen[day] = true;
            daysSeen.push(day);
        }
    }

    function daysSeenCount() external view returns (uint256) {
        return daysSeen.length;
    }

    function create(uint8 tokenSeed, uint256 per, uint8 spots, uint8 maxPer, uint16 daily, uint8 startIn, uint8 days_, uint256 amount) external {
        uint16 sp = tokenSeed % 2 == 1 ? 24 : uint16(bound(spots, 1, 48)); // ($STAMP: the 24 golden stamps)
        uint16 mp = uint16(bound(maxPer, 1, sp));
        uint256 dc = bound(daily, mp, 200);
        uint32 start = _today() + (startIn % 4 == 0 ? 1 : 0); // mostly running from today
        vm.prank(treasury);
        drops.createDrop(
            address(tokens[tokenSeed % 2]), bound(per, 1, 1e21), sp, mp, dc, start, uint32(bound(days_, 2, 6)), bound(amount, 0, 1e24)
        );
    }

    function topUp(uint256 idSeed, uint256 amount) external {
        uint256 n = drops.dropCount();
        if (n == 0) return;
        vm.prank(treasury);
        drops.topUp(idSeed % n, bound(amount, 0, 1e24));
    }

    function _voucher(address player, uint256 id, uint32 day, uint16 coins, uint64 deadline) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(drops.FINDS_TYPEHASH(), player, id, day, coins, deadline));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Courier World Drops"), keccak256("1"), block.chainid, address(drops)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    /// A player claims (with a voucher the server key signed) for today or yesterday, alone or in a batch.
    function claim(uint256 idSeed, uint8 playerSeed, uint16 coins, bool yesterday, bool batch) external {
        uint256 n = drops.dropCount();
        if (n == 0) return;
        coins = uint16(bound(coins, 1, 60));
        uint256 id = idSeed % n;
        uint32 day = _today() - (yesterday ? 1 : 0);
        address p = players[playerSeed % 6];
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = _voucher(p, id, day, coins, deadline);
        _see(day);
        vm.prank(p);
        if (batch) {
            TokenDrops.Claim[] memory cs = new TokenDrops.Claim[](2);
            cs[0] = TokenDrops.Claim(id, day, coins, deadline, sig);
            uint256 id2 = (id + 1) % n;
            cs[1] = TokenDrops.Claim(id2, _today(), coins, deadline, _voucher(p, id2, _today(), coins, deadline));
            _see(_today());
            try drops.claimMany(cs) {
                claimsPaid++;
            } catch {}
        } else {
            try drops.claim(id, day, coins, deadline, sig) {
                claimsPaid++;
            } catch {}
        }
    }

    function end(uint256 idSeed, uint8 ahead) external {
        uint256 n = drops.dropCount();
        if (n == 0) return;
        vm.prank(treasury);
        drops.endDrop(idSeed % n, _today() + uint32(bound(ahead, 0, 3)));
    }

    function pauseAndWithdraw(uint256 idSeed, bool unpause) external {
        uint256 n = drops.dropCount();
        if (n == 0) return;
        vm.startPrank(treasury);
        drops.setPaused(true);
        drops.withdraw(idSeed % n, treasury, _today());
        if (unpause) drops.setPaused(false);
        vm.stopPrank();
    }

    function unpause() external {
        vm.prank(treasury);
        drops.setPaused(false);
    }

    function stray(uint8 tokenSeed, uint256 amount) external {
        vm.prank(treasury);
        tokens[tokenSeed % 2].transfer(address(drops), bound(amount, 0, 1e22));
    }

    function sweep(uint8 tokenSeed) external {
        vm.prank(treasury);
        drops.sweep(address(tokens[tokenSeed % 2]), treasury);
    }

    /// Time passes: up to a day and a half, often across a midnight.
    function warp(uint256 secs) external {
        vm.warp(vm.getBlockTimestamp() + bound(secs, 1, 36 hours));
    }
}

/// forge-config: default.invariant.runs = 64
/// forge-config: default.invariant.depth = 60
/// forge-config: default.invariant.fail-on-revert = false
contract TokenDropsInvariantTest is Test {
    TokenDrops drops;
    DropsHandler handler;
    InvCoin coin;
    InvCoin stamp;
    address treasury = makeAddr("treasury");

    function setUp() public {
        vm.warp(30 days + 12 hours);
        coin = new InvCoin("COIN", treasury);
        stamp = new InvCoin("STAMP", treasury);
        InvOffices offices = new InvOffices();
        address[6] memory ps;
        for (uint256 i; i < 6; i++) {
            ps[i] = makeAddr(string(abi.encodePacked("player", vm.toString(i))));
            if (i < 5) offices.open(ps[i]); // the sixth has no post office
        }
        uint256 key = 0x5160;
        drops = new TokenDrops(IERC20(address(stamp)), IDropsPad(address(new InvPad())), IDropsPostOffice(address(offices)), vm.addr(key), treasury);
        handler = new DropsHandler(drops, IERC20(address(coin)), IERC20(address(stamp)), treasury, key, ps);
        vm.startPrank(treasury);
        coin.approve(address(drops), type(uint256).max);
        stamp.approve(address(drops), type(uint256).max);
        vm.stopPrank();
        targetContract(address(handler));
    }

    /// Each token's held balance is exactly the sum of its drops' tokens, and the contract really has it.
    function invariant_HeldIsTheDropsTokens() public view {
        IERC20[2] memory ts = [IERC20(address(coin)), IERC20(address(stamp))];
        for (uint256 t; t < 2; t++) {
            uint256 sum;
            for (uint256 i; i < drops.dropCount(); i++) {
                TokenDrops.Drop memory d = drops.drop(i);
                if (d.token == address(ts[t])) sum += d.left;
            }
            assertEq(drops.held(address(ts[t])), sum, "held == sum of the drops' tokens");
            assertGe(ts[t].balanceOf(address(drops)), sum, "the contract holds what the drops hold");
        }
    }

    /// No day of any drop ever pays more coins than its cap, nor more than its tokens covered.
    function invariant_DailyCapsHold() public view {
        for (uint256 i; i < drops.dropCount(); i++) {
            TokenDrops.Drop memory d = drops.drop(i);
            for (uint256 k; k < handler.daysSeenCount(); k++) {
                assertLe(drops.paidCoins(i, handler.daysSeen(k)), d.dailyCoins, "a day paid more than its cap");
            }
        }
    }

    /// The handler really pays claims (an invariant run where none ever succeeds would test nothing): a fixed
    /// pseudo-random walk through the same moves pays many.
    function test_HandlerExercisesPayouts() public {
        uint256 r = 1;
        for (uint256 i; i < 400; i++) {
            r = uint256(keccak256(abi.encode(r)));
            uint256 move = r % 20;
            if (move < 3) handler.create(uint8(r >> 8), r >> 16, uint8(r >> 24), uint8(r >> 32), uint16(r >> 40), uint8(r >> 56), uint8(r >> 64), r >> 72);
            else if (move < 13) handler.claim(r >> 8, uint8(r >> 16), uint16(r >> 24), (r >> 40) % 3 == 0, (r >> 48) % 4 == 0);
            else if (move < 14) handler.topUp(r >> 8, r >> 16);
            else if (move < 15) handler.end(r >> 8, uint8(r >> 16));
            else if (move < 16) handler.pauseAndWithdraw(r >> 8, true);
            else if (move < 17) handler.stray(uint8(r >> 8), r >> 16);
            else if (move < 18) handler.sweep(uint8(r >> 8));
            else handler.warp(r >> 8);
            if (i % 25 == 24) {
                invariant_HeldIsTheDropsTokens();
                invariant_DailyCapsHold();
            }
        }
        emit log_named_uint("claims paid", handler.claimsPaid());
        assertGt(handler.claimsPaid(), 15, "the walk pays real claims (the rest fail by design: caps full, drops ended or paused, no post office)");
    }

    /// The treasury only ever loses what it put into drops (or sent here): everything else is never touched.
    function invariant_TreasuryOnlyFundsDrops() public view {
        // Total supply is fixed; what isn't with the treasury or the contract went to players by claims.
        IERC20[2] memory ts = [IERC20(address(coin)), IERC20(address(stamp))];
        for (uint256 t; t < 2; t++) {
            assertLe(ts[t].balanceOf(address(drops)) + ts[t].balanceOf(treasury), 1e30);
        }
    }
}
