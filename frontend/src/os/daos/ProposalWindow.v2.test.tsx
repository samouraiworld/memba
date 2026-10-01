import { screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import type { MembaV2Proposal } from "../../lib/dao/membaV2"
import type { OsSession } from "../shell/useOsSession"

// A version-2 DAO's proposal window over stubbed chain reads: the contract probe, the proposal and its votes.
vi.mock("../../lib/dao/kind", async original => ({ ...(await original<typeof import("../../lib/dao/kind")>()), resolveDaoKind: vi.fn(async () => "memba-v2") }))
vi.mock("../../lib/dao/membaV2Shell", async original => ({ ...(await original<typeof import("../../lib/dao/membaV2Shell")>()), readV2Voters: vi.fn(), hasVotedOnV2: vi.fn(async () => false) }))
vi.mock("../../lib/dao/membaV2", async original => ({ ...(await original<typeof import("../../lib/dao/membaV2")>()), readV2Proposal: vi.fn() }))
vi.mock("./useOsDao", async original => ({
    ...(await original<typeof import("./useOsDao")>()),
    useDaoConfig: vi.fn(() => ({ data: { name: "Team", description: "" }, isPending: false, isSuccess: true })),
    useDaoMembers: vi.fn(() => ({ data: undefined, isPending: false, isSuccess: false })),
}))
vi.mock("../sign/signerContext", () => ({ useSigner: () => ({ sign: vi.fn(), version: 0 }) }))
const { readV2Voters, hasVotedOnV2 } = await import("../../lib/dao/membaV2Shell")
const { readV2Proposal } = await import("../../lib/dao/membaV2")
const { ProposalWindow } = await import("./DaoWindows")

const ALICE = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const BOB = "g1lyejwwmxef5tn8nx69saykmgm8rlr4xq9yeh3z"
const NOW = Math.floor(Date.now() / 1000)
const proposal = (over: Partial<MembaV2Proposal> = {}) => ({
    id: 1, title: "Adopt the roadmap", description: "", category: "governance", author: BOB,
    action: { kind: "text", target: "", power: 0, roles: [] }, electorate_power: 3, electorate_version: 0,
    created_at: NOW - 3600, voting_ends_at: NOW + 86400, status: "ACTIVE", yes: 2, no: 1, abstain: 0,
    accepted_at: 0, executable_at: 0, execute_by: 0, ...over,
}) as MembaV2Proposal
const guest = { status: "guest", address: "", network: { key: "mainnet" }, openConnect: vi.fn() } as unknown as OsSession
const member = { ...guest, status: "member", address: ALICE } as unknown as OsSession
const show = (session = guest) => renderWithProviders(<ProposalWindow dao="alice.team" n={1} session={session} open={vi.fn()} />)
const votes = async () => (await screen.findByRole("heading", { name: "Votes" })).closest("section")!

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readV2Proposal).mockResolvedValue(proposal())
    vi.mocked(readV2Voters).mockResolvedValue([
        { voter: ALICE, choice: "YES", power: 2, username: "@alice​" },
        { voter: BOB, choice: "NO", power: 1, username: "" },
    ])
})

describe("a version-2 DAO's proposal window", () => {
    it("lists who voted, how and with what power, for a guest too, naming each voter that has a name", async () => {
        show()
        const list = await votes()
        const [alice, bob] = await within(list).findAllByRole("listitem")
        // A name keeps its invisible characters visible.
        expect(alice).toHaveTextContent(`@alice[U+200B]${ALICE}Yes2 voting power`)
        expect(bob).toHaveTextContent(`${BOB}No1 voting power`)
        expect(readV2Voters).toHaveBeenCalledWith(expect.any(String), "gno.land/r/alice/team", 1, expect.anything())
    })

    it("says no one has voted while voting is open, and that no one voted once it is over", async () => {
        vi.mocked(readV2Voters).mockResolvedValue([])
        const open = show()
        expect(await within(await votes()).findByText("No one has voted yet.")).toBeInTheDocument()
        open.unmount()
        vi.mocked(readV2Proposal).mockResolvedValue(proposal({ voting_ends_at: NOW - 60, status: "REJECTED" }))
        show()
        expect(await within(await votes()).findByText("No one voted.")).toBeInTheDocument()
    })

    it("tells a member how they voted from the same list", async () => {
        vi.mocked(hasVotedOnV2).mockResolvedValue(true)
        show(member)
        expect(await screen.findByText(/^You voted/)).toHaveTextContent("You voted Yes. Votes are final.")
    })

    it("says a member's choice could not be read when the list could not", async () => {
        vi.mocked(hasVotedOnV2).mockResolvedValue(true)
        vi.mocked(readV2Voters).mockRejectedValue(new Error("Truncated vote page"))
        show(member)
        expect(await screen.findByText("Your vote is recorded; the choice could not be read right now.")).toBeInTheDocument()
        expect(screen.getByText("Who voted couldn't be read right now.")).toBeInTheDocument()
    })
})
