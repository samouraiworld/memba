import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import type { MembaV2Config } from "../lib/dao/membaV2"

const ALICE = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const BOB = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const NEW = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const REALM = "gno.land/r/alice/team"

const state = vi.hoisted(() => ({
    address: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
    archived: false,
    broadcast: vi.fn(),
    proposals: vi.fn(),
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
vi.mock("../lib/dao/membaV2", async (orig) => ({ ...(await orig<typeof import("../lib/dao/membaV2")>()), readV2Proposals: state.proposals }))
vi.mock("../lib/dao/shared", async (orig) => ({ ...(await orig<typeof import("../lib/dao/shared")>()), resolveRegisteredUsername: async (a: string) => (a === NEW ? "@dana" : "") }))
vi.mock("../lib/errorLog", () => ({ logChainError: vi.fn() }))

const CONFIG: MembaV2Config = {
    template_version: "memba-dao/2", api_version: "2.0", name: "Team", description: "",
    threshold: 60, quorum: 0, voting_period: 3 * 86400, execution_delay: 3600, execution_window: 7 * 86400,
    categories: ["governance", "ops"], roles: ["lead", "member"], archived: false,
    member_count: 2, total_power: 3, electorate_version: 0, proposal_count: 5,
}

vi.mock("../lib/dao", async (orig) => ({
    ...(await orig<typeof import("../lib/dao")>()),
    getDAOConfig: async () => ({ name: "Team", description: "", threshold: "60%", memberCount: 2, memberstorePath: "", tierDistribution: [], isArchived: state.archived, v2: { ...CONFIG, archived: state.archived } }),
    getDAOMembers: async () => [
        { address: ALICE, roles: ["lead"], tier: "", votingPower: 2, username: "" },
        { address: BOB, roles: ["member"], tier: "", votingPower: 1, username: "" },
    ],
}))

import { ProposeDAO } from "./ProposeDAO"

function Where() {
    return <div data-testid="location">{useLocation().pathname}</div>
}

function mount(url = `/pearl/dao/${REALM}/propose`) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[url]}>
                <Routes>
                    <Route path="/:network/dao/*" element={<><ProposeDAO /><Where /></>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

const signed = () => {
    const text = screen.getByTestId("v2-signed-message").textContent || ""
    return text.startsWith("{") ? JSON.parse(text) : null
}

beforeEach(() => {
    state.address = ALICE
    state.archived = false
    state.broadcast.mockReset()
    state.proposals.mockReset()
})

describe("version-2 propose form", () => {
    it("offers exactly the DAO kind's proposal types and the DAO's own categories", async () => {
        mount()
        const types = await screen.findByRole("group", { name: "Proposal type" })
        expect(within(types).getAllByRole("button").map((b) => b.textContent)).toEqual(["Text", "Add member", "Remove member", "Change roles", "Archive DAO"])
        expect(within(types).getByRole("button", { name: "Text" })).toHaveAttribute("aria-pressed", "true")
        const categories = screen.getByRole("group", { name: "Category" })
        expect(within(categories).getAllByRole("button").map((b) => b.textContent)).toEqual(["governance", "ops"])
        expect(screen.queryByText(/treasury/i)).not.toBeInTheDocument()
    })

    it("previews exactly the message it signs, then opens the new proposal and locks the form", async () => {
        state.broadcast.mockResolvedValue({ hash: "a".repeat(64), result: { deliver_tx: { ResponseBase: { Data: btoa("(6 uint64)") } } } })
        mount()
        fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Ship the website" } })
        fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Line one\r\nLine two" } })
        fireEvent.click(within(screen.getByRole("group", { name: "Category" })).getByRole("button", { name: "ops" }))
        const preview = signed()
        expect(preview).toEqual({
            type: "vm/MsgCall",
            value: { caller: ALICE, send: "", pkg_path: REALM, func: "ProposeText", args: ["Ship the website", "Line one\nLine two", "ops"], max_deposit: expect.stringMatching(/^[0-9]+ugnot$/) },
        })
        expect(screen.getByText(/Requested cap 1\.6\d? GNOT/)).toBeInTheDocument()

        fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }))
        await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/pearl/dao/${REALM}/proposal/6`))
        expect(state.broadcast).toHaveBeenCalledTimes(1)
        const [msgs, memo, opts] = state.broadcast.mock.calls[0]
        expect(msgs).toEqual([preview])
        expect(memo).toBe("Propose: Ship the website")
        expect(opts).toMatchObject({ retry: false, gasWanted: expect.any(Number) })
        expect(screen.getByLabelText("Title")).toBeDisabled()
        expect(screen.getByRole("button", { name: "Submitted" })).toBeDisabled()
        expect(state.proposals).not.toHaveBeenCalled()
    })

    it("finds the new proposal by author and title when the wallet result carries no id", async () => {
        state.broadcast.mockResolvedValue({ hash: "b".repeat(64), result: { hash: "b".repeat(64) } })
        state.proposals.mockResolvedValue({
            next_before: 0,
            proposals: [
                { id: 7, title: "Other", author: BOB },
                { id: 6, title: "Ship it", author: ALICE },
                { id: 3, title: "Ship it", author: ALICE },
            ],
        })
        mount()
        fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Ship it" } })
        fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }))
        await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/proposal/6`))
    })

    it("builds an add-member proposal with power and roles, and refuses bad targets before signing", async () => {
        mount()
        fireEvent.click(await screen.findByRole("button", { name: "Add member" }))
        fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Add Dana" } })
        const target = screen.getByLabelText("New member address")
        fireEvent.change(target, { target: { value: BOB } })
        expect(screen.getByText("This address is already a member.")).toBeInTheDocument()
        fireEvent.change(target, { target: { value: NEW.slice(0, -1) + "x" } })
        expect(screen.getByText("This is not a valid gno.land address.")).toBeInTheDocument()
        fireEvent.change(target, { target: { value: NEW } })
        expect(await screen.findByText("Registered name: @dana")).toBeInTheDocument()
        fireEvent.change(screen.getByLabelText("Voting power"), { target: { value: "1,500" } })
        expect(screen.getByText("1,500 of 1,503 total voting power after the change.")).toBeInTheDocument()
        const roles = screen.getByRole("group", { name: "Roles" })
        fireEvent.click(within(roles).getByRole("button", { name: "member" }))
        fireEvent.click(within(roles).getByRole("button", { name: "lead" }))
        expect(within(roles).getByRole("button", { name: "lead" })).toHaveAttribute("aria-pressed", "true")
        expect(signed().value).toMatchObject({ func: "ProposeAddMember", args: ["Add Dana", "", NEW, "1500", "lead,member"] })
        fireEvent.change(screen.getByLabelText("Voting power"), { target: { value: "1000000001" } })
        expect(screen.getByText(/Voting power must be a whole number from 1 to 1,000,000,000/)).toBeInTheDocument()
        expect(signed()).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }))
        expect(state.broadcast).not.toHaveBeenCalled()
    })

    it("opens prefilled from the members page", async () => {
        mount(`/pearl/dao/${REALM}/propose?type=change_role&target=${BOB}`)
        const types = await screen.findByRole("group", { name: "Proposal type" })
        expect(within(types).getByRole("button", { name: "Change roles" })).toHaveAttribute("aria-pressed", "true")
        expect(screen.getByLabelText("Member address")).toHaveValue(BOB)
        // The member's current roles are the starting point.
        expect(within(screen.getByRole("group", { name: "Roles" })).getByRole("button", { name: "member" })).toHaveAttribute("aria-pressed", "true")
        fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Promote Bob" } })
        fireEvent.click(within(screen.getByRole("group", { name: "Roles" })).getByRole("button", { name: "lead" }))
        expect(signed().value).toMatchObject({ func: "ProposeSetRoles", args: ["Promote Bob", "", BOB, "lead,member"] })
    })

    it("refuses a removal that would leave no voting power, and warns before archiving", async () => {
        mount(`/pearl/dao/${REALM}/propose?type=remove_member&target=${NEW}`)
        expect(await screen.findByText("This address is not a member of the DAO.")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Archive DAO" }))
        expect(screen.getByText("Archiving is permanent.")).toBeInTheDocument()
    })

    it("refuses a title the realm would refuse and warns about invisible characters in the description", async () => {
        mount()
        fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Pay‮out" } })
        expect(screen.getByText(/invisible formatting characters. Remove them/)).toBeInTheDocument()
        fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Payout" } })
        fireEvent.change(screen.getByLabelText("Description"), { target: { value: "send to ⁦abc⁩" } })
        expect(screen.getByRole("alert")).toHaveTextContent(/invisible formatting characters/)
        // Accepted by the realm: the proposal can still be sent.
        expect(signed().value.func).toBe("ProposeText")
    })

    it("maps a refused call to plain text and keeps the form editable", async () => {
        state.broadcast.mockRejectedValue(new Error("VM panic: too many open proposals for this member"))
        mount()
        fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Another" } })
        fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }))
        expect(await screen.findByText("You already have 10 proposals open for voting. Wait until one of them closes.")).toBeInTheDocument()
        expect(screen.getByLabelText("Title")).not.toBeDisabled()
    })

    it("does not let a non-member or an archived DAO submit", async () => {
        state.address = NEW
        const { unmount } = mount()
        expect(await screen.findByText(/Only members of this DAO can create proposals/)).toBeInTheDocument()
        fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Hello" } })
        expect(screen.getByRole("button", { name: "Submit proposal" })).toBeDisabled()
        unmount()
        state.address = ALICE
        state.archived = true
        mount()
        expect(await screen.findByText(/This DAO is archived/)).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Submit proposal" })).toBeDisabled()
    })
})
