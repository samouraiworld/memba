/**
 * ValidatorHealthGrid.test.ts
 *
 * Unit tests for ValidatorHealthGrid helper functions:
 * - healthBadge: maps health status to label + className
 * - missedBlocksColor: severity-based CSS class selection
 * - formatPct: null-safe percentage formatting
 */

import { describe, it, expect } from "vitest"
import { healthBadge, missedBlocksColor, formatPct } from "../components/validators/validatorHealthHelpers"
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

    // ── formatPct ────────────────────────────────────────────────
    describe("formatPct", () => {
        it("returns '—' for null", () => {
            expect(formatPct(null)).toBe("—")
        })

        it("returns '—' for undefined", () => {
            expect(formatPct(undefined)).toBe("—")
        })

        it("formats 0 as '0.0%'", () => {
            expect(formatPct(0)).toBe("0.0%")
        })

        it("formats 100 as '100.0%'", () => {
            expect(formatPct(100)).toBe("100.0%")
        })

        it("formats 99.95 as '100.0%' (rounding)", () => {
            expect(formatPct(99.95)).toBe("100.0%")
        })

        it("formats 50.123 as '50.1%' (truncation)", () => {
            expect(formatPct(50.123)).toBe("50.1%")
        })

        it("formats negative values", () => {
            expect(formatPct(-1)).toBe("-1.0%")
        })
    })
})
