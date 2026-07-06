# SPIKE — Memba Explorer (gnoweb-like universal realm viewer)

**Date:** 2026-07-06 · **Box:** 2d · **Status:** ✅ COMPLETE — **verdict: GO** (P0 viewer), with one scoped caveat (live `qeval` console → separate decision) · **Owner action to start:** none (build / no funds / ordinary flag) · **Program ref:** `MEMBA_ROADMAP_COMPOUND_2026-07.md` §4.2, Wave 9.

## Question
Can Memba ship a read-only, in-app **universal realm viewer** — browse any realm's live Render, Source, and exported Functions — safely (read-only allowlist, no execution surface) and fast enough (median render < 2s on test13), reusing the existing substrate rather than a new subsystem?

## Thresholds (from the roadmap spike table)
- **GO:** `qfile`/`qfuncs` proxy extension works read-only; median render < 2s on test13.
- **KILL:** the proxy allowlist can't stay read-only-safe, **or** source parsing needs per-realm hacks.

## Findings (measured on test13, `rpc.test13.testnets.gno.land`)

### 1. Latency — GO met, with a heavy-realm tail
| Query | Realm | Latency |
|---|---|---|
| `vm/qrender` | `memba_feed_v1` (×3) | 405 / 455 / 548 ms (median ~455 ms) |
| `vm/qfile` (listing) | `memba_feed_v1` | 686 ms |
| `vm/qfuncs` | `memba_feed_v1` | 388 ms |
| `vm/qrender` | `r/gnops/valopers` (large table) | **2 839 ms** |

Median render is **sub-second** — comfortably under the 2s GO threshold. The **tail is real**: a heavy paginated realm (valopers) renders in ~2.8s. **Mitigation already in-house:** the marketplace proxies run a 60s server-side TTL cache (`render_proxy.go`); applying the same cache to the explorer render path makes repeat views instant and bounds the p99. Not a blocker — a build detail.

### 2. `vm/qfuncs` works — the one new piece
Returns structured signatures, e.g. for `memba_feed_v1`:
```json
[{"FuncName":"PauseRealm","Params":[{"Name":"cur","Type":"..."}, ...]}, ...]
```
So the **Functions tab** (exported functions + parameter names/types) is a pure read, no new machinery.

### 3. Read-only safety — safe by construction, with ONE caveat
- `vm/qrender`, `vm/qfile`, `vm/qfuncs` are **all read-only** ABCI queries. The proxy allowlist stays trivially read-only-safe — **KILL condition not triggered.**
- **Caveat (the honest tension with §4.2):** the §4.2 sketch also describes a "call-builder / read console" that runs **`vm/qeval`**. But `HandleEvalProxy` / `/api/eval` was **removed in v6 (SEC-01)** — it allowed arbitrary `qeval` on any realm. Re-adding *any* `qeval` path, even "pure reads," reopens that surface (there is no cheap on-chain guarantee a given exported function is side-effect-free from the proxy's vantage). **Recommendation: P0 ships the three safe queries only; a live `qeval` read-console is a separate, explicitly-gated decision — not part of the GO.**

### 4. Substrate already exists (~70%) — this is an assembly, not a subsystem
- **Source:** `frontend/src/lib/gnowebSource.ts` already fetches source via `vm/qfile` (authoritative, CORS-safe, cached) and **parses it generically — no per-realm hacks** (the other KILL condition is not triggered). Used today by the Directory's `RealmDetailDrawer` / `SourceCodeView`.
- **Render:** `backend/.../render_proxy.go HandleRenderProxy` (`/api/render`) already proxies `vm/qrender`, rate-limited, read-only.
- **Realm discovery:** the Directory already lists realms — reuse it; the explorer is a viewer over the same list, not a new index.
- **New work is small:** extend the render-proxy allowlist to `vm/qfuncs` (a reviewed, read-only-only change) + a `/gno/*` catch-all route with Render/Source/Functions tabs.

## Verdict: **GO** for the P0 viewer
Both GO conditions are met (qfile/qfuncs read-only work; median render < 2s) and neither KILL condition triggers (allowlist stays read-only; source parsing is already generic). It's a ~1-week assembly of proven pieces, behind an ordinary flag, moving no funds — the lowest-risk build of the four Wave-9 spikes, and it doubles as the App Store's "read the contract before you use it" trust surface.

### Recommended build shape (refines §4.2 with the data)
1. **P0 — Universal viewer `/gno/*`** (3–4d): catch-all route → **Render** (existing `/api/render`), **Source** (generalize `gnowebSource.ts` + `SourceCodeView`), **Functions** (`vm/qfuncs` signatures, read-only). Dark mode, mobile, deep links; every realm-path string in the app becomes a link. Flag `VITE_ENABLE_EXPLORER` (ordinary, no funds).
2. **Render cache** for the heavy-realm tail: apply the marketplace proxy's 60s TTL pattern to the explorer render path (kills the valopers-class 2.8s p99).
3. **DEFER — live `qeval` read-console:** valuable for realm devs, but it reopens the SEC-01 surface. Treat as a separate decision (a strictly-scoped read-only qeval proxy with guards, or lean on play.gno.land). **Not** in the GO.
4. **NO-BUILD — sandboxed gno runner:** unchanged from §4.2. A jailed gnovm executor is 2–3 ops-heavy weeks competing with the free, maintained `play.gno.land`. "Run this ↗" hands off to play.gno.land with the code pre-filled.

### Owner decisions
- **None required to start P0** (build, no funds, ordinary flag) — this is a session-buildable Wave-9 item while Wave 8 stays owner-gated (U-1/U-3).
- **One decision when P0 lands:** whether to pursue the deferred `qeval` read-console (reopens SEC-01 surface) or keep the viewer read-only-by-construction.

## How this was measured
`gnokey query vm/{qrender,qfile,qfuncs} --data <path> -remote https://rpc.test13.testnets.gno.land:443`, wall-clock timed, 2026-07-06. `qeval` removal confirmed at `render_proxy.go:234` (`HandleEvalProxy … removed in v6 (SEC-01)`).
