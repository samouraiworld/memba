import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AppListing } from "../../../lib/appStore"
import { SignerContext, type SignerApi } from "../../sign/signerContext"
import StoreWindow from "./native"

const mocks = vi.hoisted(() => ({ fetchAppStrict: vi.fn() }))
vi.mock("../../../lib/config", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/config")>(),
    isAppStoreEnabled: () => true, isAppReviewsAvailable: () => true, isRealmValidOn: () => true,
}))
vi.mock("../../../lib/appStore", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/appStore")>(),
    fetchAppStrict: mocks.fetchAppStrict,
}))
vi.mock("../../../lib/grc20", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/grc20")>(),
    networkGasPrice: async () => ({ gas: 1000, ugnot: 1 }),
}))
vi.mock("../../../components/reviews/ReviewsSection", () => ({ ReviewsSection: () => <p>reviews</p> }))

const signer: SignerApi = { sign: vi.fn(), pending: [], notices: [], unread: 0, version: 0, markRead: vi.fn() }
const session = { status: "guest", address: "", network: { key: "mainnet", chainId: "gnoland-1" }, openConnect: vi.fn() } as never
const listing = (over: Partial<AppListing>): AppListing => ({
    id: 1, pkgPath: "gno.land/r/samcrew/app", name: "Test App", tagline: "", category: "Community", iconCID: "", appURL: "https://example.com/",
    publisher: "", status: "live", flagCount: 0, createdAt: 0, ...over,
})

function show() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={client}><SignerContext.Provider value={signer}>
        <StoreWindow section="apps/r/samcrew/app" session={session} open={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} fallback={null} />
    </SignerContext.Provider></QueryClientProvider>)
}

beforeEach(() => { mocks.fetchAppStrict.mockReset() })

describe("Store detail", () => {
    it("reads the listing again on Refresh reviews, so a renamed listing can be reviewed", async () => {
        mocks.fetchAppStrict.mockResolvedValueOnce(listing({})).mockResolvedValueOnce(listing({ name: "Renamed App" }))
        show()
        expect(await screen.findByRole("heading", { name: "Test App" })).toBeInTheDocument()
        expect(screen.getByText("Curator approved listing")).toBeInTheDocument()
        expect(screen.getByRole("link", { name: "Open external site ↗" })).toHaveAttribute("href", "https://example.com/")
        fireEvent.click(screen.getByRole("button", { name: "Refresh reviews" }))
        expect(await screen.findByRole("heading", { name: "Renamed App" })).toBeInTheDocument()
    })

    it.each([
        ["pending", "Pending review, not yet vetted by a curator"],
        ["rejected", "Rejected by a curator"],
        ["delisted", "Delisted"],
        ["unheard-of", "Unapproved listing"],
    ])("shows a %s listing under its own name, never as curator approved, with nothing to open or review", async (status, label) => {
        mocks.fetchAppStrict.mockResolvedValue(listing({ name: "Own Name", status, descr: "Its own description." }))
        show()
        expect(await screen.findByRole("heading", { name: "Own Name" })).toBeInTheDocument()
        expect(screen.getByText("Its own description.")).toBeInTheDocument()
        expect(screen.getByText(`This listing is ${status}. It is not in the approved catalogue.`)).toBeInTheDocument()
        expect(screen.getByText(label)).toBeInTheDocument()
        expect(screen.queryByText(/Curator approved/)).not.toBeInTheDocument()
        expect(screen.queryByRole("link", { name: /^Open/ })).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /^Open/ })).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Write a review" })).not.toBeInTheDocument()
    })
})
