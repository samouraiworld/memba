/**
 * useDirectoryHighlights.test.ts
 *
 * Verifies:
 *   1. memberCount comes from fetchTractionMetrics().contributorCount
 *   2. members comes from queryRender + parseUserRegistry, capped at 4
 *   3. registry-realm invalid on network -> members is [] (no throw)
 *   4. loading state transitions correctly
 *   5. fetch failures -> memberCount 0, members [] (no throw)
 *   6. (E4) snapshot usable -> members from snapshot.directoryMembers; traction still called; queryRender NOT called
 *   7. (E4) snapshot usable but directoryMembers empty -> members is []
 *   8. (E4) snapshot NOT usable -> registry path (queryRender) fires
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"

// ── Module-level mocks ────────────────────────────────────────

vi.mock("../../lib/traction", () => ({
    fetchTractionMetrics: vi.fn(),
}))

vi.mock("../../lib/dao/shared", () => ({
    queryRender: vi.fn(),
}))

vi.mock("../../lib/directory", () => ({
    parseUserRegistry: vi.fn(),
}))

vi.mock("../../lib/config", () => ({
    getUserRegistryPath: vi.fn(() => "gno.land/r/sys/users"),
    isRealmValidOn: vi.fn(() => true),
}))

vi.mock("../useNetwork", () => ({
    useNetwork: vi.fn(() => ({
        networkKey: "test13",
        rpcUrl: "https://rpc.test13.gno.land",
        chainId: "test-13",
        label: "Testnet 13",
        switchNetwork: vi.fn(),
        networks: {},
    })),
}))

// Default: snapshot not usable (existing tests keep the registry/fallback path)
vi.mock("./useHomeSnapshot", () => ({
    useHomeSnapshot: vi.fn(() => ({ snapshot: null, usable: false, isLoading: false })),
}))

// Resolve mocked modules for per-test control
const tractionMod = await import("../../lib/traction")
const sharedMod = await import("../../lib/dao/shared")
const directoryMod = await import("../../lib/directory")
const configMod = await import("../../lib/config")
const snapshotMod = await import("./useHomeSnapshot")

// ── Wrapper ───────────────────────────────────────────────────

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

// ── Fixtures ──────────────────────────────────────────────────

const MOCK_TRACTION = {
    daoCount: 5,
    contributorCount: 42,
    repoCount: 7,
    fetchedAt: Date.now(),
}

const MOCK_USERS = [
    { name: "alice",   address: "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    { name: "bob",     address: "g1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    { name: "charlie", address: "g1cccccccccccccccccccccccccccccccccccccccc" },
    { name: "dave",    address: "g1dddddddddddddddddddddddddddddddddddddddd" },
    { name: "eve",     address: "g1eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
]

// ── Tests ─────────────────────────────────────────────────────

describe("useDirectoryHighlights — member count", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(configMod.isRealmValidOn).mockReturnValue(true)
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({ snapshot: null, usable: false, isLoading: false })
    })

    it("returns contributorCount from traction metrics", async () => {
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(MOCK_TRACTION)
        vi.mocked(sharedMod.queryRender).mockResolvedValue("* [alice](link) - g1aaa")
        vi.mocked(directoryMod.parseUserRegistry).mockReturnValue(MOCK_USERS.slice(0, 1))

        const { useDirectoryHighlights } = await import("./useDirectoryHighlights")
        const { result } = renderHook(() => useDirectoryHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.memberCount).toBe(42)
    })

    it("memberCount is 0 when traction fetch fails", async () => {
        vi.mocked(tractionMod.fetchTractionMetrics).mockRejectedValue(new Error("network error"))
        vi.mocked(sharedMod.queryRender).mockResolvedValue(null)
        vi.mocked(directoryMod.parseUserRegistry).mockReturnValue([])

        const { useDirectoryHighlights } = await import("./useDirectoryHighlights")
        const { result } = renderHook(() => useDirectoryHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.memberCount).toBe(0)
    })
})

describe("useDirectoryHighlights — members list", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(configMod.isRealmValidOn).mockReturnValue(true)
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({ snapshot: null, usable: false, isLoading: false })
    })

    it("returns up to 4 members from registry", async () => {
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(MOCK_TRACTION)
        vi.mocked(sharedMod.queryRender).mockResolvedValue("raw render output")
        // parseUserRegistry returns 5 users; hook slices to 4
        vi.mocked(directoryMod.parseUserRegistry).mockReturnValue(MOCK_USERS)

        const { useDirectoryHighlights } = await import("./useDirectoryHighlights")
        const { result } = renderHook(() => useDirectoryHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.members).toHaveLength(4)
    })

    it("member names are correct (first 4 from registry)", async () => {
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(MOCK_TRACTION)
        vi.mocked(sharedMod.queryRender).mockResolvedValue("raw render output")
        vi.mocked(directoryMod.parseUserRegistry).mockReturnValue(MOCK_USERS)

        const { useDirectoryHighlights } = await import("./useDirectoryHighlights")
        const { result } = renderHook(() => useDirectoryHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        const names = result.current.members.map(m => m.name)
        expect(names).toContain("alice")
        expect(names).toContain("bob")
        expect(names).toContain("charlie")
        expect(names).toContain("dave")
        expect(names).not.toContain("eve") // 5th is excluded
    })

    it("members is [] when queryRender returns null", async () => {
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(MOCK_TRACTION)
        vi.mocked(sharedMod.queryRender).mockResolvedValue(null)
        vi.mocked(directoryMod.parseUserRegistry).mockReturnValue([])

        const { useDirectoryHighlights } = await import("./useDirectoryHighlights")
        const { result } = renderHook(() => useDirectoryHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.members).toHaveLength(0)
    })
})

describe("useDirectoryHighlights — registry realm invalid", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({ snapshot: null, usable: false, isLoading: false })
    })

    it("members is [] when registry realm is not valid on network (no throw)", async () => {
        // Realm is invalid — no queryRender call expected
        vi.mocked(configMod.isRealmValidOn).mockReturnValue(false)
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(MOCK_TRACTION)
        // queryRender should NOT be called (Promise.resolve([]) short-circuit)
        vi.mocked(sharedMod.queryRender).mockResolvedValue("should not be called")
        vi.mocked(directoryMod.parseUserRegistry).mockReturnValue(MOCK_USERS)

        const { useDirectoryHighlights } = await import("./useDirectoryHighlights")
        const { result } = renderHook(() => useDirectoryHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        // Even though parseUserRegistry would return data, it's bypassed
        expect(result.current.members).toHaveLength(0)
        // But count still comes through
        expect(result.current.memberCount).toBe(42)
    })
})

describe("useDirectoryHighlights — loading state", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(configMod.isRealmValidOn).mockReturnValue(true)
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({ snapshot: null, usable: false, isLoading: false })
    })

    it("loading is true while query is in-flight", async () => {
        vi.mocked(tractionMod.fetchTractionMetrics).mockReturnValue(new Promise(() => {}))
        vi.mocked(sharedMod.queryRender).mockReturnValue(new Promise(() => {}))
        vi.mocked(directoryMod.parseUserRegistry).mockReturnValue([])

        const { useDirectoryHighlights } = await import("./useDirectoryHighlights")
        const { result } = renderHook(() => useDirectoryHighlights(), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.loading).toBe(true))
        expect(result.current.memberCount).toBe(0)
        expect(result.current.members).toHaveLength(0)
    })
})

// ── E4 snapshot-first tests ───────────────────────────────────

const SNAPSHOT_MEMBERS = [
    { name: "alice", address: "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", avatarUrl: "https://example.com/alice.png" },
    { name: "bob",   address: "g1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", avatarUrl: "" },
    { name: "charlie", address: "g1cccccccccccccccccccccccccccccccccccccccc", avatarUrl: "" },
    { name: "dave",  address: "g1dddddddddddddddddddddddddddddddddddddddd", avatarUrl: "" },
    { name: "eve",   address: "g1eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", avatarUrl: "" },
]

const MOCK_SNAPSHOT = {
    directoryMembers: SNAPSHOT_MEMBERS,
    staleSources: [],
}

describe("useDirectoryHighlights — E4 snapshot-first", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(configMod.isRealmValidOn).mockReturnValue(true)
        // Default back to not-usable so individual tests can override
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({ snapshot: null, usable: false, isLoading: false })
    })

    it("snapshot usable: members come from snapshot.directoryMembers (not queryRender)", async () => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: MOCK_SNAPSHOT as never,
            usable: true,
            isLoading: false,
        })
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(MOCK_TRACTION)
        // queryRender should NOT be called when snapshot is usable
        vi.mocked(sharedMod.queryRender).mockResolvedValue("should-not-be-called")
        vi.mocked(directoryMod.parseUserRegistry).mockReturnValue([])

        const { useDirectoryHighlights } = await import("./useDirectoryHighlights")
        const { result } = renderHook(() => useDirectoryHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        // members come from snapshot (capped to 4)
        expect(result.current.members).toHaveLength(4)
        const names = result.current.members.map((m) => m.name)
        expect(names).toContain("alice")
        expect(names).toContain("bob")
        expect(names).toContain("charlie")
        expect(names).toContain("dave")
        expect(names).not.toContain("eve")

        // registry was NOT called
        expect(vi.mocked(sharedMod.queryRender)).not.toHaveBeenCalled()
    })

    it("snapshot usable: memberCount still comes from traction (fetchTractionMetrics IS called)", async () => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: MOCK_SNAPSHOT as never,
            usable: true,
            isLoading: false,
        })
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(MOCK_TRACTION)
        vi.mocked(sharedMod.queryRender).mockResolvedValue(null)
        vi.mocked(directoryMod.parseUserRegistry).mockReturnValue([])

        const { useDirectoryHighlights } = await import("./useDirectoryHighlights")
        const { result } = renderHook(() => useDirectoryHighlights(), { wrapper: makeWrapper() })
        // When snapshot is usable, loading is immediately false, but the memberCount
        // query (always-on) may still be resolving — wait for it explicitly.
        await waitFor(() => expect(result.current.memberCount).toBe(42))

        expect(vi.mocked(tractionMod.fetchTractionMetrics)).toHaveBeenCalled()
    })

    it("snapshot usable but directoryMembers empty: members is []", async () => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: { ...MOCK_SNAPSHOT, directoryMembers: [] } as never,
            usable: true,
            isLoading: false,
        })
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(MOCK_TRACTION)
        vi.mocked(sharedMod.queryRender).mockResolvedValue("should-not-be-called")
        vi.mocked(directoryMod.parseUserRegistry).mockReturnValue([])

        const { useDirectoryHighlights } = await import("./useDirectoryHighlights")
        const { result } = renderHook(() => useDirectoryHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.members).toHaveLength(0)
        // registry still not called
        expect(vi.mocked(sharedMod.queryRender)).not.toHaveBeenCalled()
    })

    it("snapshot NOT usable: registry path (queryRender) fires, members from registry", async () => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({ snapshot: null, usable: false, isLoading: false })
        vi.mocked(tractionMod.fetchTractionMetrics).mockResolvedValue(MOCK_TRACTION)
        vi.mocked(sharedMod.queryRender).mockResolvedValue("raw registry output")
        vi.mocked(directoryMod.parseUserRegistry).mockReturnValue(MOCK_USERS.slice(0, 3))

        const { useDirectoryHighlights } = await import("./useDirectoryHighlights")
        const { result } = renderHook(() => useDirectoryHighlights(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(vi.mocked(sharedMod.queryRender)).toHaveBeenCalled()
        expect(result.current.members).toHaveLength(3)
        expect(result.current.members[0].name).toBe("alice")
    })
})
