# v2.5a — Channel Pages Implementation

> **Milestone**: v2.5a — Channel Pages
> **Branch**: `feat/v2.5a/channel-pages`

## New Files

| File | LOC | Purpose |
|------|-----|---------|
| `pages/ChannelsPage.tsx` | 223 | Full-page channel experience with sidebar, header, breadcrumb nav |
| `pages/channelHelpers.ts` | 24 | `channelIcon()` and `defaultChannel()` helpers |
| `pages/channels.css` | 200 | Layout (sidebar 220px + content), mobile responsive, empty/loading states |
| `pages/channels.test.ts` | 75 | 9 unit tests for helper functions |

## Modified Files

| File | Change |
|------|--------|
| `plugins/board/BoardView.tsx` | +3 optional props: `initialChannel`, `onChannelChange`, `hideChannelList` (headless mode) |
| `App.tsx` | +2 routes: `/dao/:slug/channels` and `/dao/:slug/channels/:channel` |
| `pages/DAOHome.tsx` | +Channels card (💬 icon, "Open →") before Treasury |

## Architecture

```
/dao/:slug/channels/:channel
    ┌─────────────────────────────────────────────┐
    │ Breadcrumb: DAOs › DaoName › Channels       │
    ├───────────────┬─────────────────────────────┤
    │ Sidebar (220) │ Content (flex-1)            │
    │ ┌───────────┐ │ ┌─────────────────────────┐ │
    │ │ 💬 general│ │ │ BoardView (headless)    │ │
    │ │ 📢 news   │ │ │ - Thread list           │ │
    │ │ 🔒 rules  │ │ │ - Thread detail         │ │
    │ └───────────┘ │ │ - New thread / reply     │ │
    │               │ └─────────────────────────┘ │
    └───────────────┴─────────────────────────────┘
```

- **ChannelsPage** owns the sidebar and header
- **BoardView** operates in headless mode (no internal channel list)
- Channel changes sync via `initialChannel` prop + `onChannelChange` callback
- URL updates on every channel navigation (`replace: true`)
- Mobile: sidebar collapses below 768px behind a burger toggle

## Data Flow

1. `ChannelsPage` extracts `slug` + `channel` from URL params
2. `detectChannelRealm()` tries `_channels` suffix, falls back to `_board`
3. `getBoardInfo()` populates sidebar channel list
4. `BoardView` receives `boardPath` + `initialChannel`, loads threads
5. Channel clicks → `handleChannelClick()` → URL update + BoardView re-render
