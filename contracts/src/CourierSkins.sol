// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

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

/// @title CourierSkins
/// @notice 999 Courier Skins: outfits and rides to wear in Courier World. Cosmetic only; they never change what
///         anyone earns. Minted blind for ETH, then revealed: the design of each skin comes from a shuffle of
///         the full 999-skin deck, keyed by a seed committed before the mint and revealed after it.
///
///         The 5% royalty is enforced. Every transfer is checked by a transfer validator (OpenSea's creator fee
///         enforcement registry at launch), so marketplaces can only move skins in sales that pay it. Holders can
///         always move their own skins between wallets. The validator can be replaced (if marketplaces move to a
///         new one) but never removed, and the 5% rate is fixed.
contract CourierSkins is ERC721, ERC2981, Ownable2Step, ICreatorToken {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 999;
    uint256 public constant MAX_PER_TX = 10;
    uint96 public constant ROYALTY_BPS = 500;
    uint256 public constant DESIGNS = 16;

    /// @dev validateTransfer(address,address,address,uint256)
    bytes4 private constant VALIDATE_TRANSFER = 0xcaee23ea;

    uint256 public price;
    bool public saleOpen;
    uint256 public totalMinted;
    address public treasury;

    bytes32 public immutable seedCommit;
    uint256 public seed; // 0 until revealed

    address public transferValidator;
    string public imageBase;
    bool public imagesFrozen;

    event Revealed(uint256 seed);
    event SaleOpen(bool open);
    event PriceSet(uint256 price);
    event TreasurySet(address indexed treasury);
    event ImageBaseSet(string imageBase);
    event ImagesFrozen();

    error SaleClosed();
    error BadQuantity();
    error SoldOut();
    error WrongPayment();
    error NotRevealed();
    error AlreadyRevealed();
    error BadSecret();
    error ZeroAddress();
    error NotAContract();
    error ImagesAreFrozen();
    error NotFinished();
    error BadDesign();

    constructor(
        address owner_,
        address treasury_,
        uint256 price_,
        bytes32 seedCommit_,
        address validator_,
        string memory imageBase_
    ) ERC721("Courier Skins", "CSKIN") Ownable(owner_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        price = price_;
        seedCommit = seedCommit_;
        imageBase = imageBase_;
        _setDefaultRoyalty(treasury_, ROYALTY_BPS);
        _setValidator(validator_);
    }

    // ---------------------------------------------------------------- mint

    function mint(uint256 quantity) external payable {
        if (!saleOpen) revert SaleClosed();
        if (quantity == 0 || quantity > MAX_PER_TX) revert BadQuantity();
        if (totalMinted + quantity > MAX_SUPPLY) revert SoldOut();
        if (msg.value != price * quantity) revert WrongPayment();
        for (uint256 i = 0; i < quantity; i++) {
            _mint(msg.sender, ++totalMinted);
        }
        // Paid straight to the treasury: this contract never holds ETH.
        Address.sendValue(payable(treasury), msg.value);
    }

    // ---------------------------------------------------------------- reveal

    /// @notice End the sale for good and fix every skin's design. The committed secret is mixed with a recent
    ///         blockhash, so the owner can't pre-compute the designs either.
    function reveal(uint256 secret) external onlyOwner {
        if (seed != 0) revert AlreadyRevealed();
        if (keccak256(abi.encode(secret)) != seedCommit) revert BadSecret();
        if (saleOpen) {
            saleOpen = false;
            emit SaleOpen(false);
        }
        uint256 s = uint256(keccak256(abi.encode(secret, blockhash(block.number - 1))));
        seed = s == 0 ? 1 : s;
        emit Revealed(seed);
    }

    /// @notice The design a skin turned out to be: an index into the list in web/skins.js (0 Night Rider ... 15
    ///         Moonwedge Neon). Each token takes a different card of the 999-card deck, so if every skin is minted
    ///         each design appears exactly as often as its supply says.
    function designOf(uint256 tokenId) public view returns (uint256) {
        if (seed == 0) revert NotRevealed();
        _requireOwned(tokenId);
        return _designAt(_shuffle(tokenId - 1));
    }

    /// @notice How many of a design are in the deck.
    function supplyOf(uint256 design) public pure returns (uint256) {
        if (design >= DESIGNS) revert BadDesign();
        // 5 commons of 120, 4 rares of 60, 2 rare rides of 40, 2 legendaries of 20, 3 Moonwedges of 13.
        if (design < 5) return 120;
        if (design < 9) return 60;
        if (design < 11) return 40;
        if (design < 13) return 20;
        return 13;
    }

    /// @dev Card `slot` of the unshuffled deck, dealt in design order.
    function _designAt(uint256 slot) private pure returns (uint256 design) {
        uint256 end;
        for (design = 0; design < DESIGNS; design++) {
            end += supplyOf(design);
            if (slot < end) return design;
        }
        revert BadDesign();
    }

    /// @dev A keyed shuffle of 0..998: a 4-round Feistel network on 10 bits (a permutation of 0..1023), repeated
    ///      until it lands inside the deck. Different inputs always give different outputs.
    function _shuffle(uint256 x) private view returns (uint256) {
        uint256 s = seed;
        do {
            uint256 l = x >> 5;
            uint256 r = x & 31;
            for (uint256 i = 0; i < 4; i++) {
                (l, r) = (r, l ^ (uint256(keccak256(abi.encode(s, i, r))) & 31));
            }
            x = (l << 5) | r;
        } while (x >= MAX_SUPPLY);
        return x;
    }

    // ---------------------------------------------------------------- metadata

    function designName(uint256 design) public pure returns (string memory) {
        string[16] memory names = [
            "Night Rider",
            "Chef",
            "Pirate",
            "Gardener",
            "Neon Scooter",
            "Astronaut",
            "Samurai Postman",
            "Robot Courier",
            "Ninja",
            "Hoverboard",
            "Neon Bike",
            "Golden Courier",
            "Hologram Courier",
            "Moonwedge Gold",
            "Moonwedge Rosso",
            "Moonwedge Neon"
        ];
        if (design >= DESIGNS) revert BadDesign();
        return names[design];
    }

    function rarityOf(uint256 design) public pure returns (string memory) {
        if (design >= DESIGNS) revert BadDesign();
        if (design < 5) return "Common";
        if (design < 11) return "Rare";
        return "Legendary";
    }

    /// @dev The image file for a design, as served under `imageBase`.
    function _key(uint256 design) private pure returns (string memory) {
        string[16] memory keys = [
            "nightrider",
            "chef",
            "pirate",
            "gardener",
            "scooter",
            "astronaut",
            "samurai",
            "robot",
            "ninja",
            "hoverboard",
            "neonbike",
            "golden",
            "hologram",
            "car-gold",
            "car-red",
            "car-violet"
        ];
        return keys[design];
    }

    function _isRide(uint256 design) private pure returns (bool) {
        return design == 4 || design == 9 || design == 10 || design >= 13;
    }

    /// @notice Metadata written on-chain; only the picture is fetched from `imageBase`.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory id = tokenId.toString();
        string memory json;
        if (seed == 0) {
            json = string.concat(
                '{"name":"Courier Skin #', id,
                '","description":"A sealed Courier Skin. Its design is revealed after the mint.","image":"',
                imageBase, 'mystery.png","attributes":[{"trait_type":"Status","value":"Sealed"}]}'
            );
        } else {
            uint256 d = _designAt(_shuffle(tokenId - 1));
            json = string.concat(
                '{"name":"', designName(d), " #", id,
                '","description":"A Courier Skin to wear in Courier World. Cosmetic only: it changes how you look, never what you earn.","image":"',
                imageBase, _key(d), '.png","attributes":[{"trait_type":"Design","value":"', designName(d),
                '"},{"trait_type":"Rarity","value":"', rarityOf(d),
                '"},{"trait_type":"Type","value":"', _isRide(d) ? "Ride" : "Outfit", '"}]}'
            );
        }
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice Every skin `owner` holds, so the game can list them without scanning event logs.
    function tokensOfOwner(address owner) external view returns (uint256[] memory ids) {
        uint256 n = balanceOf(owner);
        ids = new uint256[](n);
        uint256 found;
        for (uint256 id = 1; id <= totalMinted && found < n; id++) {
            if (_ownerOf(id) == owner) ids[found++] = id;
        }
    }

    // ---------------------------------------------------------------- royalty enforcement

    function getTransferValidator() external view returns (address) {
        return transferValidator;
    }

    function getTransferValidationFunction() external pure returns (bytes4 functionSignature, bool isViewFunction) {
        return (VALIDATE_TRANSFER, true);
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

    /// @dev Mints skip the check; every transfer between wallets goes through the validator.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            ITransferValidator721(transferValidator).validateTransfer(msg.sender, from, to, tokenId);
        }
        return super._update(to, tokenId, auth);
    }

    // ---------------------------------------------------------------- admin

    function setSaleOpen(bool open) external onlyOwner {
        if (seed != 0) revert AlreadyRevealed();
        saleOpen = open;
        emit SaleOpen(open);
    }

    function setPrice(uint256 price_) external onlyOwner {
        price = price_;
        emit PriceSet(price_);
    }

    /// @notice Moves mint payments and the royalty together. The 5% rate never changes.
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        _setDefaultRoyalty(treasury_, ROYALTY_BPS);
        emit TreasurySet(treasury_);
    }

    /// @notice Where the pictures live (ending in "/"), until frozen.
    function setImageBase(string calldata imageBase_) external onlyOwner {
        if (imagesFrozen) revert ImagesAreFrozen();
        imageBase = imageBase_;
        emit ImageBaseSet(imageBase_);
    }

    function freezeImages() external onlyOwner {
        imagesFrozen = true;
        emit ImagesFrozen();
    }

    /// @notice Only once the skins are revealed and their pictures frozen. The validator is then fixed for good.
    function renounceOwnership() public override onlyOwner {
        if (seed == 0 || !imagesFrozen) revert NotFinished();
        super.renounceOwnership();
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return interfaceId == type(ICreatorToken).interfaceId || super.supportsInterface(interfaceId);
    }
}
