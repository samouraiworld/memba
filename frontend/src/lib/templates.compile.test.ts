/**
 * Compile gate — type-checks every client-side realm template against the REAL gno
 * stdlib (the same type-checker gnodev/the validator runs), not a string snapshot.
 *
 * WHY: test13's interrealm-v2 upgrade relocated stdlib symbols
 * (`PreviousRealm`/`CurrentRealm`/`OriginSend` → `chain/runtime/unsafe`,
 * `banker.NewBanker` gained a `cur` arg). Snapshot tests string-match output and are
 * blind to that. This gate catches any generated template that won't compile on-chain —
 * the exact class of bug that bricked Create-a-DAO.
 *
 * W1.2 (authoritative gate) hardening:
 *  1. TOOLCHAIN PROBE: a known-good interrealm-v2 package must lint clean BEFORE any
 *     template is judged. A gno whose GNOROOT lacks `chain/runtime/unsafe` used to
 *     error with lines the old filter silently dropped — the gate was green while
 *     checking nothing.
 *  2. ONE WORKSPACE: all templates lint together under a gnowork.toml, so cross-realm
 *     imports (board → parent DAO `IsMember`) resolve against the REAL generated DAO.
 *     Isolation lint tried to download the parent from the chain and hid the class of
 *     bug where the DAO stops exporting a symbol the board calls (W0.3's regression).
 *  3. NEGATIVE CONTROL: a deliberately broken workspace must FAIL — guards the error
 *     filter itself against rot.
 *  4. REQUIRE_GNO=1 (set in CI's "Gno Test & Lint" job) forbids the skip path: no gno
 *     on PATH, or an incoherent toolchain, is a test FAILURE, not a silent green.
 *
 * Locally without gno the suite still skips loudly — the authoritative run is CI.
 *
 * Set EMIT_FIXTURES=<dir> to also write the generated .gno fixtures (used by the
 * deployer `make verify-client-templates` target).
 */
import { describe, it, expect, beforeAll } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateDAOCode } from "./daoTemplate"
import { generateBoardCode, defaultBoardConfig } from "./boardTemplate"
import { generateCandidatureCode } from "./candidatureTemplate"
import { generateChannelCode, defaultChannelConfig } from "./channelTemplate"
import { generateAgentRegistryCode } from "./agentTemplate"
import { generateEscrowCode } from "./escrowTemplate"

const ADDR = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const NS = "gno.land/r/samcrew"
const REQUIRE_GNO = process.env.REQUIRE_GNO === "1"

/** Each entry: a realm pkg name + the generated .gno body. */
const CASES: { name: string; code: string }[] = [
    {
        name: "gate_dao",
        code: generateDAOCode({
            name: "Gate DAO",
            description: "compile-gate fixture",
            realmPath: `${NS}/gate_dao`,
            members: [{ address: ADDR, power: 1, roles: ["admin", "member"] }],
            threshold: 50,
            roles: ["admin", "member"],
            quorum: 25,
            proposalCategories: ["governance"],
            votingPeriodBlocks: 151200,
        }),
    },
    { name: "gate_board", code: generateBoardCode(defaultBoardConfig(`${NS}/gate_dao`, "Gate DAO")) },
    { name: "gate_candidature", code: generateCandidatureCode() },
    { name: "gate_channels", code: generateChannelCode(defaultChannelConfig(`${NS}/gate_dao`, "Gate DAO")) },
    {
        name: "gate_agent",
        code: generateAgentRegistryCode({
            realmPath: `${NS}/gate_agent`,
            name: "Gate Agents",
            description: "compile-gate fixture",
            adminAddress: ADDR,
        }),
    },
    {
        name: "gate_escrow",
        code: generateEscrowCode({
            realmPath: `${NS}/gate_escrow`,
            adminAddress: ADDR,
            platformFeePercent: 2,
            cancellationFeePercent: 5,
            autoRefundBlocks: 864000,
            feeRecipient: ADDR,
        }),
    },
]

// The board/channel realms' gnomod module paths must match the import path their
// templates derive (`${daoRealmPath}_board` / `${daoRealmPath}_channels`), or the
// workspace can't resolve them locally and falls back to a chain download.
const MODULE_PATHS: Record<string, string> = {
    gate_board: `${NS}/gate_dao_board`,
    gate_channels: `${NS}/gate_dao_channels`,
}

/** Known-good interrealm-v2 probe: if THIS doesn't lint clean, the toolchain is
 *  incoherent (wrong GNOROOT / pre-v2 stdlibs) and no template verdict is valid. */
const PROBE_CODE = `package gate_probe

import "chain/runtime/unsafe"

func Caller(cur realm) address {
\treturn unsafe.PreviousRealm().Address()
}
`

function hasGno(): boolean {
    try {
        execFileSync("gno", ["version"], { stdio: "ignore" })
        return true
    } catch {
        return false
    }
}

/** Any gno-reported error line. The probe demands ZERO of these; the workspace
 *  lint additionally requires none referencing our gate_* packages. */
const ERROR_LINE = /code=gno\w*Error/

function writePkg(root: string, name: string, code: string, modulePath: string) {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${name}.gno`), code)
    writeFileSync(join(dir, "gnomod.toml"), `module = "${modulePath}"\ngno = "0.9"\n`)
}

function gnoRoot(): string | null {
    try {
        const out = execFileSync("gno", ["env", "GNOROOT"], { encoding: "utf8" }).trim()
        return out !== "" ? out : null
    } catch {
        return null
    }
}

/**
 * HERMETICITY: `gno.land/p/*` packages are NOT stdlibs — an unresolved import
 * makes `gno lint` fetch them from the LIVE chain (`vm/qfile` on rpc.gno.land),
 * so a mainnet outage could flip this gate. Vendor the transitive gno.land/p/*
 * closure from GNOROOT/examples into the workspace so the loader resolves
 * everything locally. (gno.land/r/* imports must resolve in-workspace already —
 * that's the cross-realm surface this gate exists to check.)
 */
function vendorGnolandDeps(root: string, sources: string[]): void {
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

/** Run `gno lint ./...` over a gnowork.toml workspace. GNOHOME is pointed at an
 *  empty per-workspace dir so a warm package modcache can't mask a missing
 *  vendored dep (which would otherwise silently fetch from the live chain). */
function lintWorkspace(root: string): { lines: string[]; exitOK: boolean } {
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

const GNO_AVAILABLE = hasGno()

if (!GNO_AVAILABLE && !REQUIRE_GNO) {
    console.warn(
        "[templates.compile] SKIPPED — `gno` not on PATH. The authoritative gate is CI's `Gno Test & Lint` job (REQUIRE_GNO=1).",
    )
}

// REQUIRE_GNO forbids the skip path entirely: gate absence = red build.
it("gno toolchain is present when the gate is required (REQUIRE_GNO=1)", () => {
    if (REQUIRE_GNO) {
        expect(GNO_AVAILABLE, "REQUIRE_GNO=1 but `gno` is not on PATH — the compile gate cannot run").toBe(true)
    }
})

const describeGno = GNO_AVAILABLE ? describe : describe.skip

describeGno("realm templates type-check against the gno stdlib (one workspace)", () => {
    let workdir: string
    // Set by the probe; when false every subsequent verdict would be meaningless.
    let toolchainOK = false
    const emitDir = process.env.EMIT_FIXTURES

    beforeAll(() => {
        workdir = mkdtempSync(join(tmpdir(), "memba-gate-"))
    })

    it("toolchain probe: a known-good interrealm-v2 package lints clean", (ctx) => {
        const probeRoot = join(workdir, "probe-ws")
        mkdirSync(probeRoot, { recursive: true })
        writePkg(probeRoot, "gate_probe", PROBE_CODE, `${NS}/gate_probe`)
        const { lines, exitOK } = lintWorkspace(probeRoot)
        const errors = lines.filter((l) => ERROR_LINE.test(l))
        const broken = errors.length > 0 || !exitOK
        if (broken && !REQUIRE_GNO) {
            // Local, non-authoritative run with a stale/mismatched gno: skip LOUDLY.
            // In CI (REQUIRE_GNO=1) this is a hard failure below.
            console.warn(
                `[templates.compile] SKIPPED — local gno cannot lint a known-good interrealm-v2 package ` +
                    `(pre-v2 GNOROOT? stale binary?). The authoritative gate is CI.\n${lines.join("\n")}`,
            )
            return ctx.skip()
        }
        expect(
            broken,
            `gno cannot lint a known-good interrealm-v2 package — the toolchain is incoherent ` +
                `(pre-v2 GNOROOT? stale binary?). Fix the toolchain; template verdicts would be meaningless.\n${lines.join("\n")}`,
        ).toBe(false)
        toolchainOK = true
    }, 120_000)

    it(
        "all generated templates lint clean as ONE workspace (cross-realm imports resolved)",
        (ctx) => {
            if (!toolchainOK) {
                if (REQUIRE_GNO) throw new Error("toolchain probe failed — gate cannot pass")
                return ctx.skip()
            }
            const root = join(workdir, "gate-ws")
            mkdirSync(root, { recursive: true })
            for (const c of CASES) {
                const modulePath = MODULE_PATHS[c.name] ?? `${NS}/${c.name}`
                writePkg(root, c.name, c.code, modulePath)
                if (emitDir) {
                    const fdir = join(emitDir, c.name)
                    mkdirSync(fdir, { recursive: true })
                    writeFileSync(join(fdir, `${c.name}.gno`), c.code)
                    writeFileSync(join(fdir, "gnomod.toml"), `module = "${modulePath}"\ngno = "0.9"\n`)
                }
            }

            // Vendor the transitive gno.land/p/* closure locally — the gate must
            // never depend on a live-chain fetch (hermeticity).
            vendorGnolandDeps(root, CASES.map((c) => c.code))

            // A clean workspace must have ZERO error lines AND a zero exit. A
            // non-zero exit with no parseable error line (loader crash, fetch
            // failure) must fail too — never silently pass. (The old filter only
            // matched `<name>.gno` lines and dropped loader/stdlib failures.)
            const { lines, exitOK } = lintWorkspace(root)
            const errorLines = lines.filter((l) => ERROR_LINE.test(l))
            expect(errorLines, `gno lint reported errors in the template workspace:\n${errorLines.join("\n")}`).toEqual([])
            expect(exitOK, `gno lint failed without a parseable error line (loader/fetch crash?):\n${lines.join("\n")}`).toBe(true)
        },
        120_000,
    )

    it(
        "NEGATIVE CONTROL: a DAO that stops exporting IsMember must fail the board lint",
        (ctx) => {
            if (!toolchainOK) {
                if (REQUIRE_GNO) throw new Error("toolchain probe failed — gate cannot pass")
                return ctx.skip()
            }
            const root = join(workdir, "broken-ws")
            mkdirSync(root, { recursive: true })
            const dao = CASES.find((c) => c.name === "gate_dao")!
            const board = CASES.find((c) => c.name === "gate_board")!
            // Unexport IsMember — the W0.3 regression class this workspace exists to catch.
            writePkg(root, "gate_dao", dao.code.replace(/func IsMember\(/g, "func isMemberHidden("), `${NS}/gate_dao`)
            writePkg(root, "gate_board", board.code, MODULE_PATHS.gate_board)
            vendorGnolandDeps(root, [dao.code, board.code])

            const { lines } = lintWorkspace(root)
            const caught = lines.some((l) => ERROR_LINE.test(l) && l.includes("IsMember"))
            expect(
                caught,
                `the workspace lint did NOT flag the missing cross-realm IsMember export — ` +
                    `the gate's error detection has rotted:\n${lines.join("\n")}`,
            ).toBe(true)
        },
        120_000,
    )

    it("cleanup", () => {
        rmSync(workdir, { recursive: true, force: true })
    })
})
