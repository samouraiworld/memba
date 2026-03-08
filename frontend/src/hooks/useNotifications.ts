/**
 * useNotifications — React hook for the notification system.
 *
 * Expert recommendations applied:
 * - Page Visibility API: pauses polling when tab is hidden (saves battery/bandwidth)
 * - Interval-based polling: checks for new proposals every 30s
 * - State sync: re-reads localStorage on interval to pick up cross-tab updates
 * - Cleanup: clears interval on unmount
 *
 * v2.1b Phase 2: Multi-DAO polling — accepts array of DAO paths,
 * iterates over saved DAOs (max 5 per cycle, matching voteScanner cap).
 * C3 fix: daoPath is now optional — when null, only cross-tab sync runs.
 * I1 fix: ABCI query documented as best-effort; returns 0 on unknown render format.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import {
    getNotifications,
    addNotification,
    markRead as markReadFn,
    markAllRead as markAllReadFn,
    getUnreadCount,
    type Notification,
} from "../lib/notifications"
import { GNO_RPC_URL } from "../lib/config"

const POLL_INTERVAL_MS = 30_000 // 30 seconds
const MAX_DAOS_PER_POLL = 5      // Performance cap (matches voteScanner pattern)

/**
 * ABCI query to get proposal count for a DAO.
 *
 * I1 note: This queries Render("") and tries to extract a count from the
 * markdown output. Works for DAOs that include "N proposal(s)" in their
 * Render output. Returns 0 for DAOs with different format — this is by
 * design (best-effort).
 */
async function getProposalCount(rpcUrl: string, daoPath: string): Promise<number> {
    try {
        const data = btoa(`${daoPath}\n`)
        const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0", id: 1, method: "abci_query",
                params: { path: "vm/qrender", data },
            }),
        })
        const json = await res.json()
        const responseData = json?.result?.response?.ResponseBase?.Data
        if (!responseData) return 0
        const rendered = atob(responseData)
        // Try to extract proposal count from Render output
        const match = rendered.match(/(\d+)\s+proposal/i)
        return match ? parseInt(match[1], 10) : 0
    } catch {
        return 0
    }
}

/**
 * useNotifications — poll for new proposals and manage notification state.
 *
 * @param daoPaths - DAO realm paths to poll (empty array = sync-only)
 * @param address - Wallet address (null = disconnected, empty state)
 */
export function useNotifications(daoPaths: string[], address: string | null) {
    const [notifications, setNotifications] = useState<Notification[]>([])
    const [unreadCount, setUnreadCount] = useState(0)
    const lastKnownCounts = useRef<Map<string, number>>(new Map())
    const isVisible = useRef(true)

    // Sync state from localStorage
    const syncState = useCallback(() => {
        if (!address) {
            setNotifications([])
            setUnreadCount(0)
            return
        }
        setNotifications(getNotifications(address))
        setUnreadCount(getUnreadCount(address))
    }, [address])

    // Poll multiple DAOs for new proposals
    const pollForChanges = useCallback(async () => {
        if (!address || daoPaths.length === 0 || !isVisible.current) return

        // Cap at MAX_DAOS_PER_POLL to avoid RPC abuse
        const pathsToCheck = daoPaths.slice(0, MAX_DAOS_PER_POLL)
        let hasNewNotifications = false

        for (const daoPath of pathsToCheck) {
            try {
                const count = await getProposalCount(GNO_RPC_URL, daoPath)
                const lastCount = lastKnownCounts.current.get(daoPath)

                if (lastCount !== undefined && count > lastCount) {
                    // New proposals detected for this DAO
                    const newCount = count - lastCount
                    const slug = daoPath.split("/").pop() || daoPath
                    for (let i = 0; i < Math.min(newCount, 5); i++) {
                        const proposalNumber = count - i
                        addNotification(address, {
                            type: "proposal_new",
                            title: `New Proposal #${proposalNumber}`,
                            body: `A new proposal has been created in ${slug}`,
                            daoPath,
                            link: `/dao/${slug}/proposal/${proposalNumber}`,
                        })
                    }
                    hasNewNotifications = true
                }

                lastKnownCounts.current.set(daoPath, count)
            } catch {
                // Silently fail — polling is best-effort
            }
        }

        if (hasNewNotifications) syncState()
    }, [address, daoPaths, syncState])

    // Mark single notification as read
    const markRead = useCallback((id: string) => {
        if (!address) return
        markReadFn(address, id)
        syncState()
    }, [address, syncState])

    // Mark all as read
    const markAllRead = useCallback(() => {
        if (!address) return
        markAllReadFn(address)
        syncState()
    }, [address, syncState])

    // Page Visibility API: pause polling when tab is hidden
    useEffect(() => {
        const handleVisibility = () => {
            isVisible.current = document.visibilityState === "visible"
        }
        document.addEventListener("visibilitychange", handleVisibility)
        return () => document.removeEventListener("visibilitychange", handleVisibility)
    }, [])

    // Initial sync + polling interval
    // I4 fix: visibility check in interval callback itself
    useEffect(() => {
        syncState()
        pollForChanges()
        const interval = setInterval(() => {
            if (!isVisible.current) return // I4: skip entirely when hidden
            pollForChanges()
            syncState()
        }, POLL_INTERVAL_MS)
        return () => clearInterval(interval)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address, daoPaths.length])

    return { notifications, unreadCount, markRead, markAllRead }
}
