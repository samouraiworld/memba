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
 * Too new → GNOROOT and GNO_PIN disagree, which is usually a local environment fact
 * rather than a template defect. Note the probe observes the STDLIB, not the pin, so it
 * cannot by itself tell "your GNOROOT drifted" from "the pin was bumped"; the message
 * spells out both branches instead of asserting one.
 *
 * Either way, bumping GNO_PIN is not the cheap fix it looks like: the four generators
 * (dao, agent, escrow, channels) read avl trees with two-value `Get` throughout, and
 * they emit realm code that gets deployed ON-CHAIN. (Deliberately not quoting a call
 * count here — three independent counts of "the same" thing disagreed, because the
 * answer depends entirely on whether you count template source or generated output and
 * on which receiver/variable spellings your pattern admits. A number that looks precise
 * and isn't would just get quoted back as fact.)
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** CI's "Gno Test & Lint" job sets this; it forbids every skip path. */
export const REQUIRE_GNO = process.env.REQUIRE_GNO === "1"

const GNO_TEST_WORKFLOW = join(import.meta.dirname, "../../../.github/workflows/gno-test.yml")

/**
 * The pinned toolchain SHA, read from the workflow that declares it — the single
 * source of truth. Copying it here would create a second one, free to drift from the
 * pin it is supposed to describe.
 *
 * This is what makes the drift message actionable: `$GNO_PIN` is a *workflow*
 * variable, unset in a developer's shell, and `git worktree add --detach <path>` with
 * an empty commit-ish does NOT error — it silently defaults to HEAD. Telling someone
 * to run that would hand them a worktree at master: the exact drifted stdlib they are
 * trying to escape, and the identical failure.
 */
export function declaredGnoPin(): string | null {
    try {
        return /^\s*GNO_PIN:\s*([0-9a-f]{7,40})\b/m.exec(readFileSync(GNO_TEST_WORKFLOW, "utf8"))?.[1] ?? null
    } catch {
        return null
    }
}

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
export function lintPackage(name: string, code: string): { ok: boolean; lines: string[]; vendorMissing?: boolean } {
    const root = mkdtempSync(join(tmpdir(), "memba-probe-"))
    writePkg(root, name, code, `gno.land/r/samcrew/${name}`)
    try {
        vendorGnolandDeps(root, [code])
    } catch (e) {
        // A GNOROOT that no longer SHIPS a package the templates import is the same
        // class of problem as one that changed its signature: it cannot type-check our
        // realms. Report it as a verdict rather than letting an ENOENT escape — this
        // runs at module scope in five spec files, so an exception collapses the whole
        // file into "no tests" with a raw stack and no mention of GNO_PIN, which is the
        // misleading-local-failure experience this probe exists to remove.
        // Not hypothetical: `p/demo/avl` → `p/nt/avl/v0` has already happened once.
        //
        // Flagged distinctly, NOT folded into the drift verdict: "this GNOROOT no longer
        // ships the package" and "this GNOROOT changed the signature" have completely
        // different fixes, and drift's remediation is actively wrong here — it would tell
        // you to rebuild a worktree at a pin you may already be on, or to migrate every
        // generator to a one-value API that isn't the problem.
        return {
            ok: false,
            vendorMissing: true,
            lines: [`could not vendor a package the templates import: ${(e as Error).message}`],
        }
    }
    const { lines, exitOK } = lintWorkspace(root)
    return { ok: exitOK && !lines.some((l) => ERROR_LINE.test(l)), lines }
}

export type ProbeReason = "no-gno" | "pre-interrealm-v2" | "vendor-missing" | "stdlib-drift"

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
 * Order matters, and each step exists because the next one's message would be WRONG:
 *  1. no gno at all — nothing else can be observed.
 *  2. a package the templates import is absent from GNOROOT. Reported separately
 *     because "absent" and "changed signature" have different fixes, and drift's
 *     remediation (rebuild a worktree at the pin / migrate every generator) is actively
 *     misleading for a package that simply moved.
 *  3. too old for interrealm-v2. Such a toolchain will ALSO fail the stdlib contract
 *     probe, and "your gno predates interrealm-v2" is the actionable message there.
 *  4. only once v2 is understood does a contract failure mean drift.
 */
export function classifyProbe(
    r: { gnoPresent: boolean; interrealmOK: boolean; stdlibContractOK: boolean; vendorMissing?: boolean },
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
    if (r.vendorMissing) {
        return {
            ok: false,
            reason: "vendor-missing",
            message:
                `this GNOROOT does not ship a \`gno.land/p/*\` package the templates import, so nothing could be ` +
                `type-checked against it.\n` +
                `  GNOROOT = ${gnoRootPath ?? "<unknown>"}\n` +
                `This is NOT the drift case: the package is absent, not changed, so pointing GNOROOT at the pin ` +
                `only helps if the pin is where it still exists. Most likely the package was renamed or moved ` +
                `upstream (\`p/demo/avl\` → \`p/nt/avl/v0\` already happened once), in which case the import path ` +
                `in the probe and in the generators is what must change. The underlying error is below.`,
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
        const pin = declaredGnoPin()
        return {
            ok: false,
            reason: "stdlib-drift",
            message:
                `this gno understands interrealm-v2, but the stdlib under its GNOROOT does not provide what the ` +
                `templates target (two-value \`avl.Tree.Get\`; reduced to one value by gnolang/gno#5314).\n` +
                `  GNOROOT  = ${gnoRootPath ?? "<unknown>"}\n` +
                `  GNO_PIN  = ${pin ?? "<could not read .github/workflows/gno-test.yml>"}\n` +
                `\n` +
                `This probe observes the stdlib, not the pin, so it cannot tell these two apart — check which ` +
                `applies before acting:\n` +
                `\n` +
                `(a) Your GNOROOT has drifted from GNO_PIN. Most likely: it points at a gno checkout that has ` +
                `moved past the pin. This is a LOCAL ENVIRONMENT mismatch, not a template defect — against the ` +
                `pin these specs pass. Run against the pinned toolchain instead:\n` +
                (pin
                    ? `  git -C <your gno checkout> worktree add --detach /tmp/gno-at-pin ${pin}\n`
                    : `  git -C <your gno checkout> worktree add --detach /tmp/gno-at-pin <GNO_PIN from the workflow>\n`) +
                `  GNOROOT=/tmp/gno-at-pin npm run test -- <spec>\n` +
                `\n` +
                `(b) GNO_PIN itself was bumped past gnolang/gno#5314. Then GNOROOT is correct and the message ` +
                `above does not apply: the TEMPLATES are what must change. Every two-value \`Get\` call site ` +
                `across the four generators (dao, agent, escrow, channels) has to migrate to the one-value API, ` +
                `and this probe migrates with them. That is a breaking change to realm code that gets deployed ` +
                `ON-CHAIN, so it also needs a ruling on which avl version the target chain serves — not a ` +
                `drive-by fix.`,
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
        // `vendorMissing` is passed through: INTERREALM_V2_PROBE imports no `gno.land/p/*`
        // package today, so it is unreachable now — but if it ever gains one, "your gno
        // predates interrealm-v2" would be the wrong diagnosis for an absent package.
        return classifyProbe(
            { gnoPresent, interrealmOK: false, stdlibContractOK: false, vendorMissing: interrealm.vendorMissing },
            gnoRoot(),
            interrealm.lines,
        )
    }
    const contract = lintPackage("gate_probe_contract", STDLIB_CONTRACT_PROBE)
    return classifyProbe(
        { gnoPresent, interrealmOK: true, stdlibContractOK: contract.ok, vendorMissing: contract.vendorMissing },
        gnoRoot(),
        contract.lines,
    )
}
