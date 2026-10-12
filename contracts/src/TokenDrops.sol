// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice The part of the post office the drops read: whether a wallet has an office open.
interface IDropsPostOffice {
    function offices(address owner)
        external
        view
        returns (bool, uint8, uint8, uint16, uint64, address, uint256, uint256, uint256);
}

/// @notice The part of the launchpad the drops read: whether a token was launched there.
interface IDropsPad {
    function launches(address token)
        external
        view
        returns (address quote, address creator, uint64 createdAt, uint64 createdBlock, bool quoteIsCurrency0);
}

/// @title Token drops
/// @notice Coins scattered round the planet for players to find, paid in a token. The treasury (the owner) funds
///         each drop with a launchpad token or $STAMP: how much each coin is worth, how many coins are out each day,
///         how many one wallet is paid for a day, how many are paid a day across everyone, and for how many days.
///         Every player sees the same coins and can collect each one (as with golden stamps), so a day pays more
///         coins than it puts out: the cap across everyone (`dailyCoins`, required) bounds a day's payout.
///         A $STAMP drop pays for the golden stamps. The game's server checks every find against the player's path
///         and signs a voucher for how many coins of a drop they've found that day; this contract pays it from that
///         drop's own tokens. Nothing here mints: every token paid was deposited first. Only wallets with an open
///         post office can claim, for the day of the finds or the day after.
contract TokenDrops is Ownable2Step, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant FINDS_TYPEHASH =
        keccak256("Finds(address player,uint256 drop,uint32 day,uint16 coins,uint64 deadline)");
    /// @notice A $STAMP drop pays for the golden stamps: 24 a day.
    uint16 public constant GOLDEN_SPOTS = 24;
    /// @notice The most coins a token drop puts out in a day.
    uint16 public constant MAX_SPOTS = 48;
    uint32 public constant MAX_DAYS = 365;
    /// @notice The most coins a drop pays a day across everyone: with `perCoin`, the most a day can ever pay out.
    uint256 public constant MAX_DAILY_COINS = 10_000;
    /// @notice A day's finds can be claimed that day and the next.
    uint32 public constant CLAIM_DAYS = 2;

    IERC20 public immutable stamp;
    IDropsPad public immutable pad;
    IDropsPostOffice public immutable postOffice;

    /// @notice The game server's key, which signs the vouchers.
    address public signer;
    /// @notice While paused nobody can claim, and the owner can take any drop's tokens back.
    bool public paused;

    struct Drop {
        address token;
        uint16 spots; // coins out in the world each day (24 for $STAMP: the golden stamps)
        uint16 maxPerWallet; // coins one wallet is paid for, per day
        uint32 startDay;
        uint32 endDay; // the last day coins are out (inclusive); before startDay: cancelled
        uint256 perCoin; // tokens paid per coin
        uint256 dailyCoins; // coins paid per day across everyone (at least 1: it bounds what a day can pay)
        uint256 left; // tokens still in the drop
    }

    struct Claim {
        uint256 drop;
        uint32 day;
        uint16 coins;
        uint64 deadline;
        bytes signature;
    }

    Drop[] internal _drops;
    /// @notice Coins already paid: drop => day => wallet => count.
    mapping(uint256 => mapping(uint32 => mapping(address => uint16))) public claimed;
    /// @notice Coins paid for each drop's day, across everyone.
    mapping(uint256 => mapping(uint32 => uint256)) public paidCoins;
    /// @notice Each token's balance that belongs to drops (the sum of their `left`); anything above it can be swept.
    mapping(address => uint256) public held;

    event DropCreated(
        uint256 indexed drop,
        address indexed token,
        uint256 perCoin,
        uint16 spots,
        uint16 maxPerWallet,
        uint256 dailyCoins,
        uint32 startDay,
        uint32 endDay,
        uint256 amount
    );
    event DropToppedUp(uint256 indexed drop, uint256 amount);
    event DropEnded(uint256 indexed drop, uint32 endDay);
    event Withdrawn(uint256 indexed drop, address indexed to, uint256 amount);
    event Swept(address indexed token, address indexed to, uint256 amount);
    event Claimed(address indexed player, uint256 indexed drop, uint32 indexed day, uint16 coins, uint256 amount);
    event SignerSet(address indexed previous, address indexed signer);
    event PausedSet(bool paused);

    error ZeroAddress();
    error BadToken();
    error BadDrop();
    error UnknownDrop();
    error Expired();
    error FutureDay();
    error TooLate();
    error NotRunning();
    error NoOffice();
    error BadSignature();
    error NothingToClaim();
    error IsPaused();
    error StillRunning();
    error NotAllowed();

    constructor(IERC20 stamp_, IDropsPad pad_, IDropsPostOffice postOffice_, address signer_, address owner_)
        Ownable(owner_)
        EIP712("Courier World Drops", "1")
    {
        if (address(stamp_) == address(0) || address(pad_) == address(0) || address(postOffice_) == address(0)) {
            revert ZeroAddress();
        }
        if (signer_ == address(0)) revert ZeroAddress();
        stamp = stamp_;
        pad = pad_;
        postOffice = postOffice_;
        signer = signer_;
        emit SignerSet(address(0), signer_);
    }

    // ---------------------------------------------------------------- views

    /// @notice Days since 1 January 1970 (UTC): the game's hunt day.
    function today() public view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function dropCount() external view returns (uint256) {
        return _drops.length;
    }

    function drop(uint256 id) external view returns (Drop memory) {
        if (id >= _drops.length) revert UnknownDrop();
        return _drops[id];
    }

    /// @notice The drops with coins out on `day`, oldest first (the order the game lays their coins out in).
    function activeDrops(uint32 day) external view returns (uint256[] memory ids) {
        uint256 n;
        for (uint256 i; i < _drops.length; i++) {
            if (_drops[i].startDay <= day && day <= _drops[i].endDay) n++;
        }
        ids = new uint256[](n);
        n = 0;
        for (uint256 i; i < _drops.length; i++) {
            if (_drops[i].startDay <= day && day <= _drops[i].endDay) ids[n++] = i;
        }
    }

    /// @notice What `player` would be paid for a voucher saying they found `coins` of drop `id` on `day`: nothing while
    ///         paused, for a wallet without a post office, or for a day the drop wasn't running or that can't be
    ///         claimed now.
    function claimable(uint256 id, address player, uint32 day, uint16 coins) public view returns (uint16 n, uint256 amount) {
        if (id >= _drops.length || paused) return (0, 0);
        Drop storage d = _drops[id];
        if (!_open(d, day)) return (0, 0);
        (bool open,,,,,,,,) = postOffice.offices(player);
        if (!open) return (0, 0);
        return _payable(id, d, player, day, coins);
    }

    /// @dev Whether `day`'s finds of drop `d` can be claimed now: one of its days, not in the future, not too old.
    function _open(Drop storage d, uint32 day) internal view returns (bool) {
        uint32 now_ = today();
        return day >= d.startDay && day <= d.endDay && day <= now_ && now_ < day + CLAIM_DAYS;
    }

    /// @dev The caps: a wallet's coins a day, the day's coins across everyone, and the drop's tokens.
    function _payable(uint256 id, Drop storage d, address player, uint32 day, uint16 coins)
        internal
        view
        returns (uint16 n, uint256 amount)
    {
        uint16 cap = coins > d.maxPerWallet ? d.maxPerWallet : coins;
        uint16 done = claimed[id][day][player];
        if (cap <= done) return (0, 0);
        uint256 want = cap - done;
        // As many as the drop's tokens, and the day's coins, can cover; the rest stays claimable if they grow.
        uint256 room = d.left / d.perCoin;
        uint256 dayLeft = d.dailyCoins > paidCoins[id][day] ? d.dailyCoins - paidCoins[id][day] : 0;
        if (dayLeft < room) room = dayLeft;
        if (want > room) want = room;
        return (uint16(want), want * d.perCoin);
    }

    // ---------------------------------------------------------------- claiming

    /// @notice Claim one drop's finds for a day with the server's voucher. `coins` is that day's total so far: you're
    ///         paid for the ones not yet claimed, so you can claim again later.
    function claim(uint256 id, uint32 day, uint16 coins, uint64 deadline, bytes calldata signature)
        external
        nonReentrant
        returns (uint256 amount)
    {
        _checkClaimer();
        amount = _claim(id, day, coins, deadline, signature, false);
        if (amount == 0) revert NothingToClaim();
    }

    /// @notice Claim several drops (or days) in one go. Any that would pay nothing, or whose voucher has expired or
    ///         whose day can't be claimed any more (a batch sent just before midnight, say), are skipped; a forged
    ///         voucher or an unknown drop still reverts the lot.
    function claimMany(Claim[] calldata claims) external nonReentrant returns (uint256 total) {
        _checkClaimer();
        for (uint256 i; i < claims.length; i++) {
            Claim calldata c = claims[i];
            total += _claim(c.drop, c.day, c.coins, c.deadline, c.signature, true);
        }
        if (total == 0) revert NothingToClaim();
    }

    function _checkClaimer() internal view {
        if (paused) revert IsPaused();
        (bool open,,,,,,,,) = postOffice.offices(msg.sender);
        if (!open) revert NoOffice();
    }

    /// @dev `skipStale`: in a batch, an expired voucher or a day that can't be claimed now pays nothing instead of
    ///      reverting.
    function _claim(uint256 id, uint32 day, uint16 coins, uint64 deadline, bytes calldata signature, bool skipStale)
        internal
        returns (uint256 amount)
    {
        if (id >= _drops.length) revert UnknownDrop();
        Drop storage d = _drops[id];
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(FINDS_TYPEHASH, msg.sender, id, day, coins, deadline)));
        // (a malformed signature counts as forged too)
        (address who, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || who != signer) revert BadSignature();
        uint32 now_ = today();
        bytes4 stale;
        if (block.timestamp > deadline) stale = Expired.selector;
        else if (day > now_) stale = FutureDay.selector;
        else if (now_ >= day + CLAIM_DAYS) stale = TooLate.selector;
        else if (day < d.startDay || day > d.endDay) stale = NotRunning.selector;
        if (stale != 0) {
            if (skipStale) return 0;
            assembly ("memory-safe") {
                mstore(0, stale)
                revert(0, 4)
            }
        }

        uint16 n;
        (n, amount) = _payable(id, d, msg.sender, day, coins);
        if (n == 0) return 0;
        claimed[id][day][msg.sender] += n;
        paidCoins[id][day] += n;
        d.left -= amount;
        held[d.token] -= amount;
        IERC20(d.token).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, id, day, n, amount);
    }

    // ---------------------------------------------------------------- the treasury

    /// @notice Start a drop: `amount` of `token` (a launchpad token, or $STAMP for the golden stamps) moves here from
    ///         you (approve it first). Coins are out from `startDay` (today or later) for `days` days.
    /// @param spots Coins out each day (1 to MAX_SPOTS; a $STAMP drop always has the 24 golden stamps).
    /// @param maxPerWallet Coins one wallet is paid for per day (1 to `spots`).
    /// @param dailyCoins Coins paid per day across everyone (every player can collect each coin, so this is what
    ///        bounds a day's payout: `dailyCoins * perCoin` is the most a day can pay; `maxPerWallet` to
    ///        MAX_DAILY_COINS).
    /// @param startDay Today, or up to a year ahead.
    function createDrop(
        address token,
        uint256 perCoin,
        uint16 spots,
        uint16 maxPerWallet,
        uint256 dailyCoins,
        uint32 startDay,
        uint32 days_,
        uint256 amount
    ) external onlyOwner nonReentrant returns (uint256 id) {
        bool isStamp = token == address(stamp);
        if (!isStamp) {
            (,, uint64 createdAt,,) = pad.launches(token);
            if (createdAt == 0) revert BadToken();
        }
        if (isStamp) spots = GOLDEN_SPOTS;
        if (
            perCoin == 0 || spots == 0 || spots > MAX_SPOTS || maxPerWallet == 0 || maxPerWallet > spots
                || dailyCoins < maxPerWallet || dailyCoins > MAX_DAILY_COINS || days_ == 0 || days_ > MAX_DAYS
                || startDay < today() || startDay > today() + MAX_DAYS
        ) revert BadDrop();
        uint256 got = _pull(token, amount);
        id = _drops.length;
        uint32 endDay = startDay + days_ - 1;
        _drops.push(Drop({
            token: token,
            spots: spots,
            maxPerWallet: maxPerWallet,
            startDay: startDay,
            endDay: endDay,
            perCoin: perCoin,
            dailyCoins: dailyCoins,
            left: got
        }));
        emit DropCreated(id, token, perCoin, spots, maxPerWallet, dailyCoins, startDay, endDay, got);
    }

    /// @notice Add tokens to a drop (approve them first).
    function topUp(uint256 id, uint256 amount) external onlyOwner nonReentrant {
        if (id >= _drops.length) revert UnknownDrop();
        uint256 got = _pull(_drops[id].token, amount);
        _drops[id].left += got;
        emit DropToppedUp(id, got);
    }

    /// @notice Stop a drop after `lastDay` (today or later: coins already out stay out until their day ends, so nobody's
    ///         finds move); one that hasn't started by then is cancelled. Reverts if `lastDay` has already passed, so a
    ///         transaction mined after midnight can't run the drop a day longer than meant.
    function endDrop(uint256 id, uint32 lastDay) external onlyOwner {
        if (id >= _drops.length) revert UnknownDrop();
        if (lastDay < today()) revert TooLate();
        _end(id, lastDay);
    }

    function _end(uint256 id, uint32 lastDay) internal {
        Drop storage d = _drops[id];
        uint32 last = d.startDay > lastDay ? d.startDay - 1 : lastDay;
        if (last < d.endDay) {
            d.endDay = last;
            emit DropEnded(id, last);
        }
    }

    /// @notice Take a drop's remaining tokens back once nobody can claim from it any more (its last day and the
    ///         day after are over, or it was cancelled before it started), or at any time while paused. A drop
    ///         emptied while it's still running ends after `lastDay` (today: as for `endDrop`, a transaction mined
    ///         after it reverts, so the emptied drop's coins can't stay out a day longer than meant).
    function withdraw(uint256 id, address to, uint32 lastDay) external onlyOwner nonReentrant {
        if (id >= _drops.length) revert UnknownDrop();
        if (to == address(0)) revert ZeroAddress();
        if (lastDay < today()) revert TooLate();
        Drop storage d = _drops[id];
        bool cancelled = d.endDay < d.startDay; // (no day is in its range, so no claim can ever pass)
        if (!paused && !cancelled && today() < d.endDay + CLAIM_DAYS) revert StillRunning();
        _end(id, lastDay);
        uint256 amount = d.left;
        d.left = 0;
        held[d.token] -= amount;
        IERC20(d.token).safeTransfer(to, amount);
        emit Withdrawn(id, to, amount);
    }

    /// @notice Recover tokens that reached this contract without going into a drop (sent straight here, say): only
    ///         what's above the drops' own balances of that token.
    function sweep(address token, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = IERC20(token).balanceOf(address(this)) - held[token];
        IERC20(token).safeTransfer(to, amount);
        emit Swept(token, to, amount);
    }

    /// @notice Change the server key (if it's ever replaced or exposed).
    function setSigner(address signer_) external onlyOwner {
        if (signer_ == address(0)) revert ZeroAddress();
        emit SignerSet(signer, signer_);
        signer = signer_;
    }

    /// @notice Stop every claim (if the server key leaks, say); the owner can then take the drops' tokens back.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    /// @notice Drops need their owner (to fund, end and withdraw them), so ownership can move but never be dropped.
    function renounceOwnership() public view override onlyOwner {
        revert NotAllowed();
    }

    /// @dev What actually arrived (a plain token sends the full amount), now held for a drop.
    function _pull(address token, uint256 amount) internal returns (uint256 got) {
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        got = IERC20(token).balanceOf(address(this)) - before;
        held[token] += got;
    }
}
