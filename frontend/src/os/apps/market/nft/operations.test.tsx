import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CurationApplication } from "../../../../lib/nft/curation"
import { EvidenceError } from "../../../../lib/nft/evidence"
import { ReadError } from "../../../../lib/nft/read"
import type { MarketNftRoute } from "../../../nft/routes"
import type { WindowSpec } from "../../../shell/windows"
import NftLane from "./lane"

// The readers, the pin and the signer are stubbed: each is tested on its own.
const curation = vi.hoisted(() => ({ getCurationState: vi.fn(), getCurationManagers: vi.fn(), listApplications: vi.fn(), getApplication: vi.fn(), getCurationAccess: vi.fn() }))
const evidence = vi.hoisted(() => ({ fetchCommitted: vi.fn(), pinEvidence: vi.fn() }))
const ledger = vi.hoisted(() => ({ getCollection: vi.fn(), getToken: vi.fn() }))
const signing = vi.hoisted(() => ({ sign: vi.fn(), price: vi.fn() }))
vi.mock("../../../../lib/nft/curation", async (original) => ({ ...(await original<typeof import("../../../../lib/nft/curation")>()), ...curation }))
vi.mock("../../../../lib/nft/evidence", async (original) => ({ ...(await original<typeof import("../../../../lib/nft/evidence")>()), ...evidence }))
vi.mock("../../../../lib/nft/ledger", async (original) => ({ ...(await original<typeof import("../../../../lib/nft/ledger")>()), ...ledger }))
vi.mock("../../../../lib/grc20", async (original) => ({ ...(await original<object>()), networkGasPriceFresh: signing.price }))
vi.mock("../../../sign/signerContext", () => ({ useSigner: () => ({ sign: signing.sign }) }))
vi.mock("../../../../lib/config", async (original) => ({ ...(await original<typeof import("../../../../lib/config")>()), isNftEnabled: () => true, isRealmValidOn: () => true }))

const FOUNDER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const MANAGER = "g1c0j899h88nwyvnzvh5jagpq6fkkyuj76nld6t0"
const STRANGER = `g1${"x".repeat(38)}`
const pinned = { cid: `bafkrei${"a".repeat(52)}`, hash: "d".repeat(64) }
const filing: CurationApplication = {
    collection: "C3", founder: FOUNDER, statementHash: "a".repeat(64), statementCID: `bafy${"s".repeat(55)}`, revision: 2n, status: "changes_requested",
    reviewer: MANAGER, reasonHash: "b".repeat(64), reasonCID: `bafy${"r".repeat(55)}`, updatedAt: 1_700_000_000n,
}
const access = (more: object = {}) => ({ chainId: "chain-a", height: 9n, time: 9n, collection: "C3", account: MANAGER, founder: false, manager: true, conflicted: false, ...more })

function show(route: MarketNftRoute, address = "") {
    const push = vi.fn<(spec: WindowSpec) => void>()
    const openConnect = vi.fn()
    const session = { status: address ? "member" : "guest", address, openConnect, network: { key: "mainnet", chainId: "chain-a" } } as never
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><NftLane route={route} session={session} open={vi.fn()} push={push} /></QueryClientProvider>)
    return { push, openConnect }
}
const region = (name: string) => within(screen.getByRole("region", { name }))
const sectionOf = (spec: WindowSpec) => (spec.target?.kind === "app" ? spec.target.section : null)

describe("Operations", () => {
    beforeEach(() => {
        for (const mock of [...Object.values(curation), ...Object.values(evidence), ...Object.values(ledger), ...Object.values(signing)]) mock.mockReset()
        ledger.getCollection.mockResolvedValue({ id: "C3", name: "Relevés", creator: FOUNDER })
        curation.getCurationState.mockResolvedValue({ admin: MANAGER, pendingAdmin: "", activeManagers: 2, maxSeats: 5 })
        curation.getCurationManagers.mockResolvedValue([{ account: MANAGER, lead: true, until: 1_800_000_000n }])
        curation.listApplications.mockResolvedValue([filing])
        curation.getApplication.mockResolvedValue(filing)
        curation.getCurationAccess.mockResolvedValue(access())
        evidence.fetchCommitted.mockImplementation(async (cid: string) => (cid === filing.statementCID ? "Original drawings, signed." : "Show the sketches."))
        signing.price.mockResolvedValue({ gas: 1000, ugnot: 1 })
    })

    it("shows guests the seats, the managers and every application, and opens one", async () => {
        const { push } = show({ kind: "operations" })
        expect(await region("Managers").findByText("2 of 5 seats are filled. Admin: " + MANAGER + ".")).toBeInTheDocument()
        expect(region("Managers").getByText(MANAGER)).toBeInTheDocument()
        expect(region("Managers").getByText("Lead")).toBeInTheDocument()
        const row = await region("Applications").findByRole("button", { name: /Relevés/ })
        expect(row).toHaveTextContent("Changes requested")
        expect(row).toHaveTextContent("filing 2")
        fireEvent.click(row)
        expect(sectionOf(push.mock.lastCall![0])).toBe("nfts/ops/c/C3")
        expect(screen.getByRole("button", { name: "Operations" })).toHaveAttribute("aria-pressed", "true")
    })

    it("shows a failed read as an error, never as an empty desk", async () => {
        curation.listApplications.mockRejectedValue(new ReadError("offline"))
        show({ kind: "operations" })
        expect(await region("Applications").findByRole("alert")).toHaveTextContent("The applications could not be read from this network.")
        expect(region("Applications").queryByText("No collection has applied yet.")).toBeNull()
    })

    it("shows an application's statement and decision only as verified text, and asks a guest to connect to act", async () => {
        const { openConnect } = show({ kind: "application", collection: "C3" })
        const latest = within(await screen.findByRole("region", { name: "Latest filing" }))
        expect(await latest.findByText("Original drawings, signed.")).toBeInTheDocument()
        expect(await latest.findByText("Show the sketches.")).toBeInTheDocument()
        expect(evidence.fetchCommitted).toHaveBeenCalledWith(filing.statementCID, filing.statementHash)
        fireEvent.click(screen.getByRole("button", { name: "Connect" }))
        expect(openConnect).toHaveBeenCalledOnce()
        expect(curation.getCurationAccess).not.toHaveBeenCalled()
    })

    it("never shows a text that does not match its hash", async () => {
        evidence.fetchCommitted.mockRejectedValue(new EvidenceError("mismatch"))
        show({ kind: "application", collection: "C3" })
        const alerts = await within(await screen.findByRole("region", { name: "Latest filing" })).findAllByRole("alert")
        expect(alerts[0]).toHaveTextContent("The statement fetched from IPFS does not match its hash on chain, so it is not shown.")
        expect(within(alerts[0]).queryByRole("button", { name: "Retry" })).toBeNull()
    })

    it("lets the creator pin a statement and opens the review of exactly that filing", async () => {
        curation.getCurationAccess.mockResolvedValue(access({ account: FOUNDER, founder: true, manager: false, conflicted: true }))
        evidence.pinEvidence.mockResolvedValue(pinned)
        show({ kind: "application", collection: "C3" }, FOUNDER)
        const desk = await screen.findByRole("region", { name: "Apply for review" })
        fireEvent.change(within(desk).getByRole("textbox"), { target: { value: "New sketches attached." } })
        fireEvent.click(within(desk).getByRole("button", { name: "Pin and file again" }))
        await vi.waitFor(() => expect(signing.sign).toHaveBeenCalledOnce())
        expect(evidence.pinEvidence).toHaveBeenCalledWith("New sketches attached.")
        const request = signing.sign.mock.calls[0][0]
        expect(request.prepare().msgs[0].value).toMatchObject({ caller: FOUNDER, func: "Apply", args: ["C3", pinned.hash, pinned.cid] })
    })

    it("says why a pin failed, and opens no review", async () => {
        curation.getCurationAccess.mockResolvedValue(access({ account: FOUNDER, founder: true, manager: false, conflicted: true }))
        evidence.pinEvidence.mockRejectedValue(new Error("Sign in again to pin the text."))
        show({ kind: "application", collection: "C3" }, FOUNDER)
        const desk = await screen.findByRole("region", { name: "Apply for review" })
        fireEvent.change(within(desk).getByRole("textbox"), { target: { value: "x" } })
        fireEvent.click(within(desk).getByRole("button", { name: "Pin and file again" }))
        expect(await within(desk).findByRole("alert")).toHaveTextContent("Sign in again to pin the text.")
        expect(signing.sign).not.toHaveBeenCalled()
    })

    it("offers a recommended collection's creator no new filing", async () => {
        curation.getCurationAccess.mockResolvedValue(access({ account: FOUNDER, founder: true, manager: false, conflicted: true }))
        curation.getApplication.mockResolvedValue({ ...filing, status: "recommended" })
        show({ kind: "application", collection: "C3" }, FOUNDER)
        expect(await screen.findByText(/Your collection is recommended/)).toBeInTheDocument()
        expect(screen.queryByRole("region", { name: "Apply for review" })).toBeNull()
    })

    it("lets an unconflicted manager decide on the filing read, with a pinned reason", async () => {
        evidence.pinEvidence.mockResolvedValue(pinned)
        show({ kind: "application", collection: "C3" }, MANAGER)
        const desk = await screen.findByRole("region", { name: "Review this application" })
        fireEvent.change(within(desk).getByRole("combobox"), { target: { value: "recommended" } })
        fireEvent.change(within(desk).getByRole("textbox"), { target: { value: "Original work." } })
        fireEvent.click(within(desk).getByRole("button", { name: "Pin and decide" }))
        await vi.waitFor(() => expect(signing.sign).toHaveBeenCalledOnce())
        expect(signing.sign.mock.calls[0][0].prepare().msgs[0].value).toMatchObject({ caller: MANAGER, func: "Review", args: ["C3", "2", "recommended", pinned.hash, pinned.cid] })
    })

    it("tells a conflicted manager it cannot review, and shows anyone else no desk", async () => {
        curation.getCurationAccess.mockResolvedValue(access({ conflicted: true }))
        show({ kind: "application", collection: "C3" }, MANAGER)
        expect(await screen.findByText("You are conflicted on this collection, so you cannot review it.")).toBeInTheDocument()
        expect(screen.queryByRole("region", { name: "Review this application" })).toBeNull()
    })

    it("says when the role could not be read, instead of hiding what the account may do", async () => {
        curation.getCurationAccess.mockRejectedValue(new ReadError("offline"))
        show({ kind: "application", collection: "C3" }, FOUNDER)
        expect(await screen.findByText("The curation role could not be read from this network.")).toBeInTheDocument()
        expect(screen.queryByRole("textbox")).toBeNull()
    })

    it("shows the creator form from the chain's own answer, not from the ledger record", async () => {
        ledger.getCollection.mockResolvedValue({ id: "C3", name: "Relevés", creator: STRANGER })
        curation.getCurationAccess.mockResolvedValue(access({ account: FOUNDER, founder: true, manager: false, conflicted: true }))
        show({ kind: "application", collection: "C3" }, FOUNDER)
        expect(await screen.findByRole("region", { name: "Apply for review" })).toBeInTheDocument()
    })

    it("shows a member with no role nothing to sign", async () => {
        curation.getCurationAccess.mockResolvedValue(access({ account: STRANGER, manager: false }))
        show({ kind: "application", collection: "C3" }, STRANGER)
        await screen.findByText("Original drawings, signed.")
        await vi.waitFor(() => expect(curation.getCurationAccess).toHaveBeenCalled())
        expect(screen.queryByRole("textbox")).toBeNull()
    })

    it("says when a collection has not applied, and offers its creator the first filing", async () => {
        curation.getCurationAccess.mockResolvedValue(access({ account: FOUNDER, founder: true, manager: false, conflicted: true }))
        curation.getApplication.mockResolvedValue(null)
        show({ kind: "application", collection: "C3" }, FOUNDER)
        expect(await screen.findByText("This collection has not applied for review.")).toBeInTheDocument()
        expect(await screen.findByRole("button", { name: "Pin and apply" })).toBeDisabled()
    })
})
