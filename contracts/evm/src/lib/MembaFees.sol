// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MembaFees
 * @author Samouraï Coop
 * @notice Fee calculation and distribution logic shared across Memba commerce contracts.
 *         All fees are expressed in basis points (1 bps = 0.01%).
 *
 *         Standard fee: 250 bps = 2.5% (token mint, NFT marketplace)
 *         Escrow fee: 200 bps = 2.0% (service escrow)
 *
 * @dev Inheriting contracts call `_collectFee()` to split platform fees.
 *      No floating point — integer math only.
 */
abstract contract MembaFees {
    // ── Constants ─────────────────────────────────────────────────
    uint16 internal constant BPS_DENOMINATOR = 10_000;

    // ── Errors ────────────────────────────────────────────────────
    error FeeTransferFailed();
    error InvalidFeeBps();

    /**
     * @notice Calculate and transfer the platform fee from `amount`.
     * @param amount The gross amount to deduct the fee from.
     * @param feeBps Fee in basis points (e.g. 250 = 2.5%).
     * @param recipient The fee recipient (Samouraï Coop Safe).
     * @return netAmount The amount remaining after fee deduction.
     */
    function _collectFee(uint256 amount, uint16 feeBps, address recipient)
        internal
        returns (uint256 netAmount)
    {
        if (feeBps > BPS_DENOMINATOR) revert InvalidFeeBps();
        if (feeBps == 0 || amount == 0) return amount;

        uint256 fee = (amount * feeBps) / BPS_DENOMINATOR;
        netAmount = amount - fee;

        (bool ok,) = recipient.call{ value: fee }("");
        if (!ok) revert FeeTransferFailed();
    }
}
