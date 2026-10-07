import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { getAddress, keccak256, toBytes } from "viem"
import {
    CREATE_SINGLETON, isKnownFallbackHandler, isKnownProxyCodeHash, multiSendAt, SAFE_FALLBACK_HANDLERS, SAFE_MULTISENDS,
    SAFE_CHAIN_IDS, SAFE_PROXY_CODE_HASHES, SAFE_PROXY_FACTORY_1_5_0, SAFE_SINGLETONS, SAFE_SLOTS, singletonAt,
} from "./known"

// The manifests checked against each chain (deployments/evm/<chainId>.json): the frontend table must agree with them.
const repo = join(dirname(fileURLToPath(import.meta.url)), "../../../../../..")
const manifests = [8453, 84532].map((id) => JSON.parse(readFileSync(join(repo, `deployments/evm/${id}.json`), "utf8")) as {
    chainId: number
    contracts: Record<string, { address: string; codehash: string; version?: string }>
})

describe("the Safe contracts Memba recognises", () => {
    it("matches the v1.5.0 contracts each chain's manifest pins, address and codehash", () => {
        for (const { chainId, contracts: c } of manifests) {
            expect(SAFE_CHAIN_IDS).toContain(chainId)
            expect(singletonAt(c.safeSingleton.address)).toMatchObject({ version: "1.5.0", l2: false, codeHash: c.safeSingleton.codehash })
            expect(singletonAt(c.safeL2Singleton.address)).toMatchObject({ version: "1.5.0", l2: true, codeHash: c.safeL2Singleton.codehash })
            expect(SAFE_PROXY_FACTORY_1_5_0).toBe(c.safeProxyFactory.address)
            expect(isKnownFallbackHandler(c.safeFallbackHandler.address)).toBe(true)
            expect(multiSendAt(c.safeMultiSend.address)).toMatchObject({ version: "1.5.0", kind: "multiSend" })
            expect(multiSendAt(c.safeMultiSendCallOnly.address)).toMatchObject({ version: "1.5.0", kind: "multiSendCallOnly" })
        }
    })

    it("creates Safes with SafeL2 v1.5.0", () => {
        expect(CREATE_SINGLETON).toMatchObject({ version: "1.5.0", l2: true, address: "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e" })
    })

    it("writes every address with its EIP-55 checksum and every hash as 32 lowercase bytes", () => {
        const addresses = [...SAFE_SINGLETONS, ...SAFE_FALLBACK_HANDLERS, ...SAFE_MULTISENDS].map((c) => c.address)
        for (const a of [...addresses, SAFE_PROXY_FACTORY_1_5_0]) expect(getAddress(a)).toBe(a)
        expect(new Set(addresses.map((a) => a.toLowerCase())).size).toBe(addresses.length)
        for (const h of [...SAFE_SINGLETONS.map((s) => s.codeHash), ...Object.values(SAFE_PROXY_CODE_HASHES)]) expect(h).toMatch(/^0x[0-9a-f]{64}$/)
    })

    it("names the storage slots by their published preimages", () => {
        expect(SAFE_SLOTS.guard).toBe(keccak256(toBytes("guard_manager.guard.address")))
        expect(SAFE_SLOTS.fallbackHandler).toBe(keccak256(toBytes("fallback_manager.handler.address")))
        expect(SAFE_SLOTS.moduleGuard).toBe(keccak256(toBytes("module_manager.module_guard.address")))
    })

    it("looks addresses and hashes up whatever their case, and knows nothing else", () => {
        expect(singletonAt(CREATE_SINGLETON.address.toLowerCase())).toBe(CREATE_SINGLETON)
        expect(singletonAt(CREATE_SINGLETON.address.toUpperCase().replace("0X", "0x"))).toBe(CREATE_SINGLETON)
        expect(singletonAt("0x0000000000000000000000000000000000000001")).toBeUndefined()
        expect(multiSendAt(manifests[0].contracts.safeL2Singleton.address)).toBeUndefined()
        expect(isKnownFallbackHandler(manifests[0].contracts.safeMultiSend.address)).toBe(false)
        expect(isKnownProxyCodeHash(SAFE_PROXY_CODE_HASHES["1.4.1"].toUpperCase().replace("0X", "0x"))).toBe(true)
        expect(isKnownProxyCodeHash(CREATE_SINGLETON.codeHash)).toBe(false)
    })
})
