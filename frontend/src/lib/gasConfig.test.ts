/**
 * Unit tests for gasConfig.ts — shared gas configuration.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { getGasConfig } from "./gasConfig"

const SETTINGS_KEY = "memba_settings"

describe("getGasConfig", () => {
    let saved: string | null

    beforeEach(() => {
        saved = localStorage.getItem(SETTINGS_KEY)
    })

    afterEach(() => {
        if (saved !== null) localStorage.setItem(SETTINGS_KEY, saved)
        else localStorage.removeItem(SETTINGS_KEY)
    })

    it("returns defaults when no settings exist", () => {
        localStorage.removeItem(SETTINGS_KEY)
        const gas = getGasConfig()
        expect(gas.fee).toBe(1_000_000)
        expect(gas.wanted).toBe(10_000_000)
        expect(gas.deployWanted).toBe(50_000_000)
    })

    it("reads user-configured values", () => {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ gasWanted: 5_000_000, gasFee: 500_000 }))
        const gas = getGasConfig()
        expect(gas.fee).toBe(500_000)
        expect(gas.wanted).toBe(5_000_000)
        expect(gas.deployWanted).toBe(25_000_000) // 5x
    })

    it("falls back to defaults for corrupt data", () => {
        localStorage.setItem(SETTINGS_KEY, "NOT_JSON!!!")
        const gas = getGasConfig()
        expect(gas.fee).toBe(1_000_000)
        expect(gas.wanted).toBe(10_000_000)
    })

    it("falls back for zero/negative values", () => {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ gasWanted: 0, gasFee: -1 }))
        const gas = getGasConfig()
        expect(gas.fee).toBe(1_000_000)
        expect(gas.wanted).toBe(10_000_000)
    })

    it("handles partial settings", () => {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ gasWanted: 20_000_000 }))
        const gas = getGasConfig()
        expect(gas.wanted).toBe(20_000_000)
        expect(gas.fee).toBe(1_000_000) // default
        expect(gas.deployWanted).toBe(100_000_000) // 5x
    })
})
