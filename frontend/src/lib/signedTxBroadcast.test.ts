import { afterEach, describe, expect, it, vi } from "vitest"
vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), GNO_RPC_URL: "https://rpc.test" }))
import { broadcastSignedTx, CheckTxError, OutcomeUnknownError, RealmError } from "./signedTxBroadcast"

const bytes = new Uint8Array([1, 2, 3])
const hashB64 = "A5BYxvLAy0ksUzsKTRTvd8wPeKvMztUofYShogEc+4E=" // sha256([1,2,3]) base64
const status = (network = "onyx-1", catching = false) => ({ ok: true, json: async () => ({ result: { node_info: { network }, sync_info: { catching_up: catching } } }) })
const ok = { ResponseBase: { Error: null, Log: "" } }
const commit = (check: unknown, deliver: unknown, hash = hashB64) => ({ ok: true, json: async () => ({ result: { check_tx: check, deliver_tx: deliver, hash, height: "42" } }) })
const fail = (log: string) => ({ ResponseBase: { Error: { "@type": "/abci.StringError" }, Log: log } })

afterEach(() => vi.unstubAllGlobals())

describe("broadcastSignedTx", () => {
    it("returns the hash on success", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(status()).mockResolvedValueOnce(commit(ok, ok)))
        await expect(broadcastSignedTx("onyx-1", bytes)).resolves.toEqual({ hash: "039058C6F2C0CB492C533B0A4D14EF77CC0F78ABCCCED5287D84A1A2011CFB81", height: 42 })
    })
    it("refuses a different chain or a catching-up node before sending", async () => {
        const f = vi.fn().mockResolvedValue(status("other-1"))
        vi.stubGlobal("fetch", f)
        await expect(broadcastSignedTx("onyx-1", bytes)).rejects.toThrow(/different chain/)
        expect(f).toHaveBeenCalledTimes(1)
    })
    it("surfaces a realm error with its log", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(status()).mockResolvedValueOnce(commit(ok, fail("not your turn"))))
        await expect(broadcastSignedTx("onyx-1", bytes)).rejects.toEqual(expect.objectContaining({ name: "RealmError", message: "not your turn" }))
    })
    it("prefers the StringError value over the log", async () => {
        const deliver = { ResponseBase: { Error: { "@type": "/abci.StringError", value: "game not found" }, Log: "msg traces\nmore" } }
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(status()).mockResolvedValueOnce(commit(ok, deliver)))
        await expect(broadcastSignedTx("onyx-1", bytes)).rejects.toEqual(expect.objectContaining({ name: "RealmError", message: "game not found" }))
    })
    it("surfaces a check_tx rejection", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(status()).mockResolvedValueOnce(commit(fail("unknown session"), null)))
        await expect(broadcastSignedTx("onyx-1", bytes)).rejects.toBeInstanceOf(CheckTxError)
    })
    it("treats transport failures and hash mismatches as outcome unknown", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(status()).mockRejectedValueOnce(new TypeError("network")))
        await expect(broadcastSignedTx("onyx-1", bytes)).rejects.toBeInstanceOf(OutcomeUnknownError)
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(status()).mockResolvedValueOnce(commit(ok, ok, "AAAA")))
        await expect(broadcastSignedTx("onyx-1", bytes)).rejects.toThrow(/different transaction hash/)
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(status()).mockResolvedValueOnce(commit(ok, ok, "AAAA")))
        await expect(broadcastSignedTx("onyx-1", bytes)).rejects.toBeInstanceOf(OutcomeUnknownError)
    })
    it("treats a JSON-RPC error as outcome unknown", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(status()).mockResolvedValueOnce({ ok: true, json: async () => ({ error: { message: "timed out" } }) }))
        await expect(broadcastSignedTx("onyx-1", bytes)).rejects.toBeInstanceOf(OutcomeUnknownError)
    })
    it("treats ok check_tx with null deliver_tx as outcome unknown", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(status()).mockResolvedValueOnce(commit(ok, null)))
        await expect(broadcastSignedTx("onyx-1", bytes)).rejects.toBeInstanceOf(OutcomeUnknownError)
    })
    it("skips amino header lines in the log", async () => {
        const log = "--= Error =--\nData: std.Error{}\nMsg Traces:\n    0  /x.gno:1 - not your turn"
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(status()).mockResolvedValueOnce(commit(ok, fail(log))))
        const err = await broadcastSignedTx("onyx-1", bytes).catch(e => e)
        expect(err).toBeInstanceOf(RealmError)
        expect(err.message).toBe("0  /x.gno:1 - not your turn")
    })
})
