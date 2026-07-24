// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MembaToken
 * @author Samouraï Coop
 * @notice ERC-20 token deployed by MembaTokenFactory.
 *         Supports admin mint and ERC-2612 Permit (gasless approvals).
 */
contract MembaToken is ERC20, ERC20Permit, Ownable {
    uint8 private immutable _tokenDecimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply,
        address tokenAdmin
    ) ERC20(name_, symbol_) ERC20Permit(name_) Ownable(tokenAdmin) {
        _tokenDecimals = decimals_;
        if (initialSupply > 0) {
            _mint(tokenAdmin, initialSupply);
        }
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }
}
