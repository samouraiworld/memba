# Contract: MembaRegistry.sol

## Purpose

MembaRegistry is the global directory of all deployed Memba DAOs and platform configuration. It enables cross-DAO discovery, search, and provides a single source for platform-wide fee settings and treasury addresses.

Combines the registry pattern from `directory.ts` with platform config.

## Gno Source Reference

- **Frontend**: `frontend/src/lib/directory.ts` (729 lines, 27KB)
- **Key features**: DAO discovery via seed list + saved DAOs, category heuristics, token listing, user registry
- **Categories**: governance, community, treasury, defi, infrastructure

## Solidity Requirements

### Storage
```solidity
struct DAOEntry {
    address daoAddress;
    string name;
    string category;
    address creator;
    uint256 createdAt;
    bool verified;
}

struct PlatformConfig {
    address treasury;            // Samouraï Coop Safe
    uint16 defaultFeeBps;        // 250 = 2.5%
    uint16 escrowFeeBps;         // 200 = 2.0%
    uint16 cancellationFeeBps;   // 500 = 5.0%
}

struct RegistryStorage {
    address admin;
    uint256 daoCount;
    mapping(uint256 => DAOEntry) daos;
    mapping(address => uint256) daoIndex;  // address → ID
    PlatformConfig config;
}
```

### Functions
| Function | Visibility | Description |
|---|---|---|
| `registerDAO(address dao, string name, string category)` | `external` | Register a DAO (factory or admin) |
| `verifyDAO(uint256 daoId)` | `external` | Admin: verified badge |
| `getDAO(uint256 id)` | `external view` | Single DAO entry |
| `getDAOByAddress(address dao)` | `external view` | Lookup by address |
| `listDAOs(uint256 offset, uint256 limit)` | `external view` | Paginated directory |
| `getDAOCount()` | `external view` | Total registered |
| `getPlatformConfig()` | `external view` | Fee/treasury config |
| `updateConfig(PlatformConfig config)` | `external` | Admin: update platform config |

### Test Cases (minimum: 8)
1. Register DAO → verify stored + indexed
2. Verify DAO → badge set
3. List DAOs → paginated results
4. Get by address → correct entry
5. Duplicate registration → revert
6. Non-admin cannot verify → revert
7. Update platform config → new values stored
8. Non-admin cannot update config → revert

## Dependencies
- OZ v5: `UUPSUpgradeable`
