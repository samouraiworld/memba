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
 * view_proposal_detail_page.gno, p/samcrew/daocond cond_members_threshold.gno)
 * because the live DAO currently has zero proposals to capture.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { getDAOProposals, getProposalDetail, parseProposalList } from "./proposals"
import { getDAOMembers, parseMembersFromRender } from "./members"
import { queryRender, normalizeStatus } from "./shared"
import { resilientAbciQuery } from "../rpcFallback"

vi.mock("../rpcFallback", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../rpcFallback")>()),
    resilientAbciQuery: vi.fn(),
}))

const mockQuery = vi.mocked(resilientAbciQuery)

const RPC = "https://rpc.example"

// ── Fixtures ──────────────────────────────────────────────────

/** CHAIN-CAPTURED: Render("") — the landing page. No proposals, no members. */
const DAOKIT_HOME = `# MembaDAO

Community governance for the Memba ecosystem — multisig wallet & DAO platform on Gno

> Realm address: g1dmaqdpwr6xw6ukday0g66033j6ta4wc0r5ypf8

Discover more about this DAO on the [configuration page ⚙️](/r/samcrew/memba_dao:config)


--------------------------------
[\\> Go to Members](/r/samcrew/memba_dao:members)

[\\> Go to Proposals](/r/samcrew/memba_dao:proposals)

`

/** CHAIN-CAPTURED: Render("proposals") with zero proposals. */
const DAOKIT_PROPOSALS_EMPTY = `# MembaDAO - Proposals

[\\> Go to the Proposal history 📜](/r/samcrew/memba_dao:history)

[Add a new proposal 🗳️](/r/samcrew/memba_dao$help)


--------------------------------
## Active Proposals 🗳️ (0)

\t⚠️ There are no proposals to show




--------------------------------
`

/** Synthesized from deployed RenderProposalsTable: two active proposals. */
const DAOKIT_PROPOSALS_TABLE = `# MembaDAO - Proposals

[\\> Go to the Proposal history 📜](/r/samcrew/memba_dao:history)

[Add a new proposal 🗳️](/r/samcrew/memba_dao$help)


--------------------------------
## Active Proposals 🗳️ (2)

| **ID** | **Resource** | **Proposer** | **CreatedAt** | **Status** |
|--------|--------------|--------------|---------------|------------|
| [2](/r/samcrew/memba_dao:proposal/2) | Add Member | [g1x7\\.\\.\\.uxu0](/u/g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0) | 2026-08-27 10:12:05 UTC+00:00 | Open |
| [1](/r/samcrew/memba_dao:proposal/1) | Change DAO Implementation | [g1x7\\.\\.\\.uxu0](/u/g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0) | 2026-08-20 09:00:00 UTC+00:00 | Passed |


--------------------------------
`

/** Synthesized from deployed ProposalHistoryPageView: one executed proposal. */
const DAOKIT_HISTORY_TABLE = `# MembaDAO - Proposal History

[\\> Go to the active Proposals 📃](/r/samcrew/memba_dao:proposals)

[Add a new proposal 🗳️](/r/samcrew/memba_dao$help)


--------------------------------
## Inactive Proposals 🗳️ (1)

| **ID** | **Resource** | **Proposer** | **CreatedAt** | **Status** |
|--------|--------------|--------------|---------------|------------|
| [3](/r/samcrew/memba_dao:proposal/3) | Add Member | [g1qqq\\.\\.\\.zzz0](/u/g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzzz0) | 2026-08-01 12:00:00 UTC+00:00 | Executed |


--------------------------------
`

/** CHAIN-CAPTURED: Render("history") with zero proposals. */
const DAOKIT_HISTORY_EMPTY = `# MembaDAO - Proposal History

[\\> Go to the active Proposals 📃](/r/samcrew/memba_dao:proposals)

[Add a new proposal 🗳️](/r/samcrew/memba_dao$help)


--------------------------------
## Inactive Proposals 🗳️ (0)

\t⚠️ There are no proposals to show




--------------------------------
`

/** CHAIN-CAPTURED: Render("members") — one member, two roles (SVGs elided). */
const DAOKIT_MEMBERS = `## Members 👥 (1)

| **Name** | **Address 🔗** | **Roles 🎭** | **Profile** |
|----------|----------------|--------------|-------------|
| Anon | [g1x7\\.\\.\\.uxu0](/u/g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0) | [![admin colored chip](data:image/svg+xml;base64,SVGDATA) admin](/r/samcrew/memba_dao:role/admin), [![dev colored chip](data:image/svg+xml;base64,SVGDATA) dev](/r/samcrew/memba_dao:role/dev) | [View](/r/samcrew/memba_dao:member/g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0) |



## Roles distribution:
![Pie Chart Roles distribution:](data:image/svg+xml;base64,SVGDATA)
--------------------------------
`

/** Synthesized from deployed ProposalDetailPageView + membersThresholdCond. */
const DAOKIT_DETAIL = `# MembaDAO - Proposal Detail

[> Go to Proposals](/r/samcrew/memba_dao:proposals)

--------------------------------
## Title - Add treasury signer 📜

## Description 📝

Bring the ops multisig into the signer set.

## Resource - basedao-add-member 📦

  - **Name:** Add Member
  - **Description:** Adds a new member to the DAO
  - **Condition:** 66% of members

---

Add member g1newmemberaddrxxxxxxxxxxxxxxxxxxxxxxx with roles []

---

## Status - Open 🟡

[Approve this proposal 🗳️](/r/samcrew/memba_dao$help&func=Vote&proposalID=1&vote=yes)

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

beforeEach(() => {
    mockQuery.mockReset()
})

// ── queryRender: the mux "404" body ───────────────────────────

describe("queryRender mux-404 handling", () => {
    it('treats a literal "404" body as null so fallback chains proceed', async () => {
        mockQuery.mockResolvedValue("404")
        expect(await queryRender(RPC, "gno.land/r/x/daokit404", "1")).toBeNull()
    })

    it("passes ordinary render bodies through untouched", async () => {
        mockQuery.mockResolvedValue("# A page mentioning 404 in prose")
        expect(await queryRender(RPC, "gno.land/r/x/daokit404b", "")).toBe(
            "# A page mentioning 404 in prose",
        )
    })
})

// ── normalizeStatus: daokit detail "Closed" ───────────────────

describe("normalizeStatus daokit statuses", () => {
    it('maps the detail page\'s "Closed" to "rejected"', () => {
        expect(normalizeStatus("Closed")).toBe("rejected")
    })
})

// ── parseProposalList: daokit table rows ──────────────────────

describe("parseProposalList daokit table leg", () => {
    it("parses table rows: id, resource-as-title, proposer address, createdAt, status", () => {
        const rows = parseProposalList(DAOKIT_PROPOSALS_TABLE)
        expect(rows).toHaveLength(2)
        expect(rows[0]).toMatchObject({
            id: 2,
            title: "Add Member",
            status: "open",
            author: "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0",
            proposer: "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0",
        })
        expect(rows[0].createdAt).toBe("2026-08-27T10:12:05+00:00")
        expect(rows[1]).toMatchObject({ id: 1, title: "Change DAO Implementation", status: "passed" })
    })

    it("parses the executed history row", () => {
        const rows = parseProposalList(DAOKIT_HISTORY_TABLE)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ id: 3, status: "executed" })
    })

    it("finds nothing on the empty-state page", () => {
        expect(parseProposalList(DAOKIT_PROPOSALS_EMPTY)).toHaveLength(0)
    })

    it("finds nothing on the landing page", () => {
        expect(parseProposalList(DAOKIT_HOME)).toHaveLength(0)
    })
})

// ── parseMembersFromRender: daokit members table ──────────────

describe("parseMembersFromRender daokit table leg", () => {
    it("parses the members table: full address from the /u/ link, roles from :role/ links", () => {
        const members = parseMembersFromRender(DAOKIT_MEMBERS)
        expect(members).toHaveLength(1)
        expect(members[0].address).toBe("g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0")
        expect(members[0].roles).toEqual(["admin", "dev"])
    })

    it("still parses the legacy bullet format (regression)", () => {
        const members = parseMembersFromRender("- g1abc (roles: admin) | power: 3\n- g1def\n")
        expect(members).toHaveLength(2)
        expect(members[0]).toMatchObject({ address: "g1abc", roles: ["admin"], votingPower: 3 })
    })
})

// ── getDAOProposals: landing → :proposals + :history ──────────

describe("getDAOProposals daokit fallthrough", () => {
    it("follows the landing page to :proposals and :history and merges both tables", async () => {
        const realm = "gno.land/r/samcrew/daokit_p1"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": DAOKIT_HOME,
                proposals: DAOKIT_PROPOSALS_TABLE,
                history: DAOKIT_HISTORY_TABLE,
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
                "": DAOKIT_HOME,
                proposals: DAOKIT_PROPOSALS_EMPTY,
                history: DAOKIT_HISTORY_EMPTY,
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
        const renderPaths = mockQuery.mock.calls
            .filter(([p]) => p === "vm/qrender")
            .map(([, d]) => String(d).split(/:(.*)/s)[1])
        expect(renderPaths).not.toContain("proposals")
        expect(renderPaths).not.toContain("history")
    })
})

// ── getDAOMembers: landing → :members ─────────────────────────

describe("getDAOMembers daokit fallthrough", () => {
    it("follows the landing page to :members and parses the table", async () => {
        const realm = "gno.land/r/samcrew/daokit_m1"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "": DAOKIT_HOME,
                members: DAOKIT_MEMBERS,
            }),
        )

        const members = await getDAOMembers(RPC, realm)

        expect(members).toHaveLength(1)
        expect(members[0].address).toBe("g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0")
        expect(members[0].roles).toEqual(["admin", "dev"])
    })
})

// ── getProposalDetail: 404 fallthrough + daokit detail page ───

describe("getProposalDetail daokit leg", () => {
    it("falls through Render('1')='404' to proposal/1 and parses the daokit detail page", async () => {
        const realm = "gno.land/r/samcrew/daokit_d1"
        mockQuery.mockImplementation(
            renderRouter(realm, {
                "proposal/1": DAOKIT_DETAIL,
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
})
