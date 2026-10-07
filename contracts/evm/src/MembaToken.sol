// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.7.0
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract MembaToken is ERC20, ERC20Permit {
    constructor(address recipient)
        ERC20("MembaToken", "MBT")
        ERC20Permit("MembaToken")
    {
        _mint(recipient, 1000000 * 10 ** decimals());
    }
}
