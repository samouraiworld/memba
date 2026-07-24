# Contract: MembaCollections.sol

## Purpose

MembaCollections is the NFT launchpad registry. Creators register collections with metadata, set sale phases (Draft → Allowlist → Public → Closed), configure mint prices, and manage allowlists via Merkle proofs. Charges an anti-spam creation fee (0.001 ETH).

Port of the Gno `memba_collections` realm.

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/memba_collections` (deployed on test13, topaz-1)
- **Frontend**: `frontend/src/lib/launchpad.ts` (346 lines, 11KB)
- **Key constants**: `CREATE_FEE_UGNOT = 1_000_000`, `MAX_ROYALTY_BPS = 1000`, `DEFAULT_ROYALTY_BPS = 500`
- **Sale phases**: Draft(0), Allowlist(1), Public(2), Closed(3)
- **Key functions**: `CreateCollection(slug, name, symbol, description, maxSupply, mintPrice, royaltyBPS)`, `SetPhase(collectionID, phase)`, `MintNFT(collectionID, tokenURI)`, `SetAllowlistRoot(collectionID, root)`, `VerifyCollection(collectionID)`

## Solidity Requirements

### Storage
```solidity
struct Collection {
    address creator;
    string slug;
    string name;
    string symbol;
    string description;
    uint256 maxSupply;          // 0 = unlimited
    uint256 mintPrice;          // in wei
    uint96 royaltyBps;
    uint8 phase;                // 0=Draft, 1=Allowlist, 2=Public, 3=Closed
    bytes32 allowlistRoot;      // Merkle root for allowlist phase
    bool verified;              // Curated badge
    uint256 mintCount;
    address nftContract;        // Deployed MembaNFT instance
}
```

### Functions
| Function | Visibility | Description |
|---|---|---|
| `createCollection(...)` | `external payable` | Register + deploy NFT contract |
| `setPhase(bytes32 collectionHash, uint8 phase)` | `external` | Advance sale phase |
| `mintNFT(bytes32 collectionHash, string tokenURI, bytes32[] proof)` | `external payable` | Mint with optional allowlist proof |
| `setAllowlistRoot(bytes32 collectionHash, bytes32 root)` | `external` | Set Merkle root for allowlist |
| `verifyCollection(bytes32 collectionHash)` | `external` | Admin: add verified badge |
| `getCollection(bytes32 collectionHash)` | `external view` | Collection info |
| `listCollections()` | `external view` | All collection hashes |

### Security Requirements
- [ ] Merkle proof verification for allowlist minting (OZ `MerkleProof`)
- [ ] Only creator can advance phase or update allowlist
- [ ] Mint price enforced via `msg.value`
- [ ] MaxSupply enforced (if > 0)
- [ ] Creation fee collected
- [ ] Only admin can verify collections

### Test Cases (minimum: 10)
1. Create collection → verify metadata + creation fee
2. Mint in Public phase → verify NFT minted
3. Mint in Allowlist phase with valid proof → success
4. Mint in Allowlist phase without proof → revert
5. Mint in Draft phase → revert
6. Mint in Closed phase → revert
7. Mint exceeding maxSupply → revert
8. Only creator can set phase → revert for non-creator
9. Verify collection (admin only) → badge set
10. Creation fee insufficient → revert

## Dependencies
- OZ v5: `MerkleProof`, `UUPSUpgradeable`, `PausableUpgradeable`
- Memba: `MembaNFT` (deployed per collection)
