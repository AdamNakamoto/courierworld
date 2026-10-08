// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {StampToken} from "./StampToken.sol";
import {CourierNFT} from "./CourierNFT.sol";

/// @title PostOffice
/// @notice Open a post office with ETH, put Courier NFTs on duty, and earn a share of
///         each block's $STAMP equal to your share of the planet's delivery power.
///         Every office comes with a trainee so you can start without an NFT. Rewards
///         halve every HALVING_INTERVAL blocks, converging on the 21M cap. $STAMP is
///         spent levelling couriers and growing the office; most of it is burned.
/// @dev Blocks are virtual (one every `blockTimeMs` since deployment), so the schedule
///      is the same on any chain. Rewards use a cumulative reward-per-power
///      accumulator, so every action is O(1).
contract PostOffice is Ownable2Step, ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    uint256 public constant HALVING_INTERVAL = 4_200_000;
    uint256 private constant MAX_ERAS = 64;
    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10_000;

    uint256 public constant TRAINEE_POWER = 60;
    uint8 public constant MAX_LEVEL = 10;
    uint256 public constant MAX_REFERRAL_BPS = 1_000;
    uint256 public constant MAX_UPGRADE_COOLDOWN = 7 days;

    StampToken public immutable stamp;
    CourierNFT public immutable couriers;
    uint256 public immutable startTime;
    uint256 public immutable blockTimeMs;
    /// @notice First-era reward per block. Total emission is initialReward × 2 × HALVING_INTERVAL, so set it to
    ///         (21M − launch allocation) / 8.4M: 2.5 with no allocation, 2.25 with 2.1M in the pool.
    uint256 public immutable initialReward;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    struct Tier {
        uint8 slots; // couriers on duty at once
        uint16 routes; // route capacity; faster rides use more
        uint256 upgradeCost; // $STAMP to reach this tier from the one below
    }

    struct Office {
        bool open;
        uint8 tier;
        uint8 onDuty;
        uint16 routesUsed;
        uint64 lastUpgrade;
        address referrer;
        uint256 power;
        uint256 rewardDebt;
        uint256 pending;
    }

    Tier[] public tiers;
    mapping(address => Office) public offices;
    mapping(uint256 tokenId => address) public dutyOf;
    mapping(uint256 tokenId => uint8) public levelOf; // 0-based: stored 0 is level 1

    uint256 public totalPower;
    uint256 public accRewardPerPower;
    uint256 public lastRewardBlock;
    uint256 public totalEmitted;

    uint256 public officePrice;
    address public treasury;
    uint256 public burnBps = 7_500;
    uint256 public referralBps = 250;
    uint256 public upgradeCooldown = 24 hours;
    uint256 public levelCostBase = 25e18;

    // ---------------------------------------------------------------------
    // Events and errors
    // ---------------------------------------------------------------------

    event OfficeOpened(address indexed owner, address indexed referrer);
    event OfficeUpgraded(address indexed owner, uint8 tier);
    event CourierAssigned(address indexed office, uint256 indexed tokenId, uint256 power);
    event CourierUnassigned(address indexed office, uint256 indexed tokenId);
    event CourierLeveled(uint256 indexed tokenId, uint8 level, uint256 cost);
    event Claimed(address indexed owner, uint256 amount, address indexed referrer, uint256 referralAmount);
    event StampSpent(address indexed spender, uint256 burned, uint256 toTreasury);
    event TierAdded(uint256 indexed tier);
    event SettingsUpdated();

    error AlreadyOpen();
    error NotOpen();
    error WrongPayment();
    error NoTiers();
    error NotCourierOwner();
    error AlreadyOnDuty();
    error NotOnDuty();
    error NoFreeSlot();
    error NotEnoughRoutes();
    error MaxLevel();
    error MaxTier();
    error CooldownActive(uint256 readyAt);
    error InvalidTier();
    error InvalidSetting();
    error NothingToClaim();

    constructor(
        StampToken stamp_,
        CourierNFT couriers_,
        uint256 blockTimeMs_,
        uint256 initialReward_,
        uint256 officePrice_,
        address treasury_,
        address owner_
    ) Ownable(owner_) {
        if (blockTimeMs_ == 0 || initialReward_ == 0 || treasury_ == address(0)) revert InvalidSetting();
        if (initialReward_ * 2 * HALVING_INTERVAL > stamp_.MAX_SUPPLY() - stamp_.totalMinted()) revert InvalidSetting();
        stamp = stamp_;
        couriers = couriers_;
        blockTimeMs = blockTimeMs_;
        initialReward = initialReward_;
        officePrice = officePrice_;
        treasury = treasury_;
        startTime = block.timestamp;
    }

    // ---------------------------------------------------------------------
    // Rides
    // ---------------------------------------------------------------------

    /// @notice Delivery power and routes for each ride. Fixed in code so nobody can
    ///         rebalance couriers that are already on duty. Must match traits.js.
    function rideStats(uint8 ride) public pure returns (uint256 power, uint256 routes) {
        if (ride == 0) return (100, 1); // On Foot
        if (ride == 1) return (160, 1); // Skateboard
        if (ride == 2) return (260, 2); // Bicycle
        if (ride == 3) return (450, 3); // Moped
        return (800, 4); // Paper Plane
    }

    /// @notice +12% delivery power per level above 1.
    function powerAt(uint256 basePower, uint8 level0) public pure returns (uint256) {
        return (basePower * (100 + 12 * uint256(level0))) / 100;
    }

    function courierPower(uint256 tokenId) public view returns (uint256) {
        (uint256 base,) = rideStats(couriers.rideOf(tokenId));
        return powerAt(base, levelOf[tokenId]);
    }

    /// @notice $STAMP to go from `level0 + 1` to `level0 + 2`: base × level².
    function levelCost(uint8 level0) public view returns (uint256) {
        uint256 l = uint256(level0) + 1;
        return levelCostBase * l * l;
    }

    // ---------------------------------------------------------------------
    // Player actions
    // ---------------------------------------------------------------------

    /// @notice Open a post office. A trainee courier starts work immediately.
    function openOffice(address referrer) external payable nonReentrant {
        Office storage o = offices[msg.sender];
        if (o.open) revert AlreadyOpen();
        if (msg.value != officePrice) revert WrongPayment();
        if (tiers.length == 0) revert NoTiers();

        o.open = true;
        if (referrer != msg.sender) o.referrer = referrer;
        _addPower(o, TRAINEE_POWER);
        emit OfficeOpened(msg.sender, o.referrer);
    }

    /// @notice Put one of your couriers on duty. It's locked until you take it off.
    function assign(uint256 tokenId) external nonReentrant {
        Office storage o = offices[msg.sender];
        if (!o.open) revert NotOpen();
        if (couriers.ownerOf(tokenId) != msg.sender) revert NotCourierOwner();
        if (dutyOf[tokenId] != address(0)) revert AlreadyOnDuty();
        Tier storage t = tiers[o.tier];
        if (o.onDuty >= t.slots) revert NoFreeSlot();
        (uint256 base, uint256 routes) = rideStats(couriers.rideOf(tokenId));
        if (o.routesUsed + routes > t.routes) revert NotEnoughRoutes();

        uint256 p = powerAt(base, levelOf[tokenId]);
        _addPower(o, p);
        o.onDuty += 1;
        o.routesUsed += uint16(routes);
        dutyOf[tokenId] = msg.sender;
        couriers.setLocked(tokenId, true);
        emit CourierAssigned(msg.sender, tokenId, p);
    }

    /// @notice Take a courier off duty. It stops earning and can be traded again.
    function unassign(uint256 tokenId) external nonReentrant {
        if (dutyOf[tokenId] != msg.sender) revert NotOnDuty();
        Office storage o = offices[msg.sender];
        (uint256 base, uint256 routes) = rideStats(couriers.rideOf(tokenId));

        _removePower(o, powerAt(base, levelOf[tokenId]));
        o.onDuty -= 1;
        o.routesUsed -= uint16(routes);
        delete dutyOf[tokenId];
        couriers.setLocked(tokenId, false);
        emit CourierUnassigned(msg.sender, tokenId);
    }

    /// @notice Train a courier you own. Works on or off duty; the level stays with
    ///         the NFT when it's sold.
    function levelUp(uint256 tokenId) external nonReentrant {
        if (couriers.ownerOf(tokenId) != msg.sender) revert NotCourierOwner();
        uint8 lvl = levelOf[tokenId];
        if (lvl + 1 >= MAX_LEVEL) revert MaxLevel();
        uint256 cost = levelCost(lvl);
        (uint256 base,) = rideStats(couriers.rideOf(tokenId));

        _spend(cost);
        address office = dutyOf[tokenId];
        if (office != address(0)) _addPower(offices[office], powerAt(base, lvl + 1) - powerAt(base, lvl));
        levelOf[tokenId] = lvl + 1;
        emit CourierLeveled(tokenId, lvl + 2, cost);
    }

    /// @notice Move up one tier: more slots and routes. Paid in $STAMP.
    function upgradeOffice() external nonReentrant {
        Office storage o = offices[msg.sender];
        if (!o.open) revert NotOpen();
        uint256 next = uint256(o.tier) + 1;
        if (next >= tiers.length) revert MaxTier();
        if (o.lastUpgrade != 0) {
            uint256 readyAt = o.lastUpgrade + upgradeCooldown;
            if (block.timestamp < readyAt) revert CooldownActive(readyAt);
        }
        _spend(tiers[next].upgradeCost);
        o.tier = uint8(next);
        o.lastUpgrade = uint64(block.timestamp);
        emit OfficeUpgraded(msg.sender, uint8(next));
    }

    /// @notice Mint your accrued $STAMP. The referrer's cut comes out of your share.
    function claim() external nonReentrant {
        Office storage o = offices[msg.sender];
        _checkpoint(o);
        o.rewardDebt = o.power * accRewardPerPower / PRECISION;

        uint256 amount = o.pending;
        if (amount == 0) revert NothingToClaim();
        o.pending = 0;
        // Rounding can never mint past the cap.
        uint256 room = stamp.MAX_SUPPLY() - stamp.totalMinted();
        if (amount > room) amount = room;

        uint256 refAmount;
        if (o.referrer != address(0)) {
            refAmount = amount * referralBps / BPS;
            if (refAmount > 0) stamp.mint(o.referrer, refAmount);
        }
        stamp.mint(msg.sender, amount - refAmount);
        emit Claimed(msg.sender, amount - refAmount, o.referrer, refAmount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function currentBlock() public view returns (uint256) {
        return (block.timestamp - startTime) * 1000 / blockTimeMs;
    }

    function rewardPerBlock() external view returns (uint256) {
        uint256 era = currentBlock() / HALVING_INTERVAL;
        return era >= MAX_ERAS ? 0 : initialReward >> era;
    }

    function pendingRewards(address owner) external view returns (uint256) {
        Office storage o = offices[owner];
        uint256 acc = accRewardPerPower;
        uint256 nowBlock = currentBlock();
        if (nowBlock > lastRewardBlock && totalPower > 0) {
            acc += _emissionBetween(lastRewardBlock, nowBlock) * PRECISION / totalPower;
        }
        return o.pending + o.power * acc / PRECISION - o.rewardDebt;
    }

    function tierCount() external view returns (uint256) {
        return tiers.length;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Tiers never shrink, so couriers on duty always still fit after an upgrade.
    function addTier(uint8 slots, uint16 routes, uint256 upgradeCost) external onlyOwner {
        uint256 n = tiers.length;
        if (slots == 0 || routes == 0 || n > type(uint8).max) revert InvalidTier();
        if (n > 0 && (slots < tiers[n - 1].slots || routes < tiers[n - 1].routes)) revert InvalidTier();
        tiers.push(Tier(slots, routes, upgradeCost));
        emit TierAdded(n);
    }

    function setTierUpgradeCost(uint256 tier, uint256 cost) external onlyOwner {
        tiers[tier].upgradeCost = cost;
        emit SettingsUpdated();
    }

    function setOfficePrice(uint256 price) external onlyOwner {
        officePrice = price;
        emit SettingsUpdated();
    }

    function setLevelCostBase(uint256 base) external onlyOwner {
        levelCostBase = base;
        emit SettingsUpdated();
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert InvalidSetting();
        treasury = treasury_;
        emit SettingsUpdated();
    }

    function setBurnBps(uint256 bps) external onlyOwner {
        if (bps > BPS) revert InvalidSetting();
        burnBps = bps;
        emit SettingsUpdated();
    }

    function setReferralBps(uint256 bps) external onlyOwner {
        if (bps > MAX_REFERRAL_BPS) revert InvalidSetting();
        referralBps = bps;
        emit SettingsUpdated();
    }

    function setUpgradeCooldown(uint256 cooldown) external onlyOwner {
        if (cooldown > MAX_UPGRADE_COOLDOWN) revert InvalidSetting();
        upgradeCooldown = cooldown;
        emit SettingsUpdated();
    }

    /// @notice Sends office sales to the treasury.
    function withdrawETH() external onlyOwner {
        Address.sendValue(payable(treasury), address(this).balance);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _addPower(Office storage o, uint256 p) internal {
        _checkpoint(o);
        o.power += p;
        totalPower += p;
        o.rewardDebt = o.power * accRewardPerPower / PRECISION;
    }

    function _removePower(Office storage o, uint256 p) internal {
        _checkpoint(o);
        o.power -= p;
        totalPower -= p;
        o.rewardDebt = o.power * accRewardPerPower / PRECISION;
    }

    /// @dev Advance the global accumulator, then bank the office's earnings at its
    ///      current power. Callers reset rewardDebt after changing power.
    function _checkpoint(Office storage o) internal {
        uint256 nowBlock = currentBlock();
        if (nowBlock > lastRewardBlock) {
            if (totalPower > 0) {
                uint256 reward = _emissionBetween(lastRewardBlock, nowBlock);
                accRewardPerPower += reward * PRECISION / totalPower;
                totalEmitted += reward;
            }
            lastRewardBlock = nowBlock;
        }
        if (o.power > 0) {
            o.pending += o.power * accRewardPerPower / PRECISION - o.rewardDebt;
        }
    }

    /// @dev Sum of block rewards over [fromBlock, toBlock), crossing halvings as needed.
    function _emissionBetween(uint256 fromBlock, uint256 toBlock) internal view returns (uint256 total) {
        while (fromBlock < toBlock) {
            uint256 era = fromBlock / HALVING_INTERVAL;
            if (era >= MAX_ERAS) break;
            uint256 eraEnd = (era + 1) * HALVING_INTERVAL;
            uint256 end = toBlock < eraEnd ? toBlock : eraEnd;
            total += (end - fromBlock) * (initialReward >> era);
            fromBlock = end;
        }
    }

    /// @dev Burns burnBps of `amount` and sends the rest to the treasury.
    function _spend(uint256 amount) internal {
        if (amount == 0) return;
        uint256 burned = amount * burnBps / BPS;
        uint256 rest = amount - burned;
        if (burned > 0) stamp.burnFrom(msg.sender, burned);
        if (rest > 0) stamp.transferFrom(msg.sender, treasury, rest);
        emit StampSpent(msg.sender, burned, rest);
    }
}
