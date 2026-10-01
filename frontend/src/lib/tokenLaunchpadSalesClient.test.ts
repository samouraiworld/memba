import { beforeEach, describe, expect, it, vi } from "vitest"
import { AbciQueryError } from "./rpcFallback"

const queryEval = vi.fn()
const currentNetworkKey = vi.fn(() => "mainnet")
const isRealmValidOn = vi.fn(() => true)
vi.mock("./dao/shared", async (load) => ({
    ...(await load<typeof import("./dao/shared")>()),
    queryEval: (...args: unknown[]) => queryEval(...args),
}))
vi.mock("./config", async (load) => ({
    ...(await load<typeof import("./config")>()),
    ACTIVE_NETWORK_KEY: "mainnet",
    GNO_RPC_URL: "https://rpc.example",
    currentNetworkKey: () => currentNetworkKey(),
    isRealmValidOn: (...args: unknown[]) => isRealmValidOn(...args),
}))

import { TokenLaunchpadSalesClient, TOKEN_LAUNCHPAD_SALES_ADDRESS, TOKEN_LAUNCHPAD_SALES_PATH, parseLaunch, parseFairBuyer, parseTerms, parseVesting } from "./tokenLaunchpadSalesClient"
import { TOKEN_LAUNCHPAD_PATH } from "./tokenLaunchpadClient"

const CREATOR = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"
const BUYER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const SALES = "g1rdjmeglm55p7evsxrk0y639l2gqwemh7qpaw53"

function token(mode = "direct_fixed") {
    return {
        id: "T1", registryKey: `${TOKEN_LAUNCHPAD_PATH}.T1`, grc20Id: `${TOKEN_LAUNCHPAD_PATH}.T1.0000001`,
        issuer: SALES, creator: CREATOR, mode, name: "Example", ticker: "SAME", decimals: 6,
        initialSupply: "1000", maxSupply: "1000", totalSupply: "1000", configVersion: "1",
        currencyKey: "ugnot", description: "", image: "", website: "", xHandle: "", telegram: "",
        metadataFrozen: false, mintAuthority: "", pendingMintAuthority: "", mintRenounced: false,
    }
}

function launch(mode = "direct_fixed") {
    return { schema: "launchpad-sales-v1", token: token(mode), tokenLiability: "1000", vestingCount: 0, fairSale: null, airdrop: null }
}

/** A settled sale that succeeded: 75 of 100 lots at 8, 300 refunded, 2.5% fee. */
function fairSale() {
    return {
        creator: CREATOR, quoteCurrency: "ugnot", configVersion: "1", primaryFeeBps: "250",
        allocation: "1000", lotSize: "10", walletCapLots: "50", hardCapLots: "100",
        softCapQuote: "300", start: "100", end: "200", startPrice: "12", floorPrice: "8",
        decrement: "1", intervalSeconds: "10", allowlistRoot: "", holdingGates: "",
        totalLots: "75", totalDeposits: "900", hardClosedAt: "0", cancelled: false,
        settled: true, succeeded: true, closeAt: "200", closePrice: "8", soldTokens: "750",
        grossQuote: "600", primaryFeeQuote: "15", creatorQuote: "585", proceedsReleased: true,
        refundQuote: "300", unsoldTokens: "250",
    }
}

const open = { ...fairSale(), settled: false, succeeded: false, closeAt: "0", closePrice: "0", soldTokens: "0",
    grossQuote: "0", primaryFeeQuote: "0", creatorQuote: "0", proceedsReleased: false, refundQuote: "0", unsoldTokens: "0" }

const buyer = { buyer: BUYER, lots: "2", deposit: "24", claimableTokens: "20", claimableRefund: "8", settled: true, claimed: false }

function qjson(value: unknown): string { return `(${JSON.stringify(JSON.stringify(value))} string)` }

beforeEach(() => {
    queryEval.mockReset()
    currentNetworkKey.mockReturnValue("mainnet")
    isRealmValidOn.mockReset()
    isRealmValidOn.mockReturnValue(true)
})

describe("Token Launchpad sales reader", () => {
    it("parses a direct token, a settled and an open fair sale and an airdrop with exact int64 amounts", () => {
        expect(parseLaunch(launch()).fairSale).toBeNull()
        const fair = parseLaunch({ ...launch("fairsale"), fairSale: fairSale(), airdrop: { root: "a".repeat(64), total: "9223372036854775807", claimed: "1" } })
        expect(fair.fairSale?.primaryFeeQuote).toBe(15n)
        expect(fair.fairSale?.creatorQuote).toBe(585n)
        expect(fair.airdrop?.total).toBe(9223372036854775807n)
        expect(parseLaunch({ ...launch("fairsale"), fairSale: open }).fairSale?.settled).toBe(false)
        // The fee ceiling, 5%, is accepted; one basis point more is not (above).
        expect(parseLaunch({ ...launch("fairsale"), fairSale: { ...fairSale(), primaryFeeBps: "500" } }).fairSale?.primaryFeeBps).toBe(500n)
        // A sale opened later for a direct token names the config version of that moment.
        for (const mode of ["direct_fixed", "direct_capped"]) {
            expect(parseLaunch({ ...launch(mode), fairSale: { ...fairSale(), configVersion: "2" } }).fairSale?.configVersion).toBe(2n)
        }
    })

    it("rejects malformed or contradictory launch records", () => {
        for (const value of [
            { ...launch(), schema: "v2" },
            { ...launch(), tokenLiability: 1 },
            { ...launch(), tokenLiability: "01" },
            { ...launch(), tokenLiability: "9".repeat(100_000) },
            { ...launch(), vestingCount: "0" },
            { ...launch(), token: { ...token(), mode: "curve" } },
            { ...launch("fairsale"), fairSale: { ...fairSale(), creator: BUYER } },
            { ...launch("fairsale"), fairSale: { ...fairSale(), configVersion: "2" } },
            { ...launch("fairsale"), fairSale: { ...fairSale(), primaryFeeBps: "501" } },
            { ...launch("fairsale"), fairSale: { ...fairSale(), primaryFeeQuote: "16" } },
            { ...launch("fairsale"), fairSale: { ...fairSale(), refundQuote: "299" } },
            { ...launch("fairsale"), fairSale: { ...fairSale(), unsoldTokens: "251" } },
            { ...launch("fairsale"), fairSale: { ...fairSale(), totalLots: "101" } },
            { ...launch("fairsale"), fairSale: { ...open, creatorQuote: "1" } },
            { ...launch("fairsale"), fairSale: { ...fairSale(), succeeded: false, proceedsReleased: true } },
            { ...launch(), airdrop: { root: "x", total: "1", claimed: "0" } },
            { ...launch(), airdrop: { root: "a".repeat(64), total: "1", claimed: "2" } },
        ]) expect(() => parseLaunch(value), JSON.stringify(value).slice(0, 80)).toThrow()
    })

    it("parses buyer orders and vesting records, refusing claims that cannot be made", () => {
        expect(parseFairBuyer(buyer).claimableRefund).toBe(8n)
        expect(parseFairBuyer({ ...buyer, settled: false, claimableTokens: "0", claimableRefund: "0" }).settled).toBe(false)
        expect(() => parseFairBuyer({ ...buyer, claimed: true })).toThrow()
        expect(() => parseFairBuyer({ ...buyer, settled: false })).toThrow()
        expect(() => parseFairBuyer({ ...buyer, claimableRefund: "25" })).toThrow()
        expect(() => parseFairBuyer({ ...buyer, settled: "true" })).toThrow()
        const vesting = {
            index: 0, beneficiary: CREATOR, pendingBeneficiary: "", total: "100", claimed: "25",
            start: "100", cliff: "10", duration: "200", revocable: true, revoked: false, revokedVested: "0",
        }
        expect(parseVesting(vesting).claimed).toBe(25n)
        expect(() => parseVesting({ ...vesting, claimed: "101" })).toThrow()
        expect(parseVesting({ ...vesting, revoked: true, revokedVested: "40" }).revokedVested).toBe(40n)
        expect(() => parseVesting({ ...vesting, revoked: true, revokedVested: "101" })).toThrow()
        expect(() => parseVesting({ ...vesting, beneficiary: CREATOR.toUpperCase() })).toThrow()
    })

    it("reads with exact expressions and checks the returned token, buyer and record", async () => {
        queryEval.mockResolvedValueOnce(qjson(launch()))
            .mockResolvedValueOnce(qjson({ ...buyer, lots: "0", deposit: "0", claimableTokens: "0", claimableRefund: "0" }))
            .mockResolvedValueOnce(qjson({ index: 0, beneficiary: CREATOR, pendingBeneficiary: "", total: "100", claimed: "0", start: "0", cliff: "0", duration: "100", revocable: false, revoked: false, revokedVested: "0" }))
        const reader = new TokenLaunchpadSalesClient()
        expect((await reader.launch("T1")).token.id).toBe("T1")
        expect((await reader.fairBuyer("T1", BUYER)).buyer).toBe(BUYER)
        expect((await reader.vesting("T1", 0)).total).toBe(100n)
        expect(queryEval.mock.calls.map((call) => call.slice(1, 4))).toEqual([
            [TOKEN_LAUNCHPAD_SALES_PATH, 'LaunchJSON("T1")', true],
            [TOKEN_LAUNCHPAD_SALES_PATH, `FairBuyerJSON("T1", address("${BUYER}"))`, true],
            [TOKEN_LAUNCHPAD_SALES_PATH, 'VestingJSON("T1", 0)', true],
        ])
        await expect(reader.launch('T1");panic(1)//')).rejects.toMatchObject({ code: "invalid_response" })
        await expect(reader.fairBuyer("T1", BUYER.toUpperCase())).rejects.toMatchObject({ code: "invalid_response" })
        await expect(reader.vesting("T1", -1)).rejects.toMatchObject({ code: "invalid_response" })
        expect(queryEval).toHaveBeenCalledTimes(3)

        queryEval.mockResolvedValueOnce(qjson({ ...launch(), token: { ...token(), id: "T2", registryKey: `${TOKEN_LAUNCHPAD_PATH}.T2`, grc20Id: `${TOKEN_LAUNCHPAD_PATH}.T2.0000002` } }))
        await expect(reader.launch("T1")).rejects.toMatchObject({ code: "invalid_response" })
        queryEval.mockResolvedValueOnce(qjson({ ...buyer, buyer: CREATOR }))
        await expect(reader.fairBuyer("T1", BUYER)).rejects.toMatchObject({ code: "invalid_response" })
        queryEval.mockResolvedValueOnce(qjson({ index: 1, beneficiary: CREATOR, pendingBeneficiary: "", total: "1", claimed: "0", start: "0", cliff: "0", duration: "1", revocable: false, revoked: false, revokedVested: "0" }))
        await expect(reader.vesting("T1", 0)).rejects.toMatchObject({ code: "invalid_response" })
    })

    it("keeps unavailable and changed networks apart from RPC and realm failures", async () => {
        const reader = new TokenLaunchpadSalesClient()
        isRealmValidOn.mockReturnValueOnce(false)
        await expect(reader.launch("T1")).rejects.toMatchObject({ code: "unavailable" })
        expect(isRealmValidOn).toHaveBeenCalledWith("mainnet", TOKEN_LAUNCHPAD_SALES_PATH)
        queryEval.mockResolvedValueOnce(null)
        await expect(reader.launch("T1")).rejects.toMatchObject({ code: "unavailable" })
        queryEval.mockRejectedValueOnce(new AbciQueryError("vm/qeval", "missing"))
        await expect(reader.launch("T1")).rejects.toMatchObject({ code: "realm_error" })
        queryEval.mockRejectedValueOnce(new Error("offline"))
        await expect(reader.launch("T1")).rejects.toMatchObject({ code: "rpc_error" })
        queryEval.mockResolvedValueOnce('("not JSON" string)')
        await expect(reader.launch("T1")).rejects.toMatchObject({ code: "invalid_response" })
        queryEval.mockImplementationOnce(async () => { currentNetworkKey.mockReturnValue("testnet"); return qjson(launch()) })
        await expect(reader.launch("T1")).rejects.toMatchObject({ code: "network_changed" })
    })

    it("keeps the unpublished sales realm out of the real mainnet allowlist", async () => {
        const config = await vi.importActual<typeof import("./config")>("./config")
        expect(config.isRealmValidOn("mainnet", TOKEN_LAUNCHPAD_SALES_PATH)).toBe(false)
    })

    it("reads what a launch costs, with -1 as no terms", async () => {
        const terms = { schema: "launchpad-sales-terms-v1", version: "4", currency: "ugnot", directCreationFee: "1000000", fairSaleCreationFee: "2000000", fairSaleRaiseCap: "1000000000", primaryFeeBps: "200" }
        queryEval.mockResolvedValueOnce(qjson(terms))
        expect(await new TokenLaunchpadSalesClient().terms("ugnot")).toEqual({ version: 4n, currency: "ugnot", directCreationFee: 1_000_000n, fairSaleCreationFee: 2_000_000n, fairSaleRaiseCap: 1_000_000_000n, primaryFeeBps: 200n })
        expect(queryEval).toHaveBeenCalledWith("https://rpc.example", TOKEN_LAUNCHPAD_SALES_PATH, 'TermsJSON("ugnot")', true)
        expect(parseTerms({ ...terms, directCreationFee: "-1", fairSaleCreationFee: "-1", fairSaleRaiseCap: "0", primaryFeeBps: "-1" }, "ugnot")).toMatchObject({ directCreationFee: null, fairSaleCreationFee: null, primaryFeeBps: null })
        for (const bad of [{ ...terms, schema: "v2" }, { ...terms, currency: "uatom" }, { ...terms, version: "0" }, { ...terms, primaryFeeBps: "501" }, { ...terms, directCreationFee: "-2" }, { ...terms, fairSaleRaiseCap: "-1" }]) {
            expect(() => parseTerms(bad, "ugnot"), JSON.stringify(bad)).toThrow()
        }
        await expect(new TokenLaunchpadSalesClient().terms("")).rejects.toMatchObject({ code: "invalid_response" })
    })

    it("derives the sales realm's address from its path", () => {
        expect(TOKEN_LAUNCHPAD_SALES_ADDRESS).toBe(SALES)
    })
})
