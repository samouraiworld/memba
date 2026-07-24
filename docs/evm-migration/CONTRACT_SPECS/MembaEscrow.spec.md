# Contract: MembaEscrow.sol

## Purpose

MembaEscrow implements a milestone-based escrow system for the freelance/service marketplace. Buyers create service contracts with defined milestones, fund each milestone individually, and sellers complete work to trigger fund release. Disputes are resolved by a DAO-governed arbitrator. The contract enforces platform fees, cancellation fees, auto-refund timeouts, and a dispute freeze mechanism.

This is the most complex and highest-risk contract in the Memba EVM suite — it holds real user funds.

Port of the Gno `escrow_v3` realm.

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/escrow` (v1 on test12), `escrow_v2` (test13), `escrow_v3` (topaz-1)
- **Frontend template**: `frontend/src/lib/escrowTemplate.ts` (696 lines, 22KB)
- **Refund parity**: W1.6 PARITY (R2-CHN-A) — refund state machine mirrors deployed `escrow_v2`
- **Key Gno functions**: `CreateContract()`, `FundMilestone()`, `CompleteMilestone()`, `ReleaseFunds()`, `CancelContract()`, `Dispute()`, `ResolveDispute()`
- **Known gaps vs escrow_v2**: Pause/Unpause, ClaimRefund/ClaimDisputeTimeout timeouts, PreDisputeStatus, input caps (MaxTitleLen/MaxMilestones/MinMilestoneAmount), chain.Emit events, renderStats

## Solidity Requirements

### Inheritance

- `UUPSUpgradeable` — upgrade mechanism
- `PausableUpgradeable` — circuit breaker
- `ReentrancyGuardUpgradeable` — **CRITICAL: on ALL fund-moving functions**

### State Machine

```
                    ┌──────────────┐
                    │   Active     │◄───── createContract()
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        cancelContract  dispute()   all milestones
              │            │         released
              ▼            ▼            ▼
        ┌─────────┐  ┌──────────┐  ┌───────────┐
        │Cancelled│  │ Disputed │  │ Completed │
        └─────────┘  └────┬─────┘  └───────────┘
                          │
                   resolveDispute()
                          │
                          ▼
                    ┌──────────────┐
                    │   Active     │  (returns to Active)
                    └──────────────┘
```

Milestone state machine:
```
Pending → Funded → Completed → Released
                              → Refunded (via cancel/dispute)
         → Refunded (via cancel, if funded but not completed)
```

### Storage

```solidity
/// @custom:storage-location erc7201:memba.storage.MembaEscrow
struct EscrowStorage {
    address admin;                // Platform admin (arbitration authority)
    address feeRecipient;         // Fee recipient (Samouraï Coop Safe)
    uint16 platformFeeBps;        // e.g. 200 = 2.0%
    uint16 cancellationFeeBps;    // e.g. 500 = 5.0%
    uint256 autoRefundTimeout;    // seconds — after this, buyer can claim refund
    uint256 autoResolveTimeout;   // seconds — after this, dispute auto-resolves to seller
    uint256 contractCount;

    mapping(uint256 => ServiceContract) contracts;
    mapping(uint256 => mapping(uint256 => Milestone)) milestones;
}

enum ContractStatus {
    Active,       // 0
    Completed,    // 1
    Cancelled,    // 2
    Disputed      // 3
}

enum MilestoneStatus {
    Pending,      // 0 — created, awaiting funding
    Funded,       // 1 — buyer deposited funds
    Completed,    // 2 — seller marked work done
    Released,     // 3 — funds sent to seller (TERMINAL)
    Refunded,     // 4 — funds returned to buyer (TERMINAL)
    Disputed      // 5 — under dispute
}

struct ServiceContract {
    address buyer;
    address seller;
    string title;
    ContractStatus status;
    uint256 milestoneCount;
    uint256 createdAt;
    uint256 disputedAt;           // Timestamp of last dispute (for auto-resolve)
    uint256 totalFunded;          // Running total of ETH funded
    uint256 totalReleased;        // Running total of ETH released to seller
    uint256 totalRefunded;        // Running total of ETH refunded to buyer
}

struct Milestone {
    string title;
    uint256 amount;               // Expected payment in wei
    MilestoneStatus status;
    uint256 fundedAt;             // block.timestamp when funded (for auto-refund)
}
```

### Functions (with signatures)

| Function | Visibility | Modifiers | Description |
|---|---|---|---|
| `initialize(admin, feeRecipient, platformFeeBps, cancellationFeeBps, autoRefundTimeout)` | `external` | `initializer` | Set config |
| `createContract(address seller, string title, string[] milestoneTitles, uint256[] milestoneAmounts)` | `external` | `whenNotPaused` | Buyer creates escrow contract |
| `fundMilestone(uint256 contractId, uint256 milestoneIdx)` | `external payable` | `nonReentrant, whenNotPaused` | Buyer funds a milestone |
| `completeMilestone(uint256 contractId, uint256 milestoneIdx)` | `external` | `whenNotPaused` | Seller marks milestone done |
| `releaseFunds(uint256 contractId, uint256 milestoneIdx)` | `external` | `nonReentrant, whenNotPaused` | Buyer releases funds to seller |
| `dispute(uint256 contractId)` | `external` | `whenNotPaused` | Buyer or seller raises dispute → FREEZE |
| `resolveDispute(uint256 contractId, bool releaseFundsToSeller)` | `external` | `onlyAdmin, nonReentrant` | Admin resolves → refund or release |
| `cancelContract(uint256 contractId)` | `external` | `nonReentrant` | Cancel — refund unfunded/funded milestones, release completed |
| `claimAutoRefund(uint256 contractId, uint256 milestoneIdx)` | `external` | `nonReentrant` | Buyer claims refund after timeout |
| `getContract(uint256 contractId)` | `external view` | — | Returns contract details |
| `getMilestone(uint256 contractId, uint256 idx)` | `external view` | — | Returns milestone details |
| `updateFees(uint16 newPlatformBps, uint16 newCancellationBps)` | `external` | `onlyAdmin` | Update fee config |
| `updateTimeouts(uint256 newAutoRefund, uint256 newAutoResolve)` | `external` | `onlyAdmin` | Update timeout config |

### Events

```solidity
event ContractCreated(uint256 indexed id, address indexed buyer, address indexed seller, string title, uint256 milestoneCount);
event MilestoneFunded(uint256 indexed contractId, uint256 indexed milestoneIdx, uint256 amount);
event MilestoneCompleted(uint256 indexed contractId, uint256 indexed milestoneIdx);
event FundsReleased(uint256 indexed contractId, uint256 indexed milestoneIdx, uint256 netAmount, uint256 fee);
event FundsRefunded(uint256 indexed contractId, uint256 indexed milestoneIdx, uint256 amount);
event DisputeRaised(uint256 indexed contractId, address indexed raisedBy);
event DisputeResolved(uint256 indexed contractId, bool releasedToSeller, address indexed resolver);
event ContractCancelled(uint256 indexed contractId, address indexed cancelledBy, uint256 refunded, uint256 released);
event AutoRefundClaimed(uint256 indexed contractId, uint256 indexed milestoneIdx, uint256 amount);
event FeesUpdated(uint16 platformBps, uint16 cancellationBps);
event TimeoutsUpdated(uint256 autoRefund, uint256 autoResolve);
event FeeCollected(uint256 indexed contractId, uint256 feeAmount);
```

### Errors

```solidity
error NotBuyer();
error NotSeller();
error NotParty();                 // Must be buyer or seller
error NotAdmin();
error ContractNotActive();
error ContractDisputed();         // FREEZE: no actions during dispute
error MilestoneNotPending();
error MilestoneNotFunded();
error MilestoneNotCompleted();
error MilestoneTerminal();        // Already released or refunded
error InvalidMilestoneIndex();
error InsufficientFunding();      // msg.value != milestone.amount
error AutoRefundNotReady();       // Timeout not elapsed
error ArrayLengthMismatch();
error TooManyMilestones();        // Safety cap (e.g., 20)
error TitleTooLong();             // Input cap
error AmountTooSmall();           // Min milestone amount
error TransferFailed();
error InvalidFeeBps();
error CannotCancelCompleted();
```

### Security Requirements (CRITICAL — this contract holds user funds)

- [x] ReentrancyGuard on `fundMilestone`, `releaseFunds`, `cancelContract`, `claimAutoRefund`, `resolveDispute`
- [ ] Checks-Effects-Interactions on ALL ETH transfers
- [ ] Dispute FREEZE: `completeMilestone`/`releaseFunds` MUST revert while `status == Disputed`
- [ ] Refunds are TERMINAL: `MsRefunded` can never transition to any other state
- [ ] Released is TERMINAL: `MsReleased` can never transition to any other state
- [ ] `cancelContract` only pays milestones it newly transitions (no double-refund/double-release)
- [ ] Fee calculation uses integer math only (basis points, no floating point)
- [ ] Input caps: max 20 milestones, max 256 chars title, min milestone amount (e.g., 0.001 ETH)
- [ ] Auto-refund: only claimable by buyer, only after `autoRefundTimeout` from `fundedAt`
- [ ] Auto-resolve: only after `autoResolveTimeout` from `disputedAt`
- [ ] Pausable on create/fund/complete/release (but NOT on cancel/refund — users must always exit)
- [ ] No unbounded loops — milestone count capped
- [ ] `pull-over-push` pattern considered for batch refunds

### Gno → Solidity Translation Notes

| Gno Pattern | Solidity Equivalent | Notes |
|---|---|---|
| `std.GetOrigSend()` | `msg.value` | Direct |
| `banker.SendCoins(address, amount)` | `payable(addr).call{value: amount}("")` | CEI critical |
| `MsRefunded` is TERMINAL | Set status, never allow transition | Guard in every function |
| Contract-level dispute FREEZE | `require(status != Disputed)` on mutators | Already in Gno parity |
| `CancelContract` selective pay | Loop milestones, pay only newly-transitioned | Prevent double-pay |
| `avl.Tree` for contracts | `mapping(uint256 => ServiceContract)` | Direct |

## Test Cases (minimum: 20)

### Contract Creation
1. Create contract → verify event, buyer/seller, milestone count
2. Create with mismatched arrays → revert ArrayLengthMismatch
3. Create with too many milestones → revert TooManyMilestones
4. Create with zero-amount milestone → revert AmountTooSmall
5. Create with title too long → revert TitleTooLong

### Funding
6. Buyer funds milestone → verify MilestoneFunded event, status = Funded
7. Fund with wrong amount → revert InsufficientFunding
8. Non-buyer cannot fund → revert NotBuyer
9. Fund already-funded milestone → revert MilestoneNotPending

### Completion & Release
10. Seller completes milestone → status = Completed
11. Non-seller cannot complete → revert NotSeller
12. Complete during dispute → revert ContractDisputed (FREEZE)
13. Buyer releases funds → ETH to seller (minus fee), fee to recipient
14. Release during dispute → revert ContractDisputed (FREEZE)
15. Release already-released → revert MilestoneTerminal

### Disputes
16. Buyer or seller can raise dispute → status = Disputed
17. Non-party cannot dispute → revert NotParty
18. Admin resolves dispute (release to seller) → funds sent
19. Admin resolves dispute (refund to buyer) → funds returned
20. Non-admin cannot resolve → revert NotAdmin

### Cancellation
21. Cancel active contract → funded milestones refunded, completed milestones released
22. Cancel → no double-refund on already-refunded milestones
23. Cancel completed contract → revert

### Auto-Refund
24. Claim auto-refund after timeout → funds returned to buyer
25. Claim before timeout → revert AutoRefundNotReady

### Fee Verification
26. Release → fee = amount * platformFeeBps / 10000 → verify exact amounts
27. Cancel → fee = amount * cancellationFeeBps / 10000 → verify

### Reentrancy
28. Reentrancy attack on releaseFunds → blocked
29. Reentrancy attack on cancelContract → blocked

## Gas Estimates

| Operation | Estimated Gas | Notes |
|---|---|---|
| `createContract()` (5 milestones) | ~300K | Multiple storage writes |
| `fundMilestone()` | ~80K | Storage + ETH receive |
| `completeMilestone()` | ~60K | Storage write |
| `releaseFunds()` | ~100K | Storage + 2 ETH transfers (seller + fee) |
| `cancelContract()` (5 milestones) | ~200K | Loop + multiple transfers |
| `dispute()` | ~60K | Storage write |
| `resolveDispute()` | ~120K | Storage + transfers |

## Dependencies

- OpenZeppelin v5: `UUPSUpgradeable`, `PausableUpgradeable`, `ReentrancyGuardUpgradeable`
- Memba libs: `MembaFees` (for `_collectFee()`)

## Open Questions

- [ ] **Arbitration authority**: Should dispute resolution be admin-only, or should a DAO vote be required? Admin-only is simpler and faster; DAO vote is more decentralized but slower.
- [ ] **ETH-only or ERC-20 support**: Gno version uses native GNOT. Should we support ERC-20 payment tokens (USDC, USDG) in addition to ETH? This adds significant complexity (SafeERC20, approval patterns) but enables stable pricing.
- [ ] **Escrow contract per DAO vs global**: Should each DAO have its own escrow instance, or one global escrow with DAO isolation? Gno version is per-DAO (deployed as part of DAO). Recommend per-DAO via factory for isolation.
- [ ] **Auto-resolve direction**: When a dispute auto-resolves after timeout, should funds go to the seller (current Gno behavior) or be split? Seller-favoring creates incentive to complete work.
