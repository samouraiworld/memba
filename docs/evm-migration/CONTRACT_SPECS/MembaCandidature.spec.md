# Contract: MembaCandidature.sol

## Purpose

MembaCandidature manages the DAO membership application flow. Users apply with a bio, skills, and an ETH deposit (minimum required). DAO admins approve or reject applications. Approved candidates are added as DAO members and optionally receive a token airdrop. Rejected or withdrawn candidates can reclaim their deposit. Re-applications require a 10x deposit escalation.

Port of the Gno `memba_dao_candidature_v3` realm.

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/memba_dao_candidature_v3` (deployed on test13, topaz-1)
- **Previous versions**: `candidature_v2` (paused, kept for legacy withdrawals on test12)
- **Frontend template**: `frontend/src/lib/candidatureTemplate.ts` (370 lines)
- **Key Gno functions**: `Apply(bio, skills)`, `MarkApproved(applicant)`, `MarkRejected(applicant)`, `Withdraw()`
- **Deposit mechanics**: 10 GNOT minimum, 10x per re-application
- **Security**: IsUserCall-guarded (P0 fund-drain fix in v3)

## Solidity Requirements

### Inheritance

- `UUPSUpgradeable` — upgrade mechanism
- `PausableUpgradeable` — circuit breaker
- `ReentrancyGuardUpgradeable` — ETH deposit/withdrawal safety

### Storage

```solidity
/// @custom:storage-location erc7201:memba.storage.MembaCandidature
struct CandidatureStorage {
    address daoContract;          // MembaDAO address (for member check)
    address admin;                // Upgrade authority + approve/reject
    uint256 minDeposit;           // Minimum deposit in wei (e.g., 0.01 ETH)
    uint256 depositMultiplier;    // 10 = 10x per re-application
    uint256 applicationCount;

    // Applications: applicant → Application
    mapping(address => Application) applications;
    address[] applicantList;      // Enumerable

    // Re-application tracking
    mapping(address => uint256) applyCount;
}

enum ApplicationStatus {
    None,                         // 0 — never applied
    Pending,                      // 1
    Approved,                     // 2
    Rejected,                     // 3
    Withdrawn                     // 4
}

struct Application {
    string bio;
    string skills;
    uint256 deposit;              // ETH deposited
    ApplicationStatus status;
    uint256 appliedAt;            // block.timestamp
    uint256 resolvedAt;           // block.timestamp of approve/reject/withdraw
}
```

### Functions (with signatures)

| Function | Visibility | Modifiers | Description |
|---|---|---|---|
| `initialize(address dao, address admin, uint256 minDeposit)` | `external` | `initializer` | Set DAO reference + config |
| `apply(string bio, string skills)` | `external payable` | `whenNotPaused` | Submit application + deposit |
| `markApproved(address applicant)` | `external` | `onlyAdmin, whenNotPaused` | Approve → add to DAO |
| `markRejected(address applicant)` | `external` | `onlyAdmin` | Reject → deposit stays for withdrawal |
| `withdraw()` | `external` | `nonReentrant` | Withdraw deposit (pending/rejected only) |
| `getApplication(address applicant)` | `external view` | — | Returns application details |
| `getApplicants()` | `external view` | — | Returns all applicant addresses |
| `getRequiredDeposit(address applicant)` | `external view` | — | Calculate required deposit (10x escalation) |
| `updateMinDeposit(uint256 newMin)` | `external` | `onlyAdmin` | Update minimum deposit |
| `updateDAO(address newDAO)` | `external` | `onlyAdmin` | Update DAO reference |

### Events

```solidity
event ApplicationSubmitted(address indexed applicant, uint256 deposit, uint256 applyCount);
event ApplicationApproved(address indexed applicant, address indexed approvedBy);
event ApplicationRejected(address indexed applicant, address indexed rejectedBy);
event DepositWithdrawn(address indexed applicant, uint256 amount);
event MinDepositUpdated(uint256 oldMin, uint256 newMin);
```

### Errors

```solidity
error AlreadyPending();           // Cannot apply while pending
error AlreadyMember();            // Cannot apply if already a member
error InsufficientDeposit();      // msg.value < required deposit
error NotPending();               // Cannot approve/reject non-pending
error NotWithdrawable();          // Can only withdraw pending/rejected
error NotAdmin();
error TransferFailed();
error InvalidParams();
```

### Security Requirements

- [x] ReentrancyGuard on `withdraw()` — ETH transfer to user
- [ ] Checks-Effects-Interactions on `withdraw()` — set status BEFORE transfer
- [ ] CEI on `markApproved()` if it transfers deposit to DAO treasury
- [ ] Deposit escalation: `minDeposit * multiplier^(applyCount-1)` — check overflow
- [ ] Cannot apply if already a DAO member (cross-contract call to MembaDAO.isMember)
- [ ] Cannot apply if already pending
- [ ] Admin-only on approve/reject
- [ ] Pausable on apply (but NOT on withdraw — users must always be able to reclaim)
- [ ] Event emission on all state changes

### Gno → Solidity Translation Notes

| Gno Pattern | Solidity Equivalent | Notes |
|---|---|---|
| `std.GetOrigSend()` | `msg.value` | Direct |
| `assertIsMember(caller)` → cross-realm | `MembaDAO(daoContract).isMember(msg.sender)` | External call |
| `Withdraw()` refund via `banker.SendCoins` | `payable(msg.sender).call{value: deposit}("")` | CEI pattern critical |
| 10x deposit escalation per re-apply | `minDeposit * (multiplier ** (applyCount - 1))` | Use checked math |
| `std.PreviousRealm().Address()` | `msg.sender` | Direct |

## Test Cases (minimum: 12)

### Initialization
1. Deploy → verify DAO reference and min deposit set correctly
2. Initial state: no applications

### Application Flow
3. Apply with valid deposit → verify ApplicationSubmitted event + status = Pending
4. Apply with insufficient deposit → revert InsufficientDeposit
5. Apply while already pending → revert AlreadyPending
6. Apply as existing DAO member → revert AlreadyMember
7. Re-apply after rejection → require 10x deposit

### Approval / Rejection
8. Admin approves → status = Approved, member added to DAO
9. Admin rejects → status = Rejected
10. Non-admin cannot approve → revert
11. Cannot approve non-pending application → revert

### Withdrawal
12. Withdraw from pending → ETH returned, status = Withdrawn
13. Withdraw from rejected → ETH returned, status = Withdrawn
14. Withdraw from approved → revert (deposit consumed)
15. Reentrancy attack on withdraw → blocked by ReentrancyGuard

## Gas Estimates

| Operation | Estimated Gas | Notes |
|---|---|---|
| `apply()` | ~120K | Storage writes + event + ETH receive |
| `markApproved()` | ~150K | Cross-contract call to DAO + storage |
| `markRejected()` | ~60K | Storage write + event |
| `withdraw()` | ~50K | Storage write + ETH transfer |

## Dependencies

- OpenZeppelin v5: `UUPSUpgradeable`, `PausableUpgradeable`, `ReentrancyGuardUpgradeable`
- Memba contracts: `MembaDAO` (for `isMember()` cross-contract check)

## Open Questions

- [ ] **Token airdrop on approval**: Should the candidature contract handle MEMBA token airdrop (like the Gno version), or should this be a separate step? On EVM, this requires the contract to hold tokens or have minter role.
- [ ] **Deposit destination**: When approved, where does the deposit go? Options: (a) DAO treasury, (b) burn, (c) stay in contract. Gno version keeps it in the realm.
- [ ] **Required approvals**: Gno v3 has `requiredApprovals: 2`. Should we support multi-approval on EVM or keep it admin-only for simplicity?
