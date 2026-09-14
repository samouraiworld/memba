import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sha256 } from "@noble/hashes/sha2.js"

const config = vi.hoisted(() => ({ ENABLE_NATIVE_GNO_MULTISIG: true, GNO_CHAIN_ID: "native-local", GNO_RPC_URL: "http://127.0.0.1:26657" }))
vi.mock("./config", () => config)
import { broadcastNativeTransaction } from "./nativeMultisigBroadcast"

const bytes = new Uint8Array([8, 2, 18, 1, 0])
const hash = Array.from(sha256(bytes), b => b.toString(16).padStart(2, "0")).join("").toUpperCase()
const status = (network = "native-local", catching_up = false) => ({ result: { node_info: { network }, sync_info: { catching_up } } })
const receipt = () => ({ result: { hash, height: "1", check_tx: { ResponseBase: { Error: null } }, deliver_tx: { ResponseBase: { Error: null } } } })
const fetchMock = vi.fn()
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); config.ENABLE_NATIVE_GNO_MULTISIG = true })
afterEach(() => vi.unstubAllGlobals())
function respond(value: unknown) { return new Response(JSON.stringify(value), { status: 200 }) }

describe("native binary broadcast boundary", () => {
    it("sends node-encoded bytes as base64 after chain verification", async () => {
        fetchMock.mockResolvedValueOnce(respond(status())).mockResolvedValueOnce(respond(receipt()))
        expect(await broadcastNativeTransaction("native-local", bytes)).toBe(hash)
        const request = JSON.parse(fetchMock.mock.calls[1][1].body)
        expect(request.params.tx).toBe(btoa(String.fromCharCode(...bytes)))
        expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:26657")
    })
    it("holds activation and mismatched stored chains without fetching", async () => {
        config.ENABLE_NATIVE_GNO_MULTISIG = false
        await expect(broadcastNativeTransaction("native-local", bytes)).rejects.toThrow("on hold")
        config.ENABLE_NATIVE_GNO_MULTISIG = true
        await expect(broadcastNativeTransaction("other-chain", bytes)).rejects.toThrow("does not match")
        expect(fetchMock).not.toHaveBeenCalled()
    })
    it.each([status("other"), status("native-local", true)])("does not broadcast to an unready or wrong RPC", async value => {
        fetchMock.mockResolvedValueOnce(respond(value))
        await expect(broadcastNativeTransaction("native-local", bytes)).rejects.toThrow()
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    it.each(["check_tx", "deliver_tx"] as const)("rejects %s errors even when a hash is returned", async phase => {
        const r = receipt(); r.result[phase].ResponseBase.Error = { message: "rejected" } as never
        fetchMock.mockResolvedValueOnce(respond(status())).mockResolvedValueOnce(respond(r))
        await expect(broadcastNativeTransaction("native-local", bytes)).rejects.toThrow("CheckTx or DeliverTx")
    })
    it("rejects a different returned hash", async () => {
        const r = receipt(); r.result.hash = "0".repeat(64)
        fetchMock.mockResolvedValueOnce(respond(status())).mockResolvedValueOnce(respond(r))
        await expect(broadcastNativeTransaction("native-local", bytes)).rejects.toThrow("different transaction hash")
    })
})
