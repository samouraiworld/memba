import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react"
import { MemoryRouter, Routes, Route, Link } from "react-router-dom"
import { NetworkGate } from "./NetworkGate"
import { retiredNoticeStorageKey } from "../../lib/retiredNetwork"

/**
 * Pearl was retired on 2026-09-23 (owner ruling): every `/pearl/…` link must land
 * on the same route under `/mainnet/`, with a one-time dismissible notice.
 *
 * The shell is replaced by a stub that renders the REAL notice plus the landed
 * location — the redirect and the notice are what is under test, not the shell.
 * NetworkSync is stubbed because it reloads the page on a network mismatch.
 */
vi.mock("./Layout", async () => {
    const { useLocation, useNavigate: useNav } = await import("react-router-dom")
    const { RetiredNetworkNotice } = await import("../ui/RetiredNetworkNotice")
    return {
        Layout: () => {
            const { pathname, search, hash, state } = useLocation()
            const navigate = useNav()
            return (
                <div>
                    <RetiredNetworkNotice />
                    <div data-testid="landed">{`${pathname}${search}${hash}`}</div>
                    <div data-testid="history-state">{JSON.stringify(state ?? null)}</div>
                    <Link to="/mainnet/validators">next page</Link>
                    <button type="button" onClick={() => navigate(-1)}>go back</button>
                </div>
            )
        },
    }
})
vi.mock("./NetworkSync", () => ({ NetworkSync: () => null }))

const NOTICE = "The Pearl testnet has been retired — you're now on gno.land mainnet."

function renderAt(entry: string | { pathname: string; state: unknown }) {
    cleanup()
    render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route path="/:network/*" element={<NetworkGate />} />
            </Routes>
        </MemoryRouter>,
    )
    return screen.getByTestId("landed").textContent ?? ""
}

const notice = () => screen.queryByTestId("retired-network-notice")

describe("NetworkGate — retired networks redirect to their successor", () => {
    afterEach(() => {
        localStorage.clear()
        vi.restoreAllMocks()
    })

    it("sends /pearl/<route> to /mainnet/<route>, keeping search and hash", () => {
        expect(renderAt("/pearl/dao/gno.land~r~gov~dao?tab=votes#top")).toBe("/mainnet/dao/gno.land~r~gov~dao?tab=votes#top")
    })

    it("sends the bare /pearl and /pearl/ to the mainnet home", () => {
        expect(renderAt("/pearl")).toBe("/mainnet/")
        expect(renderAt("/pearl/")).toBe("/mainnet/")
    })

    it("shows the retirement notice after the redirect", () => {
        renderAt("/pearl/validators")
        expect(notice()).not.toBeNull()
        expect(notice()?.textContent).toContain(NOTICE)
    })

    it("does not show the notice on a direct mainnet visit", () => {
        expect(renderAt("/mainnet/validators")).toBe("/mainnet/validators")
        expect(notice()).toBeNull()
    })

    it("leaves hidden-but-not-retired deep links alone (test13, sapphire)", () => {
        expect(renderAt("/test13/create-token")).toBe("/test13/create-token")
        expect(renderAt("/sapphire/directory")).toBe("/sapphire/directory")
        expect(notice()).toBeNull()
    })

    it("is one-time: a dismissal is remembered and the next /pearl link stays quiet", () => {
        renderAt("/pearl/validators")
        fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }))
        expect(notice()).toBeNull()
        expect(localStorage.getItem(retiredNoticeStorageKey("pearl"))).toBe("1")

        // Still redirected — only the notice is suppressed.
        expect(renderAt("/pearl/directory")).toBe("/mainnet/directory")
        expect(notice()).toBeNull()
    })

    it("does not follow the user to the next page", () => {
        renderAt("/pearl/dao")
        expect(notice()).not.toBeNull()
        fireEvent.click(screen.getByRole("link", { name: "next page" }))
        expect(screen.getByTestId("landed").textContent).toBe("/mainnet/validators")
        expect(notice()).toBeNull()
    })

    it("does not come back when the user navigates away and then goes Back", () => {
        renderAt("/pearl/dao")
        expect(notice()).not.toBeNull()
        fireEvent.click(screen.getByRole("link", { name: "next page" }))
        expect(screen.getByTestId("landed").textContent).toBe("/mainnet/validators")
        expect(notice()).toBeNull()
        // The shell stayed mounted; Back returns to the landing page itself.
        act(() => { fireEvent.click(screen.getByRole("button", { name: "go back" })) })
        expect(screen.getByTestId("landed").textContent).toBe("/mainnet/dao")
        expect(notice()).toBeNull()
    })

    it("shows once per redirect: the router state is consumed, so a reload does not re-show it", () => {
        renderAt("/pearl/validators")
        expect(notice()).not.toBeNull()
        // The redirect's state was replaced with a state-free entry…
        const persisted = JSON.parse(screen.getByTestId("history-state").textContent ?? "null")
        expect(persisted).toBeNull()
        // …so reloading that entry (history.state restored as-is) stays quiet,
        // even though the notice was never dismissed.
        expect(renderAt({ pathname: "/mainnet/validators", state: persisted })).toBe("/mainnet/validators")
        expect(notice()).toBeNull()
    })

    it("still renders and dismisses when storage is blocked", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
        renderAt("/pearl/validators")
        expect(notice()).not.toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }))
        expect(notice()).toBeNull()
    })
})
