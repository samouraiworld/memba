# v2.5b — Real-time UX

> **Status**: 📋 PLANNED
> **Branch**: `feat/v2.5a/channel-pages` (continues on same branch)
> **Parent milestone**: v2.5 — Channels & Comms

## Goal

Add real-time message polling to the channel page so users see new threads and replies without manual refresh. Follows established patterns from `useNotifications.ts` (30s polling + Page Visibility API).

## Acceptance Criteria

1. ✅ Channel view auto-polls for new threads every 10s
2. ✅ Thread detail view auto-polls for new replies every 10s
3. ✅ "New messages" toast appears when new content detected while scrolled up
4. ✅ Polling pauses when tab is hidden (Page Visibility API)
5. ✅ Polling pauses when user is composing a message (typing guard)
6. ✅ No duplicate fetches (skip if previous fetch in-flight)
7. ✅ Unit tests for polling hook (≥ 90% coverage)
8. ✅ All quality gates pass (tsc 0, lint 0, build < 500KB)

## Non-Goals

- WebSocket real-time (Gno doesn't support it — polling is the correct pattern)
- Push notifications (browser Notification API — deferred to v3.x)
- Audio/video channels (v2.5c)

## Dependencies

- `useNotifications.ts` — reference polling pattern
- `BoardView.tsx` — existing data loading callbacks
- `parser.ts` — `getBoardThreads()`, `getBoardThread()`

## Estimated Effort

~1 hour (single hook + toast integration)
