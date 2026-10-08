import { screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Routes, Route } from "react-router-dom"
import { AppStore } from "./AppStore"
import { renderWithProviders } from "../test/test-utils"
import type { AppListing } from "../lib/appStore"
import { getIpfsGatewayUrl } from "../lib/ipfs"

// Detail routes need the splat param populated, which requires a matching <Route>.
const appStoreRoutes = <Routes><Route path="/:network/apps/*" element={<AppStore />} /></Routes>

// Control the realm generation + the network reads so we can assert the v3-only pending disclosure
// without hitting a chain. isAppStoreV3OrLater is a plain fn here, flipped per-test via `v3`.
let v3 = true
let submitEnabled = false
let reviewsEnabled = false
const fetchByStatus = vi.fn()
const fetchApp = vi.fn()
const fetchLiveApps = vi.fn()
let catalogueComplete = true
const fetchAppStoreStats = vi.fn()
const fetchSummaries = vi.fn()
const fetchModerator = vi.fn()

vi.mock("../lib/appStore", async (importActual) => {
    const actual = await importActual<typeof import("../lib/appStore")>()
    return {
        ...actual,
        isAppStoreV3OrLater: () => v3,
        fetchLiveCatalogue: async (...a: unknown[]) => ({ apps: await fetchLiveApps(...a), complete: catalogueComplete }),
        fetchByStatus: (...a: unknown[]) => fetchByStatus(...a),
        fetchApp: (...a: unknown[]) => fetchApp(...a),
        fetchAppStoreStats: (...a: unknown[]) => fetchAppStoreStats(...a),
    }
})
vi.mock("../lib/reviews", async (importActual) => {
    const actual = await importActual<typeof import("../lib/reviews")>()
    return {
        ...actual,
        fetchSummaries: (...a: unknown[]) => fetchSummaries(...a),
        fetchModerator: (...a: unknown[]) => fetchModerator(...a),
        fetchSummary: async () => ({ count: 0, average: 0, sum: 0 }),
        fetchReviews: async () => [],
    }
})
vi.mock("../lib/config", async (importActual) => {
    const actual = await importActual<typeof import("../lib/config")>()
    return {
        ...actual,
        isAppStoreSubmitEnabled: () => submitEnabled,
        isAppReviewsAvailable: () => reviewsEnabled,
    }
})

// Defaults keep every pre-existing test's world intact: empty grid, no realm
// stats (masthead falls back to the window length), reviews off.
beforeEach(() => {
    reviewsEnabled = false
    catalogueComplete = true
    fetchLiveApps.mockReset().mockResolvedValue([])
    fetchAppStoreStats.mockReset().mockResolvedValue(null)
    fetchSummaries.mockReset().mockResolvedValue(new Map())
    fetchModerator.mockReset().mockResolvedValue(null)
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
        // Route and expected href both derive from DEFAULT_NETWORK: the CTA
        // builds its link from the ACTIVE network (module-load, env-derived),
        // so a hardcoded literal here is red on any machine whose env pins a
        // different chain (the env-test-divergence class).
        const { DEFAULT_NETWORK } = await import("../lib/config")
        renderWithProviders(<AppStore />, { route: `/${DEFAULT_NETWORK}/apps` })
        const cta = await screen.findByRole("link", { name: /submit your app/i })
        expect(cta).toHaveAttribute("href", `/${DEFAULT_NETWORK}/apps/submit`)
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

describe("AppStore — says who listed an app and promises reviews only when they are on", () => {
    const TEAM = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"

const DAO = "g1dmaqdpwr6xw6ukday0g66033j6ta4wc0r5ypf8"
    const trustOf = async () => (await screen.findByText("Read before you run")).closest("aside")!
    const teamListing = () => fetchApp.mockResolvedValue(listing({ pkgPath: "gno.land/r/gnoswap/router", name: "GnoSwap", status: "live", publisher: TEAM }))

    it("names the lister, not a realm publisher, and claims no moderation while app reviews are off", async () => {
        teamListing()
        renderWithProviders(appStoreRoutes, { route: "/test13/apps/r/gnoswap/router" })
        const trust = await trustOf()
        expect(trust).toHaveTextContent("Listed by g136j0m0…5cpf (the Samourai team multisig).")
        expect(trust).not.toHaveTextContent("Published by")
        expect(fetchModerator).not.toHaveBeenCalled()
    })

    it("says the lister also moderates reviews only when the reviews realm names it as moderator", async () => {
        reviewsEnabled = true
        teamListing()
        fetchModerator.mockResolvedValue(TEAM)
        const first = renderWithProviders(appStoreRoutes, { route: "/test13/apps/r/gnoswap/router" })
        const trust = await trustOf()
        await waitFor(() => expect(trust).toHaveTextContent("Listed by g136j0m0…5cpf (the Samourai team multisig, which also moderates reviews)."))
        expect(fetchModerator).toHaveBeenCalled()
        first.unmount()

        // Moderation handed to another address: the listing stops claiming it.
        fetchModerator.mockResolvedValue(DAO)
        renderWithProviders(appStoreRoutes, { route: "/test13/apps/r/gnoswap/router" })
        await waitFor(() => expect(screen.getByText(DAO)).toBeInTheDocument())
        expect(await trustOf()).toHaveTextContent("Listed by g136j0m0…5cpf (the Samourai team multisig).")
    })

    it("makes no team claim for another lister", async () => {
        fetchApp.mockResolvedValue(listing({ pkgPath: "gno.land/r/x/app", name: "Other", status: "live", publisher: "g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpafgfmt" }))
        renderWithProviders(appStoreRoutes, { route: "/test13/apps/r/x/app" })
        const trust = (await screen.findByText("Read before you run")).closest("aside")!
        expect(trust).toHaveTextContent("Listed by")
        expect(trust).not.toHaveTextContent("Samourai team")
    })

    it("mentions reviews in the lede only while app reviews are available", async () => {
        const { unmount } = renderWithProviders(appStoreRoutes, { route: "/test13/apps" })
        expect(await screen.findByText(/Inspect each app’s public realm before opening it\./)).toBeInTheDocument()
        unmount()
        reviewsEnabled = true
        renderWithProviders(appStoreRoutes, { route: "/test13/apps" })
        expect(await screen.findByText(/Inspect each app’s public realm and reviews before opening it\./)).toBeInTheDocument()
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

describe("AppGrid — one catalogue", () => {
    it("uses one search and category filter for registry and editorial entries", async () => {
        fetchLiveApps.mockResolvedValue([
            listing({ pkgPath: "gno.land/r/gnoswap/router", name: "GnoSwap", category: "Exchange", status: "live" }),
            listing({ pkgPath: "gno.land/r/samcrew/arcade", name: "Arcade", category: "Games", status: "live" }),
        ])
        renderWithProviders(<AppStore />, { route: "/mainnet/apps" })
        const search = await screen.findByRole("searchbox", { name: "Search apps and projects" })
        fireEvent.change(search, { target: { value: "bubble" } })
        expect(await screen.findByRole("link", { name: "Visit Bubble Rumble (opens in a new tab)" })).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Arcade/ })).not.toBeInTheDocument()
        fireEvent.change(search, { target: { value: "" } })
        fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "Games" } })
        expect(await screen.findByRole("button", { name: /Arcade/ })).toBeInTheDocument()
        expect(screen.getByRole("link", { name: "Visit Bubble Rumble (opens in a new tab)" })).toBeInTheDocument()
        expect(screen.queryByRole("heading", { name: "GnoSwap" })).not.toBeInTheDocument()
    })

    it("shows listings beyond the first 30 and discloses a bounded partial result", async () => {
        catalogueComplete = false
        fetchLiveApps.mockResolvedValue(Array.from({ length: 31 }, (_, index) => listing({
            id: index + 1,
            pkgPath: `gno.land/r/samcrew/app${index + 1}`,
            name: `App ${index + 1}`,
            status: "live",
        })))
        renderWithProviders(<AppStore />, { route: "/mainnet/apps" })
        expect(await screen.findByRole("button", { name: "App 31" })).toBeInTheDocument()
        expect(screen.getByText(/More listings exist beyond this page/)).toBeInTheDocument()
        expect(screen.queryByText("Spotlight")).not.toBeInTheDocument()
    })

    it("places live registry cards before the unmatched static directory without duplicate apps", async () => {
        fetchLiveApps.mockResolvedValue([
            listing({ pkgPath: "gno.land/r/gnoswap/router", name: "GnoSwap", appURL: "https://gnoswap.io/", status: "live" }),
            listing({ pkgPath: "gno.land/r/gnoland/boards2/v0", name: "Boards", appURL: "https://gno.land/r/gnoland/boards2/v0", status: "live" }),
        ])
        renderWithProviders(<AppStore />, { route: "/mainnet/apps" })
        expect(await screen.findByRole("heading", { name: "More from the Gno ecosystem" })).toBeInTheDocument()
        expect(screen.getAllByRole("heading", { name: "GnoSwap" })).toHaveLength(1)
        expect(screen.getAllByRole("button", { name: "Boards" })).toHaveLength(1)
        expect(screen.queryByRole("heading", { name: "Boards" })).not.toBeInTheDocument()
        expect(screen.getByRole("status")).toHaveTextContent("8 projects found")
        const headings = screen.getAllByRole("heading").map((heading) => heading.textContent)
        expect(headings.indexOf("GnoSwap")).toBeLessThan(headings.indexOf("More from the Gno ecosystem"))
        expect(screen.getByRole("link", { name: "Visit Bubble Rumble (opens in a new tab)" })).toBeInTheDocument()
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
        // One batched fetch for all visible cards.
        expect(fetchSummaries).toHaveBeenCalledTimes(1)
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

describe("AppIcon — hardened proxy render with monogram fallback (W0.6 / B7)", () => {
    const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"

    it("renders the icon through the hardened /api/nft/image proxy, NOT the raw gateway", async () => {
        fetchLiveApps.mockResolvedValue([listing({ pkgPath: "gno.land/r/samcrew/pretty", name: "Pretty App", iconCID: CID, status: "live" })])
        const { container } = renderWithProviders(<AppStore />, { route: "/test13/apps" })
        await screen.findByText("Pretty App")
        const img = container.querySelector("img.appicon")
        expect(img).not.toBeNull()
        // <img>-only + routed through the SSRF/raster-hardened proxy (not a raw gateway).
        expect(img!.tagName).toBe("IMG")
        expect(img!.getAttribute("src")).toContain("/api/nft/image?cid=")
        expect(img!.getAttribute("src")).toContain(CID)
        expect(img!.getAttribute("src")).not.toContain("gateway.lighthouse.storage")
    })

    it("falls back to the direct gateway when the proxy image errors (proxy down / octet-stream)", async () => {
        fetchLiveApps.mockResolvedValue([listing({ pkgPath: "gno.land/r/samcrew/pretty", name: "Pretty App", iconCID: CID, status: "live" })])
        const { container } = renderWithProviders(<AppStore />, { route: "/test13/apps" })
        await screen.findByText("Pretty App")
        const img = container.querySelector("img.appicon") as HTMLImageElement
        expect(img.getAttribute("src")).toContain("/api/nft/image?cid=")
        // Simulate the proxy image failing to load → one retry against the direct gateway.
        fireEvent.error(img)
        await waitFor(() => expect(img.getAttribute("src")).toBe(getIpfsGatewayUrl(CID)))
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

    it("renders detail-page screenshots through the hardened <img>-only proxy", async () => {
        const S1 = "bafybei" + "a".repeat(52)
        const S2 = "bafybei" + "b".repeat(52)
        fetchApp.mockResolvedValue(listing({
            pkgPath: "gno.land/r/samcrew/shots", name: "Shots App", status: "live",
            screenshotCIDs: [S1, S2, "not-a-cid"], // the junk CID must be dropped
        }))
        const { container } = renderWithProviders(appStoreRoutes, { route: "/test13/apps/r/samcrew/shots" })
        await screen.findByText("Shots App")
        const shots = container.querySelectorAll("img.appdetail__shot")
        expect(shots).toHaveLength(2) // only the two valid CIDs render
        shots.forEach((img) => {
            expect(img.tagName).toBe("IMG")
            expect(img.getAttribute("src")).toContain("/api/nft/image?cid=")
        })
    })
})
