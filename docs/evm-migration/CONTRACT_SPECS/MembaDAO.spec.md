# Contract: MembaDAO.sol + MembaDAOFactory.sol

## Purpose

MembaDAO is the core governance contract for Memba DAOs on EVM. It manages membership (address + voting power + roles), proposals with categories, voting (YES/NO/ABSTAIN), configurable quorum and threshold, and proposal execution. It is the Solidity port of the `memba_dao` Gno realm.

MembaDAOFactory deploys new MembaDAO instances behind UUPS proxies via CREATE2, enabling deterministic address pre-computation and a clean factory pattern for the DAO creation wizard.

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/memba_dao` (deployed on test12, test13, topaz-1)
- **Frontend template**: `frontend/src/lib/daoTemplate.ts` (960 lines)
- **Frontend reads**: `frontend/src/lib/membaDAO.ts` (8,641 bytes)
- **Key Gno functions**: `Propose()`, `Vote()`, `ExecuteProposal()`, `AddMember()`, `RemoveMember()`, `UpdateThreshold()`, `UpdateQuorum()`
- **Realm-versions**: See `/realm-versions.json` for deployed state across networks

## Solidity Requirements

### Inheritance (MembaDAO)

- `AccessControlUpgradeable` — role-based access (ADMIN_ROLE, MEMBER_ROLE)
- `UUPSUpgradeable` — upgrade mechanism restricted to DEFAULT_ADMIN_ROLE
- `PausableUpgradeable` — circuit breaker
- `ReentrancyGuardUpgradeable` — protect proposal execution

### Roles (mapping from Gno)

| Gno Role | Solidity Role | Access Level |
|---|---|---|
| `admin` | `ADMIN_ROLE` | Can add/remove members, update config, pause |
| `member` | `MEMBER_ROLE` | Can propose, vote, view |
| `dev` | Stored as member metadata (not a separate OZ role) | Tag only |
| `finance` | Stored as member metadata | Tag only |
| `ops` | Stored as member metadata | Tag only |

### Storage

```solidity
/// @custom:storage-location erc7201:memba.storage.MembaDAO
struct DAOStorage {
    string name;
    string description;
    uint16 thresholdBps;          // 5100 = 51% simple majority
    uint16 quorumBps;             // Minimum participation (0 = disabled)
    uint256 proposalCount;
    uint256 memberCount;

    // Members: address → MemberInfo
    mapping(address => MemberInfo) members;
    address[] memberList;         // Enumerable (needed for quorum calc)

    // Proposals: id → Proposal
    mapping(uint256 => Proposal) proposals;

    // Voting: proposalId → voter → hasVoted
    mapping(uint256 => mapping(address => bool)) hasVoted;
    // Voting: proposalId → voter → vote
    mapping(uint256 => mapping(address => uint8)) votes;
}

struct MemberInfo {
    uint256 votingPower;          // 1-1,000,000,000 (from daoTemplate.ts line 56)
    string[] roles;               // ["admin", "dev", "finance", "ops", "member"]
    bool active;
    uint256 joinedAt;             // block.timestamp
}

enum ProposalCategory {
    Governance,                   // 0
    Treasury,                     // 1
    Membership,                   // 2
    Operations                    // 3
}

enum VoteType {
    Against,                      // 0 = NO
    For,                          // 1 = YES
    Abstain                       // 2
}

struct Proposal {
    address proposer;
    string title;
    string description;
    ProposalCategory category;
    uint256 createdAt;            // block.timestamp
    uint256 votingDeadline;       // block.timestamp + votingPeriod
    uint256 forVotes;             // Sum of voting power
    uint256 againstVotes;
    uint256 abstainVotes;
    bool executed;
    bool cancelled;
}
```

### Functions (with signatures)

| Function | Visibility | Modifiers | Description |
|---|---|---|---|
| `initialize(string name, string desc, address admin)` | `external` | `initializer` | Proxy init — sets name, grants admin roles |
| `propose(string title, string desc, ProposalCategory cat)` | `external` | `onlyRole(MEMBER_ROLE), whenNotPaused` | Create a proposal; emits ProposalCreated |
| `vote(uint256 proposalId, VoteType support)` | `external` | `onlyRole(MEMBER_ROLE), whenNotPaused` | Cast vote; emits Voted |
| `execute(uint256 proposalId)` | `external` | `onlyRole(MEMBER_ROLE), nonReentrant, whenNotPaused` | Execute passed proposal |
| `cancelProposal(uint256 proposalId)` | `external` | `onlyRole(ADMIN_ROLE)` | Cancel a proposal |
| `addMember(address member, uint256 power, string[] roles)` | `external` | `onlyRole(ADMIN_ROLE)` | Add member; emits MemberAdded |
| `removeMember(address member)` | `external` | `onlyRole(ADMIN_ROLE)` | Remove member; emits MemberRemoved |
| `updateThreshold(uint16 newThresholdBps)` | `external` | `onlyRole(ADMIN_ROLE)` | Update voting threshold |
| `updateQuorum(uint16 newQuorumBps)` | `external` | `onlyRole(ADMIN_ROLE)` | Update quorum |
| `getProposal(uint256 id)` | `external view` | — | Returns proposal details |
| `getMember(address addr)` | `external view` | — | Returns member info |
| `getMembers()` | `external view` | — | Returns all member addresses |
| `isMember(address addr)` | `external view` | — | Membership check |
| `proposalPassed(uint256 id)` | `public view` | — | Check if threshold + quorum met |

### Factory Functions (MembaDAOFactory)

| Function | Visibility | Modifiers | Description |
|---|---|---|---|
| `createDAO(string name, string desc, address admin, bytes32 salt)` | `external` | — | Deploy DAO proxy via CREATE2 |
| `setImplementation(address newImpl)` | `external` | `onlyOwner` | Update impl for NEW DAOs |
| `getDaoCount()` | `external view` | — | Total DAOs deployed |
| `getDao(uint256 id)` | `external view` | — | Get DAO address by index |

### Events

```solidity
// MembaDAO
event DAOInitialized(string name, address indexed creator);
event MemberAdded(address indexed member, uint256 votingPower, string[] roles);
event MemberRemoved(address indexed member);
event MemberUpdated(address indexed member, uint256 newVotingPower);
event ProposalCreated(uint256 indexed proposalId, address indexed proposer, string title, ProposalCategory category);
event Voted(uint256 indexed proposalId, address indexed voter, VoteType support, uint256 weight);
event ProposalExecuted(uint256 indexed proposalId);
event ProposalCancelled(uint256 indexed proposalId);
event ThresholdUpdated(uint16 oldThreshold, uint16 newThreshold);
event QuorumUpdated(uint16 oldQuorum, uint16 newQuorum);

// MembaDAOFactory
event DAOCreated(uint256 indexed daoId, address indexed daoAddress, address indexed creator, string name);
event ImplementationUpdated(address indexed oldImpl, address indexed newImpl);
```

### Errors

```solidity
error NotMember();
error NotAdmin();
error InvalidThreshold();         // Must be 1-10000 bps
error InvalidQuorum();            // Must be 0-10000 bps
error AlreadyMember();
error ProposalNotFound();
error AlreadyVoted();
error VotingClosed();
error ProposalNotPassed();
error ProposalAlreadyExecuted();
error ProposalCancelled();
error InvalidVotingPower();       // Must be 1-1,000,000,000
error MemberListFull();           // Safety cap
```

### Security Requirements

- [x] ReentrancyGuard on `execute()` (proposal execution may trigger external calls)
- [ ] Checks-Effects-Interactions on `execute()` — mark executed BEFORE external call
- [ ] No unbounded loops in `getMembers()` — consider pagination or cap
- [ ] Member list cap (e.g., 1000) to prevent gas DoS
- [ ] Event emission on every state change (✅ defined above)
- [ ] Pausable circuit breaker on propose/vote/execute (✅ via PausableUpgradeable)
- [ ] UUPS upgrade restricted to DEFAULT_ADMIN_ROLE (✅ in stub)
- [ ] `_disableInitializers()` in constructor (✅ in stub)
- [ ] Voting power range check: 1–1,000,000,000 (from daoTemplate.ts line 56)
- [ ] Threshold range check: 1–10000 bps
- [ ] Quorum range check: 0–10000 bps

### Gno → Solidity Translation Notes

| Gno Pattern | Solidity Equivalent | Notes |
|---|---|---|
| `std.PreviousRealm().Address()` | `msg.sender` | Direct |
| `assertIsMember(caller)` | `onlyRole(MEMBER_ROLE)` | OZ AccessControl |
| `assertIsAdmin(caller)` | `onlyRole(ADMIN_ROLE)` | OZ AccessControl |
| `avl.Tree` for members | `mapping + address[]` | Need explicit enumeration |
| `ufmt.Sprintf` render | View functions returning structs | ABI-encoded, typed |
| `std.Emit("ProposalCreated", ...)` | `emit ProposalCreated(...)` | Typed events |
| Realm path addressing | Contract address (`0x...`) | Registry maps names → addresses |

## Test Cases (minimum: 15)

### Initialization
1. Deploy via factory → verify DAO initialized with correct name/description
2. Admin has ADMIN_ROLE + MEMBER_ROLE + DEFAULT_ADMIN_ROLE
3. Implementation cannot be initialized directly (disableInitializers)
4. Factory tracks DAO count and addresses correctly

### Membership
5. Admin can add member → verify membership + voting power + roles
6. Admin can remove member → verify no longer a member
7. Non-admin cannot add/remove members → revert
8. Cannot add already-existing member → revert
9. Voting power must be 1–1,000,000,000 → revert on out-of-range

### Proposals & Voting
10. Member can propose → verify ProposalCreated event
11. Non-member cannot propose → revert
12. Member can vote YES/NO/ABSTAIN → verify vote recorded + event
13. Cannot vote twice on same proposal → revert
14. Cannot vote after deadline → revert

### Execution
15. Proposal with threshold met → execute succeeds → emits ProposalExecuted
16. Proposal without threshold → execute reverts
17. Already-executed proposal → execute reverts

### Admin & Config
18. Admin can update threshold (1–10000) → verify event
19. Admin can update quorum (0–10000) → verify event
20. Non-admin cannot update config → revert

### Safety
21. Paused contract → propose/vote/execute all revert
22. ReentrancyGuard prevents reentrancy on execute

## Gas Estimates

| Operation | Estimated Gas | Notes |
|---|---|---|
| `createDAO()` (factory) | ~500K | Proxy deployment + init |
| `propose()` | ~100K | Storage write + event |
| `vote()` | ~80K | Storage write + event |
| `execute()` | ~150K+ | Depends on proposal type |
| `addMember()` | ~100K | Mapping + array push + role grant |
| `removeMember()` | ~80K | Mapping + array removal + role revoke |

## Dependencies

- OpenZeppelin v5: `AccessControlUpgradeable`, `UUPSUpgradeable`, `PausableUpgradeable`, `ReentrancyGuardUpgradeable`, `ERC1967Proxy`
- OpenZeppelin v5 (non-upgradeable): `Clones`, `Ownable` (factory only)
- Memba libs: None (MembaDAO is self-contained)

## Open Questions

- [ ] **Voting period**: How long should proposals stay open? Gno uses block-based; EVM should use timestamp-based. Default: 7 days?
- [ ] **Execution timelock**: Should there be a delay between vote passing and execution? Audit §17.2 mandates 48h minimum for contract upgrades — should this apply to all proposals?
- [ ] **Member cap**: What's the max member count to prevent gas DoS on `getMembers()`? Suggest 1000 with pagination.
- [ ] **Treasury integration**: When treasury spend is enabled, `execute()` needs to call `transfer()` — this is the highest-risk function. Spec separately?
