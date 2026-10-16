// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IDropsPad} from "./TokenDrops.sol";

/// @title Drops token list
/// @notice What a second TokenDrops instance asks where the first asks the launchpad: whether a token may be dropped.
///         Tokens launched on the launchpad still count (it asks the launchpad for those), and the owner can approve
///         others too, such as a partner project's token ($MINE). TokenDrops only reads `launches(token).createdAt`,
///         and only in createDrop; an approved token answers with createdAt 1 and nothing else.
/// @dev Trust: the owner (the treasury, which also owns the drops) decides which tokens can be dropped. Approving a
///      token never moves anything: drops are still funded by the drops' owner, from its own tokens. Removing a token
///      stops new drops of it; drops already running carry on.
contract DropsTokenList is IDropsPad, Ownable2Step {
    IDropsPad public immutable pad;
    /// @notice Tokens the owner approved, besides the launchpad's.
    mapping(address token => bool) public approved;

    event TokenApproved(address indexed token, bool approved);

    error ZeroAddress();
    error CannotRenounce();

    constructor(address owner_, IDropsPad pad_, address[] memory tokens) Ownable(owner_) {
        if (address(pad_) == address(0)) revert ZeroAddress();
        pad = pad_;
        for (uint256 i; i < tokens.length; ++i) _approve(tokens[i], true);
    }

    /// @notice Approve a token for drops (or stop approving it).
    function setApproved(address token, bool ok) external onlyOwner {
        _approve(token, ok);
    }

    function _approve(address token, bool ok) private {
        if (token == address(0)) revert ZeroAddress();
        approved[token] = ok;
        emit TokenApproved(token, ok);
    }

    /// @notice The launchpad's record for `token`, or, for an approved token, one that says it can be dropped
    ///         (createdAt 1).
    function launches(address token)
        external
        view
        returns (address quote, address creator, uint64 createdAt, uint64 createdBlock, bool quoteIsCurrency0)
    {
        if (approved[token]) return (address(0), address(0), 1, 0, false);
        return pad.launches(token);
    }

    /// @notice Ownership can only be handed over, never renounced (the list would freeze).
    function renounceOwnership() public view override onlyOwner {
        revert CannotRenounce();
    }
}
