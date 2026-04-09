/**
 * BoardHeader — Navigation header for channel views.
 *
 * Extracted from BoardView.tsx (v2.9 decomposition).
 * Shows back button, channel icon, channel name, and type indicators.
 *
 * @module plugins/board/BoardHeader
 */

import type { BoardChannel } from "./parser"
import { channelIcon } from "../../pages/channelHelpers"
import { ghostBtn } from "./boardHelpers"

interface BoardHeaderProps {
    channel: string
    channelInfo?: BoardChannel
    onBack: () => void
    /** Extra right-side element (e.g. "New Thread" button) */
    rightAction?: React.ReactNode
}

export function BoardHeader({ channel, channelInfo, onBack, rightAction }: BoardHeaderProps) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={onBack} style={ghostBtn} aria-label="Back to channels">
                    ←
                </button>
                {channelInfo && (
                    <span style={{ fontSize: 16 }}>{channelIcon(channelInfo)}</span>
                )}
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)", margin: 0 }}>
                    #{channel}
                </h3>
                {channelInfo?.type === "announcements" && (
                    <span style={{ fontSize: 10, color: "var(--color-warning)", fontFamily: "JetBrains Mono, monospace" }}>
                        Admin only
                    </span>
                )}
                {channelInfo?.type === "readonly" && (
                    <span style={{ fontSize: 10, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>
                        Read only
                    </span>
                )}
            </div>
            {rightAction}
        </div>
    )
}
