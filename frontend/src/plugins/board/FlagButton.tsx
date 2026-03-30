/**
 * FlagButton — Flag a thread for moderation review.
 *
 * Calls FlagThread() on the channel realm. After FlagThreshold (3) flags
 * from unique users, the thread is auto-hidden on-chain.
 *
 * Phase 2 — G2: Per-DAO moderation layer.
 *
 * @module plugins/board/FlagButton
 */

import { useState } from "react"
import { doContractBroadcast } from "../../lib/grc20"

interface FlagButtonProps {
    boardPath: string
    channel: string
    threadId: number
    /** Whether the user is a DAO member (required to flag — anti-sybil). */
    isMember: boolean
    /** Whether the user's wallet is connected and authenticated. */
    isAuthenticated: boolean
    callerAddress: string
    onFlagged?: () => void
}

export function FlagButton({ boardPath, channel, threadId, isMember, isAuthenticated, callerAddress, onFlagged }: FlagButtonProps) {
    const [flagging, setFlagging] = useState(false)
    const [flagged, setFlagged] = useState(false)
    const [error, setError] = useState<string | null>(null)

    if (!isAuthenticated || !isMember) return null

    const handleFlag = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (flagging || flagged) return

        const confirmed = window.confirm(
            "Flag this thread for moderation?\n\nAfter 3 flags from different members, the thread will be automatically hidden."
        )
        if (!confirmed) return

        setFlagging(true)
        setError(null)
        try {
            const msg = {
                type: "/vm.m_call",
                value: {
                    caller: callerAddress,
                    send: "",
                    pkg_path: boardPath,
                    func: "FlagThread",
                    args: [channel, String(threadId)],
                },
            }
            await doContractBroadcast([msg], "Flag thread for moderation")
            setFlagged(true)
            onFlagged?.()
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to flag"
            if (msg.includes("already flagged")) {
                setFlagged(true)
            } else {
                setError(msg)
            }
        } finally {
            setFlagging(false)
        }
    }

    return (
        <button
            className={`flag-button${flagged ? " flagged" : ""}`}
            onClick={handleFlag}
            disabled={flagging || flagged}
            title={flagged ? "You flagged this thread" : "Flag for moderation"}
            aria-label="Flag thread"
        >
            {flagging ? "…" : flagged ? "🚩" : "⚑"}
            {error && <span className="flag-button__error">{error}</span>}
        </button>
    )
}
