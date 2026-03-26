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
        ...overrides,
    }
}

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
                timestamp: "2026-03-26T08:00:00Z",
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
                timestamp: "2026-03-26T08:00:00Z",
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
                timestamp: "2026-03-26T08:00:00Z",
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
                timestamp: "2026-03-26T08:00:00Z",
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
                { addr: "g1test", moniker: "test", severity: "CRITICAL", timestamp: "2026-03-25T08:00:00Z", details: "Old crash" },
                { addr: "g1test", moniker: "test", severity: "RESOLVED", timestamp: "2026-03-26T08:00:00Z", details: "Back online" },
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
                    timestamp: "2026-03-26T08:00:00Z", details: "missing blocks",
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
