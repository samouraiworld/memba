// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from
    "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title MembaDAO
 * @author Samouraï Coop
 * @notice On-chain DAO governance: membership, proposals, voting, execution.
 *         Port of the Gno `memba_dao` realm to Solidity via OZ Governor patterns.
 * @dev UUPS-upgradeable. Upgrade authority is the Samouraï Coop Safe multisig.
 *
 * TODO: Implement per docs/evm-migration/CONTRACT_SPECS/MembaDAO.spec.md
 */
contract MembaDAO is AccessControlUpgradeable, UUPSUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    // ── Roles ─────────────────────────────────────────────────────
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MEMBER_ROLE = keccak256("MEMBER_ROLE");

    // ── Storage ───────────────────────────────────────────────────
    /// @custom:storage-location erc7201:memba.storage.MembaDAO
    struct DAOStorage {
        string name;
        string description;
        uint256 threshold; // voting threshold in basis points (5100 = 51%)
        uint256 quorum; // minimum participation in basis points
        uint256 proposalCount;
    }

    // ── Errors ────────────────────────────────────────────────────
    error NotMember();
    error NotAdmin();
    error InvalidThreshold();
    error InvalidQuorum();

    // ── Events ────────────────────────────────────────────────────
    event DAOInitialized(string name, address indexed creator);
    event MemberAdded(address indexed member, uint256 votingPower);
    event MemberRemoved(address indexed member);
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, string title);
    event Voted(uint256 indexed proposalId, address indexed voter, uint8 support);
    event ProposalExecuted(uint256 indexed proposalId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(string calldata _name, string calldata _description, address _admin) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(MEMBER_ROLE, _admin);

        // TODO: Initialize DAOStorage via ERC-7201 pattern
        emit DAOInitialized(_name, _admin);
    }

    // solhint-disable-next-line no-empty-blocks
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) { }

    /// @notice Returns the contract version for upgrade compatibility checks.
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
