# Memba Mobile — AAA UI/UX Rework · Audit & Proposals

**Date:** 2026-06-25 · **Branch:** `docs/mobile-aaa-audit` (worktree `memba-mobile`, off `origin/main` @ `#551`)
**Author:** Memba CTO synthesis over a 9-perspective expert audit (6 specialist agents + cross-review)
**Scope of initiative:** Rebuild the **mobile** UI/UX to a native-app standard (Revolut/Qonto/Linear bar) on the **same shared React codebase**, with **full feature parity** to desktop and **zero breaking changes** to the web/desktop experience. The app must be **installable** ("downloadable"), lightweight, fast, Gen‑Z friendly, minimalist, elegant, super‑intuitive.

> **Status:** Part 0 (sync) and Part 1 (audit) are complete. Part 2 (the 3 proposals) is drafted after the scoping decisions in §1.7 are confirmed.

---

## Part 0 — Repo sync & breaking-change scan (Step #0)

### 0.1 Sync status
All 22 workspace repos fetched (non‑destructively). Nothing dirty/feature‑branch was force‑pulled.

| Repo | State | Note |
|---|---|---|
| **Memba** (canonical) | `chore/dependency-refresh`, +1/-23 vs `origin/main` | The +1 is a dompurify 3.4.2→3.4.11 security bump (8 XSS advisories); 2 "dirty" files are just untracked (`.remember/`, a planning doc). `origin/main` @ `f7430d5` (#551). |
| **gno** (core) | detached at tag `chain/test13`, **66 commits behind `origin/master`** | The pinned chain Memba runs against. 5 "dirty" files are local realm experiments (samcrew grc721 / memba_market_core) — not ours to touch. |
| **gnodaokit** (dep) | `main`, clean | The "port to latest gno + interrealm‑v2" work (PRs **#62/#63/#64**) is still **OPEN** → Memba is **not** being forced onto a new gno ABI this session. |
| **samcrew-deployer** (realms) | `feat/nft-register-market-v3` | NFT v3 engine register script; commerce/feedback realms. |
| Others (gnolove, infra, gno-docs, …) | clean | `gno-docs`/`gno-agent-workspace` are 18 behind (docs only). |

### 0.2 gno‑core breaking-change scan (does any of it threaten Memba?)
Reviewed the last ~40 merged PRs on `gnolang/gno`. Relevant signals, with verdicts:

- **#5858 + #5857 — `chain.emit` attribute values now hard‑capped (panic instead of silent truncation), limit raised 1024→4096 B.** ⚠️ *Realm/indexer scope, not mobile.* On `master`, **not yet on the pinned `test13`**. Action item for the **next chain upgrade**: confirm no Memba realm emits an event attribute >4096 B (the event‑tailing indexer relies on these). Tracked, **out of scope** for a frontend‑only mobile rework.
- **#5792 — grc721 requires token owner for `SetTokenMetadata`.** Touches NFT realms; Memba's `SetTokenMetadata` path is unreachable per the prior NFT audit. No action.
- **#5834 — gnoclient `QuerySessionAccount` returns `GnoSessionAccount`.** Go‑client API shape change; only relevant if the Go backend uses that call. Verify on the next backend gno bump.
- **#5767 — revert validator valset trust‑level/cooldown.** Validator‑set semantics on chain; the Validators page only *reads* — no break, but a reminder the roster math can shift upstream.
- **#5761/#5774/#5759 — gnoweb omnibar/playground/markdown.** `gnoweb` UI only; Memba ships its own frontend. (Only touch‑point: valoper profile deep‑links to gnoweb — already repointed to official hosts in #510.)

**Verdict:** **Nothing in the gno ecosystem blocks a frontend‑only mobile UI/UX rework.** The single tracked item (event‑attr cap) is realm/indexer scope for a future chain upgrade.

### 0.3 Pre-existing conditions to be aware of (not caused by this work)
- The **`CI` workflow is red on recent `main` commits** (#547/#548/#550), while `Security` and `Deploy Frontend` are green. Investigate separately; we must not merge mobile work on top of an unexplained red without understanding it.
- **Prod deploy path is Netlify‑native** (`netlify.toml`), gated by `assertSafeFlags`. Per memory, the `deploy-frontend.yml` Action is a no‑op (empty Netlify secrets). Deploy‑previews are the reliable verification surface; local Vite can serve stale CSS.

### 0.4 Frontend stack (the canvas for the rework)
React **19.2** · Vite **7.3** · React Router **7.14** · TypeScript 6 · TanStack Query v5 (+persist) · **pure vanilla CSS** with `.k-*` design tokens (`src/tokens.css` + `src/index.css` ≈1814 lines — **no Tailwind/Radix/shadcn**) · Phosphor icons · Inter + JetBrains Mono (locally vendored, latin subset) · ~35 routes · vitest (~430 files) + Playwright E2E (**desktop‑only**).

---

## Part 1 — Expert-team mobile audit (Step #1)

**Method.** Nine expert lenses were run as six specialist agents over the live code + live mobile screenshots (`docs/planning/mobile-audit-shots/`), then cross‑synthesised by the CTO lens:
Head of Design + Creative UI Designer → **Design & Brand**; Mobile UX Architect → **IA & Navigation**; Mobile Engineer → **Platform/PWA/Perf**; iOS + Android power users → **Native Conventions**; UX Creative Developer → **Interaction & Motion**; Fullstack Engineer → **Parity & Safe‑Divergence**; CTO → synthesis & sequencing.

### 1.1 Executive verdict
> Memba mobile today is a **competent responsive *desktop* SPA with a mobile skin bolted on** — a correct bottom tab bar and safe‑area inset, but the layout, navigation, motion, and identity are all the desktop product reflowed by CSS media queries. Against the Revolut/Qonto/Linear bar it sits **~2 tiers below**, and it has **three structural gaps that no amount of restyling fixes**. The good news: the foundation (single‑source `.k-*` tokens, deep‑link‑safe routing, real safe‑area plumbing) is honest and makes a systematic rebuild tractable and **desktop‑safe**.

### 1.2 The three structural truths (these shape everything)

1. **It's reflowed, not re‑architected.** Responsiveness is **CSS‑only** (breakpoints 1024/768/640/480/428/375/320; **no `useMediaQuery`/`matchMedia` in render** — only ad‑hoc `window.innerWidth` in 2 files). You can *resize/hide* for mobile but cannot *restructure* (table→cards, sticky action bar, back‑stack). Every native pattern below is blocked at the architecture layer until a viewport primitive exists.

2. **The wallet wall — a phone user cannot perform any authenticated action today.** Auth is hard‑bound to the **Adena *desktop browser extension*** (`useAdena.ts:48` reads `window.adena`; `Layout.tsx:94` → `SignMultisigTransaction`). That global never exists in iOS Safari / Android Chrome, so `installed` is permanently false and the only state a phone user reaches is an **"Install Adena"** link to a desktop extension — a dead end. Read‑only/visitor browsing works; **voting, multisig signing, token creation, profile, alerts, quests are all unreachable on mobile.** This is the central tension with "full feature parity" (see §1.7).

3. **"Installable" is unmet — there is no PWA.** No `manifest.webmanifest`, no service worker, no `vite-plugin-pwa` (only `apple-touch-icon` + `theme-color #000` + `viewport-fit=cover`). Android shows no install prompt; iOS "Add to Home Screen" yields a bookmark‑grade shell with no offline support. The app cannot truly be "downloaded."

### 1.3 Severity-ranked cross-cutting findings (the synthesis)

| # | Finding | Sev | Evidence | Lenses agreeing |
|---|---|---|---|---|
| C1 | **Mobile wallet/auth is impossible** (extension‑only) | **Critical** | `useAdena.ts:48`, `Layout.tsx:94`, `TopBar.tsx:144` | Native, Fullstack, UX‑Arch |
| C2 | **No back/up navigation model** — no header back; per‑page ad‑hoc `navigate(-1)`/`navigate("/")`; no per‑tab stack | **Critical** | `TransactionView.tsx:120`, `MultisigView.tsx:108`, `DAOList.tsx:146`; tabs are plain `<Link>` | UX‑Arch, Native |
| C3 | **Primary actions buried below the fold — worst on the signing path** (Sign/Broadcast ~6 screens down, not sticky) | **Critical** | `TransactionView.tsx:210‑322`; `MultisigView.tsx:155` | UX‑Arch, Native |
| H1 | **No PWA / installability / offline shell** | **High** | no manifest/SW; `vite.config.ts` | Platform, Fullstack, Native |
| H2 | **Data‑heavy pages = scrunched desktop tables** (validators table `min-width:600px` h‑scrolls; the validators page is a **~12,600 px (~15 phone‑screens)** endless scroll) | **High** | `validators.css:260`, `Validators.tsx:455`; live shot `02` | UX‑Arch, Fullstack, Design |
| H3 | **"More" tab is a junk drawer** of ~14 items / 5 sections (Multisig demoted under "Account"); overflows 60vh into internal scroll | **High** | `MobileTabBar.tsx:118‑233`; `index.css:1452‑1464` | UX‑Arch, Design, Native |
| H4 | **Type system is vestigial & sub‑readable** — modular scale ~5% adopted (61 token uses vs **1,183 hardcoded px**); **759 declarations ≤12px**; body 14px→13px→12px | **High** | `tokens.css:58‑66`; `index.css:166,1728,1779` | Design |
| H5 | **Monospace overload** — JetBrains Mono on 30+ chrome selectors (nav labels, stat values, buttons, footer) → reads as a terminal, not a Gen‑Z app | **High** | `index.css` `.k-label/.k-value/.k-btn-wallet/...` | Design |
| H6 | **Wallet‑connect CTA is top‑right only** — the visitor→member conversion action has zero thumb‑zone presence | **High** | `TopBar.tsx:140`; absent from tabs/More | UX‑Arch |
| H7 | **No press feedback / no route transitions** — 4 `:active` rules total; every navigation is a hard cut; default iOS tap‑highlight box flashes; no Android ripple | **High** | `index.css` (`:active`×4 vs `:hover`×26); `App.tsx` Suspense | Interaction, Native |
| H8 | **BottomSheet has a fake grabber** (decorative), no swipe‑to‑dismiss, never unmounts | **High** | `BottomSheet.tsx:60,33` | Interaction, Native |
| M1 | **`100vh` everywhere, no `100dvh`** → content hides under the mobile URL bar; DAO‑rooms composer clipped | **Med** | `index.css:170,671,679,1233`; `dao-rooms.css:191` | Platform, Native |
| M2 | **No mobile keyboard hints** — 0 `inputMode`/`enterKeyHint`; 25 `type=number`+68 `type=text` raise wrong keyboards; <16px fields risk iOS auto‑zoom | **Med** | whole `src`; `MobileTabBar.tsx:220` | Platform, Native |
| M3 | **Safe‑area is bottom‑only** — sticky topbar & side gutters ignore top/left/right insets despite `viewport-fit=cover` | **Med** | `index.css:1391,1599` only; topbar `:983` | Platform, Native |
| M4 | **Elevation language is ad‑hoc** — `--shadow-*` tokens have **0 uses** vs 41 bespoke shadows; flat hairline cards on pure black | **Med** | `tokens.css:90‑92` | Design |
| M5 | **State matrix is incomplete** — success & offline states near‑universally missing; Directory has no skeleton/error; toasts collide with the tab bar | **Med** | `Directory.tsx:104,224`; `questhub.css:628` | Interaction |
| M6 | **CommandPalette is keyboard‑only** (Cmd+K) — the one "jump anywhere" affordance is invisible & unusable on touch | **Med** | `CommandPalette.tsx:42‑45` | UX‑Arch, Fullstack |
| M7 | **Nav source‑of‑truth is duplicated** — `MobileTabBar` hardcodes tabs independently of `Sidebar`/route tree → recurring "exists on desktop, missing on mobile" drift; ~10 routes have **no** mobile nav entry at all | **Med** | `MobileTabBar.tsx:34‑48` vs `App.tsx` | Fullstack, UX‑Arch |
| M8 | **Heavy global footer on every screen** — 7 social icons + 3‑line alpha disclaimer above the tab bar (website pattern) | **Med** | `Layout.tsx:344‑377` | Design |
| M9 | **Heavy route libs not isolated** — `recharts`, `remotion`, `jspdf` ride in route chunks; no list virtualization; persisted cache only covers `gnolove` keys | **Med** | `vite.config.ts:37‑45`; `queryClient.ts:64‑67` | Platform, Fullstack |
| L1 | **Light theme is a literal inversion** — dark‑mode neon glows (`box-shadow:0 0 24px teal`) bleed onto the light bg | **Low** | `index.css:245` | Design |
| L2 | **Wordmark `メンバー` uses a fallback CJK face** (fonts are latin‑subset only) | **Low** | `fonts.css` unicode‑range | Design |

### 1.4 The worst journeys today (named, so the redesign can target them)
1. **Multisig → transaction → sign (the flagship money path, and the worst):** Multisig is buried in More→Account → the view is a 5‑screen scroll whose Propose button scrolls away → the tx view makes you scroll past message cards, details, signature progress, and the signers table (~6 screens) to reach **Sign/Broadcast** → back is `navigate(-1)` which dead‑ends on refresh, and no header tells you which wallet you're in.
2. **Visitor → connect → act on an alert:** Connect is a top‑right corner button (hardest one‑handed reach), then `/candidature` is a long form whose Submit sits past bio+skills with no sticky header to orient/exit — *and the connect itself is impossible on a real phone (C1).*
3. **Any data page (validators/tokens):** a 600px‑min table on a 375px screen → two‑axis scrolling with labels scrolled off; ~15 phone‑screens (~12,600 px) tall.

### 1.5 What's already good (keep / build on)
- **Single‑source `.k-*` token system, no framework sprawl** — the *architecture* is right; the problem is **adoption**, not structure. A systematic retune is tractable.
- **Deep‑link / refresh integrity is excellent** — every page reads identity from `useParams` and refetches; no in‑memory‑state dependence. A stack/back redesign can layer on without data‑flow rework.
- **Genuine mobile plumbing exists** — safe‑area on the tab bar, `viewport-fit=cover`, 16px inputs in places, mode‑aware tab sets (visitor/member), `prefers-reduced-motion` neutralising ~25 animations, WCAG‑AA‑corrected muted greys, a proper a11y `role="dialog"` BottomSheet.
- **Locally‑vendored fonts with `font-display:swap`**; **press feedback exists** on `.k-btn-primary` (`scale .97`) — the pattern just isn't applied broadly.

### 1.6 Implications for the rework (design constraints derived from the audit)
- **Add one viewport primitive** (`useIsMobile`/`useViewport` + optionally container queries) — the prerequisite for *structural* divergence. Keep desktop on its identical DOM path.
- **Everything additive is desktop‑safe**: PWA manifest + SW, `inputmode`/`enterkeyhint`, `safe-area` `max()` paddings, `100vh→100dvh`, font preload, explicit `manualChunks`, `:active`/tap‑highlight. The only real regression risk is the **service‑worker caching strategy** (mitigate with Workbox `skipWaiting`/`clientsClaim` + hashed precache + no‑cache on auth/tx).
- **Add a mobile guardrail BEFORE touching layout**: a Playwright `Mobile Safari`/`Pixel 5` project + a "desktop layout still intact" assertion, because there is **zero** mobile E2E coverage today.
- **Drive nav from one manifest** so mobile/desktop can't drift (M7).

### 1.7 The one strategic decision the proposals must resolve — **mobile wallet/auth**
"Same code + full feature parity + only‑UI‑changes" is in genuine tension with C1: desktop's authenticated features depend on a browser extension that doesn't exist on phones. Three coherent stances (the 3 proposals in Part 2 are built to span them):

- **A — Browse‑first + elegant desktop handoff (pure UI, no new auth code).** Mobile is a beautiful read‑only/explore app; any write action surfaces a graceful "continue on desktop / scan to open" handoff. Honors "only design changes" literally; *signing parity is explicitly deferred.*
- **B — Unblock mobile signing (adds a wallet adapter).** Treat a mobile signing path (Adena mobile deep‑link / WalletConnect v2 / in‑app browser) as in‑scope because true parity & "native app feeling" require it. More work + security review; delivers the real vision.
- **C — Hybrid / progressive.** Ship browse‑first now with the handoff, but architect the connect layer behind an adapter interface so a mobile signer drops in later without UI churn.

**CTO recommendation:** **C** — it's the "no‑regret" path (ship the AAA mobile experience immediately, keep parity honest via handoff, and leave a clean seam for B). But this is the user's call; it changes the parity promise and scope of all three proposals.

---

## Part 2 — Three mobile UI/UX proposals (Step #2)

**Confirmed scope (locks every proposal):** Wallet = **Hybrid** — browse‑first AAA experience now + an elegant "continue on desktop to sign" handoff, with a `WalletAdapter` seam so a mobile signer (Adena deep‑link / WalletConnect v2) drops in later with zero UI churn. Brand = **open to bold reinvention** (one direction is daring). All three: full **browse parity** with desktop, **installable PWA**, the **same shared React code**, and **zero changes to the desktop render path**.

> Rendered mockups for each direction (Home / a data‑heavy page / a write+handoff screen) were presented in‑session. This section is the written spec: philosophy, nav model, visual system, and the per‑route treatment.

### 2.0 The shared foundation (identical across all three)
These are direction‑independent and are the backbone of the rework:
1. **One viewport primitive** — a single `useViewport()`/`useIsMobile()` hook (subscribes to `matchMedia`), lint‑ban raw `window.innerWidth` in render. This is what unlocks *structural* divergence (table→cards, sticky action bar, back‑stack) instead of CSS‑only reflow. Desktop keeps its identical DOM path.
2. **One nav manifest** — mobile tabs/command + desktop sidebar both derive from a single route/nav config, killing the "exists on desktop, missing on mobile" drift (M7).
3. **A real mobile shell** — `<MobileShell>` (header + body + nav) vs `<DesktopShell>` (sidebar + topbar) chosen at the layout root behind `useIsMobile()`; routes/pages render inside either unchanged.
4. **`PageHeader` + `StickyActionBar` primitives** — every screen gets a consistent contextual header (hierarchical back + title) and write screens get a thumb‑zone sticky action bar (fixes C2/C3).
5. **The `WalletAdapter` seam + `<SignHandoff>` sheet** — all write actions route through one adapter; on mobile it presents the desktop‑handoff sheet (QR + secure deep link). Drop‑in mobile signer later = no UI rework.
6. **Installable PWA** — `vite-plugin-pwa` (Workbox): web manifest (`display:standalone`, maskable 192/512 icons, per‑scheme `theme_color`), precached app shell + navigation fallback, runtime caches (cache‑first fonts/assets, SWR reads, never cache auth/tx), iOS metas + splash. Real SVG wordmark to retire the `メンバー` fallback.
7. **Mobile correctness pass** — `100vh→100dvh`, `safe-area-inset` on all four edges, `inputmode`/`enterkeyhint`/16px inputs, `:active` + `-webkit-tap-highlight-color`, `overscroll-behavior:contain`, View‑Transitions on navigation, visibility‑gated/cellular‑aware polling, route‑chunked heavy libs, broadened query persistence.
8. **Mobile guardrails before any layout change** — Playwright `iPhone`/`Pixel` projects + a "desktop layout intact" assertion (there is zero mobile E2E today).

---

### 2.1 Direction 1 — **"Vault"** · premium, trust‑first (Qonto/Mercury energy)
**For:** the treasurer/operator who needs to trust this with real funds. Calm, precise, institutional.
**Identity:** light‑first warm paper (`#FBFAF7`) + ink (`#14171A`); teal `#00A88A` as the single functional accent; **sovereign gold `#B8860B` reserved exclusively for the L1/GovDAO**; Inter for everything, **mono only for addresses/amounts/hashes**; generous whitespace, hairline dividers, tokenized elevation.
**Signature:** the *proof line* — a thin gold hairline + mono block/hash stamp on key surfaces, signalling on‑chain truth, used sparingly.
**Nav model:** classic bottom tab bar (**Home · Orgs · Treasury · Activity · You**) + per‑tab push stack + sticky `PageHeader` (back+title) + `StickyActionBar`. Search = header magnifier opening the (now touch‑reachable) command palette.
**Home = "Operator":** a "needs you" inbox (votes to cast, txs to sign), treasury balance, your orgs (GovDAO in gold), recent activity. Calm, scannable, big readable numbers.
**Motion:** restrained — press states, gentle fades, sticky‑header compaction. Confidence over flash.
**Best at:** trust, legibility, lowest risk, most "standard‑native." **Watch‑out:** could read as conservative for the Gen‑Z goal unless the gold/proof signature is given real presence.

### 2.2 Direction 2 — **"Pulse"** · energetic, social, Gen‑Z (Revolut energy)
**For:** the contributor/explorer; retention through momentum and play.
**Identity:** dark canvas `#0A0B0D`, teal `#00D4AA` + a **volt‑lime `#C6FF3D`** energy accent + magenta `#FF5C8A` category pops + gold `#FFC53D` for L1; big rounded cards (radius 18–22), large display numerals, avatars everywhere, color‑encoded chips.
**Signature:** the **live "Pulse"** — the cross‑gno.land activity feed (#546) becomes the home hero, plus governance "moments" (stories) and a visible XP/streak layer (GnoBuilders, surfaced not buried).
**Nav model:** bottom tab bar (**Pulse · Explore · ⊕ · Orgs · You**) with a **raised center action**; horizontal stories row; bottom sheets with **swipe‑to‑dismiss**; pull‑to‑refresh on feeds.
**Home = "Pulse/Feed":** stories ring → live activity feed → your weekly XP/streak → quick actions.
**Motion:** rich and purposeful — staggered list entrance, View‑Transitions, success micro‑moments (+haptic), the center‑action bloom.
**Best at:** Gen‑Z appeal, delight, engagement, social proof. **Watch‑out:** most custom motion/components to build; must stay tasteful so it reads premium, not noisy (spend boldness on the feed, keep the rest quiet).

### 2.3 Direction 3 — **"Command"** · bold reinvention, power‑native (Linear/Arc energy)
**For:** the power user / builder; leans into Memba's real strength (a sovereign tool for on‑chain orgs) and the Samourai ethos.
**Identity (fresh):** void `#07080A`, a **duotone electric cyan `#22E3C6` + violet `#7C6BFF`** replacing the single teal, gold `#E8B339` for L1, **monospace elevated into a deliberate brand signature**, tight grotesk display, sharp 8–10px geometry, high contrast, a sovereign "key/proof" motif.
**Signature:** the **Command bar** — the keyboard palette reborn as the persistent mobile heart: type or speak to *do* anything or *jump* anywhere; the IA is search‑first, not tab‑first.
**Nav model:** a floating **Command bar** (primary) + a minimal **3‑icon rail** (Home · Orgs · You) + contextual back. Fewer fixed destinations; everything reachable via command (fixes M6/H3 by design).
**Home = "Command surface":** a big "what do you want to do?" field, smart suggestions/recents, your orgs as a tight grid, an at‑a‑glance network/treasury strip.
**Motion:** crisp and fast — command open/close, result cycling, cursor, View‑Transitions; minimal but precise.
**Best at:** differentiation (looks like nothing else in crypto), fits sovereignty narrative, scales to 35+ routes elegantly. **Watch‑out:** highest build effort + a command‑first model is less familiar to mainstream/first‑time users — needs a great empty/first‑run state and visible affordances so it isn't "a blank prompt."

---

### 2.4 Per‑route → mobile treatment (covers every page; nuances noted per direction)
The ~35 routes cluster into 8 archetypes. Every route maps to one, so feature parity is explicit.

| Archetype | Routes | Mobile treatment (shared) | Per‑direction nuance |
|---|---|---|---|
| **Home/landing** | `/` (visitor & member) | The signature screen | Vault=Operator inbox · Pulse=live feed+stories · Command=command surface |
| **Member control room** | `/dashboard` | Folds into Home (member) + the "You/Orgs" tab | Same engine, 3 expressions |
| **Browse lists** | `/dao`, `/tokens`, `/directory`, `/marketplace`, `/services`, `/extensions`, `/organizations`, `/leaderboard`, `/quests`, `/nft` | Sticky search/filter bar + reflowing **card grid/list** (never tables); virtualized long lists | Vault=tidy rows · Pulse=vibrant cards+chips · Command=command‑filtered results |
| **Data‑heavy** | `/validators`, `/validators/hacker`, gnolove analytics | **Metric cards + ranked cards w/ tap‑to‑expand** (kills the ~12.6k‑px scroll); charts get responsive/simplified variants; hacker‑mode = "best on desktop" interstitial | Vault=power bars · Pulse=sparkline cards · Command=mono leaderboard |
| **Read detail** | `/dao/:slug`(+nested), `/tokens/:symbol`, `/validators/:address`, `/profile/:address`, `/nft/collection/*`, `/nft/creator/*`, `/quests/:id`, proposal view | Sticky `PageHeader` (back→parent + title); breadcrumb collapses into the back button; scannable sections | Consistent across; accent/elevation per identity |
| **Write/flow** | `/create`, `/import`, `/create-token`, `/dao/create`, `/candidature`, `/propose`, vote, multisig sign, alerts actions | Single‑column form or **stepper** + `StickyActionBar`; primary action → routes through `WalletAdapter` → **`<SignHandoff>`** sheet (QR + secure desktop deep link) | Vault=ink CTA · Pulse=volt CTA + swipe sheet · Command=`>_ sign on desktop` |
| **Multisig** | `/multisig`, `/multisig/:address`, `/tx/:id` | **Promoted** in nav (was buried in "More"); detail+action archetype with sticky sign bar + handoff | Vault=Treasury tab · Pulse=Orgs · Command=`/sign` |
| **Utility/content** | `/settings`, `/feedback`, `/changelogs`, `/alerts` | Settings/list rows; **the global footer's social+alpha‑disclaimer moves into Settings→About** (off every screen) | Theme/network become labeled sheets/segmented controls (not raw `<select>`) |
| **Realtime/special** | Jitsi PiP, command palette, onboarding wizard | PiP docks to a bar (not a desktop drag); palette gets a **touch entry point**; wizard → mobile‑first sheet | Command makes the palette the whole nav |

### 2.5 Comparison matrix

| Axis | Vault | Pulse | Command |
|---|---|---|---|
| Personality | Premium / institutional | Energetic / social | Power / cypherpunk |
| North‑star | Qonto, Mercury | Revolut, Cash App | Linear, Arc, Raycast |
| Brand boldness | Evolve, recognizable | Vibrant evolution | **Reinvention** (new accents, mono identity) |
| Nav model | Tab bar + push stack | Tab bar + center action + stories | Command bar + 3‑icon rail |
| Gen‑Z pull | Medium | **Highest** | High (different flavor) |
| Trust signal | **Highest** | Medium‑high | High |
| Build effort | Medium | Med‑High | **High** |
| Regression risk | **Lowest** | Medium | Med‑High |
| First‑run familiarity | **Highest** | High | Needs strong onboarding |

**Not mutually exclusive:** the chosen base can borrow one signature from another — e.g. Vault/Command can adopt Pulse's live feed as a secondary surface; Vault/Pulse can adopt Command's touch palette. The pick sets the *spine* (nav model + identity); cross‑pollination is encouraged in the polish round.

### 2.6 CTO lean (for discussion, not a decision)
For a tool that holds treasuries, **Vault** is the safe, trust‑maximizing base; **Pulse** maximizes the Gen‑Z/retention goal; **Command** maximizes differentiation and best fits the Samourai sovereignty story (and scales cleanest to 35+ routes). A strong synthesis worth considering: **Command's spine** (command‑first, fresh identity, sovereignty) **+ Pulse's live feed & delight** for warmth **+ Vault's proof/trust discipline** on the money paths. But this is exactly what the review is for.

> **Next:** on your pick (or blend) + any polish notes, Step #3 produces the AAA implementation plan — phased, with the viewport primitive + PWA + guardrails first, frequent deep reviews against "no desktop regression / no inelegant code," and a per‑route checklist.

---

## Part 3 — Selected direction: **Vault × Pulse** (refined for build)

**Decision (2026‑06‑25):** the **blend** — Vault's premium, trustworthy base × Pulse's energy & live feed — explicitly modelled on **Revolut** (vibrancy, big numerals, card‑first, gesture sheets, delight) and **Qonto** (clarity, precision, generous whitespace, restraint, business‑grade trust). Phone‑first; desktop untouched.

### 3.1 Design system (the blend)
- **Surfaces (dark‑first):** canvas `#0B0D10` · surface `#14171C` · card `#181C22` · raised `#1E232A` · hairline `#262B33`. Tokenised elevation ramp (revives the dead `--shadow-*`) via layered surface tints + soft shadows. **Light mode co‑designed** (Qonto warm‑paper `#FBFAF8` / white / ink), not a mechanical inversion — fixes audit L1.
- **Accent system (disciplined):** teal `#00D4AA` = single primary/interactive; **sovereign gold `#E8B339` reserved for the L1/GovDAO & on‑chain‑proof moments**; social/governance violet `#8B7CFF`; semantic green `#34D399` / red `#F0616D`. Vivid category chips (Revolut) over a restrained base (Qonto).
- **Type:** Inter for display & UI on a **real, enforced scale** — body lifts to **15–16px**, the ≤11px floor retired for primary content (fixes H4); big display **numerals** for balances/tallies (Revolut signature). **Mono only for values/addresses/hashes** (fixes H5). Wordmark shipped as a crisp asset incl. the intentional `メンバー` glyphs (fixes L2 rendering).
- **Shape & space:** generous radii (cards 16–20, pill buttons/chips), 4px grid + Qonto‑grade whitespace; ≥44px touch everywhere.
- **Motion:** purposeful not noisy — universal `:active` + tap‑highlight reset, View‑Transitions on nav, spring + **swipe‑to‑dismiss** sheets, success micro‑moments (+optional haptic), big‑number count‑up, a calm live‑feed pulse. All gated by `prefers-reduced-motion`.
- **Signature:** the **gold "proof" treatment** on every L1 / on‑chain‑truth surface (trust spine) + the calm **live "pulse" feed** (warmth).

### 3.2 Navigation model
Bottom tab bar — **Home · Explore · ⊕ Act · Orgs · Activity** — with **You** as the header avatar (Revolut); center **Act** opens a quick‑action sheet (propose / create token / new DAO / scan‑to‑connect). Per‑tab navigation **stack** + consistent **`PageHeader`** (hierarchical back + title) + thumb‑zone **`StickyActionBar`** on write screens (fixes C2/C3). Search/command palette gets a **touch entry** in the header (grafts Command's best idea). Revolut‑style **bottom sheets** (grabber + swipe‑dismiss) for actions, sign‑handoff, and network/theme (replaces raw `<select>`).

### 3.3 Home composition (the synthesis)
"Your stack" balance card (Revolut big number + 7d delta + mini‑stats) → **"Needs you"** action cards (Vault: vote / sign, colour‑coded) → **GovDAO gold spotlight** (L1) → **Live across gno.land** feed (Pulse) → your organisations. Trust + action first; energy + discovery right below.

### 3.4 Revolut × Qonto inspiration map
| From Revolut | From Qonto |
|---|---|
| Big display numerals; card‑first home; vibrant category colour; raised center action; gesture bottom sheets; live feed; delight/micro‑motion | Generous whitespace; precise type & restraint; calm neutral base; clear hierarchy; trustworthy money‑path framing; first‑class light mode |

### 3.5 🔒 Desktop‑safety protocol (non‑negotiable — "never impact desktop")
The mobile layer is **purely additive**; the desktop render path is unchanged unless a change is *explicitly* desktop‑scoped and reviewed.
1. **Branch, don't fork shared internals.** Layout root picks `<MobileShell>` vs `<DesktopShell>` behind `useIsMobile()`; page/route components render inside either. No rewriting shared component internals — only mobile‑scoped wrappers/variants.
2. **All new CSS is mobile‑scoped** — inside `@media (max-width: …)` / container queries / mobile‑only classes. No edits to desktop‑applicable selectors except additive tokens.
3. **One audited `useIsMobile()`** (SSR‑safe default = desktop; `matchMedia` subscription); lint‑ban raw `window.innerWidth` in render so no stray branch flips desktop.
4. **Guardrails land FIRST:** Playwright **`iPhone` + `Pixel`** projects **and** explicit **desktop‑intact assertions** (sidebar visible ≥1025px, tab bar hidden, no shift). Existing desktop suites stay mandatory + green.
5. **Visual‑regression snapshots** at one desktop + one mobile width on key routes — cheapest catch for "fixed mobile, broke desktop".
6. **Bundle‑size gate** in CI so PWA/shell additions don't bloat the phone download.
7. **Service worker** = Workbox `skipWaiting`/`clientsClaim` + hashed precache + **no‑cache on auth/tx**, dev‑registration off — the one real regression risk, contained.
8. **Every PR** small, reviewed against "no desktop regression / no inelegant code", desktop screenshot diff attached; branch + PR; no merge without explicit approval.

### 3.6 Coverage
All ~35 routes still map to the §2.4 archetypes; the blend changes the *skin and chrome*, not the route set. **Browse parity is full day one**; write actions route through `WalletAdapter` → the desktop‑sign handoff until a mobile signer lands (seam built in).

> **Validation gate:** lock this design? Any tweaks to palette/density, dark‑vs‑light default, the tab taxonomy, or the Home composition? On your ✅, **Step #3** delivers the phased AAA implementation plan (guardrails + foundation first), the per‑route checklist, and the review cadence — for your final go before any code.

---

# Part 4 — AAA Implementation Plan (Step #3)

> **For agentic workers:** REQUIRED SUB‑SKILL — use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement task‑by‑task. Steps use checkbox (`- [ ]`) syntax. Phases 2–7 are intentionally scoped at the deliverable level and are each **expanded into their own detailed TDD sub‑plan at phase start** (so the code is grounded in the then‑current source), per the "one plan per subsystem" rule. Phase 0 and Phase 1 are fully detailed here because execution starts with them.

**Goal:** Add an AAA, installable, "Vault × Pulse" mobile UI/UX to Memba on the *same shared React code*, with full browse parity and **zero changes to the desktop experience**.

**Architecture:** A `useIsMobile()` viewport primitive lets the app *restructure* (not just reflow) for phones. The layout root branches to `<MobileShell>` vs the unchanged `<DesktopShell>`; pages render inside either. All new CSS is mobile‑scoped; a single nav manifest feeds both chromes; write actions route through a `WalletAdapter` to a desktop‑sign handoff. A guardrail net (mobile + desktop‑intact E2E, visual‑regression, bundle gate) lands **before** any UI change so desktop can't silently regress.

**Tech Stack:** React 19.2 · Vite 7.3 · React Router 7.14 · TS ~6.0 · TanStack Query v5 · vanilla CSS + `.k-*` tokens · Vitest 4 + @testing-library + fast-check + msw · Playwright 1.59 (+ @axe-core) · **add** `vite-plugin-pwa` (Workbox); optionally `@use-gesture/react` (~5KB) for sheet drag.

## Global Constraints (every task inherits these — copied from §3.5)
- **Desktop render path is byte‑for‑byte unchanged** unless a change is *explicitly* desktop‑scoped and reviewed. No rewriting shared component internals — only additive mobile wrappers/variants behind `useIsMobile()`.
- **All new CSS lives inside `@media (max-width: 768px)` / container queries / mobile‑only classes.** No edits to desktop‑applied selectors except *additive* tokens.
- **One audited `useIsMobile()`** (SSR‑safe default = desktop). Lint‑ban raw `window.innerWidth` in render (allowlist: `JitsiPiPOverlay` drag math).
- TDD, frequent commits, DRY, YAGNI. Each task ends green + committed.
- **Git:** work on a feature branch off the mobile base; PR per phase; **no merge without explicit user approval**; commit messages = concise *why* only, **no Claude attribution / no generator footer**; `cd` into the worktree before `git commit` (the pre‑commit hook checks the cwd branch).
- **Env:** `frontend/` is a standalone npm project with `envDir: '..'` — run `cd frontend && npm ci`; `.env*` live at repo root.
- Keep the prod safety gate intact: never set `VITE_ENABLE_NFT/SERVICES/TREASURY_SPEND/AGENT_CREDITS` true in prod.

## Working agreement & review cadence (the "frequent deep reviews")
- **Per task:** TDD (failing test → minimal impl → green → commit) + a `code-reviewer` subagent pass before the task is considered done.
- **Per phase:** open a PR; run a **multi‑lens deep review** (design fidelity vs the §3 spec · mobile‑UX · desktop‑regression · perf/bundle · a11y · security on any wallet/handoff change); the **desktop‑intact E2E + visual‑regression suites must be green**; then **your approval** to merge. No exceptions on the desktop‑intact gate.
- **Phase boundary = a checkpoint you sign off.** We do not start phase N+1 until phase N is merged and verified on a deploy‑preview.

## Phase roadmap
| Phase | Objective | Key deliverables | Exit criteria (all + desktop‑intact green) |
|---|---|---|---|
| **0 — Guardrails** | Make desktop regressions impossible to merge silently | Mobile Playwright projects; desktop‑intact assertions; visual‑regression baselines; bundle‑size gate; npm/CI scripts | Suites run in CI; desktop baselines captured; a deliberate desktop break fails CI |
| **1 — Foundation** | The additive primitives everything builds on | `useIsMobile`; nav manifest; **PWA (installable)**; `PageHeader`/`StickyActionBar`; blend tokens (additive) | App installable (Lighthouse PWA pass); hooks/tokens tested; desktop unchanged (visual‑reg + spec green) |
| **2 — MobileShell** | The phone chrome | `<MobileShell>` (header+body+nav) behind `useIsMobile`; bottom tab bar (Home·Explore·⊕·Orgs·Activity) + center Act sheet; swipe‑dismiss BottomSheet; command‑palette touch entry | Mobile nav E2E green; DesktopShell untouched |
| **3 — Home** | The Vault × Pulse hero | Stack card · "needs you" · GovDAO gold spotlight · live feed · your orgs | Home parity + design fidelity; reuses existing data hooks |
| **4 — Per‑route waves** | Browse parity for all archetypes | lists→cards · data→metric+cards (validators, tokens) · detail headers · write→sticky action + `WalletAdapter`/`SignHandoff` | Per‑route tracker all ✅; no desktop diff |
| **5 — Motion & delight** | Native feel | View‑Transitions · universal `:active`/tap‑highlight · success micro‑moments · list entrance · reduced‑motion | Motion audit pass; reduced‑motion verified |
| **6 — Light mode + correctness** | First‑class light + mobile correctness | co‑designed light tokens · `100dvh` · safe‑area all edges · `inputmode`/`enterkeyhint` · font preload · chunk splits · polling backoff | Light parity; Lighthouse mobile perf/a11y budgets met |
| **7 — Hardening & launch** | Ship | Full mobile E2E parity sweep · Lighthouse PWA/installability · cross‑device QA · ship via existing Netlify path | All green; deploy‑preview verified on real devices |

---

## Phase 0 — Guardrails (detailed)

### Task 0.0: Environment
- [ ] **Step 1:** Create the implementation branch off the mobile base.
```bash
cd /Users/zxxma/Desktop/Code/Gno/memba-mobile && git switch -c feat/mobile-phase-0-guardrails
```
- [ ] **Step 2:** Install frontend deps (standalone npm project).
```bash
cd /Users/zxxma/Desktop/Code/Gno/memba-mobile/frontend && npm ci
```
- [ ] **Step 3:** Sanity‑check the baseline is green before touching anything.
```bash
npm run test && npm run build
```
Expected: vitest passes; `vite build` succeeds (safe‑flags gate not triggered locally).

### Task 0.1: Split desktop vs mobile Playwright projects
**Files:** Modify `frontend/playwright.config.ts:21-30`
- [ ] **Step 1:** Replace the `projects` array so desktop projects ignore mobile specs and two device projects run only `*.mobile.spec.ts`:
```ts
projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /\.mobile\.spec\.ts$/ },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] }, testIgnore: /\.mobile\.spec\.ts$/ },
    { name: 'iphone',   use: { ...devices['iPhone 13'] },  testMatch: /\.mobile\.spec\.ts$/ },
    { name: 'pixel',    use: { ...devices['Pixel 5'] },    testMatch: /\.mobile\.spec\.ts$/ },
],
```
- [ ] **Step 2:** Add a mobile smoke spec `frontend/e2e/mobile/shell.mobile.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
test('mobile shows the bottom tab bar and hides the sidebar', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
    await expect(page.locator('.k-sidebar')).toBeHidden()
})
```
- [ ] **Step 3:** Run mobile + desktop projects, verify both pass.
```bash
npx playwright test --project=iphone --project=chromium e2e/mobile e2e/smoke.spec.ts
```
- [ ] **Step 4:** Commit. `git add -A && git commit -m "test(mobile): add iPhone/Pixel Playwright projects + shell smoke"`

### Task 0.2: Lock the desktop layout (the anti‑regression spec)
**Files:** Create `frontend/e2e/desktop-layout.spec.ts`
- [ ] **Step 1 (failing test):**
```ts
import { test, expect } from '@playwright/test'
test('desktop keeps the sidebar and never shows the mobile tab bar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await expect(page.locator('.k-sidebar')).toBeVisible()
    await expect(page.getByTestId('mobile-tabbar')).toBeHidden()
})
```
- [ ] **Step 2:** Run on desktop projects — expect PASS today (it's the invariant we're protecting).
```bash
npx playwright test --project=chromium e2e/desktop-layout.spec.ts
```
- [ ] **Step 3:** Commit. `git commit -am "test(desktop): assert sidebar-present / tab-bar-absent invariant"`

### Task 0.3: Visual‑regression baselines (desktop + mobile)
**Files:** Create `frontend/e2e/visual.spec.ts` (desktop) + `frontend/e2e/mobile/visual.mobile.spec.ts`
- [ ] **Step 1:** Desktop visual spec over key routes:
```ts
import { test, expect } from '@playwright/test'
for (const path of ['/', '/test13/dao', '/test13/validators', '/test13/directory']) {
    test(`desktop visual ${path}`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 })
        await page.goto(path)
        await expect(page).toHaveScreenshot({ fullPage: true, maxDiffPixelRatio: 0.01 })
    })
}
```
- [ ] **Step 2:** Mobile counterpart in `visual.mobile.spec.ts` (same routes, no setViewportSize — device project sets it).
- [ ] **Step 3:** Generate baselines, then re‑run to confirm clean.
```bash
npx playwright test e2e/visual.spec.ts e2e/mobile/visual.mobile.spec.ts --update-snapshots
npx playwright test e2e/visual.spec.ts e2e/mobile/visual.mobile.spec.ts
```
- [ ] **Step 4:** Commit specs + baseline PNGs. `git add -A && git commit -m "test(visual): baseline desktop+mobile snapshots for key routes"`

### Task 0.4: Bundle‑size gate
**Files:** Create `frontend/scripts/check-bundle-size.mjs`; modify `frontend/package.json` scripts
- [ ] **Step 1:** Script that fails if any JS chunk exceeds the 600 KB budget already referenced in `vite.config.ts`:
```js
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const DIR = 'dist/assets', LIMIT = 600 * 1024
const offenders = readdirSync(DIR).filter(f => f.endsWith('.js'))
    .map(f => [f, statSync(join(DIR, f)).size]).filter(([, s]) => s > LIMIT)
if (offenders.length) { console.error('Bundle over budget:', offenders); process.exit(1) }
console.log('Bundle size OK')
```
- [ ] **Step 2:** Add scripts to `package.json`:
```json
"check:bundle": "node scripts/check-bundle-size.mjs",
"test:e2e": "playwright test"
```
- [ ] **Step 3:** Verify. `npm run build && npm run check:bundle` → "Bundle size OK".
- [ ] **Step 4:** Commit. `git commit -am "ci(perf): add 600KB per-chunk bundle-size gate"`

### Task 0.5: Wire guardrails into CI
**Files:** Modify the existing GitHub Actions CI workflow under `.github/workflows/` (confirm filename at execution — likely `ci.yml`)
- [ ] **Step 1:** Add steps to the existing test job: `npx playwright install --with-deps`, `npm run test:e2e`, `npm run build && npm run check:bundle`. Keep desktop projects mandatory.
- [ ] **Step 2:** Confirm the workflow runs all four Playwright projects and the bundle gate on PRs.
- [ ] **Step 3:** Commit. `git commit -am "ci: run mobile+desktop E2E, visual-regression and bundle gate on PRs"`
- [ ] **PR + phase review gate.** Open the Phase 0 PR; confirm a deliberately‑broken desktop layout fails CI (then revert the probe); get approval; merge.

> **Note (CI):** the repo's `CI` job is currently red on `main` for an unrelated reason (Part 0.3). Resolve/triage that first so Phase 0's green signal is trustworthy.

---

## Phase 1 — Foundation primitives (detailed)
Branch: `feat/mobile-phase-1-foundation`.

### Task 1.1: `useIsMobile()` viewport hook
**Files:** Create `frontend/src/hooks/useIsMobile.ts` + `frontend/src/hooks/useIsMobile.test.ts`
**Produces:** `useIsMobile(): boolean` (true ≤768px; SSR/no‑matchMedia default = `false` = desktop).
- [ ] **Step 1 (failing test):**
```ts
import { renderHook } from '@testing-library/react'
import { useIsMobile } from './useIsMobile'
function mockMatch(matches: boolean) {
    window.matchMedia = (q: string) => ({ matches, media: q, onchange: null,
        addEventListener: () => {}, removeEventListener: () => {},
        addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList
}
test('returns false on desktop widths', () => { mockMatch(false); expect(renderHook(() => useIsMobile()).result.current).toBe(false) })
test('returns true on mobile widths', () => { mockMatch(true); expect(renderHook(() => useIsMobile()).result.current).toBe(true) })
```
- [ ] **Step 2:** Run → fails (module missing). `npx vitest run src/hooks/useIsMobile.test.ts`
- [ ] **Step 3 (impl, modeled on `themeStore.ts`'s matchMedia pattern):**
```ts
import { useState, useEffect } from 'react'
const QUERY = '(max-width: 768px)'
export function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState(() =>
        typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches)
    useEffect(() => {
        if (!window.matchMedia) return
        const mql = window.matchMedia(QUERY)
        const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
        mql.addEventListener('change', onChange)
        setIsMobile(mql.matches)
        return () => mql.removeEventListener('change', onChange)
    }, [])
    return isMobile
}
```
- [ ] **Step 4:** Run → pass. **Step 5:** add an ESLint `no-restricted-properties` rule banning `window.innerWidth` in render (allowlist `JitsiPiPOverlay.tsx`). **Step 6:** Commit `feat(mobile): add SSR-safe useIsMobile viewport hook + lint guard`.

### Task 1.2: Single nav manifest (kills mobile/desktop drift, audit M7)
**Files:** Create `frontend/src/lib/navManifest.ts` + test; later consumed by `Sidebar.tsx` & the new tab bar.
**Produces:** `NAV: NavEntry[]` where `NavEntry = { id, to, label, Icon, group: 'primary'|'manage'|'account', showOn: 'both'|'mobile'|'desktop', requiresAuth?: boolean }`.
- [ ] **Step 1 (failing test):** assert every route reachable on desktop has a manifest entry, and primary mobile tabs ⊆ manifest.
- [ ] **Step 2–3:** implement the manifest from the route tree in `App.tsx`; **Step 4:** refactor `Sidebar.tsx` to render from `NAV` (desktop output identical — guarded by Phase 0.2/0.3). **Step 5:** run desktop visual‑reg → must be unchanged. **Step 6:** Commit `refactor(nav): single nav manifest as the source of truth for sidebar + mobile`.

### Task 1.3: PWA — make Memba installable (audit H1/F1/F2)
**Files:** Modify `frontend/vite.config.ts` (add plugin), `frontend/index.html` (iOS metas + per‑scheme theme‑color), add `frontend/public/icons/{icon-192,icon-512,maskable-512}.png`
- [ ] **Step 1:** `cd frontend && npm i -D vite-plugin-pwa` (pin to current major).
- [ ] **Step 2:** Add to `vite.config.ts` plugins (after `react()`):
```ts
import { VitePWA } from 'vite-plugin-pwa'
// ...
VitePWA({
    registerType: 'autoUpdate',
    devOptions: { enabled: false }, // never register the SW in dev
    includeAssets: ['apple-touch-icon.png', 'fonts/*.woff2'],
    manifest: {
        name: 'Memba', short_name: 'Memba', id: '/', start_url: '/', scope: '/',
        display: 'standalone', background_color: '#0B0D10', theme_color: '#0B0D10',
        description: 'Run your DAO. Own your stack.',
        icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
    },
    workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,woff2}'],
        runtimeCaching: [
            { urlPattern: /\/fonts\//, handler: 'CacheFirst', options: { cacheName: 'fonts' } },
            // NEVER cache auth/tx or RPC writes:
            { urlPattern: ({ url }) => url.pathname.startsWith('/memba.v1.'), handler: 'NetworkOnly' },
        ],
    },
}),
```
- [ ] **Step 3:** In `index.html`, add `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, two `theme-color` metas (`media="(prefers-color-scheme: dark|light)"`), and (optional) iOS splash links. Generate the icon set (resize the oversized 414 KB icons noted in audit F13).
- [ ] **Step 4:** Verify the CSP already permits the SW (`worker-src 'self' blob:` present in `index.html` — it is) and manifest (`default-src 'self'`). Build and check `dist/manifest.webmanifest` + `dist/sw.js` exist.
```bash
npm run build && ls dist/manifest.webmanifest dist/sw.js
```
- [ ] **Step 5:** Lighthouse PWA audit on `npm run preview` → installable pass. **Step 6:** Confirm desktop visual‑reg unchanged (SW disabled in dev = no effect on the dev/test path). **Step 7:** Commit `feat(pwa): installable manifest + Workbox SW (no-cache on auth/tx)`.

### Task 1.4: `PageHeader` + `StickyActionBar` primitives (audit C2/C3)
**Files:** Create `frontend/src/components/mobile/PageHeader.tsx`, `StickyActionBar.tsx` + CSS (mobile‑scoped) + tests
**Produces:** `<PageHeader title back={parentPath} />` (hierarchical back, always points at the logical parent), `<StickyActionBar>` (thumb‑zone, safe‑area‑inset bottom).
- [ ] TDD each: render test (title shows; back navigates to `parentPath`, not `history(-1)`); CSS strictly under `@media (max-width:768px)`. Commit `feat(mobile): PageHeader + StickyActionBar primitives`.

### Task 1.5: Blend design tokens (additive only — audit H4/H5/M4/L1)
**Files:** Modify `frontend/src/tokens.css` (ADD new tokens; do not change existing values), create `frontend/src/mobile-tokens.css` (mobile‑scoped application)
- [ ] **Step 1:** Add the §3.1 tokens additively: `--mb-canvas #0B0D10`, `--mb-surface`, `--mb-card`, `--mb-gold #E8B339`, `--mb-violet #8B7CFF`, elevation ramp (revive `--shadow-*`), and a real mobile type scale. **Do not** alter tokens already consumed by desktop.
- [ ] **Step 2:** In `mobile-tokens.css`, apply the lifted type scale / mono‑reservation **only inside `@media (max-width:768px)`**.
- [ ] **Step 3:** Desktop visual‑reg must be unchanged (proves additivity). **Step 4:** Commit `feat(mobile): add Vault×Pulse design tokens (additive, mobile-scoped)`.
- [ ] **PR + phase review gate** (design‑fidelity + desktop‑intact + Lighthouse PWA).

---

## Phases 2–7 — deliverables & exit criteria
*(Each is expanded into its own detailed TDD sub‑plan at phase start, grounded in the then‑current code. Summarised here for approval of the arc.)*

- **Phase 2 — MobileShell & nav.** `<MobileShell>` chosen at the layout root behind `useIsMobile()`; `DesktopShell` = today's Sidebar+TopBar untouched. Bottom tab bar from the manifest (Home·Explore·⊕·Orgs·Activity, You in header); center **Act** quick‑action sheet; upgrade `BottomSheet` with grabber + **swipe‑to‑dismiss** + mount‑on‑open; add a **touch entry** for the command palette. *Exit:* mobile nav E2E (tab switch, sheet open/dismiss, back‑stack) green; desktop diff zero.
- **Phase 3 — Home.** The §3.3 composition reusing existing data hooks (`useNetworkPulse`, the activity feed from #546, balances, saved DAOs, GovDAO). *Exit:* visitor + member home parity; design fidelity vs the mockup; no new network calls beyond existing hooks.
- **Phase 4 — Per‑route waves (parity).** Migrate by archetype using the tracker below; introduce `WalletAdapter` + `<SignHandoff>` for every write. Waves: (4a) browse lists → cards; (4b) data‑heavy → metric + ranked cards + tap‑to‑expand + virtualization for long lists; (4c) read‑detail → `PageHeader`; (4d) write/flow → `StickyActionBar` + handoff; (4e) multisig promoted. *Exit:* tracker all ✅; each wave its own PR + review.
- **Phase 5 — Motion & delight.** View‑Transitions on navigation; universal `:active` + `-webkit-tap-highlight-color`; success micro‑moments (+optional `navigator.vibrate`); list entrance; unify toasts above the tab bar; complete the `prefers-reduced-motion` block. *Exit:* motion audit pass; reduced‑motion verified.
- **Phase 6 — Light mode + correctness.** Co‑designed light tokens (no neon‑glow bleed); `100vh→100dvh`; safe‑area all four edges; `inputmode`/`enterkeyhint`/16px inputs; font preload; explicit `manualChunks` for `recharts`/`jspdf`/`remotion` + call‑time `import()`; visibility‑gated + cellular‑aware polling; broaden query persistence to safe read‑only keys. *Exit:* Lighthouse mobile perf + a11y budgets met; light parity.
- **Phase 7 — Hardening & launch.** Full mobile E2E parity sweep; @axe‑core a11y pass; Lighthouse PWA/installability; real‑device QA (iOS Safari standalone + Android Chrome/WebAPK); ship via the existing Netlify‑native path. *Exit:* all green on a deploy‑preview; your go‑live approval.

## Per‑route parity tracker (browse parity = day‑one; writes via handoff)
| Route(s) | Archetype | Mobile pattern | Write? | Phase |
|---|---|---|---|---|
| `/` | Home | Vault×Pulse hero | — | 3 |
| `/dashboard` | Control room | folds into Home/You | — | 3 |
| `/dao`, `/tokens`, `/directory`, `/marketplace`, `/services`, `/extensions`, `/organizations`, `/leaderboard`, `/quests`, `/nft` | Browse list | search/filter + card grid; virtualize | — | 4a |
| `/validators`(+`/hacker`), gnolove analytics | Data‑heavy | metric + ranked cards, tap‑to‑expand; "best on desktop" for hacker mode | — | 4b |
| `/dao/:slug`(+nested), `/tokens/:symbol`, `/validators/:address`, `/profile/:address`, `/nft/*`, `/quests/:id`, proposal view | Read detail | `PageHeader` (back→parent) + sections | — | 4c |
| `/create`, `/import`, `/create-token`, `/dao/create`, `/candidature`, `/propose`, vote, alerts actions | Write/flow | form/stepper + `StickyActionBar` → `SignHandoff` | ✅ | 4d |
| `/multisig`, `/multisig/:address`, `/tx/:id` | Multisig | promoted in nav; detail+action+handoff | ✅ | 4d/4e |
| `/settings`, `/feedback`, `/changelogs`, `/alerts` | Utility | list/settings rows; footer→About; sheets for theme/network | — | 4a |
| Jitsi PiP, command palette, onboarding wizard | Special | PiP docks; palette touch entry; wizard→sheet | — | 2/5 |

## Risk register & rollback
| Risk | Likelihood | Mitigation | Rollback |
|---|---|---|---|
| Service‑worker serves stale JS/auth across deploys | Med | Workbox `autoUpdate` + hashed precache + `NetworkOnly` on `/memba.v1.*`; dev SW off | Ship `self.skipWaiting` kill‑switch SW; unregister via versioned SW |
| A mobile CSS/JSX change shifts desktop | Med | Mobile‑scoped CSS; `useIsMobile` branch; **desktop‑intact + visual‑reg gates** | Revert the PR; gates catch it pre‑merge |
| Bundle bloat from PWA/shell on cellular | Low‑Med | Bundle gate (0.4) + explicit chunks (Ph6) | Gate blocks merge |
| Wallet handoff confuses users (can't sign on phone) | Med | Clear "keys stay on desktop" framing + QR/secure link; adapter seam for a future mobile signer | Copy‑only fallback link |
| `100dvh`/safe‑area changes affect desktop | Low | Mobile‑scoped; desktop uses unchanged rules | Revert token/CSS commit |

## Self-review (against the §3 spec)
- **Coverage:** every audit Critical/High maps to a phase — C1 wallet→handoff (Ph4d) + adapter seam; C2 back‑nav→`PageHeader` (1.4/4c); C3 actions→`StickyActionBar` (1.4/4d); H1 PWA (1.3); H2 data→cards (4b); H3 "More"→tab+manifest (1.2/2); H4 type (1.5); H5 mono (1.5); H7 motion (5); M1 100dvh / M3 safe‑area / M2 inputmode (6); M6 palette touch (2); M7 manifest (1.2); M9 chunks/persistence (6); L1 light (6); L2 wordmark (1.5/3).
- **No placeholders** in Phase 0/1 (real code/config/commands). Phases 2–7 are deliberately deliverable‑scoped sub‑plans (per the writing‑plans subsystem rule), each detailed at phase start.
- **Type consistency:** `useIsMobile(): boolean`, `NavEntry`, `<PageHeader title back/>`, `<StickyActionBar>`, `WalletAdapter`/`<SignHandoff>` are used consistently across tasks.

> **Your go gate:** approve this plan (or adjust the phase order / scope), and I'll start **Phase 0** on `feat/mobile-phase-0-guardrails` via subagent‑driven development — guardrails first, one reviewed PR per phase, nothing merged without your sign‑off.
