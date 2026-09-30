import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AppListing } from "../../../lib/appStore"
import type { ReviewAct } from "../../../components/reviews/ReviewCard"
import type { SignRequest } from "../../sign/signer"
import { SignerContext, type SignerApi } from "../../sign/signerContext"
import StoreWindow from "./native"

const mocks = vi.hoisted(() => ({ fetchAppStrict: vi.fn(), fetchModerator: vi.fn(), price: vi.fn(), applies: vi.fn(), mounts: 0 }))
vi.mock("../../../lib/config", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/config")>(),
    isAppStoreEnabled: () => true, isAppReviewsAvailable: () => true, isRealmValidOn: () => true,
}))
vi.mock("../../../lib/appStore", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/appStore")>(),
    fetchAppStrict: mocks.fetchAppStrict,
}))
vi.mock("../../../lib/reviews", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/reviews")>(),
    fetchModerator: mocks.fetchModerator,
    assertReviewActionApplies: mocks.applies,
}))
vi.mock("../../../lib/grc20", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/grc20")>(),
    networkGasPriceFresh: () => mocks.price(),
}))
// Stands in for the list: shows who it acts for, asks for one action, and says what came back.
vi.mock("../../../components/reviews/ReviewsSection", async () => {
    const { useEffect, useState } = await import("react")
    return {
        ReviewsSection: ({ os }: { os?: { viewer: string | null; act: ReviewAct } }) => {
            const [result, setResult] = useState("")
            useEffect(() => { mocks.mounts += 1 }, [])
            return <div>
                <p>reviews for {os?.viewer ?? "a visitor"}</p>
                <button type="button" onClick={() => { os!.act({ kind: "flag", target: 7, on: "review" }).then((sent) => setResult(`sent: ${sent}`), (error: Error) => setResult(error.message)) }}>Flag review 7</button>
                <span>{result}</span>
            </div>
        },
    }
})

const signer: SignerApi = { sign: vi.fn(), pending: [], notices: [], unread: 0, version: 0, markRead: vi.fn() }
const openConnect = vi.fn()
const guest = { status: "guest", address: "", network: { key: "mainnet", chainId: "gnoland-1" }, openConnect } as never
const MEMBER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const member = { status: "member", address: MEMBER, network: { key: "mainnet", chainId: "gnoland-1" }, openConnect } as never
const listing = (over: Partial<AppListing>): AppListing => ({
    id: 1, pkgPath: "gno.land/r/samcrew/app", name: "Test App", tagline: "", category: "Community", iconCID: "", appURL: "https://example.com/",
    publisher: "", status: "live", flagCount: 0, createdAt: 0, ...over,
})

function show(section = "apps/r/samcrew/app", session = guest) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={client}><SignerContext.Provider value={signer}>
        <StoreWindow section={section} session={session} open={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} fallback={null} />
    </SignerContext.Provider></QueryClientProvider>)
}

beforeEach(() => {
    mocks.fetchAppStrict.mockReset(); mocks.fetchModerator.mockReset().mockResolvedValue(null)
    mocks.price.mockReset(); mocks.applies.mockReset().mockResolvedValue(undefined); mocks.mounts = 0
    vi.mocked(signer.sign).mockReset(); openConnect.mockReset()
})

describe("Store detail", () => {
    it("reads the listing again on Refresh reviews, so a renamed listing can be reviewed", async () => {
        mocks.fetchAppStrict.mockResolvedValueOnce(listing({})).mockResolvedValueOnce(listing({ name: "Renamed App" }))
        show()
        expect(await screen.findByRole("heading", { name: "Test App" })).toBeInTheDocument()
        expect(screen.getByText("Curator approved listing")).toBeInTheDocument()
        expect(screen.getByRole("link", { name: "Open external site ↗" })).toHaveAttribute("href", "https://example.com/")
        // The control for the cases below: a live listing can be reviewed.
        expect(screen.getByRole("button", { name: "Write a review" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Refresh reviews" }))
        expect(await screen.findByRole("heading", { name: "Renamed App" })).toBeInTheDocument()
    })

    it.each([
        ["pending", "Pending review, not yet vetted by a curator"],
        ["rejected", "Rejected by a curator"],
        ["delisted", "Delisted"],
        ["unheard-of", "Unapproved listing"],
        // A status named like an Object.prototype key must not read that key.
        ["constructor", "Unapproved listing"],
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

    it("says a listing has no status instead of printing an empty one", async () => {
        mocks.fetchAppStrict.mockResolvedValue(listing({ name: "Own Name", status: "" }))
        show()
        expect(await screen.findByRole("heading", { name: "Own Name" })).toBeInTheDocument()
        expect(screen.getByRole("status")).toHaveTextContent("This listing has no status. It is not in the approved catalogue.")
        expect(screen.getByText("Unapproved listing")).toBeInTheDocument()
    })

    it("says who listed the app, and that the lister moderates reviews only when the reviews realm names it", async () => {
        const TEAM = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"
        const OTHER = "g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpafgfmt"
        const trustOf = async () => (await screen.findByRole("heading", { name: "Before you open" })).closest("aside")!

        mocks.fetchAppStrict.mockResolvedValue(listing({ publisher: TEAM }))
        mocks.fetchModerator.mockResolvedValue(TEAM)
        const team = show()
        const trust = await trustOf()
        await waitFor(() => expect(trust).toHaveTextContent(`Listed by ${TEAM} (the Samourai team multisig, which also moderates reviews)`))
        expect(trust).not.toHaveTextContent("Publisher")
        team.unmount()

        // Another moderator, or a realm that returns none: the listing names the multisig and claims nothing else.
        for (const moderator of [OTHER, null]) {
            mocks.fetchModerator.mockClear().mockResolvedValue(moderator)
            const view = show()
            const aside = await trustOf()
            await waitFor(() => expect(mocks.fetchModerator).toHaveBeenCalled())
            await waitFor(() => expect(aside).toHaveTextContent(`Listed by ${TEAM} (the Samourai team multisig)`))
            expect(aside).not.toHaveTextContent("moderates")
            view.unmount()
        }

        mocks.fetchAppStrict.mockResolvedValue(listing({ publisher: OTHER }))
        mocks.fetchModerator.mockResolvedValue(TEAM)
        show()
        const other = await trustOf()
        expect(other).toHaveTextContent(`Listed by ${OTHER}`)
        expect(other).not.toHaveTextContent("Samourai team")
        expect(other).not.toHaveTextContent("moderates")
    })

    it("dates Memba's link check only when the listing opens the link the record dates", async () => {
        const boards = { pkgPath: "gno.land/r/gnoland/boards2/v0", name: "Boards" }
        mocks.fetchAppStrict.mockResolvedValue(listing({ ...boards, appURL: "https://gno.land/r/gnoland/boards2/v0" }))
        const checked = show("apps/r/gnoland/boards2/v0")
        expect(await screen.findByText("Link checked 2026-09-22")).toBeInTheDocument()
        checked.unmount()

        // GnoSwap's record dates its router realm, not the site the listing opens.
        mocks.fetchAppStrict.mockResolvedValue(listing({ pkgPath: "gno.land/r/gnoswap/router", name: "GnoSwap", appURL: "https://gnoswap.io/" }))
        show("apps/r/gnoswap/router")
        expect(await screen.findByRole("heading", { name: "GnoSwap" })).toBeInTheDocument()
        expect(screen.queryByText(/Link checked/)).not.toBeInTheDocument()
    })
})

describe("Store detail: an action on a review", () => {
    const flag = () => fireEvent.click(screen.getByRole("button", { name: "Flag review 7" }))
    const signed = () => vi.mocked(signer.sign).mock.calls[0][0] as SignRequest

    it("asks a visitor to connect, without reading a fee or opening a sheet", async () => {
        mocks.fetchAppStrict.mockResolvedValue(listing({}))
        show()
        expect(await screen.findByText("reviews for a visitor")).toBeInTheDocument()
        flag()
        expect(await screen.findByText("sent: false")).toBeInTheDocument()
        expect(openConnect).toHaveBeenCalledTimes(1)
        expect(mocks.price).not.toHaveBeenCalled()
        expect(signer.sign).not.toHaveBeenCalled()
    })

    it("opens the signing sheet for the member at the fee read at that click, and reloads the list when the chain has it", async () => {
        mocks.fetchAppStrict.mockResolvedValue(listing({}))
        mocks.price.mockResolvedValue({ gas: 1000, ugnot: 2 })
        show(undefined, member)
        expect(await screen.findByText(`reviews for ${MEMBER}`)).toBeInTheDocument()
        flag()
        // Handed over: nothing is sent until the sheet is signed.
        expect(await screen.findByText("sent: false")).toBeInTheDocument()
        expect(signer.sign).toHaveBeenCalledTimes(1)
        const request = signed()
        expect([request.title, request.summary]).toEqual(["Flag a review", "Flag a review of Test App"])
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([["Account", MEMBER], ["Review", "#7"], ["Network", "gnoland-1"], ["Network fee", "0.0408 GNOT"]]))
        expect(request.prepare(undefined).msgs[0].value).toMatchObject({ caller: MEMBER, func: "Flag", args: ["7"] })

        const before = mocks.mounts
        // A cancelled sheet leaves the list as it is; a landed action reads it again.
        request.onSettled?.("cancelled", undefined)
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(mocks.mounts).toBe(before)
        request.onSettled?.("confirmed", undefined)
        await waitFor(() => expect(mocks.mounts).toBe(before + 1))
    })

    it("opens no sheet when the fee cannot be read, and says so", async () => {
        mocks.fetchAppStrict.mockResolvedValue(listing({}))
        mocks.price.mockRejectedValue(new Error("offline"))
        show(undefined, member)
        await screen.findByText(`reviews for ${MEMBER}`)
        flag()
        expect(await screen.findByText("The network fee could not be read. Try again in a moment.")).toBeInTheDocument()
        expect(signer.sign).not.toHaveBeenCalled()
    })

    it("opens no sheet for a window that closed, or a list that reloaded, while the fee was read", async () => {
        mocks.fetchAppStrict.mockResolvedValue(listing({}))
        let answer: (price: { gas: number; ugnot: number }) => void = () => {}
        mocks.price.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
        const closed = show(undefined, member)
        await screen.findByText(`reviews for ${MEMBER}`)
        flag()
        closed.unmount()
        answer({ gas: 1000, ugnot: 1 })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(signer.sign).not.toHaveBeenCalled()

        mocks.price.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
        show(undefined, member)
        await screen.findByText(`reviews for ${MEMBER}`)
        flag()
        fireEvent.click(screen.getByRole("button", { name: "Refresh reviews" }))
        answer({ gas: 1000, ugnot: 1 })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(signer.sign).not.toHaveBeenCalled()
    })
})

