/**
 * useNotifications.test.ts — W4 react-hooks/set-state-in-effect refactor coverage.
 *
 * Pins the behavior of the refactored site (the polling effect's synchronous
 * syncState() call):
 * - The initial localStorage sync moved to lazy useState initializers, and the
 *   address-change re-sync uses the React docs "adjust state during render"
 *   pattern (prev-key guard). The sync lands one render EARLIER than before —
 *   the old address's notifications are never rendered for the new address,
 *   which is strictly better.
 * - The polling effect keeps pollForChanges() (its setStates all happen after
 *   awaits) and the 30s interval — behavior unchanged.
 *
 * Verifies:
 *   1. notifications synced from storage on the very first render
 *   2. null address → empty state
 *   3. address change → synchronous re-sync (old address's data never shown)
 *   4. poll detects a proposal-count increase → proposal_new notification
 *   5. poll detects an open→passed transition (throttled 3rd cycle) → proposal_passed
 *   6. markAllRead calls through to the lib and re-syncs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import type { Notification } from "../lib/notifications"
import type { DAOProposal } from "../lib/dao"
import type { DAOMetadata } from "../lib/daoMetadata"

vi.mock("../lib/notifications", () => ({
    getNotifications: vi.fn(),
    addNotification: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    getUnreadCount: vi.fn(),
}))
vi.mock("../lib/config", () => ({ GNO_RPC_URL: "http://rpc.test" }))
vi.mock("../lib/dao/shared", () => ({ queryRender: vi.fn() }))
vi.mock("../lib/daoMetadata", () => ({ parseDAORender: vi.fn() }))
vi.mock("../lib/daoSlug", () => ({ encodeSlug: vi.fn(() => "samourai-dao") }))
vi.mock("../lib/dao", () => ({ getDAOProposals: vi.fn() }))

import {
    getNotifications,
    addNotification,
    markAllRead as markAllReadFn,
    getUnreadCount,
} from "../lib/notifications"
import { queryRender } from "../lib/dao/shared"
import { parseDAORender } from "../lib/daoMetadata"
import { getDAOProposals } from "../lib/dao"
import { useNotifications } from "./useNotifications"

const ADDR_A = "g1addressaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const ADDR_B = "g1addressbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const DAO = "gno.land/r/samcrew/memba_dao"
const POLL_INTERVAL_MS = 30_000

const notif = (id: string, over: Partial<Notification> = {}): Notification => ({
    id,
    type: "proposal_new",
    title: `Notif ${id}`,
    body: "body",
    daoPath: DAO,
    link: "/dao/samourai-dao/proposal/1",
    timestamp: 1,
    read: false,
    ...over,
})

const meta = (proposalCount: number) => ({ proposalCount }) as DAOMetadata

const proposal = (id: number, status: DAOProposal["status"]): DAOProposal => ({
    id,
    title: `Proposal ${id}`,
    description: "",
    category: "governance",
    status,
    author: "@zxxma",
    authorProfile: "",
    tiers: ["T1"],
    yesPercent: 0,
    noPercent: 0,
    yesVotes: 0,
    noVotes: 0,
} as DAOProposal)

/** Flush pollForChanges' promise chain (and fire due fake timers). */
const flushAsync = (ms = 0) => act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    for (let i = 0; i < 8; i++) await Promise.resolve()
})

describe("useNotifications", () => {
    beforeEach(() => {
        vi.mocked(getNotifications).mockReset().mockReturnValue([])
        vi.mocked(getUnreadCount).mockReset().mockReturnValue(0)
        vi.mocked(addNotification).mockReset()
        vi.mocked(markAllReadFn).mockReset()
        vi.mocked(queryRender).mockReset().mockResolvedValue("raw render")
        vi.mocked(parseDAORender).mockReset().mockReturnValue(meta(0))
        vi.mocked(getDAOProposals).mockReset().mockResolvedValue([])
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it("syncs notifications from storage on the very first render (no effect wait)", () => {
        vi.mocked(getNotifications).mockReturnValue([notif("a"), notif("b")])
        vi.mocked(getUnreadCount).mockReturnValue(2)

        const { result } = renderHook(() => useNotifications([], ADDR_A))

        // Lazy init — previously an effect populated this after a first empty render
        expect(result.current.notifications.map(n => n.id)).toEqual(["a", "b"])
        expect(result.current.unreadCount).toBe(2)
        expect(vi.mocked(getNotifications)).toHaveBeenCalledWith(ADDR_A)
    })

    it("returns the empty state when disconnected (null address)", () => {
        const { result } = renderHook(() => useNotifications([], null))
        expect(result.current.notifications).toEqual([])
        expect(result.current.unreadCount).toBe(0)
        expect(vi.mocked(getNotifications)).not.toHaveBeenCalled()
    })

    it("re-syncs synchronously on address change (old address's data never shown)", () => {
        vi.mocked(getNotifications).mockImplementation((addr: string) =>
            addr === ADDR_A ? [notif("a")] : [notif("b1"), notif("b2")])
        vi.mocked(getUnreadCount).mockImplementation((addr: string) =>
            addr === ADDR_A ? 1 : 2)

        const { result, rerender } = renderHook(
            ({ address }: { address: string | null }) => useNotifications([], address),
            { initialProps: { address: ADDR_A as string | null } },
        )
        expect(result.current.notifications.map(n => n.id)).toEqual(["a"])

        rerender({ address: ADDR_B })

        // During-render re-sync: the very first committed render for the new
        // address must not show ADDR_A's notifications (one render earlier
        // than the previous effect-based sync — strictly better).
        expect(result.current.notifications.map(n => n.id)).toEqual(["b1", "b2"])
        expect(result.current.unreadCount).toBe(2)

        rerender({ address: null })
        expect(result.current.notifications).toEqual([])
        expect(result.current.unreadCount).toBe(0)
    })

    it("creates a proposal_new notification when the poll sees a higher proposal count", async () => {
        vi.useFakeTimers()
        // Baseline poll (mount): 1 proposal. Next poll: 2 proposals.
        vi.mocked(parseDAORender)
            .mockReturnValueOnce(meta(1))
            .mockReturnValue(meta(2))

        const { result } = renderHook(() => useNotifications([DAO], ADDR_A))
        await flushAsync()
        // Baseline cycle records the count without notifying
        expect(vi.mocked(addNotification)).not.toHaveBeenCalled()

        const syncsBefore = vi.mocked(getNotifications).mock.calls.length
        await flushAsync(POLL_INTERVAL_MS)

        expect(vi.mocked(addNotification)).toHaveBeenCalledWith(ADDR_A, expect.objectContaining({
            type: "proposal_new",
            title: "New Proposal #2",
            daoPath: DAO,
            link: "/dao/samourai-dao/proposal/2",
        }))
        // New notifications trigger a re-sync from storage
        expect(vi.mocked(getNotifications).mock.calls.length).toBeGreaterThan(syncsBefore)
        expect(result.current.notifications).toBeDefined()
    })

    it("creates a proposal_passed notification on an open→passed transition (3rd-cycle throttle)", async () => {
        vi.useFakeTimers()
        vi.mocked(parseDAORender).mockReturnValue(meta(1))
        // Cycle 0 (mount) fetches proposals: open. Cycles 1-2 skip (throttle).
        // Cycle 3 (90s) fetches again: passed.
        vi.mocked(getDAOProposals)
            .mockResolvedValueOnce([proposal(1, "open")])
            .mockResolvedValue([proposal(1, "passed")])

        renderHook(() => useNotifications([DAO], ADDR_A))
        await flushAsync()
        expect(vi.mocked(getDAOProposals)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(addNotification)).not.toHaveBeenCalled()

        // Cycles 1 and 2: throttled — no proposal fetch, no notification
        await flushAsync(POLL_INTERVAL_MS)
        await flushAsync(POLL_INTERVAL_MS)
        expect(vi.mocked(getDAOProposals)).toHaveBeenCalledTimes(1)

        // Cycle 3: proposals re-fetched, transition detected
        await flushAsync(POLL_INTERVAL_MS)
        expect(vi.mocked(getDAOProposals)).toHaveBeenCalledTimes(2)
        expect(vi.mocked(addNotification)).toHaveBeenCalledWith(ADDR_A, expect.objectContaining({
            type: "proposal_passed",
            title: "Proposal #1 Passed",
            daoPath: DAO,
        }))
    })

    it("markAllRead calls through to the lib and re-syncs state", () => {
        vi.mocked(getNotifications).mockReturnValue([notif("a", { read: true })])
        const { result } = renderHook(() => useNotifications([], ADDR_A))

        act(() => { result.current.markAllRead() })

        expect(vi.mocked(markAllReadFn)).toHaveBeenCalledWith(ADDR_A)
        expect(result.current.notifications[0].read).toBe(true)
    })
})
