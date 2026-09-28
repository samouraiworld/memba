/**
 * Unit tests for gasConfig.ts — shared gas configuration.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
    getGasConfig, MAX_DEFAULT_GAS_WANTED, MAX_DEFAULT_GAS_FEE_UGNOT,
    parseDefaultGasInput,
} from "./gasConfig"

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

    it("accepts the largest regular default whose 5x deploy budget fits", () => {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ gasWanted: MAX_DEFAULT_GAS_WANTED, gasFee: MAX_DEFAULT_GAS_FEE_UGNOT }))
        expect(getGasConfig()).toEqual({
            wanted: 100_000_000, deployWanted: 500_000_000, fee: 10_000_000,
        })
    })

    it.each([
        { gasWanted: 100_000_001, gasFee: 10_000_001 },
        { gasWanted: 1.5, gasFee: 1.5 },
        { gasWanted: Number.MAX_SAFE_INTEGER + 1, gasFee: Number.MAX_SAFE_INTEGER + 1 },
        { gasWanted: "10000000", gasFee: "1000000" },
        { gasWanted: null, gasFee: {} },
    ])("falls back independently for unsafe or corrupt saved defaults: %j", values => {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(values))
        expect(getGasConfig()).toEqual({ wanted: 10_000_000, deployWanted: 50_000_000, fee: 1_000_000 })
    })

    it("keeps a valid field when the other saved field is invalid", () => {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ gasWanted: 99_000_000, gasFee: 10_000_001 }))
        expect(getGasConfig()).toEqual({ wanted: 99_000_000, deployWanted: 495_000_000, fee: 1_000_000 })
    })
})

describe("parseDefaultGasInput", () => {
    it("accepts whole decimal values at each boundary", () => {
        expect(parseDefaultGasInput("1", MAX_DEFAULT_GAS_WANTED)).toBe(1)
        expect(parseDefaultGasInput("100000000", MAX_DEFAULT_GAS_WANTED)).toBe(100_000_000)
        expect(parseDefaultGasInput("10000000", MAX_DEFAULT_GAS_FEE_UGNOT)).toBe(10_000_000)
    })

    it.each(["", "0", "-1", "+1", "1.5", "1e3", "12x", " 10", "100000001", "9007199254740992"])(
        "rejects invalid or out-of-range input %j", raw => {
            expect(parseDefaultGasInput(raw, MAX_DEFAULT_GAS_WANTED)).toBeNull()
        },
    )
})
