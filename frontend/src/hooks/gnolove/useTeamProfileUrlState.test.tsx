/**
 * URL-state round-trip tests for the team hub.
 */

import { describe, it, expect } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { useTeamProfileUrlState } from "./useTeamProfileUrlState"

function withRouter(initialEntries: string[] = ["/teams/onbloc"]) {
    return ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    )
}

// Compose the hook with useLocation so we can assert on the URL after mutations.
function useHookWithLocation() {
    return { url: useTeamProfileUrlState(), location: useLocation() }
}

describe("useTeamProfileUrlState — parsing", () => {
    it("falls back to default period when ?period missing", () => {
        const { result } = renderHook(() => useTeamProfileUrlState(), {
            wrapper: withRouter(["/teams/onbloc"]),
        })
        expect(result.current.period).toBe("monthly")
        expect(result.current.repos).toEqual([])
    })

    it("reads ?period and ?repo from the URL", () => {
        const { result } = renderHook(() => useTeamProfileUrlState(), {
            wrapper: withRouter(["/teams/onbloc?period=weekly&repo=onbloc/gnoscan&repo=gnolang/gno"]),
        })
        expect(result.current.period).toBe("weekly")
        expect(result.current.repos).toEqual(["onbloc/gnoscan", "gnolang/gno"])
    })

    it("ignores garbage repos that don't look like owner/name", () => {
        const { result } = renderHook(() => useTeamProfileUrlState(), {
            wrapper: withRouter(["/teams/onbloc?repo=onbloc%2Fgnoscan&repo=javascript%3Aalert(1)&repo=plain"]),
        })
        expect(result.current.repos).toEqual(["onbloc/gnoscan"])
    })

    it("falls back to default for unknown period values", () => {
        const { result } = renderHook(() => useTeamProfileUrlState(), {
            wrapper: withRouter(["/teams/onbloc?period=hourly"]),
        })
        expect(result.current.period).toBe("monthly")
    })
})

describe("useTeamProfileUrlState — mutations", () => {
    it("writes ?period for non-default values; clears it for the default", () => {
        const { result } = renderHook(useHookWithLocation, {
            wrapper: withRouter(["/teams/onbloc"]),
        })
        act(() => { result.current.url.setPeriod("weekly") })
        expect(result.current.location.search).toContain("period=weekly")

        act(() => { result.current.url.setPeriod("monthly") })
        expect(result.current.location.search).not.toContain("period=")
    })

    it("setRepos replaces the full list and drops bad entries", () => {
        const { result } = renderHook(useHookWithLocation, {
            wrapper: withRouter(["/teams/onbloc?repo=org/old"]),
        })
        act(() => { result.current.url.setRepos(["new/one", "bad-shape", "valid/two"]) })
        expect(result.current.url.repos).toEqual(["new/one", "valid/two"])
    })

    it("toggleRepo adds when absent, removes when present, preserves order otherwise", () => {
        const { result } = renderHook(useHookWithLocation, {
            wrapper: withRouter(["/teams/onbloc?repo=org/a&repo=org/b"]),
        })
        act(() => { result.current.url.toggleRepo("org/c") })
        expect(result.current.url.repos).toEqual(["org/a", "org/b", "org/c"])

        act(() => { result.current.url.toggleRepo("org/b") })
        expect(result.current.url.repos).toEqual(["org/a", "org/c"])
    })

    it("toggleRepo rejects malformed input silently", () => {
        const { result } = renderHook(useHookWithLocation, {
            wrapper: withRouter(["/teams/onbloc?repo=org/a"]),
        })
        act(() => { result.current.url.toggleRepo("not a repo") })
        expect(result.current.url.repos).toEqual(["org/a"])
    })
})
