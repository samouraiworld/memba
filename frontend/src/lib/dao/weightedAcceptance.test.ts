import { beforeEach, describe, expect, it, vi } from "vitest"
import native from "./testdata/weighted-v12/native.json"
import gettersText from "./testdata/weighted-v12/target-getters.txt?raw"
import exportsText from "./testdata/weighted-v12/realm-exports.txt?raw"
import { ACCEPT_ACTIONS, ACCEPT_FUNCS, ACCEPT_PROBES, AUTHORITY_GETTERS, acceptAdapterFor, acceptanceState, parseQevalAddress, parseQevalBool, parseQevalString, readAcceptanceStates, readTargetAuthority, weightedDaoAddress } from "./weightedAcceptance"
import { APPLICATION_POLICY_KEYS, APPLICATION_TARGETS, type ApplicationPolicyKey } from "./weightedApplications"
import { weightedApplicationPolicies, weightedConfigSchema } from "./weighted"
import { directRpcCall } from "../rpcFallback"
vi.mock("../rpcFallback", async importOriginal => ({ ...await importOriginal<typeof import("../rpcFallback")>(), directRpcCall: vi.fn() }))

const hostSources = Object.fromEntries(Object.entries(import.meta.glob("./testdata/weighted-v12/host/*_actions.gno.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>)
    .map(([path, text]) => [path.split("/").pop()!.replace(/_actions\.gno\.txt$/, ""), text]))
const lines = (text: string) => text.split("\n").filter(l => l && !l.startsWith("#"))
/** `<realm> <name>(<params>) <result>` → realm → name → { params, result }. */
const targetGetters = new Map<string, Map<string, { params: string; result: string }>>()
for (const line of lines(gettersText)) {
    const m = line.match(/^(\S+) (\w+)\(([^)]*)\) (\w+)$/)!
    if (!targetGetters.has(m[1])) targetGetters.set(m[1], new Map())
    targetGetters.get(m[1])!.set(m[2], { params: m[3], result: m[4] })
}
const realmExports = new Map(lines(exportsText).map(l => { const m = l.match(/^\S+ (\w+)\(([^)]*)\)\s*(\w*)$/)!; return [m[1], { params: m[2], result: m[3] }] }))

const realmPath = "gno.land/r/samcrew/memba_dao"
const ctx = { realmPath, rpcUrl: "https://selected.invalid", chainId: "test-chain" }
const config = weightedConfigSchema.parse(native.records.config)
if (config.schema !== "memba-weighted-host/v12") throw new Error("fixture is not v12")
const DAO = weightedDaoAddress(realmPath)
const members = native.records.members.members
const PUBLISHER = config.marketPolicy.successor
const OTHER = members[3].address
const HOST_FILE: Record<ApplicationPolicyKey, string> = {
    marketPolicy: "market", reviewsPolicy: "reviews", questPolicy: "quest", arcadePolicy: "arcade", appstorePolicy: "appstore",
    escrowPolicy: "escrow", badgesPolicy: "badges", feedPolicy: "feed", channelsPolicy: "channels", feedbackPolicy: "feedback",
}

/** A fake chain: realm → expression → typed qeval text. */
let chain: Record<string, Record<string, string>>
let network = ctx.chainId
const typed = (key: ApplicationPolicyKey, value: string) => AUTHORITY_GETTERS[key].type === "address" ? (value ? `("${value}" .uverse.address)` : "( .uverse.address)") : `("${value}" string)`
function nominate(key: ApplicationPolicyKey, current: string, pending: string) {
    const target = config[key].target, g = AUTHORITY_GETTERS[key]
    chain[target] = { ...chain[target], [`${g.current}()`]: typed(key, current), [`${g.pending}()`]: typed(key, pending) }
}
function set(key: ApplicationPolicyKey, expression: string, raw: string) { const target = config[key].target; chain[target] = { ...chain[target], [expression]: raw } }
const queried: string[] = []

beforeEach(() => {
    vi.clearAllMocks(); queried.length = 0; network = ctx.chainId
    chain = {}
    for (const key of APPLICATION_POLICY_KEYS) nominate(key, PUBLISHER, DAO)
    set("badgesPolicy", `IsAdmin("${PUBLISHER}")`, "(true bool)")
    set("feedPolicy", `IsModerator("${PUBLISHER}")`, "(false bool)")
    for (const key of ["channelsPolicy", "feedbackPolicy"] as const) {
        set(key, `IsMember("${PUBLISHER}")`, "(true bool)"); set(key, `IsMember("${DAO}")`, "(false bool)")
    }
    set("feedbackPolicy", `GetMemberRoles("${PUBLISHER}")`, '("admin" string)')
    vi.mocked(directRpcCall).mockImplementation(async (_url, method, params) => {
        if (method === "status") return { node_info: { network } }
        const expr = new TextDecoder().decode(Uint8Array.from(params!.data.slice(2).match(/../g)!, h => parseInt(h, 16)))
        queried.push(expr)
        const dot = expr.indexOf(".", expr.lastIndexOf("/"))
        const raw = chain[expr.slice(0, dot)]?.[expr.slice(dot + 1)]
        if (raw === undefined) return { response: { ResponseBase: { Data: "", Error: { "@type": "/vm.UnauthorizedUserError" } } } }
        return { response: { ResponseBase: { Data: btoa(raw), Error: null } } }
    })
})
const read = (key: ApplicationPolicyKey) => readTargetAuthority(ctx, key, config[key].target, config[key].successor)

describe("adapter acceptance: realm entry points and target getters", () => {
    it("proposes each acceptance through the realm's exported, argument-free entry point", () => {
        expect(Object.keys(ACCEPT_FUNCS)).toEqual(APPLICATION_POLICY_KEYS)
        for (const key of APPLICATION_POLICY_KEYS) {
            expect(realmExports.get(ACCEPT_FUNCS[key]), key).toEqual({ params: "cur realm", result: "uint64" })
            // The host encoder of the same adapter takes no argument either and records this operation.
            const source = hostSources[HOST_FILE[key]]
            expect(source, key).toMatch(/func (\(p \w+Policy\) Accept|MarketAccept)\(\) \w+Action/)
            expect(source).toContain(`= "${ACCEPT_ACTIONS[key].operation}"`)
        }
    })

    it("recognises the ten executed acceptances of the native scenario, one per adapter", () => {
        const accepted = Array.from({ length: 10 }, (_, i) => acceptAdapterFor((native.records as unknown as Record<string, { proposal: { action: { type: string; operation: string } } }>)[`proposal_${i + 4}`].proposal.action))
        expect(new Set(accepted)).toEqual(new Set(APPLICATION_POLICY_KEYS))
        expect(acceptAdapterFor({ type: "market-config", operation: "set-fee" })).toBeNull()
        expect(acceptAdapterFor({ type: "reviews", operation: "accept-owner" })).toBeNull()
    })

    it("reads each target through getters that exist there, with their exact return types", () => {
        for (const key of APPLICATION_POLICY_KEYS) {
            const g = AUTHORITY_GETTERS[key]
            const targets = key === "reviewsPolicy" ? [APPLICATION_TARGETS.reviewsV1, APPLICATION_TARGETS.reviewsV2] : [config[key].target]
            for (const target of targets) {
                const getters = targetGetters.get(target)!
                expect(getters.get(g.current), `${target}.${g.current}`).toEqual({ params: "", result: g.type })
                expect(getters.get(g.pending), `${target}.${g.pending}`).toEqual({ params: "", result: g.type })
                for (const probe of ACCEPT_PROBES[key] ?? []) {
                    const name = probe.expression({ owner: PUBLISHER, dao: DAO }).split("(")[0]
                    expect(getters.get(name), `${target}.${name}`).toEqual({ params: "addr address", result: typeof probe.expect === "boolean" ? "bool" : "string" })
                }
            }
        }
    })
})

describe("typed qeval results", () => {
    it("reads set and unset addresses of both getter types and nothing else", () => {
        expect(parseQevalAddress(`("${PUBLISHER}" .uverse.address)`, "address")).toBe(PUBLISHER)
        expect(parseQevalAddress("( .uverse.address)", "address")).toBe("")
        expect(parseQevalAddress('("" .uverse.address)', "address")).toBe("")
        expect(parseQevalAddress(`("${PUBLISHER}" string)`, "string")).toBe(PUBLISHER)
        expect(parseQevalAddress('("" string)', "string")).toBe("")
        for (const [raw, type] of [
            [`("${PUBLISHER}" string)`, "address"], [`("${PUBLISHER}" .uverse.address)`, "string"],
            [`("${PUBLISHER.slice(0, -1)}q" .uverse.address)`, "address"], [`("${PUBLISHER}x" string)`, "string"],
            ['("gno.land/r/samcrew/memba_dao" string)', "string"], ["(nil .uverse.address)", "address"], ["", "address"],
            [`("${PUBLISHER}" .uverse.address)\n("${DAO}" .uverse.address)`, "address"],
        ] as const) expect(() => parseQevalAddress(raw, type), raw).toThrow()
    })

    it("reads booleans and plain role strings strictly", () => {
        expect(parseQevalBool("(true bool)")).toBe(true)
        expect(parseQevalBool("(false bool)")).toBe(false)
        expect(() => parseQevalBool('("true" string)')).toThrow()
        expect(parseQevalString('("admin" string)')).toBe("admin")
        expect(parseQevalString('("" string)')).toBe("")
        for (const raw of ['("ad\\"min" string)', '("admin\\u200b" string)', "(admin string)", "(true bool)"]) expect(() => parseQevalString(raw), raw).toThrow()
    })
})

describe("acceptance state machine", () => {
    const state = (current: string, pending: string, failed: string[] = []) => acceptanceState({ current, pending, failed }, DAO)
    it("names who acts next", () => {
        expect(state(PUBLISHER, "")).toEqual({ kind: "awaiting", current: PUBLISHER, pending: "" })
        expect(state(PUBLISHER, OTHER)).toEqual({ kind: "awaiting", current: PUBLISHER, pending: OTHER })
        expect(state(PUBLISHER, DAO)).toEqual({ kind: "ready", current: PUBLISHER })
        expect(state(PUBLISHER, DAO, ["x"])).toEqual({ kind: "blocked", current: PUBLISHER, reasons: ["x"] })
        expect(state(DAO, "")).toEqual({ kind: "dao", pending: "" })
        expect(state(DAO, PUBLISHER)).toEqual({ kind: "dao", pending: PUBLISHER })
        expect(() => acceptanceState({ current: PUBLISHER, pending: DAO, failed: [] }, "gno.land/r/samcrew/memba_dao")).toThrow()
    })

    it("uses the DAO's own package address, not any other realm's", () => {
        expect(DAO).toMatch(/^g1[0-9a-z]{38}$/)
        expect(weightedDaoAddress("gno.land/r/samcrew/memba_dao_v2")).not.toBe(DAO)
        nominate("marketPolicy", PUBLISHER, weightedDaoAddress("gno.land/r/samcrew/memba_dao_v2"))
        return read("marketPolicy").then(r => expect(acceptanceState(r, DAO).kind).toBe("awaiting"))
    })

    it.each(APPLICATION_POLICY_KEYS)("%s: awaiting, ready and DAO-controlled, from its own getters", async key => {
        nominate(key, PUBLISHER, "")
        expect(acceptanceState(await read(key), DAO)).toEqual({ kind: "awaiting", current: PUBLISHER, pending: "" })
        nominate(key, PUBLISHER, DAO)
        expect(acceptanceState(await read(key), DAO)).toEqual({ kind: "ready", current: PUBLISHER })
        nominate(key, DAO, "")
        queried.length = 0
        expect(acceptanceState(await read(key), DAO)).toEqual({ kind: "dao", pending: "" })
        // Once the DAO controls the target, no precondition probe is needed.
        expect(queried.map(q => q.slice(config[key].target.length + 1)).sort()).toEqual([`${AUTHORITY_GETTERS[key].current}()`, `${AUTHORITY_GETTERS[key].pending}()`].sort())
    })

    it("blocks the handoffs the host would refuse", async () => {
        set("feedPolicy", `IsModerator("${PUBLISHER}")`, "(true bool)")
        expect(acceptanceState(await read("feedPolicy"), DAO)).toMatchObject({ kind: "blocked", reasons: [expect.stringContaining("feed moderator")] })
        set("channelsPolicy", `IsMember("${DAO}")`, "(true bool)")
        expect(acceptanceState(await read("channelsPolicy"), DAO)).toMatchObject({ kind: "blocked", reasons: [expect.stringContaining("already has channels membership")] })
        set("badgesPolicy", `IsAdmin("${PUBLISHER}")`, "(false bool)")
        expect(acceptanceState(await read("badgesPolicy"), DAO).kind).toBe("blocked")
        set("feedbackPolicy", `GetMemberRoles("${PUBLISHER}")`, '("admin,member" string)')
        expect(acceptanceState(await read("feedbackPolicy"), DAO)).toMatchObject({ kind: "blocked", reasons: [expect.stringContaining("not exactly admin")] })
        // Feedback accepts a handoff from the configured publisher only.
        nominate("feedbackPolicy", OTHER, DAO)
        set("feedbackPolicy", `IsMember("${OTHER}")`, "(true bool)"); set("feedbackPolicy", `GetMemberRoles("${OTHER}")`, '("admin" string)')
        expect(acceptanceState(await read("feedbackPolicy"), DAO)).toMatchObject({ kind: "blocked", reasons: [expect.stringContaining("configured publisher")] })
    })

    it("refuses a malformed or missing read instead of guessing", async () => {
        set("questPolicy", "GetOwner()", `("${PUBLISHER}" .uverse.address)`)
        await expect(read("questPolicy")).rejects.toThrow()
        nominate("arcadePolicy", "", DAO)
        await expect(read("arcadePolicy")).rejects.toThrow("no current authority")
        set("feedPolicy", `IsModerator("${PUBLISHER}")`, '("false" string)')
        await expect(read("feedPolicy")).rejects.toThrow()
        await expect(readTargetAuthority(ctx, "marketPolicy", "gno.land/r/samcrew/memba_market_config_v9", PUBLISHER)).rejects.toThrow()
    })

    it("reads all ten after checking the chain, isolating one failed target", async () => {
        chain[config.escrowPolicy.target]["GetAdmin()"] = "(garbage)"
        const states = await readAcceptanceStates(ctx, weightedApplicationPolicies(config))
        expect(states.escrowPolicy).toBe("error")
        expect(Object.entries(states).filter(([, s]) => s !== "error").every(([, s]) => typeof s === "object" && s.kind === "ready")).toBe(true)
        expect(Object.keys(states)).toHaveLength(10)
        network = "gnoland-1"
        await expect(readAcceptanceStates(ctx, weightedApplicationPolicies(config))).rejects.toThrow("RPC network does not match")
    })
})
