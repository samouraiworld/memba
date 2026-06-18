/**
 * useGnoloveHighlights.test.ts
 *
 * Verifies:
 *   1. top 3 contributors are sorted by score descending
 *   2. contributorCount equals the full users array length (5)
 *   3. loading is true while the query is in-flight
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"

// ── Module-level mock ─────────────────────────────────────────

vi.mock("../../lib/gnoloveApi", () => ({
    getContributors: vi.fn(),
}))

const apiMod = await import("../../lib/gnoloveApi")

// ── Wrapper ───────────────────────────────────────────────────

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

// ── Fixture — 5 users with varied scores ─────────────────────
// Expected top-3 order (by score desc): charlie(300) > bob(250) > eve(175)

const FIVE_USERS = [
    { login: "alice",   score: 120, avatarUrl: "https://github.com/alice.png"   },
    { login: "charlie", score: 300, avatarUrl: "https://github.com/charlie.png" },
    { login: "bob",     score: 250, avatarUrl: "https://github.com/bob.png"     },
    { login: "dave",    score:  80, avatarUrl: "https://github.com/dave.png"    },
    { login: "eve",     score: 175, avatarUrl: "https://github.com/eve.png"     },
]

// ── Tests ─────────────────────────────────────────────────────

describe("useGnoloveHighlights — top 3 by score", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("returns exactly 3 entries", async () => {
        vi.mocked(apiMod.getContributors).mockResolvedValue({
            users: FIVE_USERS,
            lastSyncedAt: null,
        })

        const { useGnoloveHighlights } = await import("./useGnoloveHighlights")
        const { result } = renderHook(() => useGnoloveHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.top).toHaveLength(3)
    })

    it("top[0] is charlie (highest score 300)", async () => {
        vi.mocked(apiMod.getContributors).mockResolvedValue({
            users: FIVE_USERS,
            lastSyncedAt: null,
        })

        const { useGnoloveHighlights } = await import("./useGnoloveHighlights")
        const { result } = renderHook(() => useGnoloveHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.top[0].login).toBe("charlie")
        expect(result.current.top[0].score).toBe(300)
    })

    it("top[1] is bob (score 250)", async () => {
        vi.mocked(apiMod.getContributors).mockResolvedValue({
            users: FIVE_USERS,
            lastSyncedAt: null,
        })

        const { useGnoloveHighlights } = await import("./useGnoloveHighlights")
        const { result } = renderHook(() => useGnoloveHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.top[1].login).toBe("bob")
        expect(result.current.top[1].score).toBe(250)
    })

    it("top[2] is eve (score 175)", async () => {
        vi.mocked(apiMod.getContributors).mockResolvedValue({
            users: FIVE_USERS,
            lastSyncedAt: null,
        })

        const { useGnoloveHighlights } = await import("./useGnoloveHighlights")
        const { result } = renderHook(() => useGnoloveHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.top[2].login).toBe("eve")
        expect(result.current.top[2].score).toBe(175)
    })

    it("alice and dave are excluded (not in top 3)", async () => {
        vi.mocked(apiMod.getContributors).mockResolvedValue({
            users: FIVE_USERS,
            lastSyncedAt: null,
        })

        const { useGnoloveHighlights } = await import("./useGnoloveHighlights")
        const { result } = renderHook(() => useGnoloveHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        const logins = result.current.top.map(u => u.login)
        expect(logins).not.toContain("alice")
        expect(logins).not.toContain("dave")
    })
})

describe("useGnoloveHighlights — contributorCount", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("contributorCount equals the full users array length (5)", async () => {
        vi.mocked(apiMod.getContributors).mockResolvedValue({
            users: FIVE_USERS,
            lastSyncedAt: null,
        })

        const { useGnoloveHighlights } = await import("./useGnoloveHighlights")
        const { result } = renderHook(() => useGnoloveHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.contributorCount).toBe(5)
    })
})

describe("useGnoloveHighlights — loading state", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("loading:true while query is in-flight; top is []; count is 0", async () => {
        // Never-resolving promise keeps the query loading
        vi.mocked(apiMod.getContributors).mockReturnValue(new Promise(() => {}))

        const { useGnoloveHighlights } = await import("./useGnoloveHighlights")
        const { result } = renderHook(() => useGnoloveHighlights(), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.loading).toBe(true))
        expect(result.current.top).toHaveLength(0)
        expect(result.current.contributorCount).toBe(0)
    })
})
