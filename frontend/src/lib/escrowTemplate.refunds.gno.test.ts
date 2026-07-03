/**
 * W1.6 refund-parity proof — runs the GENERATED escrow realm under the real
 * gno test machine with REAL coin flows (testing.SetOriginSend +
 * testing.IssueCoins + balance assertions) and proves the deployed-escrow_v2
 * refund model:
 *   - ResolveDispute(refundClient=true) refunds the client EXACTLY ONCE and
 *     leaves the milestone TERMINAL (MsRefunded)
 *   - a subsequent CancelContract pays NOTHING for that milestone — the old
 *     template swept `MsPending && FundedAt > 0` and refunded it a second
 *     time (the R2-CHN-A double-refund / realm-insolvency bug)
 *   - CancelContract pays a NEWLY-cancelled funded milestone once (client
 *     refund minus cancellation fee, fee to the freelancer), and pays a
 *     completed-but-unreleased milestone to the freelancer minus platform fee
 *   - dispute FREEZE: while the contract is StatusDisputed,
 *     CompleteMilestone/ReleaseFunds abort (even for other, non-disputed
 *     milestones) and move no coins; ResolveDispute lifts the freeze
 *
 * Requires `gno` on PATH (REQUIRE_GNO=1 in CI forbids the skip). Hermetic:
 * gno.land/p/* deps vendored from GNOROOT/examples, GNOHOME isolated.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateEscrowCode } from "./escrowTemplate"

const REQUIRE_GNO = process.env.REQUIRE_GNO === "1"

const ADMIN = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FEE_RECIPIENT = "g15unfxh9zfm75puw2lqmsun2lv8c397e0efkp2u"
const CLIENT = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"

const REALM_PATH = "gno.land/r/samcrew/gate_escrow_ref"

// 2% platform fee / 5% cancellation fee — same knobs as the deployed realm.
const ESCROW_CODE = generateEscrowCode({
    realmPath: REALM_PATH,
    adminAddress: ADMIN,
    platformFeePercent: 2,
    cancellationFeePercent: 5,
    autoRefundBlocks: 864000,
    feeRecipient: FEE_RECIPIENT,
})

/** White-box _test.gno (same package: reads contract state directly). */
const REFUNDS_TEST_GNO = `package gate_escrow_ref

import (
\t"chain"
\t"chain/banker"
\t"testing"
)

var (
\tadmin      = testing.NewUserRealm(address("${ADMIN}"))
\tclient     = testing.NewUserRealm(address("${CLIENT}"))
\tfreelancer = testing.NewUserRealm(address("${FREELANCER}"))
\trealmAddr  = chain.PackageAddress("${REALM_PATH}")
)

func balanceOf(addr address) int64 {
\treturn banker.NewReadonlyBanker().GetCoins(addr).AmountOf("ugnot")
}

// mustAbort asserts fn panics/aborts (revive catches crossing-call aborts).
func mustAbort(t *testing.T, what string, fn func()) {
\tt.Helper()
\tif r := revive(fn); r == nil {
\t\tt.Fatalf("expected abort (%s), got none", what)
\t}
}

func fund(cur realm, id string, idx int, amount int64) {
\ttesting.SetRealm(client)
\ttesting.SetOriginSend(chain.Coins{chain.NewCoin("ugnot", amount)})
\tFundMilestone(cross(cur), id, idx)
\ttesting.SetOriginSend(nil)
}

// The R2-CHN-A regression: dispute-refund then cancel must pay ONCE.
func TestDisputeRefundThenCancelPaysOnce(cur realm, t *testing.T) {
\t// Give the realm a balance to send from (a real chain would hold the
\t// escrowed deposits; testing.SetOriginSend does not move coins).
\ttesting.IssueCoins(realmAddr, chain.Coins{chain.NewCoin("ugnot", 100_000_000)})

\ttesting.SetRealm(client)
\tid := CreateContract(cross(cur), freelancer.Address(), "site", "escrow fixture", "design:1000000,build:2000000")

\tfund(cur, id, 0, 1_000_000)

\ttesting.SetRealm(client)
\tRaiseDispute(cross(cur), id, 0)

\tbefore := balanceOf(client.Address())
\ttesting.SetRealm(admin)
\tResolveDispute(cross(cur), id, 0, true)
\tafterRefund := balanceOf(client.Address())
\tif afterRefund-before != 1_000_000 {
\t\tt.Fatalf("dispute refund: want +1000000, got %d", afterRefund-before)
\t}
\tif getContract(id).Milestones[0].Status != MsRefunded {
\t\tt.Fatalf("refunded milestone must be TERMINAL MsRefunded, got %s", getContract(id).Milestones[0].Status)
\t}

\t// Cancel: milestone 0 is already refunded, milestone 1 was never funded —
\t// the client must receive NOTHING more. (The old MsPending sweep paid
\t// milestone 0 again here.)
\ttesting.SetRealm(client)
\tCancelContract(cross(cur), id)
\tafterCancel := balanceOf(client.Address())
\tif afterCancel != afterRefund {
\t\tt.Fatalf("DOUBLE REFUND: cancel paid %d more for an already-refunded milestone", afterCancel-afterRefund)
\t}
\tif getContract(id).Status != StatusCancelled {
\t\tt.Fatalf("want cancelled contract, got %s", getContract(id).Status)
\t}
\t// Refunded milestone stays terminal through cancel.
\tif getContract(id).Milestones[0].Status != MsRefunded {
\t\tt.Fatalf("cancel must not touch a refunded milestone, got %s", getContract(id).Milestones[0].Status)
\t}
}

// Cancel pays a newly-cancelled FUNDED milestone exactly once, with the
// cancellation fee going to the freelancer; and pays a COMPLETED milestone
// to the freelancer minus the platform fee.
func TestCancelPaysNewTransitionsOnly(cur realm, t *testing.T) {
\t// Chain-state context (incl. issued balances) resets per test func —
\t// back the realm's sends again.
\ttesting.IssueCoins(realmAddr, chain.Coins{chain.NewCoin("ugnot", 100_000_000)})

\ttesting.SetRealm(client)
\tid := CreateContract(cross(cur), freelancer.Address(), "app", "escrow fixture", "spec:1000000,impl:2000000")

\tfund(cur, id, 0, 1_000_000)
\tfund(cur, id, 1, 2_000_000)

\t// Freelancer completes milestone 1 (not yet released).
\ttesting.SetRealm(freelancer)
\tCompleteMilestone(cross(cur), id, 1)

\tclientBefore := balanceOf(client.Address())
\tfreelancerBefore := balanceOf(freelancer.Address())
\tfeeBefore := balanceOf(address("${FEE_RECIPIENT}"))

\ttesting.SetRealm(client)
\tCancelContract(cross(cur), id)

\t// Funded milestone 0: client gets 1_000_000 - 5% = 950_000; freelancer
\t// gets the 50_000 cancellation fee. Completed milestone 1: freelancer
\t// gets 2_000_000 - 2% = 1_960_000; fee recipient gets 40_000.
\tif d := balanceOf(client.Address()) - clientBefore; d != 950_000 {
\t\tt.Fatalf("client cancel refund: want +950000, got %d", d)
\t}
\tif d := balanceOf(freelancer.Address()) - freelancerBefore; d != 50_000+1_960_000 {
\t\tt.Fatalf("freelancer on cancel: want +2010000 (fee 50000 + released 1960000), got %d", d)
\t}
\tif d := balanceOf(address("${FEE_RECIPIENT}")) - feeBefore; d != 40_000 {
\t\tt.Fatalf("platform fee on cancel: want +40000, got %d", d)
\t}
\tif getContract(id).Milestones[0].Status != MsRefunded {
\t\tt.Fatalf("cancelled funded milestone must end MsRefunded, got %s", getContract(id).Milestones[0].Status)
\t}
\tif getContract(id).Milestones[1].Status != MsReleased {
\t\tt.Fatalf("cancelled completed milestone must end MsReleased, got %s", getContract(id).Milestones[1].Status)
\t}

\t// A cancelled contract cannot be cancelled again (no re-sweep vector).
\ttesting.SetRealm(client)
\tmustAbort(t, "double cancel", func() {
\t\tCancelContract(cross(cur), id)
\t})
}

// Dispute FREEZE parity: while any milestone is disputed the CONTRACT is
// StatusDisputed, and CompleteMilestone/ReleaseFunds must abort — even for
// OTHER, non-disputed milestones — until ResolveDispute returns it to Active.
// Deployed escrow_v2 has this contract-level freeze; the template must too.
func TestDisputeFreezesContractActions(cur realm, t *testing.T) {
\ttesting.IssueCoins(realmAddr, chain.Coins{chain.NewCoin("ugnot", 100_000_000)})

\ttesting.SetRealm(client)
\tid := CreateContract(cross(cur), freelancer.Address(), "shop", "escrow fixture", "spec:1000000,impl:2000000,ship:3000000")

\tfund(cur, id, 0, 1_000_000)
\tfund(cur, id, 1, 2_000_000)
\tfund(cur, id, 2, 3_000_000)

\t// Milestone 2 delivered before the dispute (releasable once Active again).
\ttesting.SetRealm(freelancer)
\tCompleteMilestone(cross(cur), id, 2)

\t// Dispute milestone 0 → the whole CONTRACT flips to StatusDisputed.
\ttesting.SetRealm(client)
\tRaiseDispute(cross(cur), id, 0)
\tif getContract(id).Status != StatusDisputed {
\t\tt.Fatalf("want disputed contract, got %s", getContract(id).Status)
\t}

\tfreelancerBefore := balanceOf(freelancer.Address())

\t// FROZEN: freelancer cannot complete the untouched funded milestone 1.
\ttesting.SetRealm(freelancer)
\tmustAbort(t, "CompleteMilestone during dispute", func() {
\t\tCompleteMilestone(cross(cur), id, 1)
\t})
\tif getContract(id).Milestones[1].Status != MsFunded {
\t\tt.Fatalf("frozen complete must not touch milestone 1, got %s", getContract(id).Milestones[1].Status)
\t}

\t// FROZEN: client cannot release the already-completed milestone 2.
\ttesting.SetRealm(client)
\tmustAbort(t, "ReleaseFunds during dispute", func() {
\t\tReleaseFunds(cross(cur), id, 2)
\t})
\tif d := balanceOf(freelancer.Address()) - freelancerBefore; d != 0 {
\t\tt.Fatalf("frozen release must move NO coins, freelancer got %d", d)
\t}
\tif getContract(id).Milestones[2].Status != MsCompleted {
\t\tt.Fatalf("frozen release must not touch milestone 2, got %s", getContract(id).Milestones[2].Status)
\t}

\t// ResolveDispute returns the contract to Active — the freeze lifts.
\ttesting.SetRealm(admin)
\tResolveDispute(cross(cur), id, 0, true)
\tif getContract(id).Status != StatusActive {
\t\tt.Fatalf("want active contract after resolve, got %s", getContract(id).Status)
\t}

\ttesting.SetRealm(freelancer)
\tCompleteMilestone(cross(cur), id, 1)
\tif getContract(id).Milestones[1].Status != MsCompleted {
\t\tt.Fatalf("complete after resolve must succeed, got %s", getContract(id).Milestones[1].Status)
\t}

\ttesting.SetRealm(client)
\tReleaseFunds(cross(cur), id, 2)
\tif d := balanceOf(freelancer.Address()) - freelancerBefore; d != 2_940_000 {
\t\tt.Fatalf("release after resolve: want freelancer +2940000 (3000000 minus 2%% fee), got %d", d)
\t}
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

function gnoRoot(): string | null {
    try {
        const out = execFileSync("gno", ["env", "GNOROOT"], { encoding: "utf8" }).trim()
        return out !== "" ? out : null
    } catch {
        return null
    }
}

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

const GNO_AVAILABLE = hasGno()

it("gno toolchain is present when the gate is required (REQUIRE_GNO=1)", () => {
    if (REQUIRE_GNO) {
        expect(GNO_AVAILABLE, "REQUIRE_GNO=1 but `gno` is not on PATH — the refund proof cannot run").toBe(true)
    }
})

const describeGno = GNO_AVAILABLE ? describe : describe.skip

if (!GNO_AVAILABLE && !REQUIRE_GNO) {
    console.warn("[escrow.refunds] SKIPPED — `gno` not on PATH. The authoritative run is CI's `Gno Test & Lint` job.")
}

describeGno("generated escrow realm proves W1.6 refund parity under `gno test`", () => {
    let workdir: string

    beforeAll(() => {
        workdir = mkdtempSync(join(tmpdir(), "memba-esc-"))
    })

    it("refunds are terminal; cancel pays newly-transitioned milestones only", () => {
        const pkgDir = join(workdir, "gate_escrow_ref")
        mkdirSync(pkgDir, { recursive: true })
        writeFileSync(join(pkgDir, "gate_escrow_ref.gno"), ESCROW_CODE)
        writeFileSync(join(pkgDir, "gate_escrow_ref_test.gno"), REFUNDS_TEST_GNO)
        writeFileSync(join(pkgDir, "gnomod.toml"), `module = "${REALM_PATH}"\ngno = "0.9"\n`)
        writeFileSync(join(workdir, "gnowork.toml"), "")
        vendorGnolandDeps(workdir, [ESCROW_CODE, REFUNDS_TEST_GNO])
        const gnohome = join(workdir, ".gnohome")
        mkdirSync(gnohome, { recursive: true })

        const res = spawnSync("gno", ["test", "-v", "./gate_escrow_ref"], {
            cwd: workdir,
            encoding: "utf8",
            env: { ...process.env, GNOHOME: gnohome },
        })
        const out = `${res.stdout ?? ""}${res.stderr ?? ""}`
        expect(res.status, `gno test failed:\n${out}`).toBe(0)
        for (const name of [
            "TestDisputeRefundThenCancelPaysOnce",
            "TestCancelPaysNewTransitionsOnly",
            "TestDisputeFreezesContractActions",
        ]) {
            expect(out, `expected an explicit PASS for ${name}`).toContain(`--- PASS: ${name}`)
        }
    }, 180_000)

    it("cleanup", () => {
        rmSync(workdir, { recursive: true, force: true })
    })
})
