/**
 * useNotifications — React hook for the notification system.
 *
 * Expert recommendations applied:
 * - Page Visibility API: pauses polling when tab is hidden (saves battery/bandwidth)
 * - Interval-based polling: checks for new proposals every 30s
 * - State sync: re-reads localStorage on interval to pick up cross-tab updates
 * - Cleanup: clears interval on unmount
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

/** ABCI query to get proposal count for a DAO. */
async function getProposalCount(rpcUrl: string, daoPath: string): Promise<number> {
    try {
        const data = btoa(`${daoPath}\n__count__`)
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

export function useNotifications(daoPath: string, address: string | null) {
    const [notifications, setNotifications] = useState<Notification[]>([])
    const [unreadCount, setUnreadCount] = useState(0)
    const lastKnownCount = useRef<number | null>(null)
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

    // Poll for new proposals
    const pollForChanges = useCallback(async () => {
        if (!address || !daoPath || !isVisible.current) return

        try {
            const count = await getProposalCount(GNO_RPC_URL, daoPath)

            if (lastKnownCount.current !== null && count > lastKnownCount.current) {
                // New proposals detected
                const newCount = count - lastKnownCount.current
                for (let i = 0; i < Math.min(newCount, 5); i++) {
                    addNotification(address, {
                        type: "proposal_new",
                        title: "New Proposal",
                        body: `A new proposal has been created in the DAO`,
                        daoPath,
                        link: `/dao/${daoPath.split("/").pop()}/proposal/${count - i}`,
                    })
                }
                syncState()
            }

            lastKnownCount.current = count
        } catch {
            // Silently fail — polling is best-effort
        }
    }, [address, daoPath, syncState])

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
    useEffect(() => {
        syncState()
        pollForChanges()
        const interval = setInterval(() => {
            pollForChanges()
            syncState()
        }, POLL_INTERVAL_MS)
        return () => clearInterval(interval)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address, daoPath])

    return { notifications, unreadCount, markRead, markAllRead }
}
