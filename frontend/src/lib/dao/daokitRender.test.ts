/**
 * gnodaokit/basedao render-contract parsing (the deployed memba_dao realm).
 *
 * The sapphire `gno.land/r/samcrew/memba_dao` realm is gnodaokit basedao: its
 * Render("") is a LANDING page, and the actual data lives on sub-routes —
 * `:proposals` / `:history` (markdown tables), `:members` (markdown table),
 * `proposal/{id}` (detail). Its mux router also answers every unknown route
 * with a literal "404" body, which the old code treated as truthy render
 * output — so `getProposalDetail(1)` short-circuited on Render("1") = "404"
 * and dressed it up as a phantom empty "Proposal #1", and the correct
 * `proposal/1` fallback never ran.
 *
 * Fixtures marked CHAIN-CAPTURED are verbatim `vm/qrender` output from
 * rpc.sapphire.samourai.live (2026-08-27, SVG payloads elided); the table and
 * detail fixtures with proposals are synthesized character-for-character from
 * the DEPLOYED renderer sources (`vm/qfile` of p/samcrew/basedao utils.gno /
 * view_proposal_detail_page.gno, p/samcrew/daocond cond_members_threshold.gno,
 * p/samcrew/avl/pager pager.gno) because the live DAO currently has zero
 * proposals to capture. Landing/table fixtures are builders parameterized by
 * realm path because the daokit detection is anchored to the realm's OWN link
 * path — a foreign realm's ":proposals" link must not divert the read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { getDAOProposals, getProposalDetail, getProposalVotes, parseProposalList, fallbackProposalTitle, invalidateProposalCache } from "./proposals"
import { getDAOMembers, getMemberRole, parseMembersFromRender } from "./members"
import { queryRender, queryRenderPage, clearDaoDialects } from "./shared"
import { resilientAbciQuery } from "../rpcFallback"

vi.mock("../rpcFallback", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../rpcFallback")>()),
    resilientAbciQuery: vi.fn(),
}))

const mockQuery = vi.mocked(resilientAbciQuery)

const RPC = "https://rpc.example"

// ── Fixture builders ──────────────────────────────────────────

/** "gno.land/r/x/y" → "/r/x/y" (how the realm renders its own links). */
const linkPath = (realm: string) => realm.replace(/^[^/]+/, "")

/** CHAIN-CAPTURED shape: Render("") — the landing page. No proposals, no members. */
const daokitHome = (realm: string, over: { proposalsHref?: string; membersHref?: string } = {}) => `# MembaDAO

Community governance for the Memba ecosystem — multisig wallet & DAO platform on Gno

> Realm address: g1dmaqdpwr6xw6ukday0g66033j6ta4wc0r5ypf8

Discover more about this DAO on the [configuration page ⚙️](${linkPath(realm)}:config)


--------------------------------
[\\> Go to Members](${over.membersHref ?? `${linkPath(realm)}:members`})

[\\> Go to Proposals](${over.proposalsHref ?? `${linkPath(realm)}:proposals`})

`

/** CHAIN-CAPTURED shape: Render("proposals") with zero proposals. */
const daokitProposalsEmpty = (realm: string) => `# MembaDAO - Proposals

[\\> Go to the Proposal history 📜](${linkPath(realm)}:history)

[Add a new proposal 🗳️](${linkPath(realm)}$help)


--------------------------------
## Active Proposals 🗳️ (0)

\t⚠️ There are no proposals to show




--------------------------------
`

/** Synthesized from deployed RenderProposalsTable: two active proposals. */
const daokitProposalsTable = (realm: string) => `# MembaDAO - Proposals

[\\> Go to the Proposal history 📜](${linkPath(realm)}:history)

[Add a new proposal 🗳️](${linkPath(realm)}$help)


--------------------------------
## Active Proposals 🗳️ (2)

| **ID** | **Resource** | **Proposer** | **CreatedAt** | **Status** |
|--------|--------------|--------------|---------------|------------|
| [2](${linkPath(realm)}:proposal/2) | Add Member | [g1x7\\.\\.\\.uxu0](/u/g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0) | 2026-08-27 10:12:05 UTC+00:00 | Open |
| [1](${linkPath(realm)}:proposal/1) | Change DAO Implementation | [g1x7\\.\\.\\.uxu0](/u/g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0) | 2026-08-20 09:00:00 UTC+00:00 | Passed |


--------------------------------
`

/** Synthesized from deployed ProposalHistoryPageView: one executed proposal. */
const daokitHistoryTable = (realm: string) => `# MembaDAO - Proposal History

[\\> Go to the active Proposals 📃](${linkPath(realm)}:proposals)

[Add a new proposal 🗳️](${linkPath(realm)}$help)


--------------------------------
## Inactive Proposals 🗳️ (1)

| **ID** | **Resource** | **Proposer** | **CreatedAt** | **Status** |
|--------|--------------|--------------|---------------|------------|
| [3](${linkPath(realm)}:proposal/3) | Add Member | [g1qqq\\.\\.\\.zzz0](/u/g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzzz0) | 2026-08-01 12:00:00 UTC+00:00 | Executed |


--------------------------------
`

/** CHAIN-CAPTURED shape: Render("history") with zero proposals. */
const daokitHistoryEmpty = (realm: string) => `# MembaDAO - Proposal History

[\\> Go to the active Proposals 📃](${linkPath(realm)}:proposals)

[Add a new proposal 🗳️](${linkPath(realm)}$help)


--------------------------------
## Inactive Proposals 🗳️ (0)

\t⚠️ There are no proposals to show




--------------------------------
`

/** One members-table row (deployed RenderMembersTable shape). */
const memberRow = (realm: string, name: string, addr: string, roles: string[]) => {
    const roleLinks = roles.length > 0
        ? roles.map((r) => `[![${r} colored chip](data:image/svg+xml;base64,SVGDATA) ${r}](${linkPath(realm)}:role/${r})`).join(", ")
        : "![ colored chip](data:image/svg+xml;base64,SVGDATA) *No role assigned*"
    return `| ${name} | [g1x\\.\\.\\.x](/u/${addr}) | ${roleLinks} | [View](${linkPath(realm)}:member/${addr}) |`
}

/** CHAIN-CAPTURED shape: Render("members") — one member, two roles (SVGs elided). */
const daokitMembers = (realm: string) => `## Members 👥 (1)

| **Name** | **Address 🔗** | **Roles 🎭** | **Profile** |
|----------|----------------|--------------|-------------|
${memberRow(realm, "Anon", "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0", ["admin", "dev"])}



## Roles distribution:
![Pie Chart Roles distribution:](data:image/svg+xml;base64,SVGDATA)
--------------------------------
`

/** A members page with a pager (page 1 of 3; Picker shape from deployed pager.gno). */
const membersPage = (realm: string, page: number, rows: string[], picker: string) => `## Members 👥 (21)

| **Name** | **Address 🔗** | **Roles 🎭** | **Profile** |
|----------|----------------|--------------|-------------|
${rows.join("\n")}

${picker}

--------------------------------
`

/** Synthesized from deployed ProposalDetailPageView + membersThresholdCond. */
const daokitDetail = (
    realm: string,
    opts: {
        status?: string
        statusEmoji?: string
        description?: string
        resourceType?: string
        actionBody?: string
        votes?: string
    } = {},
) => `# MembaDAO - Proposal Detail

[> Go to Proposals](${linkPath(realm)}:proposals)

--------------------------------
## Title - Add treasury signer 📜

## Description 📝

${opts.description ?? "Bring the ops multisig into the signer set."}

## Resource - ${opts.resourceType ?? "basedao-add-member"} 📦

  - **Name:** Add Member
  - **Description:** Adds a new member to the DAO
  - **Condition:** 66% of members

---

${opts.actionBody ?? "Add member g1newmemberaddrxxxxxxxxxxxxxxxxxxxxxxx with roles []"}

---

## Status - ${opts.status ?? "Open"} ${opts.statusEmoji ?? "🟡"}

[Approve this proposal 🗳️](${linkPath(realm)}$help&func=Vote&proposalID=1&vote=yes)

0.333333
> proposed by g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0 👤


--------------------------------
## Votes 🗳️

${opts.votes ?? `66% of members must vote yes

Yes: 1/3 = 33.333333333333336%

No: 0/3 = 0%

Abstain: 0/3 = 0%`}



--------------------------------
`

/** Route a mocked qrender data string ("pkgpath:renderpath") to a fixture. */
function renderRouter(realm: string, pages: Record<string, string | null>) {
    return async (path: string, data: string) => {
        if (path === "vm/qeval") return null // no JSON exports on this realm
        if (path === "vm/qrender") {
            const [pkg, renderPath] = String(data).split(/:(.*)/s)
            if (pkg !== realm) return null // e.g. username registry lookups
            if (renderPath! in pages) return pages[renderPath!]
            return "404" // the mux router's literal not-found body
        }
        return null
    }
}

/** All qrender render-paths requested of a realm so far. */
function renderPathsFor(realm: string): string[] {
    return mockQuery.mock.calls
        .filter(([p, d]) => p === "vm/qrender" && String(d).startsWith(`${realm}:`))
        .map(([, d]) => String(d).split(/:(.*)/s)[1]!)
}

beforeEach(() => {
    mockQuery.mockReset()
    clearDaoDialects()
})

// ── queryRender vs queryRenderPage: the mux "404" body ────────

describe("mux-404 handling", () => {
    it('queryRender passes a literal "404" body through — a deployment probe must see it as a REAL answer', async () => {
        mockQuery.mockResolvedValue("404")
        expect(await queryRender(RPC, "gno.land/r/x/daokit404", "")).toBe("404")
    })

    it('queryRenderPage treats a literal "404" body as null so fallback chains proceed', async () => {
        mockQuery.mockResolvedValue("404")
        expect(await queryRenderPage(RPC, "gno.land/r/x/daokit404b", "1")).toBeNull()
    })

    it("queryRenderPage passes ordinary render bodies through untouched", async () => {
        mockQuery.mockResolvedValue("# A page mentioning 404 in prose")
        expect(await queryRenderPage(RPC, "gno.land/r/x/daokit404c", "")).toBe(
            "# A page mentioning 404 in prose",
        )
    })
})

// ── parseProposalList: daokit table rows ──────────────────────

describe("parseProposalList daokit table leg", () => {
    const realm = "gno.land/r/samcrew/memba_dao"

    it("parses table rows: id, resource-as-title (flagged placeholder), proposer address, createdAt, status", () => {
        const rows = parseProposalList(daokitProposalsTable(realm))
        expect(rows).toHaveLength(2)
        expect(rows[0]).toMatchObject({
            id: 2,
            title: "Add Member",
            titleIsPlaceholder: true,
            status: "open",
            author: "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0",
            proposer: "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0",
        })
        expect(rows[0].createdAt).toBe("2026-08-27T10:12:05+00:00")
        expect(rows[1]).toMatchObject({ id: 1, title: "Change DAO Implementation", status: "passed" })
    })

    it("parses the executed history row", () => {
        const rows = parseProposalList(daokitHistoryTable(realm))
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ id: 3, status: "executed" })
    })

    it("finds nothing on the empty-state page", () => {
        expect(parseProposalList(daokitProposalsEmpty(realm))).toHaveLength(0)
    })

    it("finds nothing on the landing page", () => {
        expect(parseProposalList(daokitHome(realm))).toHaveLength(0)
    })
})

// ── parseMembersFromRender: daokit members table ──────────────

describe("parseMembersFromRender daokit table leg", () => {
    const realm = "gno.land/r/samcrew/memba_dao"

    it("parses the members table: full address from the /u/ link, roles from :role/ links", () => {
        const members = parseMembersFromRender(daokitMembers(realm))
        expect(members).toHaveLength(1)
        expect(members[0].address).toBe("g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0")
        expect(members[0].roles).toEqual(["admin", "dev"])
    })

    it("still parses the legacy bullet format (regression)", () => {
        const members = parseMembersFromRender("- g1abc (roles: admin) | power: 3\n- g1def\n")
        expect(members).toHaveLength(2)
        expect(members[0]).toMatchObject({ address: "g1abc", roles: ["admin"], votingPower: 3 })
    })

    it("bullets win over an injected table-shaped string (legacy realms keep their authentic roster)", () => {
        const injected = memberRow("gno.land/r/x/legacy", "Evil", "g1attackerxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", ["owner"])
        const members = parseMembersFromRender(`- g1realmember (roles: admin)\n\nBio: ${injected}\n`)
        expect(members).toHaveLength(1)
        expect(members[0].address).toBe("g1realmember")
    })
})

// ── getDAOProposals: landing → :proposals + :history ──────────

describe("getDAOProposals daokit fallthrough", () => {
    it("follows the landing page to :proposals and :history and merges both tables", async () => {
        const realm = "gno.land/r/samcrew/daokit_p1"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                proposals: daokitProposalsTable(realm),
                history: daokitHistoryTable(realm),
            }),
        )

        const proposals = await getDAOProposals(RPC, realm, true)

        expect(proposals.map((p) => p.id)).toEqual([3, 2, 1]) // sorted desc
        expect(proposals.find((p) => p.id === 3)?.status).toBe("executed")
        expect(proposals.find((p) => p.id === 2)?.status).toBe("open")
    })

    it("returns [] (not an error) when both sub-pages are genuinely empty", async () => {
        const realm = "gno.land/r/samcrew/daokit_p2"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                proposals: daokitProposalsEmpty(realm),
                history: daokitHistoryEmpty(realm),
            }),
        )

        expect(await getDAOProposals(RPC, realm, true)).toHaveLength(0)
    })

    it("does not probe sub-pages for realms whose root already lists proposals (GovDAO)", async () => {
        const realm = "gno.land/r/gov/daokit_p3"
        const govdaoRoot = `# GovDAO

### [Prop #42 - Add validator node alpha](/r/gov/dao:42)
Author: [@zooma](https://gno.land/u/zooma)
Status: ACTIVE
`
        mockQuery.mockImplementation(renderRouter(realm, { "": govdaoRoot }))

        const proposals = await getDAOProposals(RPC, realm, true)
        expect(proposals.map((p) => p.id)).toEqual([42])
        expect(renderPathsFor(realm)).not.toContain("proposals")
        expect(renderPathsFor(realm)).not.toContain("history")
    })

    it("ignores a FOREIGN realm's :proposals link — only the realm's own link marks it daokit", async () => {
        const realm = "gno.land/r/samcrew/daokit_p4"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm, { proposalsHref: "/r/other/dao:proposals", membersHref: "/r/other/dao:members" }),
            }),
        )

        expect(await getDAOProposals(RPC, realm, true)).toHaveLength(0)
        expect(renderPathsFor(realm)).not.toContain("proposals")
    })

    it("strict caller sees an error when the advertised :proposals page cannot be read", async () => {
        const realm = "gno.land/r/samcrew/daokit_p5"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                // no "proposals"/"history" entries → router answers "404" → null
            }),
        )

        await expect(getDAOProposals(RPC, realm, true)).rejects.toThrow(
            "Failed to read the DAO's proposals page",
        )
    })

    it("a missing follow-up PAGE marks the list incomplete — it is not cached as the whole history", async () => {
        const realm = "gno.land/r/samcrew/daokit_p7"
        const proposalRow = (id: number) =>
            `| [${id}](/r/samcrew/daokit_p7:proposal/${id}) | Add Member | [g1x7\\.\\.\\.uxu0](/u/g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0) | 2026-08-27 10:12:05 UTC+00:00 | Open |`
        const tableHead = `| **ID** | **Resource** | **Proposer** | **CreatedAt** | **Status** |\n|--------|--------------|--------------|---------------|------------|`
        const page1 = `# MembaDAO - Proposals\n\n## Active Proposals 🗳️ (11)\n\n${tableHead}\n${Array.from({ length: 10 }, (_, i) => proposalRow(11 - i)).join("\n")}\n\n**1** | [2](?page=2)\n`
        const page2 = `# MembaDAO - Proposals\n\n## Active Proposals 🗳️ (11)\n\n${tableHead}\n${proposalRow(1)}\n\n[1](?page=1) | **2**\n`

        // First call: page 2 unreachable → 10 rows, NOT cached as complete.
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                proposals: page1,
                history: daokitHistoryEmpty(realm),
            }),
        )
        expect(await getDAOProposals(RPC, realm, false)).toHaveLength(10)

        // Second call within the TTL: page 2 now answers — a cached truncated
        // list would mask row #1.
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                proposals: page1,
                "proposals?page=2": page2,
                history: daokitHistoryEmpty(realm),
            }),
        )
        expect(await getDAOProposals(RPC, realm, false)).toHaveLength(11)
    })

    it("a transiently-failed sub-read is NOT cached — the next call re-fetches and sees the data", async () => {
        const realm = "gno.land/r/samcrew/daokit_p6"
        // First call: proposals page unreadable (non-strict → []).
        mockQuery.mockImplementation(renderRouter(realm, { "": daokitHome(realm) }))
        expect(await getDAOProposals(RPC, realm, false)).toHaveLength(0)

        // Second call within the cache TTL: pages now readable — a cached []
        // would mask them.
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                proposals: daokitProposalsTable(realm),
                history: daokitHistoryEmpty(realm),
            }),
        )
        expect((await getDAOProposals(RPC, realm, false)).map((p) => p.id)).toEqual([2, 1])
    })
})

// ── getDAOMembers / getMemberRole: landing → :members ─────────

describe("getDAOMembers daokit fallthrough", () => {
    it("follows the landing page to :members and parses the table", async () => {
        const realm = "gno.land/r/samcrew/daokit_m1"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                members: daokitMembers(realm),
            }),
        )

        const members = await getDAOMembers(RPC, realm)

        expect(members).toHaveLength(1)
        expect(members[0].address).toBe("g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0")
        expect(members[0].roles).toEqual(["admin", "dev"])
    })

    it("fetches ALL pager pages in parallel off the max-page scan (a next-link walk would stop at page 2)", async () => {
        const realm = "gno.land/r/samcrew/daokit_m2"
        const addr = (i: number) => `g1member${String(i).padStart(32, "0")}`
        const rows = (from: number, to: number) =>
            Array.from({ length: to - from + 1 }, (_, k) => memberRow(realm, `M${from + k}`, addr(from + k), ["member"]))
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                // Deployed Picker shapes: page 1 leads with **1**; page 2+ lead
                // with the BACK-link [1](?page=1) — the case that broke a
                // sequential next-link walk.
                members: membersPage(realm, 1, rows(1, 10), "**1** | [2](?page=2) | [3](?page=3)"),
                "members?page=2": membersPage(realm, 2, rows(11, 20), "[1](?page=1) | **2** | [3](?page=3)"),
                "members?page=3": membersPage(realm, 3, rows(21, 21), "[1](?page=1) | [2](?page=2) | **3**"),
            }),
        )

        const members = await getDAOMembers(RPC, realm)
        expect(members).toHaveLength(21)
        expect(members.map((m) => m.address)).toContain(addr(21))
    })

    it("a failed :members read is a FAILURE, not an empty roster: strict throws, non-strict returns []", async () => {
        const realm = "gno.land/r/samcrew/daokit_m4"
        // Landing advertises :members, but the route answers 404 → null.
        mockQuery.mockImplementation(renderRouter(realm, { "": daokitHome(realm) }))

        await expect(getDAOMembers(RPC, realm, undefined, true)).rejects.toThrow(
            "Failed to read the DAO's members page",
        )
        expect(await getDAOMembers(RPC, realm)).toEqual([])
    })

    it("getMemberRole finds a daokit member's roles via the same hop (the 'your worlds' badge path)", async () => {
        const realm = "gno.land/r/samcrew/daokit_m3"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                members: daokitMembers(realm),
            }),
        )

        const role = await getMemberRole(RPC, realm, "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0")
        expect(role).not.toBeNull()
        expect(role!.roles).toEqual(["admin", "dev"])

        const nonMember = await getMemberRole(RPC, realm, "g1nobody00000000000000000000000000000000")
        expect(nonMember).toBeNull()
    })
})

// ── getProposalDetail: 404 fallthrough + daokit detail page ───

describe("getProposalDetail daokit leg", () => {
    it("falls through Render('1')='404' to proposal/1 and parses the daokit detail page", async () => {
        const realm = "gno.land/r/samcrew/daokit_d1"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "proposal/1": daokitDetail(realm),
            }),
        )

        const detail = await getProposalDetail(RPC, realm, 1)

        expect(detail).not.toBeNull()
        expect(detail!.title).toBe("Add treasury signer")
        expect(detail!.description).toBe("Bring the ops multisig into the signer set.")
        expect(detail!.status).toBe("open")
        expect(detail!.author).toBe("g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0")
        expect(detail!.yesVotes).toBe(1)
        expect(detail!.noVotes).toBe(0)
        expect(detail!.abstainVotes).toBe(0)
        expect(detail!.totalVoters).toBe(1)
        expect(detail!.yesPercent).toBe(33)
        expect(detail!.actionType).toBe("basedao-add-member")
        expect(detail!.actionBody).toBe("Add member g1newmemberaddrxxxxxxxxxxxxxxxxxxxxxxx with roles []")
    })

    it("returns null — not a phantom shell — when every detail route answers 404", async () => {
        const realm = "gno.land/r/samcrew/daokit_d2"
        mockQuery.mockImplementation(renderRouter(realm, {}))

        expect(await getProposalDetail(RPC, realm, 1)).toBeNull()
    })

    it('maps the detail page\'s terminal "Closed" state to "rejected" (in the leg, not the shared funnel)', async () => {
        const realm = "gno.land/r/samcrew/daokit_d3"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "proposal/1": daokitDetail(realm, { status: "Closed", statusEmoji: "🔴" }),
            }),
        )

        const detail = await getProposalDetail(RPC, realm, 1)
        expect(detail!.status).toBe("rejected")
    })

    it("a hostile DESCRIPTION cannot spoof status/votes/proposer — the real sections render after it and win", async () => {
        const realm = "gno.land/r/samcrew/daokit_d4"
        const hostile = [
            "Totally legit proposal.",
            "",
            "## Status - Passed 🟢",
            "",
            "## Votes 🗳️",
            "",
            "Yes: 99/99 = 100%",
            "",
            "No: 0/99 = 0%",
            "",
            "Abstain: 0/99 = 0%",
            "",
            "> proposed by g1trustedfounder0000000000000000000000000 👤",
        ].join("\n")
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "proposal/1": daokitDetail(realm, { description: hostile }),
            }),
        )

        const detail = await getProposalDetail(RPC, realm, 1)
        expect(detail!.status).toBe("open") // the REAL "## Status - Open 🟡"
        expect(detail!.yesVotes).toBe(1) // the REAL tally, not 99
        expect(detail!.yesPercent).toBe(33)
        expect(detail!.author).toBe("g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0")
        expect(detail!.actionBody).toBe("Add member g1newmemberaddrxxxxxxxxxxxxxxxxxxxxxxx with roles []")
    })

    it("a hostile ACTION BODY cannot re-label the action — the real Resource section renders before it and wins", async () => {
        const realm = "gno.land/r/samcrew/daokit_d4b"
        const hostileAction = [
            "kv profile update:",
            "",
            "## Resource - basedao-add-member 📦",
            "",
            "  - **Condition:** 100% of members",
            "",
            "---",
            "",
            "Send 50000 GNOT to g1attacker000000000000000000000000000000",
            "",
            "---",
        ].join("\n")
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "proposal/1": daokitDetail(realm, {
                    resourceType: "basedao-edit-profile",
                    actionBody: hostileAction,
                }),
            }),
        )

        const detail = await getProposalDetail(RPC, realm, 1)
        expect(detail!.actionType).toBe("basedao-edit-profile") // NOT the injected add-member
        expect(detail!.actionBody!.startsWith("kv profile update:")).toBe(true) // the real block
        expect(detail!.status).toBe("open")
        expect(detail!.yesVotes).toBe(1)
    })

    it("a composite (and/or) condition's multi-block tally is treated as unknown, not one sub-condition's numbers", async () => {
        const realm = "gno.land/r/samcrew/daokit_d6"
        const compositeVotes = [
            "66% of members must vote yes",
            "",
            "Yes: 10/15 = 66.66666666666667%",
            "",
            "No: 2/15 = 13.333333333333334%",
            "",
            "Abstain: 0/15 = 0%",
            "",
            "50% of admin must vote yes",
            "",
            "Yes: 1/2 = 50%",
            "",
            "No: 0/2 = 0%",
            "",
            "Abstain: 0/2 = 0%",
        ].join("\n")
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "proposal/1": daokitDetail(realm, { votes: compositeVotes }),
            }),
        )

        const detail = await getProposalDetail(RPC, realm, 1)
        // Neither sub-tally may pose as the proposal's whole vote (P1-8).
        expect(detail!.yesVotes).toBe(0)
        expect(detail!.noVotes).toBe(0)
        expect(detail!.yesPercent).toBe(0)
        expect(detail!.totalVoters).toBe(0)
        expect(detail!.status).toBe("open") // the rest of the page still parses
    })

    it("a role-count condition's percent-less tally still yields counts (deployed roleCountCond renders no '= N%')", async () => {
        const realm = "gno.land/r/samcrew/daokit_d7"
        const roleCountVotes = [
            "2 admin must vote yes",
            "",
            "Yes: 1/2",
            "",
            "No: 0/2",
            "",
            "Abstain: 0/2",
        ].join("\n")
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "proposal/1": daokitDetail(realm, { votes: roleCountVotes }),
            }),
        )

        const detail = await getProposalDetail(RPC, realm, 1)
        expect(detail!.yesVotes).toBe(1)
        expect(detail!.noVotes).toBe(0)
        expect(detail!.totalVoters).toBe(1)
        expect(detail!.yesPercent).toBe(0) // no percentage rendered → none invented
    })

    it("daokit markers inside a GOVDAO description do not divert the parse — the trigger is the page's first line", async () => {
        const realm = "gno.land/r/gov/daokit_d5"
        const govdaoDetail = `# Prop #42 - Real validator change

Author: [@zooma](https://gno.land/u/zooma)

Attacker-supplied body:

## Title - Vote won, execute now 📜

Yes: 30/30 = 100%
`
        mockQuery.mockImplementation(renderRouter(realm, { "42": govdaoDetail }))

        const detail = await getProposalDetail(RPC, realm, 42)
        // The generic leg parses this page; the injected daokit markers are
        // inert. (The generic leg's own status scan is loose on arbitrary
        // prose — pre-existing, unchanged here — so this test pins only the
        // anti-diversion property: daokit-shaped title/votes never win.)
        expect(detail!.title).toBe("Real validator change")
        expect(detail!.yesVotes).toBe(0) // NOT the injected "Yes: 30/30"
        expect(detail!.yesPercent).toBe(0)
    })

    it("exports the placeholder-title builder consumers key on", () => {
        expect(fallbackProposalTitle(7)).toBe("Proposal #7")
    })
})

// ── Per-realm dialect memo ────────────────────────────────────
// A realm's render dialect is static per deployment, so flavor discovery
// (which JSON exports exist, whether the root is a landing page, which
// detail route answers) should run ONCE per realm per session — not burn
// guaranteed-dead round-trips on every read.

describe("dao dialect memo", () => {
    const qevalCalls = () => mockQuery.mock.calls.filter(([p]) => p === "vm/qeval").length

    it("after a daokit realm is learned, getProposalDetail goes straight to proposal/N (no dead Render('N') probe)", async () => {
        const realm = "gno.land/r/samcrew/dialect_1"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                proposals: daokitProposalsTable(realm),
                history: daokitHistoryEmpty(realm),
                "proposal/1": daokitDetail(realm),
            }),
        )

        await getDAOProposals(RPC, realm, true) // learns "daokit"
        mockQuery.mockClear()

        const detail = await getProposalDetail(RPC, realm, 1)
        expect(detail!.title).toBe("Add treasury signer")
        const paths = renderPathsFor(realm)
        expect(paths[0]).toBe("proposal/1")
        expect(paths).not.toContain("1")
    })

    it("after a daokit realm is learned, getProposalVotes makes ZERO calls (the realm has no votes route)", async () => {
        const realm = "gno.land/r/samcrew/dialect_2"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                proposals: daokitProposalsTable(realm),
                history: daokitHistoryEmpty(realm),
            }),
        )

        await getDAOProposals(RPC, realm, true) // learns "daokit"
        mockQuery.mockClear()

        expect(await getProposalVotes(RPC, realm, 2)).toEqual([])
        expect(mockQuery.mock.calls.length).toBe(0)
    })

    it("after a daokit realm is learned, getDAOMembers skips the JSON probe and the landing page", async () => {
        const realm = "gno.land/r/samcrew/dialect_3"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                proposals: daokitProposalsEmpty(realm),
                history: daokitHistoryEmpty(realm),
                members: daokitMembers(realm),
            }),
        )

        await getDAOProposals(RPC, realm, true) // learns "daokit"
        mockQuery.mockClear()

        const members = await getDAOMembers(RPC, realm)
        expect(members).toHaveLength(1)
        expect(qevalCalls()).toBe(0)
        const paths = renderPathsFor(realm)
        expect(paths).not.toContain("")
        expect(paths[0]).toBe("members")
    })

    it("after a daokit realm is learned, list reads skip the JSON probe and the landing page too", async () => {
        const realm = "gno.land/r/samcrew/dialect_4"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                proposals: daokitProposalsTable(realm),
                history: daokitHistoryEmpty(realm),
            }),
        )

        await getDAOProposals(RPC, realm, true) // learns
        invalidateProposalCache(realm) // bust the list cache, keep the dialect
        mockQuery.mockClear()

        const proposals = await getDAOProposals(RPC, realm, true)
        expect(proposals.map((p) => p.id)).toEqual([2, 1])
        expect(qevalCalls()).toBe(0)
        expect(renderPathsFor(realm)).not.toContain("")
    })

    it("negative probe evidence is NEVER memoized: root-listing realms keep probing (a null probe is transport-vs-panic ambiguous)", async () => {
        const realm = "gno.land/r/gov/dialect_5"
        const govdaoRoot = `# GovDAO

### [Prop #42 - Add validator node alpha](/r/gov/dao:42)
Author: [@zooma](https://gno.land/u/zooma)
Status: ACTIVE
`
        mockQuery.mockImplementation(renderRouter(realm, { "": govdaoRoot }))

        await getDAOProposals(RPC, realm, true)
        invalidateProposalCache(realm)
        mockQuery.mockClear()

        const proposals = await getDAOProposals(RPC, realm, true)
        expect(proposals.map((p) => p.id)).toEqual([42])
        // Latching "root" off one null probe could freeze a JSON realm onto
        // the markdown path (zeroed tallies) after a single transport blip —
        // so the probe must keep running.
        expect(qevalCalls()).toBe(1)
    })

    it("one transient probe blip never freezes a JSON realm off its endpoint", async () => {
        const realm = "gno.land/r/samcrew/dialect_5b"
        const QEVAL_JSON = `(${JSON.stringify(JSON.stringify([{ id: 7, title: "From JSON", status: "active", yes_votes: 5 }]))} string)`
        let qevalUp = true
        mockQuery.mockImplementation(async (path: string, data: string) => {
            if (path === "vm/qeval") return qevalUp ? QEVAL_JSON : null
            // While the probe is down, the render side serves a daokit-shaped
            // landing + tables (worst case for a mis-latch).
            return renderRouter(realm, {
                "": daokitHome(realm),
                proposals: daokitProposalsTable(realm),
                history: daokitHistoryEmpty(realm),
            })(path, data)
        })

        expect((await getDAOProposals(RPC, realm, true))[0].title).toBe("From JSON") // memo "json"
        invalidateProposalCache(realm)

        qevalUp = false // one blip: read falls to the render path…
        await getDAOProposals(RPC, realm, true)
        invalidateProposalCache(realm)

        qevalUp = true // …but the memo must NOT have been downgraded:
        mockQuery.mockClear()
        const back = await getDAOProposals(RPC, realm, true)
        expect(qevalCalls()).toBe(1) // probed again
        expect(back[0].title).toBe("From JSON")
        expect(back[0].yesVotes).toBe(5) // structured tallies, not markdown zeros
    })

    it("a daokit memo mis-learned from the MEMBERS side self-heals on the next proposals read", async () => {
        const realm = "gno.land/r/samcrew/dialect_5c"
        const QEVAL_PROPOSALS = `(${JSON.stringify(JSON.stringify([{ id: 3, title: "Real one", status: "active" }]))} string)`
        mockQuery.mockImplementation(async (path: string, data: string) => {
            if (path === "vm/qeval") {
                // GetMembersJSON fails; GetProposalsJSON works.
                return String(data).includes("GetProposalsJSON") ? QEVAL_PROPOSALS : null
            }
            // Landing links its own :members (so the members side memos
            // "daokit") but the realm serves NO :proposals route.
            return renderRouter(realm, {
                "": daokitHome(realm),
                members: daokitMembers(realm),
            })(path, data)
        })

        await getDAOMembers(RPC, realm) // memos "daokit" from the members link
        const proposals = await getDAOProposals(RPC, realm, true)
        expect(proposals.map((p) => p.id)).toEqual([3]) // healed to the JSON endpoint
    })

    it("the discovery recovery forgets the memo so votes are not shortcut for root-parsed rows", async () => {
        const realm = "gno.land/r/samcrew/dialect_5d"
        // Landing links its own :proposals, but the route is dead and the ROOT
        // itself lists proposals GovDAO-style (the legacy hybrid class).
        const hybridRoot = daokitHome(realm) + `
### [Prop #9 - Hybrid realm proposal](/r/x:9)
Author: [@zooma](https://gno.land/u/zooma)
Status: ACTIVE
`
        mockQuery.mockImplementation(renderRouter(realm, { "": hybridRoot }))

        const proposals = await getDAOProposals(RPC, realm, false)
        expect(proposals.map((p) => p.id)).toEqual([9])

        mockQuery.mockClear()
        await getProposalVotes(RPC, realm, 9)
        // The votes read must actually TRY the routes (no zero-call daokit
        // shortcut) — these rows came from the root listing.
        expect(mockQuery.mock.calls.length).toBeGreaterThan(0)
    })

    it("a stale daokit memo self-heals when the realm now answers with junk (redeploy)", async () => {
        const realm = "gno.land/r/samcrew/dialect_5e"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                proposals: daokitProposalsTable(realm),
                history: daokitHistoryEmpty(realm),
            }),
        )
        await getDAOProposals(RPC, realm, true) // memo "daokit"
        invalidateProposalCache(realm)

        // Redeployed: now a root-listing realm; unknown routes answer truthy
        // junk, NOT the literal mux "404".
        const govdaoRoot = `# Reborn DAO

### [Prop #1 - First after redeploy](/r/x:1)
Author: [@zooma](https://gno.land/u/zooma)
Status: ACTIVE
`
        mockQuery.mockImplementation(async (path: string, data: string) => {
            if (path === "vm/qeval") return null
            const renderPath = String(data).split(/:(.*)/s)[1]
            if (renderPath === "") return govdaoRoot
            return "# Not Found\n\nno such page\n"
        })

        const proposals = await getDAOProposals(RPC, realm, true)
        expect(proposals.map((p) => p.id)).toEqual([1]) // rediscovered, not an error/empty
    })

    it("the reordered detail fetch is shape-gated: junk at proposal/N cannot become a phantom detail", async () => {
        const realm = "gno.land/r/samcrew/dialect_5f"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                proposals: daokitProposalsTable(realm),
                history: daokitHistoryEmpty(realm),
            }),
        )
        await getDAOProposals(RPC, realm, true) // memo "daokit"

        // Redeployed to a GovDAO-style realm: proposal/N answers junk,
        // Render("N") serves the real detail.
        mockQuery.mockImplementation(async (path: string, data: string) => {
            if (path === "vm/qeval") return null
            const renderPath = String(data).split(/:(.*)/s)[1]
            if (renderPath === "42") {
                return "### Prop #42 - The real detail\nAuthor: g1zoomazoomazoomazoomazoomazoomazoom00\nStatus: ACTIVE\n"
            }
            return "# Not Found\n\nno such page\n"
        })

        const detail = await getProposalDetail(RPC, realm, 42)
        expect(detail!.title).toBe("The real detail")
        expect(detail!.title).not.toContain("Not Found")
    })

    it("unknown realms keep the current discovery order (detail tries Render('N') first)", async () => {
        const realm = "gno.land/r/samcrew/dialect_6"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "proposal/1": daokitDetail(realm),
            }),
        )

        const detail = await getProposalDetail(RPC, realm, 1)
        expect(detail!.title).toBe("Add treasury signer")
        expect(renderPathsFor(realm)[0]).toBe("1") // probe order unchanged without a memo
    })

    it("getMemberRole uses the memo the same way getDAOMembers does", async () => {
        const realm = "gno.land/r/samcrew/dialect_7"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                proposals: daokitProposalsEmpty(realm),
                history: daokitHistoryEmpty(realm),
                members: daokitMembers(realm),
            }),
        )

        await getDAOProposals(RPC, realm, true) // learns "daokit"
        mockQuery.mockClear()

        const role = await getMemberRole(RPC, realm, "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0")
        expect(role!.roles).toEqual(["admin", "dev"])
        expect(qevalCalls()).toBe(0)
        expect(renderPathsFor(realm)).not.toContain("")
    })

    it("a strict daokit read whose sub-pages fail still surfaces an error (via rediscovery, not a stale-memo throw)", async () => {
        const realm = "gno.land/r/samcrew/dialect_8"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": daokitHome(realm),
                proposals: daokitProposalsEmpty(realm),
                history: daokitHistoryEmpty(realm),
            }),
        )
        await getDAOProposals(RPC, realm, true) // learns "daokit"
        invalidateProposalCache(realm)

        // The sub-routes vanish while the landing stays up: the memoized read
        // forgets the memo, rediscovers via the landing, and the strict
        // contract still surfaces the failure.
        mockQuery.mockImplementation(renderRouter(realm, { "": daokitHome(realm) }))
        await expect(getDAOProposals(RPC, realm, true)).rejects.toThrow(
            "Failed to read the DAO's proposals page",
        )
    })
})
