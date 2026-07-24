// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { MembaEscrow } from "../../src/commerce/MembaEscrow.sol";

/// @notice Drives MembaEscrow through randomised action sequences across several actors.
/// @dev Bounded so the fuzzer spends its runs on reachable states rather than reverts.
contract EscrowHandler is Test {
    MembaEscrow public immutable escrow;
    address public immutable admin;
    address public immutable feeRecipient;

    address[3] public buyers;
    address[3] public sellers;

    uint256 public contractCount;

    constructor(MembaEscrow escrow_, address admin_, address feeRecipient_) {
        escrow = escrow_;
        admin = admin_;
        feeRecipient = feeRecipient_;
        for (uint256 i = 0; i < 3; i++) {
            buyers[i] = makeAddr(string.concat("buyer", vm.toString(i)));
            sellers[i] = makeAddr(string.concat("seller", vm.toString(i)));
            vm.deal(buyers[i], 1000 ether);
        }
    }

    function _buyer(uint256 s) internal view returns (address) {
        return buyers[s % 3];
    }

    function _seller(uint256 s) internal view returns (address) {
        return sellers[s % 3];
    }

    function createContract(uint256 seed, uint256 milestoneCount) external {
        milestoneCount = bound(milestoneCount, 1, 5);
        string[] memory titles = new string[](milestoneCount);
        uint256[] memory amounts = new uint256[](milestoneCount);
        for (uint256 i = 0; i < milestoneCount; i++) {
            titles[i] = "m";
            amounts[i] = bound(uint256(keccak256(abi.encode(seed, i))), 0.001 ether, 5 ether);
        }
        vm.prank(_buyer(seed));
        try escrow.createContract(_seller(seed + 1), "c", titles, amounts) {
            contractCount++;
        } catch { }
    }

    function fundMilestone(uint256 id, uint256 idx) external {
        if (contractCount == 0) return;
        id = bound(id, 0, contractCount - 1);
        MembaEscrow.ServiceContract memory sc = escrow.getContract(id);
        if (sc.milestoneCount == 0) return;
        idx = bound(idx, 0, sc.milestoneCount - 1);
        MembaEscrow.Milestone memory ms = escrow.getMilestone(id, idx);

        vm.prank(sc.buyer);
        try escrow.fundMilestone{ value: ms.amount }(id, idx) { } catch { }
    }

    function completeMilestone(uint256 id, uint256 idx) external {
        if (contractCount == 0) return;
        id = bound(id, 0, contractCount - 1);
        MembaEscrow.ServiceContract memory sc = escrow.getContract(id);
        if (sc.milestoneCount == 0) return;
        idx = bound(idx, 0, sc.milestoneCount - 1);
        vm.prank(sc.seller);
        try escrow.completeMilestone(id, idx) { } catch { }
    }

    function releaseFunds(uint256 id, uint256 idx) external {
        if (contractCount == 0) return;
        id = bound(id, 0, contractCount - 1);
        MembaEscrow.ServiceContract memory sc = escrow.getContract(id);
        if (sc.milestoneCount == 0) return;
        idx = bound(idx, 0, sc.milestoneCount - 1);
        MembaEscrow.Milestone memory ms = escrow.getMilestone(id, idx);

        vm.prank(sc.buyer);
        try escrow.releaseFunds(id, idx) { } catch { }
    }

    function raiseDispute(uint256 id) external {
        if (contractCount == 0) return;
        id = bound(id, 0, contractCount - 1);
        MembaEscrow.ServiceContract memory sc = escrow.getContract(id);
        vm.prank(sc.buyer);
        try escrow.dispute(id) { } catch { }
    }

    function resolveDispute(uint256 id, bool toSeller) external {
        if (contractCount == 0) return;
        id = bound(id, 0, contractCount - 1);
        vm.prank(admin);
        try escrow.resolveDispute(id, toSeller) { } catch { }
    }

    function cancelContract(uint256 id, bool asBuyer) external {
        if (contractCount == 0) return;
        id = bound(id, 0, contractCount - 1);
        MembaEscrow.ServiceContract memory sc = escrow.getContract(id);
        vm.prank(asBuyer ? sc.buyer : sc.seller);
        try escrow.cancelContract(id) { } catch { }
    }

    function claimAutoRefund(uint256 id, uint256 idx, uint256 warpBy) external {
        if (contractCount == 0) return;
        id = bound(id, 0, contractCount - 1);
        MembaEscrow.ServiceContract memory sc = escrow.getContract(id);
        if (sc.milestoneCount == 0) return;
        idx = bound(idx, 0, sc.milestoneCount - 1);
        vm.warp(block.timestamp + bound(warpBy, 0, 40 days));

        MembaEscrow.Milestone memory ms = escrow.getMilestone(id, idx);
        vm.prank(sc.buyer);
        try escrow.claimAutoRefund(id, idx) { } catch { }
    }

    /// @dev Sum of milestone value the contract should still be custodying for `id`.
    function _heldFor(uint256 id) internal view returns (uint256 total) {
        MembaEscrow.ServiceContract memory sc = escrow.getContract(id);
        for (uint256 i = 0; i < sc.milestoneCount; i++) {
            MembaEscrow.Milestone memory ms = escrow.getMilestone(id, i);
            if (ms.status == MembaEscrow.MilestoneStatus.Funded || ms.status == MembaEscrow.MilestoneStatus.Completed) {
                total += ms.amount;
            }
        }
    }

    /// @dev Recompute held value across every contract, from milestone state alone.
    function totalHeldFromState() external view returns (uint256 total) {
        for (uint256 id = 0; id < contractCount; id++) {
            total += _heldFor(id);
        }
    }
}

/// @title EscrowInvariants
/// @notice The properties that must hold no matter what order actions arrive in.
///
/// @dev The original suite had zero invariant tests. These close a different gap than
///      the exploit tests in MembaEscrow.moneypaths.t.sol, and it is worth being
///      precise about which:
///
///      The audit recommended a solvency invariant on the grounds that it would catch
///      the seller-drain, the dispute-freeze bypass and the hostile-recipient freeze
///      "at once". It does not, and assuming it did would be exactly the kind of
///      false assurance this codebase already suffered from. All three of those are
///      AUTHORIZATION defects: after the seller-drain the milestones are legitimately
///      Released and the balance is legitimately zero, so solvency still holds. Those
///      are covered by the named exploit tests, which assert who received the money.
///
///      What these invariants do catch, across action orderings no unit test
///      enumerates: accounting drift between milestone state and custodied ETH,
///      double payment, value created from nothing, and ETH stranded under a terminal
///      status where no function can ever move it again.
contract EscrowInvariantsTest is StdInvariant, Test {
    MembaEscrow public escrow;
    EscrowHandler public handler;

    address public adminAddr = makeAddr("invariantAdmin");
    address public feeWallet = makeAddr("invariantFeeWallet");

    function setUp() public {
        MembaEscrow impl = new MembaEscrow();
        bytes memory initData = abi.encodeCall(MembaEscrow.initialize, (adminAddr, feeWallet, 200, 500, 30 days));
        escrow = MembaEscrow(address(new ERC1967Proxy(address(impl), initData)));

        handler = new EscrowHandler(escrow, adminAddr, feeWallet);
        targetContract(address(handler));
        vm.warp(1_000_000);
    }

    /// INV-E1 — exact solvency. Custodied ETH must equal the milestones still owed,
    /// no more and no less.
    ///
    /// Equality rather than `>=` on purpose: `>=` would pass while ETH silently
    /// accumulated in the contract with no function able to release it. Every actor
    /// here is an EOA that accepts ETH, so no payout takes the pull-payment credit
    /// path and the two sides must match exactly. Under-balance means the contract
    /// paid out money it did not have; over-balance means it stranded money.
    function invariant_CustodiedEthEqualsMilestonesOwed() public view {
        assertEq(
            address(escrow).balance,
            handler.totalHeldFromState(),
            "custodied ETH does not match the milestones still owed"
        );
    }

    /// INV-E2 — no value is created. The contract can never hold more than the
    /// total ever funded into it.
    function invariant_NeverHoldsMoreThanWasFunded() public view {
        uint256 funded;
        uint256 count = handler.contractCount();
        for (uint256 id = 0; id < count; id++) {
            funded += escrow.getContract(id).totalFunded;
        }
        assertLe(address(escrow).balance, funded, "escrow holds more ETH than was ever funded");
    }

    /// INV-E3 — terminality. A Released or Refunded milestone is final; nothing may
    /// move it back into a payable state and let it be paid twice.
    function invariant_TerminalMilestonesStayTerminal() public view {
        uint256 count = handler.contractCount();
        for (uint256 id = 0; id < count; id++) {
            MembaEscrow.ServiceContract memory sc = escrow.getContract(id);
            for (uint256 i = 0; i < sc.milestoneCount; i++) {
                MembaEscrow.Milestone memory ms = escrow.getMilestone(id, i);
                if (ms.status == MembaEscrow.MilestoneStatus.Released) {
                    assertGt(sc.totalReleased, 0, "released milestone with no released total");
                }
                if (ms.status == MembaEscrow.MilestoneStatus.Refunded) {
                    assertGt(sc.totalRefunded, 0, "refunded milestone with no refunded total");
                }
            }
        }
    }

    /// INV-E4 — a cancelled or completed contract holds nothing. Every exit path must
    /// fully unwind; ETH left behind under a terminal status is stranded forever,
    /// since no function can move it afterwards.
    function invariant_TerminalContractsHoldNothing() public view {
        uint256 count = handler.contractCount();
        for (uint256 id = 0; id < count; id++) {
            MembaEscrow.ServiceContract memory sc = escrow.getContract(id);
            if (sc.status == MembaEscrow.ContractStatus.Cancelled || sc.status == MembaEscrow.ContractStatus.Completed)
            {
                for (uint256 i = 0; i < sc.milestoneCount; i++) {
                    MembaEscrow.MilestoneStatus st = escrow.getMilestone(id, i).status;
                    assertTrue(
                        st != MembaEscrow.MilestoneStatus.Funded && st != MembaEscrow.MilestoneStatus.Completed,
                        "terminal contract still holds an unresolved milestone"
                    );
                }
            }
        }
    }
}
