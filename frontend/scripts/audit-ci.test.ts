/**
 * Regression guard for the production npm-audit gate. Tests the pure decision
 * logic against synthetic `npm audit --json` shapes — no npm invocation — so the
 * two failure modes that matter can't silently regress:
 *   1. fail-OPEN on a registry/network error (the report has no vulnerabilities
 *      map; treating it as "clean" would green the gate while auditing nothing).
 *   2. false-negative on a string-only `via` back-reference hiding a real high.
 */
import { describe, it, expect } from "vitest"
import { isUsableReport, collectHighAdvisories, classify, ALLOWLIST } from "./audit-ci.mjs"

const okReport = (vulnerabilities: Record<string, unknown> = {}) => ({
    auditReportVersion: 2,
    vulnerabilities,
    metadata: { vulnerabilities: { total: 0 } },
})

const highObj = (ghsa: string, extra: Record<string, unknown> = {}) => ({
    source: 1, name: "x", severity: "high", title: `t-${ghsa}`,
    url: `https://github.com/advisories/${ghsa}`, ...extra,
})

describe("audit-ci — isUsableReport (fail-closed)", () => {
    it("accepts a real audit report (metadata + vulnerabilities)", () => {
        expect(isUsableReport(okReport())).toBe(true)
    })
    it("rejects a registry-error shape ({error})", () => {
        expect(isUsableReport({ error: { code: "ECONNREFUSED", summary: "…" } })).toBe(false)
    })
    it("rejects a bare message shape ({message}) with no vulnerabilities/metadata", () => {
        expect(isUsableReport({ message: "network error" })).toBe(false)
    })
    it("rejects null / non-object / missing-metadata", () => {
        expect(isUsableReport(null)).toBe(false)
        expect(isUsableReport({ vulnerabilities: {} })).toBe(false) // no metadata
        expect(isUsableReport({ metadata: {} })).toBe(false) // vulnerabilities not an object
    })
})

describe("audit-ci — advisory collection & classification", () => {
    it("counts a high advisory once even when a downstream pkg back-references it by string", () => {
        const report = okReport({
            "react-router": { severity: "high", via: [highObj("GHSA-qwww-vcr4-c8h2")] },
            "react-router-dom": { severity: "high", via: ["react-router"] }, // string back-ref
        })
        const found = collectHighAdvisories(report)
        expect([...found.keys()]).toEqual(["GHSA-qwww-vcr4-c8h2"])
    })

    it("ignores low/moderate severity (only high+critical gate)", () => {
        const report = okReport({
            dompurify: { severity: "low", via: [{ ...highObj("GHSA-c2j3-45gr-mqc4"), severity: "low" }] },
        })
        expect([...collectHighAdvisories(report).keys()]).toEqual([])
    })

    it("includes critical severity", () => {
        const report = okReport({ evil: { severity: "critical", via: [highObj("GHSA-crit-0000-0000", { severity: "critical" })] } })
        expect([...collectHighAdvisories(report).keys()]).toContain("GHSA-crit-0000-0000")
    })

    it("acknowledges an allowlisted advisory and does NOT block on it", () => {
        const report = okReport({ "react-router": { severity: "high", via: [highObj("GHSA-qwww-vcr4-c8h2")] } })
        const { acknowledged, blocking } = classify(report)
        expect(acknowledged.map(([g]) => g)).toEqual(["GHSA-qwww-vcr4-c8h2"])
        expect(blocking).toHaveLength(0)
    })

    it("BLOCKS a new, non-allowlisted high advisory", () => {
        const report = okReport({ leftpad: { severity: "high", via: [highObj("GHSA-new-9999-9999")] } })
        const { blocking } = classify(report)
        expect(blocking.map(([g]) => g)).toEqual(["GHSA-new-9999-9999"])
    })

    it("the only allowlist entry is the documented react-router advisory", () => {
        // A stray allowlist addition should be a visible, reviewed diff.
        expect(Object.keys(ALLOWLIST)).toEqual(["GHSA-qwww-vcr4-c8h2"])
    })
})
