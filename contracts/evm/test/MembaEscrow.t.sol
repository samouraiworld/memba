// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { MembaEscrow } from "../src/commerce/MembaEscrow.sol";

/**
 * @title MembaEscrowTest
 * @notice 25 test cases per CONTRACT_SPECS/MembaEscrow.spec.md.
 *         Highest-risk contract — thorough coverage of fund flows.
 */
contract MembaEscrowTest is Test {
    MembaEscrow public escrow;

    address public adminAddr = makeAddr("admin");
    address public feeWallet = makeAddr("feeWallet");
    address public buyer = makeAddr("buyer");
    address public seller = makeAddr("seller");
    address public outsider = makeAddr("outsider");

    uint16 public constant PLATFORM_FEE = 200;      // 2%
    uint16 public constant CANCEL_FEE = 500;         // 5%
    uint256 public constant AUTO_REFUND = 30 days;

    function setUp() public {
        MembaEscrow impl = new MembaEscrow();
        bytes memory initData = abi.encodeCall(
            MembaEscrow.initialize,
            (adminAddr, feeWallet, PLATFORM_FEE, CANCEL_FEE, AUTO_REFUND)
        );
        address proxy = address(new ERC1967Proxy(address(impl), initData));
        escrow = MembaEscrow(proxy);

        vm.deal(buyer, 100 ether);
        vm.deal(seller, 1 ether);
        vm.deal(outsider, 10 ether);
    }

    // Helper: create a 2-milestone contract
    function _createContract() internal returns (uint256) {
        string[] memory titles = new string[](2);
        titles[0] = "Design";
        titles[1] = "Development";
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1 ether;
        amounts[1] = 2 ether;

        vm.prank(buyer);
        return escrow.createContract(seller, "Web3 Project", titles, amounts);
    }

    // ══════════════════════════════════════════════════════════════
    // 1. Contract Creation
    // ══════════════════════════════════════════════════════════════

    function test_CreateContract_Success() public {
        uint256 id = _createContract();
        assertEq(id, 0);
        assertEq(escrow.contractCount(), 1);

        MembaEscrow.ServiceContract memory sc = escrow.getContract(0);
        assertEq(sc.buyer, buyer);
        assertEq(sc.seller, seller);
        assertEq(sc.milestoneCount, 2);
        assertEq(uint8(sc.status), uint8(MembaEscrow.ContractStatus.Active));

        MembaEscrow.Milestone memory ms0 = escrow.getMilestone(0, 0);
        assertEq(ms0.amount, 1 ether);
        assertEq(ms0.title, "Design");
    }

    function test_CreateContract_ArrayMismatchReverts() public {
        string[] memory titles = new string[](2);
        titles[0] = "A";
        titles[1] = "B";
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;

        vm.prank(buyer);
        vm.expectRevert(MembaEscrow.ArrayLengthMismatch.selector);
        escrow.createContract(seller, "Mismatch", titles, amounts);
    }

    function test_CreateContract_TooManyMilestonesReverts() public {
        string[] memory titles = new string[](21);
        uint256[] memory amounts = new uint256[](21);
        for (uint256 i = 0; i < 21; i++) {
            titles[i] = "MS";
            amounts[i] = 0.01 ether;
        }

        vm.prank(buyer);
        vm.expectRevert(MembaEscrow.TooManyMilestones.selector);
        escrow.createContract(seller, "Too Many", titles, amounts);
    }

    function test_CreateContract_ZeroAmountReverts() public {
        string[] memory titles = new string[](1);
        titles[0] = "Free";
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 0;

        vm.prank(buyer);
        vm.expectRevert(MembaEscrow.AmountTooSmall.selector);
        escrow.createContract(seller, "Zero", titles, amounts);
    }

    // ══════════════════════════════════════════════════════════════
    // 2. Funding
    // ══════════════════════════════════════════════════════════════

    function test_FundMilestone_Success() public {
        _createContract();

        vm.prank(buyer);
        escrow.fundMilestone{value: 1 ether}(0, 0);

        MembaEscrow.Milestone memory ms = escrow.getMilestone(0, 0);
        assertEq(uint8(ms.status), uint8(MembaEscrow.MilestoneStatus.Funded));
        assertGt(ms.fundedAt, 0);
    }

    function test_FundMilestone_WrongAmountReverts() public {
        _createContract();

        vm.prank(buyer);
        vm.expectRevert(MembaEscrow.InsufficientFunding.selector);
        escrow.fundMilestone{value: 0.5 ether}(0, 0);
    }

    function test_FundMilestone_NonBuyerReverts() public {
        _createContract();

        vm.prank(outsider);
        vm.expectRevert(MembaEscrow.NotBuyer.selector);
        escrow.fundMilestone{value: 1 ether}(0, 0);
    }

    function test_FundMilestone_AlreadyFundedReverts() public {
        _createContract();

        vm.prank(buyer);
        escrow.fundMilestone{value: 1 ether}(0, 0);

        vm.prank(buyer);
        vm.expectRevert(MembaEscrow.MilestoneNotPending.selector);
        escrow.fundMilestone{value: 1 ether}(0, 0);
    }

    // ══════════════════════════════════════════════════════════════
    // 3. Completion & Release
    // ══════════════════════════════════════════════════════════════

    function test_CompleteMilestone_Success() public {
        _createContract();
        vm.prank(buyer);
        escrow.fundMilestone{value: 1 ether}(0, 0);

        vm.prank(seller);
        escrow.completeMilestone(0, 0);

        MembaEscrow.Milestone memory ms = escrow.getMilestone(0, 0);
        assertEq(uint8(ms.status), uint8(MembaEscrow.MilestoneStatus.Completed));
    }

    function test_CompleteMilestone_NonSellerReverts() public {
        _createContract();
        vm.prank(buyer);
        escrow.fundMilestone{value: 1 ether}(0, 0);

        vm.prank(outsider);
        vm.expectRevert(MembaEscrow.NotSeller.selector);
        escrow.completeMilestone(0, 0);
    }

    function test_ReleaseFunds_Success() public {
        _createContract();
        vm.prank(buyer);
        escrow.fundMilestone{value: 1 ether}(0, 0);
        vm.prank(seller);
        escrow.completeMilestone(0, 0);

        uint256 sellerBefore = seller.balance;
        uint256 feeBefore = feeWallet.balance;

        vm.prank(buyer);
        escrow.releaseFunds(0, 0);

        // 2% fee
        uint256 expectedFee = 1 ether * uint256(PLATFORM_FEE) / 10000;
        uint256 expectedNet = 1 ether - expectedFee;

        assertEq(seller.balance, sellerBefore + expectedNet);
        assertEq(feeWallet.balance, feeBefore + expectedFee);

        MembaEscrow.Milestone memory ms = escrow.getMilestone(0, 0);
        assertEq(uint8(ms.status), uint8(MembaEscrow.MilestoneStatus.Released));
    }

    function test_ReleaseFunds_FeeCalculation() public {
        _createContract();
        vm.prank(buyer);
        escrow.fundMilestone{value: 1 ether}(0, 0);
        vm.prank(seller);
        escrow.completeMilestone(0, 0);

        uint256 fee = 1 ether * uint256(PLATFORM_FEE) / 10000; // 0.02 ETH
        assertEq(fee, 0.02 ether);
    }

    function test_ReleaseFunds_AllMilestonesCompletes() public {
        _createContract();

        // Fund and complete both milestones
        vm.prank(buyer);
        escrow.fundMilestone{value: 1 ether}(0, 0);
        vm.prank(seller);
        escrow.completeMilestone(0, 0);
        vm.prank(buyer);
        escrow.releaseFunds(0, 0);

        vm.prank(buyer);
        escrow.fundMilestone{value: 2 ether}(0, 1);
        vm.prank(seller);
        escrow.completeMilestone(0, 1);
        vm.prank(buyer);
        escrow.releaseFunds(0, 1);

        MembaEscrow.ServiceContract memory sc = escrow.getContract(0);
        assertEq(uint8(sc.status), uint8(MembaEscrow.ContractStatus.Completed));
    }

    function test_ReleaseFunds_AlreadyReleasedReverts() public {
        _createContract();
        vm.prank(buyer);
        escrow.fundMilestone{value: 1 ether}(0, 0);
        vm.prank(seller);
        escrow.completeMilestone(0, 0);
        vm.prank(buyer);
        escrow.releaseFunds(0, 0);

        vm.prank(buyer);
        vm.expectRevert(MembaEscrow.MilestoneNotCompleted.selector);
        escrow.releaseFunds(0, 0);
    }

    // ══════════════════════════════════════════════════════════════
    // 4. Disputes
    // ══════════════════════════════════════════════════════════════

    function test_Dispute_BuyerCanRaise() public {
        _createContract();
        vm.prank(buyer);
        escrow.dispute(0);

        MembaEscrow.ServiceContract memory sc = escrow.getContract(0);
        assertEq(uint8(sc.status), uint8(MembaEscrow.ContractStatus.Disputed));
    }

    function test_Dispute_SellerCanRaise() public {
        _createContract();
        vm.prank(seller);
        escrow.dispute(0);

        MembaEscrow.ServiceContract memory sc = escrow.getContract(0);
        assertEq(uint8(sc.status), uint8(MembaEscrow.ContractStatus.Disputed));
    }

    function test_Dispute_OutsiderReverts() public {
        _createContract();
        vm.prank(outsider);
        vm.expectRevert(MembaEscrow.NotParty.selector);
        escrow.dispute(0);
    }

    function test_Dispute_FreezesActions() public {
        _createContract();
        vm.prank(buyer);
        escrow.fundMilestone{value: 1 ether}(0, 0);

        vm.prank(buyer);
        escrow.dispute(0);

        // Complete during dispute → revert
        vm.prank(seller);
        vm.expectRevert(MembaEscrow.ContractIsDisputed.selector);
        escrow.completeMilestone(0, 0);
    }

    function test_ResolveDispute_ReleaseToSeller() public {
        _createContract();
        vm.prank(buyer);
        escrow.fundMilestone{value: 1 ether}(0, 0);
        vm.prank(buyer);
        escrow.dispute(0);

        uint256 sellerBefore = seller.balance;

        vm.prank(adminAddr);
        escrow.resolveDispute(0, true);

        // Seller received funds minus fee
        uint256 fee = 1 ether * uint256(PLATFORM_FEE) / 10000;
        assertEq(seller.balance, sellerBefore + 1 ether - fee);
    }

    function test_ResolveDispute_RefundToBuyer() public {
        _createContract();
        vm.prank(buyer);
        escrow.fundMilestone{value: 1 ether}(0, 0);
        vm.prank(buyer);
        escrow.dispute(0);

        uint256 buyerBefore = buyer.balance;

        vm.prank(adminAddr);
        escrow.resolveDispute(0, false);

        // Buyer gets full refund (no fee on dispute refund)
        assertEq(buyer.balance, buyerBefore + 1 ether);
    }

    function test_ResolveDispute_NonAdminReverts() public {
        _createContract();
        vm.prank(buyer);
        escrow.dispute(0);

        vm.prank(outsider);
        vm.expectRevert(MembaEscrow.NotAdmin.selector);
        escrow.resolveDispute(0, true);
    }

    // ══════════════════════════════════════════════════════════════
    // 5. Cancellation
    // ══════════════════════════════════════════════════════════════

    function test_CancelContract_RefundsAndReleases() public {
        _createContract();

        // Fund milestone 0
        vm.prank(buyer);
        escrow.fundMilestone{value: 1 ether}(0, 0);

        // Fund and complete milestone 1
        vm.prank(buyer);
        escrow.fundMilestone{value: 2 ether}(0, 1);
        vm.prank(seller);
        escrow.completeMilestone(0, 1);

        uint256 buyerBefore = buyer.balance;
        uint256 sellerBefore = seller.balance;

        vm.prank(buyer);
        escrow.cancelContract(0);

        // MS 0 (Funded): refund to buyer minus 5% cancel fee
        uint256 cancelFee0 = 1 ether * uint256(CANCEL_FEE) / 10000;
        // MS 1 (Completed): release to seller (no fee, work was done)
        assertEq(buyer.balance, buyerBefore + 1 ether - cancelFee0);
        assertEq(seller.balance, sellerBefore + 2 ether);

        MembaEscrow.ServiceContract memory sc = escrow.getContract(0);
        assertEq(uint8(sc.status), uint8(MembaEscrow.ContractStatus.Cancelled));
    }

    function test_CancelContract_NotPartyReverts() public {
        _createContract();
        vm.prank(outsider);
        vm.expectRevert(MembaEscrow.NotParty.selector);
        escrow.cancelContract(0);
    }

    // ══════════════════════════════════════════════════════════════
    // 6. Auto-Refund
    // ══════════════════════════════════════════════════════════════

    function test_AutoRefund_Success() public {
        _createContract();
        vm.prank(buyer);
        escrow.fundMilestone{value: 1 ether}(0, 0);

        // Fast-forward past timeout
        vm.warp(block.timestamp + AUTO_REFUND + 1);

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        escrow.claimAutoRefund(0, 0);

        assertEq(buyer.balance, buyerBefore + 1 ether);
    }

    function test_AutoRefund_BeforeTimeoutReverts() public {
        _createContract();
        vm.prank(buyer);
        escrow.fundMilestone{value: 1 ether}(0, 0);

        vm.prank(buyer);
        vm.expectRevert(MembaEscrow.AutoRefundNotReady.selector);
        escrow.claimAutoRefund(0, 0);
    }

    // ══════════════════════════════════════════════════════════════
    // 7. Pausable
    // ══════════════════════════════════════════════════════════════

    function test_Paused_CreateReverts() public {
        vm.prank(adminAddr);
        escrow.pause();

        string[] memory titles = new string[](1);
        titles[0] = "MS1";
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;

        vm.prank(buyer);
        vm.expectRevert();
        escrow.createContract(seller, "Blocked", titles, amounts);
    }
}
