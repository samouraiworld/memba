// The page with gnoland-1 as the ACTIVE network (GNO_CHAIN_ID / GNO_RPC_URL),
// and a connected, authenticated member whose wallet is on gnoland-1: the one
// setup where only the governance write hold keeps controls disabled.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom"
import { beforeEach, expect, it, vi } from "vitest"
import { WeightedDAO } from "./WeightedDAO"
import * as weighted from "../lib/dao/weighted"
import { readWeightedBallot, readWeightedSnapshot, weightedConfigSchema, weightedMembersSchema, weightedPageSchema } from "../lib/dao/weighted"
import { readAcceptanceStates } from "../lib/dao/weightedAcceptance"
import { APPLICATION_POLICY_KEYS } from "../lib/dao/weightedApplications"
import { doContractBroadcast } from "../lib/grc20"
import { weightedRealm } from "../lib/dao/testdata/weighted"
import v12Native from "../lib/dao/testdata/weighted-v12/native.json"
vi.mock("../lib/config", async importOriginal => ({ ...await importOriginal<typeof import("../lib/config")>(), NETWORKS: { mainnet: { chainId: "gnoland-1", rpcUrl: "https://main.invalid" } }, GNO_CHAIN_ID: "gnoland-1", GNO_RPC_URL: "https://main.invalid" }))
vi.mock("../lib/dao/weighted", async importOriginal => ({ ...await importOriginal<typeof import("../lib/dao/weighted")>(), readWeightedSnapshot: vi.fn(), readWeightedBallot: vi.fn(), weightedWriteKinds: vi.fn() }))
vi.mock("../lib/dao/weightedAcceptance", async importOriginal => ({ ...await importOriginal<typeof import("../lib/dao/weightedAcceptance")>(), readAcceptanceStates: vi.fn() }))
vi.mock("../lib/grc20", () => ({ doContractBroadcast: vi.fn() }))

const r = v12Native.records
const data = { config: weightedConfigSchema.parse(r.config), members: weightedMembersSchema.parse(r.members).members, page: weightedPageSchema.parse(r.proposals_page_1) } as Awaited<ReturnType<typeof readWeightedSnapshot>>
const member = data.members[1].address
function App() {
    const context = { adena: { connected: true, address: member, chainId: "gnoland-1" }, auth: { isAuthenticated: true, address: member } }
    return <MemoryRouter initialEntries={[`/mainnet/weighted-dao/${weightedRealm}`]}><Routes><Route element={<Outlet context={context} />}><Route path="/:network/weighted-dao/*" element={<WeightedDAO />} /></Route></Routes></MemoryRouter>
}
const realKinds = (await vi.importActual<typeof import("../lib/dao/weighted")>("../lib/dao/weighted")).weightedWriteKinds
beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(weighted.weightedWriteKinds).mockImplementation(realKinds)
    vi.mocked(readWeightedSnapshot).mockResolvedValue(data)
    vi.mocked(readWeightedBallot).mockImplementation(async (_ctx, proposalId, voter) => ({ schema: "memba-weighted-host/v12", proposalId, voter, eligible: true, choice: null, votedAtHeight: null }))
    vi.mocked(readAcceptanceStates).mockResolvedValue(Object.fromEntries(APPLICATION_POLICY_KEYS.map(key => [key, { kind: "ready", current: "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf" }])))
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

it("holds every v12 control for a connected, authenticated member with gnoland-1 active", async () => {
    render(<App />)
    await expectEverythingHeld()
    expect(weighted.weightedWriteKinds).toHaveBeenCalledWith("memba-weighted-host/v12", "gnoland-1")
})

it("keeps the page's own hold even if the library's write kinds were to allow gnoland-1", async () => {
    // Simulates a regression in weightedWriteKinds: only the page's hold remains.
    vi.mocked(weighted.weightedWriteKinds).mockReturnValue(new Set(["accept", "vote", "execute"]))
    render(<App />)
    await expectEverythingHeld()
})
