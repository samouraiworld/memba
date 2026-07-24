# Contract: MembaAppStore.sol

## Purpose

MembaAppStore is an on-chain app registry with lifecycle management (submit → review → live/rejected → delist). Publishers register dApps with metadata (name, tagline, category, icon CID, URL). A curation system allows community flagging and admin moderation. Registration fees provide anti-spam protection.

Port of the Gno `memba_appstore_v2` realm.

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/memba_appstore_v2` (deployed on test13, topaz-1)
- **Frontend**: `frontend/src/lib/appStore.ts` (200 lines, 8.5KB) + `appStoreSubmit.ts` (8.9KB) + `appStoreCuration.ts` (2.4KB)
- **Key functions**: `RegisterApp(pkgPath, name, tagline, category, iconCID, appURL)`, `FlagApp(pkgPath)`, `ApproveApp(pkgPath)`, `RejectApp(pkgPath, reason)`, `DelistApp(pkgPath)`
- **Status lifecycle**: pending → live/rejected → delisted
- **v3 additions**: screenshots, rejectReason, resubmitCount, paidResubmitCredit

## Solidity Requirements

### Storage
```solidity
enum AppStatus { Pending, Live, Rejected, Delisted }

struct AppListing {
    uint256 id;
    string pkgPath;              // App identifier (contract address or URL)
    string name;
    string tagline;
    string category;
    string iconCID;              // IPFS CID
    string appURL;
    address publisher;
    AppStatus status;
    uint256 flagCount;
    uint256 createdAt;
    string rejectReason;
    string[] screenshotCIDs;
}

struct AppStoreStorage {
    address admin;                // Curator
    address feeRecipient;
    uint256 registrationFee;      // Anti-spam fee in wei
    uint256 listingCount;
    mapping(uint256 => AppListing) listings;
    mapping(string => uint256) pathToId;  // pkgPath → listing ID
    // Flag dedup: flagger → listingId → flagged
    mapping(address => mapping(uint256 => bool)) hasFlagged;
    uint256 flagHideThreshold;    // Auto-hide at this flag count
}
```

### Functions
| Function | Visibility | Description |
|---|---|---|
| `register(string pkgPath, string name, string tagline, string category, string iconCID, string appURL)` | `external payable` | Submit app listing |
| `approve(uint256 listingId)` | `external` | Admin: approve → Live |
| `reject(uint256 listingId, string reason)` | `external` | Admin: reject with reason |
| `delist(uint256 listingId)` | `external` | Admin or publisher: remove |
| `flag(uint256 listingId)` | `external` | Community: flag for review |
| `getListing(uint256 id)` | `external view` | Single listing |
| `listByStatus(AppStatus status, uint256 offset, uint256 limit)` | `external view` | Paginated by status |

### Test Cases (minimum: 8)
1. Register app → verify listing + fee collected
2. Approve app → status = Live
3. Reject app → status = Rejected + reason stored
4. Delist app → status = Delisted
5. Flag app → flag count incremented
6. Duplicate flag (same user) → revert
7. Auto-hide at threshold → listing hidden from public queries
8. Non-admin cannot approve/reject → revert

## Dependencies
- OZ v5: `UUPSUpgradeable`, `PausableUpgradeable`
