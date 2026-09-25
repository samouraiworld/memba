// The page with gnoland-1 as the ACTIVE network (GNO_CHAIN_ID / GNO_RPC_URL),
// and a connected, authenticated member whose wallet is on gnoland-1: the
// released mainnet DAO (v12 at r/samcrew/memba_dao) is writable, and any other
// weighted DAO stays on the governance write hold.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom"
import { beforeEach, expect, it, vi } from "vitest"
import { WeightedDAO } from "./WeightedDAO"
import * as weighted from "../lib/dao/weighted"
import { readWeightedBallot, readWeightedProposal, readWeightedSnapshot, weightedConfigSchema, weightedMembersSchema, weightedPageSchema } from "../lib/dao/weighted"
import { readAcceptanceStates } from "../lib/dao/weightedAcceptance"
import { assertLiveWalletChain } from "../lib/dao/weightedWallet"
import { APPLICATION_POLICY_KEYS } from "../lib/dao/weightedApplications"
import { doContractBroadcast } from "../lib/grc20"
import { weightedRealm } from "../lib/dao/testdata/weighted"
import v12Native from "../lib/dao/testdata/weighted-v12/native.json"
vi.mock("../lib/config", async importOriginal => ({ ...await importOriginal<typeof import("../lib/config")>(), NETWORKS: { mainnet: { chainId: "gnoland-1", rpcUrl: "https://main.invalid" } }, GNO_CHAIN_ID: "gnoland-1", GNO_RPC_URL: "https://main.invalid" }))
vi.mock("../lib/dao/weighted", async importOriginal => ({ ...await importOriginal<typeof import("../lib/dao/weighted")>(), readWeightedSnapshot: vi.fn(), readWeightedBallot: vi.fn(), readWeightedProposal: vi.fn(), weightedWriteKinds: vi.fn() }))
vi.mock("../lib/dao/weightedAcceptance", async importOriginal => ({ ...await importOriginal<typeof import("../lib/dao/weightedAcceptance")>(), readAcceptanceStates: vi.fn() }))
vi.mock("../lib/dao/weightedWallet", () => ({ assertLiveWalletChain: vi.fn() }))
vi.mock("../lib/grc20", () => ({ doContractBroadcast: vi.fn() }))

const r = v12Native.records
const data = { config: weightedConfigSchema.parse(r.config), members: weightedMembersSchema.parse(r.members).members, page: weightedPageSchema.parse(r.proposals_page_1) } as Awaited<ReturnType<typeof readWeightedSnapshot>>
const member = data.members[1].address
const OTHER_REALM = "gno.land/r/samcrew/memba_dao_v2"
function App({ realm = weightedRealm }: { realm?: string }) {
    const context = { adena: { connected: true, address: member, chainId: "gnoland-1" }, auth: { isAuthenticated: true, address: member } }
    return <MemoryRouter initialEntries={[`/mainnet/weighted-dao/${realm}`]}><Routes><Route element={<Outlet context={context} />}><Route path="/:network/weighted-dao/*" element={<WeightedDAO />} /></Route></Routes></MemoryRouter>
}
const realKinds = (await vi.importActual<typeof import("../lib/dao/weighted")>("../lib/dao/weighted")).weightedWriteKinds
beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(weighted.weightedWriteKinds).mockImplementation(realKinds)
    vi.mocked(readWeightedSnapshot).mockResolvedValue(data)
    vi.mocked(readWeightedProposal).mockImplementation(async (_ctx, id) => data.page.proposals.find(p => p.id === id) as Awaited<ReturnType<typeof readWeightedProposal>>)
    vi.mocked(readWeightedBallot).mockImplementation(async (_ctx, proposalId, voter) => ({ schema: "memba-weighted-host/v12", proposalId, voter, eligible: true, choice: null, votedAtHeight: null }))
    vi.mocked(readAcceptanceStates).mockResolvedValue(Object.fromEntries(APPLICATION_POLICY_KEYS.map(key => [key, { kind: "ready", current: "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf" }])))
    vi.mocked(assertLiveWalletChain).mockResolvedValue({ chainId: "gnoland-1", address: member, rpcUrl: "" })
    vi.mocked(doContractBroadcast).mockImplementation(async (_msgs, _memo, opts) => { await opts?.beforeSign?.(); return { hash: "a".repeat(64) } })
})

async function expectEverythingHeld() {
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Propose acceptance" })).toHaveLength(10))
    await within(screen.getByRole("article", { name: "Proposal 17" })).findByText("You have not voted.")
    expect(screen.getByText(/Mainnet governance is read-only/)).toBeTruthy()
    expect(screen.getByText("Acceptance proposals stay disabled on mainnet until the governance write hold is lifted.")).toBeTruthy()
    const controls = screen.getAllByRole("button", { name: /^(Propose acceptance|Vote .*|Execute proposal)$/ })
    expect(controls.length).toBeGreaterThan(30)
    for (const button of controls) {
        expect(button.hasAttribute("disabled"), button.textContent ?? "").toBe(true)
        fireEvent.click(button)
    }
    expect(screen.getByLabelText("Member").closest("fieldset")?.disabled).toBe(true)
    expect(screen.queryByRole("group", { name: /Confirm execution/ })).toBeNull()
    expect(doContractBroadcast).not.toHaveBeenCalled()
}

it("lets a member vote on the released mainnet DAO with gnoland-1 active, with the live wallet check before signing", async () => {
    render(<App />)
    const card = await screen.findByRole("article", { name: "Proposal 17" })
    await within(card).findByText("You have not voted.")
    expect(screen.queryByText(/Mainnet governance is read-only/)).toBeNull()
    expect(screen.queryByText(/until the governance write hold is lifted/)).toBeNull()
    expect(weighted.weightedWriteKinds).toHaveBeenCalledWith("memba-weighted-host/v12", "gnoland-1", weightedRealm)
    const yes = within(card).getByRole("button", { name: "Vote yes" })
    expect(yes.hasAttribute("disabled")).toBe(false)
    fireEvent.click(yes)
    await screen.findByText(/Transaction submitted:/)
    const [msgs, , opts] = vi.mocked(doContractBroadcast).mock.calls[0]
    expect(msgs[0].value).toMatchObject({ caller: member, pkg_path: weightedRealm, func: "Vote", args: ["17", "yes"], send: "" })
    expect(opts?.retry).toBe(false)
    expect(assertLiveWalletChain).toHaveBeenCalledWith({ chainId: "gnoland-1", address: member, schema: "memba-weighted-host/v12", realmPath: weightedRealm })
})

it("holds every control of a v12 DAO that is not released, for a connected, authenticated member with gnoland-1 active", async () => {
    render(<App realm={OTHER_REALM} />)
    await expectEverythingHeld()
    expect(weighted.weightedWriteKinds).toHaveBeenCalledWith("memba-weighted-host/v12", "gnoland-1", OTHER_REALM)
})

it("keeps the page's own hold on an unreleased DAO even if the library's write kinds were to allow it", async () => {
    // Simulates a regression in weightedWriteKinds: only the page's hold remains.
    vi.mocked(weighted.weightedWriteKinds).mockReturnValue(new Set(["accept", "vote", "execute"]))
    render(<App realm={OTHER_REALM} />)
    await expectEverythingHeld()
})
