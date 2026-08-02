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
