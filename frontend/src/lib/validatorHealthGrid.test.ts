/**
 * ValidatorHealthGrid.test.ts
 *
 * Unit tests for ValidatorHealthGrid helper functions:
 * - healthBadge: maps health status to label + className
 * - missedBlocksColor: severity-based CSS class selection
 * - formatPercent: null-safe percentage formatting (shared, was local formatPct)
 */

import { describe, it, expect } from "vitest"
import { healthBadge, missedBlocksColor } from "../components/validators/validatorHealthHelpers"
import { formatPercent } from "./validators"
import { ValidatorHealthStatus } from "./validatorHealth"

describe("ValidatorHealthGrid helpers", () => {
    // ── healthBadge ─────────────────────────────────────────────
    describe("healthBadge", () => {
        it("returns healthy badge for Healthy status", () => {
            const badge = healthBadge(ValidatorHealthStatus.Healthy)
            expect(badge.label).toContain("Healthy")
            expect(badge.className).toBe("vh-badge--healthy")
        })

        it("returns degraded badge for Degraded status", () => {
            const badge = healthBadge(ValidatorHealthStatus.Degraded)
            expect(badge.label).toContain("Degraded")
            expect(badge.className).toBe("vh-badge--degraded")
        })

        it("returns down badge for Down status", () => {
            const badge = healthBadge(ValidatorHealthStatus.Down)
            expect(badge.label).toContain("Down")
            expect(badge.className).toBe("vh-badge--down")
        })

        it("returns unknown badge for Unknown status", () => {
            const badge = healthBadge(ValidatorHealthStatus.Unknown)
            expect(badge.label).toContain("Unknown")
            expect(badge.className).toBe("vh-badge--unknown")
        })

        it("defaults to unknown for unrecognized status", () => {
            const badge = healthBadge(999 as ValidatorHealthStatus)
            expect(badge.className).toBe("vh-badge--unknown")
        })
    })

    // ── missedBlocksColor ────────────────────────────────────────
    describe("missedBlocksColor", () => {
        it("returns empty string for null", () => {
            expect(missedBlocksColor(null)).toBe("")
        })

        it("returns empty string for 0 missed blocks", () => {
            expect(missedBlocksColor(0)).toBe("")
        })

        it("returns low severity for 1-5 missed blocks", () => {
            expect(missedBlocksColor(1)).toBe("vh-missed--low")
            expect(missedBlocksColor(5)).toBe("vh-missed--low")
        })

        it("returns med severity for 6-20 missed blocks", () => {
            expect(missedBlocksColor(6)).toBe("vh-missed--med")
            expect(missedBlocksColor(20)).toBe("vh-missed--med")
        })

        it("returns high severity for >20 missed blocks", () => {
            expect(missedBlocksColor(21)).toBe("vh-missed--high")
            expect(missedBlocksColor(100)).toBe("vh-missed--high")
        })
    })

    // ── percentage formatting (was the local formatPct) ──────────
    // formatPct duplicated lib/validators.formatPercent with weaker behaviour and
    // was retired; the grid now uses the single shared formatter. Expectations
    // updated where the two genuinely differ: integers render bare ("100%", not
    // "100.0%"), and NaN/Infinity are absences rather than "NaN%".
    describe("formatPercent (shared)", () => {
        it("returns an em dash for null and undefined", () => {
            expect(formatPercent(null)).toBe("—")
            expect(formatPercent(undefined)).toBe("—")
        })

        it("renders integers without a trailing .0", () => {
            expect(formatPercent(0)).toBe("0%")
            expect(formatPercent(100)).toBe("100%")
        })

        it("rounds to one decimal", () => {
            expect(formatPercent(99.95)).toBe("100%")
            expect(formatPercent(50.123)).toBe("50.1%")
        })

        it("formats negative values", () => {
            expect(formatPercent(-1)).toBe("-1%")
        })

        it("treats NaN and Infinity as absent, not as a percentage", () => {
            expect(formatPercent(NaN)).toBe("—")
            expect(formatPercent(Infinity)).toBe("—")
        })
    })
})
