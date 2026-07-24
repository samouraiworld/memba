/**
 * useContractEvents — Chain-agnostic event listener hook.
 *
 * Listens to EVM contract events via viem's watchContractEvent and
 * normalizes them into a chain-agnostic notification stream.
 *
 * For Gno, events are polled via the tx-indexer (no native event subscription).
 *
 * @module lib/chain/events
 */

import { useState, useCallback } from "react"
import type { ChainFamily } from "./types"

// ── Event Types ──────────────────────────────────────────────

export interface ChainEvent {
    /** Event name (e.g., "ProposalCreated", "Transfer"). */
    name: string
    /** Contract address that emitted the event. */
    source: string
    /** Chain family. */
    family: ChainFamily
    /** Block number. */
    blockNumber: number
    /** Transaction hash. */
    txHash: string
    /** Decoded event arguments. */
    args: Record<string, unknown>
    /** Timestamp (if available). */
    timestamp?: number
}

export type EventFilter = {
    /** Contract address to watch. */
    address: string
    /** Event names to filter (empty = all). */
    eventNames?: string[]
}

// ── Notification Store ───────────────────────────────────────

export interface NotificationItem {
    id: string
    type: "info" | "success" | "warning" | "error"
    title: string
    message: string
    txHash?: string
    explorerUrl?: string
    timestamp: number
    read: boolean
    /** Auto-dismiss after ms (0 = sticky). */
    autoDismissMs: number
}

const MAX_NOTIFICATIONS = 50

/**
 * Hook for managing a notification queue.
 * Notifications can come from tx lifecycle, contract events, or manual pushes.
 */
export function useNotifications() {
    const [notifications, setNotifications] = useState<NotificationItem[]>([])

    const push = useCallback((notification: Omit<NotificationItem, "id" | "timestamp" | "read">) => {
        const item: NotificationItem = {
            ...notification,
            id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: Date.now(),
            read: false,
        }
        setNotifications(prev => [item, ...prev].slice(0, MAX_NOTIFICATIONS))
        return item.id
    }, [])

    const dismiss = useCallback((id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id))
    }, [])

    const markRead = useCallback((id: string) => {
        setNotifications(prev =>
            prev.map(n => n.id === id ? { ...n, read: true } : n),
        )
    }, [])

    const markAllRead = useCallback(() => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    }, [])

    const clearAll = useCallback(() => {
        setNotifications([])
    }, [])

    const unreadCount = notifications.filter(n => !n.read).length

    return {
        notifications,
        unreadCount,
        push,
        dismiss,
        markRead,
        markAllRead,
        clearAll,
    }
}

// ── Event-to-Notification mapping ────────────────────────────

/** Map known contract events to user-friendly notifications. */
export function eventToNotification(
    event: ChainEvent,
    explorerBaseUrl?: string,
): Omit<NotificationItem, "id" | "timestamp" | "read"> {
    const explorerUrl = explorerBaseUrl
        ? `${explorerBaseUrl}/tx/${event.txHash}`
        : undefined

    // Map well-known events to readable titles
    const eventMap: Record<string, { title: string; type: NotificationItem["type"] }> = {
        ProposalCreated: { title: "New Proposal", type: "info" },
        Voted: { title: "Vote Cast", type: "success" },
        ProposalExecuted: { title: "Proposal Executed", type: "success" },
        MemberAdded: { title: "New Member", type: "info" },
        MemberRemoved: { title: "Member Removed", type: "warning" },
        TokenCreated: { title: "Token Created", type: "success" },
        Transfer: { title: "Transfer", type: "info" },
        ContractCreated: { title: "Escrow Created", type: "info" },
        MilestoneFunded: { title: "Milestone Funded", type: "success" },
        FundsReleased: { title: "Funds Released", type: "success" },
        ReviewPosted: { title: "New Review", type: "info" },
        BadgeMinted: { title: "Badge Earned", type: "success" },
        QuestCompleted: { title: "Quest Completed", type: "success" },
        PointsAwarded: { title: "Points Awarded", type: "success" },
    }

    const mapped = eventMap[event.name]
    const title = mapped?.title ?? event.name
    const type = mapped?.type ?? "info"

    return {
        type,
        title,
        message: `${event.name} on block ${event.blockNumber}`,
        txHash: event.txHash,
        explorerUrl,
        autoDismissMs: type === "error" ? 0 : 8000,
    }
}
