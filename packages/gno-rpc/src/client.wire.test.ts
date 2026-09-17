import { describe, it, expect, afterEach, vi } from "vitest"
import { GnoRpcClient } from "./client.js"

// Captured read-only from gnoland-1 (node_info.network checked) on 2026-09-17.
// abci_query vm/qeval, data = base64("gno.land/r/sys/users.ResolveAddress(address(\"g1manfred47…\"))")
const CAPTURED_QEVAL_OK = {
    jsonrpc: "2.0",
    id: 1,
    result: {
        response: {
            ResponseBase: {
                Error: null,
                Data: "KCYoc3RydWN0eygiZzFtYW5mcmVkNDdremR1ZWM5MjB6ODh3ZnI2NHlsa3NtZGNlZGxmNSIgLnV2ZXJzZS5hZGRyZXNzKSwoIm1vdWwiIHN0cmluZyksKGZhbHNlIGJvb2wpfSBnbm8ubGFuZC9yL3N5cy91c2Vycy5Vc2VyRGF0YSkgKmduby5sYW5kL3Ivc3lzL3VzZXJzLlVzZXJEYXRhKQ==",
                Events: null,
                Log: "",
                Info: "",
            },
            Key: null,
            Value: null,
            Proof: null,
            Height: "0",
        },
    },
}
const CAPTURED_QEVAL_TEXT =
    `(&(struct{("g1manfred47kzduec920z88wfr64ylksmdcedlf5" .uverse.address),("moul" string),(false bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)`

// The same query sent with raw (non-base64) data: the node rejects the params.
const CAPTURED_RAW_DATA_ERROR = {
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32602, message: "Invalid params", data: "illegal base64 data at input byte 3" },
}

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64")

/** A fake node that answers like gno.land: it requires base64 `data`. */
function installNode(answer: (path: string, decoded: string) => unknown) {
    const calls: Array<{ path: string; data: string; decoded: string | null }> = []
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
        const { params } = JSON.parse(init.body) as { params: { path: string; data: string } }
        const isB64 = /^[A-Za-z0-9+/]*={0,2}$/.test(params.data) && params.data.length % 4 === 0
        const decoded = isB64 ? Buffer.from(params.data, "base64").toString("utf-8") : null
        calls.push({ path: params.path, data: params.data, decoded })
        const body = decoded === null ? CAPTURED_RAW_DATA_ERROR : answer(params.path, decoded)
        return { json: async () => body } as Response
    }))
    return calls
}

describe("GnoRpcClient ABCI wire format", () => {
    afterEach(() => { vi.unstubAllGlobals() })

    it("sends vm/qeval as base64 of <realm>.<expr> and decodes the captured answer", async () => {
        const calls = installNode(() => CAPTURED_QEVAL_OK)
        const client = new GnoRpcClient({ endpoints: ["http://node.test"], cache: false, maxRetries: 0 })

        const out = await client.queryEval("gno.land/r/sys/users", `ResolveAddress(address("g1manfred47kzduec920z88wfr64ylksmdcedlf5"))`)

        expect(out).toBe(CAPTURED_QEVAL_TEXT)
        expect(calls).toHaveLength(1)
        expect(calls[0].path).toBe("vm/qeval")
        expect(calls[0].data).toBe(b64(`gno.land/r/sys/users.ResolveAddress(address("g1manfred47kzduec920z88wfr64ylksmdcedlf5"))`))
    })

    it("sends vm/qrender as base64 of <realm>:<path>", async () => {
        const calls = installNode(() => ({ result: { response: { ResponseBase: { Error: null, Data: b64("# Proposals") } } } }))
        const client = new GnoRpcClient({ endpoints: ["http://node.test"], cache: false, maxRetries: 0 })

        expect(await client.queryRender("gno.land/r/gov/dao", "proposals")).toBe("# Proposals")
        expect(await client.queryRender("gno.land/r/gov/dao")).toBe("# Proposals")
        expect(calls.map(c => c.decoded)).toEqual(["gno.land/r/gov/dao:proposals", "gno.land/r/gov/dao:"])
    })

    it("base64-encodes vm/qfile data too", async () => {
        const calls = installNode(() => ({ result: { response: { ResponseBase: { Error: null, Data: b64("gnomod.toml\nrender.gno") } } } }))
        const client = new GnoRpcClient({ endpoints: ["http://node.test"], cache: false, maxRetries: 0 })

        expect(await client.realmExists("gno.land/r/gov/dao")).toBe(true)
        expect(calls[0].decoded).toBe("gno.land/r/gov/dao")
    })

    it("negative control: the fake node rejects raw data like the real one", async () => {
        const calls = installNode(() => CAPTURED_QEVAL_OK)
        const res = await fetch("http://node.test", {
            method: "POST",
            body: JSON.stringify({ params: { path: "vm/qeval", data: "gno.land/r/sys/users\nResolveAddress(\"g1\")" } }),
        } as RequestInit)
        expect(await res.json()).toEqual(CAPTURED_RAW_DATA_ERROR)
        expect(calls[0].decoded).toBeNull()
    })
})
