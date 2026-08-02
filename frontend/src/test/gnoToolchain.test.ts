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
 * Structure: `classifyProbe` is pure so the verdict logic is testable without a
 * toolchain; the lint mechanism is proven by a positive AND a negative control, so it
 * cannot rot into always-green the way the original probe did.
 */
import { describe, it, expect } from "vitest"

import { classifyProbe, hasGno, lintPackage, probeToolchain, INTERREALM_V2_PROBE, STDLIB_CONTRACT_PROBE } from "./gnoToolchain"
import { generateEscrowCode } from "../lib/escrowTemplate"
import { generateDAOCode } from "../lib/daoTemplate"

/** The two-value `val, exists := tree.Get(k)` form the probe exists to defend. */
const TWO_VALUE_GET = /\w+,\s*(?:exists|ok|found)\s*:?=\s*\w+\.Get\(/

describe("STDLIB_CONTRACT_PROBE tracks the contract the generators actually depend on", () => {
    // WHY: `probeToolchain`'s verdict is only as good as this constant. Weaken the probe
    // source — drop the avl usage, say — and the integration test below still passes
    // while the probe has gone blind. These assertions tie it to reality in both
    // directions: the generators must still emit two-value `Get`, and the probe must
    // still exercise it. If the templates ever migrate to gnolang/gno#5314's one-value
    // form, this goes red and points at the probe that needs updating with them.
    it("the probe exercises two-value avl.Tree.Get", () => {
        expect(
            TWO_VALUE_GET.test(STDLIB_CONTRACT_PROBE),
            "STDLIB_CONTRACT_PROBE no longer uses two-value `Get` — it can no longer detect the drift it exists to catch",
        ).toBe(true)
    })

    it("the generators still emit two-value avl.Tree.Get, so that contract is still worth probing", () => {
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
                TWO_VALUE_GET.test(code),
                `${name} no longer emits two-value \`Get\` — if the generators migrated to the one-value ` +
                    `API, STDLIB_CONTRACT_PROBE must migrate with them or it asserts a contract nothing depends on`,
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
        const res = lintPackage("gate_probe_v2", INTERREALM_V2_PROBE)
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
        const contractHolds = lintPackage("gate_probe_contract", STDLIB_CONTRACT_PROBE).ok
        const v = probeToolchain()
        // The verdict must agree with the mechanism it is built on — a probe that
        // reported OK while the contract fails is exactly the bug this guards.
        expect(v.ok).toBe(contractHolds)
        if (!contractHolds) expect(v.reason).toBe("stdlib-drift")
    }, 240_000)
})
