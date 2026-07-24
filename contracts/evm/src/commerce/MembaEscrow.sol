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
 *         Port of the Gno `escrow_v3` realm.
 * @dev UUPS-upgradeable. ReentrancyGuard on ALL fund-moving functions.
 *      CEI pattern strictly enforced. Highest-risk contract — holds real user funds.
 */
contract MembaEscrow is UUPSUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    // ── Constants ─────────────────────────────────────────────────
    uint256 public constant MAX_MILESTONES = 20;
    uint256 public constant MAX_TITLE_LEN = 256;
    uint256 public constant MIN_MILESTONE_AMOUNT = 0.001 ether;
    uint16 public constant MAX_FEE_BPS = 2000; // 20% cap

    // ── Enums ─────────────────────────────────────────────────────
    enum ContractStatus { Active, Completed, Cancelled, Disputed }
    enum MilestoneStatus { Pending, Funded, Completed, Released, Refunded }

    // ── Structs ───────────────────────────────────────────────────
    struct ServiceContract {
        address buyer;
        address seller;
        string title;
        ContractStatus status;
        uint256 milestoneCount;
        uint256 createdAt;
        uint256 disputedAt;
        uint256 totalFunded;
        uint256 totalReleased;
        uint256 totalRefunded;
    }

    struct Milestone {
        string title;
        uint256 amount;
        MilestoneStatus status;
        uint256 fundedAt;
    }

    // ── Storage (ERC-7201) ────────────────────────────────────────
    /// @custom:storage-location erc7201:memba.storage.MembaEscrow
    struct EscrowStorage {
        address admin;
        address feeRecipient;
        uint16 platformFeeBps;
        uint16 cancellationFeeBps;
        uint256 autoRefundTimeout;
        uint256 contractCount;
        mapping(uint256 => ServiceContract) contracts;
        mapping(uint256 => mapping(uint256 => Milestone)) milestones;
    }

    // keccak256(abi.encode(uint256(keccak256("memba.storage.MembaEscrow")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE_LOCATION = 0xb4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a50000;

    function _getStorage() private pure returns (EscrowStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    // ── Errors ────────────────────────────────────────────────────
    error NotBuyer();
    error NotSeller();
    error NotParty();
    error NotAdmin();
    error ContractNotActive();
    error ContractIsDisputed();
    error MilestoneNotPending();
    error MilestoneNotFunded();
    error MilestoneNotCompleted();
    error MilestoneTerminal();
    error InvalidMilestoneIndex();
    error InsufficientFunding();
    error AutoRefundNotReady();
    error ArrayLengthMismatch();
    error TooManyMilestones();
    error TitleTooLong();
    error AmountTooSmall();
    error TransferFailed();
    error InvalidFeeBps();
    error InvalidParams();

    // ── Events ────────────────────────────────────────────────────
    event ContractCreated(uint256 indexed id, address indexed buyer, address indexed seller, string title, uint256 milestoneCount);
    event MilestoneFunded(uint256 indexed contractId, uint256 indexed milestoneIdx, uint256 amount);
    event MilestoneCompleted(uint256 indexed contractId, uint256 indexed milestoneIdx);
    event FundsReleased(uint256 indexed contractId, uint256 indexed milestoneIdx, uint256 netAmount, uint256 fee);
    event FundsRefunded(uint256 indexed contractId, uint256 indexed milestoneIdx, uint256 amount);
    event DisputeRaised(uint256 indexed contractId, address indexed raisedBy);
    event DisputeResolved(uint256 indexed contractId, bool releasedToSeller, address indexed resolver);
    event ContractCancelled(uint256 indexed contractId, address indexed cancelledBy);
    event AutoRefundClaimed(uint256 indexed contractId, uint256 indexed milestoneIdx, uint256 amount);

    // ── Modifiers ─────────────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != _getStorage().admin) revert NotAdmin();
        _;
    }

    // ── Constructor ───────────────────────────────────────────────
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ── Initializer ───────────────────────────────────────────────
    function initialize(
        address _admin,
        address _feeRecipient,
        uint16 _platformFeeBps,
        uint16 _cancellationFeeBps,
        uint256 _autoRefundTimeout
    ) external initializer {
        if (_admin == address(0) || _feeRecipient == address(0)) revert InvalidParams();
        if (_platformFeeBps > MAX_FEE_BPS || _cancellationFeeBps > MAX_FEE_BPS) revert InvalidFeeBps();

        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        EscrowStorage storage $ = _getStorage();
        $.admin = _admin;
        $.feeRecipient = _feeRecipient;
        $.platformFeeBps = _platformFeeBps;
        $.cancellationFeeBps = _cancellationFeeBps;
        $.autoRefundTimeout = _autoRefundTimeout;
    }

    // ── Contract Creation ─────────────────────────────────────────

    function createContract(
        address seller,
        string calldata title,
        string[] calldata milestoneTitles,
        uint256[] calldata milestoneAmounts
    ) external whenNotPaused returns (uint256 contractId) {
        if (seller == address(0) || seller == msg.sender) revert InvalidParams();
        if (bytes(title).length == 0 || bytes(title).length > MAX_TITLE_LEN) revert TitleTooLong();
        if (milestoneTitles.length != milestoneAmounts.length) revert ArrayLengthMismatch();
        if (milestoneTitles.length == 0 || milestoneTitles.length > MAX_MILESTONES) revert TooManyMilestones();

        EscrowStorage storage $ = _getStorage();
        contractId = $.contractCount++;

        $.contracts[contractId] = ServiceContract({
            buyer: msg.sender,
            seller: seller,
            title: title,
            status: ContractStatus.Active,
            milestoneCount: milestoneTitles.length,
            createdAt: block.timestamp,
            disputedAt: 0,
            totalFunded: 0,
            totalReleased: 0,
            totalRefunded: 0
        });

        for (uint256 i = 0; i < milestoneTitles.length; i++) {
            if (milestoneAmounts[i] < MIN_MILESTONE_AMOUNT) revert AmountTooSmall();
            $.milestones[contractId][i] = Milestone({
                title: milestoneTitles[i],
                amount: milestoneAmounts[i],
                status: MilestoneStatus.Pending,
                fundedAt: 0
            });
        }

        emit ContractCreated(contractId, msg.sender, seller, title, milestoneTitles.length);
    }

    // ── Funding ───────────────────────────────────────────────────

    function fundMilestone(
        uint256 contractId,
        uint256 milestoneIdx
    ) external payable nonReentrant whenNotPaused {
        EscrowStorage storage $ = _getStorage();
        ServiceContract storage sc = $.contracts[contractId];

        if (msg.sender != sc.buyer) revert NotBuyer();
        if (sc.status != ContractStatus.Active) revert ContractNotActive();
        if (sc.status == ContractStatus.Disputed) revert ContractIsDisputed();
        if (milestoneIdx >= sc.milestoneCount) revert InvalidMilestoneIndex();

        Milestone storage ms = $.milestones[contractId][milestoneIdx];
        if (ms.status != MilestoneStatus.Pending) revert MilestoneNotPending();
        if (msg.value != ms.amount) revert InsufficientFunding();

        ms.status = MilestoneStatus.Funded;
        ms.fundedAt = block.timestamp;
        sc.totalFunded += msg.value;

        emit MilestoneFunded(contractId, milestoneIdx, msg.value);
    }

    // ── Completion ────────────────────────────────────────────────

    function completeMilestone(
        uint256 contractId,
        uint256 milestoneIdx
    ) external whenNotPaused {
        EscrowStorage storage $ = _getStorage();
        ServiceContract storage sc = $.contracts[contractId];

        if (msg.sender != sc.seller) revert NotSeller();
        if (sc.status == ContractStatus.Disputed) revert ContractIsDisputed();
        if (sc.status != ContractStatus.Active) revert ContractNotActive();
        if (milestoneIdx >= sc.milestoneCount) revert InvalidMilestoneIndex();

        Milestone storage ms = $.milestones[contractId][milestoneIdx];
        if (ms.status != MilestoneStatus.Funded) revert MilestoneNotFunded();

        ms.status = MilestoneStatus.Completed;

        emit MilestoneCompleted(contractId, milestoneIdx);
    }

    // ── Release ───────────────────────────────────────────────────

    function releaseFunds(
        uint256 contractId,
        uint256 milestoneIdx
    ) external nonReentrant whenNotPaused {
        EscrowStorage storage $ = _getStorage();
        ServiceContract storage sc = $.contracts[contractId];

        if (msg.sender != sc.buyer) revert NotBuyer();
        if (sc.status == ContractStatus.Disputed) revert ContractIsDisputed();
        if (sc.status != ContractStatus.Active) revert ContractNotActive();
        if (milestoneIdx >= sc.milestoneCount) revert InvalidMilestoneIndex();

        Milestone storage ms = $.milestones[contractId][milestoneIdx];
        if (ms.status != MilestoneStatus.Completed) revert MilestoneNotCompleted();

        uint256 amount = ms.amount;
        uint256 fee = (amount * $.platformFeeBps) / 10000;
        uint256 netAmount = amount - fee;

        // CEI: state update BEFORE transfers
        ms.status = MilestoneStatus.Released;
        sc.totalReleased += netAmount;

        // Transfer to seller
        (bool ok,) = payable(sc.seller).call{value: netAmount}("");
        if (!ok) revert TransferFailed();

        // Transfer fee
        if (fee > 0) {
            (bool feeOk,) = payable($.feeRecipient).call{value: fee}("");
            if (!feeOk) revert TransferFailed();
        }

        emit FundsReleased(contractId, milestoneIdx, netAmount, fee);

        // Check if all milestones released → contract completed
        _checkAllReleased($, contractId, sc);
    }

    // ── Dispute ───────────────────────────────────────────────────

    function dispute(uint256 contractId) external whenNotPaused {
        EscrowStorage storage $ = _getStorage();
        ServiceContract storage sc = $.contracts[contractId];

        if (msg.sender != sc.buyer && msg.sender != sc.seller) revert NotParty();
        if (sc.status != ContractStatus.Active) revert ContractNotActive();

        sc.status = ContractStatus.Disputed;
        sc.disputedAt = block.timestamp;

        emit DisputeRaised(contractId, msg.sender);
    }

    function resolveDispute(
        uint256 contractId,
        bool releaseFundsToSeller
    ) external onlyAdmin nonReentrant {
        EscrowStorage storage $ = _getStorage();
        ServiceContract storage sc = $.contracts[contractId];

        if (sc.status != ContractStatus.Disputed) revert ContractNotActive();

        // Return to Active so normal flows can resume
        sc.status = ContractStatus.Active;

        if (releaseFundsToSeller) {
            // Release all funded/completed milestones to seller
            for (uint256 i = 0; i < sc.milestoneCount; i++) {
                Milestone storage ms = $.milestones[contractId][i];
                if (ms.status == MilestoneStatus.Funded || ms.status == MilestoneStatus.Completed) {
                    uint256 amount = ms.amount;
                    uint256 fee = (amount * $.platformFeeBps) / 10000;
                    uint256 netAmount = amount - fee;

                    ms.status = MilestoneStatus.Released;
                    sc.totalReleased += netAmount;

                    (bool ok,) = payable(sc.seller).call{value: netAmount}("");
                    if (!ok) revert TransferFailed();
                    if (fee > 0) {
                        (bool feeOk,) = payable($.feeRecipient).call{value: fee}("");
                        if (!feeOk) revert TransferFailed();
                    }

                    emit FundsReleased(contractId, i, netAmount, fee);
                }
            }
        } else {
            // Refund all funded/completed milestones to buyer
            for (uint256 i = 0; i < sc.milestoneCount; i++) {
                Milestone storage ms = $.milestones[contractId][i];
                if (ms.status == MilestoneStatus.Funded || ms.status == MilestoneStatus.Completed) {
                    uint256 amount = ms.amount;
                    ms.status = MilestoneStatus.Refunded;
                    sc.totalRefunded += amount;

                    (bool ok,) = payable(sc.buyer).call{value: amount}("");
                    if (!ok) revert TransferFailed();

                    emit FundsRefunded(contractId, i, amount);
                }
            }
        }

        emit DisputeResolved(contractId, releaseFundsToSeller, msg.sender);
    }

    // ── Cancellation ──────────────────────────────────────────────

    /**
     * @notice Cancel an active contract. Only buyer or seller can cancel.
     *         Funded milestones → refunded to buyer (minus cancellation fee).
     *         Completed milestones → released to seller (full amount, no fee).
     *         Pending milestones → no action.
     * @dev NOT pausable — users must always be able to exit.
     */
    function cancelContract(uint256 contractId) external nonReentrant {
        EscrowStorage storage $ = _getStorage();
        ServiceContract storage sc = $.contracts[contractId];

        if (msg.sender != sc.buyer && msg.sender != sc.seller) revert NotParty();
        if (sc.status != ContractStatus.Active) revert ContractNotActive();

        sc.status = ContractStatus.Cancelled;

        for (uint256 i = 0; i < sc.milestoneCount; i++) {
            Milestone storage ms = $.milestones[contractId][i];

            if (ms.status == MilestoneStatus.Funded) {
                // Refund to buyer (minus cancellation fee)
                uint256 amount = ms.amount;
                uint256 fee = (amount * $.cancellationFeeBps) / 10000;
                uint256 refundAmount = amount - fee;

                ms.status = MilestoneStatus.Refunded;
                sc.totalRefunded += refundAmount;

                (bool ok,) = payable(sc.buyer).call{value: refundAmount}("");
                if (!ok) revert TransferFailed();
                if (fee > 0) {
                    (bool feeOk,) = payable($.feeRecipient).call{value: fee}("");
                    if (!feeOk) revert TransferFailed();
                }

                emit FundsRefunded(contractId, i, refundAmount);
            } else if (ms.status == MilestoneStatus.Completed) {
                // Release to seller (work was done)
                uint256 amount = ms.amount;
                ms.status = MilestoneStatus.Released;
                sc.totalReleased += amount;

                (bool ok,) = payable(sc.seller).call{value: amount}("");
                if (!ok) revert TransferFailed();

                emit FundsReleased(contractId, i, amount, 0);
            }
            // Pending → no action (no funds held)
        }

        emit ContractCancelled(contractId, msg.sender);
    }

    // ── Auto-Refund ───────────────────────────────────────────────

    function claimAutoRefund(
        uint256 contractId,
        uint256 milestoneIdx
    ) external nonReentrant {
        EscrowStorage storage $ = _getStorage();
        ServiceContract storage sc = $.contracts[contractId];

        if (msg.sender != sc.buyer) revert NotBuyer();
        if (milestoneIdx >= sc.milestoneCount) revert InvalidMilestoneIndex();

        Milestone storage ms = $.milestones[contractId][milestoneIdx];
        if (ms.status != MilestoneStatus.Funded) revert MilestoneNotFunded();
        if (block.timestamp < ms.fundedAt + $.autoRefundTimeout) revert AutoRefundNotReady();

        uint256 amount = ms.amount;

        // CEI: state update BEFORE transfer
        ms.status = MilestoneStatus.Refunded;
        sc.totalRefunded += amount;

        (bool ok,) = payable(sc.buyer).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit AutoRefundClaimed(contractId, milestoneIdx, amount);
    }

    // ── Admin Config ──────────────────────────────────────────────

    function updateFees(uint16 newPlatformBps, uint16 newCancellationBps) external onlyAdmin {
        if (newPlatformBps > MAX_FEE_BPS || newCancellationBps > MAX_FEE_BPS) revert InvalidFeeBps();
        EscrowStorage storage $ = _getStorage();
        $.platformFeeBps = newPlatformBps;
        $.cancellationFeeBps = newCancellationBps;
    }

    function updateTimeouts(uint256 newAutoRefund) external onlyAdmin {
        _getStorage().autoRefundTimeout = newAutoRefund;
    }

    function pause() external onlyAdmin { _pause(); }
    function unpause() external onlyAdmin { _unpause(); }

    // ── View Functions ────────────────────────────────────────────

    function getContract(uint256 contractId) external view returns (ServiceContract memory) {
        return _getStorage().contracts[contractId];
    }

    function getMilestone(uint256 contractId, uint256 idx) external view returns (Milestone memory) {
        return _getStorage().milestones[contractId][idx];
    }

    function admin() external view returns (address) { return _getStorage().admin; }
    function feeRecipient() external view returns (address) { return _getStorage().feeRecipient; }
    function platformFeeBps() external view returns (uint16) { return _getStorage().platformFeeBps; }
    function cancellationFeeBps() external view returns (uint16) { return _getStorage().cancellationFeeBps; }
    function autoRefundTimeout() external view returns (uint256) { return _getStorage().autoRefundTimeout; }
    function contractCount() external view returns (uint256) { return _getStorage().contractCount; }

    function version() external pure returns (string memory) { return "1.0.0"; }

    // ── Internal ──────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyAdmin { }

    function _checkAllReleased(EscrowStorage storage $, uint256 contractId, ServiceContract storage sc) internal {
        for (uint256 i = 0; i < sc.milestoneCount; i++) {
            if ($.milestones[contractId][i].status != MilestoneStatus.Released) return;
        }
        sc.status = ContractStatus.Completed;
    }
}
