import { screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Routes, Route } from "react-router-dom"
import { AppStore } from "./AppStore"
import { renderWithProviders } from "../test/test-utils"
import type { AppListing } from "../lib/appStore"

// Detail routes need the splat param populated, which requires a matching <Route>.
const appStoreRoutes = <Routes><Route path="/:network/apps/*" element={<AppStore />} /></Routes>

// Control the realm generation + the network reads so we can assert the v3-only pending disclosure
// without hitting a chain. isAppStoreV3 is a plain fn here, flipped per-test via `v3`.
let v3 = true
let submitEnabled = false
const fetchByStatus = vi.fn()
const fetchApp = vi.fn()

vi.mock("../lib/appStore", async (importActual) => {
    const actual = await importActual<typeof import("../lib/appStore")>()
    return {
        ...actual,
        isAppStoreV3: () => v3,
        fetchLiveApps: vi.fn().mockResolvedValue([]),
        fetchByStatus: (...a: unknown[]) => fetchByStatus(...a),
        fetchApp: (...a: unknown[]) => fetchApp(...a),
    }
})
vi.mock("../lib/config", async (importActual) => {
    const actual = await importActual<typeof import("../lib/config")>()
    return { ...actual, isAppStoreSubmitEnabled: () => submitEnabled }
})

function listing(over: Partial<AppListing>): AppListing {
    return {
        id: 1, pkgPath: "gno.land/r/samcrew/app_x", name: "App X", tagline: "", category: "",
        iconCID: "", appURL: "", publisher: "", status: "pending", flagCount: 0, createdAt: 0, ...over,
    }
}

describe("AppStore — pending-review disclosure (v3, opt-in)", () => {
    beforeEach(() => {
        v3 = true
        fetchByStatus.mockReset().mockResolvedValue([
            listing({ pkgPath: "gno.land/r/samcrew/unvetted", name: "Unvetted App", status: "pending" }),
        ])
    })

    it("shows the opt-in toggle but keeps pending apps hidden until asked", async () => {
        renderWithProviders(<AppStore />, { route: "/test13/apps" })
        // The toggle exists…
        expect(await screen.findByRole("button", { name: /apps pending review/i })).toBeInTheDocument()
        // …but a pending app is NOT visible by default, and we haven't even fetched it.
        expect(screen.queryByText(/Unvetted App/)).not.toBeInTheDocument()
        expect(fetchByStatus).not.toHaveBeenCalled()
    })

    it("reveals amber-chipped pending apps with a caution only after the user expands it", async () => {
        renderWithProviders(<AppStore />, { route: "/test13/apps" })
        fireEvent.click(await screen.findByRole("button", { name: /apps pending review/i }))
        expect(await screen.findByText(/Unvetted App/)).toBeInTheDocument()
        expect(screen.getByText(/not reviewed/i)).toBeInTheDocument()
        expect(screen.getByText(/Pending review/)).toBeInTheDocument()
        expect(fetchByStatus).toHaveBeenCalledWith("pending", 0, 30)
    })

    it("does not render the pending disclosure at all on the v2 realm", async () => {
        v3 = false
        renderWithProviders(<AppStore />, { route: "/test13/apps" })
        // let the live query settle
        await waitFor(() => expect(screen.getByTestId("appstore-root")).toBeInTheDocument())
        expect(screen.queryByRole("button", { name: /apps pending review/i })).not.toBeInTheDocument()
    })
})

describe("AppStore — submit-your-app CTA (B3, dark until the flag flips)", () => {
    beforeEach(() => { v3 = true; submitEnabled = true })

    it("links to /apps/submit when submissions are enabled on the v3 realm", async () => {
        renderWithProviders(<AppStore />, { route: "/test13/apps" })
        const cta = await screen.findByRole("link", { name: /submit your app/i })
        expect(cta).toHaveAttribute("href", "/test13/apps/submit")
    })

    it("stays hidden while VITE_ENABLE_APPSTORE_SUBMIT is off", async () => {
        submitEnabled = false
        renderWithProviders(<AppStore />, { route: "/test13/apps" })
        await waitFor(() => expect(screen.getByTestId("appstore-root")).toBeInTheDocument())
        expect(screen.queryByRole("link", { name: /submit your app/i })).not.toBeInTheDocument()
    })

    it("stays hidden on the v2 realm even with the flag on (no submission path there)", async () => {
        v3 = false
        renderWithProviders(<AppStore />, { route: "/test13/apps" })
        await waitFor(() => expect(screen.getByTestId("appstore-root")).toBeInTheDocument())
        expect(screen.queryByRole("link", { name: /submit your app/i })).not.toBeInTheDocument()
    })
})

describe("AppDetail — pending-review banner follows the user to the detail page", () => {
    beforeEach(() => fetchApp.mockReset())

    it("shows an amber caution when the listing is pending", async () => {
        fetchApp.mockResolvedValue(listing({ pkgPath: "gno.land/r/samcrew/unvetted", name: "Unvetted App", status: "pending" }))
        renderWithProviders(appStoreRoutes, { route: "/test13/apps/r/samcrew/unvetted" })
        expect(await screen.findByText(/Unvetted App/)).toBeInTheDocument()
        expect(screen.getByText(/Pending review\./)).toBeInTheDocument()
        expect(screen.getByText(/not yet\s+vetted by a curator/i)).toBeInTheDocument()
    })

    it("shows no caution for a live listing", async () => {
        fetchApp.mockResolvedValue(listing({ pkgPath: "gno.land/r/samcrew/verified", name: "Verified App", status: "live" }))
        renderWithProviders(appStoreRoutes, { route: "/test13/apps/r/samcrew/verified" })
        expect(await screen.findByText(/Verified App/)).toBeInTheDocument()
        expect(screen.queryByText(/Pending review\./)).not.toBeInTheDocument()
    })
})
