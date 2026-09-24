import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom"
import { beforeEach, expect, it, vi } from "vitest"
import { WeightedDAO } from "./WeightedDAO"
import { readWeightedProposal, readWeightedSnapshot } from "../lib/dao/weighted"
import { doContractBroadcast } from "../lib/grc20"
import { bech32Encode } from "../lib/dao/realmAddress"
import { weightedFixture, weightedRealm } from "../lib/dao/testdata/weighted"
import v12Native from "../lib/dao/testdata/weighted-v12/native.json"
import { weightedConfigSchema, weightedMembersSchema, weightedPageSchema } from "../lib/dao/weighted"
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
    vi.mocked(doContractBroadcast).mockImplementation(async (_msgs, _memo, opts) => { await opts?.beforeSign?.(); return { hash: "a".repeat(64) } })
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
    expect(readWeightedSnapshot).toHaveBeenCalledTimes(4)
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
    let beforeSign: (() => void | Promise<void>) | undefined
    let finish: (() => void | Promise<void>) | undefined
    vi.mocked(doContractBroadcast).mockImplementation((_msgs, _memo, opts) => new Promise((resolve, reject) => {
        beforeSign = opts?.beforeSign
        finish = async () => { try { await beforeSign?.(); resolve({ hash: "a".repeat(64) }) } catch (err) { reject(err) } }
    }))
    const view = render(<App />)
    await screen.findByText(fixture.members[0].personId)
    fireEvent.click(screen.getByRole("button", { name: "Vote yes" }))
    await waitFor(() => expect(beforeSign).toBeTypeOf("function"))
    view.rerender(<App address={fixture.members[6].address} />)
    await screen.findByText(fixture.members[0].personId)
    await expect(beforeSign?.()).rejects.toThrow("changed")
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
    let check: (() => void | Promise<void>) | undefined
    vi.mocked(doContractBroadcast).mockImplementation((_msgs, _memo, opts) => { check = opts?.beforeSign; return new Promise(() => {}) })
    const view = render(<App />)
    await screen.findByText(fixture.members[0].personId)
    fireEvent.click(screen.getByRole("button", { name: "Vote yes" }))
    await waitFor(() => expect(check).toBeTypeOf("function"))
    view.rerender(<App connected={false} />)
    await expect(check?.()).rejects.toThrow("changed")
})

const replacement = bech32Encode("g", new Uint8Array(20).fill(9))
it("shows recovery only for v2 and builds the exact reviewed person/old/new action", async () => {
    fixture = weightedFixture(2)
    render(<App />)
    await screen.findByText(fixture.members[0].personId)
    fireEvent.change(screen.getByLabelText("Recovery member"), { target: { value: fixture.members[0].address } })
    fireEvent.change(screen.getByLabelText("Replacement Gno address"), { target: { value: replacement } })
    fireEvent.click(screen.getByRole("button", { name: "Review key recovery proposal" }))
    await screen.findByText(/Transaction submitted:/)
    expect(vi.mocked(doContractBroadcast).mock.calls[0][0][0].value).toMatchObject({ func: "ProposeRecovery", args: [fixture.members[0].personId, fixture.members[0].address, replacement], send: "" })
})
it("rejects a removed member or changed roles during confirmation without signing", async () => {
    fixture = weightedFixture(2)
    let check: (() => void | Promise<void>) | undefined
    vi.mocked(doContractBroadcast).mockImplementation((_msgs, _memo, opts) => { check = opts?.beforeSign; return new Promise(() => {}) })
    render(<App />)
    await screen.findByText(fixture.members[0].personId)
    fireEvent.click(screen.getByRole("button", { name: "Vote yes" }))
    await waitFor(() => expect(check).toBeTypeOf("function"))
    const changed = structuredClone(snapshot()); changed.members[5].address = replacement
    vi.mocked(readWeightedSnapshot).mockResolvedValue(changed)
    await expect(check?.()).rejects.toThrow("roster or roles changed")
    expect(screen.queryByText(/Transaction submitted:/)).toBeNull()
})
it("shows exact former addresses in recovery history without restoring their controls", async () => {
    fixture = weightedFixture(2)
    fixture.proposal.action = { type: "recover-member", personId: fixture.members[0].personId, oldAddress: fixture.members[0].address, newAddress: replacement }
    fixture.proposal.status = "EXECUTED"; fixture.proposal.talliesAvailable = false
    fixture.proposal.weightYes = fixture.proposal.peopleYes = fixture.proposal.developersYes = null
    render(<App />)
    expect(await screen.findByText(`Old address: ${fixture.members[0].address}`)).toBeTruthy()
    expect(screen.getByText(`Replacement address: ${replacement}`)).toBeTruthy()
    expect(screen.getByText("Historical vote totals are unavailable.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Vote yes" }).hasAttribute("disabled")).toBe(true)
})

function v12Snapshot(page: "proposals_page_1" | "proposals_page_2" = "proposals_page_1") {
    const r = v12Native.records
    return { config: weightedConfigSchema.parse(r.config), members: weightedMembersSchema.parse(r.members).members, page: weightedPageSchema.parse(r[page]) } as Awaited<ReturnType<typeof readWeightedSnapshot>>
}
it("renders the v12 adapter policies, categories, operations and frozen state read-only on mainnet", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    const data = v12Snapshot()
    render(<App network="mainnet" address={data.members[1].address} />)
    expect(await screen.findByRole("heading", { name: "Application adapters" })).toBeTruthy()
    expect(screen.getAllByRole("listitem", { name: /adapter$/ })).toHaveLength(10)
    expect(screen.getByText("Target: gno.land/r/samcrew/escrow_v3")).toBeTruthy()
    expect(screen.getByText(/Financial actions .* require/)).toBeTruthy()
    expect(screen.getByText(/Routine moderation requires/)).toBeTruthy()
    expect(screen.getByText(/Mainnet governance is read-only/)).toBeTruthy()
    const fee = screen.getByRole("article", { name: "Proposal 17" })
    expect(within(fee).getByRole("heading", { name: "Market config · set-fee" })).toBeTruthy()
    expect(within(fee).getByText("Financial")).toBeTruthy()
    expect(within(fee).getByText("READY")).toBeTruthy()
    expect(within(fee).getByText("150")).toBeTruthy()
    expect(within(fee).getByText("State frozen at proposal time")).toBeTruthy()
    expect(within(fee).getByText("pendingAdmin")).toBeTruthy()
    expect(within(fee).getAllByText("bps")).toHaveLength(2)
    expect(within(fee).getByRole("note").textContent).toMatch(/invalidates every other outstanding proposal/)
    expect(within(fee).getByRole("button", { name: "Execute proposal" }).hasAttribute("disabled")).toBe(true)
    const hide = screen.getByRole("article", { name: "Proposal 18" })
    expect(within(hide).getByText("Routine")).toBeTruthy()
    expect(within(hide).getByText(/Routine proposals can execute as soon as they qualify/)).toBeTruthy()
    const room = screen.getByRole("article", { name: "Proposal 26" })
    expect(within(room).getByText("Critical")).toBeTruthy()
    expect(within(room).getByText(/Weighted route matures/)).toBeTruthy()
    expect(within(room).getByText(/Developer route matures/)).toBeTruthy()
    expect(within(screen.getByRole("article", { name: "Proposal 14" })).queryByRole("note")).toBeNull()
    for (const button of screen.getAllByRole("button", { name: /^Vote / })) expect(button.hasAttribute("disabled")).toBe(true)
    expect(doContractBroadcast).not.toHaveBeenCalled()
})
it("explains invalidated and executed v12 history on the older page", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot("proposals_page_2"))
    render(<App network="mainnet" />)
    const invalidated = await screen.findByRole("article", { name: "Proposal 2" })
    expect(within(invalidated).getByText(/another proposal executed, or an emergency pause ran/)).toBeTruthy()
    const accept = screen.getByRole("article", { name: "Proposal 4" })
    expect(within(accept).getByRole("heading", { name: "Market config · accept-admin" })).toBeTruthy()
    expect(within(accept).getByText("Historical vote totals are unavailable.")).toBeTruthy()
    expect(within(accept).queryByRole("note")).toBeNull()
})
