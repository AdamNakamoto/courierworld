// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev A local chain's stand-in for a partner token (./dev.sh): a plain ERC-20, all of it minted to `to`.
contract DevPartnerToken is ERC20 {
    constructor(address to) ERC20("Partner Test", "PART") {
        _mint(to, 10_000_000e18);
    }
}
