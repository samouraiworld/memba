import { createConfig, http, injected, mock } from "@wagmi/core"
import { UserRejectedRequestError } from "viem"
import { base, baseSepolia } from "viem/chains"
import { describe, expect, it, vi } from "vitest"
import { createEvmWallet } from "./wallet"

const ADDR = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01"

function setup(features: Parameters<typeof mock>[0]["features"] = {}) {
    const config = createConfig({
        chains: [baseSepolia, base],
        connectors: [mock({ accounts: [ADDR], features })],
        multiInjectedProviderDiscovery: false,
        transports: { [baseSepolia.id]: http(), [base.id]: http() },
    })
    return createEvmWallet(config)
}

describe("EVM wallet store", () => {
    it("starts disconnected and lists the wallets it can connect", () => {
        const w = setup()
        expect(w.getSnapshot()).toMatchObject({ status: "disconnected", address: "", chainId: null })
        expect(w.getSnapshot().wallets.map((x) => x.name)).toEqual(["Mock Connector"])
    })

    it("connects, keeps the address in its canonical lowercase form, and tells subscribers once per change", async () => {
        const w = setup()
        const seen = vi.fn()
        const before = w.getSnapshot()
        const stop = w.subscribe(seen)
        expect(w.getSnapshot()).toBe(before) // nothing changed: same snapshot, as useSyncExternalStore requires
        expect(await w.connect(before.wallets[0].uid)).toEqual({ ok: true })
        expect(w.getSnapshot()).toMatchObject({ status: "connected", address: ADDR.toLowerCase(), displayAddress: "0xabCDeF0123456789AbcdEf0123456789aBCDEF01", chainId: baseSepolia.id })
        expect(seen).toHaveBeenCalled()
        await w.disconnect()
        expect(w.getSnapshot()).toMatchObject({ status: "disconnected", address: "" })
        stop()
    })

    it("reads a refusal in the wallet as declined, anything else as failed", async () => {
        const declined = setup({ connectError: new UserRejectedRequestError(new Error("User rejected the request.")) })
        expect(await declined.connect(declined.getSnapshot().wallets[0].uid)).toEqual({ ok: false, reason: "declined" })
        const broken = setup({ connectError: new Error("boom") })
        expect(await broken.connect(broken.getSnapshot().wallets[0].uid)).toEqual({ ok: false, reason: "failed" })
    })

    it("asks the wallet to switch chain", async () => {
        const w = setup()
        await w.connect(w.getSnapshot().wallets[0].uid)
        expect(await w.switchChain(base.id)).toEqual({ ok: true })
        expect(w.getSnapshot().chainId).toBe(base.id)
    })

    it("refuses a wallet it does not list", async () => {
        expect(await setup().connect("nope")).toEqual({ ok: false, reason: "failed" })
    })

    it("offers the generic browser wallet only when something is injected and nothing announced itself", () => {
        const generic = () => createEvmWallet(createConfig({
            chains: [baseSepolia], connectors: [injected()], multiInjectedProviderDiscovery: false, transports: { [baseSepolia.id]: http() },
        }))
        expect(generic().getSnapshot().wallets).toEqual([])
        const w = window as { ethereum?: unknown }
        w.ethereum = { request: async () => null, on: () => {}, removeListener: () => {} }
        try {
            expect(generic().getSnapshot().wallets.map((x) => x.name)).toEqual(["Browser wallet"])
        } finally {
            delete w.ethereum
        }
    })

    it("returns the wallet's signature as it gives it, and reads a refusal as declined", async () => {
        // The mock connector forwards signing to the chain's RPC: answer it here with a fixed signature.
        const sig = `0x${"ab".repeat(65)}`
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) =>
            new Response(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(init.body).id, result: sig }), { headers: { "content-type": "application/json" } })))
        try {
            const w = setup()
            await w.connect(w.getSnapshot().wallets[0].uid)
            expect(await w.signMessage("hello", ADDR.toLowerCase())).toEqual({ ok: true, signature: sig })
        } finally {
            vi.unstubAllGlobals()
        }
        const refusing = setup({ signMessageError: new UserRejectedRequestError(new Error("User rejected the request.")) })
        await refusing.connect(refusing.getSnapshot().wallets[0].uid)
        expect(await refusing.signMessage("hello", ADDR.toLowerCase())).toEqual({ ok: false, reason: "declined" })
    })
})
