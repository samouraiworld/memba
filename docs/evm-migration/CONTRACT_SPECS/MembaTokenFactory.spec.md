# Contract: MembaTokenFactory.sol

## Purpose

MembaTokenFactory deploys new ERC-20 tokens with a 2.5% platform mint fee collected by the Samouraï Coop treasury. Tokens are deployed via CREATE2 for deterministic addressing. Each token is a standard OZ ERC-20 with admin mint capability and optional metadata.

Port of the Gno `tokenfactory_v2` realm.

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/tokenfactory` (v1 on test12), `tokenfactory_v2` (test13, topaz-1)
- **Frontend**: `frontend/src/lib/grc20.ts` (659 lines, 25KB)
- **Key Gno functions**: `CreateToken(name, symbol, decimals, initialSupply)`, `Mint(tokenPath, amount)`, `GetTokenInfo(path)`, `ListTokens()`
- **Fee**: 2.5% platform fee on every mint → `FEE_RECIPIENT` (Samouraï Coop multisig)
- **Config**: `frontend/src/lib/config.ts` — `GRC20_FACTORY_PATH`, `MEMBA_TOKEN`

## Solidity Requirements

### Inheritance

- `UUPSUpgradeable` — upgrade mechanism
- `PausableUpgradeable` — circuit breaker
- `ReentrancyGuardUpgradeable` — fee transfer safety

### Child Token Contract: `MembaToken.sol`

Each deployed token is a standalone ERC-20:

```solidity
contract MembaToken is ERC20, ERC20Permit, Ownable {
    uint8 private immutable _decimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply,
        address tokenAdmin
    ) ERC20(name_, symbol_) ERC20Permit(name_) Ownable(tokenAdmin) {
        _decimals = decimals_;
        if (initialSupply > 0) {
            _mint(tokenAdmin, initialSupply);
        }
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
```

### Factory Storage

```solidity
/// @custom:storage-location erc7201:memba.storage.MembaTokenFactory
struct TokenFactoryStorage {
    address admin;
    address feeRecipient;         // Samouraï Coop Safe
    uint256 tokenCount;

    // Token registry
    mapping(uint256 => address) tokens;
    mapping(address => bool) isMembaToken;
    mapping(address => address) tokenCreator;

    // Symbol uniqueness
    mapping(bytes32 => bool) symbolUsed;
}
```

### Functions (with signatures)

| Function | Visibility | Modifiers | Description |
|---|---|---|---|
| `initialize(address admin, address feeRecipient)` | `external` | `initializer` | Set admin + fee recipient |
| `createToken(string name, string symbol, uint8 decimals, uint256 initialSupply, bytes32 salt)` | `external payable` | `whenNotPaused, nonReentrant` | Deploy ERC-20 via CREATE2, collect fee |
| `getTokenInfo(address token)` | `external view` | — | Returns name, symbol, decimals, totalSupply |
| `getTokenCount()` | `external view` | — | Total tokens deployed |
| `getToken(uint256 index)` | `external view` | — | Token address by index |
| `getTokenCreator(address token)` | `external view` | — | Who deployed this token |
| `isRegistered(address token)` | `external view` | — | Check if token was created by factory |
| `updateFeeRecipient(address newRecipient)` | `external` | `onlyAdmin` | Update fee recipient |

### Fee Mechanics

The 2.5% fee is collected on `createToken()` as a flat creation fee (in ETH), not on mint.

**Alternative** (closer to Gno behavior): Collect fee on each `mint()` call by wrapping the child token's mint with a factory-level function that takes a 2.5% cut. This requires the factory to be the `Ownable` admin and proxy mints.

**Decision needed** — see Open Questions.

### Events

```solidity
event TokenCreated(
    uint256 indexed tokenId,
    address indexed tokenAddress,
    address indexed creator,
    string name,
    string symbol,
    uint8 decimals,
    uint256 initialSupply
);
event FeeCollected(address indexed payer, uint256 amount);
event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
```

### Errors

```solidity
error NotAdmin();
error InvalidRecipient();
error InvalidParams();            // Empty name, symbol, or 0 decimals
error SymbolAlreadyUsed();
error InsufficientFee();
error DeploymentFailed();
```

### Security Requirements

- [x] ReentrancyGuard on `createToken()` — ETH fee transfer
- [ ] Checks-Effects-Interactions on fee collection
- [ ] Symbol uniqueness check (prevent impersonation)
- [ ] Name/symbol length limits (prevent gas-expensive storage)
- [ ] Decimals range check (0-18)
- [ ] Initial supply sanity cap
- [ ] Pausable on create (not on existing token operations)
- [ ] Event emission on all state changes

## Test Cases (minimum: 10)

1. Deploy factory → verify initial state (0 tokens, correct admin)
2. Create token → verify TokenCreated event + correct address
3. Create token → verify token is ERC-20 compliant (name, symbol, decimals)
4. Create token with initial supply → verify balance on creator
5. CREATE2 determinism → same salt → revert on collision
6. Different salt → different address
7. Fee collection → verify feeRecipient receives correct amount
8. Symbol uniqueness → second token with same symbol → revert
9. Non-admin cannot update feeRecipient → revert
10. Paused → createToken reverts
11. Token admin can mint → verify balance increase
12. Non-admin cannot mint on child token → revert

## Gas Estimates

| Operation | Estimated Gas | Notes |
|---|---|---|
| `createToken()` | ~800K-1.2M | Full ERC20 deployment via CREATE2 |
| `mint()` (child token) | ~50K | Standard ERC20 mint |
| `getTokenInfo()` | ~20K | View calls |

## Dependencies

- OpenZeppelin v5: `ERC20`, `ERC20Permit`, `Ownable`, `UUPSUpgradeable`, `PausableUpgradeable`, `ReentrancyGuardUpgradeable`
- Memba libs: `MembaFees` (for `_collectFee()`)

## Open Questions

- [ ] **Fee model**: Gno charges 2.5% on every `Mint()` call. On EVM, options:
  - (a) **Flat creation fee** in ETH — simpler, one-time
  - (b) **Mint fee** via factory proxy — closer to Gno parity, ongoing revenue
  - (c) **Both** — creation fee + mint fee
  - **Recommendation**: Option (b) for revenue parity. Factory holds `Ownable` and proxies mints.
- [ ] **Symbol uniqueness scope**: Global across all Memba tokens, or per-creator?
- [ ] **Permit support**: Include ERC-2612 Permit on child tokens? Low cost, high UX value (gasless approvals).
