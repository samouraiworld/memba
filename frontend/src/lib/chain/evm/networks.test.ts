import { describe, expect, it } from "vitest"
import { NETWORKS, RETIRED_NETWORKS } from "../../config"
import { EVM_NETWORKS, isVisibleEvmNetworkKey } from "./networks"

describe("EVM network registry", () => {
    it("never shares a key with a Gno network, live or retired", () => {
        for (const key of Object.keys(EVM_NETWORKS)) {
            expect(Object.hasOwn(NETWORKS, key)).toBe(false)
            expect(Object.hasOwn(RETIRED_NETWORKS, key)).toBe(false)
        }
    })

    it("names Base and Base Sepolia by their EIP-155 chain ids", () => {
        expect(EVM_NETWORKS["base-sepolia"]).toMatchObject({ chainId: 84532, label: "Base Sepolia", isTestnet: true })
        expect(EVM_NETWORKS.base).toMatchObject({ chainId: 8453, label: "Base", isTestnet: false })
    })

    it("offers Base Sepolia only: Base mainnet stays hidden until launch", () => {
        expect(isVisibleEvmNetworkKey("base-sepolia")).toBe(true)
        expect(EVM_NETWORKS.base.hidden).toBe(true)
        expect(isVisibleEvmNetworkKey("base")).toBe(false)
    })

    it("rejects keys every object inherits, Gno keys and empty values", () => {
        for (const key of ["constructor", "toString", "__proto__", "mainnet", "", null, undefined]) {
            expect(isVisibleEvmNetworkKey(key)).toBe(false)
        }
    })
})
