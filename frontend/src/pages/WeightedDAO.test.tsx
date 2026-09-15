import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom"
import { beforeEach, expect, it, vi } from "vitest"
import { WeightedDAO } from "./WeightedDAO"
import { readWeightedProposal, readWeightedSnapshot } from "../lib/dao/weighted"
import { doContractBroadcast } from "../lib/grc20"
import { weightedFixture, weightedRealm } from "../lib/dao/testdata/weighted"
vi.mock("../lib/config", () => ({ NETWORKS: { pearl: { chainId: "pearl", rpcUrl: "https://selected.invalid" }, mainnet: { chainId: "gnoland-1", rpcUrl: "https://main.invalid" } }, GNO_CHAIN_ID: "pearl", GNO_RPC_URL: "https://selected.invalid" }))
vi.mock("../lib/dao/weighted", async importOriginal => ({ ...await importOriginal<typeof import("../lib/dao/weighted")>(), readWeightedSnapshot: vi.fn(), readWeightedProposal: vi.fn() }))
vi.mock("../lib/grc20", () => ({ doContractBroadcast: vi.fn() }))
let fixture = weightedFixture()
function snapshot() { return { config: fixture.config, members: fixture.members, page: fixture.page } as Awaited<ReturnType<typeof readWeightedSnapshot>> }
function App({ address = fixture.members[5].address, network = "pearl", connected = true }: { address?: string; network?: string; connected?: boolean }) {
    const context = { adena: { connected, address, chainId: network === "mainnet" ? "gnoland-1" : "pearl" }, auth: { isAuthenticated: true, address } }
    return <MemoryRouter initialEntries={[`/${network}/weighted-dao/${weightedRealm}`]}><Routes><Route element={<Outlet context={context} />}><Route path="/:network/weighted-dao/*" element={<WeightedDAO />} /></Route></Routes></MemoryRouter>
}
beforeEach(() => {
    vi.clearAllMocks(); fixture = weightedFixture()
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => snapshot())
    vi.mocked(readWeightedProposal).mockImplementation(async () => fixture.proposal as Awaited<ReturnType<typeof readWeightedProposal>>)
    vi.mocked(doContractBroadcast).mockImplementation(async (_msgs, _memo, opts) => { opts?.beforeSign?.(); return { hash: "a".repeat(64) } })
})
it("shows seven people, 2/1 weights and exact role actions without a percent threshold", async () => {
    render(<App />)
    expect(await screen.findByText(fixture.members[0].personId)).toBeTruthy()
    expect(screen.getByText("Founder · 2 points")).toBeTruthy()
    expect(screen.getAllByText("Core developer · 1 point")).toHaveLength(6)
    const p = screen.getByRole("article", { name: "Proposal 1" })
    expect(within(p).getByText(`Target: ${fixture.members[1].address}`)).toBeTruthy()
    expect(within(p).getByText("2 points · 1 person · 0 developers voting yes")).toBeTruthy()
    expect(within(p).getByRole("button", { name: "Execute proposal" }).hasAttribute("disabled")).toBe(true)
})
it("allows a developer without admin labels to propose governed role changes", async () => {
    render(<App />)
    await screen.findByText(fixture.members[0].personId)
    fireEvent.change(screen.getByLabelText("Member"), { target: { value: fixture.members[1].address } })
    fireEvent.click(screen.getByRole("button", { name: "Review role proposal" }))
    await screen.findByText(/Transaction submitted:/)
    expect(vi.mocked(doContractBroadcast).mock.calls[0][0][0].value).toMatchObject({ func: "ProposeRole", args: [fixture.members[1].address, "admin", "true"], send: "" })
    expect(vi.mocked(doContractBroadcast).mock.calls[0][2]?.retry).toBe(false)
    expect(readWeightedSnapshot).toHaveBeenCalledTimes(3)
})
it("refuses a stale proposal before broadcasting and retains unavailable historical tallies", async () => {
    render(<App />)
    await screen.findByText(fixture.members[0].personId)
    vi.mocked(readWeightedProposal).mockResolvedValueOnce({ ...fixture.proposal, votingClosed: true, status: "EXPIRED" } as Awaited<ReturnType<typeof readWeightedProposal>>)
    fireEvent.click(screen.getByRole("button", { name: "Vote yes" }))
    await screen.findByRole("alert")
    expect(doContractBroadcast).not.toHaveBeenCalled()
})
it("blocks writes on mainnet even for authenticated members", async () => {
    render(<App network="mainnet" />)
    await screen.findByText(fixture.members[0].personId)
    expect(screen.getByText(/Mainnet governance is read-only/)).toBeTruthy()
    for (const name of ["Vote yes", "Execute proposal"]) expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByLabelText("Member").closest("fieldset")?.disabled).toBe(true)
    expect(doContractBroadcast).not.toHaveBeenCalled()
})
it("rejects a prepared action if the wallet changes while confirmation is open", async () => {
    let beforeSign: (() => void) | undefined
    let finish: (() => void) | undefined
    vi.mocked(doContractBroadcast).mockImplementation((_msgs, _memo, opts) => new Promise((resolve, reject) => {
        beforeSign = opts?.beforeSign
        finish = () => { try { beforeSign?.(); resolve({ hash: "a".repeat(64) }) } catch (err) { reject(err) } }
    }))
    const view = render(<App />)
    await screen.findByText(fixture.members[0].personId)
    fireEvent.click(screen.getByRole("button", { name: "Vote yes" }))
    await waitFor(() => expect(beforeSign).toBeTypeOf("function"))
    view.rerender(<App address={fixture.members[6].address} />)
    await screen.findByText(fixture.members[0].personId)
    expect(() => beforeSign?.()).toThrow("changed")
    await act(async () => finish?.())
    expect(screen.queryByText(/Transaction submitted:/)).toBeNull()
})
it("does not display prior-wallet read results after a switch", async () => {
    let resolve: ((value: Awaited<ReturnType<typeof readWeightedSnapshot>>) => void) | undefined
    vi.mocked(readWeightedSnapshot).mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const view = render(<App />)
    await waitFor(() => expect(readWeightedSnapshot).toHaveBeenCalledTimes(1))
    view.rerender(<App address={fixture.members[6].address} />)
    await screen.findByText(fixture.members[0].personId)
    const old = structuredClone(snapshot()); old.members[0].personId = "Stale identity"
    await act(async () => resolve?.(old))
    expect(screen.queryByText("Stale identity")).toBeNull()
})


it("invalidates confirmation when disconnected even if the address is retained", async () => {
    let check: (() => void) | undefined
    vi.mocked(doContractBroadcast).mockImplementation((_msgs, _memo, opts) => { check = opts?.beforeSign; return new Promise(() => {}) })
    const view = render(<App />)
    await screen.findByText(fixture.members[0].personId)
    fireEvent.click(screen.getByRole("button", { name: "Vote yes" }))
    await waitFor(() => expect(check).toBeTypeOf("function"))
    view.rerender(<App connected={false} />)
    expect(() => check?.()).toThrow("changed")
})
