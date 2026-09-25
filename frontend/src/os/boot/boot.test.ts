import { afterEach, describe, expect, it } from "vitest"
import { BOOT_MS, BOOTED_KEY, bootLines, markBooted, readBooted, shouldBoot } from "./boot"

afterEach(() => localStorage.clear())

describe("shouldBoot", () => {
    it("plays on a first visit (the lock screen) only, never under reduced motion, never twice", () => {
        expect(shouldBoot({ entry: "lock", reducedMotion: false, booted: false })).toBe(true)
        expect(shouldBoot({ entry: "lock", reducedMotion: true, booted: false })).toBe(false)
        expect(shouldBoot({ entry: "lock", reducedMotion: false, booted: true })).toBe(false)
        // A shared link, a resumed session or a returning guest go straight in.
        for (const entry of ["link", "resume", "guest"] as const) expect(shouldBoot({ entry, reducedMotion: false, booted: false }), entry).toBe(false)
    })

    it("remembers that it played, in this browser", () => {
        expect(readBooted()).toBe(false)
        markBooted()
        expect(readBooted()).toBe(true)
        expect(localStorage.getItem(BOOTED_KEY)).toBe("1")
    })

    it("stays short: the whole boot is under 2.2 s", () => {
        expect(BOOT_MS).toBeLessThanOrEqual(2200)
    })
})

describe("bootLines", () => {
    it("reports only real, local facts, with the values lined up", () => {
        const lines = bootLines({ chainId: "gnoland-1", isTestnet: false, wallet: true, deskCount: 3, appCount: 16 })
        expect(lines).toEqual([
            { label: "MEMBA OS", value: "gno.land" },
            { label: "network", value: "gnoland-1", status: "ok" },
            { label: "wallet", value: "adena", status: "found" },
            { label: "desk", value: "3 items" },
            { label: "apps", value: "16 ready" },
        ])
    })

    it("says so when there's no wallet yet, on a testnet, or with one desk item", () => {
        const lines = bootLines({ chainId: "test-13", isTestnet: true, wallet: false, deskCount: 1, appCount: 16 })
        expect(lines[1]).toEqual({ label: "network", value: "test-13", status: "testnet" })
        expect(lines[2]).toEqual({ label: "wallet", value: "none yet" })
        expect(lines[3]).toEqual({ label: "desk", value: "1 item" })
    })
})
