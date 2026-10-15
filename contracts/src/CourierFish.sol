// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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

/// @notice The part of the post office the fish read: whether a wallet has an office open.
interface IFishPostOffice {
    function offices(address owner)
        external
        view
        returns (bool, uint8, uint8, uint16, uint64, address, uint256, uint256, uint256);
}

/// @title Courier Fish
/// @notice Fish caught in Courier World's bay, kept as NFTs: each species is a token id (ERC-1155). Fishing is free:
///         the game's server checks every catch (the player was really at the water, cast there and landed it after the bite), keeps
///         count, and signs a voucher for what a wallet caught that day; the player mints those fish here, paying only
///         gas. Common species never run out; the rare ones have a fixed total, ever. Only wallets with an open post
///         office can mint, at most `maxPerDay` fish for each day's catch, within CLAIM_DAYS days.
///         The royalty on resales is a fixed 5% to the treasury, and it is enforced: every transfer between wallets is
///         checked by a transfer validator (OpenSea's creator fee enforcement registry at launch), so a marketplace
///         moving fish on their holder's approval can only do it in a sale that pays the royalty. A holder (a wallet
///         or a contract) can always move its own fish, so a private deal can skip it.
/// @dev Vouchers carry each species' total for the day so far, so a later voucher for the same day mints only what's
///      new. Nothing is minted except by a voucher from `signer`.
///      Trust: the server's key decides catches. A leaked key could mint, for wallets with an open post office (0.005
///      ETH each), at most `maxPerDay` fish per wallet per day of the claim window, and of a capped species never more
///      than its `dailyCap` per day nor its `maxSupply` in all, until the owner pauses or replaces the key. The owner
///      sets the signer, pauses, adds species and shrinks caps (a capped species can never grow), sets the daily
///      limit (at most MAX_PER_DAY), the treasury (which the royalty follows), the metadata's address and the transfer
///      validator (and, as the collection's owner, its rules at OpenSea's registry: it could stop enforcing the
///      royalty, which only costs the treasury, or hold transfers up; a validator can only refuse a transfer). The
///      owner could sign itself vouchers by installing its own key. Holders' fish are never within its reach.
contract CourierFish is ERC1155, ERC2981, Ownable2Step, EIP712, ReentrancyGuard, ICreatorToken {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    /// @notice A species. `maxSupply` 0: never runs out. `dailyCap`: the most that can be minted of it for one day's
    ///         catch across everyone (0: no daily cap).
    struct Species {
        uint32 maxSupply;
        uint32 minted;
        uint32 dailyCap;
        bool exists;
    }

    /// @notice One day's catch, signed by the server: each species' total so far that day.
    struct Voucher {
        uint32 day;
        uint256[] ids;
        uint256[] counts;
        uint64 deadline;
        bytes signature;
    }

    bytes32 public constant CATCH_TYPEHASH =
        keccak256("Catch(address player,uint32 day,uint256[] ids,uint256[] counts,uint64 deadline)");
    /// @notice A day's catch can be minted that day and the six after.
    uint32 public constant CLAIM_DAYS = 7;
    /// @notice The highest daily limit the owner can set.
    uint32 public constant MAX_PER_DAY = 50;
    /// @notice The royalty on resales, fixed: 5% (in basis points), to the treasury.
    uint96 public constant ROYALTY_BPS = 500;
    /// @dev validateTransfer(address,address,address,uint256,uint256)
    bytes4 private constant VALIDATE_TRANSFER = 0x1854b241;

    string public constant name = "Courier Fish";
    string public constant symbol = "FISH";
    IFishPostOffice public immutable postOffice;
    /// @notice The game server's key, which signs the vouchers.
    address public signer;
    /// @notice While paused nobody can mint.
    bool public paused;
    /// @notice The most fish a wallet can mint for one day's catch.
    uint32 public maxPerDay;
    /// @notice Where the royalty goes.
    address public treasury;
    /// @notice Each species, by token id.
    mapping(uint256 id => Species) public species;
    /// @notice Every species' id, in the order they were added.
    uint256[] public speciesIds;
    /// @notice How many of a species a wallet has minted for a day's catch.
    mapping(address player => mapping(uint32 day => mapping(uint256 id => uint256))) public claimed;
    /// @notice How many fish in all a wallet has minted for a day's catch.
    mapping(address player => mapping(uint32 day => uint256)) public claimedOn;
    /// @notice How many of a species have been minted for a day's catch, across everyone.
    mapping(uint256 id => mapping(uint32 day => uint256)) public mintedOn;
    /// @notice Each species' metadata lives at `base` + id + ".json", the collection's at `base` + "collection.json".
    string public base;
    /// @notice Checks every transfer between wallets, so marketplaces pay the royalty.
    address public transferValidator;

    event SpeciesSet(uint256 indexed id, uint256 maxSupply, uint256 dailyCap);
    /// @notice `player` minted fish for `day`'s catch: `amounts` of each of `ids`.
    event Minted(address indexed player, uint32 indexed day, uint256[] ids, uint256[] amounts);
    event SignerSet(address indexed previous, address indexed signer);
    event PausedSet(bool paused);
    event MaxPerDaySet(uint256 maxPerDay);
    event TreasurySet(address indexed treasury);
    event BaseSet(string base);
    /// @notice The collection's metadata changed (ERC-7572).
    event ContractURIUpdated();

    error ZeroAddress();
    error BadTreasury();
    error BadLimit();
    error BadSupply();
    /// @notice A capped species' total can only shrink (never below what's been minted), and never become uncapped.
    error SupplyCanOnlyShrink();
    error UnknownSpecies();
    /// @notice A voucher's species must be listed once each, in increasing order, with a count for each.
    error BadVoucher();
    error BadSignature();
    error Expired();
    error FutureDay();
    error TooLate();
    error NoOffice();
    error IsPaused();
    error NothingToMint();
    error NotAContract();
    error CannotRenounce();

    constructor(
        address owner_,
        IFishPostOffice postOffice_,
        address signer_,
        address treasury_,
        address validator_,
        uint32 maxPerDay_,
        string memory base_
    ) ERC1155("") Ownable(owner_) EIP712("Courier World Fish", "1") {
        if (address(postOffice_) == address(0) || signer_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(this)) revert BadTreasury();
        if (maxPerDay_ == 0 || maxPerDay_ > MAX_PER_DAY) revert BadLimit();
        postOffice = postOffice_;
        signer = signer_;
        treasury = treasury_;
        maxPerDay = maxPerDay_;
        base = base_;
        _setValidator(validator_);
        _setDefaultRoyalty(treasury_, ROYALTY_BPS);
        emit SignerSet(address(0), signer_);
        emit TreasurySet(treasury_);
        emit MaxPerDaySet(maxPerDay_);
        emit BaseSet(base_);
    }

    // ---------------------------------------------------------------- minting

    /// @notice Days since 1 January 1970 (UTC): the game's day.
    function today() public view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    /// @notice Mint one day's catch with the server's voucher. `counts` are that day's totals so far: you get the fish
    ///         not yet minted, so you can mint again later the same day. Returns how many fish were minted.
    function mint(Voucher calldata v) external nonReentrant returns (uint256 minted) {
        _checkMinter();
        minted = _mintVoucher(v, false);
        if (minted == 0) revert NothingToMint();
    }

    /// @notice Mint several days' catches in one go. Vouchers that have expired or whose day can no longer be minted
    ///         (a batch sent just before midnight, say) mint nothing instead of reverting; a forged or malformed one
    ///         still reverts the lot.
    function mintMany(Voucher[] calldata vouchers) external nonReentrant returns (uint256 minted) {
        _checkMinter();
        for (uint256 i; i < vouchers.length; ++i) minted += _mintVoucher(vouchers[i], true);
        if (minted == 0) revert NothingToMint();
    }

    function _checkMinter() internal view {
        if (paused) revert IsPaused();
        (bool open,,,,,,,,) = postOffice.offices(msg.sender);
        if (!open) revert NoOffice();
    }

    /// @dev `skipStale`: in a batch, an expired voucher or a day that can't be minted now mints nothing. Returns the
    ///      fish minted; the daily limit counts every new catch within it, including any a capped species had no room
    ///      left for.
    function _mintVoucher(Voucher calldata v, bool skipStale) internal returns (uint256 minted) {
        uint256 n = v.ids.length;
        if (n == 0 || n != v.counts.length) revert BadVoucher();
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CATCH_TYPEHASH,
                    msg.sender,
                    v.day,
                    keccak256(abi.encodePacked(v.ids)),
                    keccak256(abi.encodePacked(v.counts)),
                    v.deadline
                )
            )
        );
        // (a malformed signature counts as forged too)
        (address who, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, v.signature);
        if (err != ECDSA.RecoverError.NoError || who != signer) revert BadSignature();
        uint32 now_ = today();
        bytes4 stale;
        if (block.timestamp > v.deadline) stale = Expired.selector;
        else if (v.day > now_) stale = FutureDay.selector;
        else if (uint256(now_) >= uint256(v.day) + CLAIM_DAYS) stale = TooLate.selector;
        if (stale != 0) {
            if (skipStale) return 0;
            assembly ("memory-safe") {
                mstore(0, stale)
                revert(0, 4)
            }
        }

        uint256[] memory ids = new uint256[](n);
        uint256[] memory amounts = new uint256[](n);
        uint256 kinds;
        uint256 total; // new catches within the day's limit, counted against it
        uint256 allow = maxPerDay > claimedOn[msg.sender][v.day] ? maxPerDay - claimedOn[msg.sender][v.day] : 0;
        for (uint256 i; i < n; ++i) {
            uint256 id = v.ids[i];
            if (i > 0 && id <= v.ids[i - 1]) revert BadVoucher();
            Species storage s = species[id];
            if (!s.exists) revert UnknownSpecies();
            uint256 had = claimed[msg.sender][v.day][id];
            if (v.counts[i] <= had) continue;
            uint256 add = v.counts[i] - had;
            claimed[msg.sender][v.day][id] = v.counts[i];
            // Only what's left of the wallet's day (it shrinks if the owner lowers the limit after the catch); then a
            // capped species only what its day and its total have left (the server never hands out more: this only
            // bounds a leaked key, or a limit lowered after the catch). Fish over a limit are spent, not owed.
            uint256 room = add > allow ? allow : add;
            allow -= room;
            total += room;
            if (s.dailyCap != 0) {
                uint256 dayLeft = s.dailyCap > mintedOn[id][v.day] ? s.dailyCap - mintedOn[id][v.day] : 0;
                if (room > dayLeft) room = dayLeft;
            }
            if (s.maxSupply != 0) {
                uint256 left = s.maxSupply - s.minted;
                if (room > left) room = left;
            }
            if (room == 0) continue;
            mintedOn[id][v.day] += room;
            s.minted += uint32(room);
            ids[kinds] = id;
            amounts[kinds] = room;
            ++kinds;
            minted += room;
        }
        if (total == 0) return 0;
        claimedOn[msg.sender][v.day] += total;
        assembly ("memory-safe") {
            mstore(ids, kinds)
            mstore(amounts, kinds)
        }
        if (kinds == 0) return 0;
        emit Minted(msg.sender, v.day, ids, amounts);
        _mintBatch(msg.sender, ids, amounts, "");
    }

    // ---------------------------------------------------------------- the owner

    /// @notice Add a species, or change one. `maxSupply` 0 means it never runs out; once capped, a species' total can
    ///         only shrink (never below what's been minted). `dailyCap` is the most minted of it for one day's catch
    ///         across everyone (0: none).
    function setSpecies(uint256 id, uint256 maxSupply, uint256 dailyCap) external onlyOwner {
        _setSpecies(id, maxSupply, dailyCap);
    }

    /// @notice `setSpecies` for several at once (the deploy's lineup in one transaction).
    function setSpeciesMany(uint256[] calldata ids, uint256[] calldata maxSupplies, uint256[] calldata dailyCaps) external onlyOwner {
        if (ids.length != maxSupplies.length || ids.length != dailyCaps.length) revert BadSupply();
        for (uint256 i; i < ids.length; ++i) _setSpecies(ids[i], maxSupplies[i], dailyCaps[i]);
    }

    function _setSpecies(uint256 id, uint256 maxSupply, uint256 dailyCap) private {
        if (maxSupply > type(uint32).max || dailyCap > type(uint32).max) revert BadSupply();
        Species storage s = species[id];
        if (s.exists && (s.maxSupply != 0 || maxSupply != 0)) {
            if ((s.maxSupply != 0 && (maxSupply == 0 || maxSupply > s.maxSupply)) || maxSupply < s.minted) {
                revert SupplyCanOnlyShrink();
            }
        }
        bool added = !s.exists;
        if (added) {
            s.exists = true;
            speciesIds.push(id);
        }
        s.maxSupply = uint32(maxSupply);
        s.dailyCap = uint32(dailyCap);
        emit SpeciesSet(id, maxSupply, dailyCap);
        if (added) emit URI(uri(id), id);
    }

    function setSigner(address signer_) external onlyOwner {
        if (signer_ == address(0)) revert ZeroAddress();
        emit SignerSet(signer, signer_);
        signer = signer_;
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    /// @notice The most fish a wallet can mint for one day's catch (1 to MAX_PER_DAY). It applies to every day still
    ///         in the claim window: lowered, a day's catch beyond it is spent, not owed.
    function setMaxPerDay(uint32 maxPerDay_) external onlyOwner {
        if (maxPerDay_ == 0 || maxPerDay_ > MAX_PER_DAY) revert BadLimit();
        maxPerDay = maxPerDay_;
        emit MaxPerDaySet(maxPerDay_);
    }

    /// @notice Where the royalty goes from now on.
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(this)) revert BadTreasury();
        _setDefaultRoyalty(treasury_, ROYALTY_BPS);
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// @notice Where each species' metadata lives (`base` + id + ".json"), and the collection's.
    function setBase(string calldata base_) external onlyOwner {
        base = base_;
        emit BaseSet(base_);
        emit ContractURIUpdated();
        for (uint256 i; i < speciesIds.length; ++i) emit URI(uri(speciesIds[i]), speciesIds[i]);
    }

    /// @notice Send `token` that was sent here by mistake to `to`. This contract never holds tokens of its own.
    function rescue(IERC20 token, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, token.balanceOf(address(this)));
    }

    /// @notice Ownership can't be renounced (a renounced owner could never pause or replace a leaked key).
    function renounceOwnership() public view override onlyOwner {
        revert CannotRenounce();
    }

    // ---------------------------------------------------------------- royalty enforcement

    function getTransferValidator() external view returns (address) {
        return transferValidator;
    }

    function getTransferValidationFunction() external pure returns (bytes4 functionSignature, bool isViewFunction) {
        return (VALIDATE_TRANSFER, false);
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

    /// @dev Mints skip the check (they're catches); every transfer between wallets goes through the validator, one
    ///      species at a time. (Fish can't be sent to this contract: it has no ERC-1155 receiver.)
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (from != address(0) && to != address(0)) {
            ITransferValidator1155 val = ITransferValidator1155(transferValidator);
            for (uint256 i; i < ids.length; ++i) val.validateTransfer(msg.sender, from, to, ids[i], values[i]);
        }
        super._update(from, to, ids, values);
    }

    // ---------------------------------------------------------------- reading

    function speciesCount() external view returns (uint256) {
        return speciesIds.length;
    }

    /// @notice Every species' id and details, in the order they were added.
    function allSpecies() external view returns (uint256[] memory ids, Species[] memory list) {
        ids = speciesIds;
        list = new Species[](ids.length);
        for (uint256 i; i < ids.length; ++i) list[i] = species[ids[i]];
    }

    /// @notice What a voucher for `player` would mint now, species by species (within the day's limit and each
    ///         species' caps): nothing for a day that can't be minted, or while paused.
    function mintable(address player, uint32 day, uint256[] calldata ids, uint256[] calldata counts)
        external
        view
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](ids.length);
        uint32 now_ = today();
        if (paused || ids.length != counts.length || day > now_ || uint256(now_) >= uint256(day) + CLAIM_DAYS) return amounts;
        uint256 allow = maxPerDay > claimedOn[player][day] ? maxPerDay - claimedOn[player][day] : 0;
        for (uint256 i; i < ids.length; ++i) {
            Species storage s = species[ids[i]];
            uint256 had = claimed[player][day][ids[i]];
            if (!s.exists || counts[i] <= had) continue;
            uint256 room = counts[i] - had;
            if (room > allow) room = allow;
            allow -= room;
            if (s.dailyCap != 0) {
                uint256 dayLeft = s.dailyCap > mintedOn[ids[i]][day] ? s.dailyCap - mintedOn[ids[i]][day] : 0;
                if (room > dayLeft) room = dayLeft;
            }
            if (s.maxSupply != 0 && room > s.maxSupply - s.minted) room = s.maxSupply - s.minted;
            amounts[i] = room;
        }
    }

    function uri(uint256 id) public view override returns (string memory) {
        return string.concat(base, id.toString(), ".json");
    }

    /// @notice The collection's own metadata (ERC-7572): name, description, image.
    function contractURI() external view returns (string memory) {
        return string.concat(base, "collection.json");
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, ERC2981) returns (bool) {
        return interfaceId == type(ICreatorToken).interfaceId || super.supportsInterface(interfaceId);
    }
}
