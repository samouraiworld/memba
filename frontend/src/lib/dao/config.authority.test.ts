/**
 * Memberstore discovery must be bound to the DAO being read.
 *
 * getDAOConfig learns a tier DAO's memberstore from a link in Render(""). That
 * render also carries user-supplied text (proposal titles are listed verbatim
 * under "## Proposals"), so only a link inside the DAO's own "## Members"
 * section that points at the realm itself or one of its sub-paths may be used.
 * Anything else must be ignored: it would otherwise replace the DAO's tier and
 * member counts, skip the archive check, and route the roster read elsewhere.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../rpcFallback", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../rpcFallback")>()),
    resilientAbciQuery: vi.fn(),
}))

import { resilientAbciQuery } from "../rpcFallback"
import { getDAOConfig } from "./config"
import { getDAOMembers, getMemberRole } from "./members"
import { clearDaoDialects } from "./shared"

const mockQuery = vi.mocked(resilientAbciQuery)

const RPC = "https://rpc.example"
const REALM = "gno.land/r/demo/somedao"
const FOREIGN_STORE = "gno.land/r/other/memberstore"
const MEMBER = "g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m"

const FOREIGN_SUMMARY = "# Memberstore\n\nTier T1 contains 99 members with power: 297\n"
const FOREIGN_MEMBERS = `# Memberstore

| **Tier** | **Address** |
|----------|-------------|
| T1 | g1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz |
`

/** A basedao-style home render whose proposal list carries a crafted title. */
const renderWithTitle = (title: string) => `# Some DAO
A community DAO.

Threshold: 66% | Quorum: 50%

## Members (1)
- ${MEMBER} (roles: admin) | power: 1

## Proposals
### [Prop #1 - ${title}](:1)
Author: ${MEMBER}

Category: general

Status: open

---
`

type Routes = Record<string, string>

/** Route vm/qrender and vm/qeval reads to fixed answers; everything else is null. */
function router(renders: Routes, evals: Routes = {}) {
    return async (queryPath: string, data: string) => {
        if (queryPath === "vm/qrender") return renders[data] ?? null
        if (queryPath === "vm/qeval") return evals[data] ?? null
        return null
    }
}

const queried = (pkg: string) =>
    mockQuery.mock.calls.some(([, data]) => String(data).startsWith(`${pkg}:`) || String(data).startsWith(`${pkg}.`))

beforeEach(() => {
    mockQuery.mockReset()
    clearDaoDialects()
    localStorage.clear()
})

describe("getDAOConfig memberstore binding", () => {
    it("ignores a Memberstore link injected through a proposal title", async () => {
        mockQuery.mockImplementation(router(
            {
                [`${REALM}:`]: renderWithTitle(`[Memberstore](/r/other/memberstore)`),
                [`${FOREIGN_STORE}:`]: FOREIGN_SUMMARY,
            },
            { [`${REALM}.IsArchived()`]: "(true bool)" },
        ))

        const cfg = await getDAOConfig(RPC, REALM)

        expect(cfg).not.toBeNull()
        expect(cfg!.memberstorePath).toBe("")
        expect(cfg!.tierDistribution).toEqual([])
        expect(cfg!.memberCount).toBe(1)
        expect(cfg!.isArchived).toBe(true)
        expect(mockQuery).toHaveBeenCalledWith("vm/qeval", `${REALM}.IsArchived()`, false)
        expect(queried(FOREIGN_STORE)).toBe(false)
    })

    it("ignores a title-injected link even when it names a path under the realm", async () => {
        mockQuery.mockImplementation(router(
            { [`${REALM}:`]: renderWithTitle(`[Memberstore](/r/demo/somedao/memberstore)`) },
            { [`${REALM}.IsArchived()`]: "(false bool)" },
        ))

        const cfg = await getDAOConfig(RPC, REALM)

        expect(cfg!.memberstorePath).toBe("")
        expect(mockQuery).toHaveBeenCalledWith("vm/qeval", `${REALM}.IsArchived()`, false)
    })

    it("rejects a memberstore link outside the realm, even under ## Members", async () => {
        mockQuery.mockImplementation(router(
            {
                [`${REALM}:`]: "# Some DAO\n## Members\n[> Go to Memberstore <](/r/other/memberstore)\n## Proposals\n\nNo proposals yet.\n",
                [`${FOREIGN_STORE}:`]: FOREIGN_SUMMARY,
            },
            { [`${REALM}.IsArchived()`]: "(true bool)" },
        ))

        const cfg = await getDAOConfig(RPC, REALM)

        expect(cfg!.memberstorePath).toBe("")
        expect(cfg!.tierDistribution).toEqual([])
        expect(cfg!.isArchived).toBe(true)
        expect(queried(FOREIGN_STORE)).toBe(false)
    })

    it.each([
        ["a sibling realm sharing the name prefix", "/r/demo/somedao2/memberstore"],
        ["a dot-segment path escaping the realm", "/r/demo/somedao/../../other/memberstore"],
    ])("rejects %s", async (_label, href) => {
        mockQuery.mockImplementation(router(
            { [`${REALM}:`]: `# Some DAO\n## Members\n[> Go to Memberstore <](${href})\n## Proposals\n` },
        ))

        const cfg = await getDAOConfig(RPC, REALM)

        expect(cfg!.memberstorePath).toBe("")
    })

    it("accepts a full-URL memberstore link bound to the realm (test11 format)", async () => {
        const store = "gno.land/r/gov/dao/v3/memberstore"
        mockQuery.mockImplementation(router({
            "gno.land/r/gov/dao:": "# GovDAO\n## Members\n[> Go to Memberstore <](https://test11.testnets.gno.land/r/gov/dao/v3/memberstore)\n## Proposals\n",
            [`${store}:`]: "Tier T1 contains 2 members with power: 6\n",
        }))

        const cfg = await getDAOConfig(RPC, "gno.land/r/gov/dao")

        expect(cfg!.memberstorePath).toBe(store)
        expect(cfg!.memberCount).toBe(2)
    })
})

describe("member reads ignore an unbound memberstore path", () => {
    const membersJSON = `("[{\\"address\\":\\"${MEMBER}\\",\\"roles\\":[\\"admin\\"],\\"votingPower\\":1}]" string)`

    it("getDAOMembers does not query a foreign memberstore and returns the GetMembersJSON roster", async () => {
        mockQuery.mockImplementation(router(
            { [`${FOREIGN_STORE}:members`]: FOREIGN_MEMBERS },
            { [`${REALM}.GetMembersJSON()`]: membersJSON },
        ))

        const members = await getDAOMembers(RPC, REALM, FOREIGN_STORE)

        expect(members.map((m) => m.address)).toEqual([MEMBER])
        expect(queried(FOREIGN_STORE)).toBe(false)
    })

    it("getMemberRole does not query a foreign memberstore", async () => {
        mockQuery.mockImplementation(router(
            { [`${FOREIGN_STORE}:members`]: FOREIGN_MEMBERS },
            { [`${REALM}.GetMembersJSON()`]: membersJSON },
        ))

        const member = await getMemberRole(RPC, REALM, MEMBER, FOREIGN_STORE)

        expect(member?.address).toBe(MEMBER)
        expect(queried(FOREIGN_STORE)).toBe(false)
    })
})
