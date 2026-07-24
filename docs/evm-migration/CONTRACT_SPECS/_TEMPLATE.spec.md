# Contract Specification Template

> Copy this file and rename it `<ContractName>.spec.md` to create a new contract spec.

## Purpose

One-paragraph description of what this contract does and why it exists.

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/<realm_name>`
- **Frontend**: `frontend/src/lib/<template>.ts` (LOC count)
- **Key functions**: `Function1()`, `Function2()`, `Function3()`

## Solidity Requirements

### Inheritance

- `UUPSUpgradeable` — upgrade mechanism
- `PausableUpgradeable` — circuit breaker
- `ReentrancyGuardUpgradeable` — if holds/moves funds

### Storage

```solidity
// Use ERC-7201 namespaced storage if complex
mapping(address => bool) public members;
```

### Functions (with signatures)

| Function | Visibility | Modifiers | Description |
|---|---|---|---|
| `initialize(...)` | `external` | `initializer` | Proxy init |
| `function1(...)` | `external` | `onlyMember` | Description |

### Events

```solidity
event EventName(type indexed param, type param2);
```

### Errors

```solidity
error NotMember();
error InvalidParams();
```

### Security Requirements

- [ ] ReentrancyGuard on state-changing functions (if funds involved)
- [ ] Checks-Effects-Interactions pattern
- [ ] No unbounded loops
- [ ] Access control on admin functions
- [ ] Event emission for all state changes
- [ ] Pausable circuit breaker
- [ ] UUPS upgrade restricted to multisig
- [ ] `initializer` modifier on init
- [ ] No `selfdestruct` / unguarded `delegatecall`
- [ ] Fee calculations use basis points

## Test Cases (minimum)

1. Deploy → verify initial state
2. Authorized action → verify state change
3. Unauthorized action → verify revert
4. Edge case → verify correct behavior
5. Event emission verification

## Gas Estimates

| Operation | Estimated Gas | Notes |
|---|---|---|
| `initialize()` | ~200K | One-time |
| `function1()` | ~50K | Per call |

## Dependencies

- OpenZeppelin v5: `AccessControl`, `UUPSUpgradeable`, etc.
- Memba libs: `MembaFees`, `MembaAccessControl`

## Open Questions

- [ ] Question 1 — needs decision
- [ ] Question 2 — needs research
