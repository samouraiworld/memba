// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from
    "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

interface IMembaDAO {
    function isMember(address addr) external view returns (bool);
    function addMember(address member, uint256 power, string[] calldata roles) external;
}

/**
 * @title MembaCandidature
 * @author Samouraï Coop
 * @notice DAO membership application flow: apply with deposit → admin approves/rejects → withdraw.
 *         Port of the Gno `memba_dao_candidature_v3` realm.
 * @dev UUPS-upgradeable. Deposit escalation: re-applications require 10x deposit.
 */
contract MembaCandidature is UUPSUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    // ── Enums ─────────────────────────────────────────────────────
    enum ApplicationStatus { None, Pending, Approved, Rejected, Withdrawn }

    // ── Structs ───────────────────────────────────────────────────
    struct Application {
        string bio;
        string skills;
        uint256 deposit;
        ApplicationStatus status;
        uint256 appliedAt;
        uint256 resolvedAt;
    }

    // ── Storage (ERC-7201) ────────────────────────────────────────
    /// @custom:storage-location erc7201:memba.storage.MembaCandidature
    struct CandidatureStorage {
        address daoContract;
        address admin;
        uint256 minDeposit;
        uint256 depositMultiplier;
        uint256 applicationCount;
        mapping(address => Application) applications;
        address[] applicantList;
        mapping(address => uint256) applyCount;
    }

    // keccak256(abi.encode(uint256(keccak256("memba.storage.MembaCandidature")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE_LOCATION = 0x9e0f70f3a93d2a0b3be05d1c3c58e4a26f59c5f77b4c5b0a89ddd3ee5b2a8e00;

    function _getStorage() private pure returns (CandidatureStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    // ── Errors ────────────────────────────────────────────────────
    error AlreadyPending();
    error AlreadyMember();
    error InsufficientDeposit();
    error NotPending();
    error NotWithdrawable();
    error NotAdmin();
    error TransferFailed();
    error InvalidParams();

    // ── Events ────────────────────────────────────────────────────
    event ApplicationSubmitted(address indexed applicant, uint256 deposit, uint256 applyCount);
    event ApplicationApproved(address indexed applicant, address indexed approvedBy);
    event ApplicationRejected(address indexed applicant, address indexed rejectedBy);
    event DepositWithdrawn(address indexed applicant, uint256 amount);
    event MinDepositUpdated(uint256 oldMin, uint256 newMin);

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
        address _dao,
        address _admin,
        uint256 _minDeposit
    ) external initializer {
        if (_dao == address(0) || _admin == address(0)) revert InvalidParams();

        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        CandidatureStorage storage $ = _getStorage();
        $.daoContract = _dao;
        $.admin = _admin;
        $.minDeposit = _minDeposit;
        $.depositMultiplier = 10; // 10x per re-application
    }

    // ── Application ───────────────────────────────────────────────

    /**
     * @notice Submit a candidature with a bio and skills description.
     * @dev Requires deposit >= getRequiredDeposit(msg.sender).
     *      Re-applications require 10x the previous deposit.
     */
    function submitApplication(string calldata bio, string calldata skills) external payable whenNotPaused {
        CandidatureStorage storage $ = _getStorage();

        // Cannot apply if already a DAO member
        if (IMembaDAO($.daoContract).isMember(msg.sender)) revert AlreadyMember();

        // Cannot apply if already pending
        if ($.applications[msg.sender].status == ApplicationStatus.Pending) revert AlreadyPending();

        // Check deposit
        uint256 required = _requiredDeposit($, msg.sender);
        if (msg.value < required) revert InsufficientDeposit();

        // Track re-applications
        $.applyCount[msg.sender]++;

        $.applications[msg.sender] = Application({
            bio: bio,
            skills: skills,
            deposit: msg.value,
            status: ApplicationStatus.Pending,
            appliedAt: block.timestamp,
            resolvedAt: 0
        });
        $.applicantList.push(msg.sender);
        $.applicationCount++;

        emit ApplicationSubmitted(msg.sender, msg.value, $.applyCount[msg.sender]);
    }

    // ── Admin Actions ─────────────────────────────────────────────

    /**
     * @notice Approve a pending application. Adds the applicant as a DAO member.
     */
    function markApproved(address applicant) external onlyAdmin whenNotPaused {
        CandidatureStorage storage $ = _getStorage();
        Application storage app = $.applications[applicant];
        if (app.status != ApplicationStatus.Pending) revert NotPending();

        // CEI: update status BEFORE external call
        app.status = ApplicationStatus.Approved;
        app.resolvedAt = block.timestamp;

        // Add to DAO
        string[] memory roles = new string[](1);
        roles[0] = "member";
        IMembaDAO($.daoContract).addMember(applicant, 1, roles);

        emit ApplicationApproved(applicant, msg.sender);
    }

    /**
     * @notice Reject a pending application. Deposit stays for user withdrawal.
     */
    function markRejected(address applicant) external onlyAdmin {
        CandidatureStorage storage $ = _getStorage();
        Application storage app = $.applications[applicant];
        if (app.status != ApplicationStatus.Pending) revert NotPending();

        app.status = ApplicationStatus.Rejected;
        app.resolvedAt = block.timestamp;

        emit ApplicationRejected(applicant, msg.sender);
    }

    // ── Withdrawal ────────────────────────────────────────────────

    /**
     * @notice Withdraw deposit from a pending or rejected application.
     * @dev NOT pausable — users must always be able to reclaim their funds.
     */
    function withdraw() external nonReentrant {
        CandidatureStorage storage $ = _getStorage();
        Application storage app = $.applications[msg.sender];

        ApplicationStatus s = app.status;
        if (s != ApplicationStatus.Pending && s != ApplicationStatus.Rejected) {
            revert NotWithdrawable();
        }

        uint256 amount = app.deposit;

        // CEI: update state BEFORE transfer
        app.status = ApplicationStatus.Withdrawn;
        app.resolvedAt = block.timestamp;
        app.deposit = 0;

        // Transfer ETH
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit DepositWithdrawn(msg.sender, amount);
    }

    // ── Admin Config ──────────────────────────────────────────────

    function updateMinDeposit(uint256 newMin) external onlyAdmin {
        CandidatureStorage storage $ = _getStorage();
        uint256 old = $.minDeposit;
        $.minDeposit = newMin;
        emit MinDepositUpdated(old, newMin);
    }

    function updateDAO(address newDAO) external onlyAdmin {
        if (newDAO == address(0)) revert InvalidParams();
        _getStorage().daoContract = newDAO;
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    // ── View Functions ────────────────────────────────────────────

    function getApplication(address applicant) external view returns (Application memory) {
        return _getStorage().applications[applicant];
    }

    function getApplicants() external view returns (address[] memory) {
        return _getStorage().applicantList;
    }

    function getRequiredDeposit(address applicant) external view returns (uint256) {
        return _requiredDeposit(_getStorage(), applicant);
    }

    function admin() external view returns (address) {
        return _getStorage().admin;
    }

    function daoContract() external view returns (address) {
        return _getStorage().daoContract;
    }

    function minDeposit() external view returns (uint256) {
        return _getStorage().minDeposit;
    }

    function applicationCount() external view returns (uint256) {
        return _getStorage().applicationCount;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    // ── Internal ──────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyAdmin { }

    /**
     * @dev Calculate required deposit: minDeposit * multiplier^(applyCount).
     *      Uses checked math — reverts on overflow.
     */
    function _requiredDeposit(CandidatureStorage storage $, address applicant) internal view returns (uint256) {
        uint256 count = $.applyCount[applicant];
        if (count == 0) return $.minDeposit;

        uint256 required = $.minDeposit;
        uint256 mult = $.depositMultiplier;
        for (uint256 i = 0; i < count; i++) {
            required = required * mult; // checked math — reverts on overflow
        }
        return required;
    }
}
