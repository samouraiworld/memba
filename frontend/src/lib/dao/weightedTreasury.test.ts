import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearRpcChainChecks } from "./chainIdentity"
import { weightedConfigSchema, type WeightedV12Config } from "./weighted"
import v12Native from "./testdata/weighted-v12/native.json"

const rpc = vi.fn()
vi.mock("../rpcFallback", async original => ({ ...(await original<typeof import("../rpcFallback")>()), directRpcCall: (...args: unknown[]) => rpc(...args) }))
const { readFeeDestinations, readHeldUgnot, teamWallet } = await import("./weightedTreasury")

const config = weightedConfigSchema.parse(v12Native.records.config) as WeightedV12Config
const ctx = { rpcUrl: "https://rpc.invalid", chainId: "gnoland-1", realmPath: config.realmPath }
const RESERVE = "g1jw76lxvzjafw2kyjhdnzwggcftyhnlfjaer2u0"
const PUBLISHER = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"
const expressionOf = (params: { data: string }) => new TextDecoder().decode(Uint8Array.from(params.data.slice(2).match(/../g)!.map((h) => parseInt(h, 16))))
const answer = (text: string) => ({ response: { ResponseBase: { Data: btoa(text), Error: null } } })

/** A chain whose targets answer GetTreasury() with `treasuries[target]` (a qeval result), or fail the read. */
function chain(network: string, treasuries: Record<string, string | Error>) {
    rpc.mockImplementation(async (_url: string, method: string, params: { data: string }) => {
        if (method === "status") return { node_info: { network } }
        const expression = expressionOf(params)
        const target = Object.keys(treasuries).find((path) => expression === `${path}.GetTreasury()`)
        if (!target) throw new Error(`unexpected read ${expression}`)
        const value = treasuries[target]
        if (value instanceof Error) throw value
        return answer(value)
    })
}
const address = (value: string) => `("${value}" .uverse.address)`

// Each case starts with no node verified: the chain memo (chainIdentity) is per page.
beforeEach(() => { rpc.mockReset(); clearRpcChainChecks() })

describe("where the governed applications pay their fees", () => {
    it("reads each target's current treasury next to the one the DAO's policy names", async () => {
        chain("gnoland-1", { [config.marketPolicy.target]: address(PUBLISHER), [config.appstorePolicy.target]: address(RESERVE) })
        expect(await readFeeDestinations(ctx, config)).toEqual([
            { key: "marketPolicy", fees: "Market fees", target: "gno.land/r/samcrew/memba_market_config", policyTreasury: RESERVE, current: PUBLISHER },
            { key: "appstorePolicy", fees: "App Store registration fees", target: "gno.land/r/samcrew/memba_appstore_v3", policyTreasury: RESERVE, current: RESERVE },
        ])
    })

    it("reports an unset treasury as empty and an unreadable one as unknown, never as the policy's", async () => {
        chain("gnoland-1", { [config.marketPolicy.target]: "( .uverse.address)", [config.appstorePolicy.target]: new Error("HTTP 502") })
        const [market, appstore] = await readFeeDestinations(ctx, config)
        expect(market.current).toBe("")
        expect(appstore.current).toBeNull()
    })

    it("refuses a value that is not an address", async () => {
        chain("gnoland-1", { [config.marketPolicy.target]: '("g1notanaddress" string)', [config.appstorePolicy.target]: address(RESERVE) })
        expect((await readFeeDestinations(ctx, config))[0].current).toBeNull()
    })

    it("reads nothing from an RPC that answers for another chain", async () => {
        chain("test-13", {})
        await expect(readFeeDestinations(ctx, config)).rejects.toThrow("RPC network does not match the selected chain")
        expect(rpc).toHaveBeenCalledTimes(1)
    })

    it("names only the team's declared wallets", () => {
        expect(teamWallet(RESERVE)).toEqual({ name: "Reserve wallet", declared: "a 4-of-7 multisig" })
        expect(teamWallet(PUBLISHER)).toEqual({ name: "Publisher wallet", declared: "a 2-of-3 multisig" })
        expect(teamWallet("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")).toBeNull()
        expect(teamWallet("constructor")).toBeNull()
    })
})

describe("what an address related to the DAO holds", () => {
    const bank = (network: string, coins: string) => rpc.mockImplementation(async (_url: string, method: string, params: { path?: string }) => {
        if (method === "status") return { node_info: { network } }
        if (params.path !== `"bank/balances/${RESERVE}"`) throw new Error(`unexpected read ${params.path}`)
        return answer(JSON.stringify(coins))
    })

    it("reads the ugnot from the selected chain", async () => {
        bank("gnoland-1", "5foo,1337000ugnot")
        expect(await readHeldUgnot(ctx, RESERVE)).toBe(1_337_000n)
        bank("gnoland-1", "")
        expect(await readHeldUgnot(ctx, RESERVE)).toBe(0n)
    })

    it("reads nothing from an RPC that serves another chain", async () => {
        bank("test13", "1337000ugnot")
        await expect(readHeldUgnot(ctx, RESERVE)).rejects.toThrow()
        expect(rpc.mock.calls.map((call) => call[1])).not.toContain("abci_query")
    })
})
