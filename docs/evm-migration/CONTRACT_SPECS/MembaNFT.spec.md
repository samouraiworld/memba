# Contract: MembaNFT.sol

## Purpose

MembaNFT is the ERC-721 NFT minting contract with ERC-2981 royalties. Supports multiple sub-collections within a single contract (mirroring the Gno `memba_nft_v2` collection-ID pattern). Creators can mint NFTs with token URIs (IPFS), set per-collection royalties, and manage approval for marketplace listing.

Port of the Gno `memba_nft_v2` realm.

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/memba_nft_v2` (deployed on test13, topaz-1)
- **Frontend**: `frontend/src/lib/grc721.ts` (483 lines, 14KB)
- **Key Gno functions**: `Mint(collectionID, to, tokenURI)`, `SetApprovalForAll(collectionID, operator, approved)`, `Approve(collectionID, operator, tid)`, `TransferFrom(collectionID, from, to, tid)`
- **Royalty**: configurable per collection, up to 10% (1000 bps)

## Solidity Requirements

### Inheritance
- `ERC721URIStorageUpgradeable` — NFT with per-token URI
- `ERC2981Upgradeable` — on-chain royalty standard
- `UUPSUpgradeable`, `PausableUpgradeable`

### Storage
```solidity
struct NFTStorage {
    address admin;
    uint256 nextTokenId;
    // Collection sub-IDs
    mapping(bytes32 => CollectionInfo) collections;
    mapping(uint256 => bytes32) tokenCollection; // tokenId → collectionHash
}

struct CollectionInfo {
    string collectionID;
    address creator;
    string name;
    string symbol;
    uint256 totalSupply;
    uint96 royaltyBps;           // ERC-2981
    address royaltyRecipient;
}
```

### Functions
| Function | Visibility | Description |
|---|---|---|
| `createCollection(string id, string name, string symbol, uint96 royaltyBps)` | `external` | Register a new sub-collection |
| `mint(string collectionID, address to, string tokenURI)` | `external` | Mint NFT into collection |
| `batchMint(string collectionID, address to, string[] tokenURIs)` | `external` | Batch mint (capped at 50) |
| `getCollectionInfo(string id)` | `external view` | Collection metadata |
| `tokensByOwner(address owner)` | `external view` | Enumerable owner query |

### Security Requirements
- [ ] Only collection creator can mint into their collection
- [ ] Batch mint capped at 50 to prevent gas DoS
- [ ] Royalty BPS capped at 1000 (10%)
- [ ] Token URI cannot be empty

### Test Cases (minimum: 10)
1. Create collection → verify metadata
2. Mint NFT → verify ownership + tokenURI
3. Batch mint → verify all minted correctly
4. Non-creator cannot mint → revert
5. Royalty info returns correct values (ERC-2981)
6. Transfer → ownership updates
7. Approve + transferFrom flow
8. setApprovalForAll for marketplace
9. Batch mint > 50 → revert
10. Royalty > 10% → revert

## Dependencies
- OZ v5: `ERC721URIStorageUpgradeable`, `ERC2981Upgradeable`, `UUPSUpgradeable`
