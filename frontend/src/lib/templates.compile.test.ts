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
 *  1. TOOLCHAIN PROBE (shared, TWO-DIRECTION — see `../test/gnoToolchain`): the probe
 *     must pass BEFORE any template is judged. It catches a gno too OLD to lint
 *     interrealm-v2 (a GNOROOT lacking `chain/runtime/unsafe` used to error with lines
 *     the old filter silently dropped — the gate was green while checking nothing) AND,
 *     since A3.3′, a GNOROOT that has drifted NEWER than CI's `GNO_PIN`. The second
 *     direction was a blind spot: a dev checkout past gnolang/gno#5314 (two-value
 *     `avl.Tree.Get` → one value) turned all five gno specs red with type errors inside
 *     generated realm code, which read as template bugs and got mis-recorded as a
 *     "permanent baseline". At the pin those same specs are green.
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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateDAOCode } from "./daoTemplate"
import { generateBoardCode, defaultBoardConfig } from "./boardTemplate"
import { generateCandidatureCode } from "./candidatureTemplate"
import { generateChannelCode, defaultChannelConfig } from "./channelTemplate"
import { generateAgentRegistryCode } from "./agentTemplate"
import { generateEscrowCode } from "./escrowTemplate"
import { REQUIRE_GNO, ERROR_LINE, probeToolchain, vendorGnolandDeps, writePkg, lintWorkspace } from "../test/gnoToolchain"

const ADDR = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const NS = "gno.land/r/samcrew"

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
    {
        name: "gate_channels",
        // W1.5 shape: roster seeding + the parent.IsMember cross-realm fallback
        // must both survive the type-check, so the gate config seeds a member.
        code: generateChannelCode({
            ...defaultChannelConfig(`${NS}/gate_dao`, "Gate DAO"),
            members: [{ address: ADDR, roles: ["admin", "member"] }],
        }),
    },
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

// Toolchain probe (shared, two-direction — see ../test/gnoToolchain). Runs once
// per spec file: too old to lint interrealm-v2, or drifted NEWER than GNO_PIN, and no
// template verdict below would be meaningful.
const TOOLCHAIN = probeToolchain()

if (!TOOLCHAIN.ok && !REQUIRE_GNO) {
    console.warn(
        `[templates.compile] SKIPPED — ${TOOLCHAIN.message}\n` +
            `The authoritative gate is CI's \`Gno Test & Lint\` job (REQUIRE_GNO=1).` +
            (TOOLCHAIN.lines.length > 0 ? `\n${TOOLCHAIN.lines.join("\n")}` : ""),
    )
}

// REQUIRE_GNO forbids the skip path entirely: an absent OR incoherent toolchain is a
// red build, never a silent green.
it("gno toolchain is coherent when the gate is required (REQUIRE_GNO=1)", () => {
    if (REQUIRE_GNO) {
        expect(
            TOOLCHAIN.ok,
            `REQUIRE_GNO=1 but the gno toolchain cannot run the compile gate — ${TOOLCHAIN.message}\n${TOOLCHAIN.lines.join("\n")}`,
        ).toBe(true)
    }
})

const describeGno = TOOLCHAIN.ok ? describe : describe.skip

describeGno("realm templates type-check against the gno stdlib (one workspace)", () => {
    let workdir: string
    const emitDir = process.env.EMIT_FIXTURES

    beforeAll(() => {
        workdir = mkdtempSync(join(tmpdir(), "memba-gate-"))
    })

    // NOTE: the toolchain probe itself is asserted at module level (and its mechanism —
    // that it discriminates rather than always returning green — in
    // `../test/gnoToolchain.test.ts`). It is deliberately NOT re-asserted inside this
    // block: `describeGno` only runs when the probe already passed, so an inner probe
    // test could never fail and would be pure decoration.

    it(
        "all generated templates lint clean as ONE workspace (cross-realm imports resolved)",
        () => {
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
        "NEGATIVE CONTROL: a DAO that stops exporting IsMember must fail the board AND channels lint",
        () => {
            const root = join(workdir, "broken-ws")
            mkdirSync(root, { recursive: true })
            const dao = CASES.find((c) => c.name === "gate_dao")!
            const board = CASES.find((c) => c.name === "gate_board")!
            const channels = CASES.find((c) => c.name === "gate_channels")!
            // Unexport IsMember — the W0.3 regression class this workspace exists to catch.
            // W1.5: the channels realm now carries the same cross-realm dependency,
            // so BOTH companion templates must go red, independently.
            writePkg(root, "gate_dao", dao.code.replace(/func IsMember\(/g, "func isMemberHidden("), `${NS}/gate_dao`)
            writePkg(root, "gate_board", board.code, MODULE_PATHS.gate_board)
            writePkg(root, "gate_channels", channels.code, MODULE_PATHS.gate_channels)
            vendorGnolandDeps(root, [dao.code, board.code, channels.code])

            const { lines } = lintWorkspace(root)
            const isMemberErrors = lines.filter((l) => ERROR_LINE.test(l) && l.includes("IsMember"))
            const caughtBoard = isMemberErrors.some((l) => l.includes("gate_board"))
            const caughtChannels = isMemberErrors.some((l) => l.includes("gate_channels"))
            expect(
                caughtBoard,
                `the workspace lint did NOT flag the board's missing cross-realm IsMember export — ` +
                    `the gate's error detection has rotted:\n${lines.join("\n")}`,
            ).toBe(true)
            expect(
                caughtChannels,
                `the workspace lint did NOT flag the channels realm's missing cross-realm IsMember export — ` +
                    `the W1.5 parent.IsMember fallback is not actually wired into the generated code:\n${lines.join("\n")}`,
            ).toBe(true)
        },
        120_000,
    )

    it("cleanup", () => {
        rmSync(workdir, { recursive: true, force: true })
    })
})
