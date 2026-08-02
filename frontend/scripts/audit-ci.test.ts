/**
 * Regression guard for the production npm-audit gate. Tests the pure decision
 * logic against synthetic `npm audit --json` shapes — no npm invocation — so the
 * two failure modes that matter can't silently regress:
 *   1. fail-OPEN on a registry/network error (the report has no vulnerabilities
 *      map; treating it as "clean" would green the gate while auditing nothing).
 *   2. false-negative on a string-only `via` back-reference hiding a real high.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { load } from "js-yaml"
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

describe("the two dependency gates agree on what is acknowledged", () => {
    /**
     * WHY: `audit-ci.mjs` and `.github/workflows/dependency-review.yml` are separate
     * gates over the same question, and they were out of sync — the former allowlisted
     * GHSA-qwww-vcr4-c8h2 with a written justification, the latter had no `allow-ghsas`
     * at all. `Dependency Review` only evaluates dependencies a PR CHANGES, so bumping
     * react-router by one patch turned it red over an advisory we had already
     * acknowledged and that the PR was not fixing.
     *
     * A comment saying "keep these in sync" is not a mechanism. This is.
     *
     * PARSED STRUCTURALLY, and that is the point. Three earlier rounds of this guard
     * used a regex over the raw text to avoid taking a dependency. Each round closed the
     * previously-found holes and opened new ones, because a textual parse can only ever
     * assert one SPELLING of a hazard, never the hazard: it read a decoy `allow-ghsas:`
     * out of a `run:` block, missed a second review step, went blind to `warn-only:
     * 'true'` / `True` / `if: ${{ false }}`, and false-redded on quoted values, inline
     * comments and block scalars — all of which the real action reads correctly.
     *
     * The objection to js-yaml was that it was only a TRANSITIVE dep, so an unrelated
     * bump could drop it. That objection is real, and DECLARING it is precisely the fix.
     * It costs nothing else: js-yaml@4.3.0 was already resolved in the lockfile as
     * dev-only, so the declaration adds a single line and no package. Its `argparse`
     * dependency is Python-2.0, which is NOT in this workflow's `allow-licenses` — but
     * `fail-on-scopes` defaults to `['runtime']` and we do not override it, so dev-scoped
     * packages are never license-checked. `audit:ci` runs `--omit=dev`, and this import
     * is test-only, so neither the prod audit surface nor the bundle changes.
     */
    const workflow = load(readFileSync(join(import.meta.dirname, "../../.github/workflows/dependency-review.yml"), "utf8")) as {
        jobs?: Record<string, { if?: unknown; steps?: { uses?: string; if?: unknown; with?: Record<string, unknown> }[] }>
    }

    const reviewSteps = Object.entries(workflow.jobs ?? {}).flatMap(([jobName, job]) =>
        (job.steps ?? [])
            .filter((step) => typeof step.uses === "string" && step.uses.startsWith("actions/dependency-review-action"))
            .map((step) => ({ jobName, job, step })),
    )

    const only = reviewSteps.length === 1 ? reviewSteps[0] : null

    const workflowGhsas = String(only?.step.with?.["allow-ghsas"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)

    it("there is exactly one dependency-review step and it is actually enabled", () => {
        // Scoped to the step, not the file. The previous text-scoped proxies fired on a
        // `warn-only` belonging to a different action in a different job and reported
        // "dependency-review is set to warn-only" — a guard that fails loudly with a
        // wrong explanation teaches the next maintainer to delete the assertion rather
        // than read it, which is worse than not asserting.
        expect(reviewSteps.length, "expected exactly one dependency-review-action step — update this test if that changed").toBe(1)
        expect(only?.step.with?.["fail-on-severity"], "the dependency-review step no longer sets fail-on-severity").toBeDefined()
        // `warn-only` truthiness is the action's `core.getBooleanInput`, which accepts
        // true / 'true' / True / TRUE. Requiring absence sidesteps every spelling.
        expect(only?.step.with?.["warn-only"], "dependency-review sets `warn-only` — it can no longer fail a PR").toBeUndefined()
        expect(only?.step.if, "the dependency-review step is conditional — a conditional gate is not a gate").toBeUndefined()
        expect(only?.job.if, "the dependency-review JOB is conditional — a conditional gate is not a gate").toBeUndefined()
    })

    it("dependency-review.yml allow-ghsas matches audit-ci.mjs ALLOWLIST exactly", () => {
        expect(
            [...workflowGhsas].sort(),
            "the npm-audit gate and the Dependency Review gate disagree about which advisories are acknowledged — " +
                "update BOTH, and keep the written justification in audit-ci.mjs",
        ).toEqual(Object.keys(ALLOWLIST).sort())
    })
})
