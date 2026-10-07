import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { EVM_NETWORKS } from "./networks"
import { EVM_MANIFEST } from "./manifest.generated"
import { deniedReason, evmContract, evmContractEntry, hasEvmManifest, type EvmContractKey } from "./manifest"

const repo = resolve(__dirname, "../../../../..")
const json = (chainId: number) =>
    JSON.parse(readFileSync(join(repo, "deployments/evm", `${chainId}.json`), "utf8")) as {
        contracts: Record<string, { address: string; codehash: string }>
        deny: Record<string, { address: string }>
    }

describe("EVM manifest", () => {
    it("has a manifest for every EVM network Memba defines, and for nothing else", () => {
        const networkIds = Object.values(EVM_NETWORKS).map((n) => String(n.chainId)).sort()
        expect(Object.keys(EVM_MANIFEST).sort()).toEqual(networkIds)
    })

    it("returns the deployments/evm address and codehash for every key on every chain", () => {
        for (const chainId of [8453, 84532]) {
            const source = json(chainId)
            const keys = Object.keys(source.contracts) as EvmContractKey[]
            expect(keys.length).toBeGreaterThan(0)
            for (const key of keys) {
                expect(evmContract(chainId, key)).toBe(source.contracts[key].address)
                expect(evmContractEntry(chainId, key).codehash).toBe(source.contracts[key].codehash)
            }
        }
    })

    it("keeps per-chain values apart: Basenames and Aragon differ, Safe does not", () => {
        expect(evmContract(8453, "basenamesRegistrarController")).not.toBe(evmContract(84532, "basenamesRegistrarController"))
        expect(evmContract(8453, "aragonDaoFactory")).not.toBe(evmContract(84532, "aragonDaoFactory"))
        expect(evmContract(8453, "safeL2Singleton")).toBe(evmContract(84532, "safeL2Singleton"))
        expect(evmContractEntry(8453, "aragonTokenVotingRepo").build).toEqual({ release: 1, build: 4 })
        expect(evmContractEntry(84532, "aragonTokenVotingRepo").build).toEqual({ release: 1, build: 3 })
        expect(evmContractEntry(8453, "basenamesL2Resolver").proxy?.implementation).toMatch(/^0x[0-9a-fA-F]{40}$/)
    })

    it("refuses a chain it has no manifest for", () => {
        expect(hasEvmManifest(1)).toBe(false)
        expect(() => evmContract(1, "safeL2Singleton")).toThrow(/No EVM manifest for chain 1/)
        for (const id of [Number.NaN, 0, -8453]) expect(hasEvmManifest(id)).toBe(false)
    })

    it("names the denied look-alikes, whatever their case, and nothing else", () => {
        const legacy = json(8453).deny.basenamesRegistrarControllerLegacy.address
        expect(deniedReason(8453, legacy.toLowerCase())).toMatch(/Legacy RegistrarController/)
        expect(deniedReason(8453, evmContract(8453, "basenamesRegistrarController"))).toBeNull()
        expect(deniedReason(1, legacy)).toBeNull()
    })

    it("no source file outside the generated module spells a denied address", () => {
        const denied = [8453, 84532].flatMap((id) => Object.values(json(id).deny).map((d) => d.address.toLowerCase()))
        const src = resolve(__dirname, "../../..")
        const offenders: string[] = []
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                const path = join(dir, name)
                if (statSync(path).isDirectory()) walk(path)
                else if (/\.(ts|tsx)$/.test(name) && !path.endsWith("manifest.generated.ts") && !path.endsWith("manifest.test.ts")) {
                    const text = readFileSync(path, "utf8").toLowerCase()
                    if (denied.some((a) => text.includes(a))) offenders.push(path)
                }
            }
        }
        walk(src)
        expect(offenders).toEqual([])
    })
})
