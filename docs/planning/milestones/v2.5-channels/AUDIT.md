# v2.5 Audit — Channels & Comms

> Branch: `feat/v2.5a/channel-pages`
> 2 rounds, 6 perspectives, 13 findings resolved

## Round 1 — Initial Deep Review (7 findings)

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| C1 | 🔴 Must-fix | Initial fetch fires without `enabled` guard | Guard with `if (!enabled) return` |
| C2 | 🔴 Must-fix | Stale channel/threadId closures in interval | Refs + useEffect sync |
| C3 | 🟡 Should-fix | Stale onDismiss in setTimeout | onDismissRef + useEffect |
| I1 | 🟡 Should-fix | formError persists across navigation | Clear in `navigateTo()` |
| C4 | 🟡 Should-fix | Inline `.filter()` per render | Precompute activeChannelCount |
| M3 | 🔵 Note | Duplicate channelTypeIcon | Import shared `channelIcon` |
| — | 🔧 Cleanup | Unused `BoardChannel` import | Removed |

## Round 2 — Cross-Perspective Audit (6 findings)

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| G1 | 🔴 Must-fix | Parser regex `(📢\|🔒)?` missed 🔊/🎥 | Extended to `(📢\|🔒\|🔊\|🎥)?` |
| P4 | 🟡 Should-fix | Polling runs for voice/video channels | Skip with `isVoiceOrVideoChannel` |
| U1 | 🟡 Should-fix | threadCount shown for voice/video | Show "Join" badge instead |
| U3 | 🟡 Should-fix | `fadeIn` keyframe not in scope | Changed to `fade-in` (global) |
| T1 | 🟡 Should-fix | No parser tests for 🔊/🎥 | Added 3 tests (voice, video, mixed) |
| A3 | 🔵 Cosmetic | Blank lines in JitsiMeet.tsx | Cleaned |

## Deferred

| ID | Reason |
|----|--------|
| A2 | boardInfo double fetch — minor perf, refactor in v3.0 |
| T2 | Hook behavior tests — needs React test harness |
| T3 | E2E for channels page — needs deployed realm |
| S1 | Jitsi JWT auth — private channels in v4.0 |
