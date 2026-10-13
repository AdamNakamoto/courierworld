// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title Courier Companions
/// @notice Companions that follow your courier around Courier World: pets, space buddies and rarer ones. Each kind of
///         companion is a token id with its own $STAMP price and a limited supply, and you pick the one you want. Paid
///         only in $STAMP, which goes straight from the buyer to the treasury: this contract never holds any.
///         ERC-1155, with an ERC-2981 royalty on resales (5% to start, at most 10%).
/// @dev A kind's supply can only ever shrink (never below what's been minted), so a limited companion stays limited.
///      Wallet limits count what a wallet has bought, not what it holds, so passing companions on doesn't reset them.
///      Buyers name the most $STAMP they'll pay, so a price change mined before their buy can't charge them more than
///      they saw. Nothing is minted except by buying: the owner has no free mint.
contract CourierCompanions is ERC1155, ERC2981, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    /// @notice A kind of companion. `price` in $STAMP (18 decimals) each; `perWallet` 0 means no limit.
    struct Kind {
        uint128 price;
        uint32 maxSupply;
        uint32 minted;
        uint32 perWallet;
        bool open;
        bool exists;
    }

    /// @notice The most companions one buy can mint.
    uint256 public constant MAX_PER_BUY = 10;
    /// @notice The highest royalty the owner can set (10%, in basis points).
    uint96 public constant MAX_ROYALTY_BPS = 1000;

    string public constant name = "Courier Companions";
    string public constant symbol = "COMPANION";
    IERC20 public immutable stamp;
    /// @notice Where the $STAMP goes.
    address public treasury;
    /// @notice Each kind, by token id.
    mapping(uint256 id => Kind) public kinds;
    /// @notice How many of each kind a wallet has bought.
    mapping(address buyer => mapping(uint256 id => uint256)) public bought;
    /// @notice Every kind's id, in the order they were added.
    uint256[] public kindIds;
    /// @notice Each kind's metadata lives at `base` + id + ".json".
    string public base;

    event KindSet(uint256 indexed id, uint256 price, uint256 maxSupply, uint256 perWallet, bool open);
    event Bought(address indexed buyer, uint256 indexed id, uint256 quantity, uint256 stampPaid);
    event TreasurySet(address indexed treasury);
    event BaseSet(string base);

    error ZeroAddress();
    error BadPrice();
    error BadSupply();
    /// @notice A kind's supply can't grow, nor go below what's been minted.
    error SupplyCanOnlyShrink();
    error UnknownKind();
    error Closed();
    error BadQuantity();
    error SoldOut();
    error WalletLimit();
    /// @notice The price is now `price` each, more than the buyer agreed to pay.
    error PriceChanged(uint256 price);
    error RoyaltyTooHigh();

    constructor(address owner_, address stamp_, address treasury_, string memory base_)
        ERC1155("")
        Ownable(owner_)
    {
        if (stamp_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        stamp = IERC20(stamp_);
        treasury = treasury_;
        base = base_;
        _setDefaultRoyalty(treasury_, 500);
        emit TreasurySet(treasury_);
        emit BaseSet(base_);
    }

    // ---------------------------------------------------------------- buying

    /// @notice Buy `quantity` (1 to MAX_PER_BUY) of kind `id`, paying its price each in $STAMP but never more than
    ///         `maxCost` in all (reverts `PriceChanged` if the price went up). Approve this contract for the $STAMP
    ///         first, or use `buyWithPermit`.
    function buy(uint256 id, uint256 quantity, uint256 maxCost) external nonReentrant {
        _buy(msg.sender, id, quantity, maxCost);
    }

    /// @notice `buy`, with a signed permit for `maxCost` $STAMP instead of an approval: one signature, one transaction.
    /// @dev If the permit was already used (say someone submitted it first), the buy still goes through on the
    ///      allowance it left.
    function buyWithPermit(uint256 id, uint256 quantity, uint256 maxCost, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        try IERC20Permit(address(stamp)).permit(msg.sender, address(this), maxCost, deadline, v, r, s) {} catch {}
        _buy(msg.sender, id, quantity, maxCost);
    }

    function _buy(address buyer, uint256 id, uint256 quantity, uint256 maxCost) private {
        Kind storage k = kinds[id];
        if (!k.exists) revert UnknownKind();
        if (!k.open) revert Closed();
        if (quantity == 0 || quantity > MAX_PER_BUY) revert BadQuantity();
        if (uint256(k.minted) + quantity > k.maxSupply) revert SoldOut();
        uint256 already = bought[buyer][id];
        if (k.perWallet != 0 && already + quantity > k.perWallet) revert WalletLimit();
        uint256 cost = uint256(k.price) * quantity;
        if (cost > maxCost) revert PriceChanged(k.price);

        k.minted += uint32(quantity);
        bought[buyer][id] = already + quantity;
        stamp.safeTransferFrom(buyer, treasury, cost);
        emit Bought(buyer, id, quantity, cost);
        _mint(buyer, id, quantity, "");
    }

    // ---------------------------------------------------------------- the owner

    /// @notice Add a kind of companion, or change one: its price, supply (a new kind's; an existing one's can only
    ///         shrink, never below what's been minted), wallet limit (0: none) and whether it's on sale.
    function setKind(uint256 id, uint256 price, uint256 maxSupply, uint256 perWallet, bool open_) external onlyOwner {
        if (price == 0 || price > type(uint128).max) revert BadPrice();
        if (maxSupply == 0 || maxSupply > type(uint32).max || perWallet > type(uint32).max) revert BadSupply();
        Kind storage k = kinds[id];
        if (k.exists) {
            if (maxSupply > k.maxSupply || maxSupply < k.minted) revert SupplyCanOnlyShrink();
        } else {
            k.exists = true;
            kindIds.push(id);
        }
        k.price = uint128(price);
        k.maxSupply = uint32(maxSupply);
        k.perWallet = uint32(perWallet);
        k.open = open_;
        emit KindSet(id, price, maxSupply, perWallet, open_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// @notice Where each kind's metadata lives: `base` + id + ".json".
    function setBase(string calldata base_) external onlyOwner {
        base = base_;
        emit BaseSet(base_);
        for (uint256 i; i < kindIds.length; ++i) emit URI(uri(kindIds[i]), kindIds[i]);
    }

    /// @notice The royalty on resales: who's paid, and how much (in basis points, at most MAX_ROYALTY_BPS).
    function setRoyalty(address receiver, uint96 bps) external onlyOwner {
        if (bps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();
        _setDefaultRoyalty(receiver, bps);
    }

    // ---------------------------------------------------------------- reading

    /// @notice How many kinds there are.
    function kindCount() external view returns (uint256) {
        return kindIds.length;
    }

    /// @notice Every kind's id and details, in the order they were added.
    function allKinds() external view returns (uint256[] memory ids, Kind[] memory list) {
        ids = kindIds;
        list = new Kind[](ids.length);
        for (uint256 i; i < ids.length; ++i) list[i] = kinds[ids[i]];
    }

    function uri(uint256 id) public view override returns (string memory) {
        return string.concat(base, id.toString(), ".json");
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
