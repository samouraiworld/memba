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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
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

/** Run `gno lint ./...` over a gnowork.toml workspace; return all output lines. */
function lintWorkspace(root: string): string[] {
    writeFileSync(join(root, "gnowork.toml"), "")
    let out = ""
    try {
        out = execFileSync("gno", ["lint", "./..."], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    } catch (e) {
        const err = e as { stdout?: string; stderr?: string }
        out = `${err.stdout ?? ""}${err.stderr ?? ""}`
    }
    return out.split("\n").filter((l) => l.trim() !== "")
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
        const errors = lintWorkspace(probeRoot).filter((l) => ERROR_LINE.test(l))
        if (errors.length > 0 && !REQUIRE_GNO) {
            // Local, non-authoritative run with a stale/mismatched gno: skip LOUDLY.
            // In CI (REQUIRE_GNO=1) this is a hard failure below.
            console.warn(
                `[templates.compile] SKIPPED — local gno cannot lint a known-good interrealm-v2 package ` +
                    `(pre-v2 GNOROOT? stale binary?). The authoritative gate is CI.\n${errors.join("\n")}`,
            )
            return ctx.skip()
        }
        expect(
            errors,
            `gno cannot lint a known-good interrealm-v2 package — the toolchain is incoherent ` +
                `(pre-v2 GNOROOT? stale binary?). Fix the toolchain; template verdicts would be meaningless.\n${errors.join("\n")}`,
        ).toEqual([])
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

            // Fail on ANY error line that references one of our packages — by module
            // path or file path. (The old filter only matched `<name>.gno` lines and
            // silently dropped loader/stdlib failures.)
            const lines = lintWorkspace(root)
            const offending = lines.filter((l) => ERROR_LINE.test(l) && CASES.some((c) => l.includes(c.name)))
            expect(offending, `gno lint reported errors in generated templates:\n${offending.join("\n")}`).toEqual([])
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

            const lines = lintWorkspace(root)
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
