/**
 * Saved-DAO storage + useYourWorlds together: legacy entries keep the
 * behaviour they had before chain scoping.
 */
import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React, { type ReactNode } from "react"

vi.mock("../../lib/dao", () => ({
    getDAOConfig: vi.fn(async () => null), // the chain answers: nothing renders here
    getDAOProposals: vi.fn(async () => []),
    getMemberRole: vi.fn(async () => null),
    deriveRoleLabel: vi.fn(),
}))
vi.mock("../useAuth", () => ({
    useAuth: vi.fn(() => ({ isAuthenticated: false, address: "", token: null, loading: false, error: null })),
}))

import { useYourWorlds } from "./useYourWorlds"

function wrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return ({ children }: { children: ReactNode }) => React.createElement(QueryClientProvider, { client }, children)
}

describe("useYourWorlds with legacy saved DAOs", () => {
    it("drops an unresolved untagged entry and never shows a retired-network entry", async () => {
        localStorage.setItem("memba_saved_daos", JSON.stringify([
            { realmPath: "gno.land/r/legacy/untagged", name: "Untagged", addedAt: 1 },
            { realmPath: "gno.land/r/legacy/retired", name: "Retired", addedAt: 2, network: "test12" },
        ]))
        const { result } = renderHook(() => useYourWorlds("pearl", null), { wrapper: wrapper() })
        await waitFor(() => expect(result.current.state).toBe("ready"))
        expect(result.current.worlds).toEqual([])
    })
})
