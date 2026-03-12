# Betanet Readiness — Backward-Compatible Execution Plan

> **Constraint:** Every change MUST keep test11 working identically. Betanet support is additive only.
> **Strategy:** All fixes use `getUserRegistryPath()` / `getExplorerBaseUrl()` which dynamically return the correct value based on `_activeNetwork`. Default = test11.

---

## Safe Changes (Ready to Execute Now)

### 1. Fix `getExplorerBaseUrl()` for betanet

**File:** [config.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/config.ts#L99-L106)

```diff
 export function getExplorerBaseUrl(): string {
     const chain = NETWORKS[_activeNetwork]?.chainId || "test11"
     switch (chain) {
         case "staging": return "https://staging.gno.land"
         case "portal-loop": return "https://gno.land"
+        case "betanet": return "https://betanet.gno.land"
         default: return `https://${chain}.testnets.gno.land`
     }
 }
```

| test11 impact | Why safe |
|---|---|
| ✅ Zero | `default` branch unchanged — test11 still returns `https://test11.testnets.gno.land` |

---

### 2. Fix hardcoded user registry link in DAOHome.tsx

**File:** [DAOHome.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/pages/DAOHome.tsx#L363)

```diff
-href={`${getExplorerBaseUrl()}/r/gnoland/users/v1`}
+href={`${getExplorerBaseUrl()}/${getUserRegistryPath().replace("gno.land/", "")}`}
```

> Add `getUserRegistryPath` to the import on L6.

| test11 impact | Why safe |
|---|---|
| ✅ Zero | `getUserRegistryPath()` returns `gno.land/r/gnoland/users/v1` on test11, replacing `"gno.land/"` → `r/gnoland/users/v1` — identical output |

---

### 3. Fix hardcoded user registry link in DAOMembers.tsx

**File:** [DAOMembers.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/pages/DAOMembers.tsx#L338)

```diff
-href={`${getExplorerBaseUrl()}/r/gnoland/users/v1`}
+href={`${getExplorerBaseUrl()}/${getUserRegistryPath().replace("gno.land/", "")}`}
```

> Add `getUserRegistryPath` to the import on L6.

| test11 impact | Why safe |
|---|---|
| ✅ Zero | Same logic as #2 — identical URL output on test11 |

---

### 4. Fix hardcoded profile URL in validators.ts

**File:** [validators.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/validators.ts#L154)

```diff
-profileUrl: gnoAddr ? `https://test11.testnets.gno.land/r/demo/profile:u/${gnoAddr}` : "",
+profileUrl: gnoAddr ? `${getExplorerBaseUrl()}/r/demo/profile:u/${gnoAddr}` : "",
```

> Add `import { getExplorerBaseUrl } from "./config"` at top.

| test11 impact | Why safe |
|---|---|
| ✅ Zero | `getExplorerBaseUrl()` returns `https://test11.testnets.gno.land` on test11 — identical URL |

---

### 5. Fix hardcoded memberstore link in dao/config.ts

**File:** [dao/config.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/dao/config.ts#L57)

Current (comment only — not runtime):
```typescript
// Format: [> Go to Memberstore <](https://test11.testnets.gno.land/r/gov/dao/v3/memberstore)
```

| test11 impact | Why safe |
|---|---|
| ✅ Zero | Comment only — no runtime behavior change |

> This is just a code comment. Low priority but can be updated for accuracy.

---

### 6. Fix Faucet description in directory.ts

**File:** [directory.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/directory.ts#L516)

```diff
-{ name: "Faucet", path: "gno.land/r/gnoland/faucet", description: "Testnet faucet for ugnot", category: "utility" },
+{ name: "Faucet", path: "gno.land/r/gnoland/faucet", description: "Faucet for ugnot", category: "utility" },
```

| test11 impact | Why safe |
|---|---|
| ✅ Zero | Text-only change — removes "Testnet" from description in case betanet serves this realm |

---

### 7. Dashboard.tsx — duplicate vote function name (cosmetic)

**File:** [Dashboard.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/pages/Dashboard.tsx#L160-L163)

```diff
 const isGov = checkIsGovDAO(realmPath)
 const msg = buildVoteMsg(userAddress, realmPath, proposalId, vote)
-const fn = isGov ? "MustVoteOnProposalSimple" : "VoteOnProposal"
-await doContractBroadcast([msg], `Vote ${vote} on proposal #${proposalId} (${fn})`)
+await doContractBroadcast([msg], `Vote ${vote} on proposal #${proposalId}`)
```

| test11 impact | Why safe |
|---|---|
| ✅ Zero | The function name string was only used in the log message. Actual voting uses `buildVoteMsg()` correctly. |

---

### 8. FaucetCard — "TESTNET ONLY" badge

**File:** [FaucetCard.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/components/dashboard/FaucetCard.tsx#L90-L95)

**No change needed.** The card is already gated by `GNO_FAUCET_URL` which is `""` for betanet → card is never rendered.

| test11 impact | Why safe |
|---|---|
| ✅ Zero | Not touching this file — already works correctly on both networks |

---

## Deferred (Not Safe Without More Context)

| # | Item | Why Deferred |
|---|------|-------------|
| D1 | `SEED_REALMS` lists `r/gnoland/users/v1` (L511) | Changing to dynamic would require `getUserRegistryPath()` at module level, which reads `_activeNetwork`. Works but makes realm list network-dependent — needs design thought. |
| D2 | `fetchUsers()` queries `gno.land/r/demo/users` (L329) | This is a different realm than `r/gnoland/users/v1`. May or may not exist on betanet. Needs chain verification first. |
| D3 | `isTestnet()` helper function | Not needed right now — no UI elements that check this. FaucetCard is gated by `GNO_FAUCET_URL`. Can be added later when needed. |

---

## Verification Plan

```bash
# 1. Build passes on BOTH networks
VITE_GNO_CHAIN_ID=test11 npm run build     # default — must pass
VITE_GNO_CHAIN_ID=betanet npm run build    # new — must pass

# 2. Unit tests pass
npm test -- --run

# 3. Manual check — test11 URLs unchanged
# Open browser, verify:
# - DAOHome "Register @username →" links to test11.testnets.gno.land/r/gnoland/users/v1
# - DAOMembers "Register @username →" links to test11.testnets.gno.land/r/gnoland/users/v1
# - Validator profile URLs point to test11.testnets.gno.land/r/demo/profile:u/g1...
# - FaucetCard shows "TESTNET ONLY" badge
# - Network selector shows "Testnet 11"

# 4. Manual check — betanet URLs (localStorage override)
# localStorage.setItem("memba_network", "betanet") → reload
# - DAOHome links to betanet.gno.land/r/sys/users
# - DAOMembers links to betanet.gno.land/r/sys/users
# - Validator profile URLs point to betanet.gno.land
# - FaucetCard hidden (no faucetUrl)
```

---

## Summary

| Change | Files | Lines | test11 Safe |
|--------|-------|-------|-------------|
| `getExplorerBaseUrl()` betanet case | `config.ts` | +1 | ✅ |
| DAOHome user registry link | `DAOHome.tsx` | 1 mod + 1 import | ✅ |
| DAOMembers user registry link | `DAOMembers.tsx` | 1 mod + 1 import | ✅ |
| Validator profile URL | `validators.ts` | 1 mod + 1 import | ✅ |
| Dashboard log message | `Dashboard.tsx` | 2 lines | ✅ |
| Faucet description | `directory.ts` | 1 word | ✅ |
| **Total** | **5 files** | **~10 lines** | **✅ All safe** |

> [!IMPORTANT]
> **All changes are additive.** The network is selected at runtime from `localStorage("memba_network")` defaulting to `test11`. Betanet paths only activate when explicitly selected. Zero existing behavior changes.
