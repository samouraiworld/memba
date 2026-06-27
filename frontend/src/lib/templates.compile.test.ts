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
 * Requires the `gno` toolchain on PATH (present in deployer CI). If absent the suite
 * SKIPS loudly rather than giving false-green — the authoritative run is deployer-side.
 *
 * Set EMIT_FIXTURES=<dir> to also write the generated .gno fixtures (used by the
 * deployer `make verify-client-templates` target).
 */
import { describe, it, expect, beforeAll } from "vitest"
import { execFileSync, execSync } from "node:child_process"
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

function hasGno(): boolean {
    try {
        execSync("gno version", { stdio: "ignore" })
        return true
    } catch {
        return false
    }
}

const GNO_AVAILABLE = hasGno()
const describeGno = GNO_AVAILABLE ? describe : describe.skip

if (!GNO_AVAILABLE) {
    // eslint-disable-next-line no-console
    console.warn(
        "[templates.compile] SKIPPED — `gno` not on PATH. Authoritative gate runs deployer-side (make verify-client-templates).",
    )
}

describeGno("realm templates type-check against the gno stdlib", () => {
    let workdir: string
    const emitDir = process.env.EMIT_FIXTURES

    beforeAll(() => {
        workdir = mkdtempSync(join(tmpdir(), "memba-gate-"))
    })

    for (const c of CASES) {
        it(
            `${c.name} compiles clean (no gnoTypeCheckError)`,
            () => {
                const dir = join(workdir, c.name)
                mkdirSync(dir, { recursive: true })
                writeFileSync(join(dir, `${c.name}.gno`), c.code)
                writeFileSync(join(dir, "gnomod.toml"), `module = "${NS}/${c.name}"\ngno = "0.9"\n`)

                if (emitDir) {
                    const fdir = join(emitDir, c.name)
                    mkdirSync(fdir, { recursive: true })
                    writeFileSync(join(fdir, `${c.name}.gno`), c.code)
                    writeFileSync(join(fdir, "gnomod.toml"), `module = "${NS}/${c.name}"\ngno = "0.9"\n`)
                }

                let out = ""
                try {
                    out = execFileSync("gno", ["lint", "."], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
                } catch (e) {
                    const err = e as { stdout?: string; stderr?: string }
                    out = `${err.stdout ?? ""}${err.stderr ?? ""}`
                }

                // Only fail on type-check errors in the realm's OWN file (ignore unrelated
                // lint warnings from third-party deps, e.g. uassert's `cross` builtin notice).
                const ownErrors = out
                    .split("\n")
                    .filter((l) => l.includes(`${c.name}.gno`) && /TypeCheckError|undefined:|not enough arguments/.test(l))

                expect(ownErrors, `gno lint reported type errors:\n${ownErrors.join("\n")}`).toEqual([])
            },
            120_000,
        )
    }

    it("cleanup", () => {
        rmSync(workdir, { recursive: true, force: true })
    })
})
