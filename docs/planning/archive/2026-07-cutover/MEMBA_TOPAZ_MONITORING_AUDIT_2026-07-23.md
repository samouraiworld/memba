# Memba — Topaz monitoring-key regression + priority audit (2026-07-23)

> Local doc — not for git/GitHub (same convention as the other session docs in this folder).
> Scope: this session covered git-pull + activity sweep across all `Gno/*` repos, a live
> re-verification of the "Memba doesn't display chain info/monikers" report, and a re-rank of
> what's actually open. Every item below is evidence-backed (file:line, live curl, or a
> production screenshot) — nothing here is copied from a prior planning doc without re-checking.

---

## 0. TL;DR

**Confirmed and reproduced live:** gnomonitoring's registered key for the Topaz chain flipped
**back** from `"topaz"` to `"topaz-1"` sometime after PR #988 (2026-07-22) shipped the opposite
workaround. Memba's frontend still sends `"topaz"`, so every gnomonitoring-sourced field for
Topaz validators — moniker, uptime, participation, first-seen, incidents, missed blocks,
operation time, tx contribution — is broken in production right now. Screenshot evidence below.

**Fix is small, well-understood, and mirrors a PR the team already shipped once (#988):** flip
one config field in `frontend/src/lib/config.ts`, refresh two stale comments and a test-file
comment, add a changelog entry. Recommend also closing the *systemic* gap this is the second
instance of — Memba has no alert when gnomonitoring rejects its chain param, so this class of
break is only ever caught by a human noticing blank names in the UI.

**Also corrected two stale facts from prior session docs** (§3) — both `QUEST_ADMIN_ADDRESSES`
and `FEED_MODERATION_BEARER` are confirmed **set** in prod (`fly secrets list`), and the ICO
announcement is confirmed **live** on production (screenshot), closing three items the 07-22
handoff had marked open/to-ask-the-owner.

---

## 1. P0 — Topaz gnomonitoring key regression (ready to build now)

**What broke:** `frontend/src/lib/config.ts:152-171` sets `monitoringChain: "topaz"` for the
Topaz network — the fix PR #988 shipped on 2026-07-22 to work around gnomonitoring rejecting
`chain=topaz-1`. That workaround is now backwards.

**Evidence — live API, checked this session:**
```
GET https://monitoring.gnolove.world/Participation?period=current_month&chain=topaz
  -> "invalid chain ID: \"topaz\""
GET https://monitoring.gnolove.world/Participation?period=current_month&chain=topaz-1
  -> [{"addr":"g1a0h6w0…","moniker":"samourai-crew-1","participationRate":100}, …]
```
This is the exact inverse of the two calls documented in PR #988's own commit message and in
`CHANGELOG.md`'s `[Unreleased]` entry for `#988` — gnomonitoring's registration was changed
again after that PR merged (visible only as a live-behavior flip; the change lives in
gnomonitoring's runtime `config.yaml` / admin-API chain registry on the VPS, not in its git
history — nothing in `gnomonitoring`'s repo, which this session pulled clean, mentions the
rename, so it was almost certainly an out-of-band `/admin/chains` edit).

**Evidence — production screenshot (memba.samourai.app/topaz/validators, this session):**
the chain badge correctly reads `topaz-1`, block height/voting-power/network-health all
populate (those come from direct RPC, unaffected) — but every validator row shows a raw address
(`g1pr03x28ujl93gayrdlrshh34cnmyq3aasaxtm6`) with `unknown` underneath instead of a name
(`berty-val-01`, per the live API above). The **Network** tab (P2P roster via `/net_info`,
not gnomonitoring) shows real node names correctly — confirming the break is scoped exactly to
the gnomonitoring-sourced fields, matching PR #988's own note that "the peer/telemetry path is
fine."

**Impact:** every gnomonitoring-backed surface on Topaz is degraded (gracefully — addresses
instead of crashes — but degraded): `/topaz/validators`, `/topaz/validators/hacker`, validator
profile pages, `HackerStatusBar`, `DoctorPanel`. Topaz is inside its ceremony-live window
(21 realms, real GNOT), so this is user-visible on the network the team is actively steering
people toward, not on a quiet testnet.

**Fix (single PR, same shape as #988):**
1. `frontend/src/lib/config.ts`
   - Remove (or flip) the `monitoringChain: "topaz"` line at line 157 for the `topaz` entry —
     with it gone, `GNO_MONITORING_CHAIN` falls back to `chainId` (`"topaz-1"`), which now
     matches gnomonitoring's registration.
   - Rewrite the doc-comment at lines 77–88 (`NetworkConfig.monitoringChain`) — it currently
     narrates the old direction (`topaz-1` rejected, `topaz` accepted) as settled fact; it needs
     to say this key is **known to have flipped once already** and is not a stable assumption.
   - Rewrite the inline comment at lines 154–156 to match (or delete it if the override is
     removed entirely).
2. `frontend/src/lib/gnomonitoring.test.ts` — lines 16–19's comment narrates the same now-stale
   direction using topaz as the motivating example. The test itself uses synthetic mock values
   (`"test-chain-42"` vs `"monitoring-key-99"`) so the assertion logic is unaffected — only the
   comment needs correcting so the next engineer doesn't re-trust it against live behavior.
3. `CHANGELOG.md` — new `[Unreleased]` entry, same section style as the `#988` one, noting the
   registration flipped back and Memba now matches it directly (no override needed).
4. **Verify before merge:** re-run the two curls above against
   `https://monitoring.gnolove.world` immediately before merging (not just trust this doc) —
   if gnomonitoring flips a third time between now and the PR landing, shipping this blind would
   just re-break it the other way.

**Effort:** ~30–45 min including the revert-matrix check (remove the fix, confirm the existing
`gnomonitoring.test.ts` assertion still can't catch it because it's synthetic-value based —
worth deciding whether to add one topaz-specific integration-shaped test here, see below).

**Owner call needed?** No — this is a pure bug fix restoring intended behavior, no product
decision. Should go through the normal branch+PR+CI-green+merge flow without a stop for
confirmation, per the standing merge-gate policy.

**Recommended follow-up in the same PR (small, worth bundling): close the systemic gap.**
This is the **second time** this exact chain-key mismatch has silently broken Topaz monikers —
first `topaz-1`→`topaz` (caught, fixed in #988), now `topaz`→`topaz-1` (caught this session, by
the user noticing in the product, not by any alert). Every gnomonitoring fetch fails silently
into `catch { return null }` (`gnomonitoring.ts:164`) — correct for graceful degradation, wrong
for observability: nothing logs, pages, or alerts when gnomonitoring starts rejecting Memba's
configured key. Options, cheapest first:
- Add a `console.warn`/Sentry breadcrumb in `monitoringFetch` when `res.ok` is false and the
  body looks like `"invalid chain ID"` — turns a silent addr-fallback into a visible signal in
  whatever error tracking Memba already has wired (Sentry is already a dependency — `#980`
  dependabot PR bumping `@sentry/react` is literally open right now).
- A tiny scheduled check (could live in `samcrew-deployer`'s existing CI cron patterns, or a
  5-line GitHub Action) that curls `chain=<configured value>` for every network with a
  `monitoringChain` override and fails loudly if the response isn't 200 — catches the drift
  before a human does.
This is a suggestion, not a blocker for the P0 fix — flagging because the second occurrence in
~24h is a pattern, not a coincidence, and the fix-the-symptom-only path just sets up a third.

---

## 2. Corrections to carry into every future session doc (re-verified live, this session)

The 2026-07-22 handoff (`HANDOFF_memba_next_2026_07_22.md`) and the governing roadmap
(`MEMBA_ROADMAP_COMPOUND_2026-07.md`) both still list these as open/owner-blocked. Direct
verification this session shows two are done and one is resolved:

| Item | Doc says | Verified now | Evidence |
|---|---|---|---|
| `QUEST_ADMIN_ADDRESSES` | "still unset" (handoff §Owner-blocked #4) | **SET** | `fly secrets list -a memba-backend` shows it deployed |
| `FEED_MODERATION_BEARER` | "UNSET in prod" (handoff #5, roadmap) | **SET** | same `fly secrets list` output |
| ICO sale / `VITE_ENABLE_ICO_ANNOUNCEMENT` | "ask the owner whether it was flipped" | **Live** | production screenshot: "The GNOT public sale is coming / Now open — visit the sale" modal, linking to `sale.gno.land` |

None of these need owner action anymore — they're closed. Worth a one-line edit to the handoff
file (or just superseding it with this doc) so the next session doesn't re-surface them as open.

`MEMBA_STATUS_OVERVIEW_2026-07-20.md`'s framing ("Next work session = the WS-E ceremony") was
already correctly flagged as stale by the 07-22 handoff — re-confirmed stale, no new information
here; superseded by this doc + the handoff for anything dated after 07-21.

---

## 3. Cross-repo activity swept this session (`git pull` across all of `Gno/*`)

| Repo | Result | Relevance to Memba |
|---|---|---|
| Memba | already up to date (`034ae5b6`, matches the 07-22 handoff exactly) | — |
| samcrew-deployer | already up to date (`7ecac21`, matches handoff) | — |
| gnodaokit | already up to date (`0eb8518` on `feat/topaz-v2-rename`, matches handoff) | — |
| katana | **46 commits pulled** (was 46 behind, per the handoff's own warning) | See below |
| gnomonitoring | 2 commits pulled (daily-report window-label fix; new per-chain backup script) | Neither touches the topaz-1/topaz key — that change is runtime-only, not in git |
| gno (core) | fast-forwarded on tracked branches; `chain/topaz` dev branch advanced (`fc405265`→`3b80a5424`) upstream | Informational — this is the branch topaz's own nodes build from; both configured RPCs already report the new build, no action needed |
| gno-skills | 1 commit (VERIFIED.md wording fix) | none |
| gno-agent-workspace, gno-docs | diverged (ahead+behind on `main`), not fast-forwarded | Not Memba-relevant, left alone rather than force-merging someone's in-progress divergence |
| everything else (adena-wallet, gnolove, gno-onboarding-bot, multisigs, peerdev, zkgno, …) | already up to date | none |

**katana's 46 commits are a real feature landing, not noise:** it replaced its old
`conditions.*` config model with a "score-driven" eject/lower_vp/raise_vp action model (dual-cap
VP step, configurable priority), added colored per-action Discord/Slack/Telegram notifications,
and — notably — added its own `internal/gnomonitoring/client_test.go` and
`stub-gnomonitoring` e2e scenarios. **Worth a 10-minute check (not done this session, out of
scope for "Memba"):** does katana's gnomonitoring client hardcode a chain key anywhere the same
way Memba's did? If it polls `monitoring.gnolove.world` for validator health to drive
eject/lower_vp decisions, the same `topaz`/`topaz-1` flip could silently affect *its* decisions
too, which is a materially different risk (ejecting validators on bad data vs. showing a wrong
name). Flagging for a follow-up, not claiming it's broken — I did not find a hardcoded `"topaz"`
string in katana's source this session, so it may already resolve the key correctly (or may not
target Topaz at all yet — worth a quick look, not a stop-the-session item).

No new PRs from humans anywhere in this sweep. Memba has 5 open dependabot PRs (`#977`–`#980`,
`#987`) — same low-risk dependency-bump shape as before, no action needed beyond the normal
dependabot cadence. `gnodaokit#65` and `#25` remain open and owner-gated, unchanged.

---

## 4. Everything else from the priority-audit backlog — re-ranked, not re-litigated

Per the 07-22 handoff's own instruction to audit before picking up any of these — status only,
no new work started:

1. **Fund a key on topaz-1** (owner-blocked, blocks every `REALM=` deploy) — unchanged, still
   the top blocker for any deploy work. Not re-verified on-chain this session (out of scope —
   this session's "Important" flag was specifically the monitoring/moniker regression); re-check
   the multisig sequence before touching any deploy tooling.
2. **NF-2 solvency getters for `escrow_v3`** — unchanged, last window before it's permanently
   foreclosed like `candidature_v3`/`agent_registry_v2`.
3. **WAVE1_AUDIT fund-risk findings** (OTC decimals, `escrow_v3` off the fee spine, wrong
   OTC spender) — highest-severity backlog item, not re-verified this session; still the
   next candidate for a real build session once §1 above ships.
4. **Feed v2 Waves C–F**, **BARRICADE 3D** (post-mainnet by prior decision), **marketplace
   pilot shape** (explicitly not to be scaled to other features yet) — unchanged, no new
   information this session.

---

## 5. Suggested order for the next session

1. Branch + PR for §1 (the monitoring-key fix) — small, evidence-backed, no owner call needed,
   ships in under an hour including tests and the revert-matrix check.
2. Decide whether to bundle the observability follow-up (Sentry breadcrumb on gnomonitoring
   rejection) into the same PR or split it — recommend bundling, it's ~5 lines and directly
   related.
3. One-line correction pass on `HANDOFF_memba_next_2026_07_22.md` (or let this doc supersede it)
   so `QUEST_ADMIN_ADDRESSES` / `FEED_MODERATION_BEARER` / ICO stop being re-flagged as open.
4. Optional, low-cost: 10-minute look at katana's `internal/gnomonitoring` client for the same
   hardcoding risk (§3).
5. Then pick up WAVE1's fund-risk findings per the standing rank in §4 — the actual next
   build-session-sized piece of work once the P0 above is closed.
