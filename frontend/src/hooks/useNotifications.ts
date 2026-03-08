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
 *
 * Audit fixes:
 * - C2: daoPaths stored in useRef to avoid callback instability
 * - M1: parallel polling via Promise.allSettled (was sequential for...of)
 * - C3: daoPaths empty array = sync-only mode
 * - I1: ABCI query documented as best-effort
 * - I4: visibility check in interval callback itself
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
import { parseDAORender } from "../lib/daoMetadata"
import { queryRender } from "../lib/dao/shared"

const POLL_INTERVAL_MS = 30_000 // 30 seconds
const MAX_DAOS_PER_POLL = 5      // Performance cap (matches voteScanner pattern)

/**
 * Get proposal count for a DAO using the canonical queryRender + parseDAORender.
 *
 * C1 audit fix: was a duplicate ABCI implementation; now reuses the
 * shared query layer (inherits domain validation, error handling, etc.).
 */
async function getProposalCount(rpcUrl: string, daoPath: string): Promise<number> {
    try {
        const raw = await queryRender(rpcUrl, daoPath, "")
        const meta = parseDAORender(daoPath, raw)
        return meta.proposalCount
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
    // C2 fix: store daoPaths in ref to avoid callback/effect instability
    const daoPathsRef = useRef(daoPaths)
    daoPathsRef.current = daoPaths

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

    // M1 fix: poll multiple DAOs in parallel (was sequential for...of)
    const pollForChanges = useCallback(async () => {
        const paths = daoPathsRef.current
        if (!address || paths.length === 0 || !isVisible.current) return

        // Cap at MAX_DAOS_PER_POLL to avoid RPC abuse
        const pathsToCheck = paths.slice(0, MAX_DAOS_PER_POLL)
        let hasNewNotifications = false

        // M1: parallel polling via Promise.allSettled
        const results = await Promise.allSettled(
            pathsToCheck.map(async (daoPath) => {
                const count = await getProposalCount(GNO_RPC_URL, daoPath)
                return { daoPath, count }
            })
        )

        for (const result of results) {
            if (result.status !== "fulfilled") continue
            const { daoPath, count } = result.value
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
        }

        if (hasNewNotifications) syncState()
    }, [address, syncState])

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
        // C2 fix: no daoPaths dependency — ref is used inside pollForChanges
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address])

    // Get unread count for a specific DAO
    const getDAOUnreadCount = useCallback((daoPath: string): number => {
        if (!address) return 0
        return getNotifications(address).filter(n => n.daoPath === daoPath && !n.read).length
    }, [address])

    return { notifications, unreadCount, markRead, markAllRead, getDAOUnreadCount }
}
