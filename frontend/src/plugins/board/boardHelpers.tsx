/**
 * boardHelpers — Shared utilities for BoardView sub-components.
 *
 * Extracted from BoardView.tsx (v2.9 decomposition):
 * - renderMarkdown: Lightweight inline Markdown renderer
 * - getLastVisited / markVisited: Unread thread tracking via localStorage
 *
 * @module plugins/board/boardHelpers
 */

import React from "react"

// ── UX-L1: Lightweight inline Markdown renderer ──────────────

/** Render basic Markdown: **bold**, *italic*, `code`, [links](url), @mentions */
export function renderMarkdown(text: string): React.ReactNode[] {
    const parts: React.ReactNode[] = []
    const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|@g1[a-z0-9]{38})/g
    let lastIdx = 0
    let match: RegExpExecArray | null
    let key = 0
    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index))
        const token = match[0]
        if (token.startsWith("**")) {
            parts.push(<strong key={key++} style={{ color: "#f0f0f0" }}>{token.slice(2, -2)}</strong>)
        } else if (token.startsWith("*")) {
            parts.push(<em key={key++}>{token.slice(1, -1)}</em>)
        } else if (token.startsWith("`")) {
            parts.push(<code key={key++} style={{ padding: "1px 5px", borderRadius: 4, background: "rgba(255,255,255,0.06)", fontSize: 12 }}>{token.slice(1, -1)}</code>)
        } else if (token.startsWith("[")) {
            const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/)
            if (linkMatch) {
                parts.push(<a key={key++} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" style={{ color: "#00d4aa", textDecoration: "underline" }}>{linkMatch[1]}</a>)
            }
        } else if (token.startsWith("@g1")) {
            parts.push(
                <span key={key++} style={{
                    background: "rgba(0,212,170,0.12)",
                    color: "#00d4aa",
                    padding: "1px 4px",
                    borderRadius: 4,
                    fontSize: 12,
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    {token}
                </span>
            )
        }
        lastIdx = match.index + match[0].length
    }
    if (lastIdx < text.length) parts.push(text.slice(lastIdx))
    return parts
}

// ── DAO-L2: Unread thread tracking ───────────────────────────

const BOARD_VISITS_KEY = "memba_board_visits"

export function getLastVisited(channel: string, threadId: number): number {
    try {
        const data = JSON.parse(localStorage.getItem(BOARD_VISITS_KEY) || "{}")
        return data[`${channel}/${threadId}`] || 0
    } catch { return 0 }
}

export function markVisited(channel: string, threadId: number): void {
    try {
        const data = JSON.parse(localStorage.getItem(BOARD_VISITS_KEY) || "{}")
        data[`${channel}/${threadId}`] = Date.now()
        localStorage.setItem(BOARD_VISITS_KEY, JSON.stringify(data))
    } catch { /* quota */ }
}

// ── G3: Per-channel unread tracking ─────────────────────────

const CHANNEL_VISITS_KEY = "memba_channel_visits"

/** Get the timestamp of the last time the user viewed a channel. */
export function getChannelLastVisited(channel: string): number {
    try {
        const data = JSON.parse(localStorage.getItem(CHANNEL_VISITS_KEY) || "{}")
        return data[channel] || 0
    } catch { return 0 }
}

/** Mark a channel as visited right now. */
export function markChannelVisited(channel: string): void {
    try {
        const data = JSON.parse(localStorage.getItem(CHANNEL_VISITS_KEY) || "{}")
        data[channel] = Date.now()
        localStorage.setItem(CHANNEL_VISITS_KEY, JSON.stringify(data))
    } catch { /* quota */ }
}

/** Check if a channel has unread content based on thread count change. */
export function hasChannelUnread(channel: string, currentThreadCount: number): boolean {
    const lastVisit = getChannelLastVisited(channel)
    if (lastVisit === 0 && currentThreadCount > 0) return true // never visited
    // Store thread counts alongside visit timestamps
    try {
        const data = JSON.parse(localStorage.getItem(CHANNEL_VISITS_KEY) || "{}")
        const lastCount = data[`${channel}__count`] || 0
        return currentThreadCount > lastCount
    } catch { return false }
}

/** Update the stored thread count for a channel (called when visiting). */
export function updateChannelThreadCount(channel: string, count: number): void {
    try {
        const data = JSON.parse(localStorage.getItem(CHANNEL_VISITS_KEY) || "{}")
        data[`${channel}__count`] = count
        localStorage.setItem(CHANNEL_VISITS_KEY, JSON.stringify(data))
    } catch { /* quota */ }
}

// ── Shared Styles ────────────────────────────────────────────

export const cardStyle: React.CSSProperties = {
    padding: "16px 20px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)",
    cursor: "pointer",
    transition: "all 0.2s",
}

export const btnStyle: React.CSSProperties = {
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 12,
    fontWeight: 600,
}

export const primaryBtn: React.CSSProperties = {
    ...btnStyle,
    background: "linear-gradient(135deg, #00d4aa, #00b894)",
    color: "#000",
}

export const ghostBtn: React.CSSProperties = {
    ...btnStyle,
    background: "none",
    color: "#00d4aa",
    border: "1px solid rgba(0,212,170,0.2)",
}

export const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(0,0,0,0.3)",
    color: "#f0f0f0",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 13,
    boxSizing: "border-box",
}
