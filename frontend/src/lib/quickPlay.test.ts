import { beforeEach, describe, expect, it, vi } from "vitest"

const grc = vi.hoisted(() => ({ doContractBroadcast: vi.fn(), feeForGasWanted: vi.fn(() => 24_000), networkGasPrice: vi.fn(async () => ({ gas: 1000, ugnot: 1 })) }))
vi.mock("./grc20", () => grc)
const bc = vi.hoisted(() => ({ broadcastSignedTx: vi.fn() }))
vi.mock("./signedTxBroadcast", async (orig) => ({ ...(await orig<typeof import("./signedTxBroadcast")>()), ...bc }))
vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), ACTIVE_NETWORK_KEY: "onyx", GNO_CHAIN_ID: "onyx-1", GNO_RPC_URL: "https://rpc.test", connect4PathFor: () => "gno.land/r/test/c4" }))

import { CheckTxError, OutcomeUnknownError, RealmError } from "./signedTxBroadcast"
import { endQuickPlay, forgetQuickPlay, hasLocalSession, quickPlayCall, QuickPlayUnavailable, quickPlayStatus, startQuickPlay } from "./quickPlay"

const M = "g1cvr48r7l7lkmvp77cr6zg2zhu26jgfwr0y8pew"
const now = () => Math.floor(Date.now() / 1000)
const sessionJSON = (o: Partial<{ seq: string; used: string; expires: number }> = {}) => ({
    BaseSessionAccount: { BaseAccount: { account_number: "283", sequence: o.seq ?? "0" }, expires_at: String(o.expires ?? now() + 3600), spend_limit: "1000000ugnot", spend_used: o.used ?? "", spend_period: "86400", spend_reset: String(now()) },
    allow_paths: ["vm/exec:gno.land/r/test/c4"],
})
const query = (body: unknown | null) => ({ ok: true, json: async () => ({ result: { response: { ResponseBase: body === null ? { Data: null, Log: "session not found" } : { Data: btoa(JSON.stringify(body)), Log: "" } } } }) })

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe("startQuickPlay", () => {
    it("stores the key before asking Adena, then confirms on chain", async () => {
        grc.doContractBroadcast.mockImplementation(async () => { expect(hasLocalSession(M)).toBe(true); return { hash: "h" } })
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(query(sessionJSON())))
        const st = await startQuickPlay(M, 14400)
        expect(st.spendLimitUgnot).toBe(1_000_000)
        const [msgs] = grc.doContractBroadcast.mock.calls[0]
        expect(msgs[0]).toMatchObject({ type: "/auth.m_create_session", value: { creator: M, allow_paths: ["vm/exec:gno.land/r/test/c4"], spend_limit: "1000000ugnot", spend_period: "86400" } })
        expect(Number(msgs[0].value.expires_at) - now()).toBeGreaterThan(14390)
    })
    it("drops the key when Adena fails", async () => {
        grc.doContractBroadcast.mockRejectedValueOnce(new Error("rejected"))
        await expect(startQuickPlay(M, 3600)).rejects.toThrow("rejected")
        expect(hasLocalSession(M)).toBe(false)
    })
    it("keeps the key when the broadcast landed but the chain shows no session yet", async () => {
        grc.doContractBroadcast.mockResolvedValueOnce({ hash: "h" })
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(query(null)))
        await expect(startQuickPlay(M, 3600)).rejects.toThrow(/sent but isn't confirmed yet/)
        expect(hasLocalSession(M)).toBe(true)
        await expect(startQuickPlay(M, 3600)).rejects.toThrow(/already on/)
    })
    it("keeps the key when the confirmation read throws", async () => {
        grc.doContractBroadcast.mockResolvedValueOnce({ hash: "h" })
        vi.stubGlobal("fetch", vi.fn().mockImplementation(async (u: string) => {
            if (String(u).includes("/sessions")) return query(null)
            throw new Error("network down")
        }))
        await expect(startQuickPlay(M, 3600)).rejects.toThrow(/sent but isn't confirmed yet/)
        expect(hasLocalSession(M)).toBe(true)
    })
    it("refuses before any prompt when the key can't be stored", async () => {
        const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota") })
        await expect(startQuickPlay(M, 3600)).rejects.toThrow(/nothing was sent/)
        expect(grc.doContractBroadcast).not.toHaveBeenCalled()
        spy.mockRestore()
    })
    it("only accepts the three durations", async () => {
        await expect(startQuickPlay(M, 999 as never)).rejects.toThrow()
    })
})

describe("quickPlayCall", () => {
    async function started() {
        grc.doContractBroadcast.mockResolvedValueOnce({ hash: "h" })
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(query(sessionJSON())))
        await startQuickPlay(M, 3600)
    }
    it("signs with the freshly read sequence and broadcasts", async () => {
        await started()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(query(sessionJSON({ seq: "5" }))).mockResolvedValueOnce(query(sessionJSON({ seq: "6" }))))
        bc.broadcastSignedTx.mockResolvedValue({ hash: "H", height: 1 })
        await quickPlayCall(M, "Play", ["7", "4"])
        await quickPlayCall(M, "Play", ["7", "5"])
        expect(fetch).toHaveBeenCalledTimes(2) // sequence read per call
        expect(bc.broadcastSignedTx).toHaveBeenCalledTimes(2)
        expect(bc.broadcastSignedTx.mock.calls[0][1]).not.toEqual(bc.broadcastSignedTx.mock.calls[1][1])
    })
    it("falls back and clears the key when the chain session is gone", async () => {
        await started()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(query(null)))
        await expect(quickPlayCall(M, "Play", ["7", "4"])).rejects.toEqual(expect.objectContaining({ name: "QuickPlayUnavailable", reason: "ended" }))
        expect(hasLocalSession(M)).toBe(false)
    })
    it("falls back (keeping the key) when the budget can't cover the fee", async () => {
        await started()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(query(sessionJSON({ used: "990000ugnot" }))))
        await expect(quickPlayCall(M, "Play", ["7", "4"])).rejects.toEqual(expect.objectContaining({ reason: "budget" }))
        expect(hasLocalSession(M)).toBe(true)
    })
    it("maps a DeliverTx session spend limit failure to a budget fallback (keeping the key)", async () => {
        await started()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(query(sessionJSON())))
        bc.broadcastSignedTx.mockRejectedValue(new RealmError("unable to lock deposit 100000ugnot, session spend limit exceeded"))
        await expect(quickPlayCall(M, "Play", ["7", "4"])).rejects.toEqual(expect.objectContaining({ name: "QuickPlayUnavailable", reason: "budget" }))
        expect(hasLocalSession(M)).toBe(true)
    })
    it("retries a check_tx rejection once with a re-read sequence, then falls back", async () => {
        await started()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(query(sessionJSON())))
        bc.broadcastSignedTx.mockRejectedValue(new CheckTxError("signature verification failed"))
        await expect(quickPlayCall(M, "Play", ["7", "4"])).rejects.toEqual(expect.objectContaining({ reason: "rejected" }))
        expect(bc.broadcastSignedTx).toHaveBeenCalledTimes(2)
    })
    it("passes realm errors and outcome-unknown through untouched (never retried)", async () => {
        await started()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(query(sessionJSON())))
        bc.broadcastSignedTx.mockRejectedValueOnce(new RealmError("not your turn"))
        await expect(quickPlayCall(M, "Play", ["7", "4"])).rejects.toBeInstanceOf(RealmError)
        bc.broadcastSignedTx.mockRejectedValueOnce(new OutcomeUnknownError("ABC"))
        await expect(quickPlayCall(M, "Play", ["7", "4"])).rejects.toBeInstanceOf(OutcomeUnknownError)
        expect(bc.broadcastSignedTx).toHaveBeenCalledTimes(2)
    })
    it("is inactive for another account and refuses unknown funcs", async () => {
        await started()
        expect(hasLocalSession("g1p8xftdc9v75netuza8kgtrzg8yxaagd8u3hk5m")).toBe(false)
        await expect(quickPlayCall("g1p8xftdc9v75netuza8kgtrzg8yxaagd8u3hk5m", "Play", ["7", "4"])).rejects.toBeInstanceOf(QuickPlayUnavailable)
        await expect(quickPlayCall(M, "Offer" as never, ["x"])).rejects.toThrow()
    })
})

describe("end / forget", () => {
    it("revokes through Adena, then forgets; keeps the key if revoke fails", async () => {
        grc.doContractBroadcast.mockResolvedValueOnce({ hash: "h" })
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(query(sessionJSON())))
        await startQuickPlay(M, 3600)
        grc.doContractBroadcast.mockRejectedValueOnce(new Error("rejected"))
        await expect(endQuickPlay(M)).rejects.toThrow()
        expect(hasLocalSession(M)).toBe(true)
        grc.doContractBroadcast.mockResolvedValueOnce({ hash: "h" })
        await endQuickPlay(M)
        expect(grc.doContractBroadcast.mock.calls.at(-1)![0][0].type).toBe("/auth.m_revoke_session")
        expect(hasLocalSession(M)).toBe(false)
        forgetQuickPlay(M) // idempotent
    })
})

const KEY33 = btoa(String.fromCharCode(2, ...Array(32).fill(7)))
const entry = (expires: number, paths = ["vm/exec:gno.land/r/test/c4"], key = KEY33) => ({ BaseSessionAccount: { BaseAccount: { public_key: { value: key } }, expires_at: String(expires) }, allow_paths: paths })
/** fetch mock: sessions list -> `list`, single session -> sessionJSON */
const routed = (list: unknown | "fail") => vi.fn(async (url: string) => (url.includes("/sessions") ? (list === "fail" ? { ok: false, json: async () => ({}) } : query(list)) : query(sessionJSON())))

describe("startQuickPlay slot cleanup", () => {
    it("revokes only expired own-path sessions, before create, in one call", async () => {
        grc.doContractBroadcast.mockResolvedValueOnce({ hash: "h" })
        vi.stubGlobal("fetch", routed([entry(now() - 5), entry(now() + 999), entry(now() - 5, ["vm/exec:gno.land/r/other"])]))
        await startQuickPlay(M, 3600)
        const [msgs] = grc.doContractBroadcast.mock.calls[0]
        expect(msgs.map((m: { type: string }) => m.type)).toEqual(["/auth.m_revoke_session", "/auth.m_create_session"])
        expect(msgs[0].value.session_key.value).toBe(btoa(String.fromCharCode(0x0a, 0x21, ...atob(KEY33).split("").map((c) => c.charCodeAt(0)))))
    })
    it("refuses at the 16-session cap without calling Adena", async () => {
        vi.stubGlobal("fetch", routed(Array.from({ length: 16 }, () => entry(now() + 999))))
        await expect(startQuickPlay(M, 3600)).rejects.toThrow(/16 sessions/)
        expect(grc.doContractBroadcast).not.toHaveBeenCalled()
        expect(hasLocalSession(M)).toBe(false)
    })
    it("creates only when the sessions query fails", async () => {
        grc.doContractBroadcast.mockResolvedValueOnce({ hash: "h" })
        vi.stubGlobal("fetch", routed("fail"))
        await startQuickPlay(M, 3600)
        expect(grc.doContractBroadcast.mock.calls[0][0]).toHaveLength(1)
    })
    it("is refused while a local session exists", async () => {
        grc.doContractBroadcast.mockResolvedValueOnce({ hash: "h" })
        vi.stubGlobal("fetch", routed([]))
        await startQuickPlay(M, 3600)
        await expect(startQuickPlay(M, 3600)).rejects.toThrow(/already on/)
        expect(grc.doContractBroadcast).toHaveBeenCalledTimes(1)
    })
})

describe("hardening", () => {
    async function started() {
        grc.doContractBroadcast.mockResolvedValueOnce({ hash: "h" })
        vi.stubGlobal("fetch", routed([]))
        await startQuickPlay(M, 3600)
    }
    it("session read failure -> rejected, key kept", async () => {
        await started()
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")))
        await expect(quickPlayCall(M, "Play", ["7", "4"])).rejects.toEqual(expect.objectContaining({ reason: "rejected" }))
        expect(hasLocalSession(M)).toBe(true)
    })
    it("maps check_tx messages", async () => {
        await started()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(query(sessionJSON())))
        bc.broadcastSignedTx.mockRejectedValueOnce(new CheckTxError("spend limit exceeded"))
        await expect(quickPlayCall(M, "Play", ["7", "4"])).rejects.toEqual(expect.objectContaining({ reason: "budget" }))
        expect(bc.broadcastSignedTx).toHaveBeenCalledTimes(1)
        bc.broadcastSignedTx.mockRejectedValueOnce(new CheckTxError("session expired"))
        await expect(quickPlayCall(M, "Play", ["7", "4"])).rejects.toEqual(expect.objectContaining({ reason: "ended" }))
        expect(hasLocalSession(M)).toBe(false)
    })
    it("quickPlayStatus: status / null+clear / throw+keep", async () => {
        await started()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(query(sessionJSON())))
        expect((await quickPlayStatus(M))?.spendLimitUgnot).toBe(1_000_000)
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")))
        await expect(quickPlayStatus(M)).rejects.toThrow()
        expect(hasLocalSession(M)).toBe(true)
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(query(null)))
        expect(await quickPlayStatus(M)).toBeNull()
        expect(hasLocalSession(M)).toBe(false)
    })
    it("tampered storage is ignored", async () => {
        await started()
        const k = `memba.quickplay.onyx.${M}`
        const e = JSON.parse(localStorage.getItem(k)!)
        localStorage.setItem(k, JSON.stringify({ ...e, chainId: "other" }))
        expect(hasLocalSession(M)).toBe(false)
        localStorage.setItem(k, JSON.stringify({ ...e, sessionAddr: "g1p8xftdc9v75netuza8kgtrzg8yxaagd8u3hk5m" }))
        expect(hasLocalSession(M)).toBe(false)
    })
    it("rejects malformed master", async () => {
        await expect(startQuickPlay("nope", 3600)).rejects.toThrow()
    })
})
