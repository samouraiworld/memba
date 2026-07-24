// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from
    "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title MembaEscrow
 * @author Samouraï Coop
 * @notice Milestone-based escrow for freelance/service marketplace.
 *         Port of the Gno `escrow_v3` realm to Solidity.
 *
 *         Flow: createContract → fundMilestone → completeMilestone → releaseFunds
 *         Disputes: dispute → resolveDispute (DAO-governed arbitration)
 *         Safety: cancelContract with refund logic, auto-refund timeout
 *
 * @dev UUPS-upgradeable. ReentrancyGuard on ALL fund-moving functions.
 *      Follows Checks-Effects-Interactions pattern strictly.
 *
 * TODO: Implement per docs/evm-migration/CONTRACT_SPECS/MembaEscrow.spec.md
 */
contract MembaEscrow is UUPSUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    // ── Enums ─────────────────────────────────────────────────────
    enum ContractStatus {
        Active,
        Completed,
        Cancelled,
        Disputed
    }

    enum MilestoneStatus {
        Pending,
        Funded,
        Completed,
        Released,
        Refunded,
        Disputed
    }

    // ── Structs ───────────────────────────────────────────────────
    struct Milestone {
        string title;
        uint256 amount;
        MilestoneStatus status;
        uint256 fundedAt; // block.timestamp when funded
    }

    struct ServiceContract {
        address buyer;
        address seller;
        string title;
        ContractStatus status;
        uint256 milestoneCount;
        uint256 createdAt;
    }

    // ── Storage ───────────────────────────────────────────────────
    address public admin;
    address public feeRecipient;
    uint16 public platformFeeBps; // e.g. 200 = 2%
    uint16 public cancellationFeeBps; // e.g. 500 = 5%
    uint256 public autoRefundTimeout; // seconds
    uint256 public contractCount;

    // ── Events ────────────────────────────────────────────────────
    event ContractCreated(uint256 indexed contractId, address indexed buyer, address indexed seller, string title);
    event MilestoneFunded(uint256 indexed contractId, uint256 indexed milestoneIndex, uint256 amount);
    event MilestoneCompleted(uint256 indexed contractId, uint256 indexed milestoneIndex);
    event FundsReleased(uint256 indexed contractId, uint256 indexed milestoneIndex, uint256 amount);
    event DisputeRaised(uint256 indexed contractId, address indexed raisedBy);
    event DisputeResolved(uint256 indexed contractId, address indexed resolver);
    event ContractCancelled(uint256 indexed contractId);
    event FeeCollected(uint256 indexed contractId, uint256 feeAmount);

    // ── Errors ────────────────────────────────────────────────────
    error NotAdmin();
    error NotBuyer();
    error NotSeller();
    error NotParty();
    error InvalidStatus();
    error InvalidMilestone();
    error AlreadyFunded();
    error NotFunded();
    error ContractDisputed();
    error TransferFailed();
    error InvalidParams();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _admin,
        address _feeRecipient,
        uint16 _platformFeeBps,
        uint16 _cancellationFeeBps,
        uint256 _autoRefundTimeout
    ) external initializer {
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        if (_admin == address(0) || _feeRecipient == address(0)) revert InvalidParams();
        admin = _admin;
        feeRecipient = _feeRecipient;
        platformFeeBps = _platformFeeBps;
        cancellationFeeBps = _cancellationFeeBps;
        autoRefundTimeout = _autoRefundTimeout;
    }

    // solhint-disable-next-line no-empty-blocks
    function _authorizeUpgrade(address) internal override {
        if (msg.sender != admin) revert NotAdmin();
    }

    /// @notice Returns the contract version.
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
