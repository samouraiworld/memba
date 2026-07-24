// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title MembaDAO
 * @author Samouraï Coop
 * @notice On-chain DAO governance: membership, proposals, voting, execution.
 *         Port of the Gno `memba_dao` realm to Solidity.
 * @dev UUPS-upgradeable. Uses ERC-7201 namespaced storage.
 *      Upgrade authority is the DEFAULT_ADMIN_ROLE (Samouraï Coop Safe).
 */
contract MembaDAO is AccessControlUpgradeable, UUPSUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    // ── Constants
    // ─────────────────────────────────────────────────
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MEMBER_ROLE = keccak256("MEMBER_ROLE");

    uint256 public constant MAX_VOTING_POWER = 1_000_000_000;
    uint256 public constant MAX_MEMBERS = 1000;
    uint256 public constant DEFAULT_VOTING_PERIOD = 7 days;

    // ── Enums
    // ─────────────────────────────────────────────────────
    enum ProposalCategory {
        Governance,
        Treasury,
        Membership,
        Operations
    }
    enum VoteType {
        Against,
        For,
        Abstain
    }

    // ── Structs
    // ───────────────────────────────────────────────────
    struct MemberInfo {
        uint256 votingPower;
        string[] roles;
        bool active;
        uint256 joinedAt;
    }

    struct Proposal {
        address proposer;
        string title;
        string description;
        ProposalCategory category;
        uint256 createdAt;
        uint256 votingDeadline;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool executed;
        bool cancelled;
    }

    // ── Storage (ERC-7201)
    // ────────────────────────────────────────
    /// @custom:storage-location erc7201:memba.storage.MembaDAO
    struct DAOStorage {
        string name;
        string description;
        uint16 thresholdBps; // 5100 = 51%
        uint16 quorumBps; // 0 = disabled
        uint256 proposalCount;
        uint256 memberCount;
        uint256 votingPeriod; // in seconds
        mapping(address => MemberInfo) members;
        address[] memberList;
        mapping(uint256 => Proposal) proposals;
        mapping(uint256 => mapping(address => bool)) hasVoted;
        mapping(uint256 => mapping(address => VoteType)) voteRecords;
    }

    // keccak256(abi.encode(uint256(keccak256("memba.storage.MembaDAO")) - 1)) & ~bytes32(uint256(0xff))
    /// @dev keccak256(abi.encode(uint256(keccak256("memba.storage.MembaDAO")) - 1)) & ~bytes32(uint256(0xff))
    /// @dev Asserted against its derivation in test/StorageSlots.t.sol — never edit by hand.
    bytes32 private constant STORAGE_LOCATION = 0x4d261dff0204067ecac5468a17cb3aa60be901272bc3a7a1e45f7ad10c8a7000;

    function _getStorage() private pure returns (DAOStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    // ── Errors
    // ────────────────────────────────────────────────────
    error InvalidThreshold();
    error InvalidQuorum();
    error AlreadyMember();
    error NotActiveMember();
    error ProposalNotFound();
    error AlreadyVoted();
    error VotingClosed();
    error VotingStillOpen();
    error ProposalNotPassed();
    error ProposalAlreadyExecuted();
    error ProposalIsCancelled();
    error InvalidVotingPower();
    error MemberListFull();
    error CannotRemoveSelf();
    error EmptyTitle();

    // ── Events
    // ────────────────────────────────────────────────────
    event DAOInitialized(string name, address indexed creator);
    event MemberAdded(address indexed member, uint256 votingPower, string[] roles);
    event MemberRemoved(address indexed member);
    event MemberUpdated(address indexed member, uint256 newVotingPower);
    event ProposalCreated(
        uint256 indexed proposalId, address indexed proposer, string title, ProposalCategory category
    );
    event Voted(uint256 indexed proposalId, address indexed voter, VoteType support, uint256 weight);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event ThresholdUpdated(uint16 oldThreshold, uint16 newThreshold);
    event QuorumUpdated(uint16 oldQuorum, uint16 newQuorum);

    // ── Constructor
    // ───────────────────────────────────────────────
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ── Initializer
    // ───────────────────────────────────────────────
    function initialize(string calldata _name, string calldata _description, address _admin) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        DAOStorage storage $ = _getStorage();
        $.name = _name;
        $.description = _description;
        $.thresholdBps = 5100; // 51% default
        $.quorumBps = 0; // disabled by default
        $.votingPeriod = DEFAULT_VOTING_PERIOD;

        // Admin is also a member
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(MEMBER_ROLE, _admin);

        string[] memory adminRoles = new string[](1);
        adminRoles[0] = "admin";
        $.members[_admin] = MemberInfo({ votingPower: 1, roles: adminRoles, active: true, joinedAt: block.timestamp });
        $.memberList.push(_admin);
        $.memberCount = 1;

        emit DAOInitialized(_name, _admin);
        emit MemberAdded(_admin, 1, adminRoles);
    }

    // ── Membership
    // ────────────────────────────────────────────────

    function addMember(address member, uint256 votingPower, string[] calldata roles) external onlyRole(ADMIN_ROLE) {
        DAOStorage storage $ = _getStorage();
        if ($.members[member].active) revert AlreadyMember();
        if (votingPower == 0 || votingPower > MAX_VOTING_POWER) revert InvalidVotingPower();
        if ($.memberCount >= MAX_MEMBERS) revert MemberListFull();

        _grantRole(MEMBER_ROLE, member);

        // Copy roles to storage
        string[] memory storedRoles = new string[](roles.length);
        for (uint256 i = 0; i < roles.length; i++) {
            storedRoles[i] = roles[i];
        }

        $.members[member] =
            MemberInfo({ votingPower: votingPower, roles: storedRoles, active: true, joinedAt: block.timestamp });
        $.memberList.push(member);
        $.memberCount++;

        emit MemberAdded(member, votingPower, roles);
    }

    function removeMember(address member) external onlyRole(ADMIN_ROLE) {
        DAOStorage storage $ = _getStorage();
        if (!$.members[member].active) revert NotActiveMember();

        _revokeRole(MEMBER_ROLE, member);
        $.members[member].active = false;
        $.memberCount--;

        // Remove from memberList (swap-and-pop)
        uint256 len = $.memberList.length;
        for (uint256 i = 0; i < len; i++) {
            if ($.memberList[i] == member) {
                $.memberList[i] = $.memberList[len - 1];
                $.memberList.pop();
                break;
            }
        }

        emit MemberRemoved(member);
    }

    // ── Proposals
    // ─────────────────────────────────────────────────

    function propose(string calldata title, string calldata description, ProposalCategory category)
        external
        onlyRole(MEMBER_ROLE)
        whenNotPaused
        returns (uint256)
    {
        if (bytes(title).length == 0) revert EmptyTitle();

        DAOStorage storage $ = _getStorage();
        uint256 proposalId = $.proposalCount++;

        $.proposals[proposalId] = Proposal({
            proposer: msg.sender,
            title: title,
            description: description,
            category: category,
            createdAt: block.timestamp,
            votingDeadline: block.timestamp + $.votingPeriod,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0,
            executed: false,
            cancelled: false
        });

        emit ProposalCreated(proposalId, msg.sender, title, category);
        return proposalId;
    }

    // ── Voting
    // ────────────────────────────────────────────────────

    function vote(uint256 proposalId, VoteType support) external onlyRole(MEMBER_ROLE) whenNotPaused {
        DAOStorage storage $ = _getStorage();
        Proposal storage proposal = $.proposals[proposalId];

        if (proposal.createdAt == 0) revert ProposalNotFound();
        if (proposal.cancelled) revert ProposalIsCancelled();
        if (block.timestamp > proposal.votingDeadline) revert VotingClosed();
        if ($.hasVoted[proposalId][msg.sender]) revert AlreadyVoted();

        uint256 weight = $.members[msg.sender].votingPower;
        $.hasVoted[proposalId][msg.sender] = true;
        $.voteRecords[proposalId][msg.sender] = support;

        if (support == VoteType.For) {
            proposal.forVotes += weight;
        } else if (support == VoteType.Against) {
            proposal.againstVotes += weight;
        } else {
            proposal.abstainVotes += weight;
        }

        emit Voted(proposalId, msg.sender, support, weight);
    }

    // ── Execution
    // ─────────────────────────────────────────────────

    function execute(uint256 proposalId) external onlyRole(MEMBER_ROLE) nonReentrant whenNotPaused {
        DAOStorage storage $ = _getStorage();
        Proposal storage proposal = $.proposals[proposalId];

        if (proposal.createdAt == 0) revert ProposalNotFound();
        if (proposal.cancelled) revert ProposalIsCancelled();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp <= proposal.votingDeadline) revert VotingStillOpen();
        if (!proposalPassed(proposalId)) revert ProposalNotPassed();

        // CEI: mark executed BEFORE any potential external calls
        proposal.executed = true;

        emit ProposalExecuted(proposalId);
    }

    function cancelProposal(uint256 proposalId) external onlyRole(ADMIN_ROLE) {
        DAOStorage storage $ = _getStorage();
        Proposal storage proposal = $.proposals[proposalId];

        if (proposal.createdAt == 0) revert ProposalNotFound();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (proposal.cancelled) revert ProposalIsCancelled();

        proposal.cancelled = true;
        emit ProposalCancelled(proposalId);
    }

    // ── Admin Config
    // ──────────────────────────────────────────────

    function updateThreshold(uint16 newThresholdBps) external onlyRole(ADMIN_ROLE) {
        if (newThresholdBps == 0 || newThresholdBps > 10_000) revert InvalidThreshold();
        DAOStorage storage $ = _getStorage();
        uint16 old = $.thresholdBps;
        $.thresholdBps = newThresholdBps;
        emit ThresholdUpdated(old, newThresholdBps);
    }

    function updateQuorum(uint16 newQuorumBps) external onlyRole(ADMIN_ROLE) {
        if (newQuorumBps > 10_000) revert InvalidQuorum();
        DAOStorage storage $ = _getStorage();
        uint16 old = $.quorumBps;
        $.quorumBps = newQuorumBps;
        emit QuorumUpdated(old, newQuorumBps);
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ── View Functions
    // ────────────────────────────────────────────

    function proposalPassed(uint256 proposalId) public view returns (bool) {
        DAOStorage storage $ = _getStorage();
        Proposal storage proposal = $.proposals[proposalId];

        uint256 totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
        if (totalVotes == 0) return false;

        // Quorum check: total votes / total voting power >= quorumBps / 10000
        if ($.quorumBps > 0) {
            uint256 totalPower = _totalVotingPower();
            if (totalPower > 0 && totalVotes * 10_000 < uint256($.quorumBps) * totalPower) {
                return false;
            }
        }

        // Threshold check: forVotes / (forVotes + againstVotes) >= thresholdBps / 10000
        // Abstain votes do NOT count toward threshold calculation
        uint256 decisive = proposal.forVotes + proposal.againstVotes;
        if (decisive == 0) return false; // Only abstains → not passed

        return proposal.forVotes * 10_000 >= uint256($.thresholdBps) * decisive;
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        DAOStorage storage $ = _getStorage();
        return $.proposals[proposalId];
    }

    function getMember(address addr) external view returns (MemberInfo memory) {
        DAOStorage storage $ = _getStorage();
        return $.members[addr];
    }

    function getMembers() external view returns (address[] memory) {
        DAOStorage storage $ = _getStorage();
        return $.memberList;
    }

    function isMember(address addr) external view returns (bool) {
        DAOStorage storage $ = _getStorage();
        return $.members[addr].active;
    }

    function name() external view returns (string memory) {
        return _getStorage().name;
    }

    function description() external view returns (string memory) {
        return _getStorage().description;
    }

    function thresholdBps() external view returns (uint16) {
        return _getStorage().thresholdBps;
    }

    function quorumBps() external view returns (uint16) {
        return _getStorage().quorumBps;
    }

    function proposalCount() external view returns (uint256) {
        return _getStorage().proposalCount;
    }

    function memberCount() external view returns (uint256) {
        return _getStorage().memberCount;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    // ── Internal
    // ──────────────────────────────────────────────────

    /// @dev MembaDAO deliberately does NOT use MembaUpgradeAuthority.
    ///
    ///      Every other contract needed it because their upgrade rights were pinned to
    ///      a single immutable address — on Badges and Quests, the backend hot key.
    ///      MembaDAO already uses AccessControlUpgradeable, so DEFAULT_ADMIN_ROLE is
    ///      grantable and revocable: the Safe can hand it to a TimelockController with
    ///      grantRole/revokeRole, which is the same outcome by an existing mechanism.
    ///      Adding a second, parallel authority here would give the contract two ways
    ///      to be upgraded, which is strictly worse than one.
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) { }

    function _totalVotingPower() internal view returns (uint256 total) {
        DAOStorage storage $ = _getStorage();
        uint256 len = $.memberList.length;
        for (uint256 i = 0; i < len; i++) {
            total += $.members[$.memberList[i]].votingPower;
        }
    }
}
