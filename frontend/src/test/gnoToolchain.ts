/**
 * Shared gno toolchain helpers + the two-direction toolchain probe (A3.3′).
 *
 * The five gno gate specs (`templates.compile.test.ts` and the four `*.gno.test.ts`
 * proofs) each used to carry their own copy of `hasGno` / `gnoRoot` /
 * `vendorGnolandDeps`. Five copies meant the probe below would have had to be written
 * five times, and drift between copies is exactly how a gate rots.
 *
 * WHAT THE PROBE IS FOR
 * ---------------------
 * The gate's original probe asked one question: "is this gno new enough to understand
 * interrealm-v2?" (`chain/runtime/unsafe`). It could not see the opposite failure —
 * a GNOROOT that has drifted NEWER than the pinned toolchain the templates target.
 *
 * That blind spot is not hypothetical. CI installs `gno@$GNO_PIN` and resolves GNOROOT
 * to that binary's own module cache (see `.github/workflows/gno-test.yml`), but a
 * developer machine usually has `GNOROOT` pointing at a live gno checkout. When that
 * checkout moved past gnolang/gno#5314 — which changed `avl.Tree.Get` from
 * `(value any, exists bool)` to a single `any` — all five specs went red with type
 * errors inside generated realm code. They read like template bugs. They are not:
 * against the pin the same five specs are 17/17 green. A session handoff recorded them
 * as "5 permanent baseline failures caused by a stale gno pin" and proposed bumping the
 * pin to clear them, which would instead have made them real in CI.
 *
 * So: probe BOTH directions and name which one failed. Too old → fix the toolchain.
 * Too new → your GNOROOT disagrees with GNO_PIN; that is a local environment fact, not
 * a template defect, and bumping the pin is a breaking migration (18 two-value `Get`
 * call sites across four template generators, all of which emit realm code that gets
 * deployed on-chain).
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** CI's "Gno Test & Lint" job sets this; it forbids every skip path. */
export const REQUIRE_GNO = process.env.REQUIRE_GNO === "1"

/** Any gno-reported error line. */
export const ERROR_LINE = /code=gno\w*Error/

/**
 * Known-good interrealm-v2 package. If THIS cannot lint, the toolchain predates the
 * interrealm-v2 stdlib layout and no template verdict is valid.
 */
export const INTERREALM_V2_PROBE = `package gate_probe

import "chain/runtime/unsafe"

func Caller(cur realm) address {
\treturn unsafe.PreviousRealm().Address()
}
`

/**
 * The stdlib CONTRACT the templates depend on, reduced to its smallest form.
 *
 * Every template generator (`daoTemplate`, `channelTemplate`, `agentTemplate`,
 * `escrowTemplate`) reads an avl tree with the two-value form `val, exists := t.Get(k)`.
 * gnolang/gno#5314 reduced `Get` to a single return value. If that change is present in
 * this GNOROOT, this package stops type-checking — and so does every generated realm.
 *
 * Keep this probe in lockstep with what the generators actually emit: if a template
 * stops using two-value `Get`, this probe must change with it, or it starts asserting
 * a contract nothing depends on.
 */
export const STDLIB_CONTRACT_PROBE = `package gate_probe_contract

import "gno.land/p/nt/avl/v0"

var contracts = avl.NewTree()

func Probe(id string) bool {
\t_, exists := contracts.Get(id)
\treturn exists
}
`

export function hasGno(): boolean {
    try {
        execFileSync("gno", ["version"], { stdio: "ignore" })
        return true
    } catch {
        return false
    }
}

export function gnoRoot(): string | null {
    try {
        const out = execFileSync("gno", ["env", "GNOROOT"], { encoding: "utf8" }).trim()
        return out !== "" ? out : null
    } catch {
        return null
    }
}

/**
 * HERMETICITY: `gno.land/p/*` packages are NOT stdlibs — an unresolved import makes
 * `gno lint` fetch them from the LIVE chain (`vm/qfile` on rpc.gno.land), so a mainnet
 * outage could flip these gates. Vendor the transitive `gno.land/p/*` closure from
 * GNOROOT/examples into the workspace so the loader resolves everything locally.
 * (`gno.land/r/*` imports must resolve in-workspace already — that is the cross-realm
 * surface the compile gate exists to check.)
 */
export function vendorGnolandDeps(root: string, sources: string[]): void {
    const gr = gnoRoot()
    if (!gr) throw new Error("cannot vendor gno.land/p deps: `gno env GNOROOT` returned nothing")
    const scan = (src: string, into: Set<string>) => {
        for (const m of src.matchAll(/"(gno\.land\/p\/[^"]+)"/g)) into.add(m[1])
    }
    const pending = new Set<string>()
    sources.forEach((s) => scan(s, pending))
    const vendored = new Set<string>()
    while (pending.size > 0) {
        const pkg: string = pending.values().next().value!
        pending.delete(pkg)
        if (vendored.has(pkg)) continue
        vendored.add(pkg)
        const srcDir = join(gr, "examples", pkg)
        const dstDir = join(root, "vendored", pkg.replace(/\//g, "_"))
        mkdirSync(dstDir, { recursive: true })
        let wrote = 0
        for (const f of readdirSync(srcDir)) {
            if (!f.endsWith(".gno") || f.endsWith("_test.gno") || f.endsWith("_filetest.gno")) continue
            const body = readFileSync(join(srcDir, f), "utf8")
            writeFileSync(join(dstDir, f), body)
            scan(body, pending)
            wrote++
        }
        if (wrote === 0) throw new Error(`vendoring ${pkg}: no .gno sources found under ${srcDir}`)
        writeFileSync(join(dstDir, "gnomod.toml"), `module = "${pkg}"\ngno = "0.9"\n`)
    }
}

export function writePkg(root: string, name: string, code: string, modulePath: string): void {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${name}.gno`), code)
    writeFileSync(join(dir, "gnomod.toml"), `module = "${modulePath}"\ngno = "0.9"\n`)
}

/**
 * Run `gno lint ./...` over a gnowork.toml workspace. GNOHOME is pointed at an empty
 * per-workspace dir so a warm package modcache can't mask a missing vendored dep (which
 * would otherwise silently fetch from the live chain).
 */
export function lintWorkspace(root: string): { lines: string[]; exitOK: boolean } {
    writeFileSync(join(root, "gnowork.toml"), "")
    const gnohome = join(root, ".gnohome")
    mkdirSync(gnohome, { recursive: true })
    let out = ""
    let exitOK = true
    try {
        out = execFileSync("gno", ["lint", "./..."], {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, GNOHOME: gnohome },
        })
    } catch (e) {
        exitOK = false
        const err = e as { stdout?: string; stderr?: string }
        out = `${err.stdout ?? ""}${err.stderr ?? ""}`
    }
    return { lines: out.split("\n").filter((l) => l.trim() !== ""), exitOK }
}

/** Lint ONE self-contained package (vendoring its gno.land/p closure) in a scratch workspace. */
export function lintPackage(name: string, code: string): { ok: boolean; lines: string[] } {
    const root = mkdtempSync(join(tmpdir(), "memba-probe-"))
    writePkg(root, name, code, `gno.land/r/samcrew/${name}`)
    vendorGnolandDeps(root, [code])
    const { lines, exitOK } = lintWorkspace(root)
    return { ok: exitOK && !lines.some((l) => ERROR_LINE.test(l)), lines }
}

export type ProbeReason = "no-gno" | "pre-interrealm-v2" | "stdlib-drift"

export interface ProbeVerdict {
    ok: boolean
    reason: ProbeReason | null
    message: string
    lines: string[]
}

/**
 * Pure verdict logic — kept separate from the toolchain calls so the classification is
 * testable without a gno on PATH.
 *
 * Order matters: a toolchain too old to lint interrealm-v2 will also fail the stdlib
 * contract probe, and "your gno predates interrealm-v2" is the actionable message in
 * that case. Only once v2 is understood does a contract failure mean drift.
 */
export function classifyProbe(
    r: { gnoPresent: boolean; interrealmOK: boolean; stdlibContractOK: boolean },
    gnoRootPath: string | null = null,
    lines: string[] = [],
): ProbeVerdict {
    if (!r.gnoPresent) {
        return {
            ok: false,
            reason: "no-gno",
            message: "`gno` is not on PATH — the gate cannot run. The authoritative run is CI's `Gno Test & Lint` job.",
            lines,
        }
    }
    if (!r.interrealmOK) {
        return {
            ok: false,
            reason: "pre-interrealm-v2",
            message:
                "this gno cannot lint a known-good interrealm-v2 package — the toolchain is incoherent " +
                "(pre-v2 GNOROOT? stale binary?). Fix the toolchain; template verdicts would be meaningless.",
            lines,
        }
    }
    if (!r.stdlibContractOK) {
        return {
            ok: false,
            reason: "stdlib-drift",
            message:
                `this gno understands interrealm-v2, but its stdlib no longer provides the API the templates target ` +
                `(two-value \`avl.Tree.Get\`; see gnolang/gno#5314).\n` +
                `GNOROOT = ${gnoRootPath ?? "<unknown>"}\n` +
                `That GNOROOT has drifted from CI's GNO_PIN (.github/workflows/gno-test.yml). This is a LOCAL ` +
                `ENVIRONMENT mismatch, not a template defect: against the pin these specs pass.\n` +
                `Fix: run with GNOROOT pointed at the pinned toolchain, e.g.\n` +
                `  git -C <your gno checkout> worktree add --detach /tmp/gno-at-pin $GNO_PIN\n` +
                `  GNOROOT=/tmp/gno-at-pin npm run test -- <spec>\n` +
                `Do NOT "fix" this by bumping GNO_PIN — that is a breaking migration of every two-value ` +
                `\`Get\` call site in the template generators, which emit realm code deployed on-chain.`,
            lines,
        }
    }
    return { ok: true, reason: null, message: "toolchain coherent", lines }
}

/** Probe the toolchain in both directions. Cache-free: cheap enough, and callers run it once. */
export function probeToolchain(): ProbeVerdict {
    const gnoPresent = hasGno()
    if (!gnoPresent) return classifyProbe({ gnoPresent, interrealmOK: false, stdlibContractOK: false })

    const interrealm = lintPackage("gate_probe", INTERREALM_V2_PROBE)
    if (!interrealm.ok) {
        return classifyProbe({ gnoPresent, interrealmOK: false, stdlibContractOK: false }, gnoRoot(), interrealm.lines)
    }
    const contract = lintPackage("gate_probe_contract", STDLIB_CONTRACT_PROBE)
    return classifyProbe({ gnoPresent, interrealmOK: true, stdlibContractOK: contract.ok }, gnoRoot(), contract.lines)
}
