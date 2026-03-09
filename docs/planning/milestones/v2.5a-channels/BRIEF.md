# v2.5a — Channel Pages

> **Status**: 📋 PLANNED
> **Branch**: `feat/v2.5a/channel-pages`
> **Parent milestone**: v2.5 — Channels & Comms

## Goal

Create a standalone full-page channel experience at `/dao/:slug/channels`. Currently, channels are embedded as a plugin tab inside DAOHome. This milestone promotes channels to a first-class page with a dedicated channel sidebar, DAO header, and deep-link support per channel.

## Acceptance Criteria

1. ✅ `/dao/:slug/channels` route renders a full-page channel experience
2. ✅ Left sidebar lists all channels with type icons, unread dots, active channel highlight
3. ✅ DAO header with name, realm path, back navigation
4. ✅ Channel content area reuses existing `BoardView.tsx` logic (threads, replies, forms)
5. ✅ Deep-link support: `/dao/:slug/channels/:channel` opens specific channel
6. ✅ "Channels" entry added to DAOHome extensions section
7. ✅ Unit tests for new helpers (≥ 90% coverage for new code)
8. ✅ E2E test for channel page navigation
9. ✅ All quality gates pass (tsc 0, lint 0, build < 500KB)
10. ✅ Mobile responsive (sidebar collapses on small screens)

## Non-Goals

- Real-time polling (v2.5b)
- Audio/video channels (v2.5c)
- New on-chain realm code (codegen unchanged)
- Plugin system changes

## Dependencies

- `BoardView.tsx` (622 LOC) — existing Discord-like UI
- `parser.ts` (314 LOC) — ABCI query + parse layer
- `channelTemplate.ts` (856 LOC) — realm codegen + MsgCall builders
- `board.css` — existing board styles

## Estimated Effort

1 session (~3-4 hours)
