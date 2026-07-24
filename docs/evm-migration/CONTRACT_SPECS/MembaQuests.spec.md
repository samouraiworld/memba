# Contract: MembaQuests.sol

## Purpose

MembaQuests is the on-chain attestation registry for quest completions. The backend verifier confirms quest criteria are met, then records attestations on-chain. Each attestation links an address to a quest ID with a timestamp and optional proof hash.

Port of the Gno `quest_attestation_v1` realm.

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/quest_attestation_v1` (topaz-1)
- **Frontend**: `frontend/src/lib/quests.ts` (461 lines) + `questVerifier.ts` (19KB) + `questClaims.ts` (5KB)
- **Backend**: `backend/internal/attestation/` + `service/quest_rpc.go`
- **Key model**: 10 quests with XP values, dual-write (localStorage + backend), verified XP for candidature gate

## Solidity Requirements

### Storage
```solidity
struct Attestation {
    address user;
    string questId;
    uint256 attestedAt;
    bytes32 proofHash;           // Hash of backend verification proof
}

struct QuestStorage {
    address attester;            // Backend service address (authorized to attest)
    address admin;
    uint256 attestationCount;
    // user → questId → attestation
    mapping(address => mapping(bytes32 => Attestation)) attestations;
    mapping(address => uint256) userAttestationCount;
    mapping(address => uint256) userTotalXP;
}
```

### Functions
| Function | Visibility | Description |
|---|---|---|
| `attest(address user, string questId, uint256 xp, bytes32 proofHash)` | `external` | Record attestation (attester only) |
| `batchAttest(address[] users, string[] questIds, uint256[] xps, bytes32[] proofHashes)` | `external` | Batch attest |
| `getAttestation(address user, string questId)` | `external view` | Single attestation |
| `getUserXP(address user)` | `external view` | Total verified XP |
| `isQuestCompleted(address user, string questId)` | `external view` | Completion check |
| `updateAttester(address newAttester)` | `external` | Admin: rotate attester key |

### Test Cases (minimum: 8)
1. Attest quest → verify stored + XP incremented
2. Duplicate attestation → revert (cannot double-attest)
3. Non-attester cannot attest → revert
4. Batch attest → all recorded
5. getUserXP → correct total
6. isQuestCompleted → true after attestation
7. Update attester → old attester revoked
8. Only admin can update attester → revert

## Dependencies
- OZ v5: `UUPSUpgradeable`
