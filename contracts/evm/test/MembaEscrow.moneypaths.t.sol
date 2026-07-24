// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { MembaEscrow } from "../src/commerce/MembaEscrow.sol";
import { RevertingReceiver, NoReceive, ReentrantReceiver } from "./mocks/Receivers.sol";

/// @title MembaEscrow — money-path exploits
/// @notice Each test here reproduces a defect found by independent audit on 2026-07-24.
///         They were written against the unfixed contract and observed to fail first.
///
/// @dev Why the original 26-test suite missed all of this:
///      - `cancelContract` was only ever tested with the BUYER as canceller, and
///        `test_CancelContract_RefundsAndReleases` asserts the exploit payout as
///        correct behaviour.
///      - `claimAutoRefund` was only tested on an Active contract.
///      - Every actor was an EOA, so no `TransferFailed` branch was ever executed.
contract MembaEscrowMoneyPathsTest is Test {
    MembaEscrow public escrow;

    address public adminAddr = makeAddr("admin");
    address public feeWallet = makeAddr("feeWallet");
    address public buyer = makeAddr("buyer");
    address public seller = makeAddr("seller");

    uint16 public constant PLATFORM_FEE = 200; // 2%
    uint16 public constant CANCEL_FEE = 500; // 5%
    uint256 public constant AUTO_REFUND = 30 days;

    function setUp() public {
        MembaEscrow impl = new MembaEscrow();
        bytes memory initData =
            abi.encodeCall(MembaEscrow.initialize, (adminAddr, feeWallet, PLATFORM_FEE, CANCEL_FEE, AUTO_REFUND));
        escrow = MembaEscrow(address(new ERC1967Proxy(address(impl), initData)));

        vm.deal(buyer, 100 ether);
        vm.deal(seller, 10 ether);
        // Foundry starts at timestamp 1; the auto-refund clock needs headroom.
        vm.warp(1_000_000);
    }

    function _create(address buyer_, address seller_) internal returns (uint256 id) {
        string[] memory titles = new string[](2);
        titles[0] = "Milestone A";
        titles[1] = "Milestone B";
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 10 ether;
        amounts[1] = 20 ether;
        vm.prank(buyer_);
        id = escrow.createContract(seller_, "Project", titles, amounts);
    }

    function _createAndFundBoth() internal returns (uint256 id) {
        id = _create(buyer, seller);
        vm.prank(buyer);
        escrow.fundMilestone{ value: 10 ether }(id, 0);
        vm.prank(buyer);
        escrow.fundMilestone{ value: 20 ether }(id, 1);
    }

    // ══════════════════════════════════════════════════════════
    // C-01 — CRITICAL: seller takes 100% of escrowed ETH, fee-free
    // ══════════════════════════════════════════════════════════

    /// `completeMilestone` is a unilateral seller assertion (only gate:
    /// `msg.sender == sc.seller`). `cancelContract` accepts either party and its
    /// Completed branch pays the seller in full with NO fee. So the seller
    /// self-certifies every milestone, cancels, and leaves with everything.
    function test_C01_SellerCannotSelfCompleteThenCancelToDrainEscrow() public {
        uint256 id = _createAndFundBoth();
        uint256 sellerBefore = seller.balance;

        uint256 buyerBefore = buyer.balance;

        vm.startPrank(seller);
        escrow.completeMilestone(id, 0);
        escrow.completeMilestone(id, 1);
        // The seller is allowed to walk away — but walking away must not pay them.
        // Self-certified work that the buyer never accepted goes back to the buyer;
        // if the seller believes it is owed, the remedy is dispute().
        escrow.cancelContract(id);
        vm.stopPrank();

        assertEq(seller.balance, sellerBefore, "seller paid itself by self-completing then cancelling");
        assertGt(buyer.balance, buyerBefore, "buyer was not refunded");
    }

    /// Even without cancelling, marking milestones Completed must not strip the
    /// buyer's auto-refund protection — that would let a seller freeze funds
    /// indefinitely by doing nothing else.
    function test_C01b_SelfCompleteDoesNotVoidBuyerAutoRefund() public {
        uint256 id = _createAndFundBoth();

        vm.prank(seller);
        escrow.completeMilestone(id, 0);

        vm.warp(block.timestamp + AUTO_REFUND + 1);

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        escrow.claimAutoRefund(id, 0);
        assertGt(buyer.balance, buyerBefore, "buyer lost auto-refund protection to a self-completion");
    }

    // ══════════════════════════════════════════════════════════
    // H-02 — HIGH: claimAutoRefund ignores the dispute freeze
    // ══════════════════════════════════════════════════════════

    /// `claimAutoRefund` checks buyer, index, milestone status and timeout — but
    /// never `sc.status`, unlike every other fund-mover. A buyer disputes, waits
    /// out the clock, and drains the contract before the admin can arbitrate.
    function test_H02_AutoRefundIsBlockedWhileDisputed() public {
        uint256 id = _createAndFundBoth();

        vm.prank(seller);
        escrow.completeMilestone(id, 0);
        vm.prank(buyer);
        escrow.dispute(id);

        vm.warp(block.timestamp + AUTO_REFUND + 1);

        vm.prank(buyer);
        vm.expectRevert();
        escrow.claimAutoRefund(id, 1);
    }

    /// The arbiter's ruling must actually be payable — i.e. the disputed funds are
    /// still there when `resolveDispute` runs.
    function test_H02b_ArbitrationStillHasFundsToAward() public {
        uint256 id = _createAndFundBoth();

        vm.prank(buyer);
        escrow.dispute(id);
        vm.warp(block.timestamp + AUTO_REFUND + 1);

        // Whatever the buyer can or cannot do while disputed, the admin ruling for
        // the seller must not resolve into a zero payout.
        uint256 sellerBefore = seller.balance;
        vm.prank(adminAddr);
        escrow.resolveDispute(id, true);
        assertGt(seller.balance, sellerBefore, "arbitration awarded nothing - funds were already drained");
    }

    // ══════════════════════════════════════════════════════════
    // H-03 — HIGH: a hostile recipient freezes funds permanently
    // ══════════════════════════════════════════════════════════

    /// Every payout is a push (`.call{value:}` + `revert TransferFailed`). A seller
    /// that is a contract can flip `receive()` to revert and hold the buyer hostage:
    /// release, cancel and resolveDispute all abort, and auto-refund is unreachable
    /// once the milestone is Completed.
    function test_H03_HostileSellerCannotFreezeBuyerFunds() public {
        RevertingReceiver hostile = new RevertingReceiver();
        uint256 id = _create(buyer, address(hostile));

        vm.prank(buyer);
        escrow.fundMilestone{ value: 10 ether }(id, 0);

        hostile.call(address(escrow), abi.encodeCall(MembaEscrow.completeMilestone, (id, 0)));
        hostile.setRejecting(true);

        // The buyer must retain a unilateral exit that a hostile counterparty cannot
        // veto. Previously every route out pushed ETH to the seller and reverted with
        // TransferFailed, so the contract was frozen with the funds inside it.
        vm.prank(buyer);
        escrow.cancelContract(id);

        // The 2% platform fee reached the (accepting) fee wallet; the seller's 9.8
        // ETH net stayed behind as a credit rather than reverting the whole cancel.
        uint256 sellerNet = 10 ether - (10 ether * uint256(PLATFORM_FEE)) / 10_000;
        assertEq(address(escrow).balance, sellerNet, "escrow should still custody the credited payout");
        // The seller's money is not lost — it is credited for them to pull once they
        // stop rejecting — but their refusal no longer blocks anyone else.
        hostile.setRejecting(false);
        uint256 hostileBefore = address(hostile).balance;
        hostile.call(address(escrow), abi.encodeCall(MembaEscrow.withdraw, ()));
        assertGt(address(hostile).balance, hostileBefore, "credited payout was not withdrawable");
        assertEq(address(escrow).balance, 0, "escrow retained funds after withdrawal");
    }

    /// A reverting `feeRecipient` must not brick releases protocol-wide, and there
    /// must be a way to change it.
    function test_H03b_RevertingFeeRecipientDoesNotBrickReleases() public {
        RevertingReceiver badFee = new RevertingReceiver();

        // Called low-level on purpose: `setFeeRecipient` does not exist on the
        // unfixed contract, and its absence IS the defect — a compromised or
        // destroyed fee recipient would otherwise brick every release forever with
        // no recovery short of an upgrade. Asserting on the call result keeps this
        // a runtime failure rather than a compile error.
        vm.prank(adminAddr);
        (bool ok,) = address(escrow).call(abi.encodeWithSignature("setFeeRecipient(address)", address(badFee)));
        assertTrue(ok, "no setFeeRecipient: a reverting fee recipient is unrecoverable");
        badFee.setRejecting(true);

        uint256 id = _createAndFundBoth();
        vm.prank(seller);
        escrow.completeMilestone(id, 0);

        uint256 sellerBefore = seller.balance;
        vm.prank(buyer);
        escrow.releaseFunds(id, 0);
        assertGt(seller.balance, sellerBefore, "a reverting fee recipient blocked an unrelated release");
    }

    // ══════════════════════════════════════════════════════════
    // M-11 — updateTimeouts applies retroactively, unbounded
    // ══════════════════════════════════════════════════════════

    /// The auto-refund deadline is computed as `fundedAt + $.autoRefundTimeout`,
    /// read at claim time. An admin setting 0 therefore makes every already-funded
    /// milestone instantly refundable, stripping the seller's protection after the
    /// fact.
    function test_M11_TimeoutChangeDoesNotApplyRetroactively() public {
        uint256 id = _createAndFundBoth();

        // Shorten the global window to the minimum. Milestones funded under the old
        // 30-day terms must keep them.
        vm.prank(adminAddr);
        escrow.updateTimeouts(1 days);

        vm.warp(block.timestamp + 2 days);

        vm.prank(buyer);
        vm.expectRevert(MembaEscrow.AutoRefundNotReady.selector);
        escrow.claimAutoRefund(id, 0);
    }

    /// The window is also bounded, so it cannot be set to zero at all.
    function test_M11b_TimeoutIsBounded() public {
        vm.prank(adminAddr);
        vm.expectRevert(MembaEscrow.InvalidParams.selector);
        escrow.updateTimeouts(0);

        vm.prank(adminAddr);
        vm.expectRevert(MembaEscrow.InvalidParams.selector);
        escrow.updateTimeouts(400 days);
    }

    // ══════════════════════════════════════════════════════════
    // M-12 — buyer evades the cancellation fee via dispute
    // ══════════════════════════════════════════════════════════

    /// `cancelContract` charges `cancellationFeeBps`, but `resolveDispute(false)`
    /// refunds 100%. Combined with C-01 on the seller side, neither party ever has
    /// to pay a fee and the escrow's revenue model is optional.
    function test_M12_DisputeRefundStillCollectsTheCancellationFee() public {
        uint256 id = _createAndFundBoth();

        vm.prank(buyer);
        escrow.dispute(id);

        uint256 feeBefore = feeWallet.balance;
        vm.prank(adminAddr);
        escrow.resolveDispute(id, false);

        assertGt(feeWallet.balance, feeBefore, "buyer refunded in full, evading the cancellation fee");
    }

    // ══════════════════════════════════════════════════════════
    // L-21 — reentrancy hygiene on the two unguarded mutators
    // ══════════════════════════════════════════════════════════

    /// `completeMilestone` and `dispute` are the only state-mutating functions
    /// without `nonReentrant`, and both are reachable from inside a push payment.
    function test_L21_DisputeCannotBeReenteredFromAPayout() public {
        ReentrantReceiver attacker = new ReentrantReceiver();
        uint256 id = _create(buyer, address(attacker));

        vm.prank(buyer);
        escrow.fundMilestone{ value: 10 ether }(id, 0);
        attacker.call(address(escrow), abi.encodeCall(MembaEscrow.completeMilestone, (id, 0)));

        attacker.arm(address(escrow), abi.encodeCall(MembaEscrow.dispute, (id)));

        vm.prank(buyer);
        escrow.releaseFunds(id, 0);

        MembaEscrow.ServiceContract memory sc = escrow.getContract(id);
        assertTrue(
            uint8(sc.status) != uint8(MembaEscrow.ContractStatus.Disputed),
            "a payout re-entered dispute() and left orphaned dispute state"
        );
    }

    // ══════════════════════════════════════════════════════════
    // Solvency — the invariant that catches the whole class
    // ══════════════════════════════════════════════════════════

    /// Contract ETH must equal the sum of milestones still held (Funded or
    /// Completed). Any double-pay, missed refund or silent drain breaks this.
    function test_Solvency_HoldsAcrossAFullLifecycle() public {
        uint256 id = _createAndFundBoth();
        assertEq(address(escrow).balance, 30 ether, "post-funding");

        vm.prank(seller);
        escrow.completeMilestone(id, 0);
        assertEq(address(escrow).balance, 30 ether, "completion moves no ETH");

        vm.prank(buyer);
        escrow.releaseFunds(id, 0);
        assertEq(address(escrow).balance, 20 ether, "release paid out exactly one milestone");

        vm.prank(buyer);
        escrow.cancelContract(id);
        assertEq(address(escrow).balance, 0, "cancel left ETH stranded in the contract");
    }
}
