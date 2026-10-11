// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice The part of the post office the hunt reads: whether a wallet has an office open.
interface IPostOfficeOffices {
    function offices(address owner)
        external
        view
        returns (
            bool open,
            uint8 tier,
            uint8 onDuty,
            uint16 routesUsed,
            uint64 lastUpgrade,
            address referrer,
            uint256 power,
            uint256 rewardDebt,
            uint256 pending
        );
}

/// @title The golden stamp hunt
/// @notice Golden stamps are hidden round the planet, in new spots every day. The game's server checks
///         each find against the player's path and signs a voucher for how many they've found that day;
///         this contract pays it in $STAMP from a pool the owner fills. Nothing here mints: every $STAMP
///         paid was deposited first. Only wallets with an open post office can claim.
contract StampHunt is Ownable2Step, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant FINDS_TYPEHASH = keccak256("Finds(address player,uint32 day,uint16 stamps,uint64 deadline)");

    IERC20 public immutable stamp;
    IPostOfficeOffices public immutable postOffice;

    /// @notice The game server's key, which signs the vouchers.
    address public signer;
    /// @notice $STAMP paid for each golden stamp found.
    uint256 public rewardPerStamp;
    /// @notice The most stamps one wallet is paid for in a day.
    uint16 public maxStampsPerDay;
    /// @notice The most $STAMP paid out for one day's finds, across everyone (0: no limit).
    uint256 public dailyLimit;

    /// @notice Stamps already paid for: wallet => day => count.
    mapping(address => mapping(uint32 => uint16)) public claimed;
    /// @notice $STAMP paid out for each day's finds.
    mapping(uint32 => uint256) public paidFor;

    event Claimed(address indexed player, uint32 indexed day, uint16 stamps, uint256 amount);
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event SignerSet(address signer);
    event RewardSet(uint256 rewardPerStamp);
    event LimitsSet(uint16 maxStampsPerDay, uint256 dailyLimit);

    error ZeroAddress();
    error ZeroReward();
    error Expired();
    error FutureDay();
    error NoOffice();
    error BadSignature();
    error NothingToClaim();
    error PoolEmpty();
    error DailyLimitReached();
    error ZeroLimit();

    constructor(
        IERC20 stamp_,
        IPostOfficeOffices postOffice_,
        address signer_,
        address owner_,
        uint256 rewardPerStamp_,
        uint16 maxStampsPerDay_,
        uint256 dailyLimit_
    ) Ownable(owner_) EIP712("Courier World Stamp Hunt", "1") {
        if (address(stamp_) == address(0) || address(postOffice_) == address(0) || signer_ == address(0)) revert ZeroAddress();
        if (rewardPerStamp_ == 0) revert ZeroReward();
        if (maxStampsPerDay_ == 0) revert ZeroLimit();
        stamp = stamp_;
        postOffice = postOffice_;
        signer = signer_;
        rewardPerStamp = rewardPerStamp_;
        maxStampsPerDay = maxStampsPerDay_;
        dailyLimit = dailyLimit_;
    }

    /// @notice The hunt's day number: days since 1 January 1970, UTC.
    function today() public view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    /// @notice $STAMP in the pool, ready to pay out.
    function pool() external view returns (uint256) {
        return stamp.balanceOf(address(this));
    }

    /// @notice What `player` would be paid for a voucher saying they found `stamps` on `day`.
    function claimable(address player, uint32 day, uint16 stamps) public view returns (uint16 count, uint256 amount) {
        uint16 cap = stamps > maxStampsPerDay ? maxStampsPerDay : stamps;
        uint16 done = claimed[player][day];
        if (cap <= done) return (0, 0);
        uint256 n = cap - done;
        uint256 reward = rewardPerStamp;
        // As many as the pool, and the day's limit, can cover; the rest stays claimable for later.
        uint256 room = stamp.balanceOf(address(this)) / reward;
        if (dailyLimit != 0) {
            uint256 left = dailyLimit > paidFor[day] ? (dailyLimit - paidFor[day]) / reward : 0;
            if (left < room) room = left;
        }
        if (n > room) n = room;
        return (uint16(n), n * reward);
    }

    /// @notice Claim a day's finds with the server's voucher. `stamps` is the day's total so far: you're
    ///         paid for the ones not yet claimed, so you can claim again later the same day.
    function claim(uint32 day, uint16 stamps, uint64 deadline, bytes calldata signature) external nonReentrant returns (uint256 amount) {
        if (block.timestamp > deadline) revert Expired();
        if (day > today()) revert FutureDay();
        (bool open,,,,,,,,) = postOffice.offices(msg.sender);
        if (!open) revert NoOffice();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(FINDS_TYPEHASH, msg.sender, day, stamps, deadline)));
        if (ECDSA.recover(digest, signature) != signer) revert BadSignature();

        uint16 count;
        (count, amount) = claimable(msg.sender, day, stamps);
        if (count == 0) {
            if (claimed[msg.sender][day] >= (stamps > maxStampsPerDay ? maxStampsPerDay : stamps)) revert NothingToClaim();
            // The day's limit is spent (a deposit wouldn't help), or else the pool is short.
            if (dailyLimit != 0 && (dailyLimit > paidFor[day] ? dailyLimit - paidFor[day] : 0) < rewardPerStamp) revert DailyLimitReached();
            revert PoolEmpty();
        }
        claimed[msg.sender][day] += count;
        paidFor[day] += amount;
        stamp.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, day, count, amount);
    }

    /// @notice Add $STAMP to the pool (approve it first). Anyone may.
    function deposit(uint256 amount) external {
        stamp.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Owner
    // ---------------------------------------------------------------------

    /// @notice Take $STAMP back out of the pool (to end the hunt, or move funds).
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        stamp.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Change the server key (if it's ever replaced or exposed).
    function setSigner(address signer_) external onlyOwner {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        emit SignerSet(signer_);
    }

    function setReward(uint256 rewardPerStamp_) external onlyOwner {
        if (rewardPerStamp_ == 0) revert ZeroReward();
        rewardPerStamp = rewardPerStamp_;
        emit RewardSet(rewardPerStamp_);
    }

    /// @notice `maxStampsPerDay` must be at least 1 (pause the hunt by withdrawing the pool); `dailyLimit` 0 means none.
    function setLimits(uint16 maxStampsPerDay_, uint256 dailyLimit_) external onlyOwner {
        if (maxStampsPerDay_ == 0) revert ZeroLimit();
        maxStampsPerDay = maxStampsPerDay_;
        dailyLimit = dailyLimit_;
        emit LimitsSet(maxStampsPerDay_, dailyLimit_);
    }
}
