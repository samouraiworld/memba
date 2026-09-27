import { afterEach, describe, expect, it } from "vitest"
import { BOOT_MS, bootLines, shouldBoot } from "./boot"

afterEach(() => localStorage.clear())

describe("shouldBoot", () => {
    it("plays on every lock entry, never under reduced motion or on direct links", () => {
        expect(shouldBoot({ entry: "lock", reducedMotion: false })).toBe(true)
        expect(shouldBoot({ entry: "lock", reducedMotion: true })).toBe(false)
        // A shared link, a resumed session or a returning guest go straight in.
        for (const entry of ["link", "resume", "guest"] as const) expect(shouldBoot({ entry, reducedMotion: false }), entry).toBe(false)
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
