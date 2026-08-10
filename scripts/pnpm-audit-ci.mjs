#!/usr/bin/env node
/**
 * pnpm-audit-ci — `pnpm audit` gate for the pnpm workspaces (packages/gno-rpc,
 * mcp-server, mcp-server-dao-analyst), with an explicit, documented allowlist.
 *
 * Why this exists: nothing in CI ever audited pnpm-lock.yaml. Every audit gate
 * in the repo (ci.yml, security.yml, deploy-frontend.yml) points at
 * frontend/package-lock.json via `npm audit`, so the workspace lockfile drifted
 * unwatched — 8 advisories accumulated there, including two high (ip-address
 * GHSA-mwp4-54f8-5fhr and nanoid GHSA-2v37-7h3g-55p8, the latter never surfaced
 * by dependabot at all). This is the missing half of the frontend's audit-ci.
 *
 * Design mirrors frontend/scripts/audit-ci.mjs: fail on high/critical, subtract
 * a small allowlist of acknowledged advisories (each with a written
 * justification), and FAIL CLOSED whenever the audit can't be read — a registry
 * or network error must never read as "no vulns".
 *
 * Two things are deliberately NOT used, because both fail OPEN:
 *   • `pnpm audit --ignore-registry-errors` — exits 0 AND prints a bare
 *     non-JSON error line when the registry is unreachable. It is precisely the
 *     "green gate that audited nothing" this script exists to prevent.
 *   • `pnpm audit --ignore <CVE>` — a native ignore with nowhere to record WHY,
 *     no review surface, and no expiry. The ALLOWLIST below carries a
 *     justification per entry and every addition is a reviewable diff.
 *
 * Note this audits the committed lockfile, not an installed tree: `pnpm audit`
 * resolves from pnpm-lock.yaml and needs no `pnpm install`, so the gate reports
 * on exactly what CI would install. It also means raising a floor in
 * package.json without re-resolving the lockfile does NOT clear an advisory
 * here — which is the correct behaviour, and how the floors silently stopped
 * enforcing anything before (see the _comment in the root package.json).
 *
 * Exit 0 = clean (or only allowlisted high/critical remain). Exit 1 = a
 * non-allowlisted high/critical advisory exists, OR the audit could not be read.
 *
 * The pure helpers are exported for unit tests; the audit is only run when this
 * file is executed directly.
 */

import { execFileSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url))

/** Severities that block the build. Everything below is reported, not gated. */
export const GATED_SEVERITIES = new Set(["high", "critical"])

/**
 * Acknowledged advisories. KEY = GHSA id (advisory.github_advisory_id).
 * Keep this list minimal; prefer raising the floor in the root package.json
 * `pnpm.overrides` (to at or above `patched_versions`) over allowlisting.
 *
 * Shape:
 *   "GHSA-xxxx-xxxx-xxxx": {
 *       package: "name",
 *       reason: "why this advisory cannot affect Memba, or why no fix exists",
 *       added: "YYYY-MM-DD",
 *   }
 *
 * Intentionally EMPTY: as of this gate landing, every high/critical advisory in
 * pnpm-lock.yaml was fixed by raising its floor rather than acknowledged. A
 * unit test asserts it stays empty, so the first entry is a visible, reviewed
 * diff rather than a quiet default.
 */
export const ALLOWLIST = {}

/**
 * A successful `pnpm audit --json` always carries BOTH an `advisories` map and
 * a `metadata.vulnerabilities` block. A registry/network failure instead emits
 * `{"error":{"code":"ECONNREFUSED","message":...}}` with neither — and an
 * unreachable registry under `--ignore-registry-errors` emits bare text that
 * isn't even JSON. Anything missing the full shape is unusable, not clean.
 * This is the load-bearing fail-closed check.
 */
export function isUsableReport(report) {
    if (!report || typeof report !== "object" || report.error) return false
    const { advisories, metadata } = report
    if (!advisories || typeof advisories !== "object" || Array.isArray(advisories)) return false
    if (!metadata || typeof metadata !== "object") return false
    return !!metadata.vulnerabilities && typeof metadata.vulnerabilities === "object"
}

/**
 * Stable identity for an advisory. pnpm keys the `advisories` map by npm's
 * NUMERIC advisory id (e.g. "1130722"), which is registry-internal and not what
 * anyone reads or cites. Prefer the GHSA id, fall back to parsing it out of the
 * url, and only then to the numeric id — so a key is always produced and an
 * advisory can never be silently dropped for lacking one.
 */
export function advisoryKey(advisory, rawId) {
    if (advisory?.github_advisory_id) return advisory.github_advisory_id
    const m = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(String(advisory?.url || ""))
    if (m) return m[0]
    return `npm:${advisory?.id ?? rawId}`
}

/**
 * Every high/critical advisory, one record per raw entry in the `advisories`
 * map. Unlike `npm audit --json` there is no `via` graph to walk here: pnpm
 * emits each advisory once as a flat object, with the affected package in
 * `module_name` and the resolved versions/paths under `findings[]`.
 */
export function collectGatedAdvisories(report) {
    const out = []
    for (const [rawId, advisory] of Object.entries(report?.advisories || {})) {
        const severity = String(advisory?.severity || "").toLowerCase()
        if (!GATED_SEVERITIES.has(severity)) continue
        const findings = Array.isArray(advisory?.findings) ? advisory.findings : []
        out.push({
            key: advisoryKey(advisory, rawId),
            severity,
            module: advisory?.module_name || "(unknown package)",
            title: advisory?.title || "(no title)",
            url: advisory?.url || "",
            vulnerable: advisory?.vulnerable_versions || "?",
            patched: advisory?.patched_versions || "(no patched version published)",
            recommendation: advisory?.recommendation || "",
            versions: [...new Set(findings.map((f) => f?.version).filter(Boolean))],
            paths: findings.flatMap((f) => (Array.isArray(f?.paths) ? f.paths : [])),
        })
    }
    return out
}

/**
 * Integrity cross-check. `metadata.vulnerabilities` is pnpm's own per-severity
 * tally, computed independently of the `advisories` payload. If the map we're
 * about to gate on holds fewer high/critical entries than pnpm counted, we are
 * NOT looking at the report pnpm summarised — a truncated, filtered or
 * partially-parsed payload. Returning a mismatch here is what stops a quietly
 * empty `advisories` map from reading as "clean".
 */
export function reconcile(report, gated = collectGatedAdvisories(report)) {
    const counts = report?.metadata?.vulnerabilities || {}
    const expected = Number(counts.high || 0) + Number(counts.critical || 0)
    return { ok: gated.length === expected, expected, actual: gated.length }
}

/** Split the gated advisories into acknowledged (allowlisted) vs blocking. */
export function classify(report, allowlist = ALLOWLIST) {
    const acknowledged = []
    const blocking = []
    for (const advisory of collectGatedAdvisories(report)) {
        ;(allowlist[advisory.key] ? acknowledged : blocking).push(advisory)
    }
    return { acknowledged, blocking }
}

/** Allowlist entries that no longer match any advisory — rotted, and a latent
 *  risk: an entry left behind would silently re-acknowledge the advisory if it
 *  ever came back. Warned, not failed: a cleared advisory must not redden CI. */
export function staleAllowlistKeys(report, allowlist = ALLOWLIST) {
    const live = new Set(collectGatedAdvisories(report).map((a) => a.key))
    return Object.keys(allowlist).filter((k) => !live.has(k))
}

function failClosed(msg, detail) {
    console.error(`pnpm-audit-ci: ${msg} — failing closed.`)
    if (detail) console.error(String(detail).slice(0, 800))
    process.exit(1)
}

function readAudit() {
    // `pnpm audit` exits non-zero both when advisories are found (JSON on
    // stdout, the normal case) AND when it errors. Capture stderr too so the
    // diagnostic isn't swallowed.
    let raw = ""
    let stderr = ""
    try {
        raw = execFileSync("pnpm", ["audit", "--json"], {
            cwd: REPO_ROOT,
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
        })
    } catch (err) {
        raw = typeof err?.stdout === "string" ? err.stdout : ""
        stderr = typeof err?.stderr === "string" ? err.stderr : ""
        if (!raw.trim()) failClosed("`pnpm audit --json` produced no output", stderr || err?.message)
    }

    let report
    try {
        report = JSON.parse(raw)
    } catch {
        failClosed("could not parse `pnpm audit --json` output", stderr || raw)
    }

    if (!isUsableReport(report)) {
        failClosed(
            "pnpm audit did not return an advisories report (error or unknown shape)",
            JSON.stringify(report?.error ?? report?.message ?? report) + (stderr ? `\n${stderr}` : ""),
        )
    }
    return report
}

function describe(advisory) {
    const lines = [`${advisory.key} [${advisory.severity}] ${advisory.module} — ${advisory.title}`]
    if (advisory.versions.length) {
        lines.push(`    resolved ${advisory.versions.join(", ")} · vulnerable ${advisory.vulnerable} · patched ${advisory.patched}`)
    }
    if (advisory.paths.length) {
        const [first, ...rest] = advisory.paths
        lines.push(`    via ${first}${rest.length ? ` (+${rest.length} more path${rest.length > 1 ? "s" : ""})` : ""}`)
    }
    if (advisory.url) lines.push(`    ${advisory.url}`)
    return lines
}

function main() {
    const report = readAudit()

    const gated = collectGatedAdvisories(report)
    const { ok, expected, actual } = reconcile(report, gated)
    if (!ok) {
        failClosed(
            `advisory payload disagrees with pnpm's own tally (metadata reports ${expected} high/critical, ` +
                `the advisories map yielded ${actual})`,
            JSON.stringify(report.metadata?.vulnerabilities),
        )
    }

    const counts = report.metadata.vulnerabilities
    console.log(
        `pnpm-audit-ci: audited pnpm-lock.yaml (${report.metadata.totalDependencies ?? "?"} deps) — ` +
            `${counts.critical || 0} critical, ${counts.high || 0} high, ${counts.moderate || 0} moderate, ` +
            `${counts.low || 0} low. Gating on high+critical.`,
    )

    const { acknowledged, blocking } = classify(report)

    if (acknowledged.length) {
        console.log(`\npnpm-audit-ci: ${acknowledged.length} acknowledged (allowlisted) high/critical advisory(ies):`)
        for (const advisory of acknowledged) {
            const entry = ALLOWLIST[advisory.key]
            for (const line of describe(advisory)) console.log(`  • ${line}`.replace(/^ {2}• {4}/, "      "))
            console.log(`      justification (${entry.added}): ${entry.reason}`)
        }
    }

    for (const key of staleAllowlistKeys(report)) {
        console.log(
            `::warning::pnpm-audit-ci: ALLOWLIST entry ${key} matches no current advisory — ` +
                `it is stale and should be removed from scripts/pnpm-audit-ci.mjs.`,
        )
    }

    if (blocking.length) {
        console.error(`\npnpm-audit-ci: ${blocking.length} BLOCKING high/critical advisory(ies) with no allowlist entry:`)
        for (const advisory of blocking) {
            const [head, ...rest] = describe(advisory)
            console.error(`  ✗ ${head}`)
            for (const line of rest) console.error(`  ${line}`)
            if (advisory.recommendation) console.error(`    ${advisory.recommendation}`)
        }
        console.error(
            "\nFix by raising the dependency's floor in the root package.json `pnpm.overrides` to at or above" +
                "\nits `patched` range, then re-resolve (`pnpm install --no-frozen-lockfile`) and commit the" +
                "\nlockfile — a floor alone changes nothing until the lockfile is re-resolved. Only if the" +
                "\nadvisory genuinely does not apply, add a justified entry to ALLOWLIST in" +
                "\nscripts/pnpm-audit-ci.mjs.",
        )
        process.exit(1)
    }

    console.log("\npnpm-audit-ci: no un-allowlisted high/critical advisories. OK.")
    process.exit(0)
}

// Run the audit only when executed directly (`node scripts/pnpm-audit-ci.mjs`),
// not when imported by the unit test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main()
}
