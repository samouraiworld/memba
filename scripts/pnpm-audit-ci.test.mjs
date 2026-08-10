/**
 * Regression guard for the pnpm workspace audit gate. Tests the pure decision
 * logic against synthetic `pnpm audit --json` shapes — no pnpm invocation — so
 * the failure modes that matter can't silently regress:
 *   1. fail-OPEN on a registry/network error. `pnpm audit --json` answers an
 *      unreachable registry with `{"error":{...}}` and NO advisories/metadata;
 *      treating that as "clean" would green the gate while auditing nothing.
 *   2. fail-OPEN on a payload that disagrees with pnpm's own tally (an empty or
 *      truncated advisories map alongside a non-zero high/critical count).
 *   3. mis-keying an advisory. pnpm keys its map by npm's NUMERIC id, so the
 *      allowlist must resolve the GHSA id off the advisory itself.
 *
 * Run with: node --test scripts/pnpm-audit-ci.test.mjs
 */
import { test, describe } from "node:test"
import assert from "node:assert/strict"

import {
    ALLOWLIST,
    advisoryKey,
    classify,
    collectGatedAdvisories,
    isUsableReport,
    reconcile,
    staleAllowlistKeys,
} from "./pnpm-audit-ci.mjs"

/** Build a report with metadata counts derived from the advisories given, so
 *  fixtures stay self-consistent and only the reconcile tests break them. */
const report = (advisories = {}) => {
    const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }
    for (const a of Object.values(advisories)) counts[a.severity] = (counts[a.severity] || 0) + 1
    return {
        actions: [],
        advisories,
        muted: [],
        metadata: { vulnerabilities: counts, dependencies: 174, totalDependencies: 174 },
    }
}

/** Trimmed from real `pnpm audit --json` output (pnpm 10.33.0) — the exact
 *  shape the gate parses, keyed by npm's numeric advisory id. */
const IP_ADDRESS_HIGH = {
    findings: [{ version: "10.2.0", paths: ["mcp-server>@modelcontextprotocol/sdk>express-rate-limit>ip-address"] }],
    id: 1130722,
    title: "ip-address: Address4 decodes leading-zero octets as decimal",
    module_name: "ip-address",
    severity: "high",
    vulnerable_versions: "<=10.3.0",
    patched_versions: ">=10.3.1",
    github_advisory_id: "GHSA-mwp4-54f8-5fhr",
    recommendation: "Upgrade to version 10.3.1 or later",
    cves: ["CVE-2026-69192"],
    url: "https://github.com/advisories/GHSA-mwp4-54f8-5fhr",
}

const HONO_MODERATE = {
    findings: [{ version: "4.12.27", paths: ["mcp-server>@modelcontextprotocol/sdk>hono"] }],
    id: 1130733,
    title: "hono: something moderate",
    module_name: "hono",
    severity: "moderate",
    vulnerable_versions: "<4.12.34",
    patched_versions: ">=4.12.34",
    github_advisory_id: "GHSA-8j4g-w8fx-2239",
    url: "https://github.com/advisories/GHSA-8j4g-w8fx-2239",
}

describe("pnpm-audit-ci — isUsableReport (fail-closed)", () => {
    test("accepts a real report (advisories + metadata.vulnerabilities)", () => {
        assert.equal(isUsableReport(report({ 1130722: IP_ADDRESS_HIGH })), true)
    })

    test("accepts a CLEAN report (empty advisories map is not an error)", () => {
        assert.equal(isUsableReport(report()), true)
    })

    test("rejects the real unreachable-registry shape ({error:{code:ECONNREFUSED}})", () => {
        // Verbatim from `pnpm audit --json --registry=http://127.0.0.1:9/`.
        const err = { error: { code: "ECONNREFUSED", message: "request to http://127.0.0.1:9/... failed" } }
        assert.equal(isUsableReport(err), false)
    })

    test("rejects null, non-objects and bare strings", () => {
        assert.equal(isUsableReport(null), false)
        assert.equal(isUsableReport(undefined), false)
        assert.equal(isUsableReport("request to registry failed"), false)
        assert.equal(isUsableReport(42), false)
    })

    test("rejects a report missing metadata, or missing metadata.vulnerabilities", () => {
        assert.equal(isUsableReport({ advisories: {} }), false)
        assert.equal(isUsableReport({ advisories: {}, metadata: {} }), false)
    })

    test("rejects a report missing the advisories map, or where it is an array", () => {
        assert.equal(isUsableReport({ metadata: { vulnerabilities: {} } }), false)
        assert.equal(isUsableReport({ advisories: [], metadata: { vulnerabilities: {} } }), false)
    })
})

describe("pnpm-audit-ci — advisoryKey", () => {
    test("prefers the github_advisory_id field over the numeric map key", () => {
        assert.equal(advisoryKey(IP_ADDRESS_HIGH, "1130722"), "GHSA-mwp4-54f8-5fhr")
    })

    test("falls back to parsing the GHSA out of the url", () => {
        const { github_advisory_id: _dropped, ...noGhsaField } = IP_ADDRESS_HIGH
        assert.equal(advisoryKey(noGhsaField, "1130722"), "GHSA-mwp4-54f8-5fhr")
    })

    test("falls back to the npm id so an advisory is never dropped for lacking a GHSA", () => {
        assert.equal(advisoryKey({ id: 999, severity: "high" }, "999"), "npm:999")
    })
})

describe("pnpm-audit-ci — collection & classification", () => {
    test("gates high and critical, ignores moderate/low/info", () => {
        const r = report({
            1130722: IP_ADDRESS_HIGH,
            1130733: HONO_MODERATE,
            1: { ...HONO_MODERATE, id: 1, severity: "low", github_advisory_id: "GHSA-low0-0000-0000" },
            2: { ...IP_ADDRESS_HIGH, id: 2, severity: "critical", github_advisory_id: "GHSA-crit-0000-0000" },
        })
        const keys = collectGatedAdvisories(r).map((a) => a.key).sort()
        assert.deepEqual(keys, ["GHSA-crit-0000-0000", "GHSA-mwp4-54f8-5fhr"])
    })

    test("extracts resolved versions and dependency paths from findings[]", () => {
        const [advisory] = collectGatedAdvisories(report({ 1130722: IP_ADDRESS_HIGH }))
        assert.deepEqual(advisory.versions, ["10.2.0"])
        assert.deepEqual(advisory.paths, ["mcp-server>@modelcontextprotocol/sdk>express-rate-limit>ip-address"])
        assert.equal(advisory.patched, ">=10.3.1")
        assert.equal(advisory.module, "ip-address")
    })

    test("tolerates an advisory with no findings array", () => {
        const [advisory] = collectGatedAdvisories(report({ 5: { ...IP_ADDRESS_HIGH, id: 5, findings: undefined } }))
        assert.deepEqual(advisory.versions, [])
        assert.deepEqual(advisory.paths, [])
    })

    test("normalises severity casing", () => {
        const r = report({ 6: { ...IP_ADDRESS_HIGH, id: 6, severity: "HIGH" } })
        // metadata built from the raw casing won't match, so check collection only
        assert.equal(collectGatedAdvisories(r).length, 1)
    })

    test("BLOCKS a high advisory with no allowlist entry", () => {
        const { acknowledged, blocking } = classify(report({ 1130722: IP_ADDRESS_HIGH }), {})
        assert.equal(acknowledged.length, 0)
        assert.deepEqual(blocking.map((a) => a.key), ["GHSA-mwp4-54f8-5fhr"])
    })

    test("acknowledges an allowlisted advisory and does NOT block on it", () => {
        const allowlist = { "GHSA-mwp4-54f8-5fhr": { package: "ip-address", reason: "test", added: "2026-08-10" } }
        const { acknowledged, blocking } = classify(report({ 1130722: IP_ADDRESS_HIGH }), allowlist)
        assert.deepEqual(acknowledged.map((a) => a.key), ["GHSA-mwp4-54f8-5fhr"])
        assert.equal(blocking.length, 0)
    })

    test("an allowlist keyed by npm's numeric id does NOT silence the advisory", () => {
        // Guards the mis-keying trap: the map key is "1130722", the identity is the GHSA.
        const { blocking } = classify(report({ 1130722: IP_ADDRESS_HIGH }), { 1130722: { reason: "x" } })
        assert.equal(blocking.length, 1)
    })
})

describe("pnpm-audit-ci — reconcile (fail-closed on a payload/tally mismatch)", () => {
    test("agrees on a consistent report", () => {
        assert.equal(reconcile(report({ 1130722: IP_ADDRESS_HIGH })).ok, true)
    })

    test("agrees on a clean report (0 expected, 0 found)", () => {
        const r = reconcile(report())
        assert.equal(r.ok, true)
        assert.equal(r.expected, 0)
    })

    test("DISAGREES when the advisories map is empty but metadata counts a high", () => {
        // The exact "green gate that audited nothing" shape.
        const r = { advisories: {}, metadata: { vulnerabilities: { high: 1, critical: 0 } } }
        assert.deepEqual(reconcile(r), { ok: false, expected: 1, actual: 0 })
    })

    test("DISAGREES when metadata counts a critical the payload omits", () => {
        const r = { advisories: { 1130722: IP_ADDRESS_HIGH }, metadata: { vulnerabilities: { high: 1, critical: 2 } } }
        assert.equal(reconcile(r).ok, false)
    })

    test("counts per raw entry, so two advisories sharing a GHSA can't collapse the tally", () => {
        const r = {
            advisories: { 1130722: IP_ADDRESS_HIGH, 1130725: { ...IP_ADDRESS_HIGH, id: 1130725 } },
            metadata: { vulnerabilities: { high: 2, critical: 0 } },
        }
        assert.equal(reconcile(r).ok, true)
    })
})

describe("pnpm-audit-ci — allowlist hygiene", () => {
    test("the allowlist is empty — any addition must be a visible, reviewed diff", () => {
        assert.deepEqual(Object.keys(ALLOWLIST), [])
    })

    test("flags an allowlist entry that matches no live advisory as stale", () => {
        const allowlist = { "GHSA-gone-0000-0000": { reason: "fixed upstream long ago" } }
        assert.deepEqual(staleAllowlistKeys(report({ 1130722: IP_ADDRESS_HIGH }), allowlist), ["GHSA-gone-0000-0000"])
    })

    test("does not flag an entry that still matches a live advisory", () => {
        const allowlist = { "GHSA-mwp4-54f8-5fhr": { reason: "still open" } }
        assert.deepEqual(staleAllowlistKeys(report({ 1130722: IP_ADDRESS_HIGH }), allowlist), [])
    })
})
