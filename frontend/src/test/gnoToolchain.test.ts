/**
 * Tests for the shared gno toolchain probe (A3.3′).
 *
 * WHY THIS EXISTS: the compile gate's original probe only asked "is this gno new
 * enough to understand interrealm-v2?". It was blind to a GNOROOT that has drifted
 * NEWER than `GNO_PIN` — so a developer whose `gno env GNOROOT` points at a fresh
 * gno checkout got six type errors that read like template bugs, and a whole session's
 * handoff mis-diagnosed them as "5 permanent baseline failures caused by a stale pin".
 * They were neither permanent nor caused by the pin: at the pin the same specs are
 * 17/17 green. Upstream gnolang/gno#5314 changed `avl.Tree.Get` from
 * `(value any, exists bool)` to `any`, and every template still targets the 2-value form.
 *
 * So the probe must distinguish TWO drift directions, and say which one it found.
 *
 * Structure, and what each layer is actually worth:
 *  - `classifyProbe` is pure, so the verdict logic is testable without a toolchain.
 *  - The lint mechanism has a positive AND a negative control, so `lintPackage` cannot
 *    silently start returning green for everything.
 *  - Each probe SOURCE has a content guard. This is the layer that is easy to skip and
 *    the one that matters most: a positive control alone is satisfied by any well-formed
 *    package, so a probe gutted of the very thing it tests still passes it. Both probes
 *    are guarded, or the "cannot rot into always-green" claim above is only half true.
 */
import { describe, it, expect } from "vitest"

import {
    classifyProbe,
    hasGno,
    lintPackage,
    probeToolchain,
    REQUIRE_GNO,
    INTERREALM_V2_PROBE,
    STDLIB_CONTRACT_PROBE,
} from "./gnoToolchain"
import { generateEscrowCode } from "../lib/escrowTemplate"
import { generateDAOCode } from "../lib/daoTemplate"

/**
 * `t.Get(k)` call, allowing one level of nested parens (`Get(padID(id))`) and a
 * dotted receiver (`p.Votes.Get`). An over-tight pattern here silently
 * under-matches and weakens every guard built on it.
 */
const GET_CALL = String.raw`[\w.]+\.Get\((?:[^()]|\([^()]*\))*\)`

/**
 * The LEGACY two-value form, `val, exists := tree.Get(k)` — removed upstream by
 * gnolang/gno#5314 and no longer valid on any chain we deploy to.
 *
 * ⚠️ The trailing negative lookahead is the whole point, and its absence was a
 * real bug. The migrated code reads `v, ok := t.Get(k).(T)` — a comma-ok TYPE
 * ASSERTION on a single-value return, which is textually near-identical to the
 * two-value form it replaced. The original pattern stopped at `\.Get\(` and so
 * matched BOTH. That made these guards assert the two-value contract still held
 * while the generators had already migrated off it: they stayed green through
 * exactly the change they were written to catch, and the comment promising "if
 * the templates ever migrate ... this goes red" was not true.
 */
const LEGACY_TWO_VALUE_GET = new RegExp(String.raw`\w+,\s*\w+\s*:?=\s*${GET_CALL}(?!\s*\.\()`)

/** The MIGRATED form: comma-ok type assertion over the single-value `Get`. */
const COMMA_OK_GET = new RegExp(String.raw`\w+,\s*\w+\s*:?=\s*${GET_CALL}\.\(`)

/**
 * Content guards must read CODE, not commentary. A probe gutted of all executable code
 * but retaining the tokens inside a `//` comment satisfies a naive text guard AND lints
 * clean, so the positive control passes too and the direction goes silently green.
 */
const codeOnly = (gno: string) => gno.replace(/\/\/.*$/gm, "")

// CI (REQUIRE_GNO=1) forbids the skip path for this file too. Without this, hiding gno
// from PATH made the whole file report SUCCESS with its positive control, its negative
// control and its integration test silently skipped — green while proving nothing,
// which is the exact shape this module exists to eliminate, in the file whose only job
// is to prove the mechanism. (The job stayed red via the other five specs; this closes
// the file itself.)
it("gno toolchain is present when the mechanism proof is required (REQUIRE_GNO=1)", () => {
    if (REQUIRE_GNO) {
        expect(hasGno(), "REQUIRE_GNO=1 but `gno` is not on PATH — the probe's mechanism cannot be proven").toBe(true)
    }
})

describe("STDLIB_CONTRACT_PROBE tracks the contract the generators actually depend on", () => {
    // WHY: `probeToolchain`'s verdict is only as good as this constant. Weaken the probe
    // source — drop the avl usage, say — and the integration test below still passes
    // while the probe has gone blind. These assertions tie it to reality in both
    // directions: the generators must still emit two-value `Get`, and the probe must
    // still exercise it. If the templates ever migrate to gnolang/gno#5314's one-value
    // form, this goes red and points at the probe that needs updating with them.
    it("the probe exercises the MIGRATED single-value avl API, and not the removed one", () => {
        const code = codeOnly(STDLIB_CONTRACT_PROBE)
        expect(
            COMMA_OK_GET.test(code),
            "STDLIB_CONTRACT_PROBE no longer does a comma-ok `Get(k).(T)` — it can no longer detect drift in the value-read half",
        ).toBe(true)
        expect(
            /\.Has\(/.test(code),
            "STDLIB_CONTRACT_PROBE no longer calls `Has` — it can no longer detect drift in the existence-check half",
        ).toBe(true)
        // The direction that actually regressed once before: a revert to the
        // removed two-value form must go RED here, not pass by resembling it.
        expect(
            LEGACY_TWO_VALUE_GET.test(code),
            "STDLIB_CONTRACT_PROBE uses the two-value `Get` removed by gnolang/gno#5314 — it cannot type-check on any live chain",
        ).toBe(false)
    })

    it("the interrealm-v2 probe still references the v2 stdlib path", () => {
        // Symmetric guard, and it is NOT redundant with "the probe lints clean": an
        // INTERREALM_V2_PROBE with its import deleted lints clean too, so the positive
        // control alone passes on a probe that exercises nothing. Concretely — if
        // upstream moves `chain/runtime/unsafe` again, the cheap way to "fix" the
        // resulting red is to drop the import, which would permanently green the
        // pre-interrealm-v2 direction and restore the original W1.2 bug: a gate that
        // passes on a pre-v2 GNOROOT while checking nothing.
        expect(
            codeOnly(INTERREALM_V2_PROBE),
            "INTERREALM_V2_PROBE no longer imports the interrealm-v2 stdlib — it would lint clean on a pre-v2 toolchain",
        ).toContain('import "chain/runtime/unsafe"')
        expect(codeOnly(INTERREALM_V2_PROBE), "INTERREALM_V2_PROBE imports the v2 stdlib but never calls it").toMatch(/unsafe\.\w+\(/)
    })

    it("the generators emit the migrated avl API, so that contract is still worth probing", () => {
        const escrow = generateEscrowCode({
            realmPath: "gno.land/r/samcrew/probe_escrow",
            adminAddress: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c",
            platformFeePercent: 2,
            cancellationFeePercent: 5,
            autoRefundBlocks: 864000,
            feeRecipient: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c",
        })
        const dao = generateDAOCode({
            name: "Probe DAO",
            description: "probe fixture",
            realmPath: "gno.land/r/samcrew/probe_dao",
            members: [{ address: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c", power: 1, roles: ["admin"] }],
            threshold: 50,
            roles: ["admin"],
            quorum: 25,
            proposalCategories: ["governance"],
            votingPeriodBlocks: 151200,
        })
        for (const [name, code] of [
            ["escrowTemplate", escrow],
            ["daoTemplate", dao],
        ] as const) {
            expect(
                LEGACY_TWO_VALUE_GET.test(code),
                `${name} emits the two-value \`Get\` removed by gnolang/gno#5314 — the realm it generates ` +
                    `cannot type-check on topaz-1 or sapphire-1, so it cannot be deployed`,
            ).toBe(false)
            expect(
                COMMA_OK_GET.test(code) || /\.Has\(/.test(code),
                `${name} reads avl trees in neither migrated form (\`Has\` / comma-ok \`Get(k).(T)\`) — ` +
                    `if the read idiom changed again, STDLIB_CONTRACT_PROBE must change with it or it ` +
                    `asserts a contract nothing depends on`,
            ).toBe(true)
        }
    })
})

describe("classifyProbe (pure verdict logic)", () => {
    it("reports no-gno when the toolchain is absent, whatever the lint results say", () => {
        const v = classifyProbe({ gnoPresent: false, interrealmOK: true, stdlibContractOK: true })
        expect(v.ok).toBe(false)
        expect(v.reason).toBe("no-gno")
    })

    it("reports pre-interrealm-v2 when the toolchain is too OLD to lint v2 stdlib symbols", () => {
        const v = classifyProbe({ gnoPresent: true, interrealmOK: false, stdlibContractOK: false })
        expect(v.ok).toBe(false)
        expect(v.reason).toBe("pre-interrealm-v2")
    })

    it("reports stdlib-drift when the toolchain understands v2 but the stdlib contract no longer holds", () => {
        const v = classifyProbe({ gnoPresent: true, interrealmOK: true, stdlibContractOK: false })
        expect(v.ok).toBe(false)
        expect(v.reason).toBe("stdlib-drift")
    })

    it("reports vendor-missing — NOT stdlib-drift — when a package the templates import is absent", () => {
        // These have different fixes, so they must not share a message. Folding the
        // absent-package case into stdlib-drift produced two confident remediations
        // (rebuild a worktree at the pin you are already on; migrate every generator to
        // a one-value API that is not the problem), neither of which applied — a milder
        // repeat of the misdiagnosis this whole module exists to prevent.
        const v = classifyProbe({ gnoPresent: true, interrealmOK: true, stdlibContractOK: false, vendorMissing: true })
        expect(v.reason).toBe("vendor-missing")
        expect(v.message).not.toContain("worktree add")
        expect(v.message).not.toContain("#5314")
    })

    it("prefers vendor-missing over pre-interrealm-v2 when the package is what is absent", () => {
        // A vendoring failure makes EVERY downstream probe fail, so an absent package
        // would otherwise be reported as "your gno predates interrealm-v2".
        const v = classifyProbe({ gnoPresent: true, interrealmOK: false, stdlibContractOK: false, vendorMissing: true })
        expect(v.reason).toBe("vendor-missing")
    })

    it("passes only when the toolchain is present and BOTH probes hold", () => {
        const v = classifyProbe({ gnoPresent: true, interrealmOK: true, stdlibContractOK: true })
        expect(v.ok).toBe(true)
        expect(v.reason).toBe(null)
    })

    it("names GNOROOT and the pin in the stdlib-drift message, so the reader knows what to change", () => {
        const v = classifyProbe({ gnoPresent: true, interrealmOK: true, stdlibContractOK: false }, "/some/gno/checkout")
        expect(v.message).toContain("/some/gno/checkout")
        expect(v.message).toContain("GNO_PIN")
    })
})

const describeGno = hasGno() ? describe : describe.skip

describeGno("lintPackage (mechanism — must discriminate, not just return green)", () => {
    it("accepts a known-good interrealm-v2 package", () => {
        // Dir name MUST equal the probe's `package` declaration (gate_probe).
        // gnolang/gno#5048 makes package-name != last-path-element a hard error,
        // so the old arbitrary "gate_probe_v2" dir failed with
        // gnoPackageNameMismatchError once GNO_PIN moved past it — the positive
        // control went red for a reason that had nothing to do with interrealm-v2,
        // which also dragged the integration test below down with it. The
        // production call site (gnoToolchain.ts, probeToolchain) always used
        // "gate_probe"; only these two test call sites drifted.
        const res = lintPackage("gate_probe", INTERREALM_V2_PROBE)
        expect(res.ok, `known-good interrealm-v2 probe did not lint clean:\n${res.lines.join("\n")}`).toBe(true)
    }, 120_000)

    it("NEGATIVE CONTROL: rejects a package with a deliberate type error", () => {
        const broken = `package gate_probe_broken\n\nvar Broken int = "this is not an int"\n`
        const res = lintPackage("gate_probe_broken", broken)
        expect(res.ok, "lintPackage returned OK for code that cannot type-check — the probe has rotted into always-green").toBe(false)
    }, 120_000)
})

describeGno("probeToolchain (integration)", () => {
    it("returns a verdict that matches what the stdlib contract probe actually does under this GNOROOT", () => {
        const interrealmOK = lintPackage("gate_probe", INTERREALM_V2_PROBE).ok
        const contractHolds = lintPackage("gate_probe_contract", STDLIB_CONTRACT_PROBE).ok
        const v = probeToolchain()

        // Only meaningful once the interrealm direction passes: on a pre-v2 toolchain
        // whose avl still has two-value `Get`, `contractHolds` is true while the verdict
        // is correctly `pre-interrealm-v2` — asserting equality there would fail the
        // probe for behaving exactly as designed.
        if (!interrealmOK) {
            expect(v.ok).toBe(false)
            expect(v.reason).toBe("pre-interrealm-v2")
            return
        }
        // The verdict must agree with the mechanism it is built on — a probe that
        // reported OK while the contract fails is exactly the bug this guards.
        expect(v.ok).toBe(contractHolds)
        if (!contractHolds) expect(v.reason).toBe("stdlib-drift")
    }, 240_000)
})
