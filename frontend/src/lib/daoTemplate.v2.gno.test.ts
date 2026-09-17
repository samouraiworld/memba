/**
 * Generated DAO realm, template v2 — native proof under `gno test`.
 *
 * Every rule of the v2 realm (bounded voting power, vote-only membership
 * changes, time-based voting and execution windows, validated inputs, bounded
 * paginated reads, escaped Render, events) is exercised here against the gno
 * toolchain the chain runs (CI runs this file at the gnoland-1 pin).
 *
 * The first group of packages ports earlier review scenarios as expectations
 * of the v2 behaviour. They are written through a small call dialect so the
 * same scenarios can be pointed at the previous template generation
 * (DAO_TEMPLATE_DIALECT=v1), where they are expected to fail.
 *
 * Requires `gno` on PATH (REQUIRE_GNO=1 forbids the skip). Hermetic: the
 * gno.land/p deps are vendored from GNOROOT/examples and GNOHOME is isolated.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateDAOCode } from "./daoTemplate"
import { encodeBech32 } from "./templates/dao/v2/bech32"
import { REQUIRE_GNO, probeToolchain, vendorGnolandDeps } from "../test/gnoToolchain"

// ── Fixture addresses (valid bech32 checksums) ───────────────────────

const ALICE = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const BOB = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const CAROL = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"

/** Deterministic valid address number n (n >= 1). */
function addr(n: number): string {
    const bytes = new Array(20).fill(0)
    bytes[0] = 0x4d
    bytes[18] = (n >> 8) & 0xff
    bytes[19] = n & 0xff
    return encodeBech32("g", bytes)
}
const DAVE = addr(1)
const ERIN = addr(2)
const WHALE = addr(3)

// ── Dialect: how a scenario calls the realm ──────────────────────────

interface FixtureConfig {
    name: string
    members: { address: string; power: number; roles: string[] }[]
    threshold: number
    quorum: number
    roles: string[]
    categories: string[]
    votingPeriodSeconds: number
    executionDelaySeconds: number
    executionWindowSeconds: number
}

interface Dialect {
    id: "v1" | "v2"
    generate(pkg: string, c: FixtureConfig): string
    proposeText(title: string, desc?: string, category?: string): string
    proposeAdd(addrLit: string, power: string, roles?: string): string
    proposeRemove(addrLit: string): string
    vote(id: string, choice: string): string
    execute(id: string): string
    status(id: string): string
    /** Statements attempting a change without a vote; v2 exposes no such entrypoint. */
    unilateralChanges(): string
    listPage(before: string, limit: string): string
}

const q = (s: string) => JSON.stringify(s)
const pkgPath = (pkg: string) => `gno.land/r/memba/${pkg}`

const V2: Dialect = {
    id: "v2",
    generate: (pkg, c) =>
        generateDAOCode({
            name: c.name,
            description: "native proof fixture",
            realmPath: pkgPath(pkg),
            members: c.members,
            threshold: c.threshold,
            quorum: c.quorum,
            roles: c.roles,
            proposalCategories: c.categories,
            votingPeriodSeconds: c.votingPeriodSeconds,
            executionDelaySeconds: c.executionDelaySeconds,
            executionWindowSeconds: c.executionWindowSeconds,
        } as unknown as Parameters<typeof generateDAOCode>[0]),
    proposeText: (title, desc = "d", category = "governance") => `ProposeText(cross(cur), ${q(title)}, ${q(desc)}, ${q(category)})`,
    proposeAdd: (a, power, roles = "") => `ProposeAddMember(cross(cur), "add member", "", address(${a}), ${power}, ${q(roles)})`,
    proposeRemove: (a) => `ProposeRemoveMember(cross(cur), "remove member", "", address(${a}))`,
    vote: (id, choice) => `Vote(cross(cur), ${id}, ${q(choice)})`,
    execute: (id) => `Execute(cross(cur), ${id})`,
    status: (id) => `derivedStatus(getProposal(${id}))`,
    unilateralChanges: () => "",
    listPage: (before, limit) => `GetProposalsJSON(${before}, ${limit})`,
}

const V1: Dialect = {
    id: "v1",
    generate: (pkg, c) =>
        generateDAOCode({
            name: c.name,
            description: "native proof fixture",
            realmPath: pkgPath(pkg),
            members: c.members,
            threshold: c.threshold,
            quorum: c.quorum,
            roles: c.roles.includes("admin") ? c.roles : ["admin", ...c.roles],
            proposalCategories: c.categories,
            votingPeriodBlocks: Math.ceil(c.votingPeriodSeconds / 5),
            minExecutionDelayBlocks: Math.ceil(c.executionDelaySeconds / 5),
        } as unknown as Parameters<typeof generateDAOCode>[0]),
    proposeText: (title, desc = "d", category = "governance") => `Propose(cross(cur), ${q(title)}, ${q(desc)}, ${q(category)})`,
    proposeAdd: (a, power, roles = "") => `ProposeAddMember(cross(cur), address(${a}), ${power}, ${q(roles)})`,
    proposeRemove: (a) => `ProposeRemoveMember(cross(cur), address(${a}))`,
    vote: (id, choice) => `VoteOnProposal(cross(cur), ${id}, ${q(choice)})`,
    execute: (id) => `ExecuteProposal(cross(cur), ${id})`,
    status: (id) => `proposalStatus(getProposal(${id}))`,
    unilateralChanges: () =>
        `mustAbort(t, "strip a role without a vote", func() { RemoveRole(cross(cur), address(${q(BOB)}), "admin") })\n` +
        `\tmustAbort(t, "archive without a vote", func() { Archive(cross(cur)) })`,
    listPage: () => `GetProposalsJSON()`,
}

const D: Dialect = process.env.DAO_TEMPLATE_DIALECT === "v1" ? V1 : V2

// ── Runner ───────────────────────────────────────────────────────────

const TOOLCHAIN = probeToolchain()

it("gno toolchain is coherent when the gate is required (REQUIRE_GNO=1)", () => {
    if (REQUIRE_GNO) {
        expect(TOOLCHAIN.ok, `REQUIRE_GNO=1 but the gno toolchain cannot run the v2 proof — ${TOOLCHAIN.message}\n${TOOLCHAIN.lines.join("\n")}`).toBe(true)
    }
})

const describeGno = TOOLCHAIN.ok ? describe : describe.skip
if (!TOOLCHAIN.ok && !REQUIRE_GNO) {
    console.warn(`[dao.v2] SKIPPED — ${TOOLCHAIN.message}`)
}

let workdir = ""

interface RunResult {
    status: number | null
    out: string
}

function runPackage(pkg: string, code: string, testGno: string, flags: string[] = []): RunResult {
    const dir = join(workdir, pkg)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${pkg}.gno`), code)
    writeFileSync(join(dir, `${pkg}_test.gno`), testGno)
    writeFileSync(join(dir, "gnomod.toml"), `module = "${pkgPath(pkg)}"\ngno = "0.9"\n`)
    vendorGnolandDeps(workdir, [code, testGno])
    const gnohome = join(workdir, ".gnohome")
    mkdirSync(gnohome, { recursive: true })
    const res = spawnSync("gno", ["test", "-v", ...flags, `./${pkg}`], {
        cwd: workdir,
        encoding: "utf8",
        env: { ...process.env, GNOHOME: gnohome },
        maxBuffer: 64 * 1024 * 1024,
    })
    return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

function expectPasses(res: RunResult, names: string[]) {
    expect(res.status, `gno test failed:\n${res.out.slice(-Number(process.env.GNO_OUT_TAIL ?? 6000))}`).toBe(0)
    for (const name of names) {
        expect(res.out, `expected an explicit PASS for ${name}`).toContain(`--- PASS: ${name}`)
    }
}

function testFile(pkg: string, body: string, extraImports: string[] = []): string {
    const imports = ["strings", "testing", ...extraImports].map((i) => `\t${q(i)}`).join("\n")
    return `package ${pkg}

import (
${imports}
)

var (
\talice = testing.NewUserRealm(address(${q(ALICE)}))
\tbob   = testing.NewUserRealm(address(${q(BOB)}))
\tcarol = testing.NewUserRealm(address(${q(CAROL)}))
\t_     = strings.Contains
)

func mustAbort(t *testing.T, what string, fn func()) {
\tt.Helper()
\tif r := revive(fn); r == nil {
\t\tt.Fatalf("expected abort (%s), got none", what)
\t}
}

func mustPanic(t *testing.T, what string, fn func()) {
\tt.Helper()
\tdefer func() {
\t\tif r := recover(); r == nil {
\t\t\tt.Fatalf("expected panic (%s), got none", what)
\t\t}
\t}()
\tfn()
}

// advance moves block time forward by at least the given seconds (5 s per block).
func advance(seconds int64) { testing.SkipHeights(seconds/5 + 1) }

${body}
`
}

const BASE: Omit<FixtureConfig, "name" | "members" | "threshold"> = {
    quorum: 0,
    roles: ["admin", "lead", "member"],
    categories: ["governance", "membership"],
    votingPeriodSeconds: 7200,
    executionDelaySeconds: 1800,
    executionWindowSeconds: 86400,
}

describeGno(`generated DAO realm v2 under gno test (dialect ${D.id})`, () => {
    beforeAll(() => {
        workdir = mkdtempSync(join(tmpdir(), "memba-dao-v2-"))
        writeFileSync(join(workdir, "gnowork.toml"), "")
    })
    afterAll(() => {
        if (workdir) rmSync(workdir, { recursive: true, force: true })
    })

    it("no member acts alone, and a 90 % vote removes a member labelled admin", () => {
        const pkg = "adv_admin"
        const code = D.generate(pkg, {
            ...BASE,
            name: "Admin Fixture",
            threshold: 60,
            members: [
                { address: ALICE, power: 10, roles: ["admin"] },
                { address: BOB, power: 45, roles: ["admin"] },
                { address: CAROL, power: 45, roles: ["member"] },
            ],
        })
        const body = `
func TestNoMemberActsAlone(cur realm, t *testing.T) {
\ttesting.SetRealm(alice)
\t${D.unilateralChanges()}
\tif IsArchived() { t.Fatal("archived without a vote") }
\tif !IsMember(address(${q(BOB)})) { t.Fatal("membership changed without a vote") }
}

func TestSupermajorityRemovesAdminLabelledMember(cur realm, t *testing.T) {
\ttesting.SetRealm(bob)
\tid := ${D.proposeRemove(q(ALICE))}
\t${D.vote("id", "YES")}
\ttesting.SetRealm(carol)
\t${D.vote("id", "YES")}
\tif ${D.status("id")} != "ACCEPTED" { t.Fatal("expected accepted") }
\tadvance(1805)
\t${D.execute("id")}
\tif IsMember(address(${q(ALICE)})) { t.Fatal("a 90 % vote must remove the member") }
}
`
        expectPasses(runPackage(pkg, code, testFile(pkg, body)), ["TestNoMemberActsAlone", "TestSupermajorityRemovesAdminLabelledMember"])
    }, 180_000)

    it("voting power above the bound is refused at propose time", () => {
        const pkg = "adv_ovf"
        const code = D.generate(pkg, {
            ...BASE,
            name: "Power Fixture",
            threshold: 60,
            members: [
                { address: ALICE, power: 50, roles: ["admin"] },
                { address: BOB, power: 30, roles: ["member"] },
                { address: CAROL, power: 20, roles: ["member"] },
            ],
        })
        const body = `
func TestPowerBoundAtPropose(cur realm, t *testing.T) {
\ttesting.SetRealm(alice)
\tmustAbort(t, "power 1e17", func() { ${D.proposeAdd(q(WHALE), "100000000000000000")} })
\tmustAbort(t, "power MaxInt64", func() { ${D.proposeAdd(q(WHALE), "9223372036854775807")} })
\tmustAbort(t, "power above the bound", func() { ${D.proposeAdd(q(WHALE), "1000000001")} })
\tmustAbort(t, "zero power", func() { ${D.proposeAdd(q(WHALE), "0")} })
\tmustAbort(t, "negative power", func() { ${D.proposeAdd(q(WHALE), "-1")} })
\t${D.proposeAdd(q(WHALE), "1000000000")}
}
`
        expectPasses(runPackage(pkg, code, testFile(pkg, body)), ["TestPowerBoundAtPropose"])
    }, 180_000)

    it("removing the last voting power is refused at propose and at execute", () => {
        const pkg = "adv_zero"
        const code = D.generate(pkg, {
            ...BASE,
            name: "Zero Fixture",
            threshold: 51,
            members: [
                { address: ALICE, power: 60, roles: ["admin"] },
                { address: BOB, power: 40, roles: ["member"] },
            ],
        })
        const body = `
func TestRemovalToZeroRefused(cur realm, t *testing.T) {
\ttesting.SetRealm(alice)
\tremoveBob := ${D.proposeRemove(q(BOB))}
\t${D.vote("removeBob", "YES")}
\tremoveAlice := ${D.proposeRemove(q(ALICE))}
\t${D.vote("removeAlice", "YES")}
\tadvance(1805)
\t${D.execute("removeBob")}
\tmustAbort(t, "execute removal of the last member", func() { ${D.execute("removeAlice")} })
\tif !IsMember(address(${q(ALICE)})) { t.Fatal("last member removed") }
\tmustAbort(t, "propose removal of the last member", func() { ${D.proposeRemove(q(ALICE))} })
}
`
        expectPasses(runPackage(pkg, code, testFile(pkg, body)), ["TestRemovalToZeroRefused"])
    }, 180_000)

    it("inputs are validated, Render is escaped, delay counts from acceptance and accepted proposals lapse", () => {
        const pkg = "adv_misc"
        const code = D.generate(pkg, {
            ...BASE,
            name: "Misc Fixture",
            threshold: 60,
            members: [
                { address: ALICE, power: 50, roles: ["admin"] },
                { address: BOB, power: 30, roles: ["member"] },
                { address: CAROL, power: 20, roles: ["member"] },
            ],
        })
        const body = `
func TestCodeRealmCallerIsNotMember(cur realm, t *testing.T) {
\ttesting.SetRealm(testing.NewCodeRealm("gno.land/r/other/proxy"))
\tmustAbort(t, "code realm propose", func() { ${D.proposeText("x")} })
}

func TestInvalidAddressRefused(cur realm, t *testing.T) {
\ttesting.SetRealm(alice)
\tmustAbort(t, "non-bech32 address", func() { ${D.proposeAdd(q("NOT_A_VALID_ADDRESS_AT_ALL"), "40")} })
\tmustAbort(t, "address with a separator", func() { ${D.proposeAdd(q("not-a-bech32-address|x"), "5")} })
\tmustAbort(t, "bad checksum", func() { ${D.proposeAdd(q(ALICE.slice(0, -1) + (ALICE.endsWith("c") ? "d" : "c")), "5")} })
}

func TestTitleIsOneEscapedLine(cur realm, t *testing.T) {
\ttesting.SetRealm(alice)
\tmustAbort(t, "title with newline", func() { ${D.proposeText("hi\n## Members (1)\n- fake")} })
\t${D.proposeText("hi](https://x.example) # [b]")}
\tif strings.Contains(Render(""), "](https://x.example)") { t.Fatal("title markdown is not escaped") }
}

func TestDelayCountsFromAcceptance(cur realm, t *testing.T) {
\ttesting.SetRealm(alice)
\tid := ${D.proposeText("late")}
\tadvance(3600)
\t${D.vote("id", "YES")}
\ttesting.SetRealm(bob)
\t${D.vote("id", "YES")}
\tif ${D.status("id")} != "ACCEPTED" { t.Fatal("expected accepted") }
\tmustAbort(t, "execute right after acceptance", func() { ${D.execute("id")} })
\tadvance(1800)
\t${D.execute("id")}
}

func TestAcceptedProposalLapses(cur realm, t *testing.T) {
\ttesting.SetRealm(alice)
\tid := ${D.proposeText("stale")}
\t${D.vote("id", "YES")}
\ttesting.SetRealm(bob)
\t${D.vote("id", "YES")}
\tadvance(1800 + 86400 + 60)
\tif ${D.status("id")} != "LAPSED" { t.Fatal("accepted proposal must lapse after the execution window") }
\tmustAbort(t, "execute after the window", func() { ${D.execute("id")} })
}
`
        expectPasses(runPackage(pkg, code, testFile(pkg, body)), [
            "TestCodeRealmCallerIsNotMember",
            "TestInvalidAddressRefused",
            "TestTitleIsOneEscapedLine",
            "TestDelayCountsFromAcceptance",
            "TestAcceptedProposalLapses",
        ])
    }, 180_000)

    it("a threshold of 50 % is refused by the generator and at genesis", () => {
        const pkg = "adv_tie"
        const config: FixtureConfig = {
            ...BASE,
            name: "Tie Fixture",
            threshold: 60,
            members: [
                { address: ALICE, power: 50, roles: ["admin"] },
                { address: BOB, power: 50, roles: ["member"] },
            ],
        }
        expect(() => D.generate(pkg, { ...config, threshold: 50 })).toThrow(/threshold/i)
        const patched = D.generate(pkg, config).replace(/(\bthreshold\s*=\s*)60\b/, "$150")
        expect(patched).toMatch(/\bthreshold\s*=\s*50\b/)
        const res = runPackage(pkg, patched, testFile(pkg, `func TestNothing(t *testing.T) {}`))
        expect(res.status, `genesis must refuse threshold 50:\n${res.out.slice(-3000)}`).not.toBe(0)
        expect(res.out).toMatch(/threshold/i)
    }, 180_000)

    it("51 proposals page correctly and a full list page stays far below the query gas limit", () => {
        const pkg = "adv_gas"
        const voters = [ALICE, BOB, CAROL, DAVE, ERIN, WHALE]
        const code = D.generate(pkg, {
            ...BASE,
            name: "Gas Fixture",
            threshold: 60,
            members: voters.map((a, i) => ({ address: a, power: 10, roles: i === 0 ? ["admin"] : ["member"] })),
        })
        const body = `
var voters = []address{${voters.map((a) => `address(${q(a)})`).join(", ")}}

func TestA_Seed(cur realm, t *testing.T) {
\tdesc := strings.Repeat("x", 8000)
\ttitle := strings.Repeat("t", 128)
\tfor i := 0; i < 51; i++ {
\t\ttesting.SetRealm(testing.NewUserRealm(voters[i/9]))
\t\t${D.proposeText("TITLE", "DESC").replace('"TITLE"', "title").replace('"DESC"', "desc")}
\t}
}

func TestB_FirstPage(t *testing.T) {
\ts := ${D.listPage("0", "50")}
\tif n := strings.Count(s, "\\"voting_ends_at\\""); n != 50 { t.Fatalf("first page has %d proposals", n) }
\tif !strings.Contains(s, "\\"next_before\\":2") { t.Fatal("first page must point at the next page") }
}

func TestC_SecondPage(t *testing.T) {
\ts := ${D.listPage("2", "50")}
\tif n := strings.Count(s, "\\"voting_ends_at\\""); n != 1 { t.Fatalf("second page has %d proposals", n) }
\tif !strings.Contains(s, "\\"next_before\\":0") { t.Fatal("second page must be the last") }
}
`
        const res = runPackage(pkg, code, testFile(pkg, body), ["-print-runtime-metrics"])
        expectPasses(res, ["TestA_Seed", "TestB_FirstPage", "TestC_SecondPage"])
        const gas = /--- PASS: TestB_FirstPage[^\n]*\n(?:[^\n]*\n)*?--- GAS:\s+(\d+)/.exec(res.out)
        expect(gas, `no gas figure for TestB_FirstPage:\n${res.out.slice(-3000)}`).not.toBeNull()
        expect(Number(gas![1])).toBeLessThan(300_000_000)
    }, 300_000)
})
