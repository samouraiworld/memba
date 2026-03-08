# v2.5c — Audio/Video Channels

> **Status**: 📋 PLANNED
> **Branch**: `feat/v2.5a/channel-pages` (continues on same branch)
> **Parent milestone**: v2.5 — Channels & Comms

## Goal

Add voice and video channel types that embed Jitsi Meet rooms. Users join a shared Jitsi room scoped to the DAO + channel — no accounts, no installs, just click and talk.

## Acceptance Criteria

1. ✅ `ChannelType` extended with `"voice"` and `"video"`
2. ✅ Channel icons: 🔊 voice, 🎥 video
3. ✅ `JitsiMeet` component renders Jitsi iframe (meet.jit.si public instance)
4. ✅ Room name derived from DAO slug + channel name (deterministic, scoped)
5. ✅ BoardView renders Jitsi iframe instead of thread list for voice/video channels
6. ✅ "Join Room" button with clear UX (not auto-join)
7. ✅ ChannelsPage sidebar correctly renders new channel types
8. ✅ Unit tests for channel icon mapping + room name generation
9. ✅ All quality gates pass

## Non-Goals

- Self-hosted Jitsi (deferred to v4.0 — requires VPS setup)
- End-to-end encryption (Jitsi handles its own E2E via Oilseed)
- On-chain voice channels (not possible with Gno's model)

## Dependencies

- `meet.jit.si` public instance (free, no API key)
- `channelTemplate.ts` — `ChannelType` union
- `channelHelpers.ts` — `channelIcon()` icon mapping
- `parser.ts` — `BoardChannel` type alias

## Estimated Effort

~30 minutes (type extension + Jitsi iframe component + BoardView integration)
