/**
 * W1.5 membership-unification proof — runs the GENERATED channels realm and its
 * GENERATED parent DAO as one workspace under the real gno test machine and
 * asserts the unified membership model actually behaves on-chain:
 *   - a wizard-SEEDED roster member can post, and their seeded roles satisfy a
 *     role-gated channel (dev-only)
 *   - a DAO member NOT in the roster is admitted via the cross-realm
 *     parent.IsMember() read — with the default "member" role, so a
 *     role-gated channel still refuses them
 *   - a complete non-member is rejected — including one holding a roster
 *     grant (grants are inert without live DAO membership)
 *   - announcements channels accept the deployer AND a seeded admin-ROLE
 *     member, and refuse ordinary members
 *   - REVOCATION IS LIVE (review finding #1): removing a member through the
 *     parent DAO's governance kills their channel access — roster roles and
 *     all — on the very next write attempt
 *
 * (The compile gate's negative control separately proves the cross-realm
 * dependency is real: unexporting the DAO's IsMember reddens this realm.)
 *
 * Requires `gno` on PATH (REQUIRE_GNO=1 in CI forbids the skip). Hermetic:
 * gno.land/p/* deps vendored from GNOROOT/examples, GNOHOME isolated.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateDAOCode } from "./daoTemplate"
import { generateChannelCode } from "./channelTemplate"
import { REQUIRE_GNO, probeToolchain, vendorGnolandDeps } from "../test/gnoToolchain"

const ALICE = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c" // DAO member, NOT in roster
const BOB = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" // total non-member (but roster-granted!)
const CAROL = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq" // DAO member + roster dev,member
const DAVE = "g15unfxh9zfm75puw2lqmsun2lv8c397e0efkp2u" // DAO member + roster admin (role)

const DAO_PATH = "gno.land/r/samcrew/gate_dao_chn"

// Alice's 70% alone clears the 60% threshold, so she can single-handedly pass
// the governance removal the revocation test drives. minExecutionDelay 0
// keeps ExecuteProposal immediate.
const DAO_CODE = generateDAOCode({
    name: "Channels Gate DAO",
    description: "W1.5 membership fixture",
    realmPath: DAO_PATH,
    members: [
        { address: ALICE, power: 70, roles: ["admin", "member"] },
        { address: CAROL, power: 20, roles: ["member"] },
        { address: DAVE, power: 10, roles: ["member"] },
    ],
    threshold: 60,
    roles: ["admin", "member"],
    quorum: 0,
    proposalCategories: ["governance", "membership"],
    votingPeriodBlocks: 151200,
    minExecutionDelayBlocks: 0,
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
        // Bob is NOT a DAO member: this grant must be inert (live-membership
        // gate) — the non-member test proves it can't admit him.
        { address: BOB, roles: ["dev"] },
    ],
    minPostInterval: 0,
    minTokenBalance: 0,
    tokenFactoryPath: "gno.land/r/samcrew/tokenfactory_v2",
    tokenSymbol: "",
    editWindowBlocks: 100,
})

/** White-box _test.gno (same package: can read adminAddr) proving each claim. */
const MEMBERSHIP_TEST_GNO = `package gate_dao_chn_channels

import (
\t"testing"

\tparent "${DAO_PATH}"
)

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

func TestNonMemberRejectedDespiteRosterGrant(cur realm, t *testing.T) {
\t// Bob holds a "dev" roster grant but is NOT a DAO member: the live
\t// parent.IsMember gate must refuse him everywhere — a grant alone can
\t// never admit anyone.
\ttesting.SetRealm(bob)
\tmustAbort(t, "non-member posting to general", func() {
\t\tPostThread(cross(cur), "general", "nope", "bob is nobody")
\t})
\tmustAbort(t, "non-member posting to dev-gated channel", func() {
\t\tPostThread(cross(cur), "devs", "nope", "grant without membership is inert")
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

// REVOCATION IS LIVE (review finding #1): a governance removal from the
// parent DAO must kill channel access on the very next write — roster roles
// included. MUST run last: it permanently removes carol from the DAO.
func TestDAORemovalRevokesChannelAccess(cur realm, t *testing.T) {
\t// Carol can post right now (roster dev + live DAO member).
\ttesting.SetRealm(carol)
\tPostThread(cross(cur), "devs", "still here", "pre-removal sanity")

\t// Alice (70% ≥ 60% threshold) governance-removes carol and executes.
\ttesting.SetRealm(alice)
\tid := parent.ProposeRemoveMember(cross(cur), carol.Address())
\tparent.VoteOnProposal(cross(cur), id, "YES")
\tparent.ExecuteProposal(cross(cur), id)
\tif parent.IsMember(carol.Address()) {
\t\tt.Fatal("fixture: DAO removal did not take effect")
\t}

\t// Her roster grant ("dev,member") is still in the tree — and must now be
\t// inert: no posting anywhere, not even plain-member channels.
\ttesting.SetRealm(carol)
\tmustAbort(t, "removed member posting to general", func() {
\t\tPostThread(cross(cur), "general", "nope", "carol was removed from the DAO")
\t})
\tmustAbort(t, "removed member posting to dev-gated channel", func() {
\t\tPostThread(cross(cur), "devs", "nope", "roster roles die with membership")
\t})
}
`

// Toolchain probe (shared, two-direction — see ../test/gnoToolchain). Catches a gno
// that is too OLD to lint interrealm-v2 AND one whose GNOROOT has drifted NEWER than
// CI's GNO_PIN; either way the membership proof below would be meaningless.
const TOOLCHAIN = probeToolchain()

it("gno toolchain is coherent when the gate is required (REQUIRE_GNO=1)", () => {
    if (REQUIRE_GNO) {
        expect(
            TOOLCHAIN.ok,
            `REQUIRE_GNO=1 but the gno toolchain cannot run the membership proof — ${TOOLCHAIN.message}\n${TOOLCHAIN.lines.join("\n")}`,
        ).toBe(true)
    }
})

const describeGno = TOOLCHAIN.ok ? describe : describe.skip

if (!TOOLCHAIN.ok && !REQUIRE_GNO) {
    console.warn(
        `[channels.membership] SKIPPED — ${TOOLCHAIN.message}\nThe authoritative run is CI's \`Gno Test & Lint\` job.` +
            (TOOLCHAIN.lines.length > 0 ? `\n${TOOLCHAIN.lines.join("\n")}` : ""),
    )
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
            "TestNonMemberRejectedDespiteRosterGrant",
            "TestAnnouncementsAdminOnly",
            "TestDAORemovalRevokesChannelAccess",
        ]) {
            expect(out, `expected an explicit PASS for ${name}`).toContain(`--- PASS: ${name}`)
        }
    }, 180_000)

    it("cleanup", () => {
        rmSync(workdir, { recursive: true, force: true })
    })
})
