# Memba v7.1 — Rev2 Expert Panel Cross-Check (Audit Trail)

> **Date:** 2026-05-11
> **Subject of review:** `MEMBA_V7_1_IMPLEMENTATION_PLAN.md` (Rev1) + `MEMBA_V7_1_PR_TRIAGE.md`
> **Method:** 5 fresh sub-agent experts with **new lenses** (no overlap with Rev1 panel) — Release Manager/SRE, QA/Test Architect, Tech Lead/EM, Compliance/Risk, Adversarial Red Team.
> **Outcome:** Plan upgraded to **Rev2** with 14 new Critical Fixes folded in. Rev1 audit trail (`MEMBA_V7_1_EXPERT_REVIEW.md`) remains valid; this file records the deltas Rev1 → Rev2.

---

## 1. Headline findings

Five **plan-breaking** discoveries that Rev1 missed:

| # | Finding | Source | Impact |
|---|---------|--------|--------|
| **HB-1** | **Fly bluegreen is incompatible with this app.** `backend/fly.toml` has `[[mounts]]` (SQLite volume) AND `min_machines_running=1`. Fly docs are explicit: bluegreen does not work with attached volumes; single-machine apps force `rolling`. Rev1 §15.5 and R-03's `--strategy=bluegreen` recommendation is **wrong**. | Adversarial + SRE | Real rollback strategy doesn't exist. |
| **HB-2** | **`@clerk/clerk-react`'s npm `latest` dist-tag points to `5.61.3`** (stale, still in vulnerable range). `latest-v5` correctly points to `5.61.6`. Anyone running `npm install @clerk/clerk-react@latest` (dependabot's next attempt, junior dev re-pin) gets the vulnerable version. | Adversarial | Phase 0's "stay on 5.x latest patch" wording is dangerous. |
| **HB-3** | **AUTH-CHAINID-01 is HIGH/HIGH (R-13) but Rev1 ships it in Phase 1** — meaning a known cross-chain signature replay vulnerability sits exploitable in `main` for ~14 days. Inconsistent with treating it as "HIGH/HIGH". | SRE | Should ship in Phase 0 (or as `v6.0.2` hotfix Day 1). |
| **HB-4** | **CODEOWNERS secondary reviewer is paper-only.** Rev1 §1.8 says "add `@WaDadidou` or `@davd-gzl`" but **nobody has actually been asked**. `davd-gzl` is the PR #329 author (a one-line rename); `WaDadidou` appears only as a string in `gnoloveConstants.ts:57`. Phase 1.8 cannot complete with current state. | Tech Lead/EM | R-12 mitigation is theatre. |
| **HB-5** | **Phase 0 PR is too big to review honestly.** Folds 10 dep bumps + Go + Clerk + dompurify + 4 govulncheck pins + Sentry token + `\|\| true` removal + 2 Dockerfile pins + dependency-review-action + dependabot rewrite + DEPENDENCY_POLICY.md + `v6.0.1` tag — with `@zxxma` as both author and reviewer (AD-15). Reviewable diff exceeds practical attention span. | Tech Lead/EM | Split into Phase 0a (CI infra) + Phase 0b (frontend deps + dep policy). |

---

## 2. All Critical Fixes (must address before Phase 0 kickoff)

| # | Source | Critical fix | Rev2 placement |
|---|--------|--------------|-----------------|
| **CR2-01** | SRE + Adversarial | **Drop bluegreen entirely.** Fly bluegreen requires no volumes and ≥ 2 machines per region. Add `[deploy] strategy = "rolling"` to `fly.toml`; use rolling deploys for the lifetime of v7.1. Accept a ≤ 30 s downtime window per deploy. Document explicitly. | §15.5 rewritten; AD-17 new |
| **CR2-02** | SRE + Adversarial | **Snapshot every release image to GHCR after `flyctl deploy`** — Fly's release retention is undocumented; without a GHCR mirror, `flyctl releases rollback` may fail after 30+ days because the image is GC'd. | §16 new step; §15.5 |
| **CR2-03** | SRE | **Flip `cancel-in-progress: false` on `deploy-backend.yml` and `deploy-frontend.yml`.** Today's `true` cancels in-flight deploys mid-traffic-flip; correct semantics is **queue, not cancel**. | §4.2 row 0.9 expanded |
| **CR2-04** | SRE + Adversarial | **Add Fly volume snapshot policy:** `fly volumes update memba_data --snapshot-retention 5` + restore drill documented in §15. SQLite WAL gitignore is *not* a backup; a corrupted `/data/memba.db` has no restore path today. | §15.7 new; Phase 0 acceptance |
| **CR2-05** | SRE | **Move AUTH-CHAINID-01 to Phase 0** (or hotfix `v6.0.2` same Day 1 as `v6.0.1`). HIGH/HIGH risk should not sit in prod for 14 days. | §4 phase scope expanded; §13 R-13 reclassified |
| **CR2-06** | Adversarial | **AUTH-CHAINID-01 needs graceful token rotation.** New `chain_id` cache key invalidates pre-deploy tokens → forces every user to re-login at deploy time. Add a token-version field and a one-release grace period (accept old-format tokens for 24 h, then reject). Communicate via in-app banner. | §1.9 expanded |
| **CR2-07** | EM | **Split Phase 0 PR**: PR0a (CI infra: Go bump, workflow pins, Sentry token, Dockerfile pins, `\|\| true` removal, AUTH-CHAINID-01 hotfix, GHCR mirror) → green main → PR0b (frontend deps + overrides + DEPENDENCY_POLICY.md + dependabot rewrite + actions/dependency-review-action). Both ship same day; 0a tags `v6.0.2`, 0b tags `v6.0.3`. | §4 restructured; AD-01 split |
| **CR2-08** | Compliance | **Custody spec is a release blocker.** Phase 6.2 (channels v3 two-tier pause) references "emergency multisig EOA documented in MAINNET_PREPARATION.md" — **that section does not exist**. Phase 1 hard deliverable: write the Custody section (signers / threshold / storage / rotation / recovery / signer-incapacitation) BEFORE Phase 2 begins. | §5 new step 1.11; §6 gate |
| **CR2-09** | EM | **Secondary reviewer must be asked and confirmed in writing before Phase 0.** Add §19 Q16 with a hard "BLOCK Phase 1.8 until written confirmation." Without consent, R-12 mitigation does not exist. | §19 Q16; §13 R-12 retitled |
| **CR2-10** | EM | **Fund-key holder named before Phase 0**, not Day 21. ~60 GNOT funding required at Phase 5.1; identify the holder + backup contact now. | §19 Q17; §11 cross-repo |
| **CR2-11** | EM | **Pre-record comms artifacts in Phase 0/1**: `docs/comms/v7.1-channels-v3-cutover.md`, `docs/comms/v7.1-betanet-launch.md`, `docs/comms/v7.1-betanet-rollback.md`, `docs/comms/v7.1-token-rotation.md` (for CR2-06). Each reviewed once; ready to fire under stress. | §10 Phase 6 → Phase 0/1; §15.4 reference |
| **CR2-12** | Compliance | **AUTH-CHAINID-01 advisory + coordinated disclosure.** File as MEMBA-2026-001 in `docs/advisories/`; entry in `SECURITY.md` "Resolved Advisories"; notify Adena security contact (multichain auth surface). **Embargo PR0a's description for AUTH-CHAINID-01 until prod deploy + Adena ack.** | §1.9 process; SECURITY.md edit |
| **CR2-13** | Compliance | **Betanet go/no-go signed by ≥ 2 Samourai Coop principals** before Phase 5. File at `docs/reports/v7.1-betanet-gono.md` with the 30-day channels_v3 test12 evidence (AD-13). | §9 new step 5.−1; Phase 6 gate |
| **CR2-14** | QA | **Phase 3 E2E gates are aspirational** — `Vote E2E` and `Multisig E2E` don't exist as code (no Adena mock infrastructure). Either downgrade Rev1 §7.3 rows 3.3/3.4 to "**component test with mocked sign hook**" OR budget +4 days for Adena-mock fixture authoring as a new Phase 3.0. | §7.3 rewritten |

---

## 3. Should-Fix Improvements (folded into Rev2)

| # | Source | Improvement | Rev2 disposition |
|---|--------|-------------|-------------------|
| SR2-01 | SRE | Define minimal SLO for `memba.samourai.app`: error < 1% (5m), `/health` 200, login flow > 99%, deploy MTTR < 10 min | §14 new SLO subsection |
| SR2-02 | SRE | Change-freeze windows: 24 h around Phase 0 deploy, Phase 5 betanet activation, and v7.1.0 tag | §9 new step 9.0; §10 |
| SR2-03 | SRE | On-call rule: "no merges Fri 15:00 local through Mon 09:00 local" for risky phases | §18 note |
| SR2-04 | SRE | Rollback drill rehearsed pre-Phase-5 — Fly + Netlify rollback with measured MTTR | §15.7 new |
| SR2-05 | SRE | HSTS shipping in Phase 0 (one-line), not Phase 6 | §4.2 step 0.13 |
| SR2-06 | QA | Sanitizer test uses OWASP DOMPurify corpus (≥ 30 vectors at 3 call sites), one test per closed CVE | §4.3 / §17 |
| SR2-07 | QA | Negative-test strategy section explicit: network failure, sig rejection, chain mismatch, paused realm, throttled RPC | §17.3 new |
| SR2-08 | QA | MSW mock at gnoclient boundary for E2E; reserve live test12 for manual smoke | §17.4 new; R-19 added |
| SR2-09 | QA | Critical-path coverage manifest (per-file thresholds in `auth/*`, `service/multisig*`, `lib/sign*`) — not just numerical aggregate | §8.1 |
| SR2-10 | QA | Go fuzz target `FuzzMakeADR36SignDoc` after CR2-05 lands | §1.9 |
| SR2-11 | QA | Manual-vs-automated test boundary documented (Playwright ≠ Adena flow) | §17.5 new |
| SR2-12 | QA | `docs/SMOKE_CHECKLIST.md` doesn't exist — Phase 0 deliverable, not Phase 6 | §17.1 |
| SR2-13 | EM | Estimate-confidence column on every effort cell (high/med/low) | §18 |
| SR2-14 | EM | Knowledge-transfer log `docs/planning/V7_1_KT.md` updated end-of-day per phase | §18 note |
| SR2-15 | EM | Docs inventory `docs/planning/V7_1_DOCS_INVENTORY.md` enumerating all created/updated docs | §20.6 new |
| SR2-16 | EM | Post-release ops doc `docs/OPS_RUNBOOK.md` (weekly dependabot, monthly govulncheck, quarterly secret rotation) | §10 Phase 6 |
| SR2-17 | Compliance | GPG-signed tags for `v6.0.2`, `v6.0.3`, `v7.1.0` + fingerprints in SECURITY.md | §10 Phase 6 |
| SR2-18 | Compliance | ADRs pinned to commit SHAs after merge (introduced-at, superseded-by, status columns) | §12 |
| SR2-19 | Compliance | SECRETS_ROTATION.md expanded: FLY_API_TOKEN, NETLIFY_AUTH_TOKEN, SENTRY_AUTH_TOKEN, SLACK_WEBHOOK_URL, ED25519_SEED_V{N} versioning, admin multisig keys, GPG signing keys, Clerk publishable ↔ secret pairing, DB master | §10 Phase 6 → Phase 0/1 (deploy-path) |
| SR2-20 | Compliance | DISCLAIMER.md updated for Phase 5: betanet pre-mainnet caveat, channels v3 emergency pause notice, multisig custody acknowledgement, jurisdictional disclaimer | §10 Phase 6 |
| SR2-21 | Compliance | SECURITY.md adds: PGP fingerprint, "Resolved Advisories" table, GitHub Security Advisories enabled, embargo policy, coordinated-disclosure protocol with Adena+Gno | §10 Phase 6 → §1.9 deliverable |
| SR2-22 | Compliance | DEPENDENCY_POLICY.md enforceability: approval flow, SLA, responsibility matrix, escalation path, auto-merge rules | §4.2 step 0.6 |
| SR2-23 | Adversarial | Pause dependabot during v7.1 phases: `open-pull-requests-limit: 0` to prevent reopen-race during merge bus | §4.2 step 0.12 |
| SR2-24 | Adversarial | Domain renewal calendar (`samourai.app`, `samourai.live`) — confirm registrar autopay + 30-day buffer | §19 Q18; R-20 |
| SR2-25 | Adversarial | Sentry event-quota check before RQ instrumentation rollout (potential 10× event volume) | §16.2 |
| SR2-26 | Adversarial | npm `--ignore-scripts` on the Netlify build (defense-in-depth for supply chain attack) | §4.2 step 0.2c |
| SR2-27 | Adversarial | Verify samcrew-deployer branch against `samcrew-deployer:main` BEFORE Phase 1.1 PR open (+0.5 day for conflict resolution) | §5 step 1.1 effort revised |
| SR2-28 | SRE + Compliance | Two-tier pause emergency multisig: custody, rotation, audit-log (Sentry breadcrumb on every `Pause`), revocation. Hard prereq for Phase 2. | §6.2.1 new |
| SR2-29 | EM | Stop-work trigger: if Phase 3 ≤ 50% by Day 17, drop Phase 5 to test12-only; decision recorded in `docs/reports/v7.1-scope-decision.md` | §14 conditional |
| SR2-30 | QA + SRE | Adena 1.20 watch: AUTH-SESSION-REJECT-01 must deploy to prod BEFORE next Adena release | §5 step 1.9b; R-14 |

---

## 4. New Risks Added in Rev2

| ID | Risk | L | I | Detection | Mitigation |
|----|------|---|---|-----------|------------|
| **R-19** | Playwright E2E hits live test12; outage breaks CI | HIGH (test12 was down 48h+ in April) | LOW (CI only, not prod) | CI fail rate | MSW mock layer (SR2-08) |
| **R-20** | Domain renewal lapses for `samourai.app` / `samourai.live` during 32-day window | LOW | CRITICAL | Calendar reminder | Verify autopay + 30-day buffer (Q18) |
| **R-21** | Fly release image GC'd before rollback need | MED | HIGH | `flyctl releases list` shows missing image | GHCR mirror per release (CR2-02) |
| **R-22** | Adena 1.20+ ships before AUTH-SESSION-REJECT-01 deploys to prod | MED | MED | Watch Adena release notes | Ship in Phase 0 alongside CR2-05 |
| **R-23** | npm `latest` dist-tag for `@clerk/clerk-react` is **5.61.3** (stale, vulnerable) → dependabot or careless dev reverts | HIGH | HIGH | `npm dist-tag ls @clerk/clerk-react` | Explicit `^5.61.6` pin + `dependabot.yml` `ignore` rule + DEPENDENCY_POLICY.md note |
| **R-24** | Sentry release for `memba@v6.0.1` already finalized; cannot retro-attach source maps | MED | LOW | Sentry release view | New release names `v6.0.2`/`v6.0.3` for split Phase 0; verify each |
| **R-25** | samcrew-deployer 5 commits don't merge cleanly to its `main` | MED | MED | Pre-PR conflict check | +0.5d to Phase 1.1 effort (SR2-27) |
| **R-26** | Phase 0 PR triggers both `deploy-backend` + `deploy-frontend` simultaneously (parallel deploys) | LOW-MED | MED | Workflow run timeline | Split into 0a/0b ensures sequential deploy; merge 0a → wait for green → merge 0b |
| **R-27** | Dependabot reopens new PRs Day 2–3 with fresh-grouped config + new lockfile churn while Phase 1 is mid-flight | MED | LOW | GitHub PR view | Set `open-pull-requests-limit: 0` during v7.1 (SR2-23) |

---

## 5. Net Schedule Impact

Rev2 adds ~3 days of work and 1 deliverable buffer:

| Component | Rev1 | Rev2 | Δ |
|-----------|------|------|---|
| Phase 0 | 2 days | **2 days, split 0a + 0b** | 0 |
| Phase 1 | 4 days | **5 days** (AUTH-CHAINID-01 already in P0; +1d for custody spec + secondary-reviewer-fix + comms drafts + samcrew-deployer conflict buffer) | +1 |
| Phase 5 | 7 days | **7 days** + 1d for go/no-go file | +1 |
| PTO float | 0 | **5 days slack/PTO/hotfix reserve** | +5 |
| Total | 32 days | **~38 days** (32 working days + 5 float, 6 weeks) | +6 |

Schedule realism upgraded from "tight at 1 FTE" → "achievable at 1 FTE with explicit float."

---

## 6. Sign-off Status

| Lens | Disposition |
|------|-------------|
| Release / SRE | ✅ Rev2 incorporates 5 critical + 5 should-fix; bluegreen removed entirely |
| QA / Test Architect | ✅ Rev2 incorporates 5 critical + 7 should-fix; aspirational E2E gates downgraded |
| Tech Lead / EM | ✅ Rev2 incorporates 5 critical + 4 should-fix; PR split + reviewer-consent gate |
| Compliance / Risk | ✅ Rev2 incorporates 4 critical + 4 should-fix; custody is hard prereq for Phase 2 |
| Adversarial Red Team | ✅ Rev2 incorporates 4 critical + 4 should-fix; bluegreen removed, Clerk pinning explicit |

**Approval gate:** zooma reviews Rev2 plan + this audit trail + Rev1 audit trail → answers §19 Open Questions (now 18 items) → Phase 0a kicks off the next business day.

---

## 7. Verbatim Expert Findings (summarised)

> Full verbatim output of each expert is preserved in the parent session transcript. Highlights below.

### 7.1 Release Manager / SRE — Top Quotes

> *"Bluegreen is incompatible with current Fly config — §15.5 says rollback uses `--strategy=bluegreen --wait-timeout=300`, but bluegreen requires ≥ 2 machines. `min_machines_running=1` plus `auto_stop_machines='stop'` means there is exactly one warm machine. Bluegreen will either error or silently fall back to rolling."*

> *"AUTH-CHAINID-01 is HIGH/HIGH (R-13) but ships in Phase 1, not Phase 0 — a known cross-chain replay vulnerability sitting in `main` during the 4–6 day Phase 0/Phase 1 window is a freeze-worthy bug. Phase 5 betanet activation depends on the fix being field-proven, but it gets ~14 days of prod exposure first."*

> *"`BACKUP_INTERVAL='24h'` is an *application-level* env var, not Fly's volume snapshots. SQLite WAL is gitignored (good) but a corrupted `/data/memba.db` after a bad release has no documented restore path."*

### 7.2 QA / Test Architect — Top Quotes

> *"Phase 3 lies about E2E coverage. 'Vote E2E' / 'Multisig E2E' listed as gates in §7.3 rows 3.3 and 3.4 don't exist as code. Either (a) budget the work to author these (~2 days each, with Adena mocking infrastructure that doesn't exist), or (b) downgrade the gate to 'component test with mocked sign hook.'"*

> *"`docs/SMOKE_CHECKLIST.md` does not exist anywhere in the repo (`find` returns empty). Plan §17.1 references a doc that doesn't exist."*

> *"`backend/internal/auth/crypto_test.go` (196 LoC) covers challenge make/validate/expire/tamper/wrong-key/token sign-verify — but no `chain_id` field test, no replay-across-chain test."*

### 7.3 Tech Lead / EM — Top Quotes

> *"`@WaDadidou` and `@davd-gzl`. Neither appears anywhere else in the repo as a reviewer, code author of substance, or CONTRIBUTING-listed maintainer. `davd-gzl` shows up only as the author of PR #329 (a one-line rename). `WaDadidou` appears once, in `gnoloveConstants.ts:57` (a string literal). **No evidence anyone has actually been asked or has consented.**"*

> *"Bus-factor = 1 on every phase. §11 cross-repo table compounds the problem (zxxma also drives samcrew-deployer + gnodaokit merges). Two-week leave kills the plan."*

> *"Phase 0 PR scope is reviewer-impractical. It now bundles: 10 dep folds + Go bump + Clerk + dompurify + overrides + 4 govulncheck pins + Sentry token wiring + `\|\| true` removal + Dockerfile pin (×2) + dependency-review-action + dependabot rewrite + new policy doc + `v6.0.1` tag + 2 follow-up merges. Even with `@zxxma` as both author and reviewer, the diff exceeds practical review attention."*

### 7.4 Compliance / Risk — Top Quotes

> *"Custody specification is a release blocker. Plan §6.2 references 'the existing 2-of-3 multisig EOA documented in MAINNET_PREPARATION.md' — but that documentation does not exist."*

> *"AUTH-CHAINID-01 has no advisory artifact. Required: file as MEMBA-2026-001 in a new `docs/advisories/` directory + entry in `SECURITY.md` 'Resolved Advisories' table + email notification to Adena security contact (Adena multichain shares the auth surface)."*

> *"AUTH-CHAINID-01 is NOT yet public — the PR description for step 1.9 must be embargoed/redacted until v7.1.0 deploys to production on test12 AND coordinated with Adena."*

### 7.5 Adversarial Red Team — Top Quotes

> *"Fly bluegreen is unusable on this app — period. `backend/fly.toml` has `[[mounts]] source = 'memba_data'` (a SQLite volume) AND `min_machines_running = 1`. Fly docs are explicit: bluegreen cannot be used with apps that have attached volumes, and `max-per-region=1` also forces `rolling`. R-03 mitigation 'canary deploy via `--strategy=bluegreen`' and C-17's 'Fly deploy not rollback-safe — use `--strategy=bluegreen --wait-timeout=300`' are both wrong."*

> *"`@clerk/clerk-react`: `dist-tags.latest` points to 5.61.3 (not 5.61.6); `latest-v5` correctly points to 5.61.6. A naive `npm install @clerk/clerk-react@latest` would downgrade to a still-vulnerable version."*

> *"AUTH-CHAINID-01: confirmed real but plan's fix is incomplete. The fix scope as described (inject ChainID + add to token cache key) doesn't address: existing issued tokens that survive the deploy (cache-key change invalidates future lookups, but session cookies/JWTs already in flight will fail signature verification on next request and log every user out). No mention of token-version field or graceful rotation. Expect a Discord support spike Day 4."*

> *"PR #329 author 'davd-gzl' — does this user even still have GitHub access? No verification step. Squash-merging an external contributor's PR after a hostile branch rebase needs the author's confirmation; the plan assumes silent rebase-and-merge."*

---

> **End of Rev2 audit trail.** Rev2 of the implementation plan is now the authoritative document. Rev1 audit trail (`MEMBA_V7_1_EXPERT_REVIEW.md`) is preserved for the Rev0→Rev1 transition history.
