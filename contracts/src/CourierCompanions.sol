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

/// @notice The creator token standard (ERC1155-C) that marketplaces read to find a collection's transfer rules.
interface ICreatorToken {
    event TransferValidatorUpdated(address oldValidator, address newValidator);

    function getTransferValidator() external view returns (address validator);
    function getTransferValidationFunction() external view returns (bytes4 functionSignature, bool isViewFunction);
    function setTransferValidator(address validator) external;
}

/// @notice Checks every transfer; reverts the ones the collection doesn't allow. (Not a view: for a sale it
///         authorized, the registry counts down the amount it allowed.)
interface ITransferValidator1155 {
    function validateTransfer(address caller, address from, address to, uint256 id, uint256 amount) external;
}

/// @title Courier Companions
/// @notice Companions that follow your courier around Courier World: pets, space buddies and rarer ones. Each kind of
///         companion is a token id with its own $STAMP price and a limited supply, and you pick the one you want. Paid
///         only in $STAMP, which goes straight from the buyer to the treasury: this contract never holds any.
///         ERC-1155, with an ERC-2981 royalty on resales (5% to start, at most 10%), and the royalty is enforced: every
///         transfer is checked by a transfer validator (OpenSea's creator fee enforcement registry at launch), so
///         marketplaces can only move companions in sales that pay it. Holders can always move their own companions
///         between wallets. The validator can be replaced (if marketplaces move to a new one) but never removed.
/// @dev A kind's supply can only ever shrink (never below what's been minted), so a limited companion stays limited
///      in total. Wallet limits count what a wallet has bought, not what it holds, so passing companions on doesn't
///      reset them; they limit each address, not each person (someone with many wallets can buy more). Buyers name
///      the most $STAMP they'll pay, so a price change mined before their buy can't charge them more than they saw.
///      Nothing is minted except by a buy at the current price.
///      Trust: the owner sets each kind's price (at least 1 wei) and the treasury, so the owner could price a kind
///      low and buy it, and when the owner is the treasury (as deployed), the owner's own buys pay itself. The owner
///      also picks the transfer validator, which decides which transfers between wallets go through: it can't move
///      anyone's companions, but a bad one could hold transfers up (buys never touch it). Holders' companions and
///      $STAMP are never within the owner's reach.
contract CourierCompanions is ERC1155, ERC2981, Ownable2Step, ReentrancyGuard, ICreatorToken {
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
    /// @dev validateTransfer(address,address,address,uint256,uint256)
    bytes4 private constant VALIDATE_TRANSFER = 0x1854b241;

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
    /// @notice Checks every transfer between wallets, so marketplaces pay the royalty.
    address public transferValidator;

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
    /// @notice The treasury can't be this contract (it would lock the $STAMP here).
    error BadTreasury();
    /// @notice The permit didn't leave enough allowance for the buy (a bad, expired or too-small signature).
    error PermitFailed();
    /// @notice Ownership can only be handed over (two-step), never renounced: the lineup must stay manageable.
    error CannotRenounce();
    /// @notice The transfer validator must be a contract: enforcement can be moved, never switched off.
    error NotAContract();

    /// @notice The collection's metadata changed (ERC-7572).
    event ContractURIUpdated();

    constructor(address owner_, address stamp_, address treasury_, address validator_, string memory base_)
        ERC1155("")
        Ownable(owner_)
    {
        if (stamp_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(this)) revert BadTreasury();
        stamp = IERC20(stamp_);
        treasury = treasury_;
        base = base_;
        _setValidator(validator_);
        _setDefaultRoyalty(treasury_, 500);
        emit TreasurySet(treasury_);
        emit BaseSet(base_);
    }

    // ---------------------------------------------------------------- buying

    /// @notice Buy `quantity` (1 to MAX_PER_BUY) of kind `id`, paying its price each in $STAMP but never more than
    ///         `maxCost` in all (reverts `PriceChanged` if the price went up). Approve this contract for the $STAMP
    ///         first, or use `buyWithPermit`.
    function buy(uint256 id, uint256 quantity, uint256 maxCost) external nonReentrant {
        _buy(msg.sender, id, quantity, maxCost, false);
    }

    /// @notice `buy`, with a signed permit for `maxCost` $STAMP instead of an approval: one signature, one transaction.
    /// @dev If the permit was already used (say someone submitted it first), the buy still goes through on the
    ///      allowance it left; if there isn't enough allowance either way, it reverts `PermitFailed`. A permit for
    ///      more than the cost leaves the rest approved to this contract, which only ever spends its buyer's own
    ///      allowance on that buyer's buys.
    function buyWithPermit(uint256 id, uint256 quantity, uint256 maxCost, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        try IERC20Permit(address(stamp)).permit(msg.sender, address(this), maxCost, deadline, v, r, s) {} catch {}
        _buy(msg.sender, id, quantity, maxCost, true);
    }

    function _buy(address buyer, uint256 id, uint256 quantity, uint256 maxCost, bool viaPermit) private {
        Kind storage k = kinds[id];
        if (!k.exists) revert UnknownKind();
        if (!k.open) revert Closed();
        if (quantity == 0 || quantity > MAX_PER_BUY) revert BadQuantity();
        if (uint256(k.minted) + quantity > k.maxSupply) revert SoldOut();
        uint256 already = bought[buyer][id];
        if (k.perWallet != 0 && already + quantity > k.perWallet) revert WalletLimit();
        uint256 cost = uint256(k.price) * quantity;
        if (cost > maxCost) revert PriceChanged(k.price);
        if (viaPermit && stamp.allowance(buyer, address(this)) < cost) revert PermitFailed();

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
        }
        bool added = !k.exists;
        if (added) {
            k.exists = true;
            kindIds.push(id);
        }
        k.price = uint128(price);
        k.maxSupply = uint32(maxSupply);
        k.perWallet = uint32(perWallet);
        k.open = open_;
        emit KindSet(id, price, maxSupply, perWallet, open_);
        if (added) emit URI(uri(id), id);
    }

    /// @notice Where the $STAMP goes from now on. The royalty moves with it, if it was being paid to the old treasury.
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(this)) revert BadTreasury();
        (address receiver, uint256 bps) = royaltyInfo(0, _feeDenominator());
        if (receiver == treasury) _setDefaultRoyalty(treasury_, uint96(bps));
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// @notice Where each kind's metadata lives (`base` + id + ".json"), and the collection's (`base` +
    ///         "collection.json").
    function setBase(string calldata base_) external onlyOwner {
        base = base_;
        emit BaseSet(base_);
        emit ContractURIUpdated();
        for (uint256 i; i < kindIds.length; ++i) emit URI(uri(kindIds[i]), kindIds[i]);
    }

    /// @notice The royalty on resales: who's paid, and how much (in basis points, at most MAX_ROYALTY_BPS).
    function setRoyalty(address receiver, uint96 bps) external onlyOwner {
        if (bps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();
        _setDefaultRoyalty(receiver, bps);
    }

    /// @notice Send `token` that was sent here by mistake to `to`. This contract never holds anything it should keep:
    ///         buys pay the treasury directly, so this reaches no one's companions or $STAMP.
    function rescue(IERC20 token, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, token.balanceOf(address(this)));
    }

    // ---------------------------------------------------------------- royalty enforcement

    function getTransferValidator() external view returns (address) {
        return transferValidator;
    }

    function getTransferValidationFunction() external pure returns (bytes4 functionSignature, bool isViewFunction) {
        return (VALIDATE_TRANSFER, false);
    }

    /// @notice Point the collection at a new validator, e.g. if marketplaces move to a new registry. It must be a
    ///         contract: enforcement can be moved, never switched off.
    function setTransferValidator(address validator) external onlyOwner {
        _setValidator(validator);
    }

    function _setValidator(address validator) private {
        if (validator.code.length == 0) revert NotAContract();
        emit TransferValidatorUpdated(transferValidator, validator);
        transferValidator = validator;
    }

    /// @dev Mints skip the check (they're buys, paid for); every transfer between wallets goes through the validator,
    ///      one kind at a time.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (from != address(0) && to != address(0)) {
            ITransferValidator1155 v = ITransferValidator1155(transferValidator);
            for (uint256 i; i < ids.length; ++i) v.validateTransfer(msg.sender, from, to, ids[i], values[i]);
        }
        super._update(from, to, ids, values);
    }

    /// @notice Ownership can't be renounced (a renounced owner would freeze every price and the treasury for good).
    function renounceOwnership() public view override onlyOwner {
        revert CannotRenounce();
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

    /// @notice The collection's own metadata (ERC-7572): name, description, image, royalty.
    function contractURI() external view returns (string memory) {
        return string.concat(base, "collection.json");
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, ERC2981) returns (bool) {
        return interfaceId == type(ICreatorToken).interfaceId || super.supportsInterface(interfaceId);
    }
}
