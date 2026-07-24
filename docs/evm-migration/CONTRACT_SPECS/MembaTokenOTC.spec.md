# Contract: MembaTokenOTC.sol

## Purpose

MembaTokenOTC is an over-the-counter token trading desk. Sellers list ERC-20 tokens at a fixed unit price, buyers fill orders by paying ETH. Supports partial fills. Unfilled portions can be cancelled and reclaimed.

Port of the Gno `token_otc_v2` realm.

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/token_otc_v2` (topaz-1)
- **Frontend**: `frontend/src/lib/tokenOtc.ts` (48 lines) + `tokenOtcApi.ts` (2.3KB)
- **Key Gno functions**: `ListTokens(symbol, amount, unitPrice)`, `Fill(listingId, qty, expectedUnitPrice)`, `CancelListing(listingId)`
- **Bigint handling**: All amounts are bigint (token amounts can exceed MAX_SAFE_INTEGER)

## Solidity Requirements

### Storage
```solidity
struct OTCListing {
    address seller;
    address token;               // ERC-20 address
    uint256 totalAmount;         // Total tokens listed
    uint256 filledAmount;        // Already sold
    uint256 unitPrice;           // wei per token unit
    bool active;
    uint256 createdAt;
}

struct OTCStorage {
    address admin;
    address feeRecipient;
    uint16 platformFeeBps;       // 100 = 1%
    uint256 listingCount;
    mapping(uint256 => OTCListing) listings;
}
```

### Functions
| Function | Visibility | Modifiers | Description |
|---|---|---|---|
| `list(address token, uint256 amount, uint256 unitPrice)` | `external` | `whenNotPaused` | List tokens (requires prior ERC-20 approval) |
| `fill(uint256 listingId, uint256 qty)` | `external payable` | `nonReentrant` | Buy tokens, pay ETH |
| `cancel(uint256 listingId)` | `external` | `nonReentrant` | Cancel listing, reclaim unsold tokens |
| `getListing(uint256 id)` | `external view` | — | Listing details |
| `getActiveListings()` | `external view` | — | All active listings |

### Security Requirements
- [ ] ReentrancyGuard on fill and cancel
- [ ] SafeERC20 for all token transfers
- [ ] Price slippage protection (check `unitPrice` hasn't changed)
- [ ] Partial fill support (update `filledAmount`)
- [ ] Only seller can cancel
- [ ] Fee deducted from ETH payment

### Test Cases (minimum: 10)
1. List tokens → verify listing + token transfer to contract
2. Fill order → tokens to buyer, ETH to seller (minus fee)
3. Partial fill → remaining available
4. Fill with wrong ETH amount → revert
5. Cancel listing → unsold tokens returned
6. Cancel already-filled listing → returns remaining only
7. Non-seller cannot cancel → revert
8. Price slippage detection → revert if price changed
9. Fee calculation exact → verify amounts
10. Fill more than available → revert

## Dependencies
- OZ v5: `SafeERC20`, `IERC20`, `UUPSUpgradeable`, `ReentrancyGuardUpgradeable`
- Memba libs: `MembaFees`
