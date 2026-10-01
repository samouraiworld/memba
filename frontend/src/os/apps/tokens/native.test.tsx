import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NETWORKS } from "../../../lib/config"
import { TOKEN_LAUNCHPAD_PATH } from "../../../lib/tokenLaunchpadClient"
import { TOKEN_LAUNCHPAD_SALES_PATH } from "../../../lib/tokenLaunchpadSalesClient"
import { prepareAirdropManifest } from "../../../lib/tokenLaunchpadAirdropManifest"
import type { SignRequest } from "../../sign/signer"
import TokensWindow from "./native"

const availability = vi.hoisted(() => ({ ledger: false, sales: false, factory: false }))
const queryEval = vi.hoisted(() => vi.fn())
vi.mock("../../../lib/dao/shared", async (original) => ({ ...(await original<typeof import("../../../lib/dao/shared")>()), queryEval }))
const sign = vi.hoisted(() => vi.fn(() => true))
vi.mock("../../sign/signerContext", () => ({ useSigner: () => ({ sign }) }))
vi.mock("../../../lib/grc20", async (original) => ({ ...(await original<typeof import("../../../lib/grc20")>()), networkGasPriceFresh: async () => ({ gas: 1000, ugnot: 1 }) }))
vi.mock("../../../lib/config", async (original) => {
    const config = await original<typeof import("../../../lib/config")>()
    return {
        ...config,
        ACTIVE_NETWORK_KEY: "mainnet",
        currentNetworkKey: () => "mainnet",
        isRealmValidOn: (_network: string, path: string) =>
            path === "gno.land/r/samcrew/launchpad/tokens/v1" ? availability.ledger
                : path === "gno.land/r/samcrew/launchpad/sales/v1" || path === "gno.land/r/samcrew/launchpad/config/v1" ? availability.sales
                : path === config.GRC20_FACTORY_PATH ? availability.factory : false,
    }
})

const CREATOR = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"
const MEMBER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const SALES = "g1rdjmeglm55p7evsxrk0y639l2gqwemh7qpaw53"

// The ledger's GRC20 ID ends in the token number in seven cford32 digits.
const ledgerSuffix = (id: string) => Array.from({ length: 7 }, (_, i) => "0123456789abcdefghjkmnpqrstvwxyz"[(Number(id.slice(1)) >> (5 * (6 - i))) & 31]).join("")
const token = (id: string, mode: string, name: string) => ({
    id, registryKey: `${TOKEN_LAUNCHPAD_PATH}.${id}`, grc20Id: `${TOKEN_LAUNCHPAD_PATH}.${id}.${ledgerSuffix(id)}`,
    issuer: SALES, creator: CREATOR, mode, name, ticker: "FAIR", decimals: 6,
    initialSupply: "1000000000", maxSupply: "1000000000", totalSupply: "1000000000", configVersion: "4",
    currencyKey: "ugnot", description: "", image: "", website: "", xHandle: "", telegram: "",
    metadataFrozen: false, mintAuthority: "", pendingMintAuthority: "", mintRenounced: false,
})
// 600 lots of 1,000 FAIR; 300 GNOT raised at 0.5 GNOT a lot; 2% fee.
const sale = {
    creator: CREATOR, quoteCurrency: "ugnot", configVersion: "4", primaryFeeBps: "200",
    allocation: "600000000", lotSize: "1000000", walletCapLots: "300", hardCapLots: "600",
    softCapQuote: "200000000", start: "100", end: "200", startPrice: "500000", floorPrice: "500000",
    decrement: "0", intervalSeconds: "60", allowlistRoot: "", holdingGates: "",
    totalLots: "600", totalDeposits: "300000000", hardClosedAt: "150", cancelled: false,
    settled: true, succeeded: true, closeAt: "150", closePrice: "500000", soldTokens: "600000000",
    grossQuote: "300000000", primaryFeeQuote: "6000000", creatorQuote: "294000000", proceedsReleased: false,
    refundQuote: "0", unsoldTokens: "0",
}
const order = { buyer: MEMBER, lots: "300", deposit: "150000000", claimableTokens: "300000000", claimableRefund: "0", settled: true, claimed: false }

const qjson = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`
const launchOf = (fairSale: unknown, extra: Record<string, unknown> = {}) =>
    qjson({ schema: "launchpad-sales-v1", token: token("T1", "fairsale", "Fair Token"), tokenLiability: "0", vestingCount: 0, fairSale, airdrop: null, ...extra })
const now = Math.floor(Date.now() / 1000)
const openSale = { ...sale, start: String(now - 100), end: String(now + 3600), totalLots: "10", totalDeposits: "5000000", hardClosedAt: "0",
    settled: false, succeeded: false, closeAt: "0", closePrice: "0", soldTokens: "0", grossQuote: "0", primaryFeeQuote: "0", creatorQuote: "0", unsoldTokens: "0" }
const gate = (open: boolean) => qjson({ schema: "launchpad-config-action-v1", lane: "fairsale", currency: "ugnot", version: "4", paused: !open, allowlisted: true, laneReady: true, configGateOpen: open })
function chain(overrides: Record<string, string> = {}) {
    queryEval.mockImplementation(async (_rpc: string, path: string, expression: string) => {
        const name = expression.slice(0, expression.indexOf("("))
        if (name in overrides) return overrides[name]
        if (path === TOKEN_LAUNCHPAD_PATH && name === "ListTokensJSON") return qjson([token("T1", "fairsale", "Fair Token"), token("T2", "direct_fixed", "Plain Token")])
        if (path === TOKEN_LAUNCHPAD_PATH && name === "BalanceOf") return "(300000000 int64)"
        if (path === TOKEN_LAUNCHPAD_SALES_PATH && name === "LaunchJSON") {
            return expression.includes('"T1"')
                ? qjson({ schema: "launchpad-sales-v1", token: token("T1", "fairsale", "Fair Token"), tokenLiability: "0", vestingCount: 0, fairSale: sale, airdrop: null })
                : qjson({ schema: "launchpad-sales-v1", token: token("T2", "direct_fixed", "Plain Token"), tokenLiability: "0", vestingCount: 0, fairSale: null, airdrop: null })
        }
        if (path === TOKEN_LAUNCHPAD_SALES_PATH && name === "FairBuyerJSON") return qjson(order)
        if (name === "ActionStatusJSON") return gate(true)
        throw new Error(`unexpected read ${expression}`)
    })
}

function show(key: "mainnet" | "testnet12", member = false) {
    const session = { status: member ? "member" : "guest", address: member ? MEMBER : undefined, openConnect: vi.fn(), network: { key, chainId: NETWORKS[key]?.chainId ?? "test12" } }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
        <QueryClientProvider client={client}>
            <TokensWindow section={null} query={undefined} session={session as never} active open={vi.fn()} push={vi.fn()} openApp={vi.fn()} close={() => {}} toast={() => {}} fallback={<p>classic token page</p>} />
        </QueryClientProvider>,
    )
    return { ...view, session }
}
const signed = () => (sign.mock.calls.at(-1) as unknown as [SignRequest])[0].prepare(undefined).msgs[0].value as { func: string; args: string[]; send: string }
const reads = () => queryEval.mock.calls.map(call => call[2] as string)

describe("Tokens window", () => {
    beforeEach(() => {
        availability.ledger = false; availability.sales = false; availability.factory = false
        queryEval.mockReset()
        sign.mockClear()
        chain()
    })

    it("says the Launchpad is not deployed on mainnet, without reading the chain or showing the classic page", () => {
        show("mainnet")
        expect(screen.getByRole("note").textContent).toBe(`Token Launchpad unavailable here The Token Launchpad is not deployed on ${NETWORKS.mainnet.chainId}.`)
        expect(screen.queryByText("classic token page")).toBeNull()
        expect(queryEval).not.toHaveBeenCalled()
    })

    it("keeps the classic factory pages where only the factory exists", () => {
        availability.factory = true
        show("testnet12")
        expect(screen.getByText("classic token page")).toBeInTheDocument()
        expect(screen.queryByRole("note")).toBeNull()
    })

    it("lets a guest browse tokens and a settled sale without reading any account", async () => {
        availability.ledger = true; availability.sales = true
        show("mainnet")
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        expect(await screen.findByText("Settled: the sale succeeded.")).toBeInTheDocument()
        expect(screen.getByText(SALES)).toBeInTheDocument()
        expect(screen.getByText("600 of 600 lots of 1 FAIR")).toBeInTheDocument()
        expect(screen.getByText("0.5 GNOT")).toBeInTheDocument()
        expect(screen.getByText("2% of what is raised")).toBeInTheDocument()
        expect(screen.getByText("300 GNOT at 0.5 GNOT per lot")).toBeInTheDocument()
        expect(screen.getByText("294 GNOT (anyone can release it)")).toBeInTheDocument()
        expect(screen.getByText("6 GNOT")).toBeInTheDocument()
        expect(reads().some(read => read.startsWith("BalanceOf") || read.startsWith("FairBuyerJSON"))).toBe(false)
        fireEvent.click(screen.getByRole("button", { name: /Plain Token/ }))
        expect(await screen.findByText("This token has no sale, airdrop or vesting.")).toBeInTheDocument()
    })

    it("shows a member their balance and what their order pays once settled", async () => {
        availability.ledger = true; availability.sales = true
        show("mainnet", true)
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        expect(await screen.findByText("300 FAIR")).toBeInTheDocument()
        expect(await screen.findByText("Your order: 300 lots, 150 GNOT deposited. It pays 300 FAIR and 0 GNOT back.")).toBeInTheDocument()
        expect(reads()).toContain(`FairBuyerJSON("T1", address("${MEMBER}"))`)
    })

    it("tells a buyer to wait for settlement instead of showing nothing to claim", async () => {
        availability.ledger = true; availability.sales = true
        chain({ FairBuyerJSON: qjson({ ...order, claimableTokens: "0", settled: false }) })
        show("mainnet", true)
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        expect(await screen.findByText(/What it pays is known once the sale is settled\./)).toBeInTheDocument()
    })

    it("names data that breaks the rules as unusable, and offers a retry for a failed read", async () => {
        availability.ledger = true; availability.sales = true
        chain({ LaunchJSON: qjson({ schema: "launchpad-sales-v1", token: token("T1", "fairsale", "Fair Token"), tokenLiability: "0", vestingCount: 0, fairSale: { ...sale, primaryFeeQuote: "1" }, airdrop: null }) })
        show("mainnet")
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        expect(await screen.findByText("This network's launch does not follow the Launchpad's rules, so it is not shown.")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()

        queryEval.mockReset()
        queryEval.mockRejectedValue(new Error("offline"))
        fireEvent.click(screen.getByRole("button", { name: /Plain Token/ }))
        expect(await screen.findByText("The launch could not be read from this network.")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
    })

    it("lists tokens but says launch details are unavailable where the sales realm is not allowlisted", async () => {
        availability.ledger = true
        show("mainnet")
        fireEvent.click(await screen.findByRole("button", { name: /Plain Token/ }))
        expect(screen.getByText("Launch details are not available on this network.")).toBeInTheDocument()
        expect(reads().some(read => read.startsWith("LaunchJSON"))).toBe(false)
    })

    it("words an open sale by its window and by the fair-sale lane", async () => {
        availability.ledger = true; availability.sales = true
        chain({ LaunchJSON: launchOf(openSale) })
        const { unmount } = show("mainnet")
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        expect(await screen.findByText(/^Open until .+\.$/)).toBeInTheDocument()
        expect(screen.getByText("Ordered")).toBeInTheDocument()
        expect(reads()).toContain('ActionStatusJSON("fairsale", "ugnot")')
        unmount()

        chain({ LaunchJSON: launchOf(openSale), ActionStatusJSON: gate(false) })
        show("mainnet")
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        expect(await screen.findByText(/New orders are paused on the Launchpad; settlement and claims are not affected\.$/)).toBeInTheDocument()
        expect(screen.queryByLabelText("Lots to order")).toBeNull()
    })

    it("words a cancelled and a failed sale as what they are", async () => {
        availability.ledger = true; availability.sales = true
        chain({ LaunchJSON: launchOf({ ...openSale, totalLots: "0", totalDeposits: "0", cancelled: true }) })
        const { unmount } = show("mainnet")
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        expect(await screen.findByText("Cancelled before any order; the allocation went back to the creator.")).toBeInTheDocument()
        expect(reads().some(read => read.startsWith("ActionStatusJSON"))).toBe(false)
        unmount()

        chain({ LaunchJSON: launchOf({ ...openSale, settled: true, refundQuote: "5000000", unsoldTokens: "600000000" }) })
        show("mainnet")
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        expect(await screen.findByText("Settled: the sale missed its soft cap, so every buyer can claim a full refund.")).toBeInTheDocument()
        expect(screen.queryByText("Raised")).toBeNull()
    })

    it("says an order was paid out once claimed", async () => {
        availability.ledger = true; availability.sales = true
        chain({ FairBuyerJSON: qjson({ ...order, claimableTokens: "0", claimed: true }) })
        show("mainnet", true)
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        expect(await screen.findByText("Your order: 300 lots, 150 GNOT deposited. Paid out.")).toBeInTheDocument()
    })

    it("shows airdrop progress and each vesting record, with what a revoke left and a pending move", async () => {
        availability.ledger = true; availability.sales = true
        const record = (index: number, extra: Record<string, unknown>) => qjson({ index, beneficiary: MEMBER, pendingBeneficiary: "", total: "100000000", claimed: "10000000", start: "1", cliff: "0", duration: "10", revocable: true, revoked: false, revokedVested: "0", ...extra })
        queryEval.mockImplementation(async (_rpc: string, path: string, expression: string) => {
            if (expression.startsWith("ListTokensJSON")) return qjson([token("T1", "fairsale", "Fair Token")])
            if (expression.startsWith("LaunchJSON")) return launchOf(sale, { vestingCount: 2, airdrop: { root: "a".repeat(64), total: "1000000", claimed: "250000" } })
            if (expression === 'VestingJSON("T1", 0)') return record(0, { revoked: true, revokedVested: "30000000" })
            if (expression === 'VestingJSON("T1", 1)') return record(1, { pendingBeneficiary: CREATOR })
            throw new Error(`unexpected read ${path} ${expression}`)
        })
        show("mainnet")
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        expect(await screen.findByText("0.25 of 1 FAIR claimed.")).toBeInTheDocument()
        expect(await screen.findByText(/Record 1 of 2: 10 of 30 FAIR claimed, revoked: 30 of the 100 had vested, for/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Next record" }))
        expect(await screen.findByText(/Record 2 of 2: 10 of 100 FAIR claimed, for/)).toBeInTheDocument()
        expect(screen.getByText(/is pending; no claim until it is accepted or cancelled\./)).toBeInTheDocument()
    })

    it("pages through the list", async () => {
        availability.ledger = true; availability.sales = true
        const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => token(`T${from + i}`, "direct_fixed", `Token ${from + i}`))
        chain({ ListTokensJSON: qjson(page(1, 20)) })
        show("mainnet")
        expect(await screen.findByRole("button", { name: /Token 20/ })).toBeInTheDocument()
        chain({ ListTokensJSON: qjson(page(21, 1)) })
        fireEvent.click(screen.getByRole("button", { name: "Next" }))
        expect(await screen.findByRole("button", { name: /Token 21/ })).toBeInTheDocument()
        expect(reads()).toContain("ListTokensJSON(1, 20)")
        expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
    })

    it("offers a retry for a failed list or balance read", async () => {
        availability.ledger = true
        queryEval.mockRejectedValue(new Error("offline"))
        const { unmount } = show("mainnet")
        expect(await screen.findByText("The token list could not be read from this network.")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
        unmount()

        chain({ BalanceOf: "(not an int)" })
        show("mainnet", true)
        fireEvent.click(await screen.findByRole("button", { name: /Plain Token/ }))
        expect(await screen.findByText("This network's balance does not follow the Launchpad's rules, so it is not shown.")).toBeInTheDocument()
    })

    it("opens the creation wizard to a guest and comes back to the list", async () => {
        availability.ledger = true; availability.sales = true
        show("mainnet")
        fireEvent.click(screen.getByRole("button", { name: "Create a token" }))
        expect(screen.getByRole("heading", { name: "Token" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
        expect(await screen.findByRole("button", { name: /Fair Token/ })).toBeInTheDocument()
    })

    it("lets a member order whole lots at the current price, attaching the bound, within the wallet cap", async () => {
        availability.ledger = true; availability.sales = true
        chain({ LaunchJSON: launchOf(openSale), FairBuyerJSON: qjson({ ...order, lots: "299", deposit: "149500000", claimableTokens: "0", settled: false }) })
        show("mainnet", true)
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        const input = await screen.findByLabelText("Lots to order")
        await screen.findByText(/Your order: 299 lots/)
        fireEvent.change(input, { target: { value: "2" } })
        expect(screen.getByText("You can order up to 1 lots.")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Order" })).toBeDisabled()
        fireEvent.change(input, { target: { value: "1" } })
        expect(screen.getByText("1 FAIR for at most 0.5 GNOT")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Order" }))
        await waitFor(() => expect(sign).toHaveBeenCalled())
        expect(signed()).toMatchObject({ func: "ContributeFair", args: ["T1", "1", "500000"], send: "500000ugnot" })
    })

    it("asks a guest to connect to order", async () => {
        availability.ledger = true; availability.sales = true
        chain({ LaunchJSON: launchOf(openSale) })
        const { session } = show("mainnet")
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        fireEvent.click(await screen.findByRole("button", { name: "Connect to order" }))
        expect(session.openConnect).toHaveBeenCalled()
        expect(sign).not.toHaveBeenCalled()
    })

    it("offers settlement of a closed sale, the claim of a settled order and the release of proceeds", async () => {
        availability.ledger = true; availability.sales = true
        chain({ LaunchJSON: launchOf({ ...openSale, hardClosedAt: String(now - 10) }), FairBuyerJSON: qjson({ ...order, settled: false, claimableTokens: "0" }) })
        const { unmount } = show("mainnet", true)
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        fireEvent.click(await screen.findByRole("button", { name: "Settle the sale" }))
        await waitFor(() => expect(sign).toHaveBeenCalled())
        expect(signed()).toMatchObject({ func: "SettleFair", args: ["T1"], send: "" })
        expect(screen.queryByRole("button", { name: "Claim" })).toBeNull()
        unmount()

        show("mainnet", true)
        chain()
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        fireEvent.click(await screen.findByRole("button", { name: "Claim" }))
        await waitFor(() => expect(signed()).toMatchObject({ func: "ClaimFair", args: ["T1", MEMBER] }))
        fireEvent.click(screen.getByRole("button", { name: "Release the proceeds" }))
        await waitFor(() => expect(signed()).toMatchObject({ func: "ReleaseFairProceeds", args: ["T1"] }))
        expect(screen.queryByRole("button", { name: "Settle the sale" })).toBeNull()
    })

    it("offers a member the vested part of a record, for its beneficiary", async () => {
        availability.ledger = true; availability.sales = true
        chain({
            LaunchJSON: launchOf(sale, { vestingCount: 1 }),
            VestingJSON: qjson({ index: 0, beneficiary: CREATOR, pendingBeneficiary: "", total: "100000000", claimed: "0", start: String(now - 1_000), cliff: "0", duration: "2000", revocable: false, revoked: false, revokedVested: "0" }),
        })
        show("mainnet", true)
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        fireEvent.click(await screen.findByRole("button", { name: /^Claim 4\d(\.\d+)? FAIR for the beneficiary$/ }))
        await waitFor(() => expect(signed()).toMatchObject({ func: "ClaimVested", args: ["T1", "0"], send: "" }))
    })

    it("checks a pasted airdrop manifest against the chain and offers the member's own leaves", async () => {
        availability.ledger = true; availability.sales = true
        const manifest = prepareAirdropManifest("T1", [{ index: 0, beneficiary: MEMBER, amount: "1000000" }, { index: 1, beneficiary: CREATOR, amount: "500000" }])
        chain({ LaunchJSON: launchOf(sale, { airdrop: { root: manifest.root, total: manifest.total, claimed: "0" } }), AirdropClaimed: "(false bool)" })
        show("mainnet", true)
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        const paste = await screen.findByLabelText("The airdrop's manifest, as its creator published it")
        fireEvent.change(paste, { target: { value: "{not json" } })
        expect(screen.getByRole("alert")).toHaveTextContent("This is not a manifest: it does not read as JSON.")
        fireEvent.change(paste, { target: { value: JSON.stringify({ ...manifest, total: "1" }) } })
        expect(screen.getByRole("alert")).toHaveTextContent("This manifest does not match the airdrop recorded on chain.")
        fireEvent.change(paste, { target: { value: JSON.stringify(manifest) } })
        fireEvent.click(await screen.findByRole("button", { name: "Claim from the airdrop" }))
        await waitFor(() => expect(signed()).toMatchObject({ func: "ClaimAirdrop", args: ["T1", "0", MEMBER, "1000000", manifest.claims[0].proof] }))
    })

    it("asks a guest with a valid manifest to connect to see their claims", async () => {
        availability.ledger = true; availability.sales = true
        const manifest = prepareAirdropManifest("T1", [{ index: 0, beneficiary: MEMBER, amount: "1000000" }])
        chain({ LaunchJSON: launchOf(sale, { airdrop: { root: manifest.root, total: manifest.total, claimed: "0" } }) })
        const { session } = show("mainnet")
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        fireEvent.change(await screen.findByLabelText("The airdrop's manifest, as its creator published it"), { target: { value: JSON.stringify(manifest) } })
        fireEvent.click(screen.getByRole("button", { name: "Connect to see your claims" }))
        expect(session.openConnect).toHaveBeenCalled()
    })

    it("asks a guest to connect to claim vested tokens", async () => {
        availability.ledger = true; availability.sales = true
        chain({
            LaunchJSON: launchOf(sale, { vestingCount: 1 }),
            VestingJSON: qjson({ index: 0, beneficiary: CREATOR, pendingBeneficiary: "", total: "100000000", claimed: "0", start: String(now - 1_000), cliff: "0", duration: "2000", revocable: false, revoked: false, revokedVested: "0" }),
        })
        const { session } = show("mainnet")
        fireEvent.click(await screen.findByRole("button", { name: /Fair Token/ }))
        fireEvent.click(await screen.findByRole("button", { name: "Connect to claim" }))
        expect(session.openConnect).toHaveBeenCalled()
        expect(sign).not.toHaveBeenCalled()
    })
})
