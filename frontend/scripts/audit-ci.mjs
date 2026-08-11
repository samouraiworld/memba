#!/usr/bin/env node
/**
 * audit-ci — `npm audit` gate with an explicit, documented allowlist.
 *
 * TWO LANES, selected by `--include-dev`:
 *   (default)       `npm audit --omit=dev`  → the PRODUCTION tree. Uses ALLOWLIST.
 *   --include-dev   `npm audit`             → prod + dev, i.e. the BUILD tree.
 *                                             Uses DEV_ALLOWLIST.
 *
 * Why the dev lane exists: `--omit=dev` is the conventional boundary, but "does
 * not ship to the browser" is not the same claim as "cannot affect production".
 * Anything running during compilation can alter the emitted bundle, so build
 * tooling is a real supply-chain surface. Two high advisories (js-yaml
 * GHSA-5p4m-2wfm-xmqj and undici GHSA-4cwx-7wf7-3272) sat open in 2026-08 and
 * were invisible to the prod lane by construction — they surfaced only through
 * Dependabot alerts. This lane closes that blind spot.
 *
 * The allowlists are deliberately SEPARATE. A shared list would let an entry
 * justified as "dev-only, never shipped" silently suppress the same advisory in
 * the production tree — the exact reasoning error this split prevents.
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
 * (fail-closed — a registry/network failure must NEVER read as "no vulns").
 *
 * The pure helpers are exported for unit tests; the audit is only run when this
 * file is executed directly.
 */

import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

/**
 * Acknowledged advisories. KEY = GHSA id (as it appears in the advisory URL).
 * Keep this list minimal; prefer fixing or upgrading over allowlisting.
 */
export const ALLOWLIST = {
    // EMPTY, deliberately. Keep it that way unless an advisory genuinely has no
    // forward fix.
    //
    // GHSA-qwww-vcr4-c8h2 (react-router / react-router-dom, RSC-mode CSRF) lived
    // here from 2026-07-25 and was removed on 2026-08-10. Its justification said
    // "npm's only 'fix' is a semver-major DOWNGRADE to 7.11.0" and framed the
    // choice as "the v8 major or keeping this allowlist". Both became false when
    // the advisory was updated on 2026-08-07 with a SECOND affected range and a
    // v7 backport: `>=7.12.0 <7.18.2` is patched by **7.18.2**, alongside
    // `>=8.0.0 <8.3.0` patched by 8.3.0. #1049 took 7.18.2, so the advisory is
    // fixed rather than accepted, and keeping the entry would have silently
    // suppressed any regression back into 7.12–7.18.1.
    //
    // ⛔ Never "resolve" a react-router advisory by moving to 7.11.x: that range
    // carries GHSA-49rj (unauthenticated RCE, <=7.14.1) and GHSA-h5cw (CSRF,
    // <=7.11.0).
    //
    // LESSON: an entry keyed only on a GHSA id has no version bound, so it keeps
    // suppressing the advisory after the fix ships. Re-check the advisory's
    // affected ranges before adding one — a range can gain a backport later.
}

/**
 * Acknowledged advisories for the DEV/BUILD tree (`--include-dev`). Separate from
 * ALLOWLIST on purpose — see the header. A dev-scope waiver must never leak into
 * the production lane.
 *
 * Bar for an entry here is lower than prod but still real: build tooling can
 * modify the shipped bundle. Prefer raising the floor. State WHY the advisory
 * cannot reach the build output.
 */
export const DEV_ALLOWLIST = {
    // EMPTY. Both dev-scope highs open in 2026-08 were FIXED, not accepted:
    // js-yaml -> 4.3.1 (#1060) and undici -> >=7.29.0 <8 (#1061).
}

/**
 * A successful `npm audit --json` always carries BOTH a `metadata` block and a
 * `vulnerabilities` map. A registry/network failure emits `{error|message,...}`
 * with neither — so anything missing that shape is unusable, not clean. This is
 * the load-bearing fail-closed check: treating a failed audit as "no vulns"
 * would turn the gate green while auditing nothing.
 */
export function isUsableReport(report) {
    return !!report && !report.error && !!report.metadata && typeof report.vulnerabilities === "object"
}

/** Pull every distinct GHSA advisory (with metadata) at high/critical severity.
 *  Advisory OBJECTS live on the package an advisory targets; downstream packages
 *  back-reference by STRING (e.g. react-router-dom via:["react-router"]). We
 *  collect objects across all packages, so every advisory is counted exactly
 *  once and a string-only back-reference can't hide a real high/critical. */
export function collectHighAdvisories(report) {
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

/** Split the high/critical advisories into acknowledged (allowlisted) vs blocking. */
export function classify(report, allowlist = ALLOWLIST) {
    const acknowledged = []
    const blocking = []
    for (const [ghsa, info] of collectHighAdvisories(report)) {
        ;(allowlist[ghsa] ? acknowledged : blocking).push([ghsa, info])
    }
    return { acknowledged, blocking }
}

function failClosed(msg, detail) {
    console.error(`audit-ci: ${msg} — failing closed.`)
    if (detail) console.error(String(detail).slice(0, 800))
    process.exit(1)
}

/**
 * Which tree to audit. `--include-dev` drops `--omit=dev`, so the report covers
 * devDependencies too.
 */
export function auditArgs(includeDev) {
    const args = ["audit", "--json", "--audit-level=high"]
    if (!includeDev) args.push("--omit=dev")
    return args
}

function readAudit(includeDev) {
    // npm audit exits non-zero both when advisories are found (JSON on stdout,
    // the normal case) AND when it errors. Capture stderr too so the diagnostic
    // isn't swallowed.
    let raw = ""
    let stderr = ""
    try {
        raw = execFileSync(
            "npm",
            auditArgs(includeDev),
            { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
        )
    } catch (err) {
        raw = typeof err?.stdout === "string" ? err.stdout : ""
        stderr = typeof err?.stderr === "string" ? err.stderr : ""
        if (!raw.trim()) failClosed("`npm audit --json` produced no output", stderr || err?.message)
    }

    let report
    try {
        report = JSON.parse(raw)
    } catch {
        failClosed("could not parse `npm audit --json` output", stderr || raw)
    }

    if (!isUsableReport(report)) {
        failClosed(
            "npm audit did not return a vulnerabilities report (error or unknown shape)",
            JSON.stringify(report?.error ?? report?.message ?? report) + (stderr ? `\n${stderr}` : ""),
        )
    }
    return report
}

function main() {
    const includeDev = process.argv.includes("--include-dev")
    const lane = includeDev ? "dev+prod" : "prod"
    const allowlist = includeDev ? DEV_ALLOWLIST : ALLOWLIST
    const { acknowledged, blocking } = classify(readAudit(includeDev), allowlist)

    if (acknowledged.length) {
        console.log(`audit-ci [${lane}]: ${acknowledged.length} acknowledged (allowlisted) high/critical advisory(ies):`)
        for (const [ghsa, info] of acknowledged) {
            const a = allowlist[ghsa]
            console.log(`  • ${ghsa} [${info.severity}] ${a.package} — ${info.title}`)
            console.log(`      justification (${a.added}): ${a.reason}`)
        }
    }

    if (blocking.length) {
        console.error(`\naudit-ci [${lane}]: ${blocking.length} BLOCKING high/critical advisory(ies) with no allowlist entry:`)
        for (const [ghsa, info] of blocking) {
            console.error(`  ✗ ${ghsa} [${info.severity}] ${info.title}`)
            console.error(`      ${info.url}`)
        }
        console.error("\nFix the dependency (raise the floor to the patched version), or — only if it")
        console.error(`genuinely cannot apply — add a justified entry to ${includeDev ? "DEV_ALLOWLIST" : "ALLOWLIST"}`)
        console.error("in frontend/scripts/audit-ci.mjs. Do NOT move a package between dependencies")
        console.error("and devDependencies to silence this; that hides the advisory, it does not fix it.")
        process.exit(1)
    }

    console.log(`\naudit-ci [${lane}]: no un-allowlisted high/critical advisories. OK.`)
    process.exit(0)
}

// Run the audit only when executed directly (`node scripts/audit-ci.mjs`), not
// when imported by the unit test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main()
}
