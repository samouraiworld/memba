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
     */
    // Parsed with a targeted regex rather than a YAML library on purpose: js-yaml is
    // only a TRANSITIVE dep here, so importing it would make this gate fail the day an
    // unrelated bump drops it — and adding it directly means lockfile churn for one
    // scalar line. The cost is that the parse is TEXTUAL, not structural, so every
    // assumption it makes is asserted explicitly below rather than trusted.
    const workflowText = readFileSync(join(import.meta.dirname, "../../.github/workflows/dependency-review.yml"), "utf8")

    // Match ALL occurrences, not just the first: `.exec()` would read step 1 and be
    // blind to a second dependency-review step carrying a wider allowlist.
    const ghsaLines = [...workflowText.matchAll(/^[ \t]*allow-ghsas:[ \t]*(.*)$/gm)].map((m) => m[1])

    /** Strip an inline `# comment` and surrounding quotes — both are legal YAML the action itself handles. */
    const normalise = (raw: string) =>
        raw
            .replace(/\s+#.*$/, "")
            .trim()
            .replace(/^(['"])(.*)\1$/, "$2")

    const workflowGhsas = (ghsaLines.length === 1 ? normalise(ghsaLines[0]) : "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)

    it("the workflow still has exactly one dependency-review step declaring exactly one allow-ghsas", () => {
        // Every assumption the textual parse rests on, asserted. Without these, the
        // comparison below can pass while enforcing nothing: a second step's allowlist
        // stays invisible, a `warn-only` step never fails, and a disabled step is not a
        // gate at all. A silent-empty parse is caught too — if the key is missing while
        // ALLOWLIST is non-empty the comparison already reddens, but this says why.
        const steps = [...workflowText.matchAll(/actions\/dependency-review-action/g)]
        expect(steps.length, "expected exactly one dependency-review-action step — update this test if that changed").toBe(1)
        expect(ghsaLines.length, "expected exactly one `allow-ghsas:` line in dependency-review.yml").toBe(1)
        expect(workflowText, "dependency-review.yml no longer sets fail-on-severity — update this test").toMatch(
            /^\s*fail-on-severity:/m,
        )
        // A block scalar (`>-` / `|`) would make the captured value the indicator itself
        // rather than the advisory list — legal YAML the action reads correctly and this
        // parse cannot. Fail with the reason rather than a confusing mismatch.
        expect(ghsaLines[0]?.trim(), "allow-ghsas uses a YAML block scalar — this textual parse cannot read it").not.toMatch(
            /^[|>]/,
        )
        // These neuter the gate while leaving every string above intact.
        expect(workflowText, "dependency-review is set to warn-only — it can no longer fail a PR").not.toMatch(
            /^\s*warn-only:\s*true/m,
        )
        expect(workflowText, "the dependency-review job/step is conditionally disabled").not.toMatch(/^\s*if:\s*false/m)
    })

    it("dependency-review.yml allow-ghsas matches audit-ci.mjs ALLOWLIST exactly", () => {
        expect(
            [...workflowGhsas].sort(),
            "the npm-audit gate and the Dependency Review gate disagree about which advisories are acknowledged — " +
                "update BOTH, and keep the written justification in audit-ci.mjs",
        ).toEqual(Object.keys(ALLOWLIST).sort())
    })
})
