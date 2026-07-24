# Contract: MembaPoints.sol

## Purpose

MembaPoints is an on-chain reputation points ledger with canonical tier assignment and leaderboard ranking. Points are awarded by authorized awarders (backend, quest system, admin). Tier bands (e.g., Bronze/Silver/Gold) are configurable. All reads (profile, rank, tier) are canonical on-chain — never re-derived client-side.

Port of the Gno `memba_points_v1` realm.

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/memba_points_v1` (topaz-1, currently behind feature flag)
- **Frontend**: `frontend/src/lib/points.ts` (109 lines, 4.2KB)
- **Key functions**: `ProfileJSON(address)`, `TopN(n)`, `TopNPage(n, offset)`, `TierBandsJSON()`
- **Types**: `PointsProfile { addr, points, tier, rank, holders }`, `LeaderRow`, `TierBand`

## Solidity Requirements

### Storage
```solidity
struct PointsStorage {
    address admin;
    address[] awarders;          // Authorized to award points
    uint256 holderCount;

    mapping(address => uint256) points;
    address[] holders;           // For leaderboard enumeration

    // Tier bands: sorted by minPoints descending
    TierBand[] tierBands;
}

struct TierBand {
    string name;                 // e.g., "Gold", "Silver", "Bronze"
    uint256 minPoints;
}
```

### Functions
| Function | Visibility | Description |
|---|---|---|
| `award(address user, uint256 amount)` | `external` | Award points (awarder only) |
| `batchAward(address[] users, uint256[] amounts)` | `external` | Batch award |
| `getProfile(address user)` | `external view` | Points + tier + rank |
| `getLeaderboard(uint256 offset, uint256 limit)` | `external view` | Paginated leaderboard |
| `getTierBands()` | `external view` | All tier definitions |
| `setTierBands(string[] names, uint256[] minPoints)` | `external` | Admin: configure tiers |
| `addAwarder(address awarder)` | `external` | Admin: authorize awarder |
| `removeAwarder(address awarder)` | `external` | Admin: deauthorize |

### Security Requirements
- [ ] Only authorized awarders can award points
- [ ] Points are additive only (no deduction — monotonic)
- [ ] Leaderboard pagination to prevent gas DoS
- [ ] Tier bands sorted validation
- [ ] Holder list cap (gas safety)

### Test Cases (minimum: 8)
1. Award points → verify balance + holder count
2. Non-awarder cannot award → revert
3. Batch award → all balances updated
4. getProfile → correct tier assignment based on bands
5. Leaderboard → sorted by points descending
6. Set tier bands → bands updated
7. Tier assignment changes when points cross threshold
8. Add/remove awarder → verify authorization

## Dependencies
- OZ v5: `UUPSUpgradeable`
