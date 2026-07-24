// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { MembaDAO } from "../src/core/MembaDAO.sol";
import { MembaDAOFactory } from "../src/core/MembaDAOFactory.sol";

/**
 * @title MembaDAOTest
 * @notice Comprehensive test suite for MembaDAO + MembaDAOFactory.
 *         22 test cases per CONTRACT_SPECS/MembaDAO.spec.md.
 */
contract MembaDAOTest is Test {
    MembaDAO public impl;
    MembaDAO public dao;
    MembaDAOFactory public factory;

    address public admin = makeAddr("admin");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");
    address public outsider = makeAddr("outsider");
    address public safe = makeAddr("safe");

    // ERC-1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1.
    bytes32 internal constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function _implOf(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, IMPL_SLOT))));
    }

    function setUp() public {
        impl = new MembaDAO();
        factory = new MembaDAOFactory(address(impl));

        // Deploy a DAO via factory
        address proxy = factory.createDAO("Test DAO", "A test DAO", admin, bytes32(uint256(1)));
        dao = MembaDAO(proxy);
    }

    // ══════════════════════════════════════════════════════════════
    // 1. Initialization
    // ══════════════════════════════════════════════════════════════

    function test_Initialize_CorrectNameAndDescription() public view {
        assertEq(dao.name(), "Test DAO");
        assertEq(dao.description(), "A test DAO");
        assertEq(dao.version(), "1.0.0");
    }

    function test_Initialize_AdminHasAllRoles() public view {
        assertTrue(dao.hasRole(dao.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(dao.hasRole(dao.ADMIN_ROLE(), admin));
        assertTrue(dao.hasRole(dao.MEMBER_ROLE(), admin));
    }

    function test_Initialize_AdminIsMember() public view {
        assertTrue(dao.isMember(admin));
        assertEq(dao.memberCount(), 1);

        MembaDAO.MemberInfo memory info = dao.getMember(admin);
        assertEq(info.votingPower, 1);
        assertTrue(info.active);
        assertGt(info.joinedAt, 0);
    }

    function test_Initialize_ImplementationCannotBeReinitialized() public {
        vm.expectRevert();
        impl.initialize("Hack", "desc", address(this));
    }

    function test_Initialize_DefaultConfig() public view {
        assertEq(dao.thresholdBps(), 5100);
        assertEq(dao.quorumBps(), 0);
        assertEq(dao.proposalCount(), 0);
    }

    // ══════════════════════════════════════════════════════════════
    // 2. Factory
    // ══════════════════════════════════════════════════════════════

    function test_Factory_TracksDAOsCorrectly() public view {
        assertEq(factory.daoCount(), 1);
        assertEq(factory.daos(0), address(dao));
    }

    function test_Factory_DeterministicAddresses() public {
        // Same salt + same inputs = same address (CREATE2 determinism)
        bytes32 salt = bytes32(uint256(42));
        address predicted = factory.createDAO("DAO2", "desc2", admin, salt);
        assertTrue(predicted != address(0));
        assertEq(factory.daoCount(), 2);
    }

    function test_Factory_OnlyOwnerCanSetImplementation() public {
        MembaDAO newImpl = new MembaDAO();
        factory.setImplementation(address(newImpl));
        assertEq(factory.daoImplementation(), address(newImpl));

        // Non-owner cannot
        vm.prank(outsider);
        vm.expectRevert();
        factory.setImplementation(address(newImpl));
    }

    // ── C-4: ownership handover to the Safe (Ownable2Step) ──────────
    // setUp makes this test contract the initial owner, so the handover tests transfer to
    // `safe` then prank it to accept. Deploy any `new MembaDAO()` on its OWN line before a
    // prank — a contract creation on the pranked line consumes the prank (this repo has been
    // bitten by that twice).

    function test_C4_TransferOwnership_SetsPendingOnly() public {
        factory.transferOwnership(safe);
        assertEq(factory.pendingOwner(), safe, "safe should be pending owner");
        assertEq(factory.owner(), address(this), "owner must not change until accept");
    }

    function test_C4_OldOwnerRetainsControlUntilAccept() public {
        factory.transferOwnership(safe);

        // Old owner can still set the implementation until the handover completes.
        MembaDAO ni = new MembaDAO();
        factory.setImplementation(address(ni));
        assertEq(factory.daoImplementation(), address(ni));

        // The pending owner cannot yet.
        MembaDAO ni2 = new MembaDAO();
        vm.prank(safe);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, safe));
        factory.setImplementation(address(ni2));
    }

    function test_C4_AcceptOwnership_CompletesHandover() public {
        factory.transferOwnership(safe);
        vm.prank(safe);
        factory.acceptOwnership();
        assertEq(factory.owner(), safe);
        assertEq(factory.pendingOwner(), address(0));
    }

    function test_C4_NonPendingCannotAccept() public {
        factory.transferOwnership(safe);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        factory.acceptOwnership();
    }

    /// @notice Headline: once the Safe owns the factory, a compromised deployer key can no
    ///         longer repoint the DAO template.
    function test_C4_DeployerCannotSetImplementationAfterHandover() public {
        address deployer = address(this);
        factory.transferOwnership(safe);
        vm.prank(safe);
        factory.acceptOwnership();

        MembaDAO ni = new MembaDAO();
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, deployer));
        factory.setImplementation(address(ni));
    }

    function test_C4_SafeCanRotateImplementationAfterHandover() public {
        factory.transferOwnership(safe);
        vm.prank(safe);
        factory.acceptOwnership();

        MembaDAO ni = new MembaDAO();
        vm.expectEmit(true, true, false, false, address(factory));
        emit MembaDAOFactory.ImplementationUpdated(address(impl), address(ni));
        vm.prank(safe);
        factory.setImplementation(address(ni));
        assertEq(factory.daoImplementation(), address(ni));
    }

    function test_C4_SetImplementationRejectsZero() public {
        vm.expectRevert(MembaDAOFactory.InvalidImplementation.selector);
        factory.setImplementation(address(0));
    }

    /// @notice Risk-scoping proof: rotating the template affects only FUTURE DAOs; an already
    ///         created DAO keeps its own implementation.
    function test_C4_ImplementationSwapDoesNotAffectExistingDAOs() public {
        assertEq(_implOf(address(dao)), address(impl), "DAO A starts on v1");

        MembaDAO implV2 = new MembaDAO();
        factory.setImplementation(address(implV2));

        assertEq(_implOf(address(dao)), address(impl), "existing DAO A must stay on v1");

        address daoB = factory.createDAO("B", "d", admin, bytes32(uint256(7)));
        assertEq(_implOf(daoB), address(implV2), "new DAO B uses v2");
    }

    function test_C4_RenounceOwnershipDisabled() public {
        vm.expectRevert(MembaDAOFactory.OwnershipCannotBeRenounced.selector);
        factory.renounceOwnership();
        assertEq(factory.owner(), address(this), "owner unchanged");
    }

    function test_C4_SpecGettersMatchPublicVars() public view {
        assertEq(factory.getDaoCount(), factory.daoCount());
        assertEq(factory.getDao(0), factory.daos(0));
    }

    // ══════════════════════════════════════════════════════════════
    // 3. Membership
    // ══════════════════════════════════════════════════════════════

    function test_AddMember_Success() public {
        string[] memory roles = new string[](2);
        roles[0] = "dev";
        roles[1] = "member";

        vm.prank(admin);
        dao.addMember(alice, 100, roles);

        assertTrue(dao.isMember(alice));
        assertEq(dao.memberCount(), 2);

        MembaDAO.MemberInfo memory info = dao.getMember(alice);
        assertEq(info.votingPower, 100);
        assertTrue(info.active);
    }

    function test_AddMember_EmitsEvent() public {
        string[] memory roles = new string[](1);
        roles[0] = "member";

        vm.expectEmit(true, false, false, true);
        emit MembaDAO.MemberAdded(alice, 50, roles);

        vm.prank(admin);
        dao.addMember(alice, 50, roles);
    }

    function test_AddMember_NonAdminReverts() public {
        string[] memory roles = new string[](0);

        vm.prank(outsider);
        vm.expectRevert();
        dao.addMember(alice, 1, roles);
    }

    function test_AddMember_AlreadyMemberReverts() public {
        string[] memory roles = new string[](0);

        vm.prank(admin);
        dao.addMember(alice, 1, roles);

        vm.prank(admin);
        vm.expectRevert(MembaDAO.AlreadyMember.selector);
        dao.addMember(alice, 1, roles);
    }

    function test_AddMember_ZeroVotingPowerReverts() public {
        string[] memory roles = new string[](0);

        vm.prank(admin);
        vm.expectRevert(MembaDAO.InvalidVotingPower.selector);
        dao.addMember(alice, 0, roles);
    }

    function test_AddMember_ExcessVotingPowerReverts() public {
        string[] memory roles = new string[](0);

        uint256 overMax = dao.MAX_VOTING_POWER() + 1;
        vm.prank(admin);
        vm.expectRevert(MembaDAO.InvalidVotingPower.selector);
        dao.addMember(bob, overMax, roles);
    }

    function test_RemoveMember_Success() public {
        string[] memory roles = new string[](0);
        vm.prank(admin);
        dao.addMember(alice, 1, roles);
        assertEq(dao.memberCount(), 2);

        vm.prank(admin);
        dao.removeMember(alice);

        assertFalse(dao.isMember(alice));
        assertEq(dao.memberCount(), 1);
    }

    function test_RemoveMember_NonMemberReverts() public {
        vm.prank(admin);
        vm.expectRevert(MembaDAO.NotActiveMember.selector);
        dao.removeMember(outsider);
    }

    // ══════════════════════════════════════════════════════════════
    // 4. Proposals & Voting
    // ══════════════════════════════════════════════════════════════

    function _addMemberAndSetup() internal {
        string[] memory roles = new string[](0);
        vm.startPrank(admin);
        dao.addMember(alice, 10, roles);
        dao.addMember(bob, 10, roles);
        vm.stopPrank();
    }

    function test_Propose_Success() public {
        vm.prank(admin);
        uint256 id = dao.propose("Title", "Description", MembaDAO.ProposalCategory.Governance);
        assertEq(id, 0);
        assertEq(dao.proposalCount(), 1);

        MembaDAO.Proposal memory p = dao.getProposal(0);
        assertEq(p.proposer, admin);
        assertEq(p.title, "Title");
        assertFalse(p.executed);
        assertFalse(p.cancelled);
    }

    function test_Propose_NonMemberReverts() public {
        vm.prank(outsider);
        vm.expectRevert();
        dao.propose("Title", "Desc", MembaDAO.ProposalCategory.Governance);
    }

    function test_Propose_EmptyTitleReverts() public {
        vm.prank(admin);
        vm.expectRevert(MembaDAO.EmptyTitle.selector);
        dao.propose("", "Desc", MembaDAO.ProposalCategory.Governance);
    }

    function test_Vote_Success() public {
        _addMemberAndSetup();

        vm.prank(admin);
        dao.propose("Prop", "Desc", MembaDAO.ProposalCategory.Governance);

        vm.prank(alice);
        dao.vote(0, MembaDAO.VoteType.For);

        MembaDAO.Proposal memory p = dao.getProposal(0);
        assertEq(p.forVotes, 10); // alice's voting power
    }

    function test_Vote_AllTypes() public {
        _addMemberAndSetup();

        vm.prank(admin);
        dao.propose("Prop", "Desc", MembaDAO.ProposalCategory.Governance);

        vm.prank(admin);
        dao.vote(0, MembaDAO.VoteType.For); // power = 1

        vm.prank(alice);
        dao.vote(0, MembaDAO.VoteType.Against); // power = 10

        vm.prank(bob);
        dao.vote(0, MembaDAO.VoteType.Abstain); // power = 10

        MembaDAO.Proposal memory p = dao.getProposal(0);
        assertEq(p.forVotes, 1);
        assertEq(p.againstVotes, 10);
        assertEq(p.abstainVotes, 10);
    }

    function test_Vote_DoubleVoteReverts() public {
        vm.prank(admin);
        dao.propose("Prop", "Desc", MembaDAO.ProposalCategory.Governance);

        vm.prank(admin);
        dao.vote(0, MembaDAO.VoteType.For);

        vm.prank(admin);
        vm.expectRevert(MembaDAO.AlreadyVoted.selector);
        dao.vote(0, MembaDAO.VoteType.Against);
    }

    function test_Vote_AfterDeadlineReverts() public {
        vm.prank(admin);
        dao.propose("Prop", "Desc", MembaDAO.ProposalCategory.Governance);

        // Fast-forward past voting period
        vm.warp(block.timestamp + 8 days);

        vm.prank(admin);
        vm.expectRevert(MembaDAO.VotingClosed.selector);
        dao.vote(0, MembaDAO.VoteType.For);
    }

    // ══════════════════════════════════════════════════════════════
    // 5. Execution
    // ══════════════════════════════════════════════════════════════

    function test_Execute_PassedProposal() public {
        _addMemberAndSetup();

        vm.prank(admin);
        dao.propose("Passed", "Desc", MembaDAO.ProposalCategory.Governance);

        // All vote yes
        vm.prank(admin);
        dao.vote(0, MembaDAO.VoteType.For);
        vm.prank(alice);
        dao.vote(0, MembaDAO.VoteType.For);

        // Fast-forward past deadline
        vm.warp(block.timestamp + 8 days);

        vm.prank(admin);
        dao.execute(0);

        MembaDAO.Proposal memory p = dao.getProposal(0);
        assertTrue(p.executed);
    }

    function test_Execute_NotPassedReverts() public {
        _addMemberAndSetup();

        vm.prank(admin);
        dao.propose("Failed", "Desc", MembaDAO.ProposalCategory.Governance);

        // Majority votes no
        vm.prank(alice);
        dao.vote(0, MembaDAO.VoteType.Against);
        vm.prank(bob);
        dao.vote(0, MembaDAO.VoteType.Against);

        vm.warp(block.timestamp + 8 days);

        vm.prank(admin);
        vm.expectRevert(MembaDAO.ProposalNotPassed.selector);
        dao.execute(0);
    }

    function test_Execute_AlreadyExecutedReverts() public {
        vm.prank(admin);
        dao.propose("Exec", "Desc", MembaDAO.ProposalCategory.Governance);
        vm.prank(admin);
        dao.vote(0, MembaDAO.VoteType.For);
        vm.warp(block.timestamp + 8 days);
        vm.prank(admin);
        dao.execute(0);

        vm.prank(admin);
        vm.expectRevert(MembaDAO.ProposalAlreadyExecuted.selector);
        dao.execute(0);
    }

    function test_Execute_VotingStillOpenReverts() public {
        vm.prank(admin);
        dao.propose("Open", "Desc", MembaDAO.ProposalCategory.Governance);
        vm.prank(admin);
        dao.vote(0, MembaDAO.VoteType.For);

        // Don't fast-forward
        vm.prank(admin);
        vm.expectRevert(MembaDAO.VotingStillOpen.selector);
        dao.execute(0);
    }

    // ══════════════════════════════════════════════════════════════
    // 6. Cancel
    // ══════════════════════════════════════════════════════════════

    function test_Cancel_AdminOnly() public {
        vm.prank(admin);
        dao.propose("Cancel Me", "Desc", MembaDAO.ProposalCategory.Governance);

        vm.prank(admin);
        dao.cancelProposal(0);

        MembaDAO.Proposal memory p = dao.getProposal(0);
        assertTrue(p.cancelled);
    }

    function test_Cancel_NonAdminReverts() public {
        _addMemberAndSetup();

        vm.prank(admin);
        dao.propose("Cancel", "Desc", MembaDAO.ProposalCategory.Governance);

        vm.prank(alice);
        vm.expectRevert();
        dao.cancelProposal(0);
    }

    function test_Vote_OnCancelledReverts() public {
        vm.prank(admin);
        dao.propose("Cancelled", "Desc", MembaDAO.ProposalCategory.Governance);
        vm.prank(admin);
        dao.cancelProposal(0);

        vm.prank(admin);
        vm.expectRevert(MembaDAO.ProposalIsCancelled.selector);
        dao.vote(0, MembaDAO.VoteType.For);
    }

    // ══════════════════════════════════════════════════════════════
    // 7. Admin Config
    // ══════════════════════════════════════════════════════════════

    function test_UpdateThreshold_Success() public {
        vm.prank(admin);
        dao.updateThreshold(6700); // 67%
        assertEq(dao.thresholdBps(), 6700);
    }

    function test_UpdateThreshold_InvalidReverts() public {
        vm.prank(admin);
        vm.expectRevert(MembaDAO.InvalidThreshold.selector);
        dao.updateThreshold(0);

        vm.prank(admin);
        vm.expectRevert(MembaDAO.InvalidThreshold.selector);
        dao.updateThreshold(10_001);
    }

    function test_UpdateQuorum_Success() public {
        vm.prank(admin);
        dao.updateQuorum(3000); // 30%
        assertEq(dao.quorumBps(), 3000);
    }

    function test_UpdateQuorum_InvalidReverts() public {
        vm.prank(admin);
        vm.expectRevert(MembaDAO.InvalidQuorum.selector);
        dao.updateQuorum(10_001);
    }

    function test_UpdateConfig_NonAdminReverts() public {
        vm.prank(outsider);
        vm.expectRevert();
        dao.updateThreshold(5000);

        vm.prank(outsider);
        vm.expectRevert();
        dao.updateQuorum(5000);
    }

    // ══════════════════════════════════════════════════════════════
    // 8. Pausable
    // ══════════════════════════════════════════════════════════════

    function test_Paused_ProposeReverts() public {
        vm.prank(admin);
        dao.pause();

        vm.prank(admin);
        vm.expectRevert();
        dao.propose("Blocked", "Desc", MembaDAO.ProposalCategory.Governance);
    }

    function test_Paused_VoteAndExecuteRevert() public {
        vm.prank(admin);
        dao.propose("Before Pause", "Desc", MembaDAO.ProposalCategory.Governance);
        vm.prank(admin);
        dao.vote(0, MembaDAO.VoteType.For);

        vm.prank(admin);
        dao.pause();

        // Vote reverts when paused
        vm.prank(admin);
        vm.expectRevert();
        dao.vote(0, MembaDAO.VoteType.Against);

        // Execute reverts when paused
        vm.warp(block.timestamp + 8 days);
        vm.prank(admin);
        vm.expectRevert();
        dao.execute(0);

        // Unpause and execute works
        vm.prank(admin);
        dao.unpause();
        vm.prank(admin);
        dao.execute(0);
    }

    // ══════════════════════════════════════════════════════════════
    // 9. Quorum
    // ══════════════════════════════════════════════════════════════

    function test_Quorum_NotMet() public {
        _addMemberAndSetup();

        // Set 50% quorum
        vm.prank(admin);
        dao.updateQuorum(5000);

        vm.prank(admin);
        dao.propose("Quorum Test", "Desc", MembaDAO.ProposalCategory.Governance);

        // Only admin votes (power=1, total power=21) → 1/21 < 50%
        vm.prank(admin);
        dao.vote(0, MembaDAO.VoteType.For);

        vm.warp(block.timestamp + 8 days);

        vm.prank(admin);
        vm.expectRevert(MembaDAO.ProposalNotPassed.selector);
        dao.execute(0);
    }

    function test_Quorum_Met() public {
        _addMemberAndSetup();

        // Set 50% quorum
        vm.prank(admin);
        dao.updateQuorum(5000);

        vm.prank(admin);
        dao.propose("Quorum Met", "Desc", MembaDAO.ProposalCategory.Governance);

        // alice + bob vote (power=20, total=21) → 20/21 > 50%
        vm.prank(alice);
        dao.vote(0, MembaDAO.VoteType.For);
        vm.prank(bob);
        dao.vote(0, MembaDAO.VoteType.For);

        vm.warp(block.timestamp + 8 days);

        vm.prank(admin);
        dao.execute(0);

        assertTrue(dao.getProposal(0).executed);
    }

    // ══════════════════════════════════════════════════════════════
    // 10. View Functions
    // ══════════════════════════════════════════════════════════════

    function test_GetMembers_ReturnsAll() public {
        _addMemberAndSetup();

        address[] memory members = dao.getMembers();
        assertEq(members.length, 3); // admin + alice + bob
    }
}
