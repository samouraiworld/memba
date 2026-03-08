/**
 * Channel page helpers (v2.5a).
 *
 * Extracted from ChannelsPage to satisfy react-refresh/only-export-components.
 * Shared between ChannelsPage.tsx and channels.test.ts.
 *
 * @module pages/channelHelpers
 */

import type { BoardChannel } from "../plugins/board/parser"

/** Channel type → icon mapping (mirrors BoardView.channelTypeIcon). */
export function channelIcon(ch: BoardChannel): string {
    if (ch.type === "announcements") return "📢"
    if (ch.type === "readonly") return "🔒"
    return "💬"
}

/** Pick default channel from a list — first non-archived channel. */
export function defaultChannel(channels: BoardChannel[]): string {
    const active = channels.filter(ch => !ch.archived)
    return active.length > 0 ? active[0].name : "general"
}
