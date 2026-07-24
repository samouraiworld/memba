# Contract: MembaChannels.sol

## Purpose

MembaChannels provides on-chain message anchoring for DAO communication channels. On EVM, most message content is stored off-chain (backend DB) with ECDSA signatures for authorship proof. This contract anchors periodic Merkle roots of channel message batches on-chain, providing cryptographic proof that messages existed at a given block.

Hybrid architecture: off-chain messages + on-chain anchoring (audit §4.2, feature #7).

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/memba_dao_channels_v2` (deployed on test12, test13, topaz-1)
- **Frontend**: `frontend/src/lib/channelTemplate.ts` (930 lines, 31KB)
- **Key features**: text/announcements/readonly channels, thread/reply system, role-based ACL, @mentions, rate limiting, token-gated writes
- **18 ACL guard sites** verified on-chain (per realm-versions.json)

## Solidity Requirements

### Design Decision

The Gno version stores ALL messages on-chain. On EVM, this is prohibitively expensive for text content. The EVM version uses a **hybrid model**:

1. **Off-chain**: Messages stored in backend DB with ECDSA signatures
2. **On-chain**: Periodic Merkle root anchoring for tamper-proof history
3. **Channel config**: On-chain (channel definitions, ACL, membership)

### Storage
```solidity
struct ChannelConfig {
    string name;
    uint8 channelType;           // 0=text, 1=announcements, 2=readonly
    bytes32 aclHash;             // Hash of role ACL config
    bool active;
}

struct ChannelsStorage {
    address daoContract;         // For membership verification
    address admin;
    uint256 channelCount;
    mapping(uint256 => ChannelConfig) channels;
    // Merkle root anchoring: channelId → roots[]
    mapping(uint256 => bytes32[]) messageRoots;
    mapping(uint256 => uint256[]) rootTimestamps;
}
```

### Functions
| Function | Visibility | Description |
|---|---|---|
| `createChannel(string name, uint8 channelType, bytes32 aclHash)` | `external` | Admin creates channel |
| `archiveChannel(uint256 channelId)` | `external` | Admin deactivates channel |
| `anchorMessages(uint256 channelId, bytes32 merkleRoot)` | `external` | Anchor batch of messages |
| `getChannel(uint256 id)` | `external view` | Channel config |
| `getMessageRoots(uint256 channelId)` | `external view` | All anchored roots |
| `verifyMessage(uint256 channelId, uint256 rootIndex, bytes32[] proof, bytes32 leaf)` | `external view` | Verify message inclusion |

### Security Requirements
- [ ] Only DAO members can anchor messages (cross-contract check)
- [ ] Only admin can create/archive channels
- [ ] Merkle proof verification for message inclusion queries
- [ ] Channel count capped to prevent gas DoS

### Test Cases (minimum: 8)
1. Create channel → verify config stored
2. Anchor messages → Merkle root stored + timestamp
3. Verify message inclusion with valid proof → true
4. Verify with invalid proof → false
5. Non-member cannot anchor → revert
6. Non-admin cannot create channel → revert
7. Archive channel → marked inactive
8. Multiple roots accumulate correctly

## Dependencies
- OZ v5: `MerkleProof`, `UUPSUpgradeable`
- Memba: `MembaDAO` (for `isMember()` cross-contract check)
