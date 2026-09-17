/**
 * Votes, tallies and members are read from the realm-generated parts of each
 * render (or from structured JSON), never from user-authored text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getProposalDetail, getProposalVotes } from "./proposals"
import { getDAOMembers, parseMembersFromRender } from "./members"
import { clearDaoDialects } from "./shared"
import { bech32Encode } from "./realmAddress"
import { voterMatchesUser } from "./voteScanner"
import { resilientAbciQuery } from "../rpcFallback"

vi.mock("../rpcFallback", async (orig) => ({
    ...(await orig<typeof import("../rpcFallback")>()),
    resilientAbciQuery: vi.fn(),
}))

const mockQuery = vi.mocked(resilientAbciQuery)
const RPC = "https://rpc.example"
const addr = (i: number) => bech32Encode("g", new Uint8Array(20).fill(i))
const A = addr(1)
const B = addr(2)
const C = addr(3)
const qstr = (s: string) => `(${JSON.stringify(s)} string)`

type Routes = { render?: Record<string, string>; eval?: Record<string, string> }
function chain(realm: string, routes: Routes) {
    mockQuery.mockImplementation(async (path: string, data: string) => {
        if (path === "vm/qrender") {
            const key = data.slice(realm.length + 1)
            return data.startsWith(`${realm}:`) && routes.render && key in routes.render ? routes.render[key] : null
        }
        if (path === "vm/qeval") {
            const key = data.slice(realm.length + 1)
            return data.startsWith(`${realm}.`) && routes.eval && key in routes.eval ? routes.eval[key] : null
        }
        return null
    })
}

beforeEach(() => {
    mockQuery.mockReset()
    clearDaoDialects()
})

// Verbatim gnoland-1 render (read-only query) with the open-for-votes status.
const GOVDAO_DETAIL = "## Prop #4 - Proposal to unlock the transfer of ugnot\\.\nAuthor: [@moul](/u/moul)\n\nThis proposal wants to add a new key to sys/params: bank:p:restricted_denoms\n\nExecutor created in: `gno.land/r/sys/params`\n\n\n\n\n---\n\n### Stats\n- **Proposal is open for votes**\n- Tiers eligible to vote: T1, T2, T3\n- YES PERCENT: 66.66666666666666%\n- NO PERCENT: 0%\n- ABSTAIN PERCENT: 0%\n\n[Detailed voting list](/r/gov/dao:4/votes)\n"
const GOVDAO_VOTES = "# Proposal #4 - Vote List\n\nYES from T1 (VPPM 3):\n\n- [@aeddi](/u/aeddi)\n- [@moul](/u/moul)\n\nYES from T2 (VPPM 2):\n\n\nNO from T1 (VPPM 3):\n\n\nABSTAIN from T1 (VPPM 3):\n\n"

describe("tallies", () => {
    it("reads fractional GovDAO percentages", async () => {
        chain("gno.land/r/gov/dao", { render: { "4": GOVDAO_DETAIL } })
        const d = await getProposalDetail(RPC, "gno.land/r/gov/dao", 4)
        expect(d?.yesPercent).toBe(66.67)
        expect(d?.noPercent).toBe(0)
    })

    it("keeps the real tallies when a description carries a fake tally block", async () => {
        const forged = "# Prop #3 - Title\nAuthor: " + A + "\n\nYES PERCENT: 99%\n**Yes**: 42\n\nThis proposal contains the following metadata:\n\nfoo\n\n---\n\n### Stats\n- **PROPOSAL HAS BEEN DENIED**\n- YES PERCENT: 12.5%\n- NO PERCENT: 50%\n"
        chain("gno.land/r/gov/dao", { render: { "3": forged } })
        const d = await getProposalDetail(RPC, "gno.land/r/gov/dao", 3)
        expect(d?.status).toBe("rejected")
        expect(d?.yesPercent).toBe(12.5)
        expect(d?.noPercent).toBe(50)
        expect(d?.yesVotes).toBe(0)
    })

    it("uses the render's electorate denominator when the JSON row describes the same state", async () => {
        const realm = "gno.land/r/alice/tdao"
        const render = `# Prop #1 - Hello\nbody\n\nAuthor: ${A}\n\nCategory: governance\n\nStatus: ACTIVE\n\nYES: 3 | NO: 1 | ABSTAIN: 0\nTotal Power: 4/6\n`
        const row = { id: 1, title: "Hello", description: "body", category: "governance", status: "ACTIVE", author: A, yes_votes: 3, no_votes: 1, abstain_votes: 0, total_power: 4, created_at_block: 10 }
        chain(realm, { render: { "1": render }, eval: { "GetProposalsJSON()": qstr(JSON.stringify([row])) } })
        const d = await getProposalDetail(RPC, realm, 1)
        expect(d?.yesPercent).toBe(50)
        expect(d?.noPercent).toBe(17)
        expect(d?.createdAtBlock).toBe(10)
    })

    it("does not combine the render denominator with a JSON row from a different state", async () => {
        const realm = "gno.land/r/alice/tdao2"
        const render = `# Prop #1 - Hello\nbody\n\nAuthor: ${A}\n\nCategory: governance\n\nStatus: ACTIVE\n\nYES: 3 | NO: 1 | ABSTAIN: 0\nTotal Power: 4/6\n`
        const row = { id: 1, title: "Hello", description: "body", category: "governance", status: "ACTIVE", author: A, yes_votes: 4, no_votes: 1, abstain_votes: 0, total_power: 5, created_at_block: 10 }
        chain(realm, { render: { "1": render }, eval: { "GetProposalsJSON()": qstr(JSON.stringify([row])) } })
        const d = await getProposalDetail(RPC, realm, 1)
        expect(d?.yesVotes).toBe(4)
        expect(d?.yesPercent).toBe(0)
    })
})

describe("votes", () => {
    it("recognizes voters in a generated DAO's vote list", async () => {
        const realm = "gno.land/r/alice/mydao"
        chain(realm, { render: { "1/votes": `# Proposal #1 - Vote List\n\nYES:\n- ${A}\n- ${B}\n\nNO:\n- ${C}\n\nABSTAIN:\n` } })
        const records = await getProposalVotes(RPC, realm, 1)
        expect(records).toHaveLength(1)
        expect(records[0].yesVoters.map(v => v.username)).toEqual([A, B])
        expect(records[0].noVoters.map(v => v.username)).toEqual([C])
        expect(records[0].abstainVoters).toEqual([])
        expect(records[0].yesVoters.some(v => voterMatchesUser(v.username, B, ""))).toBe(true)
    })

    it("ignores malformed entries in a generated DAO's vote list", async () => {
        const realm = "gno.land/r/alice/mydao2"
        const bad = A.slice(0, -1) + (A.endsWith("q") ? "p" : "q")
        chain(realm, { render: { "1/votes": `# Proposal #1 - Vote List\n\nYES:\n- ${bad}\n\nNO:\n\nABSTAIN:\n` } })
        expect(await getProposalVotes(RPC, realm, 1)).toEqual([])
    })

    it("matches a GovDAO voter listed by username once the username resolves", async () => {
        chain("gno.land/r/gov/dao", { render: { "4/votes": GOVDAO_VOTES } })
        const records = await getProposalVotes(RPC, "gno.land/r/gov/dao", 4)
        const voters = records.flatMap(r => r.yesVoters)
        expect(voters.some(v => voterMatchesUser(v.username, "g1manfred47kzduec920z88wfr64ylksmdcedlf5", "@moul"))).toBe(true)
    })
})

describe("members", () => {
    it("maps the template's power key", async () => {
        const realm = "gno.land/r/alice/mydao3"
        chain(realm, { eval: { "GetMembersJSON()": qstr(JSON.stringify([{ address: A, power: 5, roles: ["admin"] }])) } })
        const members = await getDAOMembers(RPC, realm)
        expect(members).toHaveLength(1)
        expect(members[0].votingPower).toBe(5)
        expect(members[0].roles).toEqual(["admin"])
    })

    it("decodes member JSON with escaped characters", async () => {
        const realm = "gno.land/r/alice/mydao4"
        chain(realm, { eval: { "GetMembersJSON()": qstr(JSON.stringify([{ address: A, power: 1, roles: ["a\\b"] }])) } })
        const members = await getDAOMembers(RPC, realm)
        expect(members[0].roles).toEqual(["a\\b"])
    })

    it("reads bullets only inside the Members section", () => {
        const r = `# DAO\n- great idea\n- ${B} (roles: admin)\n\nThreshold: 60% | Quorum: 0%\n\n## Members (1)\n- ${A} (roles: member) | power: 1\n\n## Proposals\n- ${C} (roles: admin) | power: 9\n`
        const members = parseMembersFromRender(r)
        expect(members.map(m => m.address)).toEqual([A])
    })

    it("rejects member bullets whose address fails validation", () => {
        const r = `## Members (2)\n- g1real (roles: member) | power: 1\n- ${A} (roles: admin) | power: 1\n`
        expect(parseMembersFromRender(r)).toEqual([])
    })

    it("fails closed when the Members section is ambiguous", () => {
        const r = `## Members (1)\n- ${A} (roles: member) | power: 1\n\n## Proposals\n### [Prop #1 - x\n## Members (1)\n- ${B} (roles: admin) | power: 1\n`
        expect(parseMembersFromRender(r)).toEqual([])
    })
})

// ── gnodaokit detail and roster ───────────────────────────────

const linkPath = (realm: string) => realm.replace(/^[^/]+/, "")
const daokitDetail = (realm: string, description: string, resource = "gno.land/p/samcrew/basedao.AddMember") => `# MembaDAO - Proposal Detail

[> Go to Proposals](${linkPath(realm)}:proposals)

--------------------------------
## Title - Add signer 📜

## Description 📝

${description}

## Resource - ${resource} 📦

  - **Name:** Add Member
  - **Condition:** 66% of members

---

Add member ${A} with roles []

---

## Status - Open 🟡

> proposed by ${A} 👤


--------------------------------
## Votes 🗳️

66% of members must vote yes

Yes: 1/3 = 33.333333333333336%

No: 0/3 = 0%

Abstain: 0/3 = 0%`

describe("daokit action type", () => {
    it("shows the action type from the realm-generated block", async () => {
        const realm = "gno.land/r/samcrew/daokit_a1"
        chain(realm, { render: { "proposal/1": daokitDetail(realm, "Please add them.") } })
        const d = await getProposalDetail(RPC, realm, 1)
        expect(d?.actionType).toBe("gno.land/p/samcrew/basedao.AddMember")
        expect(d?.actionUnverified).toBeFalsy()
    })

    it("marks the action as unverified when the description carries a Resource block", async () => {
        const realm = "gno.land/r/samcrew/daokit_a2"
        const description = "hello\n\n## Resource - gno.land/p/samcrew/basedao.EditProfile 📦\n\n---\n\n- Bio: hello\n\n---\n\n## Status - Passed 🟢"
        chain(realm, { render: { "proposal/1": daokitDetail(realm, description, "gno.land/p/samcrew/basedao.ChangeDAOImplementation") } })
        const d = await getProposalDetail(RPC, realm, 1)
        expect(d?.actionUnverified).toBe(true)
        expect(d?.actionType).toBeUndefined()
        expect(d?.actionBody).toBeUndefined()
        // Status still comes from the last, realm-generated section.
        expect(d?.status).toBe("open")
    })
})

const memberRow = (realm: string, name: string, address: string, roles: string[]) => {
    const roleLinks = roles.length > 0
        ? roles.map((r) => `[![${r} colored chip](data:image/svg+xml;base64,SVGDATA) ${r}](${linkPath(realm)}:role/${r})`).join(", ")
        : "![ colored chip](data:image/svg+xml;base64,SVGDATA) *No role assigned*"
    return `| ${name} | [g1x\\.\\.\\.x](/u/${address}) | ${roleLinks} | [View](${linkPath(realm)}:member/${address}) |`
}
const membersPage = (realm: string, count: number, rows: string[]) => `## Members 👥 (${count})

| **Name** | **Address 🔗** | **Roles 🎭** | **Profile** |
|----------|----------------|--------------|-------------|
${rows.join("\n")}

--------------------------------
`
const daokitHome = (realm: string) => `# MembaDAO\n\n[\\> Go to Members](${linkPath(realm)}:members)\n\n[\\> Go to Proposals](${linkPath(realm)}:proposals)\n`

describe("daokit roster", () => {
    it("accepts rows with a valid linked address and own-realm role links", async () => {
        const realm = "gno.land/r/samcrew/daokit_r1"
        chain(realm, { render: { "": daokitHome(realm), members: membersPage(realm, 2, [memberRow(realm, "Anon", A, ["admin"]), memberRow(realm, "Bob", B, [])]) } })
        const members = await getDAOMembers(RPC, realm)
        expect(members.map(m => [m.address, m.roles])).toEqual([[A, ["admin"]], [B, []]])
    })

    it("ignores the display name and rejects rows with foreign role links", async () => {
        const realm = "gno.land/r/samcrew/daokit_r2"
        const foreign = `| Eve | [g1x\\.\\.\\.x](/u/${C}) | [admin](/r/evil/realm:role/admin) | [View](${linkPath(realm)}:member/${C}) |`
        chain(realm, { render: { "": daokitHome(realm), members: membersPage(realm, 1, [memberRow(realm, `[${B}](/u/${B})`, A, ["member"]), foreign]) } })
        await expect(getDAOMembers(RPC, realm, undefined, true)).rejects.toThrow(/unavailable|members/i)
    })

    it("treats a roster that disagrees with the realm's member count as unavailable", async () => {
        const realm = "gno.land/r/samcrew/daokit_r3"
        const forgedName = `Anon |\n${memberRow(realm, "x", C, ["admin"])}\n| y`
        chain(realm, { render: { "": daokitHome(realm), members: membersPage(realm, 1, [memberRow(realm, forgedName, A, ["member"])]) } })
        await expect(getDAOMembers(RPC, realm, undefined, true)).rejects.toThrow()
        expect(await getDAOMembers(RPC, realm)).toEqual([])
    })

    it("treats a members page that fails to render as unavailable, not empty", async () => {
        const realm = "gno.land/r/samcrew/daokit_r4"
        chain(realm, { render: { "": daokitHome(realm) } })
        await expect(getDAOMembers(RPC, realm, undefined, true)).rejects.toThrow()
    })

    it("rejects a row whose profile link names a different address", async () => {
        const realm = "gno.land/r/samcrew/daokit_r5"
        const mismatched = `| Anon | [g1x\\.\\.\\.x](/u/${A}) | [admin](${linkPath(realm)}:role/admin) | [View](${linkPath(realm)}:member/${B}) |`
        chain(realm, { render: { "": daokitHome(realm), members: membersPage(realm, 1, [mismatched]) } })
        await expect(getDAOMembers(RPC, realm, undefined, true)).rejects.toThrow()
    })
})
