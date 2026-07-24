// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import { MembaUpgradeAuthority } from "../lib/MembaUpgradeAuthority.sol";

/**
 * @title MembaEscrow
 * @author Samouraï Coop
 * @notice Milestone-based escrow for freelance/service marketplace.
 *         Port of the Gno `escrow_v3` realm.
 * @dev UUPS-upgradeable. ReentrancyGuard on ALL fund-moving functions.
 *      CEI pattern strictly enforced. Highest-risk contract — holds real user funds.
 */
contract MembaEscrow is UUPSUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable, MembaUpgradeAuthority {
    // ── Constants
    // ─────────────────────────────────────────────────
    uint256 public constant MAX_MILESTONES = 20;
    uint256 public constant MAX_TITLE_LEN = 256;
    uint256 public constant MIN_MILESTONE_AMOUNT = 0.001 ether;
    uint16 public constant MAX_FEE_BPS = 2000; // 20% cap
    /// @dev Bounds on the auto-refund window. Unbounded before: an admin could set 0
    ///      and make every funded milestone instantly refundable.
    uint256 public constant MIN_AUTO_REFUND = 1 days;
    uint256 public constant MAX_AUTO_REFUND = 365 days;

    // ── Enums
    // ─────────────────────────────────────────────────────
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
        Refunded
    }

    // ── Structs
    // ───────────────────────────────────────────────────
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
        /// @dev Auto-refund deadline snapshotted when the milestone is funded.
        ///      Previously the deadline was computed from the CURRENT global timeout
        ///      at claim time, so `updateTimeouts` retroactively changed the terms of
        ///      milestones that were already funded — setting it to 0 made every live
        ///      milestone instantly refundable. What a buyer is promised at funding
        ///      is now what they get.
        uint256 refundableAt;
    }

    // ── Storage (ERC-7201)
    // ────────────────────────────────────────
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
        /// @dev Pull-payment ledger. Every payout is attempted as a push first; if
        ///      the recipient rejects it, the amount is credited here instead of
        ///      reverting the whole transaction. Without this, a counterparty that is
        ///      a contract can arm `receive()` to revert and permanently freeze the
        ///      other party's funds — release, cancel and dispute resolution all
        ///      abort together, and there is no third path out.
        mapping(address => uint256) withdrawable;
    }

    // NOTE ON UPGRADES: fields in these structs are APPEND-ONLY. Inserting or
    // reordering a field relocates every field after it. See test/StorageSlots.t.sol.

    // keccak256(abi.encode(uint256(keccak256("memba.storage.MembaEscrow")) - 1)) & ~bytes32(uint256(0xff))
    /// @dev keccak256(abi.encode(uint256(keccak256("memba.storage.MembaEscrow")) - 1)) & ~bytes32(uint256(0xff))
    /// @dev Asserted against its derivation in test/StorageSlots.t.sol — never edit by hand.
    bytes32 private constant STORAGE_LOCATION = 0x06c2baaba768e2c688920095b37ec66d19b5cffc74cdb69dc62cd18fcd71bd00;

    function _getStorage() private pure returns (EscrowStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    // ── Errors
    // ────────────────────────────────────────────────────
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
    error NothingToWithdraw();
    error ContractDisputed();

    // ── Events
    // ────────────────────────────────────────────────────
    event ContractCreated(
        uint256 indexed id, address indexed buyer, address indexed seller, string title, uint256 milestoneCount
    );
    event MilestoneFunded(uint256 indexed contractId, uint256 indexed milestoneIdx, uint256 amount);
    event MilestoneCompleted(uint256 indexed contractId, uint256 indexed milestoneIdx);
    event FundsReleased(uint256 indexed contractId, uint256 indexed milestoneIdx, uint256 netAmount, uint256 fee);
    event FundsRefunded(uint256 indexed contractId, uint256 indexed milestoneIdx, uint256 amount);
    event DisputeRaised(uint256 indexed contractId, address indexed raisedBy);
    event DisputeResolved(uint256 indexed contractId, bool releasedToSeller, address indexed resolver);
    event ContractCancelled(uint256 indexed contractId, address indexed cancelledBy);
    event AutoRefundClaimed(uint256 indexed contractId, uint256 indexed milestoneIdx, uint256 amount);
    event PayoutCredited(address indexed to, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event TimeoutsUpdated(uint256 newAutoRefund);

    // ── Modifiers
    // ─────────────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != _getStorage().admin) revert NotAdmin();
        _;
    }

    // ── Constructor
    // ───────────────────────────────────────────────
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ── Initializer
    // ───────────────────────────────────────────────
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
        __MembaUpgradeAuthority_init(_admin);
        $.feeRecipient = _feeRecipient;
        $.platformFeeBps = _platformFeeBps;
        $.cancellationFeeBps = _cancellationFeeBps;
        $.autoRefundTimeout = _autoRefundTimeout;
    }

    // ── Contract Creation
    // ─────────────────────────────────────────

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
                fundedAt: 0,
                refundableAt: 0
            });
        }

        emit ContractCreated(contractId, msg.sender, seller, title, milestoneTitles.length);
    }

    // ── Funding
    // ───────────────────────────────────────────────────

    function fundMilestone(uint256 contractId, uint256 milestoneIdx) external payable nonReentrant whenNotPaused {
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
        // Snapshot the deadline so a later updateTimeouts cannot rewrite the terms
        // of a milestone that is already funded.
        ms.refundableAt = block.timestamp + $.autoRefundTimeout;
        sc.totalFunded += msg.value;

        emit MilestoneFunded(contractId, milestoneIdx, msg.value);
    }

    // ── Completion
    // ────────────────────────────────────────────────

    function completeMilestone(uint256 contractId, uint256 milestoneIdx) external nonReentrant whenNotPaused {
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

    // ── Release
    // ───────────────────────────────────────────────────

    function releaseFunds(uint256 contractId, uint256 milestoneIdx) external nonReentrant whenNotPaused {
        EscrowStorage storage $ = _getStorage();
        ServiceContract storage sc = $.contracts[contractId];

        if (msg.sender != sc.buyer) revert NotBuyer();
        if (sc.status == ContractStatus.Disputed) revert ContractIsDisputed();
        if (sc.status != ContractStatus.Active) revert ContractNotActive();
        if (milestoneIdx >= sc.milestoneCount) revert InvalidMilestoneIndex();

        Milestone storage ms = $.milestones[contractId][milestoneIdx];
        if (ms.status != MilestoneStatus.Completed) revert MilestoneNotCompleted();

        uint256 amount = ms.amount;
        uint256 fee = (amount * $.platformFeeBps) / 10_000;
        uint256 netAmount = amount - fee;

        // CEI: state update BEFORE transfers
        ms.status = MilestoneStatus.Released;
        sc.totalReleased += netAmount;

        _payout($, sc.seller, netAmount);
        _payout($, $.feeRecipient, fee);

        emit FundsReleased(contractId, milestoneIdx, netAmount, fee);

        // Check if all milestones released → contract completed
        _checkAllReleased($, contractId, sc);
    }

    // ── Payouts
    // ───────────────────────────────────────────────────

    /// @dev Pay `to`, and if the push fails, credit it for later withdrawal.
    ///
    ///      Every payout used to be `call{value:}` followed by `revert TransferFailed()`.
    ///      That gives any counterparty who is a contract a veto: arm `receive()` to
    ///      revert and `releaseFunds`, `cancelContract` and `resolveDispute` all abort
    ///      together, freezing the other party's funds with no way out. Worse, a
    ///      reverting `feeRecipient` bricked releases for every contract at once.
    ///
    ///      Crediting instead of reverting keeps one bad recipient from taking the
    ///      whole flow down. A fixed gas stipend stops a recipient burning the
    ///      caller's gas to force the credit path.
    function _payout(EscrowStorage storage $, address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = payable(to).call{ value: amount, gas: 30_000 }("");
        if (!ok) {
            $.withdrawable[to] += amount;
            emit PayoutCredited(to, amount);
        }
    }

    /// @notice Withdraw funds credited after a failed push.
    /// @dev Not pausable: a user must always be able to reclaim their own money.
    function withdraw() external nonReentrant {
        EscrowStorage storage $ = _getStorage();
        uint256 amount = $.withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        $.withdrawable[msg.sender] = 0; // CEI
        (bool ok,) = payable(msg.sender).call{ value: amount }("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Point protocol fees at a new recipient.
    /// @dev There was no setter at all. A compromised, destroyed or reverting fee
    ///      recipient was therefore unrecoverable without a contract upgrade.
    function setFeeRecipient(address newRecipient) external onlyAdmin {
        if (newRecipient == address(0)) revert InvalidParams();
        EscrowStorage storage $ = _getStorage();
        emit FeeRecipientUpdated($.feeRecipient, newRecipient);
        $.feeRecipient = newRecipient;
    }

    // ── Dispute
    // ───────────────────────────────────────────────────

    function dispute(uint256 contractId) external nonReentrant whenNotPaused {
        EscrowStorage storage $ = _getStorage();
        ServiceContract storage sc = $.contracts[contractId];

        if (msg.sender != sc.buyer && msg.sender != sc.seller) revert NotParty();
        if (sc.status != ContractStatus.Active) revert ContractNotActive();

        sc.status = ContractStatus.Disputed;
        sc.disputedAt = block.timestamp;

        emit DisputeRaised(contractId, msg.sender);
    }

    function resolveDispute(uint256 contractId, bool releaseFundsToSeller) external onlyAdmin nonReentrant {
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
                    uint256 fee = (amount * $.platformFeeBps) / 10_000;
                    uint256 netAmount = amount - fee;

                    ms.status = MilestoneStatus.Released;
                    sc.totalReleased += netAmount;

                    _payout($, sc.seller, netAmount);
                    _payout($, $.feeRecipient, fee);

                    emit FundsReleased(contractId, i, netAmount, fee);
                }
            }
        } else {
            // Refund all funded/completed milestones to buyer
            for (uint256 i = 0; i < sc.milestoneCount; i++) {
                Milestone storage ms = $.milestones[contractId][i];
                if (ms.status == MilestoneStatus.Funded || ms.status == MilestoneStatus.Completed) {
                    // Charge the same cancellation fee `cancelContract` charges. A
                    // full refund here let a buyer dispute purely to exit fee-free,
                    // which — paired with the seller-side path — made the escrow's
                    // entire fee model optional.
                    uint256 amount = ms.amount;
                    uint256 fee = (amount * $.cancellationFeeBps) / 10_000;
                    uint256 refundAmount = amount - fee;

                    ms.status = MilestoneStatus.Refunded;
                    sc.totalRefunded += refundAmount;

                    _payout($, sc.buyer, refundAmount);
                    _payout($, $.feeRecipient, fee);

                    emit FundsRefunded(contractId, i, refundAmount);
                }
            }
        }

        emit DisputeResolved(contractId, releaseFundsToSeller, msg.sender);
    }

    // ── Cancellation
    // ──────────────────────────────────────────────

    /**
     * @notice Cancel an active contract. Either party may cancel.
     *
     *         Funded milestones always refund to the buyer, minus the cancellation fee.
     *
     *         Completed milestones depend on WHO cancels:
     *           - buyer cancels  → released to the seller. The buyer is accepting the
     *                              work, so this is a real acceptance signal.
     *           - seller cancels → refunded to the buyer. The seller is walking away;
     *                              contested work must go through `dispute()`.
     *
     * @dev This asymmetry closes a critical fund-theft path. `completeMilestone` is a
     *      unilateral seller assertion — no buyer acceptance, no proof, no timelock —
     *      and the Completed branch here used to pay the seller the FULL amount with
     *      no fee. So a seller could self-certify every milestone, cancel, and leave
     *      with 100% of the escrow having delivered nothing, while the buyer's
     *      remedies (`dispute`, `claimAutoRefund`) both reverted.
     *
     *      The rule is simply: the party who cancels cannot direct funds to themselves.
     *
     * @dev NOT pausable — users must always be able to exit.
     */
    function cancelContract(uint256 contractId) external nonReentrant {
        EscrowStorage storage $ = _getStorage();
        ServiceContract storage sc = $.contracts[contractId];

        if (msg.sender != sc.buyer && msg.sender != sc.seller) revert NotParty();
        if (sc.status != ContractStatus.Active) revert ContractNotActive();

        bool cancelledByBuyer = msg.sender == sc.buyer;
        sc.status = ContractStatus.Cancelled;

        for (uint256 i = 0; i < sc.milestoneCount; i++) {
            Milestone storage ms = $.milestones[contractId][i];

            if (ms.status == MilestoneStatus.Funded || (ms.status == MilestoneStatus.Completed && !cancelledByBuyer)) {
                // Refund to buyer, minus the cancellation fee.
                uint256 amount = ms.amount;
                uint256 fee = (amount * $.cancellationFeeBps) / 10_000;
                uint256 refundAmount = amount - fee;

                ms.status = MilestoneStatus.Refunded;
                sc.totalRefunded += refundAmount;

                _payout($, sc.buyer, refundAmount);
                _payout($, $.feeRecipient, fee);

                emit FundsRefunded(contractId, i, refundAmount);
            } else if (ms.status == MilestoneStatus.Completed) {
                // Buyer is accepting the work — pay the seller, net of the platform
                // fee. The fee was previously skipped on this path, which let a buyer
                // and seller settle fee-free by cancelling instead of releasing.
                uint256 amount = ms.amount;
                uint256 fee = (amount * $.platformFeeBps) / 10_000;
                uint256 netAmount = amount - fee;

                ms.status = MilestoneStatus.Released;
                sc.totalReleased += netAmount;

                _payout($, sc.seller, netAmount);
                _payout($, $.feeRecipient, fee);

                emit FundsReleased(contractId, i, netAmount, fee);
            }
            // Pending → no action (no funds held)
        }

        emit ContractCancelled(contractId, msg.sender);
    }

    // ── Auto-Refund
    // ───────────────────────────────────────────────

    function claimAutoRefund(uint256 contractId, uint256 milestoneIdx) external nonReentrant {
        EscrowStorage storage $ = _getStorage();
        ServiceContract storage sc = $.contracts[contractId];

        if (msg.sender != sc.buyer) revert NotBuyer();
        // Every other fund-moving function checks the contract status; this one did
        // not. A buyer could raise a dispute, wait out the timeout, and drain the
        // contract before the arbiter ruled — making `resolveDispute` unenforceable.
        if (sc.status == ContractStatus.Disputed) revert ContractDisputed();
        if (sc.status != ContractStatus.Active) revert ContractNotActive();
        if (milestoneIdx >= sc.milestoneCount) revert InvalidMilestoneIndex();

        Milestone storage ms = $.milestones[contractId][milestoneIdx];
        // Completed counts too: otherwise a seller could void the buyer's only
        // unilateral remedy just by marking work done and then doing nothing. A
        // seller who has genuinely delivered protects their claim with `dispute()`,
        // which freezes this path.
        if (ms.status != MilestoneStatus.Funded && ms.status != MilestoneStatus.Completed) {
            revert MilestoneNotFunded();
        }
        if (block.timestamp < ms.refundableAt) revert AutoRefundNotReady();

        uint256 amount = ms.amount;

        // CEI: state update BEFORE transfer
        ms.status = MilestoneStatus.Refunded;
        sc.totalRefunded += amount;

        _payout($, sc.buyer, amount);

        emit AutoRefundClaimed(contractId, milestoneIdx, amount);
    }

    // ── Admin Config
    // ──────────────────────────────────────────────

    function updateFees(uint16 newPlatformBps, uint16 newCancellationBps) external onlyAdmin {
        if (newPlatformBps > MAX_FEE_BPS || newCancellationBps > MAX_FEE_BPS) revert InvalidFeeBps();
        EscrowStorage storage $ = _getStorage();
        $.platformFeeBps = newPlatformBps;
        $.cancellationFeeBps = newCancellationBps;
    }

    function updateTimeouts(uint256 newAutoRefund) external onlyAdmin {
        // Bounded, and forward-only: milestones snapshot their own `refundableAt` at
        // funding time, so this can no longer rewrite the terms of live escrows.
        if (newAutoRefund < MIN_AUTO_REFUND || newAutoRefund > MAX_AUTO_REFUND) revert InvalidParams();
        _getStorage().autoRefundTimeout = newAutoRefund;
        emit TimeoutsUpdated(newAutoRefund);
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    // ── View Functions
    // ────────────────────────────────────────────

    function getContract(uint256 contractId) external view returns (ServiceContract memory) {
        return _getStorage().contracts[contractId];
    }

    function getMilestone(uint256 contractId, uint256 idx) external view returns (Milestone memory) {
        return _getStorage().milestones[contractId][idx];
    }

    function admin() external view returns (address) {
        return _getStorage().admin;
    }

    function feeRecipient() external view returns (address) {
        return _getStorage().feeRecipient;
    }

    function platformFeeBps() external view returns (uint16) {
        return _getStorage().platformFeeBps;
    }

    function cancellationFeeBps() external view returns (uint16) {
        return _getStorage().cancellationFeeBps;
    }

    function autoRefundTimeout() external view returns (uint256) {
        return _getStorage().autoRefundTimeout;
    }

    function contractCount() external view returns (uint256) {
        return _getStorage().contractCount;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    // ── Internal
    // ──────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyUpgrader { }

    function _checkAllReleased(EscrowStorage storage $, uint256 contractId, ServiceContract storage sc) internal {
        for (uint256 i = 0; i < sc.milestoneCount; i++) {
            if ($.milestones[contractId][i].status != MilestoneStatus.Released) return;
        }
        sc.status = ContractStatus.Completed;
    }
}
