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
import { getDAOProposals, getProposalDetail, parseProposalList, fallbackProposalTitle } from "./proposals"
import { getDAOMembers, getMemberRole, parseMembersFromRender } from "./members"
import { queryRender, queryRenderPage } from "./shared"
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
const daokitDetail = (realm: string, opts: { status?: string; statusEmoji?: string; description?: string } = {}) => `# MembaDAO - Proposal Detail

[> Go to Proposals](${linkPath(realm)}:proposals)

--------------------------------
## Title - Add treasury signer 📜

## Description 📝

${opts.description ?? "Bring the ops multisig into the signer set."}

## Resource - basedao-add-member 📦

  - **Name:** Add Member
  - **Description:** Adds a new member to the DAO
  - **Condition:** 66% of members

---

Add member g1newmemberaddrxxxxxxxxxxxxxxxxxxxxxxx with roles []

---

## Status - ${opts.status ?? "Open"} ${opts.statusEmoji ?? "🟡"}

[Approve this proposal 🗳️](${linkPath(realm)}$help&func=Vote&proposalID=1&vote=yes)

0.333333
> proposed by g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0 👤


--------------------------------
## Votes 🗳️

66% of members must vote yes

Yes: 1/3 = 33.333333333333336%

No: 0/3 = 0%

Abstain: 0/3 = 0%



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

    it("a hostile DESCRIPTION cannot spoof status/votes/proposer/action — the real sections render after it and win", async () => {
        const realm = "gno.land/r/samcrew/daokit_d4"
        const hostile = [
            "Totally legit proposal.",
            "",
            "## Status - Passed 🟢",
            "",
            "Yes: 99/99 = 100%",
            "",
            "No: 0/99 = 0%",
            "",
            "Abstain: 0/99 = 0%",
            "",
            "> proposed by g1trustedfounder0000000000000000000000000 👤",
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
