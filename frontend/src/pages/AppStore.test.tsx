import { screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Routes, Route } from "react-router-dom"
import { AppStore } from "./AppStore"
import { renderWithProviders } from "../test/test-utils"
import type { AppListing } from "../lib/appStore"
import { MEMBA_DAO } from "../lib/config"

// Detail routes need the splat param populated, which requires a matching <Route>.
const appStoreRoutes = <Routes><Route path="/:network/apps/*" element={<AppStore />} /></Routes>

// Control the realm generation + the network reads so we can assert the v3-only pending disclosure
// without hitting a chain. isAppStoreV3 is a plain fn here, flipped per-test via `v3`.
let v3 = true
let submitEnabled = false
let reviewsEnabled = false
const fetchByStatus = vi.fn()
const fetchApp = vi.fn()
const fetchLiveApps = vi.fn()
const fetchAppStoreStats = vi.fn()
const fetchSummaries = vi.fn()

vi.mock("../lib/appStore", async (importActual) => {
    const actual = await importActual<typeof import("../lib/appStore")>()
    return {
        ...actual,
        isAppStoreV3: () => v3,
        fetchLiveApps: (...a: unknown[]) => fetchLiveApps(...a),
        fetchByStatus: (...a: unknown[]) => fetchByStatus(...a),
        fetchApp: (...a: unknown[]) => fetchApp(...a),
        fetchAppStoreStats: (...a: unknown[]) => fetchAppStoreStats(...a),
    }
})
vi.mock("../lib/reviews", async (importActual) => {
    const actual = await importActual<typeof import("../lib/reviews")>()
    return { ...actual, fetchSummaries: (...a: unknown[]) => fetchSummaries(...a) }
})
vi.mock("../lib/config", async (importActual) => {
    const actual = await importActual<typeof import("../lib/config")>()
    return {
        ...actual,
        isAppStoreSubmitEnabled: () => submitEnabled,
        isAppReviewsEnabled: () => reviewsEnabled,
    }
})

// Defaults keep every pre-existing test's world intact: empty grid, no realm
// stats (masthead falls back to the window length), reviews off.
beforeEach(() => {
    reviewsEnabled = false
    fetchLiveApps.mockReset().mockResolvedValue([])
    fetchAppStoreStats.mockReset().mockResolvedValue(null)
    fetchSummaries.mockReset().mockResolvedValue(new Map())
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

describe("AppGrid — masthead counts from GetStatsJSON (W0.6)", () => {
    it("prefers realm-level stats and discloses total submissions when they exceed live", async () => {
        fetchLiveApps.mockResolvedValue([
            listing({ pkgPath: "gno.land/r/samcrew/a", name: "A", status: "live" }),
            listing({ pkgPath: "gno.land/r/samcrew/b", name: "B", status: "live" }),
        ])
        fetchAppStoreStats.mockResolvedValue({ total: 5, live: 2, registrationFee: 1000000, paused: false })
        renderWithProviders(<AppStore />, { route: "/test13/apps" })
        await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument())
        expect(screen.getByText(/submitted/)).toBeInTheDocument()
        expect(screen.getByText("2")).toBeInTheDocument()
    })

    it("falls back to the fetched window length when the stats getter errors", async () => {
        fetchLiveApps.mockResolvedValue([listing({ pkgPath: "gno.land/r/samcrew/a", name: "A", status: "live" })])
        fetchAppStoreStats.mockResolvedValue(null)
        renderWithProviders(<AppStore />, { route: "/test13/apps" })
        await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument())
        expect(screen.queryByText(/submitted/)).not.toBeInTheDocument()
    })
})

describe("AppGrid — review stars on cards (W0.6)", () => {
    beforeEach(() => {
        reviewsEnabled = true
        fetchLiveApps.mockResolvedValue([
            listing({ pkgPath: "gno.land/r/samcrew/rated", name: "Rated App", status: "live" }),
            listing({ pkgPath: "gno.land/r/samcrew/fresh", name: "Fresh App", status: "live" }),
        ])
    })

    it("renders a star summary on reviewed cards and nothing on zero-review cards", async () => {
        fetchSummaries.mockResolvedValue(new Map([
            ["gno.land/r/samcrew/rated", { count: 4, average: 4.5, sum: 18 }],
            ["gno.land/r/samcrew/fresh", { count: 0, average: 0, sum: 0 }],
        ]))
        renderWithProviders(<AppStore />, { route: "/test13/apps" })
        expect(await screen.findByText("4.5")).toBeInTheDocument()
        expect(screen.getByText(/4 reviews/)).toBeInTheDocument()
        // The zero-review card must stay quiet — no "No reviews yet" noise in a grid.
        expect(screen.queryByText(/No reviews yet/)).not.toBeInTheDocument()
        // One batched fetch for all visible cards, against the app-reviews realm.
        expect(fetchSummaries).toHaveBeenCalledTimes(1)
        expect(fetchSummaries.mock.calls[0][1]).toBe(MEMBA_DAO.appReviewsPath)
        expect(fetchSummaries.mock.calls[0][0]).toEqual([
            "gno.land/r/samcrew/rated",
            "gno.land/r/samcrew/fresh",
        ])
    })

    it("fetches no summaries at all while reviews are flagged off", async () => {
        reviewsEnabled = false
        renderWithProviders(<AppStore />, { route: "/test13/apps" })
        await waitFor(() => expect(screen.getByTestId("appstore-root")).toBeInTheDocument())
        expect(fetchSummaries).not.toHaveBeenCalled()
    })
})

describe("AppIcon — pinned artwork with monogram fallback (W0.6)", () => {
    const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"

    it("renders the IPFS gateway image for a valid iconCID", async () => {
        fetchLiveApps.mockResolvedValue([listing({ pkgPath: "gno.land/r/samcrew/pretty", name: "Pretty App", iconCID: CID, status: "live" })])
        const { container } = renderWithProviders(<AppStore />, { route: "/test13/apps" })
        await screen.findByText("Pretty App")
        const img = container.querySelector("img.appicon")
        expect(img).not.toBeNull()
        expect(img!.getAttribute("src")).toContain(CID)
    })

    it("keeps the deterministic monogram when iconCID is empty or junk", async () => {
        fetchLiveApps.mockResolvedValue([
            listing({ pkgPath: "gno.land/r/samcrew/plain", name: "Plain App", iconCID: "", status: "live" }),
            listing({ pkgPath: "gno.land/r/samcrew/junk", name: "Junk App", iconCID: "not-a-cid", status: "live" }),
        ])
        const { container } = renderWithProviders(<AppStore />, { route: "/test13/apps" })
        await screen.findByText("Plain App")
        expect(container.querySelector("img.appicon")).toBeNull()
        expect(container.querySelectorAll(".appmono").length).toBeGreaterThanOrEqual(2)
    })
})
