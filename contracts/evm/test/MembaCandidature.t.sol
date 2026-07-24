// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { MembaDAO } from "../src/core/MembaDAO.sol";
import { MembaDAOFactory } from "../src/core/MembaDAOFactory.sol";
import { MembaCandidature } from "../src/core/MembaCandidature.sol";

/**
 * @title MembaCandidatureTest
 * @notice 15 test cases per CONTRACT_SPECS/MembaCandidature.spec.md.
 */
contract MembaCandidatureTest is Test {
    MembaDAO public dao;
    MembaCandidature public candidature;

    address public adminAddr = makeAddr("admin");
    address public applicant = makeAddr("applicant");
    address public outsider = makeAddr("outsider");

    uint256 public constant MIN_DEPOSIT = 0.01 ether;

    function setUp() public {
        // Deploy DAO
        MembaDAO daoImpl = new MembaDAO();
        MembaDAOFactory factory = new MembaDAOFactory(address(daoImpl));
        address daoProxy = factory.createDAO("Test DAO", "desc", adminAddr, bytes32(uint256(1)));
        dao = MembaDAO(daoProxy);

        // Deploy Candidature behind proxy
        MembaCandidature candImpl = new MembaCandidature();
        bytes memory initData = abi.encodeCall(MembaCandidature.initialize, (address(dao), adminAddr, MIN_DEPOSIT));
        address candProxy = address(new ERC1967Proxy(address(candImpl), initData));
        candidature = MembaCandidature(candProxy);

        // Grant ADMIN_ROLE to candidature contract so it can add members via addMember
        bytes32 adminRole = dao.ADMIN_ROLE();
        vm.prank(adminAddr);
        dao.grantRole(adminRole, address(candidature));

        // Fund applicants
        vm.deal(applicant, 100 ether);
        vm.deal(outsider, 100 ether);
    }

    // ══════════════════════════════════════════════════════════════
    // 1. Initialization
    // ══════════════════════════════════════════════════════════════

    function test_Initialize_CorrectConfig() public view {
        assertEq(candidature.daoContract(), address(dao));
        assertEq(candidature.admin(), adminAddr);
        assertEq(candidature.minDeposit(), MIN_DEPOSIT);
        assertEq(candidature.applicationCount(), 0);
    }

    function test_Initialize_NoApplications() public view {
        address[] memory apps = candidature.getApplicants();
        assertEq(apps.length, 0);
    }

    // ══════════════════════════════════════════════════════════════
    // 2. Application Flow
    // ══════════════════════════════════════════════════════════════

    function test_Apply_Success() public {
        vm.prank(applicant);
        candidature.submitApplication{ value: MIN_DEPOSIT }("My bio", "Solidity,Rust");

        MembaCandidature.Application memory app = candidature.getApplication(applicant);
        assertEq(uint8(app.status), uint8(MembaCandidature.ApplicationStatus.Pending));
        assertEq(app.deposit, MIN_DEPOSIT);
        assertEq(app.bio, "My bio");
        assertEq(app.skills, "Solidity,Rust");
        assertEq(candidature.applicationCount(), 1);
    }

    function test_Apply_InsufficientDepositReverts() public {
        vm.prank(applicant);
        vm.expectRevert(MembaCandidature.InsufficientDeposit.selector);
        candidature.submitApplication{ value: MIN_DEPOSIT - 1 }("Bio", "Skills");
    }

    function test_Apply_AlreadyPendingReverts() public {
        vm.prank(applicant);
        candidature.submitApplication{ value: MIN_DEPOSIT }("Bio", "Skills");

        vm.prank(applicant);
        vm.expectRevert(MembaCandidature.AlreadyPending.selector);
        candidature.submitApplication{ value: MIN_DEPOSIT }("Bio2", "Skills2");
    }

    function test_Apply_AlreadyMemberReverts() public {
        // Admin is already a member
        vm.deal(adminAddr, 1 ether);
        vm.prank(adminAddr);
        vm.expectRevert(MembaCandidature.AlreadyMember.selector);
        candidature.submitApplication{ value: MIN_DEPOSIT }("Bio", "Skills");
    }

    function test_Apply_ReApplicationRequires10xDeposit() public {
        // First application
        vm.prank(applicant);
        candidature.submitApplication{ value: MIN_DEPOSIT }("Bio", "Skills");

        // Reject
        vm.prank(adminAddr);
        candidature.markRejected(applicant);

        // Re-apply requires 10x
        uint256 required = candidature.getRequiredDeposit(applicant);
        assertEq(required, MIN_DEPOSIT * 10);

        // Try with original deposit — should fail
        vm.prank(applicant);
        vm.expectRevert(MembaCandidature.InsufficientDeposit.selector);
        candidature.submitApplication{ value: MIN_DEPOSIT }("Bio2", "Skills2");

        // Apply with 10x deposit — should succeed
        vm.prank(applicant);
        candidature.submitApplication{ value: required }("Bio2", "Skills2");
    }

    // ══════════════════════════════════════════════════════════════
    // 3. Approval / Rejection
    // ══════════════════════════════════════════════════════════════

    function test_MarkApproved_Success() public {
        vm.prank(applicant);
        candidature.submitApplication{ value: MIN_DEPOSIT }("Bio", "Skills");

        vm.prank(adminAddr);
        candidature.markApproved(applicant);

        MembaCandidature.Application memory app = candidature.getApplication(applicant);
        assertEq(uint8(app.status), uint8(MembaCandidature.ApplicationStatus.Approved));

        // Verify applicant is now a DAO member
        assertTrue(dao.isMember(applicant));
    }

    function test_MarkRejected_Success() public {
        vm.prank(applicant);
        candidature.submitApplication{ value: MIN_DEPOSIT }("Bio", "Skills");

        vm.prank(adminAddr);
        candidature.markRejected(applicant);

        MembaCandidature.Application memory app = candidature.getApplication(applicant);
        assertEq(uint8(app.status), uint8(MembaCandidature.ApplicationStatus.Rejected));
    }

    function test_MarkApproved_NonAdminReverts() public {
        vm.prank(applicant);
        candidature.submitApplication{ value: MIN_DEPOSIT }("Bio", "Skills");

        vm.prank(outsider);
        vm.expectRevert(MembaCandidature.NotAdmin.selector);
        candidature.markApproved(applicant);
    }

    function test_MarkApproved_NotPendingReverts() public {
        // No application
        vm.prank(adminAddr);
        vm.expectRevert(MembaCandidature.NotPending.selector);
        candidature.markApproved(outsider);
    }

    // ══════════════════════════════════════════════════════════════
    // 4. Withdrawal
    // ══════════════════════════════════════════════════════════════

    function test_Withdraw_FromPending() public {
        vm.prank(applicant);
        candidature.submitApplication{ value: MIN_DEPOSIT }("Bio", "Skills");

        uint256 balBefore = applicant.balance;

        vm.prank(applicant);
        candidature.withdraw();

        assertEq(applicant.balance, balBefore + MIN_DEPOSIT);

        MembaCandidature.Application memory app = candidature.getApplication(applicant);
        assertEq(uint8(app.status), uint8(MembaCandidature.ApplicationStatus.Withdrawn));
    }

    function test_Withdraw_FromRejected() public {
        vm.prank(applicant);
        candidature.submitApplication{ value: MIN_DEPOSIT }("Bio", "Skills");

        vm.prank(adminAddr);
        candidature.markRejected(applicant);

        uint256 balBefore = applicant.balance;
        vm.prank(applicant);
        candidature.withdraw();

        assertEq(applicant.balance, balBefore + MIN_DEPOSIT);
    }

    function test_Withdraw_ApprovedReverts() public {
        vm.prank(applicant);
        candidature.submitApplication{ value: MIN_DEPOSIT }("Bio", "Skills");

        vm.prank(adminAddr);
        candidature.markApproved(applicant);

        vm.prank(applicant);
        vm.expectRevert(MembaCandidature.NotWithdrawable.selector);
        candidature.withdraw();
    }

    // ══════════════════════════════════════════════════════════════
    // 5. Admin Config
    // ══════════════════════════════════════════════════════════════

    function test_UpdateMinDeposit() public {
        vm.prank(adminAddr);
        candidature.updateMinDeposit(0.05 ether);
        assertEq(candidature.minDeposit(), 0.05 ether);
    }
}
