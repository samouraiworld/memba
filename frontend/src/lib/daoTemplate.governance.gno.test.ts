/**
 * W1.3 governance proof — runs the GENERATED DAO realm's governance logic under
 * the real gno test machine (`gno test`), not just type-checking it.
 *
 * The compile gate (templates.compile.test.ts) proves the template compiles;
 * this suite proves the W1.3 semantics actually hold on-chain:
 *   - finality is irreversible-only (impossibility REJECT, whale ACCEPT)
 *   - ExecuteProposal enforces the minExecutionDelay deliberation floor
 *   - executeAddMember validates roles + power (CHN-4)
 *
 * Requires `gno` on PATH (same toolchain contract as the compile gate —
 * REQUIRE_GNO=1 in CI's "Gno Test & Lint" job forbids the skip path).
 * Hermetic: gno.land/p/* deps are vendored from GNOROOT/examples and GNOHOME
 * is isolated, so nothing resolves from a live chain.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateDAOCode } from "./daoTemplate"

const REQUIRE_GNO = process.env.REQUIRE_GNO === "1"

// Well-formed test addresses (bech32 shape is all the generator validates).
const ALICE = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const BOB = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const CAROL = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"

// 3 members, powers 50/30/20 (total 100), threshold 60%: rich enough to prove
// both finality directions and the deliberation floor.
const DAO_CODE = generateDAOCode({
    name: "Governance Gate DAO",
    description: "W1.3 governance-proof fixture",
    realmPath: "gno.land/r/samcrew/gate_dao_gov",
    members: [
        { address: ALICE, power: 50, roles: ["admin", "member"] },
        { address: BOB, power: 30, roles: ["member"] },
        { address: CAROL, power: 20, roles: ["member"] },
    ],
    threshold: 60,
    roles: ["admin", "member"],
    quorum: 0,
    proposalCategories: ["governance", "membership"],
    votingPeriodBlocks: 151200,
    minExecutionDelayBlocks: 600,
})

/** The _test.gno proving each W1.3 property inside the gno test machine. */
const GOVERNANCE_TEST_GNO = `package gate_dao_gov

import "testing"

var (
\talice = testing.NewUserRealm(address("${ALICE}")) // power 50
\tbob   = testing.NewUserRealm(address("${BOB}"))   // power 30
\tcarol = testing.NewUserRealm(address("${CAROL}")) // power 20
)

// mustAbort asserts fn panics/aborts. Plain recover() cannot catch a panic
// from a crossed realm call — gno's revive() builtin captures the abort value.
func mustAbort(t *testing.T, what string, fn func()) {
\tt.Helper()
\tif r := revive(fn); r == nil {
\t\tt.Fatalf("expected abort (%s), got none", what)
\t}
}

// mustPanicDirect is for a NON-crossing internal call (e.g. executeAddMember):
// its panic is an ordinary same-realm panic that recover() catches; revive()
// would re-raise it.
func mustPanicDirect(t *testing.T, what string, fn func()) {
\tt.Helper()
\tdefer func() {
\t\tif r := recover(); r == nil {
\t\t\tt.Fatalf("expected panic (%s), got none", what)
\t\t}
\t}()
\tfn()
}

// CHN-5: REJECT fires exactly when passage becomes impossible — not on the old
// asymmetric NO-threshold, which would NOT have rejected this proposal
// (NO=30% is not > 40%) even though it can never pass.
func TestRejectOnImpossibility(cur realm, t *testing.T) {
\ttesting.SetRealm(alice)
\tid := Propose(cross(cur), "impossible", "d", "governance")

\ttesting.SetRealm(bob)
\tVoteOnProposal(cross(cur), id, "NO") // 30 power
\ttesting.SetRealm(carol)
\tVoteOnProposal(cross(cur), id, "ABSTAIN") // 20 power → maxPossibleYes = 50 < 60%

\tp := getProposal(id)
\tif p.Status != "REJECTED" {
\t\tt.Fatalf("want REJECTED (passage impossible: max possible YES 50%% < 60%%), got %s", p.Status)
\t}
}

// CHN-5: ACCEPT only flips when irreversible (YES >= threshold of FULL power),
// and a NO short of impossibility keeps the proposal ACTIVE.
func TestAcceptOnlyWhenIrreversible(cur realm, t *testing.T) {
\ttesting.SetRealm(alice)
\tid := Propose(cross(cur), "majority", "d", "governance")
\tVoteOnProposal(cross(cur), id, "YES") // 50 < 60 → still ACTIVE

\tif p := getProposal(id); p.Status != "ACTIVE" {
\t\tt.Fatalf("50%% YES must not decide a 60%% threshold, got %s", p.Status)
\t}

\ttesting.SetRealm(carol)
\tVoteOnProposal(cross(cur), id, "YES") // 70 >= 60 → irreversibly ACCEPTED
\tif p := getProposal(id); p.Status != "ACCEPTED" {
\t\tt.Fatalf("want ACCEPTED at 70%% YES, got %s", p.Status)
\t}
}

// W1.3 deliberation floor: an ACCEPTED proposal cannot execute until
// minExecutionDelay blocks after creation; afterwards it executes fine.
func TestExecutionDelayFloor(cur realm, t *testing.T) {
\ttesting.SetRealm(alice)
\tid := Propose(cross(cur), "delayed", "d", "governance")
\tVoteOnProposal(cross(cur), id, "YES")
\ttesting.SetRealm(bob)
\tVoteOnProposal(cross(cur), id, "YES") // 80 >= 60 → ACCEPTED

\tmustAbort(t, "execution delay", func() {
\t\tExecuteProposal(cross(cur), id)
\t})

\t// 600 blocks must elapse since creation; +1 covers the test machine's
\t// height accounting between Propose and the skip.
\ttesting.SkipHeights(601)
\tExecuteProposal(cross(cur), id)
\tif p := getProposal(id); p.Status != "EXECUTED" {
\t\tt.Fatalf("want EXECUTED after the delay, got %s", p.Status)
\t}
}

// CHN-4 (fail fast): ProposeAddMember rejects an invalid role / negative power
// at PROPOSE time, so a member never wastes a vote on an unexecutable proposal.
func TestProposeAddMemberRejectsBadInput(cur realm, t *testing.T) {
\ttarget := address("${"g1" + "z".repeat(38)}")
\ttesting.SetRealm(alice)
\tmustAbort(t, "invalid role at propose", func() {
\t\tProposeAddMember(cross(cur), target, 5, "hacker")
\t})
\tmustAbort(t, "negative power at propose", func() {
\t\tProposeAddMember(cross(cur), target, -5, "member")
\t})
}

// CHN-4 (defense in depth): executeAddMember is the authoritative guard — even
// if a proposal's ActionData is malformed, execution validates it independently.
func TestExecuteAddMemberValidatesActionData(t *testing.T) {
\tbad := "${"g1" + "z".repeat(38)}"
\tmustPanicDirect(t, "invalid role in ActionData", func() {
\t\texecuteAddMember(bad + "|5|hacker")
\t})
\tmustPanicDirect(t, "negative power in ActionData", func() {
\t\texecuteAddMember(bad + "|-5|member")
\t})
}

// CHN-4 regression guard: empty roles is a VALID shape (a plain power-holder).
// strings.Split("",",")==[""] would make assertRole("") brick an ACCEPTED
// proposal forever — prove the full path succeeds and adds a role-less member.
func TestAddMemberEmptyRolesSucceeds(cur realm, t *testing.T) {
\ttarget := address("${"g1" + "w".repeat(38)}")
\ttesting.SetRealm(alice)
\tid := ProposeAddMember(cross(cur), target, 7, "")
\tVoteOnProposal(cross(cur), id, "YES") // 50
\ttesting.SetRealm(bob)
\tVoteOnProposal(cross(cur), id, "YES") // 80 >= 60 → ACCEPTED
\ttesting.SkipHeights(601)
\tExecuteProposal(cross(cur), id)

\tv, ok := members.Get(string(target))
\tif !ok {
\t\tt.Fatal("empty-roles member was not added")
\t}
\tif m := v.(*Member); len(m.Roles) != 0 || m.Power != 7 {
\t\tt.Fatalf("want power 7 with no roles, got power %d roles %v", m.Power, m.Roles)
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

/** Vendor the transitive gno.land/p/* closure locally (hermeticity — mirrors
 *  templates.compile.test.ts; a missing dep would otherwise fetch from chain). */
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
        expect(GNO_AVAILABLE, "REQUIRE_GNO=1 but `gno` is not on PATH — the governance proof cannot run").toBe(true)
    }
})

const describeGno = GNO_AVAILABLE ? describe : describe.skip

if (!GNO_AVAILABLE && !REQUIRE_GNO) {
    console.warn("[dao.governance] SKIPPED — `gno` not on PATH. The authoritative run is CI's `Gno Test & Lint` job.")
}

describeGno("generated DAO governance proves out under `gno test` (W1.3)", () => {
    let workdir: string

    beforeAll(() => {
        workdir = mkdtempSync(join(tmpdir(), "memba-gov-"))
    })

    it(
        "impossibility reject · irreversible accept · execution delay · add-member validation",
        () => {
            const pkgDir = join(workdir, "gate_dao_gov")
            mkdirSync(pkgDir, { recursive: true })
            writeFileSync(join(pkgDir, "gate_dao_gov.gno"), DAO_CODE)
            writeFileSync(join(pkgDir, "gate_dao_gov_test.gno"), GOVERNANCE_TEST_GNO)
            writeFileSync(join(pkgDir, "gnomod.toml"), `module = "gno.land/r/samcrew/gate_dao_gov"\ngno = "0.9"\n`)
            writeFileSync(join(workdir, "gnowork.toml"), "")
            vendorGnolandDeps(workdir, [DAO_CODE, GOVERNANCE_TEST_GNO])
            const gnohome = join(workdir, ".gnohome")
            mkdirSync(gnohome, { recursive: true })

            // spawnSync: gno test writes the verbose run log to STDERR — capture
            // both streams so the PASS assertions below see them on success too.
            const res = spawnSync("gno", ["test", "-v", "./gate_dao_gov"], {
                cwd: workdir,
                encoding: "utf8",
                env: { ...process.env, GNOHOME: gnohome },
            })
            const out = `${res.stdout ?? ""}${res.stderr ?? ""}`
            expect(res.status, `gno test failed:\n${out}`).toBe(0)
            for (const name of [
                "TestRejectOnImpossibility",
                "TestAcceptOnlyWhenIrreversible",
                "TestExecutionDelayFloor",
                "TestProposeAddMemberRejectsBadInput",
                "TestExecuteAddMemberValidatesActionData",
                "TestAddMemberEmptyRolesSucceeds",
            ]) {
                expect(out, `expected an explicit PASS for ${name}`).toContain(`--- PASS: ${name}`)
            }
        },
        180_000,
    )

    it("cleanup", () => {
        rmSync(workdir, { recursive: true, force: true })
    })
})
