import { clearGovernanceMemory } from "../lib/dao/governanceRecovery"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { MembaV2Config, MembaV2Proposal } from "../lib/dao/membaV2"

const ALICE = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const BOB = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const NEW = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const REALM = "gno.land/r/alice/team"
const HASH = "c".repeat(64)
const NOW = Math.floor(Date.now() / 1000)

const state = vi.hoisted(() => ({
    address: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
    archived: false,
    voted: false,
    removed: false,
    epoch: 0,
    readFailed: false,
    proposal: null as unknown,
    broadcast: vi.fn(),
    deposit: null as number | null,
}))

vi.mock("react-router-dom", async (orig) => ({
    ...(await orig<typeof import("react-router-dom")>()),
    useOutletContext: () => ({ auth: { isAuthenticated: true, token: null }, adena: { address: state.address } }),
}))
vi.mock("../hooks/useDaoKind", async () => {
    const { capabilitiesFor } = await import("../lib/dao/kind")
    const { NETWORKS } = await import("../lib/config")
    return { useDaoKind: () => ({ kind: "memba-v2", capabilities: capabilitiesFor("memba-v2", NETWORKS.pearl), loading: false, error: null }) }
})
vi.mock("../lib/grc20", async (orig) => ({ ...(await orig<typeof import("../lib/grc20")>()), doContractBroadcast: state.broadcast }))
vi.mock("../lib/errorLog", () => ({ logChainError: vi.fn() }))
// Every modelled call stays under the 10 GNOT deposit ceiling; tests force a larger cap.
vi.mock("../lib/dao/v2Budget", async (orig) => {
    const real = await orig<typeof import("../lib/dao/v2Budget")>()
    return { ...real, v2CallBudget: (...args: Parameters<typeof real.v2CallBudget>) => ({ ...real.v2CallBudget(...args), ...(state.deposit === null ? {} : { maxDepositUgnot: state.deposit }) }) }
})
vi.mock("../lib/dao/membaV2", async (orig) => ({
    ...(await orig<typeof import("../lib/dao/membaV2")>()),
    readV2Proposal: async () => state.proposal,
    readV2Votes: async () => ({ total: state.voted ? 1 : 0, offset: 0, votes: state.voted ? [{ voter: ALICE, choice: "YES", power: 2 }] : [] }),
}))
vi.mock("../lib/dao/membaV2Shell", async (orig) => ({ ...(await orig<typeof import("../lib/dao/membaV2Shell")>()), hasVotedOnV2: async () => { if (state.readFailed) throw new Error("RPC unavailable"); return state.voted } }))

const CONFIG: MembaV2Config = {
    template_version: "memba-dao/2", api_version: "2.0", name: "Team", description: "",
    threshold: 60, quorum: 20, voting_period: 3 * 86400, execution_delay: 3600, execution_window: 7 * 86400,
    categories: ["governance"], roles: ["lead", "member"], archived: false,
    member_count: 2, total_power: 3, electorate_version: 0, proposal_count: 5,
}

vi.mock("../lib/dao", async (orig) => ({
    ...(await orig<typeof import("../lib/dao")>()),
    getDAOConfig: async () => ({ name: "Team", description: "", threshold: "60%", memberCount: 2, memberstorePath: "", tierDistribution: [], isArchived: state.archived, v2: { ...CONFIG, archived: state.archived, electorate_version: state.epoch } }),
    getDAOMembers: async () => [
        ...(!state.removed ? [{ address: ALICE, roles: ["lead"], tier: "", votingPower: 2, username: "" }] : []),
        { address: BOB, roles: ["member"], tier: "", votingPower: 1, username: "" },
    ],
}))

import { ProposalView } from "./ProposalView"
import { GNO_CHAIN_ID } from "../lib/config"
import { txExplorerUrl } from "../lib/txExplorerUrl"

function proposal(overrides: Partial<MembaV2Proposal> = {}): MembaV2Proposal {
    return {
        id: 2, title: "Add Dana", category: "membership", author: BOB,
        action: { kind: "text", target: "", power: 0, roles: [] },
        electorate_power: 3, electorate_version: 0, created_at: NOW - 3600, voting_ends_at: NOW + 2 * 86400,
        status: "ACTIVE", yes: 1, no: 0, abstain: 0, accepted_at: 0, executable_at: 0, execute_by: 0,
        description: "", ...overrides,
    } as MembaV2Proposal
}

function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[`/pearl/dao/${REALM}/proposal/2`]}>
                <Routes>
                    <Route path="/:network/dao/*" element={<ProposalView />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

beforeEach(() => {
    clearGovernanceMemory()
    localStorage.clear()
    state.address = ALICE
    state.archived = false
    state.voted = false
    state.removed = false
    state.epoch = 0
    state.readFailed = false
    state.proposal = proposal()
    state.broadcast.mockReset()
    state.deposit = null
})

describe("version-2 proposal reader", () => {
    it("shows the voting deadline, power against threshold and quorum, and that votes are final", async () => {
        mount()
        expect(await screen.findByRole("heading", { name: "Add Dana", level: 2 })).toBeInTheDocument()
        expect(screen.getByText("Voting", { selector: ".v2p-status" })).toBeInTheDocument()
        expect(screen.getByText("Voting ends")).toBeInTheDocument()
        expect(screen.getByText(/\(in 2d\)|\(in 1d 23h\)/)).toBeInTheDocument()
        expect(screen.getByRole("img", { name: "Yes 33.3%, No 0%, Abstain 0% of all voting power; threshold 60%; quorum 20%" })).toBeInTheDocument()
        expect(screen.getByText("33.3% voted, 20% needed")).toBeInTheDocument()
        expect(screen.getByText("Votes are final; a proposal is accepted as soon as the threshold is reached.")).toBeInTheDocument()
        // Path first, then the DAO's self-declared name.
        expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/gno\.land\/r\/alice\/team · Team/)
    })

    it("asks for confirmation, sends a sized vote and shows the transaction", async () => {
        state.broadcast.mockImplementation(async () => { state.voted = true; return { hash: HASH, result: {} } })
        mount()
        fireEvent.click(await screen.findByRole("button", { name: "Vote yes" }))
        const dialog = screen.getByRole("alertdialog", { name: "Vote YES on proposal #2?" })
        expect(within(dialog).getByText(/counts 2 voting power and cannot be changed/)).toBeInTheDocument()
        expect(within(dialog).getByText(/requested storage-deposit cap 0.4 GNOT/)).toBeInTheDocument()
        fireEvent.click(within(dialog).getByRole("button", { name: "Confirm YES" }))
        await waitFor(() => expect(screen.getByText("Your YES vote is recorded.")).toBeInTheDocument())
        expect(state.broadcast).toHaveBeenCalledWith(
            [{ type: "vm/MsgCall", value: { caller: ALICE, send: "", pkg_path: REALM, func: "Vote", args: ["2", "YES"], max_deposit: "400000ugnot" } }],
            "Vote YES on proposal #2",
            { gasWanted: 15_000_000, retry: false, beforeSign: expect.any(Function) },
        )
        // The hash links to the explorer only on chains it indexes; elsewhere it is plain text.
        if (txExplorerUrl(HASH, GNO_CHAIN_ID)) expect(screen.getByRole("link", { name: HASH })).toBeInTheDocument()
        else expect(screen.getByText(HASH)).toBeInTheDocument()
    })

    it("keeps the confirmation locked until an above-limit deposit cap is explicitly allowed", async () => {
        state.deposit = 10_000_001
        state.broadcast.mockImplementation(async () => { state.voted = true; return { hash: HASH, result: {} } })
        mount()
        fireEvent.click(await screen.findByRole("button", { name: "Vote yes" }))
        let dialog = screen.getByRole("alertdialog", { name: "Vote YES on proposal #2?" })
        expect(within(dialog).getByRole("alert", { name: "Storage deposit above the limit" })).toHaveTextContent("10.000001 GNOT")
        const confirm = within(dialog).getByRole("button", { name: "Confirm YES" })
        expect(confirm).toBeDisabled()
        fireEvent.click(confirm)
        expect(state.broadcast).not.toHaveBeenCalled()
        fireEvent.click(within(dialog).getByRole("checkbox", { name: "Allow a storage deposit of up to 10.000001 GNOT" }))
        // Closing the dialog withdraws the approval.
        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
        fireEvent.click(screen.getByRole("button", { name: "Vote yes" }))
        dialog = screen.getByRole("alertdialog", { name: "Vote YES on proposal #2?" })
        expect(within(dialog).getByRole("checkbox", { name: "Allow a storage deposit of up to 10.000001 GNOT" })).not.toBeChecked()
        fireEvent.click(within(dialog).getByRole("checkbox", { name: "Allow a storage deposit of up to 10.000001 GNOT" }))
        fireEvent.click(within(dialog).getByRole("button", { name: "Confirm YES" }))
        await waitFor(() => expect(state.broadcast).toHaveBeenCalledTimes(1))
        expect(state.broadcast.mock.calls[0][0][0].value.max_deposit).toBe("10000001ugnot")
    })

    it("confirms a 10 GNOT deposit cap without an override", async () => {
        state.deposit = 10_000_000
        state.broadcast.mockImplementation(async () => { state.voted = true; return { hash: HASH, result: {} } })
        mount()
        fireEvent.click(await screen.findByRole("button", { name: "Vote yes" }))
        const dialog = screen.getByRole("alertdialog", { name: "Vote YES on proposal #2?" })
        expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument()
        fireEvent.click(within(dialog).getByRole("button", { name: "Confirm YES" }))
        await waitFor(() => expect(state.broadcast).toHaveBeenCalledTimes(1))
    })

    it("does not offer a second vote", async () => {
        state.voted = true
        mount()
        expect(await screen.findByText("You voted YES on this proposal. Votes are final.")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Vote yes" })).not.toBeInTheDocument()
    })

    it("keeps Execute disabled until the execution delay has passed", async () => {
        state.proposal = proposal({ status: "ACCEPTED", yes: 2, accepted_at: NOW - 60, executable_at: NOW + 3590, execute_by: NOW + 3590 + 7 * 86400 })
        mount()
        const execute = await screen.findByRole("button", { name: "Execute proposal" })
        expect(execute).toBeDisabled()
        expect(screen.getByText("Accepted", { selector: "dt" })).toBeInTheDocument()
        expect(screen.getByText("Executable from")).toBeInTheDocument()
        expect(screen.getByText("Must be executed before")).toBeInTheDocument()
        expect(screen.getByText(/^Executable from .* \(in 59m\)\.$/)).toBeInTheDocument()
    })

    it("confirms the exact membership change before executing it", async () => {
        state.broadcast.mockImplementation(async () => { state.proposal = { ...(state.proposal as MembaV2Proposal), status: "EXECUTED" }; return { hash: HASH, result: {} } })
        state.proposal = proposal({ status: "ACCEPTED", yes: 2, accepted_at: NOW - 7200, executable_at: NOW - 3600, execute_by: NOW + 86400, action: { kind: "add_member", target: NEW, power: 1500, roles: ["lead", "member"] } })
        mount()
        fireEvent.click(await screen.findByRole("button", { name: "Execute proposal" }))
        const dialog = screen.getByRole("alertdialog", { name: "Execute proposal #2?" })
        expect(within(dialog).getByText(NEW)).toBeInTheDocument()
        expect(within(dialog).getByText("1,500")).toBeInTheDocument()
        expect(within(dialog).getByText("lead, member")).toBeInTheDocument()
        expect(within(dialog).getByText(/closes every proposal still open for voting/)).toBeInTheDocument()
        fireEvent.click(within(dialog).getByRole("button", { name: "Confirm execution" }))
        await waitFor(() => expect(screen.getByText("Proposal #2 executed.")).toBeInTheDocument())
        const [msgs, , opts] = state.broadcast.mock.calls[0]
        expect(msgs[0].value).toMatchObject({ func: "Execute", args: ["2"], max_deposit: expect.stringMatching(/ugnot$/) })
        expect(opts).toEqual({ gasWanted: 25_000_000, retry: false, beforeSign: expect.any(Function) })
    })

    it("tells the executor of a removal where the freed deposit goes", async () => {
        state.proposal = proposal({ status: "ACCEPTED", yes: 2, accepted_at: NOW - 7200, executable_at: NOW - 3600, execute_by: NOW + 86400, action: { kind: "remove_member", target: BOB, power: 0, roles: [] } })
        mount()
        fireEvent.click(await screen.findByRole("button", { name: "Execute proposal" }))
        expect(screen.getByText(/refunded to you, as the account that executes the removal/)).toBeInTheDocument()
    })

    it("renders the description as escaped text and reveals invisible formatting characters", async () => {
        state.proposal = proposal({ description: "First line\n\n<img src=x onerror=alert(1)> pay ‮evil" })
        const { container } = mount()
        await screen.findByRole("heading", { name: "Description" })
        expect(container.querySelector("img")).toBeNull()
        expect(screen.getByText(/pay \[U\+202E\]evil/)).toBeInTheDocument()
        expect(container.textContent).not.toContain("‮")
        expect(screen.getByRole("alert")).toHaveTextContent(/invisible formatting characters/)
    })

    it("opens external description links in a new tab and keeps hostile links dead", async () => {
        state.proposal = proposal({ description: "See [the spec](https://example.com/spec) and [this](javascript:alert(1))." })
        mount()
        const link = await screen.findByRole("link", { name: "the spec" })
        expect(link).toHaveAttribute("href", "https://example.com/spec")
        expect(link).toHaveAttribute("target", "_blank")
        expect(link).toHaveAttribute("rel", "noopener noreferrer")
        const dead = screen.getByRole("link", { name: "this" })
        expect(dead).toHaveAttribute("href", "#")
        expect(dead).not.toHaveAttribute("target")
    })

    it("shows failures in plain words", async () => {
        state.broadcast.mockRejectedValue(new Error("VM panic: already voted"))
        mount()
        fireEvent.click(await screen.findByRole("button", { name: "Vote no" }))
        fireEvent.click(screen.getByRole("button", { name: "Confirm NO" }))
        expect(await screen.findByText("You already voted on this proposal. Votes are final.")).toBeInTheDocument()
    })

    it("offers no actions to non-members or in an archived DAO", async () => {
        state.address = NEW
        const { unmount } = mount()
        expect(await screen.findByText(/not a member of this DAO/)).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Vote yes" })).not.toBeInTheDocument()
        unmount()
        state.address = ALICE
        state.archived = true
        state.proposal = proposal({ status: "ARCHIVED" })
        mount()
        expect(await screen.findByText("This DAO is archived. Voting and execution are closed.")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Vote yes" })).not.toBeInTheDocument()
    })
    it.each(["archived", "removed", "voted", "expired"])("revalidates %s after confirmation before opening the wallet", async (change) => {
        const wallet = vi.fn()
        state.broadcast.mockImplementation(async (_msgs, _memo, opts) => {
            if (change === "archived") state.archived = true
            if (change === "removed") state.removed = true
            if (change === "voted") state.voted = true
            if (change === "expired") state.proposal = proposal({ voting_ends_at: NOW - 1 })
            await opts.beforeSign()
            wallet()
            return { hash: HASH }
        })
        mount()
        fireEvent.click(await screen.findByRole("button", { name: "Vote yes" }))
        fireEvent.click(screen.getByRole("button", { name: "Confirm YES" }))
        await waitFor(() => expect(state.broadcast).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(change === "archived" || change === "removed" ? "DAO membership or availability changed" : "This vote is no longer available"))
        expect(wallet).not.toHaveBeenCalled()
    })

    it("executes an accepted proposal from an older electorate", async () => {
        state.epoch = 1
        state.proposal = proposal({ status: "ACCEPTED", electorate_version: 0, yes: 2, accepted_at: NOW - 7200, executable_at: NOW - 3600, execute_by: NOW + 86400 })
        const wallet = vi.fn()
        state.broadcast.mockImplementation(async (_msgs, _memo, opts) => { await opts.beforeSign(); wallet(); state.proposal = { ...(state.proposal as MembaV2Proposal), status: "EXECUTED" }; return { hash: HASH } })
        mount()
        fireEvent.click(await screen.findByRole("button", { name: "Execute proposal" }))
        fireEvent.click(screen.getByRole("button", { name: "Confirm execution" }))
        expect(await screen.findByText("Proposal #2 executed.")).toBeInTheDocument()
        expect(wallet).toHaveBeenCalledTimes(1)
    })

    it("retains an uncertain vote across remount and refuses a duplicate", async () => {
        state.broadcast.mockImplementation(async (_msgs, _memo, opts) => { await opts.beforeSign(); throw new Error("response lost") })
        const first = mount()
        fireEvent.click(await screen.findByRole("button", { name: "Vote yes" }))
        fireEvent.click(screen.getByRole("button", { name: "Confirm YES" }))
        expect(await screen.findByText(/Submission outcome unknown/)).toBeInTheDocument()
        first.unmount()
        mount()
        await screen.findByRole("heading", { name: "Add Dana", level: 2 })
        expect(screen.getByRole("button", { name: "Vote yes" })).toBeDisabled()
        expect(state.broadcast).toHaveBeenCalledTimes(1)
    })

    it.each([false, true])("keeps vote read-back pending when stale or unavailable (%s)", async failed => {
        state.broadcast.mockImplementation(async (_msgs, _memo, opts) => { await opts.beforeSign(); state.readFailed = failed; return { hash: HASH } })
        mount()
        fireEvent.click(await screen.findByRole("button", { name: "Vote yes" }))
        fireEvent.click(screen.getByRole("button", { name: "Confirm YES" }))
        expect(await screen.findByText(/Transaction submitted. The network has not yet confirmed/)).toBeInTheDocument()
        expect(screen.queryByText("Your YES vote is recorded.")).not.toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Vote yes" })).toBeDisabled()
    })

})
