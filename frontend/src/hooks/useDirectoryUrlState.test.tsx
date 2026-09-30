import type { ReactNode } from "react"
import { act, renderHook } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { useDirectoryUrlState } from "./useDirectoryUrlState"

function at(search: string) {
    const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[`/mainnet/directory${search}`]}>{children}</MemoryRouter>
    return renderHook(() => ({ url: useDirectoryUrlState(), search: useLocation().search }), { wrapper })
}

describe("useDirectoryUrlState", () => {
    it("keeps the default tab out of an address that never named a tab", () => {
        const { result } = at("")
        act(() => result.current.url[1]({ q: "boards" }))
        expect(result.current.search).toBe("?q=boards")
        act(() => result.current.url[1]({ q: "" }))
        expect(result.current.search).toBe("")
    })

    it.each([
        ["picking the default tab", "?tab=daos", { tab: "packages", realm: "" } as const],
        ["clearing a search on it", "?tab=packages&q=avl", { q: "" }],
        ["closing a drawer on it", "?tab=packages&realm=p%2Fdemo%2Favl", { realm: "" }],
    ])("keeps naming the tab after %s, so the bare address is never written from a tab", (_, search, patch) => {
        const { result } = at(search)
        act(() => result.current.url[1](patch))
        expect(result.current.search).toBe("?tab=packages")
        expect(result.current.url[0]).toEqual({ tab: "packages", q: "", realm: "" })
    })

    it("keeps the tab named while a search is typed on the default tab", () => {
        const { result } = at("?tab=packages")
        act(() => result.current.url[1]({ q: "avl" }))
        expect(new URLSearchParams(result.current.search).get("tab")).toBe("packages")
        expect(result.current.url[0]).toEqual({ tab: "packages", q: "avl", realm: "" })
    })
})
