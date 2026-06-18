import { describe, it, expect } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders, mockLayoutContext } from "./test-utils"

function Hello() {
    return <p>hello from test harness</p>
}

describe("renderWithProviders", () => {
    it("mounts a trivial component", () => {
        renderWithProviders(<Hello />)
        expect(screen.getByText("hello from test harness")).toBeInTheDocument()
    })

    it("accepts a custom route", () => {
        renderWithProviders(<Hello />, { route: "/some/path" })
        expect(screen.getByText("hello from test harness")).toBeInTheDocument()
    })
})

describe("mockLayoutContext", () => {
    it("returns disconnected defaults", () => {
        const ctx = mockLayoutContext()
        expect(ctx.adena.connected).toBe(false)
        expect(ctx.auth.isAuthenticated).toBe(false)
        expect(ctx.balance).toBe("0")
        expect(ctx.isLoggingIn).toBe(false)
        expect(ctx.syncTimedOut).toBe(false)
    })

    it("shallowly merges adena overrides", () => {
        const ctx = mockLayoutContext({ adena: { connected: true, address: "g1abc" } as never })
        expect(ctx.adena.connected).toBe(true)
        expect(ctx.adena.address).toBe("g1abc")
        expect(typeof ctx.adena.connect).toBe("function")
    })

    it("shallowly merges auth overrides", () => {
        const ctx = mockLayoutContext({ auth: { isAuthenticated: true, address: "g1abc" } as never })
        expect(ctx.auth.isAuthenticated).toBe(true)
        expect(ctx.auth.address).toBe("g1abc")
        expect(ctx.auth.token).toBeNull()
    })
})
