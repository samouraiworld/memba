import { render } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import { AccountContext, SIGNED_OUT } from "../../account/accountContext"

// The test build has VITE_ENABLE_ACCOUNT unset: the account feature is off.
vi.mock("../../lib/accountApi", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/accountApi")>()), accountApi: { get: vi.fn(), topics: vi.fn() } }))
const { accountApi } = await import("../../lib/accountApi")
const { AccountCard } = await import("./AccountCard")
const { EarlyAccess } = await import("./EarlyAccess")

describe("with the account feature off", () => {
    it("shows nothing and reads nothing, even for someone signed in to Clerk for alerts", async () => {
        const value = { ...SIGNED_OUT, available: true, status: "ready" as const, user: { id: "u", email: "a@b.c", fullName: null, isAdmin: false }, getToken: async () => "jwt" }
        const { container } = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><AccountContext.Provider value={value}>
            <AccountCard /><EarlyAccess app="nft" />
        </AccountContext.Provider></MemoryRouter></QueryClientProvider>)
        await new Promise((r) => setTimeout(r, 20))
        expect(container).toBeEmptyDOMElement()
        expect(accountApi.get).not.toHaveBeenCalled()
        expect(accountApi.topics).not.toHaveBeenCalled()
    })
})
