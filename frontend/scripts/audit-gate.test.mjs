#!/usr/bin/env node
/**
 * Self-test for audit-gate.mjs. Plain node, no framework — run:
 *   node scripts/audit-gate.test.mjs
 *
 * Each case feeds the gate a fixture `npm audit --json` document via --input
 * and a fixture allowlist via --allowlist, then asserts on exit code + output.
 * Exit-code contract under test:
 *   0 = no non-allowlisted high/critical advisories (and no stale entries)
 *   1 = findings (non-allowlisted high/critical, or a stale allowlist entry)
 *   2 = the audit tool itself could not run (registry error, bad JSON) —
 *       distinct from findings so a red is never misread (the G-7 lesson).
 */
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const GATE = join(HERE, "audit-gate.mjs")
const SHIPPED_ALLOWLIST = join(HERE, "audit-allowlist.json")
const TMP = mkdtempSync(join(tmpdir(), "audit-gate-test-"))

let failures = 0
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}\n    ${detail}`)
  }
}

function writeJson(name, obj) {
  const p = join(TMP, name)
  writeFileSync(p, JSON.stringify(obj, null, 2))
  return p
}

function runGate(inputPath, allowlistPath) {
  return spawnSync(process.execPath, [GATE, "--input", inputPath, "--allowlist", allowlistPath], {
    encoding: "utf8",
  })
}

// ---- fixtures --------------------------------------------------------------

// Shape mirrors real `npm audit --json` (auditReportVersion 2). `via` entries
// are advisory OBJECTS on the root vulnerable package and plain STRINGS on
// packages that are only vulnerable through their dependency on it.
const advisory = (id, severity, name, title) => ({
  source: 1234567,
  name,
  dependency: name,
  title,
  url: `https://github.com/advisories/${id}`,
  severity,
  cwe: [],
  cvss: { score: 8.1, vectorString: null },
  range: "*",
})

const AUDIT_CLEAN = {
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
}

// One high advisory on react-router, plus react-router-dom flagged only
// via-string (derived) — the gate must treat the derived entry as covered
// when the root advisory is allowlisted.
const AUDIT_RR_HIGH = {
  auditReportVersion: 2,
  vulnerabilities: {
    "react-router": {
      name: "react-router",
      severity: "high",
      isDirect: false,
      via: [advisory("GHSA-qwww-vcr4-c8h2", "high", "react-router", "RSC Mode CSRF Bypass")],
      effects: ["react-router-dom"],
      range: ">=7.12.0-pre.0",
      nodes: ["node_modules/react-router"],
      fixAvailable: { name: "react-router-dom", version: "7.11.0", isSemVerMajor: true },
    },
    "react-router-dom": {
      name: "react-router-dom",
      severity: "high",
      isDirect: true,
      via: ["react-router"],
      effects: [],
      range: ">=7.12.0",
      nodes: ["node_modules/react-router-dom"],
      fixAvailable: { name: "react-router-dom", version: "7.11.0", isSemVerMajor: true },
    },
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 } },
}

const AUDIT_CRITICAL = {
  auditReportVersion: 2,
  vulnerabilities: {
    evilpkg: {
      name: "evilpkg",
      severity: "critical",
      isDirect: false,
      via: [advisory("GHSA-xxxx-yyyy-zzzz", "critical", "evilpkg", "RCE in evilpkg")],
      effects: [],
      range: "*",
      nodes: ["node_modules/evilpkg"],
      fixAvailable: true,
    },
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 1, total: 1 } },
}

const AUDIT_LOW_ONLY = {
  auditReportVersion: 2,
  vulnerabilities: {
    dompurify: {
      name: "dompurify",
      severity: "low",
      isDirect: true,
      via: [advisory("GHSA-c2j3-45gr-mqc4", "low", "dompurify", "CUSTOM_ELEMENT_HANDLING bypass")],
      effects: [],
      range: "<3.3.1",
      nodes: ["node_modules/dompurify"],
      fixAvailable: true,
    },
  },
  metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 0, critical: 0, total: 1 } },
}

const AUDIT_TOOL_ERROR = {
  error: { code: "ENOAUDIT", summary: "Your configured registry does not support audit requests.", detail: "" },
}

const ALLOW_EMPTY = { allow: [] }
const ALLOW_RR = {
  allow: [
    {
      id: "GHSA-qwww-vcr4-c8h2",
      package: "react-router",
      severity: "high",
      reason: "test fixture",
      added: "2026-07-25",
      removeWhen: "patched react-router released",
    },
  ],
}

// ---- cases -----------------------------------------------------------------

console.log("audit-gate self-test")

{
  const r = runGate(writeJson("clean.json", AUDIT_CLEAN), writeJson("allow-empty.json", ALLOW_EMPTY))
  check("clean audit, empty allowlist → exit 0", r.status === 0, `status=${r.status} stderr=${r.stderr}`)
}

{
  const r = runGate(writeJson("rr.json", AUDIT_RR_HIGH), writeJson("allow-empty2.json", ALLOW_EMPTY))
  check("high advisory, not allowlisted → exit 1", r.status === 1, `status=${r.status}`)
  check(
    "…and the failure names the GHSA id",
    (r.stdout + r.stderr).includes("GHSA-qwww-vcr4-c8h2"),
    `output=${r.stdout}${r.stderr}`
  )
}

{
  const r = runGate(writeJson("rr2.json", AUDIT_RR_HIGH), writeJson("allow-rr.json", ALLOW_RR))
  check("high advisory, allowlisted (incl. via-string derived pkg) → exit 0", r.status === 0, `status=${r.status} stderr=${r.stderr}`)
  check(
    "…and the waiver is printed loudly",
    (r.stdout + r.stderr).includes("GHSA-qwww-vcr4-c8h2"),
    `output=${r.stdout}${r.stderr}`
  )
}

{
  const r = runGate(writeJson("crit.json", AUDIT_CRITICAL), writeJson("allow-rr2.json", ALLOW_RR))
  check("critical advisory, not allowlisted → exit 1", r.status === 1, `status=${r.status}`)
  check(
    "…and the stale react-router entry is ALSO reported (matches nothing here)",
    (r.stdout + r.stderr).toLowerCase().includes("stale"),
    `output=${r.stdout}${r.stderr}`
  )
}

{
  const r = runGate(writeJson("low.json", AUDIT_LOW_ONLY), writeJson("allow-empty3.json", ALLOW_EMPTY))
  check("low-severity-only audit → exit 0 (gate level is high, like --audit-level=high)", r.status === 0, `status=${r.status} stderr=${r.stderr}`)
}

{
  // Stale entry alone must fail: this is the removal reminder once the advisory
  // disappears (e.g. react-router patched and bumped).
  const r = runGate(writeJson("clean2.json", AUDIT_CLEAN), writeJson("allow-stale.json", ALLOW_RR))
  check("stale allowlist entry on a clean audit → exit 1", r.status === 1, `status=${r.status}`)
  check(
    "…and says which entry to remove",
    (r.stdout + r.stderr).includes("GHSA-qwww-vcr4-c8h2"),
    `output=${r.stdout}${r.stderr}`
  )
}

{
  const r = runGate(writeJson("err.json", AUDIT_TOOL_ERROR), writeJson("allow-empty4.json", ALLOW_EMPTY))
  check("audit tool failure → exit 2 (distinct from findings)", r.status === 2, `status=${r.status}`)
}

{
  // Malformed JSON is a tool failure, not a finding.
  const p = join(TMP, "garbage.json")
  writeFileSync(p, "not json {")
  const r = runGate(p, writeJson("allow-empty5.json", ALLOW_EMPTY))
  check("unparseable audit output → exit 2", r.status === 2, `status=${r.status}`)
}

{
  // The SHIPPED allowlist must parse and every entry must carry the fields the
  // next engineer needs to judge and eventually remove it.
  let ok = true
  let detail = ""
  try {
    const shipped = JSON.parse(readFileSync(SHIPPED_ALLOWLIST, "utf8"))
    for (const e of shipped.allow) {
      for (const field of ["id", "package", "severity", "reason", "added", "removeWhen"]) {
        if (!e[field] || typeof e[field] !== "string") {
          ok = false
          detail = `entry ${e.id ?? "?"} missing/invalid field "${field}"`
        }
      }
      if (!/^GHSA(-[a-z0-9]{4}){3}$/.test(e.id)) {
        ok = false
        detail = `entry id "${e.id}" is not a GHSA id`
      }
    }
  } catch (err) {
    ok = false
    detail = String(err)
  }
  check("shipped audit-allowlist.json parses and entries are fully documented", ok, detail)
}

if (failures > 0) {
  console.error(`\n❌ audit-gate self-test: ${failures} case(s) failed`)
  process.exit(1)
}
console.log("\n✅ audit-gate self-test: all cases passed")
