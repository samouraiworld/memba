#!/usr/bin/env node
/**
 * audit-ci — production `npm audit` gate with an explicit, documented allowlist.
 *
 * Why this exists: `npm audit --audit-level=high` fails CI on ANY high/critical
 * advisory in the prod dependency tree, including advisories that (a) have no
 * fixed version available or (b) do not apply to how Memba actually uses the
 * package. npm audit has no native per-advisory ignore, so this wrapper runs the
 * audit as JSON, subtracts a small allowlist of acknowledged advisories (each
 * with a written justification), and fails only on anything left over.
 *
 * The allowlist is deliberately tiny and loud: every entry is printed on every
 * run so it can't rot silently, and adding one is a reviewable code change.
 *
 * Exit 0 = clean (or only allowlisted high/critical remain). Exit 1 = a
 * non-allowlisted high/critical advisory exists, OR the audit could not be read
 * (fail-closed).
 */

import { execFileSync } from "node:child_process"

/**
 * Acknowledged advisories. KEY = GHSA id (as it appears in the advisory URL).
 * Keep this list minimal; prefer fixing or upgrading over allowlisting.
 */
const ALLOWLIST = {
    "GHSA-qwww-vcr4-c8h2": {
        package: "react-router / react-router-dom",
        reason:
            "RSC-mode CSRF (action executes before a 400). Memba is a Vite SPA " +
            "using <BrowserRouter> + <Routes> (see frontend/src/App.tsx) and does " +
            "NOT use React Router's RSC/data-server APIs, so the vulnerable code " +
            "path is unreachable. npm's only 'fix' is a semver-major DOWNGRADE to " +
            "7.11.0 (no forward patch exists in the 7.12–8.2 range yet), which we " +
            "will not take. Re-evaluate when react-router ships a fixed >8.2.0.",
        added: "2026-07-25",
    },
}

function readAudit() {
    // npm audit exits non-zero when advisories are found, so capture stdout even
    // on a non-zero exit. A genuine failure to produce JSON is fail-closed below.
    try {
        const out = execFileSync(
            "npm",
            ["audit", "--json", "--audit-level=high", "--omit=dev"],
            { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
        )
        return JSON.parse(out)
    } catch (err) {
        // execFileSync throws on non-zero exit; the JSON is still on stdout.
        if (err && typeof err.stdout === "string" && err.stdout.trim()) {
            try {
                return JSON.parse(err.stdout)
            } catch {
                /* fall through to fail-closed */
            }
        }
        console.error("audit-ci: could not run or parse `npm audit --json`:", err?.message || err)
        process.exit(1)
    }
}

/** Pull every distinct GHSA advisory (with metadata) at high/critical severity. */
function collectHighAdvisories(report) {
    const found = new Map() // ghsa -> { title, url, severity }
    const vulns = report?.vulnerabilities || {}
    for (const v of Object.values(vulns)) {
        for (const via of v.via || []) {
            if (typeof via !== "object" || !via.url) continue
            const sev = String(via.severity || "").toLowerCase()
            if (sev !== "high" && sev !== "critical") continue
            const m = /GHSA-[0-9a-z-]+/i.exec(via.url)
            const ghsa = m ? m[0] : via.url
            if (!found.has(ghsa)) found.set(ghsa, { title: via.title || "(no title)", url: via.url, severity: sev })
        }
    }
    return found
}

const report = readAudit()
const advisories = collectHighAdvisories(report)

const acknowledged = []
const blocking = []
for (const [ghsa, info] of advisories) {
    if (ALLOWLIST[ghsa]) acknowledged.push([ghsa, info])
    else blocking.push([ghsa, info])
}

if (acknowledged.length) {
    console.log(`audit-ci: ${acknowledged.length} acknowledged (allowlisted) high/critical advisory(ies):`)
    for (const [ghsa, info] of acknowledged) {
        const a = ALLOWLIST[ghsa]
        console.log(`  • ${ghsa} [${info.severity}] ${a.package} — ${info.title}`)
        console.log(`      justification (${a.added}): ${a.reason}`)
    }
}

if (blocking.length) {
    console.error(`\naudit-ci: ${blocking.length} BLOCKING high/critical advisory(ies) with no allowlist entry:`)
    for (const [ghsa, info] of blocking) {
        console.error(`  ✗ ${ghsa} [${info.severity}] ${info.title}`)
        console.error(`      ${info.url}`)
    }
    console.error("\nFix the dependency (npm audit fix), or — only if it genuinely does not apply —")
    console.error("add a justified entry to ALLOWLIST in frontend/scripts/audit-ci.mjs.")
    process.exit(1)
}

console.log(`\naudit-ci: no un-allowlisted high/critical advisories. OK.`)
process.exit(0)
