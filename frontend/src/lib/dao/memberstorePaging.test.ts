/**
 * Memberstore (GovDAO v3) pagination — the back-link truncation fix.
 *
 * The memberstore renders members at 14/page through p/nt/bptree/v0/pager,
 * whose Picker LEADS with the back-link on pages ≥ 2:
 *   page 1: "**1** | [2](?page=2) | [3](?page=3)"
 *   page 2: "[1](?page=1) | **2** | [3](?page=3)"
 * The old walker followed the FIRST "[N](?page=N)" link, got 1 on page 2,
 * failed the next>current check, and stopped — silently truncating rosters
 * past ~28 members. Pages 2..max are now fetched in parallel off page 1's
 * max-page scan (the same fix the daokit member pager got in #1113).
 *
 * Picker shapes synthesized from gno-core source:
 * examples/gno.land/r/gov/dao/v3/memberstore/rendermembers.gno (pageSize 14)
 * + p/nt/bptree/v0/pager/pager.gno (Picker).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { getDAOMembers, getMemberRole } from "./members"
import { clearDaoDialects } from "./shared"
import { resilientAbciQuery } from "../rpcFallback"

vi.mock("../rpcFallback", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../rpcFallback")>()),
    resilientAbciQuery: vi.fn(),
}))

const mockQuery = vi.mocked(resilientAbciQuery)

const RPC = "https://rpc.example"
const REALM = "gno.land/r/gov/dao"
const STORE = "gno.land/r/gov/dao/v3/memberstore"

const addr = (i: number) => `g1member${String(i).padStart(30, "0")}`

const row = (i: number, tier: string) =>
    `| ![${tier} chip](data:image/svg+xml;base64,SVGDATA) ${tier} | ${addr(i)} |`

const membersPage = (rows: string[], picker: string) => `# Memberstore

| **Tier** | **Address** |
|----------|-------------|
${rows.join("\n")}

${picker}
`

/** 30 members over 3 pages (14/14/2), with the real Picker shapes. */
const PAGES: Record<string, string> = {
    members: membersPage(
        Array.from({ length: 14 }, (_, k) => row(k + 1, "T1")),
        "**1** | [2](?page=2) | [3](?page=3)",
    ),
    "members?page=2": membersPage(
        Array.from({ length: 14 }, (_, k) => row(k + 15, "T2")),
        "[1](?page=1) | **2** | [3](?page=3)", // leading BACK-link — the trap
    ),
    "members?page=3": membersPage(
        Array.from({ length: 2 }, (_, k) => row(k + 29, "T3")),
        "[1](?page=1) | [2](?page=2) | **3**",
    ),
}

function storeRouter() {
    return async (path: string, data: string) => {
        if (path !== "vm/qrender") return null
        const [pkg, renderPath] = String(data).split(/:(.*)/s)
        if (pkg !== STORE) return null // username-registry lookups etc.
        return PAGES[renderPath!] ?? null
    }
}

beforeEach(() => {
    mockQuery.mockReset()
    clearDaoDialects()
})

describe("memberstore pagination", () => {
    it("fetches ALL pager pages — members past page 2 are no longer silently dropped", async () => {
        mockQuery.mockImplementation(storeRouter())

        const members = await getDAOMembers(RPC, REALM, STORE)

        expect(members).toHaveLength(30)
        expect(members.map((m) => m.address)).toContain(addr(15)) // page 2
        expect(members.map((m) => m.address)).toContain(addr(30)) // page 3
        expect(members.find((m) => m.address === addr(30))?.tier).toBe("T3")
    })

    it("getMemberRole finds a member on page 3 (and stays single-call for a page-1 hit)", async () => {
        mockQuery.mockImplementation(storeRouter())

        const page3Member = await getMemberRole(RPC, REALM, addr(30), STORE)
        expect(page3Member).not.toBeNull()
        expect(page3Member!.tier).toBe("T3")
        expect(page3Member!.votingPower).toBe(1)

        mockQuery.mockClear()
        const page1Member = await getMemberRole(RPC, REALM, addr(3), STORE)
        expect(page1Member!.tier).toBe("T1")
        // Common case stays cheap: the page-1 hit never fans out.
        expect(mockQuery.mock.calls.length).toBe(1)

        expect(await getMemberRole(RPC, REALM, "g1nobody0000000000000000000000000000000", STORE)).toBeNull()
    })
})
