# Memba Topaz Monitoring Plan — CTO Panel Review (2026-07-23)

> Local doc — not for git/GitHub (same convention as the audit doc it reviews). This is a
> **proposal for review**, not an actioned plan — nothing beyond PR #989 (already merged, see
> below) has been implemented from this. Produced by a 4-lens expert panel (fund-safety/security,
> infra/observability, product/process, engineering-execution), each finding adversarially
> cross-checked by an independent verifier, then synthesized. 13 agents, 190 tool calls total.
>
> **⚠️ I (the orchestrating session) independently re-checked the panel's top finding after
> synthesis and found it factually wrong — see the correction immediately below before reading
> anything else in this doc.** The rest of the report held up under my spot-checks.

---

## CORRECTION to the panel's #1 finding — please read this first

The panel's highest-severity finding claimed `agent_registry_v2`'s `AdminAddress` is a "single-key
custody admin, falsely commented as multisig," live on Topaz today, and recommended treating it as
same-priority as the monitoring fix. **This is wrong, and I verified it directly before writing
this doc:**

- The actual source (`samcrew-deployer/projects/memba/realms/agent_registry_v2/agent_registry_v2.gno:63`):
  ```go
  AdminAddress = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0" // samcrew-core-test1 multisig
  ```
  The comment says "multisig" — correctly, not falsely.
- I queried the account directly on topaz-1 (`auth/accounts/g1x7k4628…` via ABCI query, decoded):
  ```json
  "public_key": { "@type": "/tm.PubKeyMultisig", "threshold": "2", "pubkeys": [ /* 2 keys */ ] }
  ```
  This address **is** a genuine 2-of-2 multisig account on-chain, right now. Broadcasting anything
  as this address requires two signatures — not one hot key.

This matches what my own session had already noted from an earlier verification pass
(2026-07-22): *"WAVE1 asserts `g1x7k4628` is a single hot key — it is `/tm.PubKeyMultisig`
threshold 2 (checked on chain 2026-07-22)."* The panel's fund-safety reviewer and its dedicated
adversarial verifier both re-derived the "single-key" claim from reading the `.gno` **source
file** (which shows one address string in a variable) without querying the account's actual
on-chain pubkey type — the step that would have caught this. Reading source alone cannot tell you
whether an address is multisig-controlled; only the chain can.

**Net effect:** the panel's #1 recommended action (elevate `agent_registry_v2` custody-check to
top priority, same urgency as the monitoring fix) does not hold as stated. There may still be a
real, lesser finding underneath — e.g. whether the *DAO-level* authorization the panel's own text
alludes to is missing a second gate beyond the account-level multisig, or whether `escrow_v3`
(not checked here, and per the panel itself **not deployed on Topaz**) has a different,
non-multisig admin key on test13. That is a narrower, lower-urgency question than what the panel
reported, and it has NOT been verified either way — it would need its own dedicated look, not
inherited at panel-reported severity.

I'm flagging this prominently rather than quietly downgrading it, because the whole point of
requesting a CTO panel was rigor — and the panel's own adversarial-verification step is exactly
what should have caught this and didn't. Treat every other finding below with that same
we-verified-it-once-more-and-it-held caveat, not as beyond question.

---

## What was actually shipped this session (not a proposal — done)

**PR #989 — merged to `main`** (`95afcbe2`, 2026-07-23T16:52:03Z): removed the stale
`monitoringChain: "topaz"` override from `frontend/src/lib/config.ts` (gnomonitoring's registry
had flipped back to accepting `topaz-1` directly). Process followed:
- Isolated worktree (avoids the shared-checkout parallel-session risk documented in
  `feedback_git_workflow.md`)
- Live API re-verified immediately before AND after the code change
- Full local verification: targeted + full `vitest` suite (4231 passed, 6 pre-existing failures
  confirmed identical on unmodified `main` — a known local `gno`-toolchain-version drift, not
  caused by this change), `npm run lint` (0 errors), `npm run build` (clean)
- Two independent adversarial code-reviewer agents, each in its own worktree: Review A →
  APPROVE (verified the live claim itself, checked fallback logic, grepped for other hardcoded
  keys); Review B → APPROVE WITH NITS (caught that the doc-comment's suggested verification curl
  was itself broken — missing a required `period` param — **fixed and re-verified** before merge)
- Parallel-session check before every push and immediately before merge: `main` unchanged
  throughout (`034ae5b6` → confirmed still HEAD right up to merge), no conflicting open PRs
- CI: all 17 checks green (confirmed via poll, not assumed) before merging `--squash --admin`

This part is done. Everything below is the requested deep-review **proposal** — for you to
accept, modify, or reject.

---

## 1. Verdict (panel synthesis)

The shipped fix in PR #989 is narrowly correct, minimal, and matches its own plan almost
line-for-line — no logic changes, no fund-movement path (the monitoring key only feeds read-only
display calls), realistic effort estimate. The plan is weaker on two fronts that matter more than
the fix itself: **prioritization** and **follow-through**. Setting aside the corrected #1 finding
above, the panel's core structural critique still stands: the plan applied real urgency to a
cosmetic bug, compressed three WAVE1 findings of different severity into one backlog bullet, and
named the real systemic gap (no alerting on gnomonitoring rejecting Memba's key — second silent
break in 24h) without shipping anything to close it.

## 2. Confirmed issues (panel findings that survived adversarial verification, minus the corrected #1)

**A. The plan's own recommended follow-up (alerting on gnomonitoring rejection) was not shipped.**
`frontend/src/lib/gnomonitoring.ts`'s `monitoringFetch`'s `!res.ok` branch (~line 162) and `catch`
block are untouched by PR #989; no CI/scheduled check exists anywhere in `.github/`. This is the
second silent chain-key break in ~24h, caught only by a human noticing blank monikers. Since
`@sentry/react` is already used elsewhere in this codebase (`main.tsx`, `ErrorBoundary.tsx`,
`gnoloveApi.ts`, `grc20.ts`), a breadcrumb here extends an existing pattern rather than
introducing a new one. **Nit from the panel's own minor-findings list, worth folding in:** alert
generically on `!res.ok`, not by string-matching gnomonitoring's literal error text — a future
mis-key could return `200` with an empty array instead of a `400`, which a string-matched
breadcrumb would never catch.

**B. The proposed synthetic-check design (my original plan's §1 second option) would stop
covering Topaz the moment this exact fix ships.** It was scoped to "every network with a
`monitoringChain` override" — Topaz was the only one, and this PR deletes its override. Verified
independently: `GET https://monitoring.gnolove.world/info` is live, public, no auth required, and
returns `{"enabled_chains":["gnoland1","test-13","topaz-1"],...}` — a strictly better source of
truth than a hand-maintained override list or a reactive error-string match. **If built as a
fast-follow:** for every network in `NETWORKS`, compute the effective key
(`monitoringChain ?? chainId`) and alert if it's not in `enabled_chains`. Cross-repo note,
independently confirmed: katana's `prd.md` (FR-2b.1, `katana/prd.md:130-140`) already specs
near-identical `/info`-based validation, marked `[TO BUILD]` — check there before building a third
copy of this logic.

**C. katana has an analogous (architecturally better, but still real) drift-detection gap.**
Independently confirmed: `katana/internal/gnomonitoring/client.go` takes `chain` as a required
parameter (`FetchReports(ctx, chain string)`, `q.Set("chain", chain)`) — no hardcoded key, so it
can't repeat Memba's exact bug. But its own `prd.md` FR-2b (`/info`-based validation) is
unimplemented, and its live ops `config.yaml` is gitignored — so from this repo alone, nobody can
tell whether katana is currently pointed at Topaz, with what key, or in what `dry_run` state. That
last variable matters a lot: `dry_run: true` means no live signing risk yet; `false`/absent means
katana is actively submitting real eject/lower_vp/raise_vp proposals via `gnokey` today, on
possibly-stale validator data. **This needs a katana-repo-side check, not Memba PR work** — check
the live ops config before the next katana-driven action against Topaz validators.

**D. Doc-hygiene gap, cheap to close now:** `HANDOFF_memba_next_2026_07_22.md` (verified still on
disk, unmodified) literally instructs the next session to re-read stale claims
(`QUEST_ADMIN_ADDRESSES still unset`, `ask the owner about the ICO flag`) that this session's
`MEMBA_TOPAZ_MONITORING_AUDIT_2026-07-23.md` and `MEMORY.md` already corrected. `MEMORY.md` was
updated this session to point at the correction, but the raw handoff file itself was not edited —
if a future session pastes that handoff verbatim (as its own header instructs), the stale claims
resurface. Cheap fix: either edit the handoff file's stale lines directly, or make `MEMORY.md`'s
pointer more prominent than "paste this handoff" — the latter already happened this session (see
`Latest session` section), so this is close to closed, just worth confirming next time.

## 3. Minor findings (panel-reported, not independently re-verified beyond the panel's own adversarial pass)

- "QUEST_ADMIN_ADDRESSES / FEED_MODERATION_BEARER now SET" is verified only as "secret name
  registered" — `fly secrets list` redacts values, so this confirms the variable exists, not that
  its *contents* are correct or that the prior startup warning is actually gone from logs. Worth
  tightening to "registered" rather than "closed" until logs are checked.
- The ICO-flag correction rested on a browser screenshot. Reproducible, but a stronger form of
  evidence (e.g. inspecting the deployed production JS bundle for the flag's compiled-in value)
  would leave less room for doubt next time — worth doing if this gets re-litigated.
- Original plan's file/line citations (config.ts 77-88, 154-157, 152-171) and effort estimate
  (~30-45 min) were checked against the real diff and both held up exactly — no scope creep to
  flag on the execution side.
- A same-repo unit test structurally cannot catch this bug class (the failure lives in
  gnomonitoring's own out-of-band registry) — if automated detection is wanted, it needs a
  scheduled *live* smoke test against the real service, not another synthetic-mock unit test.

## 4. Improved backlog re-ranking (replacing the original plan's §4)

With finding A corrected out, the re-ranking simplifies. In rough priority order, as a proposal
only:

1. **Bundle the observability follow-up (§2.A above) with or immediately after PR #989.** It's
   already merged without it — recommend a same-day fast-follow PR (small: one `console.warn`/
   Sentry breadcrumb) rather than letting it drift into "someday."
2. **Re-scope the original plan's item 1 ("agent_registry_v2 custody check") correctly**, if it's
   worth pursuing at all: the actual open question (if any) is narrower than the panel stated —
   confirm whether there's a DAO-level or realm-level gate *beyond* the account-level multisig
   that might be missing, not whether the address itself is single-key (it isn't). Low urgency
   unless a real gap surfaces.
3. **WAVE1's fund-risk backlog, split by actual difficulty** (per the panel's finding, still
   valid): OTC wrong-spender (cheapest, revert-only, no funds move) and OTC-decimals
   (fund-safety, still FE-only) are independent from the escrow_v3 fee-spine / NF-2 solvency
   getters, which need a new immutable deploy — don't let closing the cheap two read as closing
   the bucket.
4. **katana chain-key / dry-run state check** — out-of-repo, but elevate from "someday" to
   "before the next katana-driven action against Topaz validators," given real signing actions
   are a materially worse blast radius than a wrong displayed name.
5. Everything else in the original plan's §4 (topaz-1 funding blocker, marketplace pilot shape,
   Feed v2, BARRICADE 3D) — unchanged, no new information from this panel.

This reordering asserts nothing as decided — it's a proposal for you to accept, modify, or reject
before the next session picks up the backlog.
