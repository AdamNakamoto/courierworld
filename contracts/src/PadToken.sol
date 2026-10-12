// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title PadToken
/// @notice A token a player launched in Courier World's launchpad (CourierPad). Fixed supply of 1,000,000,000, all
///         minted once to the launchpad, which locks 95% in the token's Uniswap v4 pool and sends 5% to the
///         treasury for drops to players. A plain ERC-20 with EIP-2612 permit: no owner, no mint, no tax, no
///         blocklist. The 4% trading fee is taken by the pool's hook, not by the token.
contract PadToken is ERC20, ERC20Permit {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;

    /// @notice The launchpad that created the token and its pool.
    address public immutable pad;
    /// @notice The player who launched it.
    address public immutable creator;
    /// @notice The launcher's description, as JSON: {"image":"ipfs://…","description":"…","website":"…","x":"…","telegram":"…"}.
    string public metadata;

    constructor(string memory name_, string memory symbol_, string memory metadata_, address creator_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        pad = msg.sender;
        creator = creator_;
        metadata = metadata_;
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    /// @notice Nobody controls the token. (Explorers read this as renounced.)
    function owner() external pure returns (address) {
        return address(0);
    }
}
