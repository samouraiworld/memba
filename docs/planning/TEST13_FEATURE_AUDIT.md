# Memba test13 — Deep Feature Audit & Remediation Plan

**Date:** 2026-06-16 · **Trigger:** token creation fails with `/std.InternalError: recovered: unexpected node with location gno.land/r/samcrew/tokenfactory:0:0`
**Method:** 4 parallel feature audits (DAO core / commerce / auth+misc / config-gating) + direct `vm/qfile` probes across all 3 test13 RPC nodes (official, onbloc, aeddi).

---

## TL;DR

- **Root cause of your token error:** `r/samcrew/tokenfactory` is **present on test13 but invalid** (a v1 package the interrealm-v2 VM can't evaluate). Same for 5 other realms. Only the 4 DAO realms were redeployed under v2; the rest are stale v1.
- **Gno packages are immutable** → you can't redeploy over these paths. Fix = deploy to new `_v2`-style paths + repoint frontend, OR coordinate a test13 reset with the operators.
- **Independent bug found (all networks, not just test13):** agent registry writes (`RegisterAgent`/`ReviewAgent`) are 100% broken — builders emit `/vm.m_call` but the broadcaster only accepts `vm/MsgCall` → throws before broadcast. One-line-per-builder fix.
- **Immediate stopgap (no multisig):** add per-realm validity gating so the 6 broken features show "Coming soon" instead of raw runtime errors. Today `tokenfactory` and `feedback` have **zero** gating.

---

## 1. On-chain realm state (test13, verified on all 3 nodes)

| Realm | State | Feature | Source available? |
|---|---|---|---|
| memba_dao | ✅ VALID | DAO core | yes (deployed) |
| memba_dao_candidature_v2 | ✅ VALID | Candidature | yes (deployed) |
| memba_dao_channels_v2 | ✅ VALID | Channels | yes (deployed) |
| agent_registry | ✅ VALID (UseCredit hardened) | AI agents | yes (deployed) |
| **tokenfactory** | ❌ INVALID (v1-on-v2) | **Token create/mint/faucet** | yes — `/tokenfactory/tokenfactory.gno` (v2-form) |
| **escrow** | ❌ INVALID | Freelance/escrow (moves ugnot) | yes — `samcrew-deployer/projects/memba/realms/escrow/` |
| **nft_market** | ❌ INVALID | NFT list/buy/offer | yes — `…/realms/nft_market/` (BuyNFT TransferFrom defect pre-existing) |
| **gnobuilders_badges** | ❌ INVALID | On-chain badges | yes — `…/realms/gnobuilders_badges/` |
| **marketplace** | ❌ INVALID | (legacy; frontend only uses unused `lib/marketplace/queries.ts`) | **no local source** |
| **memba_feedback** | ❌ INVALID | Feedback feed | **no local source** (external) |

All deps of the redeployable realms (grc20, grc20reg, p/nt/*/v0, mux, ownable) are present & valid on test13 — a new-path deploy will succeed.

**Why this happened:** the `memba` deploy manifest's "frozen scope (default deploy)" is only realms order 1–4 (the DAO set). escrow/nft_market/gnobuilders_badges are in the manifest **without an `order`** (excluded from the default deploy); tokenfactory is a separate project never run for test13. So the v2 cutover only covered 4 of 10 realms.

---

## 2. Findings by severity

### 🔴 BLOCKER — Agent registry writes broken on every network (code bug, not test13)
`agentTemplate.ts` builders (`:510/529/551/569/586`) emit `type: "/vm.m_call"`, but `toAdenaMessages` (`grc20.ts:55`) throws on anything except `"vm/MsgCall"`. So `RegisterAgent` (`Marketplace.tsx:597`) and `ReviewAgent` (`:358`) — both reachable, ungated — fail before broadcast. `agentTemplate.test.ts:246` even locks in the wrong type. **Fix:** emit `"vm/MsgCall"` (every other builder does) + fix the test. ~1 line per builder.

### 🔴 BLOCKER — Token creation (your bug) + 5 other realms invalid on test13
See §1. User-visible: `CreateToken`/`TokenView` (mint/faucet/transfer/burn) throw `unexpected node`. **Fix track:** §3.

### 🟠 HIGH — No per-realm gating; two features have none at all
`networkHasRealms()` is coarse (per-network boolean), and `realmsDeployed:true` for test13 is correct (4 realms DO work) — but it can't express "4 valid / 6 invalid". `tokenfactory` (CreateToken) and `memba_feedback` (FeedbackPage) have **no gate** → raw runtime errors. Marketplace/NFT/Services are behind global `VITE_ENABLE_*` flags (build-global, not per-network). **Fix:** §3 stopgap.

### 🟠 MED–HIGH — Escrow can trap funds; `VITE_ENABLE_SERVICES` not CI-guarded
`FundMilestone` (`FreelanceServices.tsx:667`) sends real ugnot to the invalid escrow realm. Gated by `VITE_ENABLE_SERVICES` (default off) but — unlike NFT/TREASURY/AGENT_CREDITS — it's **not** in the CI safety gate (`ci.yml:97`). **Fix:** add it to the CI gate; keep off until escrow redeployed.

### 🟡 MED — Feature coverage gaps (pre-existing, not test13-specific)
- **Candidature accept/reject has no UI** — no `MarkApproved`/`MarkRejected` builder anywhere; approved applicants' deposits sit locked until an admin acts via CLI/gnoweb.
- **Channel admin unwired** — `CreateChannel`/`EditThread`/`DeleteThread`/`FlagThread`/membership builders exist but nothing calls them; only post/reply are exposed.

### 🟡 MED — test13 faucet URL likely wrong
`faucetUrl: https://faucet.gno.land` may not fund test13 → the new AddressOnlyLoginBanner faucet link (`Layout.tsx:305`) could send users to a faucet that can't help. **Verify.**

### 🟢 LOW / OK
- **Auth/login solid on test13** — chainId `test-13` round-trips correctly; address-only path + gate correct; allowlist sound. (You're logged in, so this is confirmed live.) Conditional on backend env, which is correctly set via `MEMBA_ACCEPTED_CHAIN_IDS=test12,test-13`.
- AddressOnlyLoginBanner trigger slightly over-broad (cosmetic).
- Feedback shows "No feedback yet" instead of a "not deployed" notice (wrong empty-state copy).
- Quests + gnolove: fine on test13 (graceful degradation / off-chain).

---

## 3. Remediation plan

### Track A — Immediate stopgap (frontend only, no multisig, ship today)
1. **Fix the agent_registry `/vm.m_call` bug** (TDD) — unblocks RegisterAgent/ReviewAgent everywhere.
2. **Add per-realm validity gating** in `config.ts`: a `REALM_ALLOWLIST` keyed by network + `isRealmValid(path)`; wire the two ungated pages first (`CreateToken`, `FeedbackPage` → `ComingSoonGate`), then AND it into Marketplace/NFT/Services. Stops all raw runtime errors; keeps the 4 working DAO features live.
3. Add `VITE_ENABLE_SERVICES` to the CI safety gate.
4. Verify/fix the test13 faucet URL.

### Track B — Real fix (multisig + frontend repoint)
For each commerce/social realm to bring live on test13: **deploy the v2 source to a NEW path** (e.g. `tokenfactory_v2`) since the existing paths are immutable+invalid, then repoint the frontend path constant. Redeployable now: tokenfactory, escrow, nft_market (patch BuyNFT TransferFrom first), gnobuilders_badges. No local source: marketplace (dead code — delete), memba_feedback (recover source or gate permanently).
- **Open question to confirm first:** whether `addpkg` truly rejects the existing invalid path (expected: yes). If the operators will reset test13 again soon, a same-path clean deploy of all realms is simpler — worth a quick check with aeddi.

### Track C — Feature completeness (separate backlog)
Wire candidature accept/reject + channel admin, or document as admin-CLI-only.

---

## Appendix — authoritative evidence
- `vm/qfile gno.land/r/samcrew/tokenfactory` → `/vm.InvalidPackageError` on official + onbloc + aeddi nodes (present-but-invalid).
- User tx error `unexpected node with location …:0:0` = stored package, v2-incompatible AST.
- memba_dao VALID on all 3 nodes (control).
