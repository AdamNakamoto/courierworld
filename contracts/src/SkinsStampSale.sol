// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @notice What this sale needs from Courier Skins (contracts/src/CourierSkins.sol, already deployed).
interface ICourierSkinsMint {
    function price() external view returns (uint256);
    function totalMinted() external view returns (uint256);
    function mint(uint256 quantity) external payable;
    function transferFrom(address from, address to, uint256 tokenId) external;
}

/// @title Courier Skins for $STAMP
/// @notice Buy Courier Skins with $STAMP. Courier Skins itself only takes ETH, so this sale pays each skin's ETH
///         price from a float its owner keeps topped up (that ETH goes on to the treasury, as any mint's does),
///         takes the buyer's $STAMP to the treasury, and hands the buyer the skins. They're ordinary mints out of
///         the same 999, with the same 5% royalty enforced on every resale; nothing about Courier Skins changes.
/// @dev The float only ever pays Courier Skins' own `mint`, at its current price. The skins are minted to this
///      contract and moved straight on to the buyer in the same transaction (an owner moving its own token, which
///      Courier Skins' transfer validator allows); this contract never keeps one.
contract SkinsStampSale is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    ICourierSkinsMint public immutable skins;
    IERC20 public immutable stamp;
    /// @notice Where the $STAMP goes.
    address public treasury;
    /// @notice $STAMP per skin (18 decimals).
    uint256 public stampPrice;
    bool public open;

    event Bought(address indexed buyer, uint256 quantity, uint256 stampPaid, uint256 firstId);
    event StampPriceSet(uint256 stampPrice);
    event OpenSet(bool open);
    event TreasurySet(address indexed treasury);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error Closed();
    error ZeroPrice();
    error ZeroAddress();
    error NeedsTopUp();

    constructor(address owner_, address skins_, address stamp_, address treasury_, uint256 stampPrice_) Ownable(owner_) {
        if (skins_ == address(0) || stamp_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (stampPrice_ == 0) revert ZeroPrice();
        skins = ICourierSkinsMint(skins_);
        stamp = IERC20(stamp_);
        treasury = treasury_;
        stampPrice = stampPrice_;
        emit TreasurySet(treasury_);
        emit StampPriceSet(stampPrice_);
    }

    /// @notice The float: anyone can top it up by sending ETH here.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    // ---------------------------------------------------------------- buying

    /// @notice Buy `quantity` skins (1 to 10, as Courier Skins allows), paying `stampPrice` each in $STAMP. Approve
    ///         this contract for the $STAMP first, or use `buyWithPermit`.
    function buy(uint256 quantity) external nonReentrant {
        _buy(msg.sender, quantity);
    }

    /// @notice `buy`, with a signed permit for the $STAMP instead of an approval: one signature, one transaction.
    ///         If someone submits the permit first, the allowance it set is used all the same.
    function buyWithPermit(uint256 quantity, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        try IERC20Permit(address(stamp)).permit(msg.sender, address(this), stampPrice * quantity, deadline, v, r, s) {} catch {}
        _buy(msg.sender, quantity);
    }

    function _buy(address buyer, uint256 quantity) private {
        if (!open) revert Closed();
        uint256 ethCost = skins.price() * quantity;
        if (address(this).balance < ethCost) revert NeedsTopUp();
        uint256 stampCost = stampPrice * quantity;
        stamp.safeTransferFrom(buyer, treasury, stampCost);
        // Courier Skins checks its own sale, the quantity and the supply.
        uint256 first = skins.totalMinted() + 1;
        skins.mint{value: ethCost}(quantity);
        for (uint256 id = first; id < first + quantity; id++) {
            skins.transferFrom(address(this), buyer, id);
        }
        emit Bought(buyer, quantity, stampCost, first);
    }

    // ---------------------------------------------------------------- owner

    function setStampPrice(uint256 stampPrice_) external onlyOwner {
        if (stampPrice_ == 0) revert ZeroPrice();
        stampPrice = stampPrice_;
        emit StampPriceSet(stampPrice_);
    }

    function setOpen(bool open_) external onlyOwner {
        open = open_;
        emit OpenSet(open_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// @notice Take ETH back out of the float.
    function withdrawEth(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        Address.sendValue(to, amount);
        emit Withdrawn(address(0), to, amount);
    }

    /// @notice Return tokens sent here by mistake (this contract never holds any in normal use).
    function withdrawToken(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }
}
