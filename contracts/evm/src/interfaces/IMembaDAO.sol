// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IMembaDAO
 * @notice Interface for MembaDAO — used by the Chain Abstraction Layer (CAL)
 *         to interact with DAO contracts regardless of chain family.
 *
 * TODO: Expand as MembaDAO.sol implementation progresses.
 */
interface IMembaDAO {
    // ── Events
    // ────────────────────────────────────────────────────
    event DAOInitialized(string name, address indexed creator);
    event MemberAdded(address indexed member, uint256 votingPower);
    event MemberRemoved(address indexed member);
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, string title);
    event Voted(uint256 indexed proposalId, address indexed voter, uint8 support);
    event ProposalExecuted(uint256 indexed proposalId);

    // ── Views
    // ─────────────────────────────────────────────────────
    function version() external pure returns (string memory);
}
