# Backlog Notes — captured 2026-07-09 (owner-dictated)

> **Status: ARCHIVED 2026-07-11.** That investigation happened: all 16 items are folded into
> [MEMBA_NEXT_CYCLE_AUDIT_AND_PLAN_2026-07-09.md](../../MEMBA_NEXT_CYCLE_AUDIT_AND_PLAN_2026-07-09.md)
> (Waves 0/A–F; Wave 0 shipped as #863–#877 + the 2026-07-10 ceremony; v7.3.0 cut #878).
> Kept for the owner's raw wording.
> Companion state: `archive/shipped-2026-07/BACKLOG_PLAN_2026-07-08.md` (items 2/3 still open there) and the
> per-feature plans referenced below.

## A. Feature improvements (owner-dictated)

1. **App Store — richer cards + identity.** Show app reviews/comments directly on the App
   Store home page inside each app card; user/player counts would also be interesting.
   App icons should be more creative/designed — real app/game logos that fit each app.
   App owners need a great workflow to candidate/add/manage their design/logo & app info.
   *(Builds on: reviews engine live (#841/#845), v3 submission lifecycle (deployer #71),
   B3 submit money-path — spawned as a task chip 2026-07-09.)*
2. **Home — "Live across gno.land".** Should display more diversified (ALL) realms /
   interactions / transfers / actions — and include Memba features obviously.
3. **Home — general refresh.** Check for needed updates / missing features; propose
   improvements. *(Last major passes: Control Room Jun-19, member AAA Jun-27.)*
4. **Feed — next wave.** Dig through `archive/shipped-2026-07/SOCIAL_FEED_UX_REVIEW_AND_DESIGN_2026-07-06.md`
   for what was designed but never shipped (media attachments etc.); produce a dedicated
   updated plan.
5. **Marketplace — real-state check.** Production looks a bit cheap — verify how much of
   that is simply the unmerged `feat/marketplace-v2` branch (draft #851, flag-gated) vs
   genuinely missing work; reconcile against `MARKETPLACE_V2_DEEP_AUDIT_AND_AAA_PLAN_2026-07-08.md`
   phases 5/6 gates and the go-live checklist.
6. **Blog — content quality + SEO.** Verify the articles serve both general readers and
   developers, re-check SEO wiring (route meta / JSON-LD / sitemap from W6.3), and add
   images/screenshots/illustrations from the app. *(On-chain pipeline ready: realm
   deployer #74 + reader #859, dark.)*

## B. Review/audit rounds (owner-dictated — one consolidated MD each)

7. **House cleaning.** Delete (not just archive) OLD/deprecated MD files across
   `docs/planning/*`, `docs/*`, and anywhere else, local + GitHub, so the written context
   matches the project. *(The 2026-07-09 sweep ARCHIVED shipped plans; this round decides
   what to actually delete.)*
8. **Mobile UX/UI** — full round tour.
9. **Light/Dark themes** — review + design rules (`docs/DESIGN_SYSTEM.md` is the anchor).
10. **Performance** — audit + reviews round (post the Jul-8 remediation; W1.5 indexer
    split still an open owner decision).
11. **Security** — product AND realms (post the P0 fund-guard closure; the mainnet
    readiness checklist is the deploy-side anchor).
12. **DAO creation/management** — code, UX, UI, sub-features.
13. **Multisig** — code, UX, UI, sub-features (per-sig verified badge just shipped #855;
    enforce flip still metric-gated).
14. **All features, one by one** — the systematic per-feature deep-review round
    (Backlog-2026-07-08 item 3, never started).

## C. Brainstorms (owner-dictated)

15. **App Store futures** — imagine where the feature goes (discovery, monetization,
    curation, developer experience).
16. **Viral games / (d)apps** — what could we build & list for virality or revenue?
    *(Prior art: Block Party #781 dark, Space Invaders #828–#850 live-flagged.)*

## Next-cycle kickoff checklist

- [ ] Investigate every item above at current HEAD (anchors drift — re-verify, don't trust
      this file's parentheticals blindly).
- [ ] Fold in the still-open carry-overs: backlog items 2 (plan-coverage matrix) & 3
      (per-feature review = item 14 here), B-track B3/B4/B5, marketplace Phase 5/6 gates,
      validator-naming P1 alerts, W1.5 decision.
- [ ] Produce ONE fresh consolidated implementation plan (with engineering suggestions
      added) → owner review → go.
