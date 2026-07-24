// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MembaAccessControl
 * @author Samouraï Coop
 * @notice Shared role-based access control patterns for Memba contracts.
 *         Provides modifiers and helpers for OWNER / ADMIN / MEMBER role checks.
 *
 * TODO: Implement shared access patterns used across multiple Memba contracts.
 */
abstract contract MembaAccessControl {
    // ── Errors
    // ────────────────────────────────────────────────────
    error Unauthorized();
    error InvalidAddress();

    /// @notice Revert if `addr` is the zero address.
    modifier nonZeroAddress(address addr) {
        if (addr == address(0)) revert InvalidAddress();
        _;
    }
}
