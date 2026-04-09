/**
 * useChannelPolling — Real-time polling for channel messages (v2.5b).
 *
 * Follows the established pattern from useNotifications.ts:
 * - 10s interval for channel content polling
 * - Page Visibility API: pauses when tab is hidden
 * - Typing guard: pauses when user is composing
 * - In-flight guard: no concurrent ABCI queries
 * - Clean interval cleanup on unmount
 *
 * @module hooks/useChannelPolling
 */

import { useState, useEffect, useCallback, useRef } from "react"
import {
    getBoardThreads,
    getBoardThread,
    type BoardThread,
    type BoardThreadDetail,
} from "../plugins/board/parser"
import { GNO_RPC_URL } from "../lib/config"

/** Polling interval — 10 seconds (matches v2.5b spec). */
export const POLL_INTERVAL_MS = 10_000

export interface UseChannelPollingOptions {
    /** Detected board/channel realm path (e.g., "gno.land/r/gov/dao_channels"). */
    boardPath: string
    /** Current channel name (e.g., "general"). */
    channel: string
    /** Current thread ID being viewed (null = channel list view). */
    threadId: number | null
    /** Set to false to pause polling (e.g., while user is typing). */
    enabled: boolean
}

/** Number of consecutive poll failures before signaling connection lost. */
const CONNECTION_LOST_THRESHOLD = 3

export interface UseChannelPollingResult {
    /** Current thread list for the active channel. */
    threads: BoardThread[]
    /** Current thread detail (when viewing a thread). */
    threadDetail: BoardThreadDetail | null
    /** True when new content was detected since last user interaction. */
    hasNewContent: boolean
    /** Dismiss the "new messages" indicator and accept current content. */
    dismissNew: () => void
    /** True on initial load only. */
    loading: boolean
    /** Error message from the last fetch, or null. */
    error: string | null
    /** True when N consecutive poll failures have occurred (connection may be lost). */
    connectionLost: boolean
    /** Force an immediate refetch. */
    refresh: () => void
}

export function useChannelPolling({
    boardPath,
    channel,
    threadId,
    enabled,
}: UseChannelPollingOptions): UseChannelPollingResult {
    const [threads, setThreads] = useState<BoardThread[]>([])
    const [threadDetail, setThreadDetail] = useState<BoardThreadDetail | null>(null)
    const [hasNewContent, setHasNewContent] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [connectionLost, setConnectionLost] = useState(false)

    // Refs for polling control
    const isVisible = useRef(true)
    const isFetching = useRef(false)
    const prevCounts = useRef<{ threads: number; replies: number }>({ threads: 0, replies: 0 })
    const isInitialLoad = useRef(true)
    const consecutiveFailures = useRef(0)
    // C2 fix: store volatile props in refs to prevent stale closures in interval
    const channelRef = useRef(channel)
    const threadIdRef = useRef(threadId)
    useEffect(() => { channelRef.current = channel }, [channel])
    useEffect(() => { threadIdRef.current = threadId }, [threadId])

    // ── Page Visibility API ───────────────────────────────────
    useEffect(() => {
        const handleVisibility = () => {
            isVisible.current = document.visibilityState === "visible"
        }
        document.addEventListener("visibilitychange", handleVisibility)
        return () => document.removeEventListener("visibilitychange", handleVisibility)
    }, [])

    // ── Fetch logic ───────────────────────────────────────────
    const fetchData = useCallback(async (isFirstLoad = false) => {
        if (isFetching.current) return
        isFetching.current = true

        // C2 fix: read from refs to always get latest values (not stale closure)
        const currentChannel = channelRef.current
        const currentThreadId = threadIdRef.current

        if (isFirstLoad) {
            setLoading(true)
            setError(null)
        }

        try {
            if (currentThreadId !== null) {
                // Thread detail view — poll for new replies
                const detail = await getBoardThread(GNO_RPC_URL, boardPath, currentChannel, currentThreadId)
                const newReplyCount = detail?.replies?.length || 0
                const prevReplyCount = prevCounts.current.replies

                if (!isFirstLoad && newReplyCount > prevReplyCount) {
                    setHasNewContent(true)
                }

                prevCounts.current.replies = newReplyCount
                setThreadDetail(detail)
            } else {
                // Channel list view — poll for new threads
                const threadList = await getBoardThreads(GNO_RPC_URL, boardPath, currentChannel)
                const newThreadCount = threadList.length
                const prevThreadCount = prevCounts.current.threads

                if (!isFirstLoad && newThreadCount > prevThreadCount) {
                    setHasNewContent(true)
                }

                prevCounts.current.threads = newThreadCount
                setThreads(threadList)
            }

            setError(null)
            // Reset failure counter on success
            if (consecutiveFailures.current > 0) {
                consecutiveFailures.current = 0
                setConnectionLost(false)
            }
        } catch {
            if (isFirstLoad) {
                setError(currentThreadId !== null ? "Failed to load thread" : "Failed to load threads")
            } else {
                consecutiveFailures.current++
                if (consecutiveFailures.current >= CONNECTION_LOST_THRESHOLD) {
                    setConnectionLost(true)
                }
            }
        } finally {
            if (isFirstLoad) setLoading(false)
            isFetching.current = false
        }
        // C2 fix: deps reduced to boardPath only — channel/threadId read from refs
    }, [boardPath])

    // ── Initial fetch on channel/thread change ────────────────
    useEffect(() => {
        isInitialLoad.current = true
        prevCounts.current = { threads: 0, replies: 0 }
        consecutiveFailures.current = 0
        setHasNewContent(false)
        setConnectionLost(false)
        setThreads([])
        setThreadDetail(null)
        // C1 fix: skip initial fetch when not enabled (home view)
        if (!enabled) {
            setLoading(false)
            return
        }
        fetchData(true).then(() => {
            isInitialLoad.current = false
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boardPath, channel, threadId, enabled])

    // ── Polling interval ──────────────────────────────────────
    useEffect(() => {
        const interval = setInterval(() => {
            if (!isVisible.current || !enabled || isInitialLoad.current) return
            fetchData(false)
        }, POLL_INTERVAL_MS)
        return () => clearInterval(interval)
    }, [fetchData, enabled])

    // ── Public API ────────────────────────────────────────────
    const dismissNew = useCallback(() => {
        setHasNewContent(false)
    }, [])

    const refresh = useCallback(() => {
        fetchData(true)
    }, [fetchData])

    return {
        threads,
        threadDetail,
        hasNewContent,
        dismissNew,
        loading,
        error,
        connectionLost,
        refresh,
    }
}
