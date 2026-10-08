import { afterEach, describe, expect, it, vi } from "vitest"
import Safe from "@safe-global/protocol-kit"
import { initNewSafe, initSafe, NEW_SAFE_VERSION, newSafeConfig, safeApiKit, txServiceUrl } from "./sdk"

const OWNER = "0xa11ce00000000000000000000000000000000001"
const OTHER = "0xb0b0000000000000000000000000000000000002"
const provider = { request: vi.fn() }

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("the Transaction Service client", () => {
    it("points at Memba's proxy for the chain", () => {
        expect(txServiceUrl("https://api.memba.test/", 84532)).toBe("https://api.memba.test/api/safe-tx/84532")
        expect(() => txServiceUrl("https://api.memba.test", 0)).toThrow()
        expect(() => txServiceUrl("https://api.memba.test", 1.5)).toThrow()
    })

    it("calls the proxy without an API key: the key stays on the server", async () => {
        const fetch = vi.fn(async () => new Response(JSON.stringify({ safes: [OTHER] }), { status: 200, headers: { "Content-Type": "application/json" } }))
        vi.stubGlobal("fetch", fetch)
        const kit = safeApiKit("https://api.memba.test", 84532)
        expect(await kit.getSafesByOwner(OWNER)).toEqual({ safes: [OTHER] })
        expect(fetch).toHaveBeenCalledOnce()
        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe(`https://api.memba.test/api/safe-tx/84532/v1/owners/${OWNER}/safes/`)
        expect(new Headers(init.headers).has("Authorization")).toBe(false)
    })
})

describe("a new Safe", () => {
    it("is SafeL2 v1.5.0 from the canonical deployment, never protocol-kit's 1.4.1 default", () => {
        expect(newSafeConfig([OWNER, OTHER], 2, 42n)).toEqual({
            safeAccountConfig: { owners: [OWNER, OTHER], threshold: 2 },
            safeDeploymentConfig: { safeVersion: "1.5.0", deploymentType: "canonical", saltNonce: "42" },
        })
        expect(NEW_SAFE_VERSION).toBe("1.5.0")
    })

    it("refuses a threshold outside 1..owners and a negative salt", () => {
        for (const t of [0, 3, 1.5]) expect(() => newSafeConfig([OWNER, OTHER], t, 1n)).toThrow(/threshold/)
        expect(() => newSafeConfig([OWNER], 1, -1n)).toThrow(/salt/)
    })

    it("forces the L2 singleton when protocol-kit is set up, and passes an existing Safe as is", async () => {
        const init = vi.spyOn(Safe, "init").mockResolvedValue({} as Safe)
        const config = newSafeConfig([OWNER], 1, 7n)
        await initNewSafe(provider, OWNER, config)
        expect(init).toHaveBeenLastCalledWith({ provider, signer: OWNER, predictedSafe: config, isL1SafeSingleton: false })
        await initSafe(provider, OWNER, OTHER)
        expect(init).toHaveBeenLastCalledWith({ provider, signer: OWNER, safeAddress: OTHER })
    })
})
