# Space Invaders — App Store Listing & Launch Spec

**Date:** 2026-07-09
**Status:** Ready for owner action. The game is feature-complete on `main` (behind `VITE_ENABLE_SPACE_INVADERS`). The App Store listing is registered **on-chain** in `memba_appstore_v2`, so the remaining launch steps are owner/wallet actions — this doc hands you everything needed.

---

## 1. What's code vs owner-action

| Piece | Where it lives | Who does it |
|---|---|---|
| The game | frontend, on `main` | ✅ done |
| Coming-soon gate copy | `SpaceInvadersGate.tsx` | ✅ updated (this PR) |
| App icon (SVG source) | `frontend/public/games/space-invaders-icon.svg` | ✅ this PR (raster/pin below) |
| **Listing (name/tagline/icon/URL)** | **on-chain `memba_appstore_v2` via `RegisterApp`** | **owner wallet broadcast** |
| Icon hosting (`iconCID`) | IPFS pin | owner (Lighthouse) |
| Screenshots / preview GIF | store assets | designer / capture |
| Enable the flag | env | owner |

---

## 2. Listing copy (paste into `RegisterApp`)

- **name:** `Space Invaders`
- **tagline:** `Onchain arcade classic — blast the swarm, prove your score.`
- **category:** `Game` (match the store's existing game category key)
- **appURL:** `/test13/game/space-invaders`  *(network-relative; the store links to it)*
- **description:**
  > The arcade classic, rebuilt for Memba. Clear the swarm, chase escalating waves, and chain no-miss combos for the high score — with rapid fire, destructible bunkers, a mystery UFO worth 300, sound, and haptics. Plays instantly in the browser, no wallet. An on-chain, replay-verified leaderboard is on the way.
- **publisher:** `Samourai` (or the canonical publisher string used by other listings)

**Badges** (reuse the store's `.appchip` styles): `ARCADE` · `INSTANT PLAY` · *(later)* `ONCHAIN LEADERBOARD`.

---

## 3. Icon → `iconCID`

`space-invaders-icon.svg` is the canonical, on-brand icon (sentinel invader in phosphor `#e6f7ef`, gold shot `#ffd24d`, teal cannon `#4ff0c0`, on the dark screen tile `#04120f`) — the first game to break the seeded-monogram default.

Owner steps:
1. Rasterize to PNG at **1024×1024** (and 512, 256, 192, 96, 48 if the store wants multiple) — keep the 80% central safe area.
2. Pin the PNG (or the SVG, if the store renders SVG) to **IPFS via Lighthouse** → get the CID.
3. Use that CID as `iconCID` in `RegisterApp`.

*(If the store's `iconCID` renders SVG directly, you can pin the SVG as-is and skip rasterization.)*

---

## 4. Owner launch checklist

1. **Pin icon → IPFS** (§3) → `iconCID`.
2. **`RegisterApp`** on `memba_appstore_v2` with the §2 fields + `iconCID`. (Money-path broadcast; follow the marketplace fee-path checklist.)
3. **Capture screenshots** (portrait, bezeled game, caption bars) — see plan §6.3: hero gameplay · combo moment · UFO · bunkers · mobile controls. *(non-code)*
4. **Flip the flag:** set `VITE_ENABLE_SPACE_INVADERS=true`.
   - ⚠️ Confirm it is **not** a `SAFETY_GATED_FLAG` in `safeFlags.ts` (it's client-only/no-funds, so it shouldn't be) — else the prod build fails.
5. **Verify** the listing renders (icon, copy, `Play` CTA → `/game/space-invaders`) and the game loads.

---

## 5. Deferred to the onchain track (track A)

The "onchain leaderboard" badge + the certify UI (pending→gold, realm-path chip) land with the leaderboard realm — **not** part of this listing. Until then, the listing markets the *game*; add the onchain badge/copy when `memba_arcade_leaderboard_v1` ships. Never market it as "trustless."

Ref: `docs/planning/SPACE_INVADERS_AAA_PLAN_2026-07-08.md`.
