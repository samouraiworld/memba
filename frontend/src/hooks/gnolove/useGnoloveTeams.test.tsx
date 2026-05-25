/**
 * useGnoloveTeams — seed/fetched union behaviour.
 *
 * The hook must always return a populated roster (never an empty array or
 * undefined) so downstream UI doesn't have to handle a "no teams yet" state.
 * Loading + error states both fall back to the build-time seed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useGnoloveTeams, useGnoloveTeam, backendTeamToFrontend } from "./useGnoloveTeams"
import * as api from "../../lib/gnoloveApi"
import { TEAMS } from "../../lib/gnoloveConstants"

function withQueryClient() {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    })
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
}

beforeEach(() => {
    vi.restoreAllMocks()
})

describe("backendTeamToFrontend", () => {
    it("passes through valid colors", () => {
        const out = backendTeamToFrontend({
            slug: "onbloc", name: "Onbloc", color: "purple", members: ["x"],
        })
        expect(out.color).toBe("purple")
    })

    it("falls back to blue for unknown colors", () => {
        const out = backendTeamToFrontend({
            slug: "future", name: "Future", color: "chartreuse", members: [],
        })
        expect(out.color).toBe("blue")
    })

    it("defaults missing members to []", () => {
        // BackendTeamSchema applies .default([]) so this only matters for the
        // raw transform, but lock it in anyway.
        const out = backendTeamToFrontend({
            slug: "x", name: "X", color: "red", members: undefined as unknown as string[],
        })
        expect(out.members).toEqual([])
    })
})

describe("useGnoloveTeams", () => {
    it("serves the seed roster before the network resolves", () => {
        // Slow API — never resolves within the assertion window.
        vi.spyOn(api, "getTeams").mockImplementation(
            () => new Promise(() => { /* never */ }),
        )
        const { result } = renderHook(() => useGnoloveTeams(), { wrapper: withQueryClient() })
        expect(result.current.teams.length).toBeGreaterThan(0)
        expect(result.current.isFetched).toBe(false)
        expect(result.current.lastSyncedAt).toBeNull()
        // Verify the seed actually came from TEAMS, not some empty placeholder.
        expect(result.current.teams.map(t => t.slug).sort()).toEqual(TEAMS.map(t => t.slug).sort())
    })

    it("switches to fetched data once the backend responds", async () => {
        vi.spyOn(api, "getTeams").mockResolvedValue({
            schemaVersion: 1,
            lastSyncedAt: "2026-05-18T20:00:00Z",
            teams: [
                { slug: "onbloc", name: "Onbloc-LIVE", color: "purple", members: ["live-member"] },
            ],
        })
        const { result } = renderHook(() => useGnoloveTeams(), { wrapper: withQueryClient() })
        await waitFor(() => expect(result.current.isFetched).toBe(true))
        expect(result.current.teams).toHaveLength(1)
        expect(result.current.teams[0].name).toBe("Onbloc-LIVE")
        expect(result.current.teams[0].members).toEqual(["live-member"])
        expect(result.current.lastSyncedAt).toBe("2026-05-18T20:00:00Z")
    })

    it("falls back to the seed when the backend throws", async () => {
        vi.spyOn(api, "getTeams").mockRejectedValue(new Error("network error"))
        const { result } = renderHook(() => useGnoloveTeams(), { wrapper: withQueryClient() })
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.isFetched).toBe(false)
        expect(result.current.teams.length).toBe(TEAMS.length)
    })

    it("falls back to the seed when the backend returns an empty roster", async () => {
        vi.spyOn(api, "getTeams").mockResolvedValue({
            schemaVersion: 1,
            lastSyncedAt: "2026-05-18T20:00:00Z",
            teams: [],
        })
        const { result } = renderHook(() => useGnoloveTeams(), { wrapper: withQueryClient() })
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.isFetched).toBe(false)
        expect(result.current.teams.length).toBe(TEAMS.length)
    })
})

describe("useGnoloveTeam", () => {
    it("looks up by slug case-insensitively from the seed", () => {
        vi.spyOn(api, "getTeams").mockImplementation(() => new Promise(() => {}))
        const { result } = renderHook(() => useGnoloveTeam("ONBLOC"), { wrapper: withQueryClient() })
        expect(result.current?.slug).toBe("onbloc")
    })

    it("returns null when the slug is undefined", () => {
        vi.spyOn(api, "getTeams").mockImplementation(() => new Promise(() => {}))
        const { result } = renderHook(() => useGnoloveTeam(undefined), { wrapper: withQueryClient() })
        expect(result.current).toBeNull()
    })

    it("returns null when no team matches", () => {
        vi.spyOn(api, "getTeams").mockImplementation(() => new Promise(() => {}))
        const { result } = renderHook(() => useGnoloveTeam("missing"), { wrapper: withQueryClient() })
        expect(result.current).toBeNull()
    })
})
