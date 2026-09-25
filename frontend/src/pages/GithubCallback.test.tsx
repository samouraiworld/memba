/**
 * GithubCallback — the GitHub link is verified and stored by the backend.
 *
 * The page sends the OAuth code with the wallet session token and never
 * writes the link itself; with no session it waits for the wallet instead of
 * spending the single-use code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom"
import type { Token } from "../gen/memba/v1/memba_pb"
import type { LayoutContext } from "../types/layout"

const mockNavigate = vi.fn()
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => mockNavigate }))
vi.mock("../lib/config", () => ({ API_BASE_URL: "https://api.test" }))
const mockUpdateBackendProfile = vi.fn()
vi.mock("../lib/profile", () => ({ updateBackendProfile: (...a: unknown[]) => mockUpdateBackendProfile(...a) }))

import { GithubCallback } from "./GithubCallback"

const WALLET = "g1walletaddressxxxxxxxxxxxxxxxxxxxxxxxxx"

const token = {
    nonce: "bm9uY2U=",
    expiration: "2026-12-31T00:00:00Z",
    userAddress: WALLET,
    serverSignature: "c2lnbmF0dXJl",
    chainId: "gnoland-1",
} as unknown as Token

function ctx(overrides: { token?: Token | null; isLoggingIn?: boolean; address?: string } = {}): LayoutContext {
    const t = overrides.token === undefined ? token : overrides.token
    return {
        adena: { address: overrides.address ?? (t ? WALLET : "") },
        auth: { token: t, isAuthenticated: !!t, address: t ? WALLET : "", loading: false, error: null },
        isLoggingIn: overrides.isLoggingIn ?? false,
    } as unknown as LayoutContext
}

function tree(context: LayoutContext) {
    return (
        <MemoryRouter initialEntries={["/github/callback?code=code123&state=state456"]}>
            <Routes>
                <Route element={<Outlet context={context} />}>
                    <Route path="/github/callback" element={<GithubCallback />} />
                </Route>
            </Routes>
        </MemoryRouter>
    )
}

function okResponse() {
    return new Response(JSON.stringify({ login: "octocat", avatar_url: "", name: "The Octocat" }), { status: 200 })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    mockNavigate.mockReset()
    mockUpdateBackendProfile.mockReset()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("GithubCallback", () => {
    it("sends the code with the wallet session token and does not write the profile itself", async () => {
        fetchMock.mockResolvedValue(okResponse())
        render(tree(ctx()))

        await screen.findByText(/GitHub Linked/)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe("https://api.test/github/oauth/exchange?code=code123&state=state456")
        const header = (init as RequestInit).headers as Record<string, string>
        expect(header.Authorization.startsWith("Bearer ")).toBe(true)
        // The backend decodes the Go/proto (snake_case) field names.
        expect(JSON.parse(header.Authorization.slice("Bearer ".length))).toEqual({
            nonce: "bm9uY2U=",
            expiration: "2026-12-31T00:00:00Z",
            user_address: WALLET,
            server_signature: "c2lnbmF0dXJl",
            chain_id: "gnoland-1",
        })
        expect(mockUpdateBackendProfile).not.toHaveBeenCalled()
    })

    it("waits for the wallet instead of spending the code, then links once signed in", async () => {
        fetchMock.mockResolvedValue(okResponse())
        const { rerender } = render(tree(ctx({ token: null })))

        expect(screen.getByText("Connect your wallet")).toBeTruthy()
        expect(fetchMock).not.toHaveBeenCalled()

        rerender(tree(ctx()))
        await screen.findByText(/GitHub Linked/)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(mockUpdateBackendProfile).not.toHaveBeenCalled()
    })

    it("shows a spinner, not the wallet prompt, while the wallet is reconnecting", () => {
        render(tree(ctx({ token: null, isLoggingIn: true })))
        expect(screen.getByText("Connecting to GitHub...")).toBeTruthy()
        expect(screen.queryByText("Connect your wallet")).toBeNull()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("surfaces a rejected exchange as an error", async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "invalid or expired token" }), { status: 401 }))
        render(tree(ctx()))

        await screen.findByText("Linking Failed")
        expect(screen.getByText("invalid or expired token")).toBeTruthy()
        expect(mockUpdateBackendProfile).not.toHaveBeenCalled()
    })

    it("exchanges the single-use code only once across re-renders", async () => {
        fetchMock.mockResolvedValue(okResponse())
        const { rerender } = render(tree(ctx()))
        await screen.findByText(/GitHub Linked/)

        rerender(tree(ctx({ address: "g1otheraddressxxxxxxxxxxxxxxxxxxxxxxxxxxx" })))
        await waitFor(() => expect(screen.getByText(/GitHub Linked/)).toBeTruthy())
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})
