import { fireEvent, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import { saveGovernanceReceipt } from "../../lib/dao/governanceRecovery"
import { GNO_CHAIN_ID } from "../../lib/config"
import type { MembaV2Proposal } from "../../lib/dao/membaV2"
import type { OsSession } from "../shell/useOsSession"

// An accepted proposal of a version-2 DAO, over stubbed chain reads: what each visitor can do about its execution.
const state = vi.hoisted(() => ({ archived: false, members: undefined as { address: string }[] | undefined, membersFailed: false, planFails: false }))
const sign = vi.hoisted(() => vi.fn())
vi.mock("../../lib/dao/kind", async original => ({ ...(await original<typeof import("../../lib/dao/kind")>()), resolveDaoKind: vi.fn(async () => "memba-v2") }))
vi.mock("../../lib/dao/membaV2Shell", async original => ({ ...(await original<typeof import("../../lib/dao/membaV2Shell")>()), readV2Voters: vi.fn(async () => []), hasVotedOnV2: vi.fn(async () => false) }))
vi.mock("../../lib/dao/membaV2", async original => ({ ...(await original<typeof import("../../lib/dao/membaV2")>()), readV2Proposal: vi.fn() }))
vi.mock("./useOsDao", async original => ({
    ...(await original<typeof import("./useOsDao")>()),
    useDaoConfig: vi.fn(() => ({ data: { name: "Team", description: "", v2: { archived: state.archived, electorate_version: 4 } }, isPending: false, isSuccess: true })),
    useDaoMembers: vi.fn(() => ({ data: state.members, isPending: false, isSuccess: state.members !== undefined, isError: state.membersFailed })),
}))
vi.mock("../../lib/dao/daoTx", async original => {
    const real = await original<typeof import("../../lib/dao/daoTx")>()
    return { ...real, planDaoTx: vi.fn((...a: Parameters<typeof real.planDaoTx>) => { if (state.planFails) throw new Error("Invalid realm path"); return real.planDaoTx(...a) }) }
})
vi.mock("../sign/signerContext", () => ({ useSigner: () => ({ sign, version: 0 }) }))
vi.mock("./sheetFee", async original => ({ ...(await original<typeof import("./sheetFee")>()), quoteSheetGasPrice: vi.fn(async () => ({ gas: 1000, ugnot: 1 })) }))
const { readV2Proposal } = await import("../../lib/dao/membaV2")
const { ProposalWindow } = await import("./DaoWindows")
const { executeScope } = await import("./executeRequest")

const ALICE = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const NOW = Math.floor(Date.now() / 1000)
const accepted = (over: Partial<MembaV2Proposal> = {}) => ({
    id: 1, title: "Adopt the roadmap", description: "", category: "governance", author: ALICE,
    action: { kind: "text", target: "", power: 0, roles: [] }, electorate_power: 3, electorate_version: 4,
    created_at: NOW - 7200, voting_ends_at: NOW - 3600, status: "ACCEPTED", yes: 3, no: 0, abstain: 0,
    accepted_at: NOW - 3600, executable_at: NOW - 600, execute_by: NOW + 86400, ...over,
}) as MembaV2Proposal
const guest = { status: "guest", address: "", network: { key: "mainnet" }, openConnect: vi.fn() } as unknown as OsSession
const member = { ...guest, status: "member", address: ALICE } as unknown as OsSession
const show = (session = guest) => renderWithProviders(<ProposalWindow dao="alice.team" n={1} session={session} open={vi.fn()} />)

beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    state.archived = false
    state.members = [{ address: ALICE }]
    state.membersFailed = false
    state.planFails = false
    vi.mocked(readV2Proposal).mockResolvedValue(accepted())
})

describe("executing an accepted version-2 proposal from its window", () => {
    it("shows a guest the window and asks them to connect", async () => {
        show()
        expect(await screen.findByText(/^Any member can execute it until/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Connect to execute" }))
        expect(guest.openConnect).toHaveBeenCalled()
    })

    it("opens the review for a member, with the electorate they saw", async () => {
        show(member)
        fireEvent.click(await screen.findByRole("button", { name: "Execute…" }))
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        const req = sign.mock.calls[0][0]
        expect(req.title).toBe("Execute")
        expect(req.receipt).toEqual(executeScope("gno.land/r/alice/team", ALICE, 1))
        expect(req.prepare().msgs[0].value).toMatchObject({ func: "Execute", args: ["1"], caller: ALICE })
    })

    it("waits for the member list before offering Execute, and tells a non-member only members can", async () => {
        state.members = undefined
        const loading = show(member)
        expect(await screen.findByRole("button", { name: "Execute…" })).toBeDisabled()
        loading.unmount()
        state.members = [{ address: "g1someoneelse" }]
        show(member)
        expect(await screen.findByText("Only members of this DAO can execute it.")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Execute…" })).toBeNull()
    })

    it("says when execution opens, when it closes too soon or closed, and that an archived DAO executes nothing", async () => {
        // 30 s past two hours, so the text reads "in 2h" however long the test takes to render.
        vi.mocked(readV2Proposal).mockResolvedValue(accepted({ executable_at: NOW + 7200 + 30 }))
        const early = show(member)
        expect(await screen.findByText(/^Execution opens in 2h \(/)).toBeInTheDocument()
        early.unmount()
        vi.mocked(readV2Proposal).mockResolvedValue(accepted({ execute_by: NOW - 60 }))
        const closed = show(member)
        expect(await screen.findByText("The execution window has closed.")).toBeInTheDocument()
        closed.unmount()
        vi.mocked(readV2Proposal).mockResolvedValue(accepted({ execute_by: Math.floor(Date.now() / 1000) + 20 }))
        const closing = show(member)
        expect(await screen.findByText("The execution window closes in under a minute, too soon to execute from here.")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Execute/ })).toBeNull()
        closing.unmount()
        vi.mocked(readV2Proposal).mockResolvedValue(accepted())
        state.archived = true
        show(member)
        expect(await screen.findByText("This DAO is archived, so its proposals can no longer be executed.")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Execute/ })).toBeNull()
    })

    it("says the members couldn't be read instead of offering a dead button", async () => {
        state.members = undefined
        state.membersFailed = true
        show(member)
        expect(await screen.findByRole("alert")).toHaveTextContent("Members couldn't be read; Execute is unavailable right now.")
        expect(screen.queryByRole("button", { name: "Execute…" })).toBeNull()
    })

    it("shows in the window why the execution couldn't be prepared", async () => {
        state.planFails = true
        show(member)
        fireEvent.click(await screen.findByRole("button", { name: "Execute…" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't prepare this execution: Invalid realm path")
        expect(sign).not.toHaveBeenCalled()
    })

    it("locks Execute behind an earlier attempt whose outcome is unknown, saved by either interface", async () => {
        // The classic proposal page's key: chain, realm, caller and "execute:<id>".
        saveGovernanceReceipt({ chainId: GNO_CHAIN_ID, realmPath: "gno.land/r/alice/team", caller: ALICE, operation: "execute:1" }, { phase: "submitted", hash: "HASH1", label: "Execute proposal #1" })
        show(member)
        expect(await screen.findByText("A previous execution attempt is saved. Check its outcome before executing again.")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Execute…" })).toBeNull()
    })
})
