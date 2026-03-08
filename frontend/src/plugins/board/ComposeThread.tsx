/**
 * ComposeThread — New thread creation form.
 *
 * Extracted from BoardView.tsx (v2.9 decomposition).
 *
 * @module plugins/board/ComposeThread
 */

import { inputStyle, primaryBtn, ghostBtn } from "./boardHelpers"

interface ComposeThreadProps {
    channel: string
    title: string
    body: string
    onTitleChange: (title: string) => void
    onBodyChange: (body: string) => void
    onSubmit: () => void
    onCancel: () => void
    posting: boolean
    error?: string | null
}

export function ComposeThread({
    channel,
    title,
    body,
    onTitleChange,
    onBodyChange,
    onSubmit,
    onCancel,
    posting,
    error,
}: ComposeThreadProps) {
    return (
        <div id="board-new-thread" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={onCancel} style={ghostBtn} aria-label="Back to channel">
                    ←
                </button>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>
                    New Thread in #{channel}
                </h3>
            </div>

            {error && <div style={{ color: "#ff3b30", fontSize: 12 }}>{error}</div>}

            <input
                id="board-thread-title"
                type="text"
                placeholder="Thread title..."
                value={title}
                onChange={e => onTitleChange(e.target.value)}
                maxLength={128}
                style={inputStyle}
            />
            <div style={{ position: "relative" }}>
                <textarea
                    id="board-thread-body"
                    placeholder="Write your post (Markdown supported, use @g1... to mention)..."
                    value={body}
                    onChange={e => onBodyChange(e.target.value)}
                    maxLength={8192}
                    rows={8}
                    style={{ ...inputStyle, resize: "vertical", minHeight: 120 }}
                />
                <span style={{
                    position: "absolute",
                    bottom: 8,
                    right: 10,
                    fontSize: 10,
                    color: body.length > 7500 ? "#ff3b30" : "#444",
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    {body.length}/8192
                </span>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
                <button
                    id="board-submit-thread"
                    onClick={onSubmit}
                    disabled={posting || !title.trim() || !body.trim()}
                    style={{ ...primaryBtn, opacity: posting ? 0.5 : 1 }}
                >
                    {posting ? "Posting..." : "Create Thread"}
                </button>
                <button onClick={onCancel} style={ghostBtn}>
                    Cancel
                </button>
            </div>
        </div>
    )
}
