// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { MembaFees } from "../src/lib/MembaFees.sol";

/// @title MembaFees — the consolidated fee formula (C-6)
/// @notice Pins `amount * bps / 10_000` so the single shared helper cannot drift from the
///         behaviour of the five call sites it replaced.
contract MembaFeesTest is Test {
    function test_ZeroBps() public pure {
        assertEq(MembaFees.feeOf(1 ether, 0), 0);
    }

    function test_ZeroAmount() public pure {
        assertEq(MembaFees.feeOf(0, 250), 0);
    }

    function test_FullBps() public pure {
        assertEq(MembaFees.feeOf(1 ether, 10_000), 1 ether); // 100%
    }

    function test_TypicalFees() public pure {
        assertEq(MembaFees.feeOf(1 ether, 100), 0.01 ether); // 1%
        assertEq(MembaFees.feeOf(1 ether, 250), 0.025 ether); // 2.5%
        assertEq(MembaFees.feeOf(1 ether, 500), 0.05 ether); // 5%
    }

    function test_TruncatesTowardZero() public pure {
        // 1 wei * 100 bps = 100 / 10_000 = 0.01 → truncates to 0 (favours the payer).
        assertEq(MembaFees.feeOf(1, 100), 0);
        // 199 * 100 / 10_000 = 1.99 → 1.
        assertEq(MembaFees.feeOf(199, 100), 1);
    }

    /// @dev The helper must equal the inline expression it replaced for any inputs that
    ///      cannot overflow.
    function testFuzz_MatchesInlineFormula(uint128 amount, uint16 bps) public pure {
        assertEq(MembaFees.feeOf(amount, bps), (uint256(amount) * bps) / 10_000);
    }
}
