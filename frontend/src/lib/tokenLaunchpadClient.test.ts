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

import { TokenLaunchpadClient, TokenLaunchpadReadError, parseLaunchpadToken, TOKEN_LAUNCHPAD_PATH } from "./tokenLaunchpadClient"

const CREATOR = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"
const SALES = "g1rdjmeglm55p7evsxrk0y639l2gqwemh7qpaw53"
const MAX = "9223372036854775807"
const BASE32 = "0123456789abcdefghijklmnopqrstuv"
const CFORD32 = "0123456789abcdefghjkmnpqrstvwxyz"

function ledgerSuffix(id: string): string {
    return Number(id.slice(1)).toString(32).padStart(7, "0")
        .split("").map((digit) => CFORD32[BASE32.indexOf(digit)]).join("")
}

function token(id = "T1", ticker = "SAME") {
    return {
        id, registryKey: `${TOKEN_LAUNCHPAD_PATH}.${id}`,
        grc20Id: `${TOKEN_LAUNCHPAD_PATH}.${id}.${ledgerSuffix(id)}`,
        issuer: SALES, creator: CREATOR, mode: "direct_fixed", name: "Example", ticker,
        decimals: 6, initialSupply: MAX, maxSupply: MAX, totalSupply: MAX,
        configVersion: "1", currencyKey: "ugnot", description: "", image: "",
        website: "", xHandle: "", telegram: "", metadataFrozen: false,
        mintAuthority: "", pendingMintAuthority: "", mintRenounced: false,
    }
}

function qjson(value: unknown): string { return `(${JSON.stringify(JSON.stringify(value))} string)` }

beforeEach(() => {
    queryEval.mockReset()
    currentNetworkKey.mockReturnValue("mainnet")
    isRealmValidOn.mockReset()
    isRealmValidOn.mockReturnValue(true)
})

describe("Token Launchpad structured reader", () => {
    it("preserves MaxInt64 amounts exactly and keeps public ID, registry key and display ticker distinct", () => {
        const one = parseLaunchpadToken(token("T1", "SAME"))
        const two = parseLaunchpadToken(token("T2", "SAME"))
        expect(one.totalSupply).toBe(9223372036854775807n)
        expect(one.id).not.toBe(two.id)
        expect(one.ticker).toBe(two.ticker)
        expect(one.registryKey).not.toBe(one.ticker)
    })

    it("matches the ledger's seven-character cford32 GRC20 IDs, written out by hand", () => {
        for (const [id, suffix] of [["T31", "000000z"], ["T32", "0000010"], ["T1024", "0000100"], ["T9999999999", "9a0qrzz"]]) {
            expect(parseLaunchpadToken({ ...token(id), grc20Id: `${TOKEN_LAUNCHPAD_PATH}.${id}.${suffix}` }).grc20Id).toBe(`${TOKEN_LAUNCHPAD_PATH}.${id}.${suffix}`)
        }
    })

    it("rejects numeric, noncanonical, missing and inconsistent amount fields", () => {
        for (const override of [
            { totalSupply: Number(MAX) }, { totalSupply: "01" }, { totalSupply: "-1" },
            { totalSupply: "9223372036854775808" }, { maxSupply: "1" },
            { creator: "g1invalid" }, { issuer: "" }, { issuer: CREATOR.toUpperCase() },
            { mode: "curve" }, { id: "T01" }, { registryKey: "" },
            { registryKey: "gno.land/r/nt/grc20reg/v0:T1" },
            { grc20Id: `${TOKEN_LAUNCHPAD_PATH}.T1.0000002` },
        ]) expect(() => parseLaunchpadToken({ ...token(), ...override })).toThrow(TokenLaunchpadReadError)
    })

    it("rejects oversized decimal strings before parsing them as integers", async () => {
        const oversized = "9".repeat(100_000)
        expect(() => parseLaunchpadToken({ ...token(), totalSupply: oversized }))
            .toThrow(TokenLaunchpadReadError)
        queryEval.mockResolvedValueOnce(`(${oversized} int64)`)
        await expect(new TokenLaunchpadClient().balanceOf("T1", CREATOR)).rejects.toMatchObject({ code: "invalid_response" })
    })

    it("reads an empty list as success and pages past 100 tokens by ID, not ticker", async () => {
        queryEval.mockImplementation(async (_rpc, _path, expression: string, strict: boolean) => {
            expect(strict).toBe(true)
            const page = Number(expression.match(/ListTokensJSON\((\d+),/)?.[1])
            if (page === 0) return qjson(Array.from({ length: 100 }, (_, i) => token(`T${i + 1}`)))
            if (page === 1) return qjson([token("T101")])
            return qjson([])
        })
        const client = new TokenLaunchpadClient()
        expect(await client.listPage(0)).toHaveLength(100)
        expect((await client.listPage(1)).map((item) => item.id)).toEqual(["T101"])
        expect(await client.listPage(2)).toEqual([])
    })

    it("rejects duplicate or gapped page IDs and malformed JSON returns", async () => {
        const client = new TokenLaunchpadClient()
        queryEval.mockResolvedValueOnce(qjson([token("T2")]))
        await expect(client.listPage(0)).rejects.toMatchObject({ code: "invalid_response" })
        queryEval.mockResolvedValueOnce('("not JSON" string)')
        await expect(client.listPage(0)).rejects.toMatchObject({ code: "invalid_response" })
    })

    it("distinguishes unavailable, realm, RPC and network-change failures", async () => {
        const client = new TokenLaunchpadClient()
        queryEval.mockResolvedValueOnce(null)
        await expect(client.listPage(0)).rejects.toMatchObject({ code: "unavailable" })
        queryEval.mockRejectedValueOnce(new AbciQueryError("vm/qeval", "missing"))
        await expect(client.listPage(0)).rejects.toMatchObject({ code: "realm_error" })
        queryEval.mockRejectedValueOnce(new Error("offline"))
        await expect(client.listPage(0)).rejects.toMatchObject({ code: "rpc_error" })
        currentNetworkKey.mockReturnValueOnce("testnet")
        await expect(client.listPage(0)).rejects.toMatchObject({ code: "network_changed" })
        isRealmValidOn.mockReturnValueOnce(false)
        await expect(client.listPage(0)).rejects.toMatchObject({ code: "unavailable" })
        expect(queryEval).toHaveBeenCalledTimes(3)
    })

    it("rejects a network switch during an awaited read", async () => {
        queryEval.mockImplementationOnce(async () => {
            currentNetworkKey.mockReturnValue("testnet")
            return qjson([])
        })
        await expect(new TokenLaunchpadClient().listPage(0)).rejects.toMatchObject({ code: "network_changed" })
    })

    it("keeps the unpublished token realm gated by the real mainnet allowlist", async () => {
        const config = await vi.importActual<typeof import("./config")>("./config")
        expect(config.isRealmValidOn("mainnet", TOKEN_LAUNCHPAD_PATH)).toBe(false)
    })

    it("reads a balance with validated arguments and an exact integer result", async () => {
        queryEval.mockResolvedValueOnce(`(${MAX} int64)`)
        const client = new TokenLaunchpadClient()
        expect(await client.balanceOf("T1", CREATOR)).toBe(9223372036854775807n)
        expect(queryEval).toHaveBeenCalledWith("https://rpc.example", TOKEN_LAUNCHPAD_PATH, `BalanceOf("T1", address("${CREATOR}"))`, true)
        for (const [id, owner] of [['T1");panic(1)//', CREATOR], ["T1", CREATOR.toUpperCase()]]) {
            await expect(client.balanceOf(id, owner)).rejects.toMatchObject({ code: "invalid_response" })
        }
        expect(queryEval).toHaveBeenCalledTimes(1)
    })

    it("counts the tokens created", async () => {
        queryEval.mockResolvedValueOnce("(6 int64)")
        expect(await new TokenLaunchpadClient().count()).toBe(6n)
        expect(queryEval).toHaveBeenCalledWith("https://rpc.example", TOKEN_LAUNCHPAD_PATH, "Count()", true)
    })
})
