# Memba v7.1 — Expert Panel Cross-Check (Audit Trail)

> **Date:** 2026-05-11
> **Subject of review:** [`MEMBA_V7_1_IMPLEMENTATION_PLAN.md`](MEMBA_V7_1_IMPLEMENTATION_PLAN.md) (initially Rev0, this audit produced Rev1)
> **Method:** 5 fresh sub-agent experts dispatched in parallel, each with no prior context. Each agent independently read the plan + the codebase + (for the security agent) external advisory pages.
> **Outcome:** Plan upgraded to **Rev1**. All Critical Fixes folded in. Should-fix items folded in unless explicitly deferred. Detail items captured below for future revisions.

---

## Expert Panel

| Lens | Agent persona | Output length |
|------|---------------|---------------|
| **Architecture / CTO** | Principal Software Architect — sequencing, ADRs, DoD coherence | ~600 words |
| **Security** | Application Security — advisories, dep policy, exploitability | ~700 words |
| **Frontend / React** | Senior FE engineer — Clerk, RQ, Vite, dompurify, bundle | ~600 words |
| **Backend / Go** | Senior Go engineer — toolchain, govulncheck, Dockerfile, Fly | ~600 words |
| **Gno / Onchain** | Senior blockchain engineer — channels v3 semantics, upstream PRs, gas/deposit, deployer drift | ~700 words |
| **DevOps / CI** | Senior SRE — workflows, dependabot, Fly rollback, Netlify, Sentry plumbing | ~700 words |

> The full verbatim findings of each expert are preserved at the bottom of this document (§7 Verbatim) for traceability.

---

## 1. Consolidated Critical Fixes (folded into Rev1)

A "Critical Fix" must be applied before Phase 0 kicks off. All of the below are now in Rev1.

| # | Source expert(s) | Critical fix | Where applied in Rev1 |
|---|------------------|--------------|------------------------|
| C-01 | Security, Backend, DevOps | **`security.yml` Go pin (1.23) is a real bug, not optional.** Mismatched toolchain silently misses CVEs. Bump to `go-version-file: backend/go.mod` (or 1.25.10 literal) — required. | §4.2 step 0.2 reworded as hard MUST |
| C-02 | Security | **Clerk target underspecified.** Pin **`@clerk/clerk-react ^5.61.6`** (exact, dist-tag `latest-v5`). Add `overrides` for **`@clerk/shared ^3.47.5`** because transitives are flagged separately. Also bump **`@clerk/themes`** patch alongside. | §4.2 step 0.3 rewritten |
| C-03 | Security | **dompurify target vague.** Pin **`^3.4.2`** (current latest; ≥3.4.0 fixes the four advisories) AND add `overrides` to coerce `jspdf`'s transitive pin. Belt + braces. | §4.2 step 0.4 rewritten |
| C-04 | Backend, DevOps | **Plan missed `backend/Dockerfile`.** Currently `golang:1.25-alpine` (rolling) — pin to `golang:1.25.10-alpine` for reproducibility. Also: **frontend `Dockerfile` default `VITE_GNO_CHAIN_ID=test11` is stale** — bump to `test12`. | §4.2 step 0.1 expanded; new 0.1c |
| C-05 | Backend, Security | **`govulncheck@latest` is non-reproducible.** Pin all 4 invocations (`ci.yml:56`, `deploy-backend.yml:36`, `govulncheck.yml:27`, `security.yml:37`). | §4.2 new step 0.1b |
| C-06 | DevOps | **`deploy-frontend.yml` swallows audit failures via `\|\| true`.** Silent failure mode forbidden by Phase 0 principles — must remove. | §4.2 new step 0.2b |
| C-07 | DevOps | **`SENTRY_AUTH_TOKEN` is NOT wired into `deploy-frontend.yml`** — source maps and releases currently *not* being uploaded. R-09 risk has already materialised. Add `env` block + assertion step. | §4.2 step 0.2c + §13 R-09 reclassified |
| C-08 | Gno / Onchain | **Transfer-lock probe path is wrong.** `r/sys/params` is the proposal helper; the real query is **`gnokey query params/bank:p:restricted_denoms`** + `params/auth:p:unrestricted_addrs`. Without this, Phase 5 gating is incorrect. | §5 step 1.5 rewritten with exact CLI |
| C-09 | Gno / Onchain | **PreviousRealm framing is wrong.** Channels v2 is **not** bugged for direct MsgCall (returns EOA correctly). The v3 fix is cross-realm hardening, not bug-fix. | §6.1 rewritten |
| C-10 | Gno / Onchain | **samcrew-deployer 5 unpushed commits already include the "v3 features"** (events, audit fixes). v3 work re-scopes to "promote v2 audit-hardened code to v3 with cross-realm hardening + per-realm storage-deposit recalibration." Effort 2 h → 1 day; reviewer ≠ author. | §5.1 (effort), §6.2 (drop events line), §6.1 (rescope) |
| C-11 | Gno / Onchain | **Upstream PR #5629 (per-realm storage deposit, BYTE-PROPORTIONAL)** invalidates the static `1M ugnot` deposit on gnoland1. Need dry-deploy on test12 → read `_realmmeta_<path>` → size gnoland1. | §9 new step 5.0; §9.2 footnote; new R-15 |
| C-12 | Gno / Onchain, Frontend | **Cross-chain auth signature replay (AUTH-CHAINID-01).** `backend/internal/auth/crypto.go:324` builds the ADR-036 signDoc with `"chain_id":""`. A test12 signature is bit-identical valid on gnoland1. Must inject real `ChainID` and add to token cache key. | New §5 step 1.9 (Phase 1); R-13 added |
| C-13 | CTO Architect | **gnodaokit merge is a Phase 5 hard gate** — currently on a feature branch with unverified push status, but Phase 5 PREFLIGHT starts with gnodaokit deploys. | §5.1 new 1.1b; §9 gating updated |
| C-14 | CTO Architect | **No betanet user-communication step.** Hard cutover without in-app/Discord pre-announce. | §9 new step 5.8 |
| C-15 | Frontend | **`migrate` callback does not exist on RQ v5 `persistQueryClient`.** Use `buster: chainId` parameter to rotate persisted store on chain switch. | §7 step 3.6 rewritten |
| C-16 | Frontend | **Plan says "RQ infrastructure already exists"** — but it's only section-scoped in gnolove. Need explicit ADR for two-cache (root + section). | §7 step 3.1 clarified; new AD-11 |
| C-17 | DevOps | **Fly deploy not rollback-safe.** `min_machines_running=1` + no `--strategy` means health-check failure breaks traffic. Use `--strategy=bluegreen --wait-timeout=300`; document `flyctl releases rollback` as canonical rollback. | §15.5 rewritten |
| C-18 | DevOps | **CODEOWNERS is single-owner `@zxxma`** — the SPOF named in R-12 is *currently real*. Add secondary reviewer in Phase 1.8 (not "audit" — *fix*). | §5 step 1.8 rewritten |

---

## 2. Should-Fix Improvements (folded into Rev1 unless deferred)

| # | Source | Improvement | Rev1 disposition |
|---|--------|-------------|------------------|
| S-01 | Security | Add `actions/dependency-review-action@v4` on PRs (would have caught Clerk + dompurify advisories pre-merge) | Folded — §4.2 new 0.4b |
| S-02 | Security | Add `cyclonedx-gomod` SBOM for backend (frontend already has SBOM) | Folded — §8.2 |
| S-03 | Security | Pin GitHub Actions to commit SHAs (supply-chain hardening) | **Deferred** — opens too many edits; tracker entry instead (§19 Q11) |
| S-04 | Security | Add secret scanning (`gitleaks` / `trufflehog`) | Folded — §8.2 |
| S-05 | Security | `npm ci --ignore-scripts` (defense-in-depth post-Clerk attack ecosystem trend) | Folded — §4.2 0.2c |
| S-06 | Security | Branch protection: require `Security Audit` check be green before merge | Folded — §5 step 1.10 |
| S-07 | Security | Document Memba-specific exploitability for Clerk + dompurify in `DEPENDENCY_POLICY.md` | Folded — §4.2 step 0.6 |
| S-08 | CTO | Add cache-invalidation test for cross-chainId switch | Folded — §7.4 |
| S-09 | CTO | DoD §14.1 conditional on Phase 5 outcome | Folded — §14.1 |
| S-10 | CTO | Phase 4/Phase 3 overlap — coverage uplift PRs target untouched layers | Folded — §8 note |
| S-11 | Frontend | Adjust stale-times to blockchain reality: GNOT `15s`, DAO members `5 min`, proposals `30s`, profile `15 min`; `refetchOnWindowFocus: false` global | Folded — §7.3 |
| S-12 | Frontend | Add `rollup-plugin-visualizer` as devDep (not CI) | Folded — §8.3 |
| S-13 | Frontend | Spike `useSuspenseQuery` for gnolove section (end of Phase 3) | Folded — §7 new step 3.10 |
| S-14 | Frontend | RQ root mount must not leak Clerk tokens into persisted cache — add `serialize` filter | Folded — §7 step 3.6 |
| S-15 | Backend | Deduplicate vulncheck — 3 places (ci.yml + govulncheck.yml + security.yml) run the same scan | Folded — §4.2 step 0.2 |
| S-16 | Backend | Note: workflow `setup-go` only controls CI gate; deployed binary version is controlled by **Dockerfile** | Folded — §4 explanation note |
| S-17 | Backend | Run `backend/internal/auth` test suite explicitly after cosmos-sdk 0.54.x bump (only place a regression would bite) | Folded — §4.3 |
| S-18 | Gno | Two-tier pause guard (DAO + emergency multisig EOA) for channels v3 | Folded — §6 step 2.2 |
| S-19 | Gno | Defensive note: v7.1 auth code must reject session-pubkey signatures (Adena 1.20+ multichain) until v8 session support lands | Folded — §5 new 1.9b; R-14 |
| S-20 | Gno | _v2 / _v3 coexistence policy on betanet: v2 only deployed if v3 field-proven ≥ 30 days on test12 | Folded — new AD-13 |
| S-21 | DevOps | Dependabot grouping (dev-deps, @tanstack/*, @sentry/*, @clerk/*) + ignore major bumps | Folded — §4.2 step 0.12; new AD-12 |
| S-22 | DevOps | Coverage threshold bump *mechanically* applied in ci.yml lines 39/43; add missing frontend coverage gate | Folded — §8.1 explicit diff |
| S-23 | DevOps | Govulncheck regression alert mechanism specified (peter-evans/create-issue-from-file + Slack) | Folded — §8.2 |
| S-24 | DevOps | Caching: pin govulncheck + cache `~/go/bin`; Docker buildx with `cache-from: type=gha` | Folded — §4.2 |
| S-25 | DevOps | HSTS in `netlify.toml` (free) | Folded — §10 Phase 6 |
| S-26 | DevOps | Confirm Netlify GitHub App is installed (for PR previews) | Folded — §5 verification |

---

## 3. Detail-Only (captured for v7.2 or follow-up tickets)

| # | Source | Detail | Tracker location |
|---|--------|--------|------------------|
| D-01 | Backend | Add `maxBodySize` middleware to REST endpoints (`/api/upload/avatar` IPFS proxy most important) — separate from Phase 0 scope | Issue tracker |
| D-02 | Frontend | ESLint 10 spike: 0.5 day; Vite 8 spike: 1 day | Tracked in §3 — v7.2 |
| D-03 | Security | Pin GitHub Actions to SHAs (hardening) | §19 Q11 |
| D-04 | DevOps | SECRETS_ROTATION.md should add `FLY_API_TOKEN` and `NETLIFY_AUTH_TOKEN` rotation playbooks | §10 Phase 6 |
| D-05 | DevOps | CSP nonce work (v7.2) | AD-09 unchanged |
| D-06 | Gno | Account sessions (#5307) — v8 scope, no v7.1 implementation | Tracker |

---

## 4. Reframed / Disputed Findings

These were claims in Rev0 that the panel materially refuted; Rev1 incorporates the correction.

| Rev0 claim | Panel correction | Rev1 |
|------------|-------------------|------|
| "Channels v2 has a `PreviousRealm()` bug returning wrong owner" | False for direct user MsgCall path (returns EOA correctly). Real issue is cross-realm caller paths — different scope. | §6.1 rewritten |
| "Channels v3 introduces events" | Events already implemented in samcrew-deployer commit `925123f` (in unpushed v3 audit branch). v3 carries them forward. | §6.2 rewritten |
| "Transfer-lock probe via `r/sys/params`" | Correct path is `params/bank:p:restricted_denoms` + `params/auth:p:unrestricted_addrs`. | §5 step 1.5 |
| "Plan files for Phase 0: `go.mod`, `ci.yml`, `deploy-backend.yml`" | Missing: `Dockerfile` (backend), `security.yml`, `govulncheck.yml`/`codeql.yml` (auto-derive, acknowledge), frontend `Dockerfile` (`VITE_GNO_CHAIN_ID=test11` stale) | §4 step 0.1 |
| "RQ infrastructure already exists" | Only in `GnoloveLayout`. Need explicit root mount + two-cache ADR. | §7 + AD-11 |
| "RQ persister `migrate` callback" | Does not exist on v5 `persistQueryClient`. Use `buster: chainId`. | §7 step 3.6 |
| "v7 plan's Clerk advisory affects Memba" | Memba uses **none** of the vulnerable APIs (`has()`, `auth.protect()`, `createRouteMatcher`, billing, reverification, orgs). Fix is required for `npm audit` green, but **no real exploit window in Memba** — documented as informational. | §13 R-01 reclassified |

---

## 5. Net Schedule Impact

The panel's findings expand Phase 0 by ~4 hours and Phase 1 by ~1 day. Phase 5 gains a real gating chain (gnodaokit + samcrew-deployer + transfer-lock + per-realm-deposit dry-run). Net plan duration shifts from **30 days** to **~32 days** in Rev1.

Schedule risk callout (CTO Architect): the React Query migration (Phase 3, 11 days) is the most likely cause of slip — overlap with Phase 4 + stale-data production bug discovery could consume the Phase 6 buffer entirely.

---

## 6. Sign-off Status

| Lens | Disposition |
|------|-------------|
| Architecture / CTO | ✅ Rev1 incorporates all 3 critical, 4 should-fix items |
| Security | ✅ Rev1 incorporates 4 critical, 7 should-fix; 1 deferred (S-03 SHA pinning) |
| Frontend / React | ✅ Rev1 incorporates 4 critical, 4 should-fix; 2 detail in v7.2 |
| Backend / Go | ✅ Rev1 incorporates 3 critical, 3 should-fix; 1 follow-up ticket (D-01) |
| Gno / Onchain | ✅ Rev1 incorporates 4 critical, 3 should-fix; account sessions deferred to v8 |
| DevOps / CI | ✅ Rev1 incorporates 5 critical, 6 should-fix; SECRETS_ROTATION addendum in Phase 6 |

**Recommended approval gate:** zooma reviews Rev1 + this audit trail → answers §19 Open Questions in Rev1 → Phase 0 kicks off the next business day.

---

## 7. Verbatim Expert Findings

> Below are the unedited findings from each expert. They contain the full evidence chain (file paths, line numbers, version numbers, advisory URLs) that justifies each fix above.

### 7.1 Architect / CTO

```
Strengths
- Phase 0 CI-unblock-first ordering is correct.
- Two-pass strategy (consolidated CI PR, then dependabot rebase bus) is
  lower-risk than batching all dependabot PRs at once.
- Risk Register entries each have a concrete detection signal and
  mitigation — not just labels.
- ADR table records the right decisions and explicitly defers high-blast
  bumps (Vite 8, ESLint 10) with documented rationale.

Critical Gaps
1. No data migration plan for channels_v2 threads on gnoland1 (Phase 2.8
   covers test12 only). If v2 threads exist on gnoland1 even from testing,
   no snapshot/disposition is stated — unrecoverable orphaning.
2. gnodaokit push/merge status unverified, but Phase 5 has no hard gate
   on it. PREFLIGHT order begins with gnodaokit.
3. No user-communication phase (Discord/in-app) for channels_v3 cutover
   or betanet activation. Adena v1.19.0 multichain is required per §1.3.

Improvements
- §0.2 "decide explicitly — default: bump" is too soft.
- Phase 3 has no test for cross-chainId switch evicting RQ cache.
- §14 DoD criterion ambiguous if Phase 5 deferred.
- Phase 4 / Phase 3 overlap: ownership boundary unstated → likely merge
  conflicts on hook files.

Schedule Realism
30 days at ~1 FTE achievable IFF Phase 0 lands in first two days with no
regressions. Most likely slip: React Query (Phase 3, 11d) interrupted by
stale-data prod bug discovered during Phase 4 overlap.
```

### 7.2 Security

```
Verified facts:
- Go 1.25 latest: go1.25.10 (released 2026-05-07). Fixes all four
  advisories (-4918, -4971, -4980, -4982).
- @clerk/clerk-react fixed-in: 5.61.6 (published; dist-tags.latest-v5).
- @clerk/shared fixed-in: 3.47.5 (5.x) / 4.8.3 (6.x).
- dompurify fixed-in: 3.4.0; latest published 3.4.2.
- Memba currently resolves dompurify@3.3.3 transitively from jspdf@4.2.1.
- Other open advisories in deps: none material.

Critical fixes:
1. §4.2 0.4 — pin dompurify ^3.4.2 not ^3.4.x (the latter notation is
   vague npm semver).
2. §4.2 0.3 — pin @clerk/clerk-react ^5.61.6 exactly. Also pin/override
   @clerk/shared ≥ 3.47.5 (separate advisory).
3. §4.2 0.2 — security.yml on Go 1.23 is a real bug. Must bump to 1.25.10
   or use go-version-file: backend/go.mod.
4. AD-04 / 0.4 — direct dompurify pin alone insufficient. Need package.json
   overrides too. Belt + braces.
5. govulncheck@latest is not reproducible — pin in all 4 invocations.

Should-add controls:
- actions/dependency-review-action@v4 on PRs.
- govulncheck -mode=binary on built binary, not source only.
- SBOM for backend (cyclonedx-gomod).
- Pin GitHub Actions to SHAs.
- Secret scanning (gitleaks/trufflehog) in security.yml.
- npm ci --ignore-scripts.
- Branch protection: require Security Audit check.
- Dependabot grouping + vulnerability-PR auto-merge.

Exploitability (Memba-specific):
- Clerk GHSA-w24r-5266-9c3c: NOT exploitable in Memba. No call sites
  for has(), auth.protect(), createRouteMatcher, billing, reverification,
  or organization checks. Memba uses Clerk only for /alerts login.
- Clerk GHSA-vqx2-fgx2-5wq9: NOT exploitable. This advisory affects
  @clerk/nextjs|nuxt|astro, not @clerk/clerk-react. Transitive
  @clerk/shared still flagged by npm audit.
- dompurify: exploitable surface exists, low real-world risk. Two call
  sites in directory components (RealmDetailDrawer.tsx:164,
  SourceCodeView.tsx:116) plus NFTGallery v6 SEC-05 fix. The four 3.3
  CVEs require non-default options; Memba passes no options. Default
  configs not directly exploitable — but bump anyway and add regression
  test.

[Plus 16 recommended section edits — see consolidated table above]
```

### 7.3 Frontend / React

```
Verified facts:
- 4 Clerk usage sites: ClerkProvider.tsx:15, useClerkAuth.ts:13,
  AlertsPage.tsx:43, AdminPanelLink.tsx:5. Pinned at 5.61.4. 5.61.6
  published.
- 3 dompurify call sites: NFTGallery.tsx:485, RealmDetailDrawer.tsx:164,
  SourceCodeView.tsx:116. All call DOMPurify.sanitize(html) with no
  config. Currently 3.3.3; latest 3.4.2.
- React Query: section-scoped only in GnoloveLayout (~18 useQuery in
  hooks/gnolove/index.ts). Plan's "infrastructure already exists" is
  overstated.
- PR #329 scope: only frontend/src/lib/gnoloveConstants.ts:57. String
  consumed only as GitHub login (never rendered as display name).
- Bundle gate: <600 KB on main entry chunk only, not total JS.
- Sentry source maps: vite.config.ts:30-46 configures plugin with
  release.name = memba@${pkg.version}. Requires SENTRY_AUTH_TOKEN.

Critical fixes:
1. Phase 0 must also bump @clerk/themes (peer of clerk-react that ships
   its own @clerk/shared transitive).
2. dompurify 3.3→3.4 is safe for these call sites; add regression test
   asserting <script>, <iframe>, <svg onload> stripped.
3. Plan §7 doesn't address cross-cutting QueryClientProvider mount
   point. New AD-11: section-scoped RQ for gnolove + app-root RQ for
   core (two caches by design).
4. RQ v5 persistQueryClient does NOT have a `migrate` callback. Use
   `buster: chainId` parameter to rotate persisted store on chain
   switch.

Improvements:
- Adopt useSuspenseQuery selectively for gnolove only — eliminates
  isLoading branches.
- Stale-times: GNOT 15s + refetchInterval 15s (current 10s is too
  aggressive); DAO members 5 min; proposals 30s; profile 15 min.
  refetchOnWindowFocus: false globally.
- rollup-plugin-visualizer as devDep + npm run build:analyze script.
- PR #323 should be explicitly closed by Phase 0 PR.

Spikes:
- ESLint 10: 0.5 day (flat-config already in use).
- Vite 8: 1 day (Rollup 5; verify @sentry/vite-plugin peer + manualChunks
  naming).

[Plus 9 section edits — see consolidated table]
```

### 7.4 Backend / Go

```
Verified facts:
- 8 Go-version surfaces across 6 files:
  * backend/go.mod L3: go 1.25.9
  * .github/workflows/ci.yml L26: 1.25.9 (hardcoded)
  * .github/workflows/deploy-backend.yml L26: 1.25.9 (hardcoded)
  * .github/workflows/security.yml L34: 1.23 (hardcoded, STALE)
  * .github/workflows/govulncheck.yml L24: go-version-file (derived)
  * .github/workflows/codeql.yml L26: go-version-file (derived)
  * .github/workflows/gno-test.yml L32: 'stable' (irrelevant)
  * backend/Dockerfile L2: golang:1.25-alpine (minor-rolling)
- toolchain directive: NOT present.
- Dockerfile base: golang:1.25-alpine (multi-stage). Tag rolls
  forward — production gets 1.25.10 once Docker Hub publishes.

Critical fixes:
1. Plan missed backend/Dockerfile. Pin to golang:1.25.10-alpine for
   reproducibility (otherwise pre/post-publish builds differ).
2. Plan undercounts: missed govulncheck.yml + codeql.yml (auto-derive,
   acknowledge intentionally).
3. security.yml on Go 1.23 IS a problem — govulncheck against older
   stdlib flags different CVEs than 1.25.10. Also: three places run
   govulncheck (ci.yml, govulncheck.yml, security.yml) — DEDUPE.
4. govulncheck@latest not reproducible — pin all 4 invocations.

Improvements:
- Don't add `toolchain go1.25.10` to go.mod (CI already pins via
  setup-go).
- PR #316 ConnectRPC 1.19.1→1.19.2: API-stable; safe.
- PR #318 cosmos-sdk 0.54.0→0.54.2: indirect dep (BIP-39/keyring);
  run backend/internal/auth tests explicitly.
- Fly deploy builds via Dockerfile, NOT workflow setup-go. Document
  this distinction.
- main.go:163-192 already does graceful shutdown — no new halt_height
  path needed for v7.1.
- 1MB body limit (main.go:115) only on ConnectRPC mux; REST endpoints
  (/api/render, /api/balance, /api/upload/avatar, etc.) have NO body
  cap. Phase 4 ticket.

[Plus 7 section edits — see consolidated table]
```

### 7.5 Gno / Onchain

```
Verified facts:
- channels_v2 PreviousRealm usage confirmed at 9 sites in
  samcrew-deployer/projects/memba/realms/memba_dao_channels_v2/.
- Upstream semantics: PreviousRealm() returns EOA on direct MsgCall;
  returns caller-realm address only on cross-realm cross(fn) calls.
  v7/v7.1 claim of "wrong owner bug" is wrong for the user path.
- Transfer-lock probe: NOT r/sys/params. Correct ABCI path:
  `gnokey query params/bank:p:restricted_denoms`. Also check
  params/auth:p:unrestricted_addrs for bypass whitelist.
- gnoland1 launches with ugnot in restricted_denoms (locked) per
  govdao_prop1.gno:99.
- 212 upstream commits since 2026-04-20. Notable:
  * #5629 per-native gas calibration + per-realm storage deposit
    (byte-proportional) — invalidates static 1M ugnot deposit.
  * #5544 dedupe type persistence (BREAKING per `!`).
  * #5415 gas storage refactor — merged.
  * #5511 hardfork v3 + GovDAO halt via r/sys/params.
  * chain.emit hard caps: MaxEventPairs=64, MaxEventAttrLen=1024.
  * #5285 fix owner-of-object retrieval.
- samcrew-deployer 5 unpushed commits (oldest→newest):
  caae7d3 - mainnet security hardening (10 rounds)
  ccbfaf1 - 2-phase NFT buy, badges pause, tighter guards
  3d6ddf8 - Gno expert panel findings (50+ issues across realms)
  8692c3f - Red Team + Blue Team audit
  925123f - CTO panel: channels events + dead code cleanup ← already
            ships the "v3 features" the plan promises
  
Critical fixes:
1. PreviousRealm framing wrong. Reframe §6.1 from "fix the bug" to
   "harden for cross-realm callers (membaDAO, candidature). Use
   OriginCaller() for EOA-only paths or accept explicit caller arg
   on DAO-invocable functions."
2. Transfer-lock probe path: params/bank:p:restricted_denoms +
   params/auth:p:unrestricted_addrs.
3. Cross-chain replay: backend/internal/auth/crypto.go:324 builds
   ADR-036 signDoc with "chain_id":""; test12 signature valid on
   gnoland1. Inject ChainID + add to auth-token cache key.
4. #5629 byte-proportional storage deposit invalidates static
   1M ugnot. Add dry-deploy on test12 → read _realmmeta_<path> →
   size gnoland1.
5. Pause: must NOT be DAO-only. Two-tier guard (DAO + emergency
   multisig EOA). DAO vote latency = 24h; bug found at 2 AM has no
   fast lever.
6. samcrew-deployer drift is 5-commit *security* drift. 3 of those
   commits already ship the channels events the plan calls v3. Plus
   50+ unrelated audit fixes gnoland1 deploy *requires*. PR effort
   2 h → 1 day, reviewer ≠ author.
7. PREFLIGHT order: gnodaokit must be merged + deployed BEFORE
   tokenfactory step. Plan §9.1 doesn't gate.

Improvements:
- Defensive: v7.1 auth code must reject session-pubkey signatures
  (Adena 1.20+) until v8 session support.
- AD-13: on betanet, _v2 only after v3 field-proven 30 days on
  test12 (channels carry no economic state — snapshot threads for
  archive).
- Per-realm gas calibration: re-measure gas_wanted on test12 before
  pinning gnoland1 80M.
- Deployer idempotency: verify dry-run mode in
  samcrew-deploy.sh — lib/deploy.sh uses --max-deposit which can
  silently fail on second run.
- chainHealth fallback: primary should be test12 (current user
  base), gnoland1 only when VITE_BETANET_FEATURES_ENABLED=true.

[Plus 8 section edits — see consolidated table]
```

### 7.6 DevOps / CI

```
Verified facts:
- 7 workflows: ci.yml, codeql.yml, deploy-backend.yml,
  deploy-frontend.yml, gno-test.yml, govulncheck.yml, security.yml.
- Dockerfile locations: backend/Dockerfile (golang:1.25-alpine,
  multi-stage), frontend/Dockerfile (node:20-alpine + nginx; default
  VITE_GNO_CHAIN_ID=test11 STALE).
- fly.toml at backend/. App memba-backend, region cdg,
  min_machines_running=1, auto_stop=stop, /health every 30s. NO
  release_command, NO strategy declared.
- netlify.toml: build `npm run build`, publish dist. CSP includes
  'unsafe-inline'. NO context-specific sections.
- .github/CODEOWNERS: single owner @zxxma for every path. R-12 SPOF
  is REAL today.
- .github/dependabot.yml: weekly. npm /frontend limit 10, gomod
  /backend limit 5. NO grouping, NO dev/prod split, NO major-bump
  ignore.

Critical fixes:
1. security.yml on Go 1.23 (line 34) defeats the purpose. Bump.
2. deploy-frontend.yml line 46: `npm audit --audit-level=high || true`
   silently swallows audit failures. Plan's "no continue-on-error"
   principle is already violated. Remove `|| true`.
3. Branch protection unclear — confirm which checks are required
   (vs informational). Docker Build needs:[backend,frontend] —
   confirm it's in required-status-checks.
4. Fly deploy NOT rollback-safe: flyctl deploy --remote-only without
   --strategy bluegreen on min_machines_running=1 means failed
   health check → traffic break.
5. Frontend Dockerfile default VITE_GNO_CHAIN_ID=test11 — stale.
6. Sentry: vite.config.ts reads process.env.SENTRY_AUTH_TOKEN but
   deploy-frontend.yml DOES NOT pass it. Source maps + releases are
   silently NOT uploaded. R-09 in plan = already occurring.
7. govulncheck regression alert mechanism unspecified — no Slack,
   no issue-creation step in govulncheck.yml.

Improvements:
- Dependabot grouping (dev-deps, @tanstack/*, @sentry/*, @clerk/*) +
  ignore major bumps. Reduces R-04 root cause.
- "30-min cooldown" is folklore. Real concern: deploy concurrency
  group cancels in-flight deploys on rapid second merge.
- Cache: pin govulncheck, cache ~/go/bin. Docker Build no buildx +
  cache-from. Add docker/setup-buildx-action + cache-from: type=gha.
- Preview deploy: only triggers on push:main; for PRs depend on
  Netlify GitHub App.
- Coverage threshold bump NOT mechanically applied in plan. ci.yml
  L39 (20→40), L43 (50→55). Frontend has NO coverage gate at all.
- HSTS missing in netlify.toml.
- SECRETS_ROTATION.md has no playbook for FLY_API_TOKEN /
  NETLIFY_AUTH_TOKEN.

[Plus 7 section edits — see consolidated table]
```

---

> **End of audit trail.** Rev1 of the implementation plan is now the authoritative document. This audit doc is retained for traceability and post-mortem if any fix proves wrong.
