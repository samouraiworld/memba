/**
 * Unit tests for useChannelPolling hook (v2.5b).
 *
 * W4 react-hooks/set-state-in-effect refactor coverage:
 * - The context-change reset (threads/threadDetail/hasNewContent/connectionLost/
 *   error/loading) moved from the effect body to the React docs "adjust state
 *   during render" pattern (prev-key guard). The reset lands one render EARLIER
 *   than before — the old channel/thread's content is never rendered for the
 *   new context, which is strictly better.
 * - The initial fetch kickoff is deferred one microtask (queueMicrotask) so
 *   fetchData's setLoading/setError never run synchronously in the effect body.
 *   Externally identical: the fetch still starts before paint.
 * - loading now initializes to `enabled` directly (previously: initialized true,
 *   then the effect flipped it false when disabled — one stale render).
 *
 * Verifies:
 *   1. initial load (loading → threads populated)
 *   2. disabled → no fetch, loading false from the very first render
 *   3. channel change → synchronous reset (old channel's threads never shown), refetch
 *   4. thread view → threadDetail populated via getBoardThread
 *   5. polling detects new threads → hasNewContent (dismissable)
 *   6. three consecutive poll failures → connectionLost
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import type { BoardThread, BoardThreadDetail } from "../plugins/board/parser"

vi.mock("../plugins/board/parser", () => ({
    getBoardThreads: vi.fn(),
    getBoardThread: vi.fn(),
}))
vi.mock("../lib/config", () => ({ GNO_RPC_URL: "http://rpc.test" }))

import { getBoardThreads, getBoardThread } from "../plugins/board/parser"
import { useChannelPolling, POLL_INTERVAL_MS } from "./useChannelPolling"

const BOARD = "gno.land/r/gov/dao_channels"

const thread = (id: number, channel = "general"): BoardThread => ({
    id,
    channel,
    title: `Thread ${id}`,
    author: "g1abc...xyz",
    replyCount: 0,
    blockHeight: 100 + id,
})

const detail = (id: number, replies = 0): BoardThreadDetail => ({
    id,
    channel: "general",
    title: `Thread ${id}`,
    body: "body",
    author: "g1abcdef",
    blockHeight: 100 + id,
    edited: false,
    editedAt: 0,
    replies: Array.from({ length: replies }, (_, i) => ({
        author: "g1reply", body: `r${i}`, blockHeight: 200 + i, edited: false,
    })),
})

type Props = { channel: string; threadId: number | null; enabled: boolean }

const renderPolling = (initial: Partial<Props> = {}) =>
    renderHook(
        (props: Props) => useChannelPolling({ boardPath: BOARD, ...props }),
        { initialProps: { channel: "general", threadId: null, enabled: true, ...initial } },
    )

/** Flush the queueMicrotask kickoff + fetch promise chain under fake timers. */
const flushAsync = (ms = 0) => act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    // Drain the remaining microtask generations of the fetch chain
    for (let i = 0; i < 8; i++) await Promise.resolve()
})

describe("useChannelPolling constants", () => {
    it("POLL_INTERVAL_MS is 10 seconds", () => {
        expect(POLL_INTERVAL_MS).toBe(10_000)
    })

    it("POLL_INTERVAL_MS is a positive number", () => {
        expect(POLL_INTERVAL_MS).toBeGreaterThan(0)
    })

    it("POLL_INTERVAL_MS is less than notification polling (30s)", () => {
        // Channels should poll faster than notifications
        expect(POLL_INTERVAL_MS).toBeLessThan(30_000)
    })
})

describe("useChannelPolling", () => {
    beforeEach(() => {
        vi.mocked(getBoardThreads).mockReset()
        vi.mocked(getBoardThread).mockReset()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it("loads the channel thread list (loading → loaded)", async () => {
        vi.mocked(getBoardThreads).mockResolvedValue([thread(1), thread(2)])

        const { result } = renderPolling()
        expect(result.current.loading).toBe(true)

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.threads.map(t => t.id)).toEqual([1, 2])
        expect(result.current.error).toBeNull()
        expect(vi.mocked(getBoardThreads)).toHaveBeenCalledWith("http://rpc.test", BOARD, "general")
    })

    it("does not fetch when disabled, and loading is false from the first render", async () => {
        const { result } = renderPolling({ enabled: false })

        // Previously: first render loading=true, then the effect flipped it.
        // Now initialized directly from `enabled` — no stale loading render.
        expect(result.current.loading).toBe(false)

        await act(async () => { await Promise.resolve() })
        expect(vi.mocked(getBoardThreads)).not.toHaveBeenCalled()
    })

    it("resets synchronously on channel change (old channel's threads never shown), then refetches", async () => {
        vi.mocked(getBoardThreads).mockResolvedValue([thread(1), thread(2)])

        const { result, rerender } = renderPolling()
        await waitFor(() => expect(result.current.threads).toHaveLength(2))

        vi.mocked(getBoardThreads).mockResolvedValue([thread(9, "dev")])
        rerender({ channel: "dev", threadId: null, enabled: true })

        // During-render reset: the very first committed render for the new
        // channel must not show "general"'s threads (one render earlier than
        // the previous effect-based reset — strictly better).
        expect(result.current.threads).toEqual([])
        expect(result.current.threadDetail).toBeNull()
        expect(result.current.hasNewContent).toBe(false)
        expect(result.current.loading).toBe(true)

        await waitFor(() => expect(result.current.threads.map(t => t.id)).toEqual([9]))
        expect(vi.mocked(getBoardThreads)).toHaveBeenLastCalledWith("http://rpc.test", BOARD, "dev")
    })

    it("loads thread detail when viewing a thread", async () => {
        vi.mocked(getBoardThread).mockResolvedValue(detail(5, 2))

        const { result } = renderPolling({ threadId: 5 })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.threadDetail?.id).toBe(5)
        expect(result.current.threadDetail?.replies).toHaveLength(2)
        expect(vi.mocked(getBoardThread)).toHaveBeenCalledWith("http://rpc.test", BOARD, "general", 5)
        expect(vi.mocked(getBoardThreads)).not.toHaveBeenCalled()
    })

    it("flags hasNewContent when a poll finds more threads, dismissable via dismissNew", async () => {
        vi.useFakeTimers()
        vi.mocked(getBoardThreads).mockResolvedValue([thread(1), thread(2)])

        const { result } = renderPolling()
        await flushAsync()
        expect(result.current.threads).toHaveLength(2)
        expect(result.current.hasNewContent).toBe(false)

        vi.mocked(getBoardThreads).mockResolvedValue([thread(1), thread(2), thread(3)])
        await flushAsync(POLL_INTERVAL_MS)

        expect(result.current.threads).toHaveLength(3)
        expect(result.current.hasNewContent).toBe(true)
        // Background polls never re-enter loading
        expect(result.current.loading).toBe(false)

        act(() => { result.current.dismissNew() })
        expect(result.current.hasNewContent).toBe(false)
    })

    it("signals connectionLost after 3 consecutive poll failures, recovers on success", async () => {
        vi.useFakeTimers()
        vi.mocked(getBoardThreads).mockResolvedValue([thread(1)])

        const { result } = renderPolling()
        await flushAsync()
        expect(result.current.threads).toHaveLength(1)

        vi.mocked(getBoardThreads).mockRejectedValue(new Error("rpc down"))
        for (let i = 0; i < 3; i++) {
            await flushAsync(POLL_INTERVAL_MS)
        }
        expect(result.current.connectionLost).toBe(true)
        // Background failures never surface as the first-load error
        expect(result.current.error).toBeNull()

        vi.mocked(getBoardThreads).mockResolvedValue([thread(1)])
        await flushAsync(POLL_INTERVAL_MS)
        expect(result.current.connectionLost).toBe(false)
    })

    it("shows an error when the initial load fails", async () => {
        vi.mocked(getBoardThreads).mockRejectedValue(new Error("rpc down"))

        const { result } = renderPolling()
        await waitFor(() => expect(result.current.error).toBe("Failed to load threads"))
        expect(result.current.loading).toBe(false)
        expect(result.current.connectionLost).toBe(false)
    })
})
