# Contract: MembaBadges.sol

## Purpose

MembaBadges issues non-transferable achievement tokens (Soulbound Tokens per ERC-5192) for quest completions, rank achievements, and community contributions. Each badge is tied to a quest ID, has metadata (tokenURI), and cannot be transferred after minting.

Port of the Gno `gnobuilders_badges_v2` realm.

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/gnobuilders_badges_v2` (deployed on test12, test13, topaz-1)
- **Frontend**: `frontend/src/lib/badges.ts` (213 lines, 6.7KB)
- **Key functions**: `MintBadge(to, questId, tokenURI, soulbound)`, `GetUserBadgeDetails(address)`
- **Soulbound**: Non-transferable once minted

## Solidity Requirements

### Inheritance
- `ERC721Upgradeable` — base NFT
- `IERC5192` — Soulbound Token interface (Locked event, locked() view)
- `UUPSUpgradeable`

### Storage
```solidity
struct BadgeInfo {
    string questId;
    bool soulbound;
    uint256 mintedAt;
}

struct BadgeStorage {
    address minter;              // Backend/admin authorized to mint
    uint256 nextTokenId;
    mapping(uint256 => BadgeInfo) badges;
    mapping(address => uint256[]) userBadges;
    // Dedup: address + questId → already minted
    mapping(bytes32 => bool) minted;
}
```

### Functions
| Function | Visibility | Description |
|---|---|---|
| `mint(address to, string questId, string tokenURI, bool soulbound)` | `external` | Mint badge (minter only) |
| `batchMint(address[] to, string[] questIds, string[] tokenURIs, bool soulbound)` | `external` | Batch mint |
| `getUserBadges(address user)` | `external view` | All badges for user |
| `getBadgeInfo(uint256 tokenId)` | `external view` | Badge metadata |
| `locked(uint256 tokenId)` | `external view` | ERC-5192: always true for soulbound |

### Security Requirements
- [ ] Override `_update` to block transfers of soulbound tokens (only mint/burn)
- [ ] Only minter can mint
- [ ] Deduplication: same address + questId cannot mint twice
- [ ] Batch mint capped (50 max)

### Test Cases (minimum: 8)
1. Mint badge → verify ownership + questId + soulbound flag
2. Soulbound badge cannot be transferred → revert
3. Non-minter cannot mint → revert
4. Duplicate mint (same address + quest) → revert
5. Batch mint → all badges created
6. locked() returns true for soulbound
7. Locked event emitted on mint
8. getUserBadges returns correct list

## Dependencies
- OZ v5: `ERC721Upgradeable`, `UUPSUpgradeable`
- ERC-5192 interface (Soulbound Token standard)
