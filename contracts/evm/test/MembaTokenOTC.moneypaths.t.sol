// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { MembaTokenOTC } from "../src/commerce/MembaTokenOTC.sol";
import { MembaToken } from "../src/commerce/MembaToken.sol";
import { FeeOnTransferToken, RebasingToken, ReturnsFalseToken, NoDecimalsToken } from "./mocks/Tokens.sol";

/// @title MembaTokenOTC — money-path exploits (A-3 / A-4 / A-5)
/// @notice Each test reproduces a defect found by the independent audit on 2026-07-24.
///         Written against the unfixed contract and observed to fail first.
///
/// @dev Why the original 9-test suite missed all three: the fixture uses a faithful
///      `decimals = 0` token, so nothing exercised a fee-on-transfer/rebasing/returns-false
///      token (A-3), a token with decimals > 0 (A-4), or an out-of-range fee (A-5).
contract MembaTokenOTCMoneyPathsTest is Test {
    MembaTokenOTC public otc;

    address public adminAddr = makeAddr("admin");
    address public feeWallet = makeAddr("feeWallet");
    address public sellerA = makeAddr("sellerA");
    address public sellerB = makeAddr("sellerB");
    address public buyer = makeAddr("buyer");
    address public outsider = makeAddr("outsider");

    function setUp() public {
        MembaTokenOTC impl = new MembaTokenOTC();
        bytes memory initData = abi.encodeCall(MembaTokenOTC.initialize, (adminAddr, feeWallet, 100)); // 1%
        otc = MembaTokenOTC(address(new ERC1967Proxy(address(impl), initData)));

        vm.deal(buyer, 1000 ether);
    }

    // ══════════════════════════════════════════════════════════════
    // A-3 — fee-on-transfer / shared-pool cross-listing drain
    // ══════════════════════════════════════════════════════════════

    /// @notice The books must never claim more escrowed tokens than the contract holds.
    ///         Before the fix, `list` records the *requested* amount, but a fee-on-transfer
    ///         token delivers less, so two listings over-claim the pool.
    function test_A3_BooksNeverOverclaimContractBalance() public {
        FeeOnTransferToken fot = new FeeOnTransferToken(1000, 0); // 10% fee
        fot.mint(sellerA, 1000);
        fot.mint(sellerB, 1000);

        vm.startPrank(sellerA);
        fot.approve(address(otc), 1000);
        uint256 idA = otc.list(address(fot), 1000, 0.01 ether);
        vm.stopPrank();

        vm.startPrank(sellerB);
        fot.approve(address(otc), 1000);
        uint256 idB = otc.list(address(fot), 1000, 0.01 ether);
        vm.stopPrank();

        uint256 escrowedByBooks = otc.getListing(idA).totalAmount + otc.getListing(idB).totalAmount;
        assertLe(
            escrowedByBooks, fot.balanceOf(address(otc)), "listing books over-claim the contract's real token balance"
        );
    }

    /// @notice Concretely: filling seller A's listing must not leave seller B unable to
    ///         recover their own escrow. Before the fix, B's `cancel` reverts
    ///         `ERC20InsufficientBalance` — B was drained by a fill against A.
    function test_A3_FillingOneListingCannotDrainAnother() public {
        FeeOnTransferToken fot = new FeeOnTransferToken(1000, 0); // 10% fee
        fot.mint(sellerA, 1000);
        fot.mint(sellerB, 1000);

        vm.startPrank(sellerA);
        fot.approve(address(otc), 1000);
        uint256 idA = otc.list(address(fot), 1000, 0.01 ether);
        vm.stopPrank();

        vm.startPrank(sellerB);
        fot.approve(address(otc), 1000);
        uint256 idB = otc.list(address(fot), 1000, 0.01 ether);
        vm.stopPrank();

        // Buyer fully fills A (whatever the books say is available for A).
        uint256 availA = otc.getListing(idA).totalAmount;
        uint256 cost = availA * otc.getListing(idA).unitPrice;
        vm.prank(buyer);
        otc.fill{ value: cost }(idA, availA);

        // Seller B must still be able to cancel and recover B's escrow.
        vm.prank(sellerB);
        otc.cancel(idB); // reverts ERC20InsufficientBalance before the fix
    }

    /// @notice A token that returns `false` (never reverts) must not create a phantom
    ///         listing; SafeERC20 turns the false into a revert.
    function test_A3_ReturnsFalseTokenCannotCreatePhantomListing() public {
        ReturnsFalseToken rft = new ReturnsFalseToken();
        rft.mint(sellerA, 1000);

        vm.startPrank(sellerA);
        rft.approve(address(otc), 1000);
        vm.expectRevert(); // SafeERC20FailedOperation
        otc.list(address(rft), 1000, 0.01 ether);
        vm.stopPrank();
    }

    /// @notice `list` records the balance actually credited, so a rebase that inflates the
    ///         supply strands the surplus but never lets the books over-claim. (A downward
    ///         rebase is an inherent limitation of the shared pool — see BACKLOG C-6 notes.)
    function test_A3_RebasingTokenListRecordsCreditedBalance() public {
        RebasingToken rbs = new RebasingToken(0);
        rbs.mint(sellerA, 1000);

        vm.startPrank(sellerA);
        rbs.approve(address(otc), 1000);
        uint256 id = otc.list(address(rbs), 1000, 0.01 ether);
        vm.stopPrank();

        assertEq(otc.getListing(id).totalAmount, rbs.balanceOf(address(otc)), "records credited balance");

        rbs.setFactorBps(12_000); // +20% rebase up
        assertLe(otc.getListing(id).totalAmount, rbs.balanceOf(address(otc)), "books never over-claim after rebase");
    }

    /// @notice A token that confiscates the entire transfer (nothing received) must not
    ///         create a listing that claims escrow it does not hold.
    function test_A3_FullyConfiscatingTokenCannotCreateListing() public {
        FeeOnTransferToken fot = new FeeOnTransferToken(10_000, 0); // 100% fee → 0 received
        fot.mint(sellerA, 1000);

        vm.startPrank(sellerA);
        fot.approve(address(otc), 1000);
        vm.expectRevert(MembaTokenOTC.InvalidParams.selector);
        otc.list(address(fot), 1000, 0.01 ether);
        vm.stopPrank();
    }

    // ══════════════════════════════════════════════════════════════
    // A-4 — decimals-unaware unitPrice (EVM twin of memba#992)
    // ══════════════════════════════════════════════════════════════

    /// @notice A seller listing "100 whole tokens at 1 ETH each" must be fillable at
    ///         1 ETH per whole token. Before the fix, `unitPrice` is per *base unit*, so
    ///         one whole token (1e18 base units) costs 1e18 ETH — unfillable.
    function test_A4_WholeTokenPricingIsFillable() public {
        MembaToken t18 = new MembaToken("Deci", "DEC", 18, 1_000_000 ether, sellerA);
        uint256 amount = 100 * 10 ** 18; // 100 whole tokens, base units
        uint256 pricePerWhole = 1 ether; // wei per whole token

        vm.startPrank(sellerA);
        t18.approve(address(otc), amount);
        uint256 id = otc.list(address(t18), amount, pricePerWhole);
        vm.stopPrank();

        uint256 qty = 1 * 10 ** 18; // buy 1 whole token
        vm.prank(buyer);
        otc.fill{ value: 1 ether }(id, qty); // exactly 1 ETH — reverts InsufficientPayment before fix

        assertEq(t18.balanceOf(buyer), qty, "buyer received 1 whole token");
    }

    /// @notice Rounding must never favour the buyer: a sub-unit purchase rounds the cost up.
    function test_A4_CostRoundsUpNeverFavoursBuyer() public {
        MembaToken t18 = new MembaToken("Deci", "DEC", 18, 1_000_000 ether, sellerA);
        uint256 amount = 100 * 10 ** 18;
        uint256 pricePerWhole = 3; // 3 wei per whole token

        vm.startPrank(sellerA);
        t18.approve(address(otc), amount);
        uint256 id = otc.list(address(t18), amount, pricePerWhole);
        vm.stopPrank();

        // Buying 1 base unit: exact cost = 3 * 1 / 1e18 = 0.000…3 wei → must round up to 1.
        uint256 balBefore = buyer.balance;
        vm.prank(buyer);
        otc.fill{ value: 1 ether }(id, 1); // overpay; contract refunds the excess

        assertEq(balBefore - buyer.balance, 1, "sub-unit purchase must cost at least 1 wei");
    }

    /// @notice A token without the optional `decimals()` extension falls back to
    ///         per-base-unit pricing (decimals = 0) instead of reverting the listing.
    function test_A4_NoDecimalsTokenFallsBackToPerBaseUnit() public {
        NoDecimalsToken t = new NoDecimalsToken();
        t.mint(sellerA, 1000);

        vm.startPrank(sellerA);
        t.approve(address(otc), 1000);
        uint256 id = otc.list(address(t), 1000, 0.01 ether);
        vm.stopPrank();

        assertEq(otc.getListing(id).tokenDecimals, 0, "missing decimals() snapshots as 0");

        // decimals = 0 → cost is qty * unitPrice, exactly the legacy per-base-unit rule.
        uint256 cost = 100 * 0.01 ether;
        vm.prank(buyer);
        otc.fill{ value: cost }(id, 100);
        assertEq(t.balanceOf(buyer), 100);
    }

    // ══════════════════════════════════════════════════════════════
    // A-5 — unbounded feeBps (no MAX_FEE_BPS, no setter)
    // ══════════════════════════════════════════════════════════════

    /// @notice A fee above the cap must be rejected at init, so a fat-fingered deploy
    ///         parameter cannot brick the desk permanently.
    function test_A5_InitRejectsFeeAboveCap() public {
        MembaTokenOTC impl = new MembaTokenOTC();
        bytes memory bad = abi.encodeCall(MembaTokenOTC.initialize, (adminAddr, feeWallet, 2001));
        vm.expectRevert(MembaTokenOTC.InvalidFeeBps.selector);
        new ERC1967Proxy(address(impl), bad);
    }

    function test_A5_InitAcceptsFeeAtCap() public {
        MembaTokenOTC impl = new MembaTokenOTC();
        bytes memory ok = abi.encodeCall(MembaTokenOTC.initialize, (adminAddr, feeWallet, 2000));
        MembaTokenOTC capped = MembaTokenOTC(address(new ERC1967Proxy(address(impl), ok)));
        assertEq(capped.platformFeeBps(), 2000);
    }

    function test_A5_SetPlatformFeeWithinCap() public {
        vm.prank(adminAddr);
        otc.setPlatformFee(500);
        assertEq(otc.platformFeeBps(), 500);
    }

    function test_A5_SetPlatformFeeAboveCapReverts() public {
        vm.prank(adminAddr);
        vm.expectRevert(MembaTokenOTC.InvalidFeeBps.selector);
        otc.setPlatformFee(2001);
    }

    function test_A5_SetPlatformFeeNonAdminReverts() public {
        vm.prank(outsider);
        vm.expectRevert(MembaTokenOTC.NotAdmin.selector);
        otc.setPlatformFee(100);
    }
}
