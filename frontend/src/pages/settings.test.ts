/**
 * Unit tests for Settings page utilities.
 */
import { describe, it, expect, beforeEach } from "vitest"

const SETTINGS_KEY = "memba_settings"

interface UserSettings {
    gasWanted: number
    gasFee: number
}

function defaults(): UserSettings {
    return { gasWanted: 10000000, gasFee: 1000000 }
}

function loadSettings(): UserSettings {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY)
        if (raw) return { ...defaults(), ...JSON.parse(raw) }
    } catch { /* ignore */ }
    return defaults()
}

function saveSettings(s: UserSettings) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
    } catch { /* quota */ }
}

// ── localStorage Tests ────────────────────────────────────────

describe("Settings localStorage", () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it("returns defaults when nothing saved", () => {
        const s = loadSettings()
        expect(s.gasWanted).toBe(10000000)
        expect(s.gasFee).toBe(1000000)
    })

    it("persists and loads custom gas settings", () => {
        saveSettings({ gasWanted: 5000000, gasFee: 500000 })
        const s = loadSettings()
        expect(s.gasWanted).toBe(5000000)
        expect(s.gasFee).toBe(500000)
    })

    it("merges partial saved data with defaults", () => {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ gasWanted: 1234 }))
        const s = loadSettings()
        expect(s.gasWanted).toBe(1234)
        expect(s.gasFee).toBe(1000000) // default
    })

    it("handles corrupted localStorage gracefully", () => {
        localStorage.setItem(SETTINGS_KEY, "NOT_JSON{{{")
        const s = loadSettings()
        expect(s.gasWanted).toBe(10000000) // defaults
    })

    it("saves and overwrites previous settings", () => {
        saveSettings({ gasWanted: 1, gasFee: 2 })
        saveSettings({ gasWanted: 3, gasFee: 4 })
        const s = loadSettings()
        expect(s.gasWanted).toBe(3)
        expect(s.gasFee).toBe(4)
    })
})

// ── Token Path Validation (BT-M1) ────────────────────────────

describe("token path validation (BT-M1)", () => {
    const realmPathPattern = /^gno\.land\/r\/[a-z0-9_/]+$/

    it("accepts valid realm paths", () => {
        expect(realmPathPattern.test("gno.land/r/demo/gns")).toBe(true)
        expect(realmPathPattern.test("gno.land/r/demo/wugnot")).toBe(true)
        expect(realmPathPattern.test("gno.land/r/gnoswap/v1/pool")).toBe(true)
    })

    it("rejects paths without gno.land/r/ prefix", () => {
        expect(realmPathPattern.test("gno.land/p/demo/avl")).toBe(false) // package, not realm
        expect(realmPathPattern.test("http://malicious.com")).toBe(false)
        expect(realmPathPattern.test("")).toBe(false)
    })

    it("rejects paths with uppercase characters", () => {
        expect(realmPathPattern.test("gno.land/r/Demo/GNS")).toBe(false)
    })

    it("rejects paths with special characters", () => {
        expect(realmPathPattern.test("gno.land/r/demo/../etc/passwd")).toBe(false)
        expect(realmPathPattern.test("gno.land/r/demo/<script>")).toBe(false)
    })
})

// ── Shared Styles ─────────────────────────────────────────────

describe("shared plugin styles", () => {
    it("exports all expected style objects", async () => {
        const styles = await import("../plugins/styles")
        expect(styles.cardStyle).toBeDefined()
        expect(styles.cardClickable).toBeDefined()
        expect(styles.primaryBtn).toBeDefined()
        expect(styles.ghostBtn).toBeDefined()
        expect(styles.dangerBtn).toBeDefined()
        expect(styles.inputStyle).toBeDefined()
        expect(styles.labelStyle).toBeDefined()
        expect(styles.sectionStyle).toBeDefined()
        expect(styles.shimmerRow).toBeDefined()
    })

    it("cardClickable extends cardStyle with cursor", async () => {
        const { cardStyle, cardClickable } = await import("../plugins/styles")
        expect(cardClickable.cursor).toBe("pointer")
        expect(cardClickable.borderRadius).toBe(cardStyle.borderRadius)
    })

    it("primaryBtn has gradient background", async () => {
        const { primaryBtn } = await import("../plugins/styles")
        expect((primaryBtn.background as string)).toContain("gradient")
    })
})
