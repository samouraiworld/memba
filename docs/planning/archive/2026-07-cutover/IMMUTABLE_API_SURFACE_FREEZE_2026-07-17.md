# Immutable API-Surface Freeze — enumeration & owner sign-off gate
### Phase-7 deliverable · consolidates every "add getter X" finding across the audits · 2026-07-17

> **Why this exists.** The mainnet cut deploys several **append-only** realms. Once a realm is cut, you can never add an entrypoint to it — so **every** read/write the *whole program* (all features **+ the post-cut Phase-11 completion work**) will ever call must be enumerated and landed in the **single** cut. Red-team blocker #8: a compile-green dry-run does **not** catch a *missing* getter — only a wrong shape. This is the freeze list + the sign-off gate that must be green **before** `[1.4]`/Phase-8 executes.
>
> **Rule (from the red-team):** freeze the **UNION** of every entrypoint any phase — including deferred Phase-11 completion (real offer→accept, escrow_v4 wiring, PnL, provenance) — will call. Anything genuinely uncertain ships as its **own later sibling realm**, never as an assumed getter on the frozen realm.

Legend: **EXISTS** (present today, verified in audits) · **ADD** (absent — must land in the cut) · **CHANGE** (realm code change that must ride the cut).

---

## 1. `memba_nft_market_v3_2` (or successor) — market engine
| Entrypoint | Status | Needed by | Notes |
|---|---|---|---|
| `HasPurchased(buyer,seller)` | EXISTS (`sales_index.gno:68`) | Reviews purchase-gate, PnL | the review trust primitive |
| `PurchaseCount`, `GetSalesByBuyer` | EXISTS (`sales_index.gno:73/88`) | PnL/portfolio (Phase 11 DD-6) | wire the built getter into a PnL view |
| `GetListingsPage` | EXISTS (`getters.gno:49`) | NFT buy loop rebuild (Phase 11) | replaces the 50-row truncating render |
| **`SaleSeedSealed() bool`** | **ADD** (absent — grep empty) | **Reviews R2.2 (hard dep)** | consumer realm must assert seal==true; **the confirmed blocker** |
| **`MaxPrice` cap on `MakeOffer`** | **CHANGE** ([2.2]) | offer-safety | bound the offer price |
| **`GetTokenProvenance` / provenance read** | **ADD** | marketplace funnel (Phase 11) | authenticity/provenance UI |
| **batch collection-summary getter** | **ADD** | collection pages | avoid N+1 over cards |
| `SetPrimaryFeeBPS` (governed) | EXISTS (bounded ≤2000) | economics [7.1] | set-at-launch is valid |
| collection-offer-depth read | **SIBLING** (not this realm) | real offer engine [6.1] | offers is a *sibling* realm, not a v3_2 getter |

## 2. `memba_collections` — immutable grc721 ledger (the pacing realm)
| Entrypoint | Status | Needed by | Notes |
|---|---|---|---|
| `creditProceeds`, `WithdrawProceeds`, internal `proceedsOf` | EXISTS | creator payout | |
| **`GetProceeds(id,denom) → amount`** | **ADD** (absent — pilot blocker) | creator dashboard (Phase 5/11) | **the pilot's confirmed forgotten getter** |
| **`SetTokenURI` wrapper** | **CHANGE** ([2.3]) | creator edit | mint-time validation is defense-in-depth; primary XSS control is render-side (FE/proxy) |
| `primaryFeeBPS` init=0 + `SetPrimaryFeeBPS` | EXISTS | economics | mutable setter → set-at-launch valid |

## 3. `memba_market_config` — fee spine (cut ONCE by the pilot; Trading only consumes it)
| Entrypoint | Status | Needed by | Notes |
|---|---|---|---|
| `GetTreasury`, `GetFeeBPS`/`GetLaneConfig` | EXISTS | all money lanes | |
| `SetFeeBPS` (DAO-governed) | EXISTS | economics | |
| **`SetTreasury`/`SetFeeRecipient` → make 2-step (stage+accept)** | **CHANGE** | irreversible-sink guard (CSO) | today 1-step → the only irreversible loss vector; accept-based closes it (a target that can't `Accept` can never latch) |

## 4. `escrow_v4` (NEW realm — replaces the immutable, const-admin `escrow_v3`)
> `escrow_v3` admin/fee are compile-time `const` with no setter → the fix is a **new realm**, not an in-place patch.
| Entrypoint | Status | Needed by | Notes |
|---|---|---|---|
| **`TotalLiabilities()`, `RealmAddress()`, `AdminAddress()`, `FeeRecipient()`** | **ADD** (all absent) | NF-2 solvency reconciliation + T2.2 gate | pre/post-deploy solvency + `feeRecipient==GetTreasury()` assertion need these |
| **2-step `TransferAdmin`/`AcceptAdmin`** | **CHANGE** | key handoff to multisig | mirror `market_config`; target the multisig, **never** the executor-less DAO realm |
| **`assertNotPaused()` on `ResolveDispute`(387)/`ClaimRefund`(515)/`ClaimDisputeTimeout`(559)** | **CHANGE** (red-team blocker) | incident kill-switch | today the two permissionless drain paths ignore Pause → egress continues during an incident |
| **fee routing → `market_config.GetFeeBPS(serviceLane)`→`GetTreasury()`** | **CHANGE** | fee-spine parity | today hardcoded 2% to the wrong key |

## 5. `agent_registry_v2`
| Entrypoint | Status | Needed by | Notes |
|---|---|---|---|
| **`TotalLiabilities()`, `RealmAddress()`, `AdminAddress()`, `FeeRecipient()`** | **ADD** (absent) | solvency reconciliation | pooled custody realm |
| **bounded `UseCredit`** (per-window cap or signed voucher) | **CHANGE** | agent-credit trust | today creator draws depositor funds at will |
| on-chain solvency invariant (Σ liabilities ≤ balance) | **CHANGE — as monitored read/emit, NEVER a hard panic** | solvency | red-team: a panic gating a withdrawal = self-inflicted fund-lock |

## 6. `memba_token_otc_v2`
| Entrypoint | Status | Needed by | Notes |
|---|---|---|---|
| `EngineAddress()` | EXISTS (`otc.gno:243`) | OTC approve-address fix (FE-only, T0) | already present → the approve fix is a frontend change, no redeploy |
| listing liveness/expiry + bounded pagination getters | **SIBLING or CHANGE** (T5.1) | stale-book fix | decide in the freeze: land here or as a later deploy |

## 7. `tokenfactory_v2`
| Entrypoint | Status | Needed by | Notes |
|---|---|---|---|
| token metadata getters, `New`/`NewWithAdmin`, `Mint`/`Burn` | EXISTS | token launch | **has ZERO tests today** → behavioral suite is a Phase-6 gate |
| $MEMBA on-chain supply cap | **NOT FEASIBLE on the issued token** | disclosure (DD-8) | needs a **new instance + migration**; Jul-20 = disclosure-only |

## 8. Reviews — `memba_reviews_core_v1` engine + `memba_marketplace_reviews` (NEW gated wrapper)
| Entrypoint | Status | Needed by | Notes |
|---|---|---|---|
| **purchase-gated `PostReview`** (panics unless `HasPurchased(caller,seller) && caller!=subject && SaleSeedSealed()==true`) | **ADD** (new wrapper) | the whole reviews trust premise | marketplace-seller-scoped only |
| **`SetModerator` + `Paused`/`assertNotPaused`** | **ADD/CHANGE** | least-privilege moderator | dedicated key ≠ the drain key `g1x7k4628` |
| **reason-code arg on `Hide`** | **CHANGE** | accountable moderation | today silently moves the public average |
| **batch summary getter** | **ADD** | kill the `fetchSummaries` N+1 | |
| **Hide→repost→Unhide double-count fix** | **CHANGE** (in core engine) | reputation integrity | bakes into the immutable cut if not fixed |
| App Store review install/interaction gate | **ADD (separate primitive)** | app-review gate | **no analog to HasPurchased exists** → own tracked deliverable; keep `APP_REVIEWS` dark |

## 9. `grc721` (forked onto `p/samcrew/avl`)
| Entrypoint | Status | Needed by | Notes |
|---|---|---|---|
| ownership/approval/royalty/metadata getters | EXISTS | market settlement | |
| `ListNFT` ownership+approval precondition | **CHANGE** (on the market realm, not grc721) | phantom-listing DoS | `OwnerOf==seller && IsApprovedForAll(seller,market)` |

---

## Owner sign-off gate (must be GREEN before the cut executes)
- [ ] **Every `ADD`/`CHANGE` above is in the single coordinated cut** for its realm (or explicitly accepted as a permanent gap / scheduled as a named later sibling deploy).
- [ ] **Cross-feature confirmed:** `SaleSeedSealed()` is folded into the pilot market cut **before** it freezes (else Reviews is permanently stranded) — this is the **program-blocking** item.
- [ ] **Post-cut Phase-11 needs enumerated:** real offer→accept depth read, `GetProceeds`, `GetSalesByBuyer`/PnL, provenance, batch summary — each is either in the cut or a named sibling realm.
- [ ] **Sealing order** on the market: seed real sales → repoint admin to multisig → **then** `FinalizeSaleSeed` (so the `HasPurchased` set isn't fabricable by the single hot key).
- [ ] **Solvency getters** (`TotalLiabilities`/`RealmAddress`/admin/fee) present on **both** custody realms so pre/post-deploy reconciliation is possible.
- [ ] Sign-off owner: the **shared-artifact steward** (per the plan's Phase-0). Recorded as `MAINNET_READINESS.md` rows.

> **Status:** draft enumeration from the completed audits — **for owner review + steward sign-off**. Executable the moment the target VM is pinned (Phase 5). No realm code written; this is the design-artifact chokepoint that gates the cut.
