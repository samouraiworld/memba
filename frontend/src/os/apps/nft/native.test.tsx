import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { GNO_RPC_URL, NETWORKS } from "../../../lib/config"
import { LedgerReadError, NFT_LEDGER_PATH } from "../../../lib/nft/ledger"
import NftWindow from "./native"

// `legacy` answers for every realm other than the ledger: it must never open the home.
const availability = vi.hoisted(() => ({ enabled: false, ledger: false, legacy: false }))
const listNewestCollections = vi.hoisted(() => vi.fn())
const real = vi.hoisted(() => ({ reader: false }))
const queryEval = vi.hoisted(() => vi.fn())
vi.mock("../../../lib/dao/shared", async (original) => ({ ...(await original<typeof import("../../../lib/dao/shared")>()), queryEval }))
vi.mock("../../../lib/nft/ledger", async (original) => {
    const ledger = await original<typeof import("../../../lib/nft/ledger")>()
    return { ...ledger, listNewestCollections: (...args: Parameters<typeof ledger.listNewestCollections>) => real.reader ? ledger.listNewestCollections(...args) : listNewestCollections(...args) }
})
vi.mock("../../../lib/config", async (original) => ({
    ...(await original<typeof import("../../../lib/config")>()),
    isNftEnabled: () => availability.enabled,
    isRealmValidOn: (_network: string, path: string) => path === NFT_LEDGER_PATH ? availability.ledger : availability.legacy,
}))

const session = (isTestnet: boolean) => {
    const key = isTestnet ? "testnet12" : "mainnet"
    return { status: "guest", network: { key, isTestnet, chainId: NETWORKS[key]?.chainId ?? "test12" } } as never
}
const item = (id: string, name: string, symbol: string, mode: string, minted: bigint, maxSupply: bigint, sealed = false) => ({ id, name, symbol, mode, minted, maxSupply, sealed })
const founders = item("C1", "Founders", "FND", "open", 2n, 7n)

function show({ section = null, testnet = true, openApp = vi.fn() }: { section?: string | null; testnet?: boolean; openApp?: () => void } = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={client}>
            <NftWindow section={section} query={undefined} session={session(testnet)} open={vi.fn()} openApp={openApp} close={() => {}} toast={() => {}} fallback={<p>classic page</p>} />
        </QueryClientProvider>,
    )
}

describe("NFT window", () => {
    beforeEach(() => {
        availability.enabled = false; availability.ledger = false; availability.legacy = false
        real.reader = false; listNewestCollections.mockReset(); queryEval.mockReset()
    })

    it("on mainnet with the flag off, names the absent registry and the disabled build without reading the chain", () => {
        const openApp = vi.fn()
        show({ testnet: false, openApp })
        expect(screen.getByRole("note").textContent).toBe(`NFT unavailable here The NFT ledger is not deployed on ${NETWORKS.mainnet.chainId}. NFT features are disabled in this build.`)
        expect(screen.queryByText("classic page")).toBeNull()
        expect(screen.queryByRole("region", { name: "Collections" })).toBeNull()
        expect(listNewestCollections).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: /Open Market/ }))
        expect(openApp).toHaveBeenCalledWith("market")
    })

    it("keeps an allowlisted ledger closed while the NFT build flag is off", () => {
        availability.ledger = true
        show()
        expect(screen.getByRole("note").textContent).toBe("NFT unavailable here NFT features are disabled in this build.")
        expect(listNewestCollections).not.toHaveBeenCalled()
    })

    it("stays closed when the flag is on but only legacy realms are allowlisted", () => {
        availability.enabled = true
        availability.legacy = true
        show()
        expect(screen.getByRole("note").textContent).toBe("NFT unavailable here The NFT ledger is not available on this network.")
        expect(screen.getByRole("button", { name: /Open Market/ })).toBeInTheDocument()
        expect(listNewestCollections).not.toHaveBeenCalled()
    })

    it("lists the ledger's collections for a guest once the flag and the ledger are both available", async () => {
        availability.enabled = true
        availability.ledger = true
        let resolve!: (newest: unknown) => void
        listNewestCollections.mockReturnValue(new Promise((done) => { resolve = done }))
        const openApp = vi.fn()
        show({ openApp })
        const rail = screen.getByRole("region", { name: "Collections" })
        expect(rail).toHaveTextContent("Reading collections…")
        expect(screen.queryByText("No collections have been created yet.")).toBeNull()
        expect(listNewestCollections).toHaveBeenCalledWith(GNO_RPC_URL, 20)

        resolve({ total: 5n, collections: [
            founders, item("C2", "Badges", "BDG", "soulbound", 5n, 0n), item("C3", "Gallery\u200b", "GAL", "royalty_protected", 0n, 100n),
            item("C4", "Finished", "FIN", "open", 3n, 0n, true), item("C5", "Halted", "HLT", "open", 3n, 9n, true),
        ] })
        expect(await screen.findByText("Founders")).toBeInTheDocument()
        expect(rail).not.toHaveTextContent("Reading collections…")
        expect(rail).toHaveTextContent("FND2 / 7 mintedTransferable")
        expect(rail).toHaveTextContent("BDG5 minted · open editionSoulbound")
        expect(rail).toHaveTextContent("Gallery[U+200B]GAL0 / 100 mintedRoyalty-protected")
        expect(rail).toHaveTextContent("FinishedFIN3 minted · closed editionTransferable")
        expect(rail).toHaveTextContent("HaltedHLT3 / 9 minted · closed editionTransferable")
        expect(screen.queryByRole("status")).toBeNull()
        expect(screen.getAllByRole("listitem")).toHaveLength(5)
        expect(rail).not.toHaveTextContent("newest")

        expect(screen.queryByRole("note")).toBeNull()
        expect(screen.queryByText(/connect/i)).toBeNull()
        for (const legacy of [/Create a collection/, /Your studio/, /Browse NFTs/]) expect(screen.queryByRole("button", { name: legacy })).toBeNull()
        expect(screen.getAllByRole("button")).toHaveLength(1)
        fireEvent.click(screen.getByRole("button", { name: /Open Market/ }))
        expect(openApp).toHaveBeenCalledWith("market")
    })

    it("says it shows the newest collections when there are more", async () => {
        availability.enabled = true
        availability.ledger = true
        listNewestCollections.mockResolvedValue({ total: 31n, collections: Array.from({ length: 20 }, (_, n) => item(`C${31 - n}`, `Collection ${31 - n}`, "COL", "open", 1n, 0n)) })
        show()
        const note = await screen.findByText("The 20 newest of 31 collections, newest first.")
        expect(note).not.toHaveAttribute("role")
        expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Collection 31")
    })

    it("shows a read failure as an error with a retry, never as an empty ledger", async () => {
        availability.enabled = true
        availability.ledger = true
        listNewestCollections.mockRejectedValueOnce(new LedgerReadError("Could not read collections")).mockResolvedValueOnce({ total: 1n, collections: [founders] })
        show()
        expect(await screen.findByRole("alert")).toHaveTextContent("Collections could not be read from this network.")
        expect(screen.queryByText("No collections have been created yet.")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("Founders")).toBeInTheDocument()
        expect(screen.queryByRole("alert")).toBeNull()
        expect(listNewestCollections).toHaveBeenCalledTimes(2)
    })

    it("shows data that breaks the ledger's rules as unusable, with no retry that could only fail again", async () => {
        availability.enabled = true
        availability.ledger = true
        listNewestCollections.mockRejectedValue(new Error("Invalid collection mode"))
        show()
        expect(await screen.findByRole("alert")).toHaveTextContent("This network's collection data does not follow the ledger's rules, so it is not shown.")
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
        expect(screen.queryByText("No collections have been created yet.")).toBeNull()
    })

    it("reads the chain through the real reader: the newest collections of the realm's own answer", async () => {
        availability.enabled = true
        availability.ledger = true
        real.reader = true
        const list = `[{"id":"C1","creator":"g1den8gttrwfjkzar0wf047h6lta047h6l69tljg","name":"Sample","symbol":"SAMPLE","image":"ipfs://image","mode":"open","maxSupply":"0","sealed":false,"minted":"0"},{"id":"C2","creator":"g1den8gttrwfjkzar0wf047h6lta047h6l69tljg","name":"Badges","symbol":"BDG","image":"","mode":"soulbound","maxSupply":"3","sealed":false,"minted":"1"}]`
        queryEval.mockImplementation(async (_rpc: string, path: string, expr: string) => {
            expect(path).toBe(NFT_LEDGER_PATH)
            return expr === "Count()" ? "(2 int64)" : `(${JSON.stringify(list)} string)`
        })
        show()
        const rows = await screen.findAllByRole("listitem")
        expect(rows.map((row) => row.textContent)).toEqual(["BadgesBDG1 / 3 mintedSoulbound", "SampleSAMPLE0 minted · open editionTransferable"])
    })

    it("shows an empty ledger as empty, not as an error", async () => {
        availability.enabled = true
        availability.ledger = true
        listNewestCollections.mockResolvedValue({ total: 0n, collections: [] })
        show()
        expect(await screen.findByText("No collections have been created yet.")).toBeInTheDocument()
        expect(screen.queryByRole("alert")).toBeNull()
    })

    it("renders the fallback for every section other than the home, without reading the chain", () => {
        availability.enabled = true
        availability.ledger = true
        show({ section: "create", testnet: false })
        expect(screen.getByText("classic page")).toBeInTheDocument()
        expect(screen.queryByRole("region", { name: "Collections" })).toBeNull()
        expect(listNewestCollections).not.toHaveBeenCalled()
    })
})
