/**
 * validatorHealth.test.ts — Unit tests for the Health Status Engine.
 *
 * Tests cover:
 *   - All 4 health states (Healthy, Degraded, Down, Unknown)
 *   - Priority logic (incidents > block sigs > uptime > participation)
 *   - Edge cases (null values, empty arrays, conflicting signals)
 *   - Network health summary computation
 *   - CSS/label/icon helper functions
 */

import { describe, it, expect } from "vitest"
import {
    computeHealthStatus,
    computeNetworkHealth,
    healthCssClass,
    healthLabel,
    healthIcon,
    ValidatorHealthStatus,
} from "./validatorHealth"
import type { ValidatorInfo } from "./validators"

// ── Factory helper ──────────────────────────────────────────────

function makeValidator(overrides: Partial<ValidatorInfo> = {}): ValidatorInfo {
    return {
        address: "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
        gnoAddr: "g1testvalidator",
        moniker: "test-val",
        pubkey: "ed25519/abc123",
        pubkeyType: "tendermint/PubKeyEd25519",
        votingPower: 1000,
        powerPercent: 10.0,
        rank: 1,
        active: true,
        proposerPriority: 0,
        participationRate: null,
        uptimePercent: null,
        profileUrl: "",
        lastBlockSignatures: [],
        startTime: "",
        healthStatus: ValidatorHealthStatus.Unknown,
        healthMeta: null,
        missedBlocks: null,
        incidents: [],
        operationTime: null,
        lastIncidentDate: null,
        ...overrides,
    }
}


// ── Time helpers ────────────────────────────────────────────────
// Incidents are now evaluated against a recency window, so a fixture with a
// hardcoded date silently ages into irrelevance. These tests assert PRIORITY
// (critical beats warning, most-recent wins), not recency, so their incidents
// are pinned relative to now and stay meaningful whenever the suite runs.
const HOUR = 60 * 60 * 1000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
const signed = (n: number) => new Array<boolean>(n).fill(true)

// ── computeHealthStatus ─────────────────────────────────────────

describe("computeHealthStatus", () => {
    it("returns Unknown when no monitoring data and no block sigs", () => {
        const v = makeValidator()
        const result = computeHealthStatus(v)
        expect(result.status).toBe(ValidatorHealthStatus.Unknown)
        expect(result.reason).toContain("No monitoring data")
    })

    it("returns Healthy when all signals are good", () => {
        const v = makeValidator({
            uptimePercent: 99.5,
            participationRate: 98,
            lastBlockSignatures: [true, true, true, true, true],
            incidents: [],
        })
        const result = computeHealthStatus(v)
        expect(result.status).toBe(ValidatorHealthStatus.Healthy)
        expect(result.reason).toContain("nominal")
    })

    it("returns Down on CRITICAL incident (highest priority)", () => {
        const v = makeValidator({
            uptimePercent: 100, // high uptime — should be overridden by incident
            participationRate: 100,
            lastBlockSignatures: [true, true, true],
            incidents: [{
                addr: "g1test",
                moniker: "test",
                severity: "CRITICAL",
                timestamp: iso(1 * HOUR),
                details: "30+ blocks missed",
            }],
        })
        const result = computeHealthStatus(v)
        expect(result.status).toBe(ValidatorHealthStatus.Down)
        expect(result.latestIncidentSeverity).toBe("CRITICAL")
    })

    it("returns Degraded on WARNING incident", () => {
        const v = makeValidator({
            uptimePercent: 100,
            incidents: [{
                addr: "g1test",
                moniker: "test",
                severity: "WARNING",
                timestamp: iso(1 * HOUR),
                details: "5+ blocks missed",
            }],
        })
        const result = computeHealthStatus(v)
        expect(result.status).toBe(ValidatorHealthStatus.Degraded)
        expect(result.latestIncidentSeverity).toBe("WARNING")
    })

    it("RESOLVED incident does not mark Down — falls through to other signals", () => {
        const v = makeValidator({
            uptimePercent: 99.5,
            lastBlockSignatures: [true, true, true],
            incidents: [{
                addr: "g1test",
                moniker: "test",
                severity: "RESOLVED",
                timestamp: iso(1 * HOUR),
                details: "Validator back online",
            }],
        })
        const result = computeHealthStatus(v)
        expect(result.status).toBe(ValidatorHealthStatus.Healthy)
    })

    it("returns Down for 5+ consecutive missed blocks", () => {
        const v = makeValidator({
            // Most recent first: 5 missed then signed
            lastBlockSignatures: [false, false, false, false, false, true, true],
            participationRate: 80,
        })
        const result = computeHealthStatus(v)
        expect(result.status).toBe(ValidatorHealthStatus.Down)
        expect(result.reason).toContain("5 consecutive")
    })

    it("returns Degraded for 1-4 consecutive missed blocks", () => {
        const v = makeValidator({
            lastBlockSignatures: [false, false, true, true, true],
            participationRate: 95,
        })
        const result = computeHealthStatus(v)
        expect(result.status).toBe(ValidatorHealthStatus.Degraded)
        expect(result.reason).toContain("2 recent block")
    })

    it("returns Down for uptime below 90%", () => {
        const v = makeValidator({
            uptimePercent: 85,
            lastBlockSignatures: [true, true, true],
        })
        const result = computeHealthStatus(v)
        expect(result.status).toBe(ValidatorHealthStatus.Down)
        expect(result.reason).toContain("85%")
    })

    it("returns Degraded for uptime between 90-99%", () => {
        const v = makeValidator({
            uptimePercent: 95,
            lastBlockSignatures: [true, true, true],
        })
        const result = computeHealthStatus(v)
        expect(result.status).toBe(ValidatorHealthStatus.Degraded)
        expect(result.reason).toContain("95%")
    })

    it("CRITICAL incident overrides high uptime and perfect block sigs", () => {
        const v = makeValidator({
            uptimePercent: 100,
            lastBlockSignatures: [true, true, true, true, true],
            participationRate: 100,
            incidents: [{
                addr: "g1test",
                moniker: "test",
                severity: "CRITICAL",
                timestamp: iso(1 * HOUR),
                details: "Validator crashed",
            }],
        })
        const result = computeHealthStatus(v)
        expect(result.status).toBe(ValidatorHealthStatus.Down)
    })

    it("picks the most recent incident when multiple exist", () => {
        const v = makeValidator({
            uptimePercent: 100,
            incidents: [
                { addr: "g1test", moniker: "test", severity: "CRITICAL", timestamp: iso(3 * HOUR), details: "Old crash" },
                { addr: "g1test", moniker: "test", severity: "RESOLVED", timestamp: iso(1 * HOUR), details: "Back online" },
            ],
        })
        const result = computeHealthStatus(v)
        // Most recent is RESOLVED → falls through → Healthy
        expect(result.status).toBe(ValidatorHealthStatus.Healthy)
    })

    it("all signed blocks + has participation → Healthy", () => {
        const v = makeValidator({
            lastBlockSignatures: [true, true, true, true, true, true, true, true, true, true],
            participationRate: 99,
        })
        const result = computeHealthStatus(v)
        expect(result.status).toBe(ValidatorHealthStatus.Healthy)
    })

    it("single missed block in middle does not affect consecutive count", () => {
        const v = makeValidator({
            // Most recent first: signed, missed, signed, signed, signed
            lastBlockSignatures: [true, false, true, true, true],
            participationRate: 99,
        })
        // Consecutive missed from most recent = 0 (first is true)
        const result = computeHealthStatus(v)
        expect(result.status).toBe(ValidatorHealthStatus.Healthy)
    })
})

// ── computeNetworkHealth ────────────────────────────────────────

describe("computeNetworkHealth", () => {
    it("computes correct counts for mixed validator set", () => {
        const validators = [
            makeValidator({ healthStatus: ValidatorHealthStatus.Healthy, uptimePercent: 100 }),
            makeValidator({ healthStatus: ValidatorHealthStatus.Healthy, uptimePercent: 99 }),
            makeValidator({ healthStatus: ValidatorHealthStatus.Degraded, uptimePercent: 95 }),
            makeValidator({ healthStatus: ValidatorHealthStatus.Down, uptimePercent: 80 }),
            makeValidator({ healthStatus: ValidatorHealthStatus.Unknown }),
        ]
        const summary = computeNetworkHealth(validators)
        expect(summary.total).toBe(5)
        expect(summary.healthy).toBe(2)
        expect(summary.degraded).toBe(1)
        expect(summary.down).toBe(1)
        expect(summary.unknown).toBe(1)
        expect(summary.avgUptime).toBe(93.5)
    })

    it("returns null avgUptime when no uptimes available", () => {
        const validators = [makeValidator(), makeValidator()]
        const summary = computeNetworkHealth(validators)
        expect(summary.avgUptime).toBeNull()
    })

    it("tracks latest incident across all validators", () => {
        const validators = [
            makeValidator({
                healthStatus: ValidatorHealthStatus.Down,
                moniker: "val-a",
                incidents: [{
                    addr: "g1a", moniker: "val-a", severity: "CRITICAL",
                    timestamp: "2026-03-25T08:00:00Z", details: "crash",
                }],
            }),
            makeValidator({
                healthStatus: ValidatorHealthStatus.Degraded,
                moniker: "val-b",
                incidents: [{
                    addr: "g1b", moniker: "val-b", severity: "WARNING",
                    timestamp: iso(1 * HOUR), details: "missing blocks",
                }],
            }),
        ]
        const summary = computeNetworkHealth(validators)
        expect(summary.latestIncident?.moniker).toBe("val-b")
        expect(summary.latestIncident?.severity).toBe("WARNING")
    })
})

// ── Helper Functions ────────────────────────────────────────────

describe("healthCssClass", () => {
    it("returns correct class for each status", () => {
        expect(healthCssClass(ValidatorHealthStatus.Healthy)).toBe("val-health-healthy")
        expect(healthCssClass(ValidatorHealthStatus.Degraded)).toBe("val-health-degraded")
        expect(healthCssClass(ValidatorHealthStatus.Down)).toBe("val-health-down")
        expect(healthCssClass(ValidatorHealthStatus.Unknown)).toBe("val-health-unknown")
    })
})

describe("healthLabel", () => {
    it("returns correct label for each status", () => {
        expect(healthLabel(ValidatorHealthStatus.Healthy)).toBe("Healthy")
        expect(healthLabel(ValidatorHealthStatus.Degraded)).toBe("Degraded")
        expect(healthLabel(ValidatorHealthStatus.Down)).toBe("Down")
        expect(healthLabel(ValidatorHealthStatus.Unknown)).toBe("Unknown")
    })
})

describe("healthIcon", () => {
    it("returns correct icon for each status", () => {
        expect(healthIcon(ValidatorHealthStatus.Healthy)).toBe("✅")
        expect(healthIcon(ValidatorHealthStatus.Degraded)).toBe("🟡")
        expect(healthIcon(ValidatorHealthStatus.Down)).toBe("🔴")
        expect(healthIcon(ValidatorHealthStatus.Unknown)).toBe("⚪")
    })
})

// ── Recency: live evidence vs. historical averages ──────────────
//
// THE DEFECT THESE PIN. On prod, onbloc's profile rendered "🔴 Down" directly
// above "LAST 100 BLOCKS — 100/100 PERFECT", on one screen. Two causes:
//
//  1. The rule set was ASYMMETRIC, not mis-ordered. The block-signature rule
//     returned only when consecutiveMissed >= 1, so positive evidence could
//     never terminate the chain — only negative could. A validator signing
//     perfectly right now fell through to a `current_month` uptime average that
//     still carried a bad night from three weeks ago.
//  2. There was NO staleness window anywhere: a single CRITICAL incident pinned
//     a validator to Down indefinitely, however old, until a newer incident
//     happened to arrive. On a chain a day old, `current_month` also spans
//     eleven days that predate genesis.
//
// A status is a claim about NOW. Where live evidence and a long-window average
// disagree, the live evidence wins — and we say which one we used.

describe("computeHealthStatus — recency", () => {
    it("does not report Down while the validator is demonstrably signing", () => {
        // The exact prod case: a bad month, a flawless present.
        const v = makeValidator({ uptimePercent: 53.4, lastBlockSignatures: signed(20) })
        const meta = computeHealthStatus(v)

        expect(meta.status).not.toBe(ValidatorHealthStatus.Down)
        expect(meta.status).toBe(ValidatorHealthStatus.Degraded)
        // The reason must name the conflict, or the badge is unexplainable.
        expect(meta.reason.toLowerCase()).toContain("recover")
    })

    it("still reports Down when the history is bad AND nothing is signing now", () => {
        const v = makeValidator({ uptimePercent: 53.4, lastBlockSignatures: new Array(20).fill(false) })
        expect(computeHealthStatus(v).status).toBe(ValidatorHealthStatus.Down)
    })

    it("requires enough samples before treating live signing as evidence", () => {
        // Three good blocks is not a recovery; it is three blocks.
        const v = makeValidator({ uptimePercent: 53.4, lastBlockSignatures: signed(3) })
        expect(computeHealthStatus(v).status).toBe(ValidatorHealthStatus.Down)
    })

    it("ages out a stale CRITICAL incident instead of pinning Down forever", () => {
        const v = makeValidator({
            uptimePercent: 99.9,
            lastBlockSignatures: signed(20),
            incidents: [{ addr: "g1testvalidator", moniker: "test-val", severity: "CRITICAL", timestamp: iso(72 * HOUR), details: "down" }],
        })
        expect(computeHealthStatus(v).status).toBe(ValidatorHealthStatus.Healthy)
    })

    it("still honours a RECENT critical incident", () => {
        const v = makeValidator({
            uptimePercent: 99.9,
            lastBlockSignatures: signed(20),
            incidents: [{ addr: "g1testvalidator", moniker: "test-val", severity: "CRITICAL", timestamp: iso(1 * HOUR), details: "down" }],
        })
        expect(computeHealthStatus(v).status).toBe(ValidatorHealthStatus.Down)
    })

    it("treats an undated incident as current — absent evidence is not an alibi", () => {
        const v = makeValidator({
            uptimePercent: 99.9,
            incidents: [{ addr: "g1testvalidator", moniker: "test-val", severity: "CRITICAL", timestamp: "", details: "down" }],
        })
        expect(computeHealthStatus(v).status).toBe(ValidatorHealthStatus.Down)
    })

    it("a clean live window alone is enough to report Healthy", () => {
        // No monitoring data at all, but 20 consecutive signed blocks is direct
        // first-hand evidence — better than the Unknown this used to return.
        const v = makeValidator({ lastBlockSignatures: signed(20) })
        expect(computeHealthStatus(v).status).toBe(ValidatorHealthStatus.Healthy)
    })

    it("keeps reporting Down for a validator missing every recent block", () => {
        const v = makeValidator({ lastBlockSignatures: new Array(20).fill(false) })
        const meta = computeHealthStatus(v)
        expect(meta.status).toBe(ValidatorHealthStatus.Down)
        expect(meta.reason).toContain("20")
    })
})
