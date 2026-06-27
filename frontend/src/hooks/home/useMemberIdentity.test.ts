/**
 * useMemberIdentity.test.ts — TDD spec for the member-hero identity hook.
 *
 * Resolves the connected member's on-chain @username (r/sys/users) for the hero
 * greeting, degrading honestly to the truncated address when no username is
 * registered or the resolve fails. The address is always available, so the hero
 * always has a stable display name + initials (never blank).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"

vi.mock("../../lib/profile", () => ({
    resolveOnChainUsername: vi.fn(),
}))

const profile = await import("../../lib/profile")

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

beforeEach(() => { vi.clearAllMocks() })

const ADDR = "g1q9abc123def456ghijklmnopqrstuvwxyz0000"

describe("useMemberIdentity", () => {
    it("uses the resolved @username for the display name + initials (no double @)", async () => {
        // resolveOnChainUsername returns a display-ready "@handle" (real shape);
        // the hook must store the BARE handle so displayName isn't "@@alice".
        vi.mocked(profile.resolveOnChainUsername).mockResolvedValue("@alice")
        const { useMemberIdentity } = await import("./useMemberIdentity")
        const { result } = renderHook(() => useMemberIdentity(ADDR), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.username).toBe("alice"))
        expect(result.current.displayName).toBe("@alice")
        expect(result.current.initials).toBe("AL")
    })

    it("falls back to the truncated address when no username is registered", async () => {
        vi.mocked(profile.resolveOnChainUsername).mockResolvedValue("")
        const { useMemberIdentity } = await import("./useMemberIdentity")
        const { result } = renderHook(() => useMemberIdentity(ADDR), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.username).toBeUndefined()
        expect(result.current.displayName).toContain("…")
        expect(result.current.displayName).toMatch(/^g1q9/)
        // Initials derive from the address (skipping the g1 prefix), never blank.
        expect(result.current.initials).toMatch(/^[A-Z0-9]{2}$/)
    })

    it("degrades to the address when the resolve throws (never blank)", async () => {
        vi.mocked(profile.resolveOnChainUsername).mockRejectedValue(new Error("rpc down"))
        const { useMemberIdentity } = await import("./useMemberIdentity")
        const { result } = renderHook(() => useMemberIdentity(ADDR), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.username).toBeUndefined()
        expect(result.current.displayName).toMatch(/^g1q9/)
        expect(result.current.initials).toMatch(/^[A-Z0-9]{2}$/)
    })

    it("shows the address immediately while the username resolves (no blank flash)", async () => {
        let resolve!: (v: string) => void
        vi.mocked(profile.resolveOnChainUsername).mockReturnValue(new Promise<string>((r) => { resolve = r }))
        const { useMemberIdentity } = await import("./useMemberIdentity")
        const { result } = renderHook(() => useMemberIdentity(ADDR), { wrapper: makeWrapper() })
        // Before the username resolves, the display name is already the address.
        expect(result.current.displayName).toMatch(/^g1q9/)
        resolve("@bob")
        await waitFor(() => expect(result.current.displayName).toBe("@bob"))
    })
})
