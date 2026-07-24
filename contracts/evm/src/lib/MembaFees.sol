// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MembaFees
 * @author Samouraï Coop
 * @notice Single source of truth for basis-point fee math.
 * @dev `amount * bps / 10_000` was hand-rolled inline in five money paths (C-6). A fee
 *      formula duplicated across fund-handling contracts is exactly the kind of thing that
 *      drifts silently, so it lives here now — defined and tested in one place. The result
 *      is byte-identical to every call site it replaces (truncating division, which favours
 *      the payer on the remainder).
 */
library MembaFees {
    /// @dev Basis-point denominator: 10_000 bps = 100%.
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Returns `amount * bps / 10_000`, truncated.
    function feeOf(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return (amount * bps) / BPS_DENOMINATOR;
    }
}
