// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice The creator token standard (ERC721-C) that marketplaces read to find a collection's transfer rules.
interface ICreatorToken {
    event TransferValidatorUpdated(address oldValidator, address newValidator);

    function getTransferValidator() external view returns (address validator);
    function getTransferValidationFunction() external view returns (bytes4 functionSignature, bool isViewFunction);
    function setTransferValidator(address validator) external;
}

/// @notice Checks every transfer; reverts the ones the collection doesn't allow.
interface ITransferValidator721 {
    function validateTransfer(address caller, address from, address to, uint256 tokenId) external view;
}

/// @title Courier Planets
/// @notice 333 planets in Courier World, each a world of its own in the game: its owner explores it, builds on it, and
///         can open it to other players, who pay a ticket in $STAMP to visit. Bought only with $STAMP, which goes
///         straight from the buyer to the treasury: this contract never holds any.
///
///         Tickets: each planet's owner sets its ticket (free, up to MAX_TICKET $STAMP, or closed). A visitor pays it
///         here, and it goes straight from them: most to the planet's owner, `treasuryBps` of it (at most
///         MAX_TREASURY_BPS) to the treasury. The game lets a visitor in for a while once it has seen their `Visited`.
///         A planet that changes hands starts closed, so a new owner never inherits someone else's price.
///
///         The royalty on resales is a fixed 5% to the treasury, and it is enforced: every transfer between wallets is
///         checked by a transfer validator (OpenSea's creator fee enforcement registry at launch), so a marketplace
///         moving a planet on its holder's approval can only do it in a sale that pays the royalty. A holder (a wallet
///         or a contract) can always move its own planets, so a private deal, or a venue that takes planets into its own
///         custody, can skip it, as with any ERC721-C collection that lets holders move their own.
/// @dev Nothing is minted except by a buy at the current price, and a planet's look comes from its number (the game
///      and the metadata draw it), so every planet has the same rights. Wallet limits count what a wallet has bought;
///      they limit each address, not each person.
///      Trust: the owner sets the price (at least 1 wei), the wallet limit, the sale, the treasury (which the royalty
///      follows), the treasury's share of tickets (at most MAX_TREASURY_BPS), the metadata's address and the transfer
///      validator, and (as the collection's owner) its rules at OpenSea's registry. So the owner could price planets
///      low and buy them, and when the owner is the treasury (as deployed) the owner's own buys pay itself. Through
///      the validator or the registry the owner could stop enforcing the royalty (which only costs the treasury) or
///      hold every transfer up; never move anyone's planet, since a validator can only refuse a transfer. Holders'
///      planets and $STAMP are never within the owner's reach.
contract CourierPlanets is ERC721, ERC2981, Ownable2Step, ReentrancyGuard, ICreatorToken {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    /// @notice A planet's ticket: what a visit costs in $STAMP (18 decimals), and whether it's open to visitors.
    struct Ticket {
        uint128 price;
        bool open;
    }

    /// @notice There are only ever this many planets.
    uint256 public constant MAX_SUPPLY = 333;
    /// @notice The most planets one buy can mint.
    uint256 public constant MAX_PER_BUY = 3;
    /// @notice The dearest ticket a planet's owner can set.
    uint256 public constant MAX_TICKET = 1_000e18;
    /// @notice The most of each ticket the treasury can take (50%, in basis points).
    uint16 public constant MAX_TREASURY_BPS = 5000;
    /// @notice The royalty on resales, fixed: 5% (in basis points), to the treasury.
    uint96 public constant ROYALTY_BPS = 500;
    /// @dev validateTransfer(address,address,address,uint256)
    bytes4 private constant VALIDATE_TRANSFER = 0xcaee23ea;

    IERC20 public immutable stamp;
    /// @notice Where the $STAMP goes: every planet sale, and the treasury's share of tickets.
    address public treasury;
    /// @notice A planet's price in $STAMP (18 decimals).
    uint256 public price;
    bool public saleOpen;
    /// @notice How many planets one wallet can buy (0: no limit).
    uint256 public perWallet;
    uint256 public totalMinted;
    /// @notice How many planets each wallet has bought.
    mapping(address buyer => uint256) public bought;
    /// @notice The treasury's share of each ticket, in basis points.
    uint16 public treasuryBps;
    /// @notice Each planet's ticket, by number.
    mapping(uint256 id => Ticket) public tickets;
    /// @notice Checks every transfer between wallets, so marketplaces pay the royalty.
    address public transferValidator;
    /// @notice Each planet's metadata lives at `base` + number + ".json", the collection's at `base` + "collection.json".
    string public base;

    event Bought(address indexed buyer, uint256 firstId, uint256 quantity, uint256 stampPaid);
    event SaleSet(bool open);
    event PriceSet(uint256 price);
    event PerWalletSet(uint256 perWallet);
    event TreasurySet(address indexed treasury);
    event TreasuryShareSet(uint16 bps);
    event BaseSet(string base);
    event TicketSet(uint256 indexed id, uint256 price, bool open);
    /// @notice `visitor` paid planet `id`'s ticket: `toOwner` to its owner `planetOwner`, `toTreasury` to the treasury.
    event Visited(uint256 indexed id, address indexed visitor, address indexed planetOwner, uint256 price, uint256 toOwner, uint256 toTreasury);
    /// @notice The collection's metadata changed (ERC-7572).
    event ContractURIUpdated();
    /// @notice Every planet's metadata changed (ERC-4906).
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);

    error ZeroAddress();
    /// @notice The treasury can't be this contract (it would lock the $STAMP here).
    error BadTreasury();
    error ZeroPrice();
    error SaleClosed();
    error BadQuantity();
    error SoldOut();
    error WalletLimit();
    /// @notice The price is now `price`, more than the caller agreed to pay.
    error PriceChanged(uint256 price);
    /// @notice The permit didn't leave enough allowance (a bad, expired or too-small signature).
    error PermitFailed();
    /// @notice Only the planet's owner can set its ticket.
    error NotPlanetOwner();
    error TicketTooDear();
    /// @notice The planet isn't open to visitors.
    error Closed();
    error ShareTooHigh();
    /// @notice The transfer validator must be a contract (an address with no code would hold every transfer up).
    error NotAContract();
    /// @notice A planet can't be sent to this contract: nothing could ever move it out again.
    error BadReceiver();
    /// @notice Ownership can only be handed over (two-step), never renounced.
    error CannotRenounce();

    constructor(address owner_, address stamp_, address treasury_, address validator_, uint256 price_, string memory base_)
        ERC721("Courier Planets", "PLANET")
        Ownable(owner_)
    {
        if (stamp_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(this)) revert BadTreasury();
        if (price_ == 0) revert ZeroPrice();
        stamp = IERC20(stamp_);
        treasury = treasury_;
        price = price_;
        perWallet = 3;
        treasuryBps = 2000;
        base = base_;
        _setValidator(validator_);
        _setDefaultRoyalty(treasury_, ROYALTY_BPS);
        emit TreasurySet(treasury_);
        emit PriceSet(price_);
        emit PerWalletSet(3);
        emit TreasuryShareSet(2000);
        emit BaseSet(base_);
    }

    // ---------------------------------------------------------------- buying

    /// @notice Buy `quantity` planets (1 to MAX_PER_BUY), the next numbers in line, paying the price each in $STAMP but
    ///         never more than `maxCost` in all (reverts `PriceChanged` if the price went up). Approve this contract for
    ///         the $STAMP first, or use `buyWithPermit`.
    function buy(uint256 quantity, uint256 maxCost) external nonReentrant {
        _buy(msg.sender, quantity, maxCost, false);
    }

    /// @notice `buy`, with a signed permit for `maxCost` $STAMP instead of an approval. If the permit was already used,
    ///         the buy still goes through on the allowance it left; without enough allowance it reverts `PermitFailed`.
    function buyWithPermit(uint256 quantity, uint256 maxCost, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        try IERC20Permit(address(stamp)).permit(msg.sender, address(this), maxCost, deadline, v, r, s) {} catch {}
        _buy(msg.sender, quantity, maxCost, true);
    }

    function _buy(address buyer, uint256 quantity, uint256 maxCost, bool viaPermit) private {
        if (!saleOpen) revert SaleClosed();
        if (quantity == 0 || quantity > MAX_PER_BUY) revert BadQuantity();
        uint256 minted = totalMinted;
        if (minted + quantity > MAX_SUPPLY) revert SoldOut();
        uint256 already = bought[buyer];
        if (perWallet != 0 && already + quantity > perWallet) revert WalletLimit();
        uint256 cost = price * quantity;
        if (cost > maxCost) revert PriceChanged(price);
        if (viaPermit && stamp.allowance(buyer, address(this)) < cost) revert PermitFailed();

        totalMinted = minted + quantity;
        bought[buyer] = already + quantity;
        stamp.safeTransferFrom(buyer, treasury, cost);
        emit Bought(buyer, minted + 1, quantity, cost);
        for (uint256 i = 1; i <= quantity; ++i) _safeMint(buyer, minted + i);
    }

    // ---------------------------------------------------------------- visiting

    /// @notice Set your planet's ticket: what a visit costs in $STAMP (0 for free, at most MAX_TICKET), and whether it's
    ///         open to visitors at all.
    function setTicket(uint256 id, uint256 price_, bool open_) external {
        if (ownerOf(id) != msg.sender) revert NotPlanetOwner();
        if (price_ > MAX_TICKET) revert TicketTooDear();
        tickets[id] = Ticket(uint128(price_), open_);
        emit TicketSet(id, price_, open_);
    }

    /// @notice Pay planet `id`'s ticket to visit it, never more than `maxPrice` (reverts `PriceChanged` if its owner
    ///         raised it first). Approve this contract for the $STAMP first, or use `visitWithPermit`.
    function visit(uint256 id, uint256 maxPrice) external nonReentrant {
        _visit(msg.sender, id, maxPrice, false);
    }

    /// @notice `visit`, with a signed permit for `maxPrice` $STAMP instead of an approval.
    function visitWithPermit(uint256 id, uint256 maxPrice, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        try IERC20Permit(address(stamp)).permit(msg.sender, address(this), maxPrice, deadline, v, r, s) {} catch {}
        _visit(msg.sender, id, maxPrice, true);
    }

    function _visit(address visitor, uint256 id, uint256 maxPrice, bool viaPermit) private {
        address planetOwner = ownerOf(id);
        Ticket memory t = tickets[id];
        if (!t.open) revert Closed();
        if (t.price > maxPrice) revert PriceChanged(t.price);
        if (viaPermit && stamp.allowance(visitor, address(this)) < t.price) revert PermitFailed();
        uint256 toTreasury = (uint256(t.price) * treasuryBps) / 10_000;
        uint256 toOwner = t.price - toTreasury;
        if (toOwner > 0) stamp.safeTransferFrom(visitor, planetOwner, toOwner);
        if (toTreasury > 0) stamp.safeTransferFrom(visitor, treasury, toTreasury);
        emit Visited(id, visitor, planetOwner, t.price, toOwner, toTreasury);
    }

    // ---------------------------------------------------------------- the owner

    function setSaleOpen(bool open_) external onlyOwner {
        saleOpen = open_;
        emit SaleSet(open_);
    }

    function setPrice(uint256 price_) external onlyOwner {
        if (price_ == 0) revert ZeroPrice();
        price = price_;
        emit PriceSet(price_);
    }

    /// @notice How many planets one wallet can buy from now on (0: no limit). Counts what each has bought so far.
    function setPerWallet(uint256 perWallet_) external onlyOwner {
        perWallet = perWallet_;
        emit PerWalletSet(perWallet_);
    }

    /// @notice Where the $STAMP and the royalty go from now on.
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(this)) revert BadTreasury();
        _setDefaultRoyalty(treasury_, ROYALTY_BPS);
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// @notice The treasury's share of each ticket from now on, in basis points (at most MAX_TREASURY_BPS).
    function setTreasuryShare(uint16 bps) external onlyOwner {
        if (bps > MAX_TREASURY_BPS) revert ShareTooHigh();
        treasuryBps = bps;
        emit TreasuryShareSet(bps);
    }

    function setBase(string calldata base_) external onlyOwner {
        base = base_;
        emit BaseSet(base_);
        emit ContractURIUpdated();
        if (totalMinted > 0) emit BatchMetadataUpdate(1, totalMinted);
    }

    /// @notice Send `token` that was sent here by mistake to `to`. This contract never holds anything it should keep:
    ///         buys and tickets pay their recipients directly.
    function rescue(IERC20 token, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, token.balanceOf(address(this)));
    }

    /// @notice Ownership can't be renounced (a renounced owner would freeze the price, the treasury and the validator).
    function renounceOwnership() public view override onlyOwner {
        revert CannotRenounce();
    }

    // ---------------------------------------------------------------- royalty enforcement

    function getTransferValidator() external view returns (address) {
        return transferValidator;
    }

    function getTransferValidationFunction() external pure returns (bytes4 functionSignature, bool isViewFunction) {
        return (VALIDATE_TRANSFER, true);
    }

    /// @notice Point the collection at a new validator, e.g. if marketplaces move to a new registry. It must be a
    ///         contract.
    function setTransferValidator(address validator) external onlyOwner {
        _setValidator(validator);
    }

    function _setValidator(address validator) private {
        if (validator.code.length == 0) revert NotAContract();
        emit TransferValidatorUpdated(transferValidator, validator);
        transferValidator = validator;
    }

    /// @dev Mints skip the check (they're buys, paid for; there is no burn); every transfer between wallets goes
    ///      through the validator, and a planet that changes hands closes to visitors until its new owner sets a
    ///      ticket. No planet can be sent here (`transferFrom` doesn't ask the receiver, so this is the one place to
    ///      stop it).
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (to == address(this)) revert BadReceiver();
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            ITransferValidator721(transferValidator).validateTransfer(msg.sender, from, to, tokenId);
            if (tickets[tokenId].open || tickets[tokenId].price != 0) {
                delete tickets[tokenId];
                emit TicketSet(tokenId, 0, false);
            }
        }
        return super._update(to, tokenId, auth);
    }

    // ---------------------------------------------------------------- reading

    /// @notice The planets `owner` holds, by number.
    function planetsOf(address owner) external view returns (uint256[] memory ids) {
        uint256 n = balanceOf(owner);
        uint256 found;
        ids = new uint256[](n);
        for (uint256 id = 1; id <= totalMinted && found < n; ++id) {
            if (_ownerOf(id) == owner) ids[found++] = id;
        }
    }

    /// @notice Every planet so far (numbers 1 to totalMinted): its owner and its ticket, for the game's list of
    ///         planets to visit.
    function allPlanets() external view returns (address[] memory owners, Ticket[] memory list) {
        uint256 n = totalMinted;
        owners = new address[](n);
        list = new Ticket[](n);
        for (uint256 i; i < n; ++i) {
            owners[i] = _ownerOf(i + 1);
            list[i] = tickets[i + 1];
        }
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return string.concat(base, id.toString(), ".json");
    }

    /// @notice The collection's own metadata (ERC-7572): name, description, image, royalty.
    function contractURI() external view returns (string memory) {
        return string.concat(base, "collection.json");
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return interfaceId == type(ICreatorToken).interfaceId || interfaceId == bytes4(0x49064906) // ERC-4906
            || super.supportsInterface(interfaceId);
    }
}
