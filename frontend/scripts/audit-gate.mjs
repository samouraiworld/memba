#!/usr/bin/env node
/**
 * npm-audit CI gate with a scoped, documented allowlist (BACKLOG G-8).
 *
 * Replaces the bare `npm audit --audit-level=high --omit=dev` step, which reds
 * the whole repo the moment ANY high advisory is published upstream — even one
 * whose vulnerable code path this app cannot reach (e.g. GHSA-qwww-vcr4-c8h2,
 * react-router RSC-mode CSRF: this app is a Vite SPA and never enables RSC
 * mode, and the only npm-suggested fix is a breaking downgrade).
 *
 * Semantics:
 *   - Runs `npm audit --omit=dev --json` (or reads --input for tests).
 *   - Advisories with severity high/critical FAIL the gate unless their GHSA id
 *     is in scripts/audit-allowlist.json. Waived advisories are printed loudly.
 *   - Packages flagged only via-string (vulnerable through a dependency) carry
 *     no advisory of their own and are covered by the root advisory's verdict.
 *   - A STALE allowlist entry (its advisory is no longer reported) FAILS the
 *     gate: the moment the upstream fix lands and the dep is bumped, CI itself
 *     demands the entry's removal. Waivers cannot quietly outlive their reason.
 *   - `npm audit` failing to RUN (registry error, bad JSON) exits 2, distinct
 *     from findings — a red must never be misread as the other kind (G-7).
 *
 * Every allowlist entry must carry: id, package, severity, reason, added,
 * removeWhen (enforced by audit-gate.test.mjs).
 */
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const GATE_SEVERITIES = new Set(["high", "critical"])

function toolFailure(msg) {
  console.error(`\n❌ audit gate: could not run the audit — this is a TOOL failure, not a vulnerability finding.\n   ${msg}\n`)
  process.exit(2)
}

function args() {
  const out = { input: null, allowlist: join(HERE, "audit-allowlist.json") }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") out.input = argv[++i]
    else if (argv[i] === "--allowlist") out.allowlist = argv[++i]
    else toolFailure(`unknown argument "${argv[i]}"`)
  }
  return out
}

const { input, allowlist: allowlistPath } = args()

// ---- load audit report -----------------------------------------------------

let raw
if (input) {
  try {
    raw = readFileSync(input, "utf8")
  } catch (err) {
    toolFailure(`cannot read --input ${input}: ${err.message}`)
  }
} else {
  // npm exits 1 when it finds vulnerabilities, so the exit code alone means
  // nothing here — the JSON body is the source of truth.
  const r = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: join(HERE, ".."),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.error) toolFailure(`npm audit did not start: ${r.error.message}`)
  raw = r.stdout
}

let report
try {
  report = JSON.parse(raw)
} catch {
  toolFailure(`audit output is not valid JSON (first 200 chars): ${String(raw).slice(0, 200)}`)
}
if (report.error) {
  toolFailure(`npm audit reported an error: ${report.error.code ?? ""} ${report.error.summary ?? ""}`)
}
if (typeof report.vulnerabilities !== "object" || report.vulnerabilities === null) {
  toolFailure(`audit output has no "vulnerabilities" object — unexpected shape`)
}

// ---- load allowlist --------------------------------------------------------

let allow
try {
  allow = JSON.parse(readFileSync(allowlistPath, "utf8")).allow
  if (!Array.isArray(allow)) throw new Error(`"allow" is not an array`)
} catch (err) {
  toolFailure(`cannot load allowlist ${allowlistPath}: ${err.message}`)
}
const allowById = new Map(allow.map((e) => [e.id, e]))

// ---- collect advisories ----------------------------------------------------

// `via` entries are advisory objects on the root vulnerable package and plain
// strings on packages only affected through a dependency; only objects are
// advisories. Dedupe by GHSA id (one advisory can appear under several nodes).
const ghsaFromUrl = (url) => {
  const m = /GHSA(?:-[a-z0-9]{4}){3}/.exec(url ?? "")
  return m ? m[0] : null
}

const advisories = new Map() // id → {id, severity, package, title, url}
for (const [pkg, vuln] of Object.entries(report.vulnerabilities)) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== "object" || via === null) continue
    const id = ghsaFromUrl(via.url) ?? `source:${via.source}`
    const prev = advisories.get(id)
    if (!prev) {
      advisories.set(id, { id, severity: via.severity, package: via.name ?? pkg, title: via.title ?? "", url: via.url ?? "" })
    }
  }
}

// ---- verdicts --------------------------------------------------------------

const gated = [...advisories.values()].filter((a) => GATE_SEVERITIES.has(a.severity))
const blocking = gated.filter((a) => !allowById.has(a.id))
const waived = gated.filter((a) => allowById.has(a.id))
const stale = allow.filter((e) => !advisories.has(e.id))
const informational = [...advisories.values()].filter((a) => !GATE_SEVERITIES.has(a.severity))

for (const a of waived) {
  const e = allowById.get(a.id)
  console.log(`⚠️  WAIVED ${a.severity.toUpperCase()} ${a.id} (${a.package}) — ${a.title}`)
  console.log(`   reason:     ${e.reason}`)
  console.log(`   remove when: ${e.removeWhen}`)
}
for (const a of informational) {
  console.log(`ℹ️  below gate level: ${a.severity} ${a.id} (${a.package}) — ${a.title}`)
}

let failed = false
if (blocking.length > 0) {
  failed = true
  console.error(`\n❌ audit gate: ${blocking.length} non-allowlisted high/critical advisory(ies):`)
  for (const a of blocking) {
    console.error(`   ${a.severity.toUpperCase()} ${a.id} (${a.package}) — ${a.title}\n      ${a.url}`)
  }
  console.error(`   Fix the dependency, or — only if the vulnerable path is truly unreachable —`)
  console.error(`   add a fully-documented entry to scripts/audit-allowlist.json.`)
}
if (stale.length > 0) {
  failed = true
  console.error(`\n❌ audit gate: ${stale.length} STALE allowlist entry(ies) — the advisory is no longer reported, so the waiver has outlived its reason. Remove:`)
  for (const e of stale) {
    console.error(`   ${e.id} (${e.package}) — added ${e.added}; removal condition was: ${e.removeWhen}`)
  }
}

if (failed) process.exit(1)
console.log(`\n✅ audit gate: no non-allowlisted high/critical advisories (${waived.length} documented waiver(s) in effect)`)
