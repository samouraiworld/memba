# v2.5 Handoff — Channels & Comms

> Branch: `feat/v2.5a/channel-pages`
> Status: ✅ COMPLETE (all 3 sub-milestones)
> PR: Pending → `dev/v2`

## What Was Done

### v2.5a — Channel Pages (3 files, 11 tests)
- **`pages/ChannelsPage.tsx`** (230 LOC) — standalone `/dao/:slug/channels` route
  - Sidebar + content layout, breadcrumb navigation, mobile toggle (<768px)
  - BoardView in headless mode (hideChannelList + initialChannel + onChannelChange)
  - Loading skeletons, empty states ("No Channels Deployed")
- **`pages/channelHelpers.ts`** (26 LOC) — `channelIcon()` and `defaultChannel()` shared helpers
- **`pages/channels.css`** (267 LOC) — glassmorphism layout, responsive sidebar

### v2.5b — Real-time UX (2 files, 3 tests)
- **`hooks/useChannelPolling.ts`** (186 LOC) — 10s interval polling for channel threads
  - Page Visibility API pause, typing guard, in-flight dedup, enabled flag
  - Ref-based channel/threadId to prevent stale closures (C2 fix)
- **`components/ui/NewMessagesToast.tsx`** (73 LOC) — "New messages" toast with auto-dismiss

### v2.5c — Audio/Video (3 files, 5 tests)
- **`components/ui/JitsiMeet.tsx`** (160 LOC) — Jitsi Meet iframe embed
  - "Join Room" gate (no auto-join), "Leave Room" overlay
  - Sandbox + referrerPolicy hardening
- **`components/ui/jitsiHelpers.ts`** (18 LOC) — `jitsiRoomName()` deterministic room names
- Extended `ChannelType` with `"voice"` | `"video"`, parser regex, channelIcon (🔊/🎥)

### Modified Files
- **`BoardView.tsx`** — integrated polling hook, Jitsi branch for voice/video, slug prop
- **`parser.ts`** — regex extended with 🔊|🎥 type indicators
- **`channelTemplate.ts`** — `ChannelType` union extended
- **`DAOHome.tsx`** — "Channels" card added

### Audit Fixes (2 rounds, 13 findings resolved)
- Round 1: C1 (initial fetch guard), C2 (refs), C3 (onDismiss ref), I1 (formError), C4 (memoize), M3 (dedup icon)
- Round 2: G1 (parser regex 🔊|🎥), P4 (skip polling voice/video), U1 (sidebar "Join" badge), U3 (fadeIn keyframe), T1 (parser tests), A3 (cosmetic)

## What's NOT Done (Next Agent)

1. **A2** — Lift `boardInfo` to shared context (avoids double fetch in ChannelsPage + BoardView)
2. **T2** — Hook behavior tests for `useChannelPolling` (needs React test harness)
3. **T3** — E2E tests for channels page (needs deployed channel realm)
4. **S1** — JWT-based Jitsi auth for private channels (v4.0)
5. **Self-hosted Jitsi** — currently uses `meet.jit.si` public instance (v4.0)

## Quality Gates

| Check | Result |
|-------|--------|
| tsc --noEmit | 0 errors |
| lint | 0 errors |
| Unit tests | 687 (32 files) |
| E2E tests | 119 (5 spec files) |
| Build | 450KB (129KB gzip) |

## Dependencies
- No new npm packages
- Jitsi Meet: `meet.jit.si` public instance (free, no API key)
- Existing: `channelTemplate.ts`, `parser.ts`, `BoardView.tsx`
