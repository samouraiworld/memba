# Memba — Connected-Mode Cross-Perspective Audit & Implementation Plan (2026-06-24)

> **Method.** Repo synced first (all Gno repos pulled; see §0). Then a cross-perspective audit of the **connected (authenticated) experience** — QA, Desktop, Mobile, Fullstack, User‑1 (first‑time member), User‑2 (power user / DAO admin), CSO, CTO — built ON TOP of the 2026‑06‑23 4‑perspective audit (`MEMBA_TEST13_LIVE_AUDIT_2026-06-23.md`) and **reconciled against current `main`** (`617b8c3`). Highest‑risk items were verified first‑hand at `file:line`; the rest reconcile prior findings to their current state.
>
> **Scope honesty.** A true wallet‑signed end‑to‑end pass (login signature, vote, mint, fund‑escrow, buy‑NFT) cannot be driven autonomously — it needs your Adena wallet + approvals. Those are covered by code‑level tracing + a **manual connected test script** (§7) for you to run. A supplemental 7‑agent breadth sweep over the ~15 not-yet-first-hand surfaces is **scoped and ready to launch on demand** (deferred this session by an intermittent tool‑safety‑classifier outage, not by scope).
>
> **Status tags:** `NEW` · `CONFIRMED-OPEN` (prior audit, still open) · `FIXED-VERIFIED` (prior finding, now fixed — confirmed in code) · `IN-FLIGHT(#468)`.

---

## 0. Repo sync result — no breaking changes reached the product
- **Memba `main` = `617b8c3`**, fully synced with origin; working tree clean (only an untracked `.remember/`). Local main is **ahead** of the last handoff (#466 NFT‑RPC pin, #467 docs cutover merged).
- All Memba **runtime dependencies already current** (behind=0): `gnodaokit`, `adena-wallet`, `samcrew-deployer`, `gnolove`.
- Only 3 repos had upstream updates, **none are Memba runtime deps**: `gnomonitoring` (+27), `gno-agent-workspace` (+4), `gno-docs` (+4) — pulled cleanly. `gno` is a pinned detached‑HEAD checkout (left untouched). A few sit on feature branches with no upstream (skipped safely).
- **Conclusion:** nothing in the latest pulls breaks Memba.

---

## 1. TL;DR — what actually matters now

The two prior CRITICALs are **fixed** (indexer tailer `block_meta` hash; login `args:null`). Today's risk is concentrated in **operability** (you still can't *see* the auth‑flip signal or indexer lag) and a tail of **honesty/UX/config** debt. Nothing currently open is fund‑loss‑critical in production (the fund‑moving features are correctly gated off).

| # | Issue | Sev | Persona/Tag | Status |
|---|-------|-----|------|--------|
| H1 | **No metrics/observability** — `auth_login` ratio & `IndexerLastBlock`‑vs‑head are log‑only; blocks safe enforcement flips & lag detection | HIGH | CTO/OPS | CONFIRMED-OPEN |
| H2 | **Multisig sig‑verify enforcement HELD** (`MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=0`) — Memba‑side identity surface (not on‑chain funds) | HIGH | CSO/SECURITY | gated on H1 |
| H3 | **Mobile bottom‑nav unusable on notched iPhones** — no `env(safe-area-inset-bottom)`, no `viewport-fit=cover` | HIGH | Mobile | CONFIRMED-OPEN |
| H4 | **Home "DAOs" count overcounts** all `r/samcrew` realms | HIGH | Fullstack/DATA | IN-FLIGHT(#468) |
| H5 | **Live OpenRouter key in root `.env:35`** still unrotated | HIGH | CSO/SECRET | CONFIRMED-OPEN |
| M1 | **Login failure force‑disconnects the wallet** (`Layout.tsx:135`) → rough retry loop for untransacted wallets under enforcement | MED | User1/UX | NEW |
| M4 | **CreateToken gate says "switch to Testnet 12"** (retired) (`CreateToken.tsx:69`) | MED | QA/UX | NEW |
| M5 | **gnoland1 selectable but realms likely undeployed** → connected DAO actions fail on Betanet | MED | QA/FUNCTIONAL | CONFIRMED-OPEN |
| M10 | **`AUTH-A2-DEBUG` temp logging** (`crypto.go:380-392`) overdue for removal (logs sign‑bytes/sig/pubkey) | MED | CSO | NEW |

Full list in §3. Verified‑correct negative space in §6.

---

## 2. Reconciliation of the 2026‑06‑23 audit (what changed)

**Now FIXED‑VERIFIED (confirmed in code this pass):**
- **Indexer tailer freeze (was CRITICAL)** — `parseBlockHash` reads `result.block_meta.block_id.hash` w/ `block_id` fallback + 3× retry (`tailer.go:385-398`).
- **Login signatures not verified (was HIGH)** — enforcement path correct; `allowUnsignedAuth()=false` rejects empty‑sig (`crypto.go:400`), signed‑invalid (`:373`), address‑only (`:427`). With `MEMBA_ALLOW_UNSIGNED_AUTH=0` live (#460) the login‑impersonation window is **closed**.
- **Candidature "Go to Quest Hub" → wrong route** — now `/quests` (`CandidaturePage.tsx:179`, #463).
- **Candidature accept/reject UI missing → deposits lock** — **now BUILT**: admin Approve/Reject buttons (`CandidaturePage.tsx:317-334`) via `buildMarkApprovedMsg`/`buildMarkRejectedMsg`, gated by an on‑chain `IsAdmin` check that fails closed.
- **Token factory invalid / CreateToken ungated** — `tokenfactory_v2` is in the test13 allowlist; CreateToken gates via `isTokenFactoryValid()` (`CreateToken.tsx:64`) with full input validation.
- **Escrow can trap funds** — correctly **double‑gated** (`!SERVICES_ENABLED || !isEscrowValid()`, `FreelanceServices.tsx:155`); safe while off.
- **CI safety‑gate "misses MARKETPLACE/BADGES"** — stale: the gate covers exactly the 4 fund‑unsafe flags; MARKETPLACE is intentionally on.

**Still CONFIRMED‑OPEN:** observability (H1), mobile safe‑area (H3), DAO overcount (H4, #468), ecosystem‑stat honesty (M3), banner pile‑up (M2), a11y non‑semantic divs (M7), backend single‑RPC (M9), "Back to Dashboard" mislanding (L1), deploy‑gate weakness (M6), dead code (L6), QuestAdmin client gate (L5), command‑palette iOS zoom (L4), `.env` flag divergence + live key (H5).

---

## 3. Findings (connected focus), prioritized

### HIGH
- **H1 — Observability gap** `[CTO/OPS]` `CONFIRMED-OPEN`. Telemetry is `slog` JSON only; no `/metrics`/prometheus/otel/sentry‑backend. The two production‑decision signals — `auth_login` result ratio (`crypto.go:236`) and `IndexerLastBlock` vs chain head — are only checkable by hand‑grepping Fly logs. **Why it matters:** this is the keystone — it's the precondition to safely flip H2 and would have caught the frozen indexer. **Fix:** Fly log‑drain → Grafana/Loki/BetterStack + 2 alerts: (a) signed‑login ratio, (b) `IndexerLastBlock` vs head delta. **Effort:** M.
- **H2 — Multisig sig‑verify enforcement HELD** `[CSO]` `gated`. `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=0` → `VerifyMultisigMemberSignature` is logged, not enforced. **Blast radius:** Memba‑side identity/data only — the on‑chain multisig still can't be forged (A3 reconstructs sign‑bytes server‑side; the chain enforces the real signature). **Fix:** capture a real multisig‑member signature, brute‑validate `VerifyMultisigMemberSignature` exactly like the login fix, then flip to `1`. **Gated on H1.** **Effort:** M.
- **H3 — Mobile bottom‑nav collides with iOS home indicator** `[Mobile]` `CONFIRMED-OPEN`. `index.css` `.k-mobile-tabbar` / `.k-bottom-sheet-content` are `position:fixed;bottom:0` with no `padding-bottom: env(safe-area-inset-bottom)`; `index.html` lacks `viewport-fit=cover`. **Fix:** add safe‑area padding + `viewport-fit=cover`. **Effort:** S.
- **H4 — Home "DAOs" stat overcounts all samcrew realms** `[Fullstack/DATA]` `IN-FLIGHT(#468)`. `traction.ts` → `fetchNamespaceRealms("samcrew").length` counts tokenfactory/escrow/nft/badges/feedback/etc., not DAOs. **Status:** PR #468 (worktree `/Gno/memba-cleanup`, branch `fix/home-dao-overcount`) stops computing it + purges 6 orphaned panels — **OPEN, not on `main`**; verify and land. **Effort:** S (land #468).
- **H5 — Live OpenRouter key in `.env`** `[CSO/SECRET]` `CONFIRMED-OPEN`. `.env:35` holds a real `sk-or-…` key. **Action:** rotate the key; confirm `.env` is gitignored and was never committed (`git log -- .env`). **Effort:** S.

### MEDIUM
- **M1 — Login failure force‑disconnects the wallet** `[User1/UX]` `NEW`. `Layout.tsx:135` calls `adena.disconnect()` on any login error. A transient backend hiccup boots the wallet entirely; an untransacted wallet (address‑only → rejected under enforcement) loops connect→fail→disconnect with only a raw error string. **Fix:** on login failure keep the wallet connected, surface a typed, actionable message (e.g. "Activate your wallet — one on‑chain tx"), offer Retry without a full reconnect. **Effort:** M.
- **M2 — Banner pile‑up** `[Desktop/Mobile/UX]` `CONFIRMED-OPEN`. `ChainHaltedBanner` + `RealmsNotDeployedBanner` + `AddressOnlyLoginBanner` (`Layout.tsx:302-317`) can stack above content, plus TopBar messages/toasts. **Fix:** collapse to one prioritized banner slot. **Effort:** M.
- **M3 — Ecosystem stats degrade dishonestly** `[Fullstack/DATA]` `CONFIRMED-OPEN`. Failed sources render confident "0" (`useEcosystemCounts.ts`), `fetchAgents()` returns fake `SEED_AGENTS` on hard RPC failure, `traction.ts` caches all‑zero for 5 min with a non‑network‑suffixed key. **Fix:** distinguish "0" from "unavailable (—)"; never seed fake data; suffix cache keys by network; short‑circuit zero‑caching on error. Coordinate with #468 / Atlas. **Effort:** M.
- **M4 — CreateToken gate references retired Testnet 12** `[QA/UX]` `NEW`. `CreateToken.tsx:67-69` tells users "the token factory contract is live on Testnet 12 — switch networks." test12 is retired and tokenfactory_v2 is live on test13. **Fix:** rewrite the not‑available copy (point at a valid network / remove the test12 reference). **Effort:** S.
- **M5 — gnoland1 (Betanet) selectable but realms likely undeployed** `[QA/FUNCTIONAL]` `CONFIRMED-OPEN`. `config.ts`: gnoland1 is non‑hidden and has **no `REALM_ALLOWLIST` entry**, so `isRealmValidOn('gnoland1', …)` returns true for everything and `networkHasRealms('gnoland1')` is true — the app believes all Memba realms work there. If they aren't deployed, switching networks → connected DAO/token/channel actions fail with raw VM errors. **Fix:** set `realmsDeployed:false` for gnoland1 (or add an explicit empty allowlist) until Memba is actually deployed there; verify on‑chain. **Effort:** S.
- **M6 — Deploy workflows weaker than PR CI** `[BUILD]` `CONFIRMED-PARTIAL`. `deploy-frontend.yml` re‑runs tsc/lint/test/build/audit but **omits** the feature‑flag safety gate, Playwright E2E, and bundle budget; `deploy-backend.yml` omits lint (golangci‑lint) + coverage. A direct hotfix push to `main` would deploy unguarded. **Fix:** make deploy jobs `needs:` the full `ci.yml` (or `workflow_run` after CI passes). **Effort:** S.
- **M7 — a11y: non‑semantic interactive elements** `[A11Y]` `CONFIRMED-OPEN`. Clickable `<div>`s without role/tabindex/keyboard on Dashboard/DAO/Validators/Extensions cards & rows; unlabeled inputs (TreasuryProposal); vote‑confirm dialog without focus‑trap; `DAOMembers` `#888`‑on‑dark sub‑WCAG contrast. **Fix:** semantic `<button>`/role+keyboard handlers, label every input, focus‑trap dialogs, theme‑token colors. **Effort:** M.
- **M8 — `useAdena` `changedNetwork` listener never unsubscribes** `[CODE-QUALITY]` `NEW`. `useAdena.ts:430-463` registers on every `state.connected` change and discards the result (`void registered`) — Adena exposes no unsubscribe, so connect/disconnect cycles **stack duplicate handlers**. **Fix:** register once at module/provider scope with a guard, or track a registered flag; long‑term, request an off‑handle from Adena. **Effort:** S.
- **M9 — Backend single‑RPC, no failover + config drift** `[RESILIENCE/CONFIG]` `CONFIRMED-OPEN`. Indexer/marketplace/home‑snapshot/quest‑verifier each hit one hardcoded RPC literal with no fallback list (frontend has one). `.env.example` `NFT_RPC_URL` still points at the public, rate‑limited `rpc.test13.testnets.gno.land` (fly.toml was pinned in #466 — drift). Verify `render_proxy.go` default isn't retired test12. **Fix:** backend fallback list; align `.env.example`; set RPC envs explicitly. **Effort:** M.
- **M10 — `AUTH-A2-DEBUG` temporary logging overdue** `[CSO/CODE-QUALITY]` `NEW`. `crypto.go:380-392` logs `reconstructed_sign_bytes`, `signature_b64`, `user_pubkey_json` on signed‑invalid, marked "remove once signed‑login ratio ~100%." Signed login is now enforced + verified live → remove (log‑noise + low‑grade info exposure). **Effort:** S.
- **M11 — Mobile multi‑column grid "tables" crush <360px** `[Mobile]` `CONFIRMED-OPEN`. Dashboard activity (`dashboard.css:144`) and multisig tx rows (`multisigview.css:216`) are fractional grids with no media query. **Fix:** stack/scroll on narrow viewports. **Effort:** S.
- **M12 — Backend failures look like "you have nothing"** `[Fullstack/FUNCTIONAL]` `CONFIRMED-OPEN`. `Dashboard.tsx`/`TokenDashboard.tsx` only `console.warn` on backend error → outage is indistinguishable from empty. **Fix:** non‑blocking "service unreachable" notice. **Effort:** S.

### LOW / polish
- **L1 — "Back to Dashboard" mislands on home** `[UX]` `CONFIRMED-OPEN`. Confirmed instances: `CandidaturePage.tsx:280`, `CreateToken.tsx:187`, plus prior `NotFound`/`ComingSoonGate`/`DAOList`. `/dashboard` 302s to `/:network/`. **Fix:** relabel "Back to Home" or point at a real surface. **Effort:** S.
- **L2 — CreateToken inline styles / hardcoded hex** `[CODE-QUALITY]` `CONFIRMED-OPEN`. Pervasive `#00d4aa`/`#0c0c0c`/`#222` inline styles (vs the codebase's CSS‑module + theme‑token pattern) — won't adapt to the planned light theme. **Effort:** M.
- **L3 — Stale comments/config** `[CONFIG]` `CONFIRMED-OPEN`. `config.ts:503` `nftCollectionsPath … (pending deploy)` is live since 2026‑06‑17; other "NOT YET DEPLOYED" comments on live realms. **Effort:** S.
- **L4 — Command‑palette 15px input → iOS zoom** `[Mobile]` `CONFIRMED-OPEN` (`command-palette.css:54`). **Fix:** ≥16px font. **Effort:** S.
- **L5 — QuestAdmin client‑side hardcoded admin gate** `[SECURITY-minor]` `CONFIRMED-OPEN` (`QuestAdmin.tsx`). UI‑only; move the allowlist server‑side. **Effort:** S.
- **L6 — Dead code** `[DEAD-CODE]` `CONFIRMED-OPEN/IN-FLIGHT(#468)`. `NetworkStatsLive.tsx`, `.board-sidebar` CSS; #468 purges 6 Control‑Room panels + `useEcosystemCounts`. **Effort:** S.
- **L7 — FreelanceServices: demo‑badge unreachable + no modal focus‑trap** `[CODE-QUALITY/A11Y]` `NEW`. `isDemo=(real.length===0)` can't co‑occur with rendered cards (the `demo` badge is effectively dead); Post/Hire modals aren't focus‑trapped. **Effort:** S.
- **L8 — Candidature approve ≠ membership** `[User2/UX]` `NEW`. Approve returns the deposit but an admin must still create a "Propose Add Member" proposal (`CandidaturePage.tsx:206-209`). The two‑step flow can confuse admins. **Fix:** make the next step explicit/linked. **Effort:** S.

### NFT (gated‑off) — readiness, not a live bug
- `VITE_ENABLE_NFT=false`; stated reason "incomplete custody flow (buyer pays, NFT never moves)" (A9.policy). The v3 engine (`memba_nft_market_v3`) is deliberately **not** in the realm allowlist (Phase‑3 router pending). **Go‑live gating** (don't flip until all true): custody/settlement verified on the wired engine; PR #443 wiring landed + reviewed; observability (H1) live to watch the indexer; `.env.example` NFT config de‑drifted. A dedicated backend/NFT lens is part of the ready‑to‑launch breadth sweep (§8).

---

## 4. Implementation plan (phased, each phase independently shippable & revertible)

> Branch discipline: **never commit to `main`** — branch off updated `main`, PR, admin‑merge only on explicit per‑PR approval. No Claude attribution. Backend changes TDD where logic changes. Each phase below is a small PR or two.

### Phase 0 — Safety & honesty quick wins (low risk, ship first)
0.1 **Rotate the OpenRouter key** (H5) + confirm `.env` gitignored/never committed. *(Operator action for the rotation; I verify gitignore + scrub history if needed.)*
0.2 **Remove `AUTH-A2-DEBUG` logging** (M10), `crypto.go:380-392`. TDD: keep the signed‑invalid path, drop the debug emit. 
0.3 **Fix CreateToken "Testnet 12" copy** (M4) + **relabel "Back to Dashboard"** instances (L1).
0.4 **gnoland1 gating** (M5): set `realmsDeployed:false` (or empty allowlist) after verifying on‑chain. 
0.5 **Stale comments** (L3): `config.ts:503` + "NOT YET DEPLOYED".
0.6 **Command‑palette font ≥16px** (L4).
- *Acceptance:* no behavior change beyond copy/gating; CI green; manual spot‑check of CreateToken gate + network switch.

### Phase 1 — Observability keystone (H1) — highest leverage
1.1 Fly log‑drain → Grafana/Loki (or BetterStack). 1.2 Alert A: `auth_login` signed‑ratio drop. 1.3 Alert B: `IndexerLastBlock` vs chain head delta > N. 1.4 Surface both on `/health`.
- *Acceptance:* dashboards show live auth ratio + indexer lag; alerts fire on synthetic breach. **Unblocks Phase 2 + NFT go‑live.**

### Phase 2 — Complete auth enforcement (H2) — gated on Phase 1
2.1 Capture a real multisig‑member signature; brute‑validate `VerifyMultisigMemberSignature` (mirror the login‑fix method) + permanent regression vector. 2.2 Flip `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1`; verify live via Phase‑1 dashboards (24h token TTL → stragglers re‑auth within a day).
- *Acceptance:* real multisig sigs verify GREEN pre‑flip; post‑flip metrics show no legitimate rejections. **Rollback:** flip back to `0` (lockout‑safe two‑phase design).

### Phase 3 — Connected UX / mobile / a11y hardening
3.1 Mobile safe‑area + `viewport-fit=cover` (H3). 3.2 Login‑failure UX: don't force‑disconnect; typed message + Retry (M1). 3.3 Banner consolidation to one prioritized slot (M2). 3.4 a11y: semantic roles/keyboard + dialog focus‑traps + theme‑token colors (M7); FreelanceServices modal focus‑trap (L7). 3.5 Mobile table collapse (M11) + command‑palette already in P0.
- *Acceptance:* axe/Lighthouse a11y pass on key pages; iPhone‑X→16 bottom‑nav reachable; login failure no longer disconnects.

### Phase 4 — Data‑correctness & dead‑code
4.1 Land **#468** (DAO overcount + 6‑panel purge + `useEcosystemCounts` removal) (H4, L6) — review & merge on approval. 4.2 Ecosystem‑stat honesty: "—" vs "0", no fake seeds, network‑suffixed cache, no zero‑caching on error (M3). 4.3 Backend error surfaces on Dashboard/TokenDashboard (M12). 4.4 `useAdena` listener cleanup (M8). 4.5 Remove `NetworkStatsLive.tsx`/`.board-sidebar` + the demo‑badge dead branch (L6/L7).
- *Acceptance:* a forced RPC failure renders "unavailable", not "0"/seed; counts match on‑chain; no duplicate `changedNetwork` handlers after reconnect cycles.
- ⚠️ **GOTCHA (from prior sessions):** do **not** mirror the frontend `"active"` removal into backend `home_rpc.go` (raw render `ACTIVE` = open). Keep both proto field sets.

### Phase 5 — Resilience & build gates
5.1 Backend RPC fallback list for indexer/marketplace/home‑snapshot/quest‑verifier (M9). 5.2 Align `.env.example` NFT config to the pinned node (M9). 5.3 Deploy workflows `needs: ci` / `workflow_run` (M6). 5.4 Shorten Fly backup interval + run a restore drill (testnet‑acceptable today, but cheap insurance).
- *Acceptance:* killing the primary RPC degrades gracefully; a direct push to `main` runs the full gate before deploy.

### Phase 6 — NFT go‑live (separate track, gated on Phase 1)
Verify custody/settlement on `memba_nft_market_v3`; land #443 wiring; de‑drift NFT env; only then flip `VITE_ENABLE_NFT`. Out of scope for the connected‑hardening sprint above.

---

## 5. CTO hardening notes (why this order, and the rails)
- **Observability before enforcement, always.** H1 is sequenced first because flipping H2 (or NFT) blind is how the frozen indexer hid for ~150k blocks. No enforcement flip ships before its dashboard exists.
- **Each phase is independently revertible.** P0/P3/P4 are flag‑free UI/logic PRs (revert = revert the PR). P2/P6 are env‑flag flips (revert = flip back; the two‑phase auth design is lockout‑safe). No phase depends on a later one.
- **Lead with the smallest, safest wins (P0)** to bank momentum and shrink the diff that reviewers must hold in their head — then the riskier ops/enforcement work lands against a cleaner baseline.
- **Don't expand scope mid‑PR.** The light‑theme migration implied by L2/M7 is real but large; keep it a tracked follow‑up, not smuggled into a11y PRs.
- **Test bar (AAA):** backend logic changes are TDD with permanent regression vectors (the tailer `block_meta` and login `args` bugs both shipped because tests used synthetic inputs — add real‑body fixtures); frontend a11y changes get axe/Lighthouse assertions; the safety‑flag CI gate stays authoritative.
- **Merge discipline:** no PR merges without explicit per‑PR approval, even with green CI; prod/enforcement flips are confirmed + verified live.
- **What NOT to do:** don't flip `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` or `VITE_ENABLE_NFT` before Phase 1; don't enable `VITE_ENABLE_SERVICES`/`TREASURY_SPEND`/`AGENT_CREDITS` (incomplete on‑chain enforcement — the CI gate enforces this); don't mirror the frontend `"active"` removal into backend render.

---

## 6. Verified‑correct (negative space — confirmed fine)
Crypto/auth core (challenge binding, nonce replay, chain‑id binding, server‑side sign‑byte reconstruction, two‑phase lockout‑safe rollout); indexer tailer hash fix + retry; **escrow double‑gating**; **token‑factory gating + validation + fee disclosure**; **candidature accept/reject now built (on‑chain `IsAdmin`, fails closed)**; RPC trust allowlist (`isTrustedRpcDomain`) + re‑validation on `changedNetwork`; per‑realm `isRealmValid` gating; strong CI (race tests, coverage gate, govulncheck, golangci‑lint, bundle budget, Playwright E2E, Lighthouse, proto‑breaking, docker); skip‑to‑content + `aria-live` toasts; Layout `changedAccount` listener correctly cleaned up (contrast M8). GHCR image mirror gives a real backend rollback path.

---

## 7. Manual connected test script (please run with your Adena wallet)
The flows below need real signatures/approvals. Run on **test13**, connected.
1. **Login:** connect Adena → expect a single sign‑popup → land authenticated; refresh → silent reconnect (no popup). Lock the wallet → reload → confirm it doesn't wedge.
2. **Wrong chain:** switch Adena to a non‑test13 chain → confirm the wallet‑switch prompt works and doesn't strand you.
3. **Candidature:** with ≥100 XP, submit (deposit tx) → see "pending"; as an admin, Approve a pending applicant → deposit returns; confirm the "Propose Add Member" next‑step copy.
4. **DAO governance:** open a proposal → vote → confirm optimistic state matches the chain after refresh.
5. **Token:** create a GRC20 (self‑admin) → mint/faucet/transfer/burn from TokenView → confirm fee disclosure matches.
6. **Multisig:** create/import a multisig → propose a tx → sign → broadcast → verify state in TransactionView.
7. **Failure UX:** trigger a backend hiccup mid‑login (e.g. offline) → confirm the wallet is NOT force‑disconnected after Phase 3 (today it is — M1).

---

## 8. Method, limitations & the ready agent pass
- First‑hand verified at `file:line`: tailer, crypto/auth, CI, both deploy workflows, `useAdena`, `config.ts`, `Layout.tsx`, `CandidaturePage.tsx`, `FreelanceServices.tsx`, `CreateToken.tsx`; reconciled the full 2026‑06‑23 audit.
- **Not yet first‑hand (covered by prior audit + ready agent briefs):** channels admin wiring, NFT stack, Marketplace/agents internals, profile/settings/alerts/OAuth, Validators/gnolove read surfaces, backend `service/`+`db/`+`points/` handler internals, the `traction`/`useEcosystemCounts` libs.
- A 7‑agent cross‑perspective breadth sweep over those is **scoped and ready** and can be launched on demand (deferred this session by an intermittent tool‑safety‑classifier outage, not by scope).

---

## 9. Member Home (Atlas) — live connected‑test feedback (2026‑06‑24)
> Source: your live **signed‑in** session on test13 (the connected pass I can't drive). All 7 items are member‑home (Atlas) issues; each is mapped to code and folded into the phases below.

- **MH1 — Rename "Your worlds" → "Your organisations"** `[UX/copy]` `S`. `YourWorldsPanel.tsx:39` (`<h3>Your worlds</h3>`), eyebrows `:51,:58`, the DAO‑count label `:42`, empty hint `:83`. Display text only (keep component/file names to avoid churn). → **Phase 0.**
- **MH1b — Dead panel icon** `[DEAD-CODE]` `S`. `YourWorldsPanel.tsx:38` `<i className="ti ti-world">` — the app ships **no Tabler font** (confirmed in the #465 review), so the title icon renders blank. Replace with a Phosphor icon or drop. → **Phase 0.**
- **MH2 — Stale test11 DAOs appear in "Your worlds"** `[DATA/FUNCTIONAL]` `MED-HIGH` `M`. Root cause: `useYourWorlds`→`getSavedDAOsForOrg`→`getSavedDAOs()` reads `localStorage["memba_saved_daos"]`, which is **NOT network‑scoped** (`daoSlug.ts:7,114`). DAOs saved on test11 (FOUFOU/French Boulangerie/Surf Club/hihihi) persist into test13 and render as **degraded cards** when their config fetch fails on the test13 RPC (`useYourWorlds.ts:135-137`). It's a **client‑side localStorage artifact, not the backend.** **Fix:** (a) network‑scope saved DAOs (key by `networkKey`, or store+filter a `network` field); (b) drop degraded/unreachable cards on the active network (optionally AND `isRealmValidOn(networkKey, realmPath)`); (c) one‑time migration that scopes/clears the legacy global `memba_saved_daos`. → **Phase 0** (this is user‑visible breakage, not just polish). *Re: "backend should only show connected‑network info" — Your‑worlds is localStorage; separately verify `home_rpc.go` / featured‑DAO / traction are network‑scoped (covered by H4/M3).*
- **MH3 — "Your organisations" must be editable (remove / favorite from home)** `[UX/feature]` `M`. The data layer already has `removeSavedDAOForOrg` (`daoSlug.ts:203`) but it's unwired in the home, and there's no favorite/pin concept. **Fix:** per‑card remove (unpin) + a `favorite` flag on `SavedDAO` with pin‑to‑top sort; wire into `YourWorldsDoor`. → **Phase H.**
- **MH4 — GovDAO needs a distinct tag** `[UX]` `S-M`. `gno.land/r/gov/dao` is the gno.land **Layer‑1 GovDAO** (`daoSlug.ts:14`), not a Memba org — distinguish + pin it. **Fix:** detect the realm path → render a "Layer 1 · GovDAO" badge, pin first. → **Phase H.**
- **MH5 — "Top contributors" → avatars + monthly + add Top Teams** `[UX/data]` `M`. `ContributorsDoor.tsx` renders **initials, not avatars** (`:73-75`) and (likely) all‑time scores via `useGnoloveHighlights`. **Fix:** (a) real GitHub avatars (gnolove supplies URLs) with initials fallback; (b) point the hook at **monthly** scores (gnolove "This Month"); (c) add a **"Top teams"** door/section (gnolove teams‑by‑score exists). → **Phase H.**
- **MH6 — "Network health" should show more** `[UX/data]` `S-M`. `NetworkHealthDoor.tsx` intentionally shows only `{active}/{total}` + status (`:77-90`); avgBlockTime/avgUptime are available but omitted. **Fix:** add real, available metrics (avg block time from `useNetworkPulse`, block height, uptime/participation) — **without** fabricating; keep the honesty contract. → **Phase H.**
- **MH7 — Bottom cards must be uniform size (AAA)** `[UX/CSS]` `S-M`. The bottom doors mix variants (`list`/`stat`/…) → uneven heights (contributors taller). **Fix:** equal‑height doors in `home.css` (grid `align-items:stretch` + shared `min-height`/internal layout). → **Phase H.**

**Phase placement update:** Phase 0 now also ships **MH1 + MH1b + MH2** (rename, dead‑icon, network‑scoped your‑worlds). **New Phase H — Member Home (Atlas) AAA polish** = MH7 (card uniformity first, sets the frame) → MH4/MH5/MH6 (per‑door enrichment) → MH3 (editable orgs). Phase H slots after Phase 0, parallelizable with Phase 3 (both are connected‑UX); no dependency on observability.

> **MH1 + MH1b implemented** on branch `fix/home-connected-feedback` (rename + Phosphor `Buildings` icon, test updated) — ⚠️ **not yet locally verified** (the frontend test runner can't boot in this pnpm workspace: `frontend/node_modules` lacks `vitest`/`@sentry/vite-plugin`; needs `pnpm install`/`npm ci` or CI). MH2 is designed (network‑tag saves + show `tagged‑active OR untagged‑reachable` + self‑heal tagging) but **not built**.

---

## 10. Breadth‑sweep findings (7‑agent cross‑perspective fleet, 2026‑06‑24)
> Seven background agents (DAO‑gov, multisig, commerce, social/account, CSO, CTO, backend/NFT) swept the surfaces I hadn't covered first‑hand. They **corrected several of my assumptions** and added ~50 findings. The corrections (§10.1) matter most.

### 10.1 Corrections to THIS plan (act on these)
- **H2 is BLOCKED by format bugs, not just "validate then flip."** `pages/ProposeTransaction.tsx:159` stores a Cosmos‑shape `feeJson` (`{amount:[…],gas}`) but the A3 verifier `backend/internal/auth/multisig_verify.go:89` parses `{gas_wanted,gas_fee}`; and `ProposeTransaction.tsx:71,110` stores Amino‑wrapper `{type,value}` msgs while Adena signs the gno‑canonical `{"@type":"/vm.m_call",…}` form the verifier reconstructs. **Result: flipping `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1` today would reject EVERY propose‑flow signature → total multisig lockout.** `CreateToken.tsx:137` already uses the correct `{gas_wanted,gas_fee}` shape — it's an intra‑repo inconsistency. **Plus:** the broadcast fallback `TransactionView.tsx:473‑503` hex‑encodes Amino‑JSON, but gno's `broadcast_tx_commit` wants Amino‑binary (base64) → the terminal broadcast step is likely broken when Adena lacks `BroadcastMultisigTransaction` (needs live confirm). **➡ H2 now has a code‑fix prerequisite (align propose fee/msg shapes + golden round‑trip test vs a real Adena sig) AND a separate multisig‑broadcast investigation. Do NOT flip enforcement until both are fixed.** [Agent B; corroborated by G's "A3 design sound, stored format diverges"]
- **NFT gating reason is STALE.** Agent G traced v3 (`memba_nft_market_v3`) custody: `BuyNFT`/`AcceptOffer` use strict CEI (validate exact payment → remove listing → `MarketTransfer` → payouts), all in one atomic tx, so a transfer failure panics and **refunds the buyer** — "buyer pays, NFT never moves" was the *v1* bug and **cannot occur on v3**. **➡ Correct §3‑NFT/Phase 6: the real go‑live gates are (a) add `memba_collections` to `NFT_WATCHED_REALMS` (v3 mints/new‑collections won't index without it), (b) de‑drift `backend/.env.example`+`fly.toml`, (c) observability (H1), (d) PR #443 wiring — NOT a custody bug.** [Agent G]
- **L6 dead‑code list is half‑stale.** `NetworkStatsLive.tsx` + `useEcosystemCounts` are **already deleted** (#468/#470 landed). Remaining real dead code is bigger than listed — see §10.4.
- **H5 scope downgraded (good news).** Root `.env` is **gitignored AND was never committed** (`git log -- .env` empty; only `.env.example` tracked). **➡ Only the in‑tree OpenRouter key value needs rotation — no git‑history scrub.** [Agents E, G]

### 10.2 NEW HIGH — pull into Phase 0 (cheap, high‑value)
- **N1 `[SECURITY/HIGH]` `/api/analyst/consensus` is unauthenticated** — `backend/cmd/memba/main.go:194` — fans out to **10 paid OpenRouter models** per cache‑miss; the cache key `(realmPath,proposalId,chainId)` is attacker‑variable, so it's an API‑key cost‑drain / feature‑DoS (only the per‑/24 `analyst` limiter stands in the way). Its sibling `/analyze` IS auth‑wrapped (SEC‑03) — this one was missed. Fix: wrap in `requireAuthMiddleware`. **S.** [Agents E + G, independently — strong signal]
- **N2 `[SECRET/HIGH]` Live Lighthouse key ships in the client bundle + bypasses the server proxy** — `frontend/src/lib/ipfs.ts:224‑228`, `components/profile/AvatarUploader.tsx:39`, `.env:26` — when `VITE_LIGHTHOUSE_API_KEY` is set, avatar upload POSTs the `Bearer` key **directly** to Lighthouse (defeating the auth‑gated server proxy + MIME/size re‑validation). Any prod build inheriting that var leaks the key in downloadable JS. Fix: always route via `uploadViaProxy`, stop reading the VITE_ var, rotate the key. **S.** [Agent E]

### 10.3 NEW MED — fold into Phase 3/4 (and one into Phase 2)
- **N3 `[FUNCTIONAL]` Treasury "Propose Spend" is dead for tier/memberstore DAOs** — `pages/Treasury.tsx:40` calls `getDAOMembers(rpc, realmPath)` WITHOUT `cfg.memberstorePath` (unlike DAOHome/DAOMembers/ProposalView) → member list empty → `isCurrentUserMember` always false → the Propose button is hidden for real members. Ships broken the moment `TREASURY_SPEND_ENABLED` flips. **S.** [Agent A]
- **N4 `[DATA]` `getDAOConfig` threshold regex can capture the Quorum value** — `lib/dao/config.ts:40` `(?:Threshold|Quorum)` matches whichever appears first → wrong pass/fail line on the vote chart + wrong DAO‑card stat. **S.** [Agent A]
- **N5 `[UX]` Vote/execute success banner is wiped by a full‑page skeleton** — `pages/ProposalView.tsx:187,217` call non‑silent `loadProposal()` (sets `loading=true`) → the just‑set "Voted ✓" flashes then the page blanks to skeletons. Fix: `loadProposal(true)`. **S.** [Agent A]
- **N6 `[FUNCTIONAL]` New proposals invisible ~30s after creation** — `pages/ProposeDAO.tsx:159`, `TreasuryProposal.tsx:94` never call `invalidateProposalCache(realmPath)` → the 30s cache serves a list without the new proposal → looks like the tx failed. **S.** [Agent A]
- **N7 `[SECURITY]` Candidature eligibility gate is localStorage‑authoritative (bypassable)** — `lib/quests.ts:262` `canApplyForMembership()` reads `totalXP` from localStorage; the Dashboard "eligible" banner + CandidaturePage gate can be flipped by editing localStorage. UI‑gate only — the **realm must independently enforce** XP/eligibility. Fix: derive the gate from backend XP. **M.** [Agents A, G]
- **N8 `[SSRF]` NFT image proxy is DNS‑rebinding‑vulnerable on the `https://` path** — `backend/internal/service/ipfs_serve.go:266` validates the resolved host, then `:322` re‑resolves on a separate connection (TOCTOU). Bounded (info‑leak, 15MB/10s caps) but real for `uri=https://…`. Fix: validate the *connected* IP via a custom `DialContext`. **M.** [Agent E] *(Agent G rated the overall SSRF guard solid; the gap is specifically the https‑uri branch.)*
- **N9 `[BUILD]` CI safety gate can't see the real prod build env** — `ci.yml:90` greps only `.env.example`; the Netlify dashboard env (and local `.env`, already `NFT/SERVICES=true`) are invisible to it → a fund‑gated flag could ship with a green pipeline. Fix: assert flags at build time from `import.meta.env`. **M.** [Agents E, F] *(strengthens M6/the gate framing)*
- **N10 `[FUNCTIONAL]` Self‑deployed agent‑registry template ↔ parser mismatch** — `lib/agentTemplate.ts` `renderHome/renderAgent` emit a markdown list while `lib/agentRegistry.ts:158` parses only pipe‑tables → any *user‑deployed* registry lists 0 agents. Latent (the canonical `r/samcrew/agent_registry` is fine — and its `vm/MsgCall` fix is **verified** + regression‑tested). **M.** [Agent C]
- **N11 `[RESILIENCE]` Backups sit on the same volume they protect** — `backend/internal/db/backup.go` writes `VACUUM INTO backups/` on the **same** Fly volume; the documented "volume on unreachable host" loss takes the DB *and* all backups. Fix: off‑volume backups (S3/object‑store/litestream) + restore drill. **M.** [Agent F]
- **Multisig UX/correctness** [Agent B]: sign‑button "already signed" uses `adena.address` in `TransactionView.tsx:213` vs `auth.address` in `MultisigView.tsx:193` (mis‑gates during reconnect — use `auth.address`); Propose/Create/Import forms are fully interactive while disconnected (submit‑only gate) vs MultisigView/Hub which hard‑gate; `CreateMultisig.tsx:108` de‑dupes addresses but not pubkeys (a "2‑of‑3" could be 1 key). **S each.**
- **Backend confirmed** [Agents E/F/G]: `render_proxy.go:26` default RPC **is** retired test12 (fix → test13, **S**); backend has **no RPC failover** while the frontend has `rpc Fallback.ts` (**M**); quest meta‑quests (`earn‑500‑xp`/`complete‑all‑everyone`/`top‑10`) are low‑trust‑accept server‑side (**M**).

### 10.4 NEW LOW / dead‑code (Phase 4/5 sweep)
- **Dead code (verified zero prod importers)** [Agents D, F]: `lib/escrowTemplate.ts` (615L) + `lib/nftMarketplaceTemplate.ts` (440L) realm‑codegen, `components/ui/ConnectWalletPrompt.tsx`, `hooks/useMultisig.ts`, `components/dao/DAOCards.tsx` (its `StatCard` is triplicated — also in `Treasury.tsx:268`, `TokenDashboard.tsx:193`), barrels `components/dao/index.ts` + `lib/marketplace/index.ts`, `.board-sidebar` CSS in `plugins/board/board.css`, `buildFlagThreadMsg` (FlagThread is wired inline in `FlagButton.tsx`), legacy `boardTemplate.buildCreateChannelMsg` (test‑only). ~1,500+ dead lines.
- **Stale config/comments** [Agents F, G]: `lib/nftConfig.ts:7‑9,20‑23` names v2 as live + "NOT YET DEPLOYED" (v3 is live); `config.ts:498` "(pending deploy)"; test12 strings in `gnoweb.ts:120`, `dao/builders.ts:20`, `templates/prologue.ts:25`, `Changelogs.tsx`; `realm-versions.json` retains empty `test11/staging/portal-loop` + full `test12` blocks.
- **a11y** [Agents A, C, D]: vote‑confirm dialog not focus‑trapped (`ProposalView.tsx:494`); `Settings.tsx:62`/`AlertsPage.tsx:65` accordion toggles lack `aria-expanded`; Marketplace favorite is a clickable `<span>` nested in a card `<button>` (`Marketplace.tsx:301`).
- **Misc** [Agents A, C, D]: `isCreator`/hasVoted use 10‑char address‑prefix `startsWith`/`includes` (false matches) — `Marketplace.tsx:340`, `ProposalView.tsx:143`; agent register form allows pay‑per‑use price 0; optimistic refetch after register/review races the indexer; `FeedbackPage.tsx:17` repo casing `samouraiworld/Memba`; OAuth `redirect_uri` relies on an implicit `LegacyRedirect` hop (works, undocumented); quest‑review authority is a single hardcoded admin address.
- **Test‑gap** [Agent F]: 42/47 page components have no co‑located unit test; frontend has no per‑file coverage floor (backend gate is 20%).

### 10.5 Re‑prioritized Phase 0 (folding in the cheap wins above)
P0 now = **N1 (analyst auth) + N2 (Lighthouse key) [HIGH security, both S]** · `render_proxy.go`→test13 · MH1/MH1b (done, verify) · MH2 · M4/test12 copy scrub · L1 "Back to Dashboard" · M10 AUTH‑A2‑DEBUG removal · gnoland1 gating · N3/N4/N5/N6 (cheap correctness). Everything else flows into Phases 1–5 + H as before. **H2 moves behind a new prerequisite: fix the propose fee/msg‑shape divergence + golden A3 round‑trip test (and resolve the multisig‑broadcast encoding) BEFORE any enforcement flip.**

### 10.6 Verified‑correct by the sweep (negative space)
v3 NFT custody (atomic CEI, panic‑revert); `agentTemplate` emits `vm/MsgCall` (regression‑tested); tailer hash fix has a **real**‑`/block`‑fixture test (`block_260001.json`); A3 reconstructs from authoritative DB fields (lockout‑safe by design); GitHub OAuth backend (one‑time CSRF state, token never returned to client, no open‑redirect); channel CreateChannel wired end‑to‑end + owner‑gate fails closed; IPFS upload proxy (auth, 2MB, MIME, sanitized name); CORS allowlist + CSP; graceful shutdown (WAL checkpoint); GHCR rollback mirror; frontend RPC fallback; CSV export formula‑injection guard; chain‑id signing guard.
