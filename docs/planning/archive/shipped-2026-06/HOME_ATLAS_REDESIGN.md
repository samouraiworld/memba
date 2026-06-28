# Memba Home — Atlas Redesign (v2)

- Date: 2026-06-23
- Branch (when implementing): `feat/home-atlas` (off `origin/main`)
- Status: **design locked, awaiting spec review → implementation plan**
- Process: repo sync → audit (live + code + docs) → 3 design directions (Claude Design) → **direction chosen: C / Atlas** → developed visitor + member → **pivotal data + network decisions made** → this spec → implementation plan
- Supersedes the *visual execution* of the shipped Control Room (PR #439), not its honest architecture. This is an elevation + IA reimagining, not a teardown.

---

## 0. Decisions locked

| Decision | Choice |
|---|---|
| Direction | **Atlas** — explore-led "board of doors" showcase |
| Scope of change | **Reimagine** the IA (not just polish) |
| First-impression target | **Visitor-first** (logged-out), member home designed in the same language |
| **Networks** | **test13** (primary, this month) + **gnoland1 / betanet**. **test12 wound down → removed.** Drop Staging / Portal Loop too (confirmed). `DEFAULT_NETWORK` → **test13** |
| Showcase data strategy | **Per-network + invitations** — feature what exists on the active network; empty slots become invitations, never blank |
| Visual language | **Kodera** tokens, dark-first, light theme as a toggle |
| Platforms | Desktop **and** mobile, from one responsive primitive |
| Honesty | No fabricated activity/timestamps; every figure deep-links to gnoweb/source; "state, not stream" |

---

## 1. Audit (why we are doing this)

The home was reworked into "The Control Room" and shipped 2026-06-19 (PR #439). The **architecture is sound** (StatusStrip → Spine → StateBoard; state-not-stream; honest deep-links). The **visual execution** falls short of "awesome/elegant." Live findings on `memba.samourai.app/test13/`:

1. **Broken primary CTA** — `VisitorHero` renders "Explore DAOs" + "Install Adena" as adjacent links with no gap/button styling → reads as one string "Explore DAOsInstall Adena" (desktop + mobile). Source: `src/components/home/VisitorHero.tsx`.
2. **No hierarchy / no focal point** — 14+ near-identical stat cards at equal weight; desktop grid scatters with accidental whitespace.
3. **"—"-heavy & "DAOS 0"** — avg uptime, member, tokens, agents render em-dash; **DAOs = 0 is a count-source bug**, not an absence: `memba_dao` + core realms ARE deployed on test13, but the DAO count is a client-side gnoweb-namespace scan that returns 0 (`counts.daos` is omitted from the snapshot — no registry source). Fix = feature the real DAO and/or count known/registered DAOs properly; never show a bare "0". Compounded by the (now resolved) two-network split — see §6.
4. **Redundancy** — validators shown 3×, "294" shown 3× (contributors/members).
5. **Mobile = monotonous infinite scroll** — same card ~14× with no rhythm/imagery/story.
6. **Weak visitor conviction** — after the headline it's an insider stat-dump.
7. **Foundation debt** — two competing token systems (`tokens.css` vs Kodera `index.css`) with divergent values; unused spacing/shadow scales; 1,757-line monolithic `index.css`; buttons with no base class.

Atlas resolves 1–6 by design and rides a token-unification pass to start on 7.

---

## 2. The Atlas concept

The home is a **board of doors** into the gno.land sovereignty stack. Each "door" is a self-contained card that shows the *most inviting true thing* about a part of the product and offers one obvious next step. Explore-led for visitors; action-led for members. The board is warm, layered, and alive — without ever faking data.

Two doors, one component system (preserve the existing `<Home mode="visitor" | "member">` contract, `pages/Home.tsx`):

- **Visitor** → hero (conviction + 1 primary CTA) → **showcase board** (featured DAO door first, then contributors / network health / directory / launchpad doors).
- **Member** → **"act now" inbox** (the crown jewel: vote / sign / claim / candidature, with inline quick-vote) → **your worlds** → the same explore doors, condensed.

---

## 3. The "door" primitive

Generalize the current panel/`ActionCard` into one primitive (`components/home/Door.tsx`) with variants. All doors share: a lowercase-mono eyebrow label + optional icon, a body, and one action (`<a>`/`<button>`). All clickable, all keyboard-focusable.

| Variant | Use | Body |
|---|---|---|
| `featured` | Spotlight (featured DAO) | name + 2–3 honest metrics + primary action; faint teal full border (`#14463a`) to denote featured |
| `list` | Ranked/people (top contributors) | rows with initials avatar + value |
| `stat` | Single honest metric (validators, collections) | big value + sublabel + source link |
| `search` | Directory | inline search affordance + count |
| `promo` | Capability (launchpad) | one-line value + CTA |
| `action` | Member inbox item | icon chip (teal/amber) + title + meta + inline action(s) |
| `invitation` | **Empty/cold-start fallback** | dashed border, muted icon, "explore / create one" CTA — **the per-network safety net** |

**State rules (every door):**
- `loading` → skeleton shimmer (reuse `.action-card--skeleton` pattern).
- `empty` → **resolves to `invitation`, never to "—"/"0"**. (Codified — this is the audit's #3 fix and the locked data strategy.)
- `error` → neutral fallback + Retry, error-isolated (reuse `PanelBoundary`, `StateBoard.tsx`). One door failing never blanks the board.
- Numbers shown only when the source has a real value; each carries a deep-link to gnoweb/qrender or the in-app page.

---

## 4. Visitor home spec

1. **StatusStrip** (reuse `StatusStrip.tsx`) — mono heartbeat: `メンバー · testnet 13 · ● live · block #… · {n}v`.
2. **Hero** (rework `VisitorHero.tsx`) — headline "Explore the gno.land sovereignty stack." (or keep "Run your DAO. Own your stack. Answer to no one." — A/B copy is a build-time toggle), one-line subhead, **two real buttons with a gap**: `Explore DAOs` (teal primary) + `Connect wallet` (ghost), then "No wallet needed to look around." → fixes audit #1.
3. **Showcase board** (rework `StateBoard.tsx` → `ShowcaseBoard`) — `featured` DAO door spans full width first, then a responsive grid of `list` (contributors), `stat` (network health), `search` (directory), `promo` (launchpad) doors. Lazy-mounted (`useInViewport`), error-isolated.

Mobile: hero compact → featured door → 2–3 priority doors stacked (DOM order = priority) → bottom tab bar (`MobileTabBar.tsx`).

---

## 5. Member home spec

1. **StatusStrip** + wallet chips (balance + truncated address), mono.
2. **"Act now" inbox** (reuse + elevate `ActionInbox.tsx` + `QuickVoteWidget`) — the crown jewel. Count pill + "view all activity". Action types, each an `action` door with an icon chip:
   - **vote** (teal) — inline `Approve`/`Reject` quick-vote, with DAO + quorum + deadline.
   - **sign** (amber) — multisig tx, "n of m signed", `Review & sign`.
   - **claim** (teal) — completed quest reward, `Claim`. *(Badges remain gated — claim is for live quest rewards only; see §11.)*
   - **candidature / escrow-release** — as their on-chain features are live/ungated.
   - **empty** → "You're all caught up." (honest, inviting — not a blank).
3. **Your worlds** — saved DAOs/multisigs (localStorage + per-DAO reads), each a card with role + open count + health; plus an `Add a world` invitation card. (Rebuild `YourWorldsPanel` on TanStack Query — the audit flagged its imperative `forEach`+`catch{}` fetch.)
4. **Explore** — the same showcase doors, condensed to 3-across.

Mobile: inbox (quick-vote inline on first item) → your worlds → 1–2 explore doors → tab bar (Home/DAOs/Tokens/Activity/More).

---

## 6. Network scope + showcase data strategy (locked)

**Networks = {test13 (primary), gnoland1 (betanet)} only. test12 is removed.** The home reflects the **active network**; there is **no cross-network mixing** in v1.

- **`DEFAULT_NETWORK` → test13** (was test12). Network switcher lists test13 + gnoland1 only; remove test12 (and Staging / Portal Loop — confirm in §12). `lib/config.ts` `NETWORKS`.
- **Per-network snapshot/featured:** today `SNAPSHOT_NETWORK` is hardcoded `"test13"`. Generalize so **both** priority networks get the full Atlas treatment — `GetHomeSnapshot` extended to gnoland1, or graceful per-panel fallback (`hooks/home/*`) where the snapshot isn't available for a network.
- **Featured DAO door** (`FeaturedDaoPanel` → featured-door): if the active network has a valid, configured featured DAO (gate via `isRealmValidOn` / the `isXValid()` family), show it. On **test13** this is real today (`memba_dao` is deployed). On **gnoland1**, feature whatever is configured; if none → `invitation` door ("No DAO on this network yet — explore all / create one"). Never a bare "0".
- **DAO count fix:** replace the namespace-scan "0" with either a real registered-DAO count or the featured door itself. Surface "create the first DAO" as the invitation, not a dead metric.
- **Every door** follows the empty→invitation rule (§3). The board never shows "—"/"0".
- **DAO-location dependency (flag):** the legacy DAO/governance content that lived on test12 must be (re)deployed/seeded on test13 (and/or gnoland1) for the home to feel populated as those networks grow. Until then, invitations carry the gap honestly. This migration is a **separate workstream** (§11), not part of the home build.
- **Watch-out (from prior work):** do **not** mirror the frontend `"active"` removal into backend `home_rpc.go` — raw render `ACTIVE` = open. Carry untouched into Phase-3.

This is the locked answer to "what keeps Atlas from looking empty": curated-per-network across {test13, gnoland1} + graceful invitations.

---

## 7. Visual language (Kodera)

- **Palette (dark-first):** bg `#000`, elevated `#0c0c0c`, panel `#111/#141414`, edge `#222` (hover `#333`), text `#f0f0f0`, dim `#9a9a9a`, muted `#5a5a5a`, **accent teal `#00d4aa`** (hover `#00e6bb`), danger `#ff4757`, warning `#ffa502`. **teal = signal only.**
- **Type:** Inter (sans) + JetBrains Mono (mono). **mono = machine truth only** (addresses, hashes, counts, block height, eyebrow labels). **Labels lowercase**, not ALL CAPS (refines the current look).
- **Surfaces:** flat, layered for warmth (panel elevation, not gradients/glow). Radius: sm 4 / md 8 / lg 12. 4px spacing grid.
- **Icons:** monoline (current Phosphor set is fine; one size/weight convention).
- **Light theme:** full parity via tokens; ship per §12.
- **Token unification (rides along):** collapse `tokens.css` into the canonical Kodera `--color-k-*` layer; one source of truth; replace hardcoded hex/spacing with tokens. (Continues HOME_REWORK Task 0.1.)

---

## 8. Responsive, a11y, performance

- **Breakpoints** (keep): 1024 (rail → icons), 768 (mobile tab bar, board → 1 col), 480/428/375/320 (progressive). DOM order = mobile priority.
- **a11y:** every door is a real `<a>`/`<button>`; visible focus rings; `prefers-reduced-motion` respected; banners `role="alert"`; readable footer (the ~9px disclaimer is bumped).
- **Perf:** preserve lazy-mount (`useInViewport`, eager index 0) + per-door `PanelBoundary`; never fan out expensive `Render()` on first paint; per-source `staleTime`. Optional: self-host Inter/JetBrains Mono (today they are render-blocking Google Fonts).

---

## 9. Reuse vs build

**Reuse (architecture is good):** `pages/Home.tsx` (mode contract), `StatusStrip`, `ActionInbox` + `QuickVoteWidget`, lazy-mount + `PanelBoundary` from `StateBoard`, `GetHomeSnapshot` + `hooks/home/*`, `MobileTabBar`/`BottomSheet`.

**Build / change:** `Door.tsx` primitive (+ variants & states) · `ShowcaseBoard` (rework of `StateBoard`) · reworked `VisitorHero` (fix CTAs, board-first IA) · featured-door per-network logic + invitation fallbacks · per-network snapshot generalization (test13 + gnoland1) · `YourWorlds` on TanStack Query · token unification · network-config cleanup (drop test12) · elevated inbox styling · home CSS extracted from monolith.

---

## 10. Build phases (proposed)

- **Phase 0 — Foundation & quick wins:** token unification (`tokens.css`→Kodera), `Door` primitive + states, **fix `VisitorHero` CTAs** (kills audit #1 immediately), **network-config cleanup** (drop test12, `DEFAULT_NETWORK`→test13, switcher = test13 + gnoland1). Ship-able alone.
- **Phase 1 — Visitor Atlas:** hero rework + `ShowcaseBoard` with `featured`/`list`/`stat`/`search`/`promo` doors + invitation states; desktop + mobile; **light + dark theme parity** (proven in design).
- **Phase 2 — Member Atlas:** elevate "act now" inbox (vote/sign/claim) + `YourWorlds` rebuild + condensed explore doors.
- **Phase 3 — Per-network featured + data wiring:** featured-DAO per-network gating across test13 + gnoland1, invitation fallbacks, DAO-count fix, snapshot generalization (respect the `"active"` watch-out).
- **Phase 4 — Polish:** a11y pass, motion, perf (font self-host), footer/legibility.

Each phase = its own PR off `feat/home-atlas` (branch off `main`), reviewed, never merged without explicit approval.

---

## 11. Non-goals / watch-outs / related workstreams

- **test12 removal is a separate, related workstream** — spans `lib/config.ts` `NETWORKS`, code references, docs, env, and the on-chain winddown. The home build assumes test12 is gone but does not own its full deletion. Scope/track it on its own branch.
- **Do not design around test12** anywhere in the home.
- **Gated features stay OFF:** NFT marketplace/launchpad, GnoBuilders **badges**, treasury spending, agent credits, freelance services (`VITE_ENABLE_*` are CI-enforced fund-safety kill-switches). Atlas surfaces only live, ungated features (multisig, DAO governance, token factory, directory, validators, Gnolove, channels, quests, AI analyst, teams).
- No new on-chain features; no cross-network data mixing in v1.
- Do not regress the honesty rule (no fake activity/timestamps).
- Do not mirror frontend `"active"` removal into backend `home_rpc.go`.

---

## 12. Decisions (resolved 2026-06-23)

1. **Hero copy** — A/B both ("Run your DAO. Own your stack. Answer to no one." and "Explore the gno.land sovereignty stack.").
2. **Networks** — test13 + gnoland1 only; **Staging and Portal Loop removed** from the switcher; test12 removed.
3. **Light theme** — **Phase 1**, shipped with dark (parity from the start).
4. **Member tab bar** — add the **"Activity"** tab.
5. **test12 removal** — **frontend/config removal folded into Phase 0** (`NETWORKS`, `DEFAULT_NETWORK`→test13, switcher); the on-chain winddown is a separate ops track.
