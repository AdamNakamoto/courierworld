// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

interface ICourierRenderer {
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

/// @title CourierNFT
/// @notice 3,333 couriers. Traits come from keccak256(abi.encode(seed, id)); the
///         contract only reads the ride (it sets delivery power in the game), the
///         rest is art. The seed is committed before the mint and revealed after it,
///         so nobody can pick rare couriers while minting.
contract CourierNFT is ERC721, ERC2981, Ownable {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 3333;
    uint256 public constant MAX_PER_TX = 10;

    uint256 public price;
    bool public saleOpen;
    uint256 public totalMinted;
    address public treasury;
    address public game;

    bytes32 public immutable seedCommit;
    uint256 public seed; // 0 until revealed

    /// @notice On-chain art and metadata. When set, tokenURI comes entirely from it.
    ICourierRenderer public renderer;
    bool public rendererFrozen;
    string public baseURI;
    string public unrevealedURI;
    mapping(uint256 tokenId => bool) public locked;

    event Revealed(uint256 seed);
    event SaleOpen(bool open);
    event GameSet(address indexed game);
    event RendererSet(address indexed renderer);
    event RendererFrozen();

    error SaleClosed();
    error BadQuantity();
    error SoldOut();
    error WrongPayment();
    error NotRevealed();
    error AlreadyRevealed();
    error BadSecret();
    error SaleStillOpen();
    error NotGame();
    error GameAlreadySet();
    error ZeroAddress();
    error CourierOnDuty(uint256 tokenId);
    error RendererIsFrozen();

    constructor(address owner_, address treasury_, uint256 price_, bytes32 seedCommit_)
        ERC721("Courier", "COURIER")
        Ownable(owner_)
    {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        price = price_;
        seedCommit = seedCommit_;
        _setDefaultRoyalty(treasury_, 500);
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
    }

    // ---------------------------------------------------------------- reveal

    /// @notice Close the sale for good and fix the traits. The committed secret is
    ///         mixed with a recent blockhash so the owner can't pre-compute them either.
    function reveal(uint256 secret) external onlyOwner {
        if (seed != 0) revert AlreadyRevealed();
        if (saleOpen) revert SaleStillOpen();
        if (keccak256(abi.encode(secret)) != seedCommit) revert BadSecret();
        uint256 s = uint256(keccak256(abi.encode(secret, blockhash(block.number - 1))));
        seed = s == 0 ? 1 : s;
        emit Revealed(seed);
    }

    /// @notice 0 On Foot, 1 Skateboard, 2 Bicycle, 3 Moped, 4 Paper Plane.
    ///         Weights out of 10,000 (45 / 25 / 17 / 9 / 4%) match traits.js.
    function rideOf(uint256 tokenId) public view returns (uint8) {
        if (seed == 0) revert NotRevealed();
        _requireOwned(tokenId);
        uint256 r = uint256(keccak256(abi.encode(seed, tokenId))) % 10_000;
        if (r < 4500) return 0;
        if (r < 7000) return 1;
        if (r < 8700) return 2;
        if (r < 9600) return 3;
        return 4;
    }

    /// @notice Every courier `owner` holds, so the game can list them without scanning event logs.
    function tokensOfOwner(address owner) external view returns (uint256[] memory ids) {
        uint256 n = balanceOf(owner);
        ids = new uint256[](n);
        uint256 found;
        for (uint256 id = 1; id <= totalMinted && found < n; id++) {
            if (_ownerOf(id) == owner) ids[found++] = id;
        }
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (address(renderer) != address(0)) return renderer.tokenURI(tokenId);
        if (seed == 0) return unrevealedURI;
        return string.concat(baseURI, tokenId.toString(), ".json");
    }

    // ---------------------------------------------------------------- game hooks

    /// @notice One-shot: the post office contract that may lock couriers on duty.
    function setGame(address game_) external onlyOwner {
        if (game != address(0)) revert GameAlreadySet();
        if (game_ == address(0)) revert ZeroAddress();
        game = game_;
        emit GameSet(game_);
    }

    /// @notice Couriers on duty can't be sold out from under the reward accounting.
    function setLocked(uint256 tokenId, bool value) external {
        if (msg.sender != game) revert NotGame();
        locked[tokenId] = value;
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (locked[tokenId]) revert CourierOnDuty(tokenId);
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
    }

    function setRenderer(ICourierRenderer renderer_) external onlyOwner {
        if (rendererFrozen) revert RendererIsFrozen();
        renderer = renderer_;
        emit RendererSet(address(renderer_));
    }

    /// @notice Lock the on-chain renderer forever: the art can never be changed again.
    function freezeRenderer() external onlyOwner {
        rendererFrozen = true;
        emit RendererFrozen();
    }

    function setBaseURI(string calldata uri) external onlyOwner {
        baseURI = uri;
    }

    function setUnrevealedURI(string calldata uri) external onlyOwner {
        unrevealedURI = uri;
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
    }

    function setRoyalty(address receiver, uint96 bps) external onlyOwner {
        _setDefaultRoyalty(receiver, bps);
    }

    function withdraw() external onlyOwner {
        Address.sendValue(payable(treasury), address(this).balance);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
