/**
 * W1.5 membership-unification proof — runs the GENERATED channels realm and its
 * GENERATED parent DAO as one workspace under the real gno test machine and
 * asserts the unified membership model actually behaves on-chain:
 *   - a wizard-SEEDED roster member can post, and their seeded roles satisfy a
 *     role-gated channel (dev-only)
 *   - a DAO member NOT in the roster is admitted via the cross-realm
 *     parent.IsMember() fallback — with the default "member" role, so a
 *     role-gated channel still refuses them
 *   - a complete non-member is rejected
 *   - announcements channels accept the deployer AND a seeded admin-ROLE
 *     member, and refuse ordinary members
 *
 * (The compile gate's negative control separately proves the cross-realm
 * dependency is real: unexporting the DAO's IsMember reddens this realm.)
 *
 * Requires `gno` on PATH (REQUIRE_GNO=1 in CI forbids the skip). Hermetic:
 * gno.land/p/* deps vendored from GNOROOT/examples, GNOHOME isolated.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateDAOCode } from "./daoTemplate"
import { generateChannelCode } from "./channelTemplate"

const REQUIRE_GNO = process.env.REQUIRE_GNO === "1"

const ALICE = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c" // DAO member, NOT in roster
const BOB = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" // total non-member
const CAROL = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq" // roster: dev,member
const DAVE = "g15unfxh9zfm75puw2lqmsun2lv8c397e0efkp2u" // roster: admin (role)

const DAO_PATH = "gno.land/r/samcrew/gate_dao_chn"

const DAO_CODE = generateDAOCode({
    name: "Channels Gate DAO",
    description: "W1.5 membership fixture",
    realmPath: DAO_PATH,
    members: [{ address: ALICE, power: 100, roles: ["admin", "member"] }],
    threshold: 60,
    roles: ["admin", "member"],
    quorum: 0,
    proposalCategories: ["governance"],
    votingPeriodBlocks: 151200,
})

// minPostInterval 0 keeps the rate limiter out of the way: every abort below
// is a MEMBERSHIP/ACL verdict, never a rate-limit false positive.
const CHANNELS_CODE = generateChannelCode({
    daoRealmPath: DAO_PATH,
    channelRealmPath: `${DAO_PATH}_channels`,
    name: "Gate Channels",
    description: "W1.5 membership fixture",
    channels: [
        { name: "general", type: "text", acl: { readRoles: [], writeRoles: [] } },
        { name: "devs", type: "text", acl: { readRoles: [], writeRoles: ["dev"] } },
        { name: "announcements", type: "announcements", acl: { readRoles: [], writeRoles: ["admin"] } },
    ],
    members: [
        { address: CAROL, roles: ["dev", "member"] },
        { address: DAVE, roles: ["admin"] },
    ],
    minPostInterval: 0,
    minTokenBalance: 0,
    tokenFactoryPath: "gno.land/r/samcrew/tokenfactory_v2",
    tokenSymbol: "",
    editWindowBlocks: 100,
})

/** White-box _test.gno (same package: can read adminAddr) proving each claim. */
const MEMBERSHIP_TEST_GNO = `package gate_dao_chn_channels

import "testing"

var (
\talice = testing.NewUserRealm(address("${ALICE}")) // DAO-only member
\tbob   = testing.NewUserRealm(address("${BOB}"))   // non-member
\tcarol = testing.NewUserRealm(address("${CAROL}")) // roster dev,member
\tdave  = testing.NewUserRealm(address("${DAVE}"))  // roster admin (role)
)

// mustAbort asserts fn panics/aborts. Plain recover() cannot catch a panic
// from a crossed realm call — gno's revive() builtin captures the abort value.
func mustAbort(t *testing.T, what string, fn func()) {
\tt.Helper()
\tif r := revive(fn); r == nil {
\t\tt.Fatalf("expected abort (%s), got none", what)
\t}
}

func TestSeededMemberPostsAndRoleGate(cur realm, t *testing.T) {
\ttesting.SetRealm(carol)
\tPostThread(cross(cur), "general", "hello", "from carol")
\tPostThread(cross(cur), "devs", "dev talk", "carol has the dev role")
}

func TestParentFallbackAdmitsLaterDAOMembers(cur realm, t *testing.T) {
\t// Alice is in the DAO's member tree but NOT in the channel roster: only
\t// the cross-realm parent.IsMember() fallback can admit her.
\ttesting.SetRealm(alice)
\tPostThread(cross(cur), "general", "hi", "alice via parent.IsMember")
\t// The fallback grants the DEFAULT role only — a dev-gated channel still
\t// refuses her, even though she is a DAO admin.
\tmustAbort(t, "fallback member posting to dev-gated channel", func() {
\t\tPostThread(cross(cur), "devs", "nope", "alice is not a dev here")
\t})
}

func TestNonMemberRejected(cur realm, t *testing.T) {
\ttesting.SetRealm(bob)
\tmustAbort(t, "non-member posting", func() {
\t\tPostThread(cross(cur), "general", "nope", "bob is nobody")
\t})
}

func TestAnnouncementsAdminOnly(cur realm, t *testing.T) {
\t// Ordinary roster member: refused.
\ttesting.SetRealm(carol)
\tmustAbort(t, "non-admin posting to announcements", func() {
\t\tPostThread(cross(cur), "announcements", "nope", "carol is not admin")
\t})
\t// Seeded admin-ROLE member: allowed (W1.5 — announcements is role-aware,
\t// not deployer-only).
\ttesting.SetRealm(dave)
\tPostThread(cross(cur), "announcements", "ship it", "dave has the admin role")
\t// The deployer (adminAddr captured at init) is always allowed.
\tif adminAddr == alice.Address() || adminAddr == bob.Address() {
\t\tt.Fatal("fixture collision: deployer address equals a test member")
\t}
\ttesting.SetRealm(testing.NewUserRealm(adminAddr))
\tPostThread(cross(cur), "announcements", "also ship it", "from the deployer")
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
        expect(GNO_AVAILABLE, "REQUIRE_GNO=1 but `gno` is not on PATH — the membership proof cannot run").toBe(true)
    }
})

const describeGno = GNO_AVAILABLE ? describe : describe.skip

if (!GNO_AVAILABLE && !REQUIRE_GNO) {
    console.warn("[channels.membership] SKIPPED — `gno` not on PATH. The authoritative run is CI's `Gno Test & Lint` job.")
}

describeGno("generated channels realm proves W1.5 membership under `gno test`", () => {
    let workdir: string

    beforeAll(() => {
        workdir = mkdtempSync(join(tmpdir(), "memba-chn-"))
    })

    it("roster seeding, parent.IsMember fallback and role gates behave on-chain", () => {
        const daoDir = join(workdir, "gate_dao_chn")
        mkdirSync(daoDir, { recursive: true })
        writeFileSync(join(daoDir, "gate_dao_chn.gno"), DAO_CODE)
        writeFileSync(join(daoDir, "gnomod.toml"), `module = "${DAO_PATH}"\ngno = "0.9"\n`)

        const chnDir = join(workdir, "gate_dao_chn_channels")
        mkdirSync(chnDir, { recursive: true })
        writeFileSync(join(chnDir, "gate_dao_chn_channels.gno"), CHANNELS_CODE)
        writeFileSync(join(chnDir, "gate_dao_chn_channels_test.gno"), MEMBERSHIP_TEST_GNO)
        writeFileSync(join(chnDir, "gnomod.toml"), `module = "${DAO_PATH}_channels"\ngno = "0.9"\n`)

        writeFileSync(join(workdir, "gnowork.toml"), "")
        vendorGnolandDeps(workdir, [DAO_CODE, CHANNELS_CODE, MEMBERSHIP_TEST_GNO])
        const gnohome = join(workdir, ".gnohome")
        mkdirSync(gnohome, { recursive: true })

        const res = spawnSync("gno", ["test", "-v", "./gate_dao_chn_channels"], {
            cwd: workdir,
            encoding: "utf8",
            env: { ...process.env, GNOHOME: gnohome },
        })
        const out = `${res.stdout ?? ""}${res.stderr ?? ""}`
        expect(res.status, `gno test failed:\n${out}`).toBe(0)
        for (const name of [
            "TestSeededMemberPostsAndRoleGate",
            "TestParentFallbackAdmitsLaterDAOMembers",
            "TestNonMemberRejected",
            "TestAnnouncementsAdminOnly",
        ]) {
            expect(out, `expected an explicit PASS for ${name}`).toContain(`--- PASS: ${name}`)
        }
    }, 180_000)

    it("cleanup", () => {
        rmSync(workdir, { recursive: true, force: true })
    })
})
