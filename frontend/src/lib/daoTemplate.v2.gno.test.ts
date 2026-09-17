/**
 * Generated DAO realm, template v2 — native proof under `gno test`.
 *
 * Every rule of the v2 realm (bounded voting power, vote-only membership
 * changes, time-based voting and execution windows, validated inputs, bounded
 * paginated reads, escaped Render, events) is exercised here with the gno
 * toolchain CI pins (including the gnoland-1 runtime).
 *
 * The first packages port earlier review scenarios as expectations of v2
 * behaviour; the later ones cover each realm rule. The reads package also
 * prints qeval-shaped outputs that `lib/dao/membaV2.test.ts` uses as fixtures
 * (set DAO_V2_FIXTURES_DIR to refresh them).
 *
 * Requires `gno` on PATH (REQUIRE_GNO=1 forbids the skip). Hermetic: the
 * gno.land/p deps are vendored from GNOROOT/examples and GNOHOME is isolated.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateDAOCode, type DAOCreationConfig } from "./daoTemplate"
import { encodeBech32 } from "./templates/dao/v2/bech32"
import { REQUIRE_GNO, gnoRoot, probeToolchain, vendorGnolandDeps } from "../test/gnoToolchain"

// ── Fixture addresses (valid bech32 checksums) ───────────────────────

const ALICE = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const BOB = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const CAROL = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"

/** Deterministic valid address number n. */
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

const q = (s: string) => JSON.stringify(s)
const pkgPath = (pkg: string) => `gno.land/r/memba/${pkg}`

function config(pkg: string, change: Partial<DAOCreationConfig> & Pick<DAOCreationConfig, "members" | "threshold">): DAOCreationConfig {
    return {
        name: `Fixture ${pkg}`,
        description: "native proof fixture",
        realmPath: pkgPath(pkg),
        quorum: 0,
        roles: ["admin", "lead", "member"],
        proposalCategories: ["governance", "membership"],
        votingPeriodSeconds: 7200,
        executionDelaySeconds: 3600,
        executionWindowSeconds: 86400,
        ...change,
    }
}

const THREE = [
    { address: ALICE, power: 50, roles: ["lead"] },
    { address: BOB, power: 30, roles: ["member"] },
    { address: CAROL, power: 20, roles: ["member"] },
]

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

/** Commit of the gno sources the toolchain uses: a git checkout, or a Go module cache path. */
function toolchainCommit(): string {
    const root = gnoRoot() ?? ""
    const git = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" })
    if (git.status === 0 && /^[0-9a-f]{40}$/.test(git.stdout.trim())) return git.stdout.trim()
    return /-([0-9a-f]{12})(?:\/|$)/.exec(root)?.[1] ?? root
}

// CI sets GNO_REQUIRED_PIN per lane (pearl, gnoland-1).
it("runs on the gno pin the CI lane requires", () => {
    const required = process.env.GNO_REQUIRED_PIN
    if (!required) return
    expect(TOOLCHAIN.ok, TOOLCHAIN.message).toBe(true)
    const commit = toolchainCommit()
    expect(commit.length >= 12 && required.startsWith(commit.slice(0, 12)), `toolchain sources at ${commit}, lane requires ${required}`).toBe(true)
})

let workdir = ""

interface RunResult {
    status: number | null
    out: string
}

/**
 * DAO_V2_MUTATION='["from","to"]' rewrites the generated realm before every run,
 * for checking that a guard is really exercised (the suite must then fail).
 */
function mutate(code: string): string {
    const spec = process.env.DAO_V2_MUTATION
    if (!spec) return code
    const [from, to] = JSON.parse(spec) as [string, string]
    return code.split(from).join(to)
}

function runPackage(pkg: string, generated: string, testGno: string, flags: string[] = []): RunResult {
    const code = mutate(generated)
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

function gasOf(res: RunResult, test: string): number {
    const m = new RegExp(`--- PASS: ${test} [^\\n]*\\n--- GAS:\\s+(\\d+)`).exec(res.out)
    expect(m, `no gas figure for ${test}`).not.toBeNull()
    return Number(m![1])
}

function testFile(pkg: string, body: string, extraImports: string[] = []): string {
    const imports = ["strconv", "strings", "testing", ...extraImports].map((i) => `\t${q(i)}`).join("\n")
    return `package ${pkg}

import (
${imports}
)

var (
\talice = testing.NewUserRealm(address(${q(ALICE)}))
\tbob   = testing.NewUserRealm(address(${q(BOB)}))
\tcarol = testing.NewUserRealm(address(${q(CAROL)}))
\t_     = strings.Contains
\t_     = strconv.Itoa
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

// Gno bodies are raw strings: backslashes reach the Gno source unchanged.
const raw = String.raw

describeGno("generated DAO realm v2 under gno test", () => {
    // DAO_V2_WORKDIR keeps the generated workspace for inspection.
    const keep = process.env.DAO_V2_WORKDIR
    beforeAll(() => {
        workdir = keep ? keep : mkdtempSync(join(tmpdir(), "memba-dao-v2-"))
        mkdirSync(workdir, { recursive: true })
        writeFileSync(join(workdir, "gnowork.toml"), "")
    })
    afterAll(() => {
        if (workdir && !keep) rmSync(workdir, { recursive: true, force: true })
    })

    // ── Ported review scenarios ──────────────────────────────────────

    it("no member acts alone, and a 90 % vote removes a member labelled admin", () => {
        const pkg = "adv_admin"
        const code = generateDAOCode(config(pkg, {
            threshold: 60,
            members: [
                { address: ALICE, power: 10, roles: ["admin"] },
                { address: BOB, power: 45, roles: ["admin"] },
                { address: CAROL, power: 45, roles: ["member"] },
            ],
        }))
        // Roles are labels: the realm exposes no entrypoint that changes state
        // without a vote.
        for (const fn of ["AssignRole", "RemoveRole", "Archive", "SetAdmin", "AddMember", "RemoveMember"]) {
            expect(code).not.toMatch(new RegExp(`func ${fn}\\(`))
        }
        expect(code).not.toMatch(/"admin"\s*\)/)
        const body = raw`
func TestSupermajorityRemovesAdminLabelledMember(cur realm, t *testing.T) {
	testing.SetRealm(bob)
	id := ProposeRemoveMember(cross(cur), "remove alice", "", address(${q(ALICE)}))
	Vote(cross(cur), id, "YES")
	testing.SetRealm(carol)
	Vote(cross(cur), id, "YES")
	if derivedStatus(getProposal(id)) != "ACCEPTED" { t.Fatal("expected accepted") }
	advance(3600)
	Execute(cross(cur), id)
	if IsMember(address(${q(ALICE)})) { t.Fatal("a 90 % vote must remove the member") }
}

func TestLabelledAdminCannotPassAlone(cur realm, t *testing.T) {
	testing.SetRealm(bob)
	id := ProposeArchive(cross(cur), "archive", "")
	Vote(cross(cur), id, "YES")
	if derivedStatus(getProposal(id)) != "ACTIVE" { t.Fatal("45 % must not decide a 60 % threshold") }
	advance(3600)
	mustAbort(t, "execute without acceptance", func() { Execute(cross(cur), id) })
	if IsArchived() { t.Fatal("archived without a vote") }
}
`
        expectPasses(runPackage(pkg, code, testFile(pkg, body)), ["TestSupermajorityRemovesAdminLabelledMember", "TestLabelledAdminCannotPassAlone"])
    }, 180_000)

    it("voting power above the bound is refused at propose time", () => {
        const pkg = "adv_ovf"
        const code = generateDAOCode(config(pkg, { threshold: 60, members: THREE }))
        const body = raw`
func TestPowerBoundAtPropose(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	w := address(${q(WHALE)})
	mustAbort(t, "power 1e17", func() { ProposeAddMember(cross(cur), "add", "", w, 100000000000000000, "") })
	mustAbort(t, "power MaxInt64", func() { ProposeAddMember(cross(cur), "add", "", w, 9223372036854775807, "") })
	mustAbort(t, "power above the bound", func() { ProposeAddMember(cross(cur), "add", "", w, 1000000001, "") })
	mustAbort(t, "zero power", func() { ProposeAddMember(cross(cur), "add", "", w, 0, "") })
	mustAbort(t, "negative power", func() { ProposeAddMember(cross(cur), "add", "", w, -1, "") })
	ProposeAddMember(cross(cur), "add", "", w, 1000000000, "")
}
`
        expectPasses(runPackage(pkg, code, testFile(pkg, body)), ["TestPowerBoundAtPropose"])
    }, 180_000)

    it("removing the last voting power is refused at propose and at execute", () => {
        const pkg = "adv_zero"
        const code = generateDAOCode(config(pkg, {
            threshold: 51,
            members: [
                { address: ALICE, power: 60, roles: ["admin"] },
                { address: BOB, power: 40, roles: ["member"] },
            ],
        }))
        const body = raw`
func TestRemovalToZeroRefused(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	removeBob := ProposeRemoveMember(cross(cur), "remove bob", "", address(${q(BOB)}))
	Vote(cross(cur), removeBob, "YES")
	removeAlice := ProposeRemoveMember(cross(cur), "remove alice", "", address(${q(ALICE)}))
	Vote(cross(cur), removeAlice, "YES")
	advance(3600)
	Execute(cross(cur), removeBob)
	mustAbort(t, "execute removal of the last member", func() { Execute(cross(cur), removeAlice) })
	if !IsMember(address(${q(ALICE)})) || memberTotalPower != 60 { t.Fatal("last member removed") }
	if derivedStatus(getProposal(removeAlice)) != "ACCEPTED" { t.Fatal("a refused execution must not mark the proposal") }
	mustAbort(t, "propose removal of the last member", func() { ProposeRemoveMember(cross(cur), "remove", "", address(${q(ALICE)})) })
}
`
        expectPasses(runPackage(pkg, code, testFile(pkg, body)), ["TestRemovalToZeroRefused"])
    }, 180_000)

    it("inputs are validated, Render is escaped, delay counts from acceptance and accepted proposals lapse", () => {
        const pkg = "adv_misc"
        const code = generateDAOCode(config(pkg, { threshold: 60, members: THREE }))
        const badChecksum = ALICE.slice(0, -1) + (ALICE.endsWith("c") ? "d" : "c")
        const body = raw`
func TestCodeRealmCallerIsNotMember(cur realm, t *testing.T) {
	testing.SetRealm(testing.NewCodeRealm("gno.land/r/other/proxy"))
	mustAbort(t, "code realm propose", func() { ProposeText(cross(cur), "x", "", "governance") })
}

func TestInvalidAddressRefused(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	mustAbort(t, "non-bech32 address", func() { ProposeAddMember(cross(cur), "add", "", address("NOT_A_VALID_ADDRESS_AT_ALL"), 40, "") })
	mustAbort(t, "address with a separator", func() { ProposeAddMember(cross(cur), "add", "", address("not-a-bech32-address|x"), 5, "") })
	mustAbort(t, "bad checksum", func() { ProposeAddMember(cross(cur), "add", "", address(${q(badChecksum)}), 5, "") })
	upper := address(${q(BOB.toUpperCase())})
	if !upper.IsValid() { t.Fatal("fixture: the upper-case spelling must be a valid address for this test to mean anything") }
	mustAbort(t, "upper-case spelling of an existing member", func() { ProposeAddMember(cross(cur), "add", "", upper, 5, "") })
	mustAbort(t, "upper-case spelling of a new account", func() { ProposeAddMember(cross(cur), "add", "", address(${q(WHALE.toUpperCase())}), 5, "") })
	// The realm checks only the first character, relying on bech32 refusing mixed case.
	if address(${q(BOB.slice(0, 20) + BOB.slice(20).toUpperCase())}).IsValid() || address(${q("g" + BOB.slice(1).toUpperCase())}).IsValid() { t.Fatal("mixed-case addresses must be invalid") }
	mustAbort(t, "remove a non-member", func() { ProposeRemoveMember(cross(cur), "remove", "", address("NOT_A_VALID_ADDRESS_AT_ALL")) })
}

func TestTitleIsOneEscapedLine(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	mustAbort(t, "title with newline", func() { ProposeText(cross(cur), "hi\n## Members (1)\n- fake", "", "governance") })
	ProposeText(cross(cur), "hi](https://x.example) # [b]", "", "governance")
	if strings.Contains(Render(""), "](https://x.example)") { t.Fatal("title markdown is not escaped") }
}

func TestDelayCountsFromAcceptance(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	id := ProposeText(cross(cur), "late", "", "governance")
	advance(3600)
	Vote(cross(cur), id, "YES")
	testing.SetRealm(bob)
	Vote(cross(cur), id, "YES")
	if derivedStatus(getProposal(id)) != "ACCEPTED" { t.Fatal("expected accepted") }
	mustAbort(t, "execute right after acceptance", func() { Execute(cross(cur), id) })
	advance(3600)
	Execute(cross(cur), id)
}

func TestAcceptedProposalLapses(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	id := ProposeText(cross(cur), "stale", "", "governance")
	Vote(cross(cur), id, "YES")
	testing.SetRealm(bob)
	Vote(cross(cur), id, "YES")
	advance(3600 + 86400 + 60)
	if derivedStatus(getProposal(id)) != "LAPSED" { t.Fatal("accepted proposal must lapse after the execution window") }
	if getProposal(id).Status != "ACCEPTED" { t.Fatal("lapsing must not be written") }
	mustAbort(t, "execute after the window", func() { Execute(cross(cur), id) })
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

    it("51 proposals page correctly and reads stay far below the 3B query gas limit", () => {
        const pkg = "adv_gas"
        const voters = [ALICE, BOB, CAROL, DAVE, ERIN, WHALE]
        const code = generateDAOCode(config(pkg, {
            threshold: 60,
            members: voters.map((a) => ({ address: a, power: 10, roles: ["member"] })),
        }))
        const body = raw`
var voters = []address{${voters.map((a) => `address(${q(a)})`).join(", ")}}

func TestA_Seed(cur realm, t *testing.T) {
	desc := strings.Repeat("x", 8000)
	title := strings.Repeat("t", 128)
	for i := 0; i < 51; i++ {
		testing.SetRealm(testing.NewUserRealm(voters[i/9]))
		ProposeText(cross(cur), title, desc, "governance")
	}
}

func TestB_Pages(t *testing.T) {
	s := GetProposalsJSON(0, 50)
	if n := strings.Count(s, "\"voting_ends_at\""); n != 50 { t.Fatalf("first page has %d proposals", n) }
	if !strings.HasPrefix(s, "{\"proposals\":[{\"id\":51,") || !strings.HasSuffix(s, "\"next_before\":2}") { t.Fatal("first page must start at the newest and point at the next page") }
	s = GetProposalsJSON(2, 50)
	if n := strings.Count(s, "\"voting_ends_at\""); n != 1 || !strings.HasSuffix(s, "\"next_before\":0}") { t.Fatal("second page must hold the oldest proposal and be the last") }
	if GetProposalsJSON(1, 50) != "{\"proposals\":[],\"next_before\":0}" { t.Fatal("nothing before the first id") }
	if strings.Contains(GetProposalsJSON(0, 50), "xxxxxxxx") { t.Fatal("list pages must not carry descriptions") }
}

// Each gas probe below is only the read, so the figure is the read's cost.
func TestC_Settle(t *testing.T) { _ = GetConfigJSON() }

func TestD_GasFullListPage(t *testing.T) { _ = GetProposalsJSON(0, 50) }

func TestE_GasLargestDetail(t *testing.T) { _ = GetProposalJSON(51) }

func TestF_GasRenderHome(t *testing.T) { _ = Render("") }

func TestG_GasRenderLargestDetail(t *testing.T) { _ = Render("51") }
`
        const res = runPackage(pkg, code, testFile(pkg, body), ["-print-runtime-metrics"])
        expectPasses(res, ["TestA_Seed", "TestB_Pages", "TestD_GasFullListPage", "TestE_GasLargestDetail", "TestF_GasRenderHome", "TestG_GasRenderLargestDetail"])
        // Measured at 31b6650a: list page ~130M, 8000-char detail ~295M,
        // Render home ~52M, Render detail ~315M (query limit 3B).
        expect(gasOf(res, "TestD_GasFullListPage")).toBeLessThan(300_000_000)
        expect(gasOf(res, "TestE_GasLargestDetail")).toBeLessThan(600_000_000)
        expect(gasOf(res, "TestF_GasRenderHome")).toBeLessThan(300_000_000)
        expect(gasOf(res, "TestG_GasRenderLargestDetail")).toBeLessThan(600_000_000)
    }, 300_000)

    // ── Genesis ──────────────────────────────────────────────────────

    it("genesis refuses a threshold of 50 %, bad addresses, zero power, duplicates and out-of-range windows", () => {
        const base = config("gen", { threshold: 60, members: THREE })
        expect(() => generateDAOCode({ ...base, threshold: 50 })).toThrow(/threshold/i)
        const aliceRow = `addGenesisMember(${q(ALICE)}, 50, []string{"lead"})`
        const patches: [string, (code: string) => string, RegExp][] = [
            ["gen_threshold", (c) => c.replace(/(\bthreshold\s*=\s*)60\b/, "$150"), /threshold/],
            ["gen_address", (c) => c.replace(aliceRow, aliceRow.replace(ALICE, ALICE.slice(0, -1) + "d")), /invalid member address/],
            ["gen_power", (c) => c.replace(aliceRow, aliceRow.replace(", 50,", ", 0,")), /member power/],
            ["gen_duplicate", (c) => c.replace(aliceRow, `${aliceRow}\n\t${aliceRow}`), /duplicate member/],
            ["gen_period", (c) => c.replace("int64(7200)", "int64(60)"), /voting period/],
            ["gen_delay", (c) => c.replace("executionDelay  = int64(3600)", "executionDelay  = int64(60)"), /execution delay/],
            ["gen_role", (c) => c.replace(aliceRow, aliceRow.replace('"lead"', '"owner"')), /invalid role/],
            ["gen_upper", (c) => c.replace(aliceRow, aliceRow.replace(ALICE, ALICE.toUpperCase())), /lower case/],
        ]
        for (const [pkg, patch, message] of patches) {
            const code = generateDAOCode({ ...base, realmPath: pkgPath(pkg) })
            expect(code).toContain(aliceRow)
            const patched = patch(code)
            expect(patched, `${pkg} patch did not apply`).not.toBe(code)
            const res = runPackage(pkg, patched, testFile(pkg, `func TestNothing(t *testing.T) {}`))
            expect(res.status, `${pkg}: genesis must refuse\n${res.out.slice(-2000)}`).not.toBe(0)
            expect(res.out).toMatch(message)
        }
        // Control: the unpatched package initialises.
        const control = generateDAOCode({ ...base, realmPath: pkgPath("gen_control") })
        expectPasses(runPackage("gen_control", control, testFile("gen_control", `func TestNothing(t *testing.T) {}`)), ["TestNothing"])
    }, 300_000)

    // ── Rules ────────────────────────────────────────────────────────

    it("votes, proposals, roles, execution, reads, Render and archive follow the v2 rules", () => {
        const pkg = "v2_rules"
        const code = generateDAOCode(config(pkg, { name: "Rules *DAO* [x]", threshold: 60, members: THREE }))
        const body = raw`
func TestA_Versions(t *testing.T) {
	if GetTemplateVersion() != "memba-dao/2" || GetAPIVersion() != "2.0" { t.Fatal("versions") }
	c := GetConfigJSON()
	for _, want := range []string{"\"name\":\"Rules *DAO* [x]\"", "\"total_power\":100", "\"member_count\":3", "\"threshold\":60", "\"archived\":false"} {
		if !strings.Contains(c, want) { t.Fatalf("config missing %s: %s", want, c) }
	}
}

func TestB_VoteValidatedBeforeWrites(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	id := ProposeText(cross(cur), "vote checks", "d", "governance")
	testing.SetRealm(bob)
	mustAbort(t, "unknown choice", func() { Vote(cross(cur), id, "MAYBE") })
	mustAbort(t, "lower-case choice", func() { Vote(cross(cur), id, "yes") })
	if HasVoted(id, address(${q(BOB)})) { t.Fatal("a refused vote was recorded") }
	Vote(cross(cur), id, "YES")
	if !HasVoted(id, address(${q(BOB)})) { t.Fatal("HasVoted must be true after voting") }
	mustAbort(t, "second vote", func() { Vote(cross(cur), id, "NO") })
	mustAbort(t, "unknown proposal", func() { Vote(cross(cur), 9999, "YES") })
	if getProposal(id).Yes != 30 || getProposal(id).No != 0 { t.Fatal("tally changed by a refused vote") }
	testing.SetRealm(testing.NewUserRealm(address(${q(DAVE)})))
	mustAbort(t, "non-member vote", func() { Vote(cross(cur), id, "YES") })
	mustAbort(t, "non-member propose", func() { ProposeText(cross(cur), "x", "", "governance") })
}

func TestC_AcceptAndRejectOnlyWhenIrreversible(cur realm, t *testing.T) {
	testing.SetRealm(carol)
	id := ProposeText(cross(cur), "reject me", "", "governance")
	testing.SetRealm(bob)
	Vote(cross(cur), id, "NO")
	if getProposal(id).Status != "ACTIVE" { t.Fatal("passage is still reachable") }
	testing.SetRealm(carol)
	Vote(cross(cur), id, "ABSTAIN")
	if getProposal(id).Status != "REJECTED" { t.Fatal("passage is impossible: must reject") }
	testing.SetRealm(alice)
	mustAbort(t, "vote on a rejected proposal", func() { Vote(cross(cur), id, "YES") })
	a := ProposeText(cross(cur), "accept me", "", "governance")
	Vote(cross(cur), a, "YES")
	if getProposal(a).Status != "ACTIVE" { t.Fatal("50 % must not decide a 60 % threshold") }
	testing.SetRealm(carol)
	Vote(cross(cur), a, "YES")
	if getProposal(a).Status != "ACCEPTED" || getProposal(a).AcceptedAt == 0 { t.Fatal("70 % must accept and record the time") }
}

func TestD_ExpiryDerivedOnRead(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	id := ProposeText(cross(cur), "expires", "", "governance")
	advance(7200)
	if derivedStatus(getProposal(id)) != "EXPIRED" { t.Fatal("expected EXPIRED") }
	if getProposal(id).Status != "ACTIVE" { t.Fatal("expiry must not be written") }
	if !strings.Contains(GetProposalJSON(id), "\"status\":\"EXPIRED\"") { t.Fatal("reads must show EXPIRED") }
	testing.SetRealm(bob)
	mustAbort(t, "vote after the end", func() { Vote(cross(cur), id, "YES") })
	mustAbort(t, "execute an expired proposal", func() { Execute(cross(cur), id) })
}

func TestE_TitleAndDescriptionLimits(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	mustAbort(t, "129-character title", func() { ProposeText(cross(cur), strings.Repeat("é", 129), "", "governance") })
	ProposeText(cross(cur), strings.Repeat("é", 128), strings.Repeat("ü", 8000), "governance")
	mustAbort(t, "empty title", func() { ProposeText(cross(cur), "", "", "governance") })
	mustAbort(t, "blank title", func() { ProposeText(cross(cur), "   ", "", "governance") })
	mustAbort(t, "tab in title", func() { ProposeText(cross(cur), "a\tb", "", "governance") })
	mustAbort(t, "line separator in title", func() { ProposeText(cross(cur), "a\u2028b", "", "governance") })
	mustAbort(t, "right-to-left override in title", func() { ProposeText(cross(cur), "Pay\u202Eyou", "", "governance") })
	mustAbort(t, "zero-width space in title", func() { ProposeText(cross(cur), "a\u200Bb", "", "governance") })
	mustAbort(t, "byte-order mark in title", func() { ProposeText(cross(cur), "\uFEFFtitle", "", "governance") })
	mustAbort(t, "bidi isolate in title", func() { ProposeText(cross(cur), "a\u2066b\u2069", "", "governance") })
	mustAbort(t, "invalid UTF-8 title", func() { ProposeText(cross(cur), string([]byte{0xff, 0x41}), "", "governance") })
	mustAbort(t, "8001-character description", func() { ProposeText(cross(cur), "long", strings.Repeat("x", 8001), "governance") })
	mustAbort(t, "NUL in description", func() { ProposeText(cross(cur), "nul", "a\x00b", "governance") })
	ProposeText(cross(cur), "multi-line", "line1\nline2\ttabbed", "governance")
	mustAbort(t, "unknown category", func() { ProposeText(cross(cur), "t", "", "treasury") })
}

func TestF_OpenProposalCap(cur realm, t *testing.T) {
	testing.SetRealm(bob)
	ids := []uint64{}
	for i := 0; i < 10; i++ {
		ids = append(ids, ProposeText(cross(cur), "open", "", "governance"))
	}
	mustAbort(t, "eleventh open proposal", func() { ProposeText(cross(cur), "one too many", "", "governance") })
	Vote(cross(cur), ids[0], "YES")
	testing.SetRealm(alice)
	Vote(cross(cur), ids[0], "YES")
	testing.SetRealm(bob)
	ProposeText(cross(cur), "room again", "", "governance")
	mustAbort(t, "cap applies again", func() { ProposeText(cross(cur), "again", "", "governance") })
}

func TestG_SetRolesByProposal(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	b := address(${q(BOB)})
	mustAbort(t, "unknown role", func() { ProposeSetRoles(cross(cur), "roles", "", b, "boss") })
	mustAbort(t, "duplicate role", func() { ProposeSetRoles(cross(cur), "roles", "", b, "lead,lead") })
	mustAbort(t, "empty role entry", func() { ProposeSetRoles(cross(cur), "roles", "", b, "lead,") })
	mustAbort(t, "non-member target", func() { ProposeSetRoles(cross(cur), "roles", "", address(${q(DAVE)}), "lead") })
	id := ProposeSetRoles(cross(cur), "make bob lead", "", b, "lead,member")
	Vote(cross(cur), id, "YES")
	testing.SetRealm(bob)
	Vote(cross(cur), id, "YES")
	testing.SetRealm(carol)
	open := ProposeText(cross(cur), "still open", "", "governance")
	version := electorateVersion
	mustAbort(t, "execute before the delay", func() { Execute(cross(cur), id) })
	advance(3600)
	Execute(cross(cur), id)
	m := getMember(b)
	if len(m.Roles) != 2 || m.Roles[0] != "lead" || m.Roles[1] != "member" { t.Fatal("roles not applied") }
	if electorateVersion != version || derivedStatus(getProposal(open)) != "ACTIVE" { t.Fatal("a role change must not invalidate open votes") }
	if derivedStatus(getProposal(id)) != "EXECUTED" { t.Fatal("expected EXECUTED") }
	mustAbort(t, "execute twice", func() { Execute(cross(cur), id) })
}

func TestH_ExecuteRevalidatesAndMarksOnlyAfterApplying(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	d := address(${q(DAVE)})
	p1 := ProposeAddMember(cross(cur), "add dave", "", d, 5, "member")
	p2 := ProposeAddMember(cross(cur), "add dave again", "", d, 7, "")
	for _, id := range []uint64{p1, p2} {
		testing.SetRealm(alice)
		Vote(cross(cur), id, "YES")
		testing.SetRealm(bob)
		Vote(cross(cur), id, "YES")
	}
	testing.SetRealm(carol)
	pending := ProposeText(cross(cur), "pending during the change", "", "governance")
	version := electorateVersion
	advance(3600)
	Execute(cross(cur), p1)
	if !IsMember(d) || electorateVersion != version+1 || memberTotalPower != 105 { t.Fatal("add not applied") }
	mustAbort(t, "stale second add", func() { Execute(cross(cur), p2) })
	if derivedStatus(getProposal(p2)) != "ACCEPTED" { t.Fatal("a refused execution must not mark the proposal") }
	if derivedStatus(getProposal(pending)) != "INVALIDATED" { t.Fatal("membership change must invalidate open votes") }
	mustAbort(t, "vote on an invalidated proposal", func() { Vote(cross(cur), pending, "YES") })
}

func TestI_PowerBoundRecheckedAtExecute(cur realm, t *testing.T) {
	// White-box: a stored action beyond the bound (unreachable through the
	// public API) is still refused when executed.
	lastID++
	id := lastID
	ts := now()
	proposals.Set(padID(id), &Proposal{ID: id, Title: "forged", Category: "membership", Author: address(${q(ALICE)}),
		Action: Action{Kind: kindAddMember, Target: address(${q(ERIN)}), Power: maxPower + 1},
		Status: statusAccepted, Votes: avl.NewTree(), ElectoratePower: memberTotalPower, ElectorateVersion: electorateVersion,
		CreatedAt: ts, VotingEndsAt: ts + votingPeriod, AcceptedAt: ts - executionDelay - 1})
	testing.SetRealm(alice)
	mustAbort(t, "power above the bound at execute", func() { Execute(cross(cur), id) })
	if IsMember(address(${q(ERIN)})) || getProposal(id).Status != statusAccepted { t.Fatal("refused execution changed state") }
	proposals.Remove(padID(id))
}

func TestJ_ReadsArePaginated(t *testing.T) {
	mustPanic(t, "members limit 51", func() { GetMembersJSON(0, 51) })
	mustPanic(t, "members limit 0", func() { GetMembersJSON(0, 0) })
	mustPanic(t, "negative offset", func() { GetMembersJSON(-1, 10) })
	mustPanic(t, "proposals limit 51", func() { GetProposalsJSON(0, 51) })
	mustPanic(t, "votes limit 51", func() { GetVotesJSON(1, 0, 51) })
	mustPanic(t, "unknown proposal", func() { GetProposalJSON(99999) })
	page := GetMembersJSON(1, 2)
	if !strings.Contains(page, "\"total\":4") || strings.Count(page, "\"address\"") != 2 { t.Fatalf("members page: %s", page) }
	if !strings.Contains(GetVotesJSON(1, 0, 50), "{\"voter\":\"${BOB}\",\"choice\":\"YES\",\"power\":30}") { t.Fatal("votes page") }
	state := GetStateJSON(0, 50)
	if !strings.HasPrefix(state, "{\"config\":{\"template_version\":\"memba-dao/2\"") || !strings.Contains(state, "\"members\":{\"total\":4") { t.Fatalf("state export: %s", state) }
}

func TestK_RenderEscapesUserText(cur realm, t *testing.T) {
	testing.SetRealm(carol)
	id := ProposeText(cross(cur), "# [x](y) <b> \x60c\x60 | ! *z* _u_ \\", "line1\n## fake heading\n[link](https://x.example)", "governance")
	home := Render("")
	if !strings.HasPrefix(home, "# Rules \\*DAO\\* \\[x\\]\n") { t.Fatalf("name not escaped: %s", home[:40]) }
	if !strings.Contains(home, "\\# \\[x\\]\\(y\\) \\<b\\> \\\x60c\\\x60 \\| \\! \\*z\\* \\_u\\_ \\\\") { t.Fatal("title not escaped") }
	if !strings.Contains(home, "\n- ${ALICE} (power 50)\n") { t.Fatal("member rows show the address and power only") }
	detail := Render(strconv.FormatUint(id, 10))
	if !strings.Contains(detail, "> line1\n> \\#\\# fake heading\n> \\[link\\]\\(https://x.example\\)\n") { t.Fatalf("description not quoted and escaped: %s", detail) }
	if strings.Contains(detail, "\n## fake") { t.Fatal("description injected a heading") }
	if Render("?page=abc") != "# Not found\n" || Render("nope") != "# Not found\n" { t.Fatal("unknown paths") }
}

func TestL_RemoveMemberByProposal(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	d := address(${q(DAVE)})
	mustAbort(t, "remove a non-member", func() { ProposeRemoveMember(cross(cur), "remove", "", address(${q(ERIN)})) })
	id := ProposeRemoveMember(cross(cur), "remove dave", "", d)
	Vote(cross(cur), id, "YES")
	testing.SetRealm(bob)
	Vote(cross(cur), id, "YES")
	version := electorateVersion
	advance(3600)
	Execute(cross(cur), id)
	if IsMember(d) || memberTotalPower != 100 || electorateVersion != version+1 { t.Fatal("removal not applied") }
}

func TestM_ArchiveOnlyByProposal(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	other := ProposeText(cross(cur), "before archive", "", "governance")
	arch := ProposeArchive(cross(cur), "archive", "")
	for _, id := range []uint64{other, arch} {
		testing.SetRealm(alice)
		Vote(cross(cur), id, "YES")
		testing.SetRealm(bob)
		Vote(cross(cur), id, "YES")
	}
	testing.SetRealm(carol)
	open := ProposeText(cross(cur), "open at archive", "", "governance")
	advance(3600)
	if IsArchived() { t.Fatal("archived before execution") }
	Execute(cross(cur), arch)
	if !IsArchived() || !strings.Contains(GetConfigJSON(), "\"archived\":true") || !strings.Contains(Render(""), "This DAO is archived.") { t.Fatal("archive not applied") }
	// Reads close what can no longer be voted or executed.
	if derivedStatus(getProposal(open)) != "ARCHIVED" || derivedStatus(getProposal(other)) != "ARCHIVED" { t.Fatal("open and accepted proposals must read ARCHIVED") }
	if !strings.Contains(GetProposalJSON(open), "\"status\":\"ARCHIVED\"") { t.Fatal("JSON must show ARCHIVED") }
	if derivedStatus(getProposal(arch)) != "EXECUTED" { t.Fatal("the archive proposal itself stays EXECUTED") }
	mustAbort(t, "execute after archive", func() { Execute(cross(cur), other) })
	mustAbort(t, "propose after archive", func() { ProposeText(cross(cur), "t", "", "governance") })
	mustAbort(t, "vote after archive", func() { Vote(cross(cur), open, "YES") })
	if !IsMember(address(${q(ALICE)})) { t.Fatal("reads keep working after archive") }
}
`
        const res = runPackage(pkg, code, testFile(pkg, body, ["gno.land/p/nt/avl/v0"]), ["-print-events"])
        expectPasses(res, [
            "TestA_Versions",
            "TestB_VoteValidatedBeforeWrites",
            "TestC_AcceptAndRejectOnlyWhenIrreversible",
            "TestD_ExpiryDerivedOnRead",
            "TestE_TitleAndDescriptionLimits",
            "TestF_OpenProposalCap",
            "TestG_SetRolesByProposal",
            "TestH_ExecuteRevalidatesAndMarksOnlyAfterApplying",
            "TestI_PowerBoundRecheckedAtExecute",
            "TestJ_ReadsArePaginated",
            "TestK_RenderEscapesUserText",
            "TestL_RemoveMemberByProposal",
            "TestM_ArchiveOnlyByProposal",
        ])
        // Events (rule 7): emitted by the realm with the proposal id and kind.
        const pkgEvent = `"pkg_path":"${pkgPath(pkg)}"`
        expect(res.out).toContain(`{"type":"ProposalCreated","attrs":[{"key":"id","value":"1"},{"key":"kind","value":"text"}],${pkgEvent}}`)
        expect(res.out).toMatch(/\{"type":"VoteCast","attrs":\[\{"key":"id","value":"1"\},\{"key":"voter","value":"g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"\},\{"key":"choice","value":"YES"\}\]/)
        expect(res.out).toMatch(/\{"type":"ProposalExecuted","attrs":\[\{"key":"id","value":"\d+"\},\{"key":"kind","value":"set_roles"\}\]/)
        expect(res.out).toMatch(/\{"type":"ProposalExecuted","attrs":\[\{"key":"id","value":"\d+"\},\{"key":"kind","value":"archive"\}\]/)
        expect(res.out).toMatch(/\{"type":"DAOArchived","attrs":\[\{"key":"id","value":"\d+"\}\]/)
    }, 300_000)

    it("quorum counts YES, NO and ABSTAIN and gates acceptance", () => {
        const pkg = "v2_quorum"
        const code = generateDAOCode(config(pkg, {
            threshold: 51,
            quorum: 80,
            members: [
                { address: ALICE, power: 60, roles: [] },
                { address: BOB, power: 30, roles: [] },
                { address: CAROL, power: 10, roles: [] },
            ],
        }))
        const body = raw`
func TestQuorum(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	id := ProposeText(cross(cur), "needs turnout", "", "governance")
	Vote(cross(cur), id, "YES")
	if getProposal(id).Status != "ACTIVE" { t.Fatal("60 % turnout is below an 80 % quorum") }
	testing.SetRealm(carol)
	Vote(cross(cur), id, "ABSTAIN")
	if getProposal(id).Status != "ACTIVE" { t.Fatal("70 % turnout is below an 80 % quorum") }
	testing.SetRealm(bob)
	Vote(cross(cur), id, "ABSTAIN")
	if getProposal(id).Status != "ACCEPTED" { t.Fatal("abstain counts toward quorum") }
	testing.SetRealm(bob)
	r := ProposeText(cross(cur), "reject", "", "governance")
	Vote(cross(cur), r, "NO")
	if getProposal(r).Status != "ACTIVE" { t.Fatal("passage still reachable") }
	testing.SetRealm(alice)
	Vote(cross(cur), r, "NO")
	if getProposal(r).Status != "REJECTED" { t.Fatal("must reject once passage is impossible") }
}
`
        expectPasses(runPackage(pkg, code, testFile(pkg, body)), ["TestQuorum"])
    }, 180_000)

    it("100 members at maximum power: member limit holds and the vote math stays exact", () => {
        const pkg = "v2_max"
        const roster = Array.from({ length: 100 }, (_, i) => addr(100 + i))
        const code = generateDAOCode(config(pkg, {
            threshold: 60,
            members: roster.map((a) => ({ address: a, power: 1_000_000_000, roles: [] })),
        }))
        const body = raw`
var roster = []address{${roster.map((a) => `address(${q(a)})`).join(", ")}}

func TestA_MemberLimit(cur realm, t *testing.T) {
	if memberTotalPower != 100000000000 { t.Fatal("total power") }
	testing.SetRealm(testing.NewUserRealm(roster[0]))
	mustAbort(t, "101st member", func() { ProposeAddMember(cross(cur), "add", "", address(${q(ERIN)}), 1, "") })
}

func TestB_ExactThresholdAtMaximumPower(cur realm, t *testing.T) {
	testing.SetRealm(testing.NewUserRealm(roster[0]))
	id := ProposeText(cross(cur), "sixty of a hundred", "", "governance")
	for i := 0; i < 59; i++ {
		testing.SetRealm(testing.NewUserRealm(roster[i]))
		Vote(cross(cur), id, "YES")
	}
	if getProposal(id).Status != "ACTIVE" { t.Fatal("59 % must not accept") }
	testing.SetRealm(testing.NewUserRealm(roster[59]))
	Vote(cross(cur), id, "YES")
	if getProposal(id).Status != "ACCEPTED" { t.Fatal("60 % must accept") }
	testing.SetRealm(testing.NewUserRealm(roster[1]))
	r := ProposeText(cross(cur), "reject at the boundary", "", "governance")
	for i := 0; i < 40; i++ {
		testing.SetRealm(testing.NewUserRealm(roster[i]))
		Vote(cross(cur), r, "NO")
	}
	if getProposal(r).Status != "ACTIVE" { t.Fatal("60 % can still say YES") }
	testing.SetRealm(testing.NewUserRealm(roster[40]))
	Vote(cross(cur), r, "NO")
	if getProposal(r).Status != "REJECTED" { t.Fatal("59 % reachable must reject") }
}
`
        expectPasses(runPackage(pkg, code, testFile(pkg, body)), ["TestA_MemberLimit", "TestB_ExactThresholdAtMaximumPower"])
    }, 300_000)

    // ── Reads: real outputs, in the qeval wire shape, as reader fixtures ─

    it("JSON reads match the committed reader fixtures (qeval wire format)", () => {
        const pkg = "v2_reads"
        const code = generateDAOCode(config(pkg, {
            name: 'Reads "DAO" \\ é 🚀',
            description: "First line\nSecond <b>line</b>",
            threshold: 60,
            members: [
                { address: ALICE, power: 50, roles: ["lead"] },
                { address: BOB, power: 30, roles: ["member"] },
                { address: CAROL, power: 20, roles: [] },
            ],
        }))
        // qeval renders a string result as ("<Go-quoted>" string); strconv.Quote
        // reproduces that encoding inside the VM.
        const body = raw`
func wire(v string) string { return "(" + strconv.Quote(v) + " string)" }

func fixture(name, v string) { println("FIXTURE " + name + " " + v) }

func TestReads(cur realm, t *testing.T) {
	testing.SetRealm(alice)
	text := ProposeText(cross(cur), "say \"hi\" \\ 🚀", "line1\nline2 <b>", "governance")
	Vote(cross(cur), text, "YES")
	testing.SetRealm(bob)
	Vote(cross(cur), text, "YES")
	advance(3600)
	Execute(cross(cur), text)
	add := ProposeAddMember(cross(cur), "add dave", "", address(${q(DAVE)}), 5, "member")
	testing.SetRealm(alice)
	Vote(cross(cur), add, "YES")
	testing.SetRealm(carol)
	Vote(cross(cur), add, "NO")
	archive := ProposeArchive(cross(cur), "archive", "")
	testing.SetRealm(bob)
	Vote(cross(cur), archive, "NO")
	testing.SetRealm(alice)
	Vote(cross(cur), archive, "NO")
	fixture("config", wire(GetConfigJSON()))
	fixture("members", wire(GetMembersJSON(0, 50)))
	fixture("members-page2", wire(GetMembersJSON(1, 1)))
	fixture("proposals", wire(GetProposalsJSON(0, 50)))
	fixture("proposals-page", wire(GetProposalsJSON(0, 2)))
	fixture("proposals-last", wire(GetProposalsJSON(2, 2)))
	fixture("proposal-text", wire(GetProposalJSON(text)))
	fixture("proposal-add", wire(GetProposalJSON(add)))
	fixture("votes", wire(GetVotesJSON(text, 0, 50)))
	fixture("hasvoted-true", "(" + strconv.FormatBool(HasVoted(add, address(${q(CAROL)}))) + " bool)")
	fixture("hasvoted-false", "(" + strconv.FormatBool(HasVoted(add, address(${q(BOB)}))) + " bool)")
}
`
        const res = runPackage(pkg, code, testFile(pkg, body))
        expectPasses(res, ["TestReads"])
        const fixtures = new Map([...res.out.matchAll(/^FIXTURE (\S+) (.*)$/gm)].map((m) => [m[1], m[2]]))
        expect(fixtures.size).toBe(11)
        const dir = join(import.meta.dirname, "dao", "testdata", "memba-v2")
        if (process.env.DAO_V2_FIXTURES_DIR) {
            mkdirSync(dir, { recursive: true })
            for (const [name, value] of fixtures) writeFileSync(join(dir, `${name}.txt`), `${value}\n`)
        }
        for (const [name, value] of fixtures) {
            expect(readFileSync(join(dir, `${name}.txt`), "utf8"), `fixture ${name} is stale: rerun with DAO_V2_FIXTURES_DIR=1`).toBe(`${value}\n`)
        }
    }, 180_000)
})
