# Contract: MembaNFTMarket.sol

## Purpose

MembaNFTMarket is the NFT marketplace: list, buy, delist, make offers, accept offers, cancel offers, and claim expired offers. Charges a configurable platform fee (2.0% default) on every sale. Supports the approval-before-list pattern (ERC-721 `setApprovalForAll`).

Port of the Gno `nft_market_v3_2` / `memba_nft_market_v2` realms.

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/nft_market_v3_2` (topaz-1), `memba_nft_market_v2` (test13)
- **Frontend**: `frontend/src/lib/nftMarketplace.ts` (349 lines) + `nftMarketplaceV3.ts` (194 lines)
- **Key Gno functions**: `ListNFT(collectionID, tid, price)`, `BuyNFT(collectionID, tid)`, `DelistNFT(collectionID, tid)`, `MakeOffer(collectionID, tid)`, `CancelOffer(collectionID, tid)`, `AcceptOffer(collectionID, tid, buyer)`, `ClaimExpiredOffer(collectionID, buyer)`
- **Fee**: 200 bps (v3) / 250 bps (v2) platform fee on sales

## Solidity Requirements

### Inheritance
- `UUPSUpgradeable`, `PausableUpgradeable`, `ReentrancyGuardUpgradeable`

### Storage
```solidity
struct Listing {
    address seller;
    address nftContract;
    uint256 tokenId;
    uint256 price;              // in wei
    bool active;
}

struct Offer {
    address buyer;
    uint256 amount;             // in wei (escrowed)
    uint256 expiresAt;          // block.timestamp
    bool active;
}

struct MarketStorage {
    address admin;
    address feeRecipient;
    uint16 platformFeeBps;      // 200 = 2.0%
    uint256 listingCount;
    mapping(uint256 => Listing) listings;
    // tokenId → nftContract → best offer
    mapping(address => mapping(uint256 => Offer)) offers;
}
```

### Functions
| Function | Visibility | Modifiers | Description |
|---|---|---|---|
| `list(address nftContract, uint256 tokenId, uint256 price)` | `external` | `whenNotPaused` | List NFT (must have approval) |
| `buy(uint256 listingId)` | `external payable` | `nonReentrant, whenNotPaused` | Buy at listed price |
| `delist(uint256 listingId)` | `external` | — | Cancel listing (seller only) |
| `makeOffer(address nftContract, uint256 tokenId, uint256 duration)` | `external payable` | `nonReentrant` | Escrow ETH as offer |
| `acceptOffer(address nftContract, uint256 tokenId, address buyer)` | `external` | `nonReentrant` | Accept specific offer |
| `cancelOffer(address nftContract, uint256 tokenId)` | `external` | `nonReentrant` | Cancel own offer, reclaim ETH |
| `claimExpiredOffer(address nftContract, uint256 tokenId, address buyer)` | `external` | `nonReentrant` | Reclaim after expiry |

### Security Requirements
- [ ] ReentrancyGuard on ALL ETH-moving functions
- [ ] CEI pattern on buy/acceptOffer (transfer NFT BEFORE sending ETH)
- [ ] Seller must have approved marketplace contract
- [ ] Cannot buy own listing
- [ ] Offer amount escrowed — not extractable except via cancel/accept/claim
- [ ] Platform fee deducted before seller payment

### Test Cases (minimum: 14)
1. List NFT → verify listing created
2. Buy NFT → verify ownership transfer + seller payment + fee
3. Buy without sufficient ETH → revert
4. Delist → listing deactivated, NFT returned
5. Only seller can delist → revert
6. Make offer (escrow ETH) → verify escrowed
7. Accept offer → NFT transferred, ETH to seller (minus fee)
8. Cancel offer → ETH returned
9. Claim expired offer → ETH returned after expiry
10. Claim non-expired → revert
11. Cannot buy own listing → revert
12. List without approval → revert
13. Fee calculation exact → verify amounts
14. Paused → list/buy revert

## Dependencies
- OZ v5: `UUPSUpgradeable`, `PausableUpgradeable`, `ReentrancyGuardUpgradeable`, `IERC721`
- Memba libs: `MembaFees`
