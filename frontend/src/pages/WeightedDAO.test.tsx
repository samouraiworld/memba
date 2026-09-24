import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom"
import { beforeEach, expect, it, vi } from "vitest"
import { WeightedDAO } from "./WeightedDAO"
import { readOpenWeightedProposals, readWeightedBallot, readWeightedProposal, readWeightedSnapshot, type WeightedProposal } from "../lib/dao/weighted"
import { assertLiveWalletChain } from "../lib/dao/weightedWallet"
import { doContractBroadcast } from "../lib/grc20"
import { bech32Encode } from "../lib/dao/realmAddress"
import { weightedFixture, weightedRealm } from "../lib/dao/testdata/weighted"
import v12Native from "../lib/dao/testdata/weighted-v12/native.json"
import { weightedConfigSchema, weightedMembersSchema, weightedPageSchema, weightedProposalSchema } from "../lib/dao/weighted"
import { readAcceptanceStates, readTargetAuthority, weightedDaoAddress, type AcceptanceState } from "../lib/dao/weightedAcceptance"
import { APPLICATION_POLICY_KEYS, type ApplicationPolicyKey } from "../lib/dao/weightedApplications"
vi.mock("../lib/config", async importOriginal => ({ ...await importOriginal<typeof import("../lib/config")>(), NETWORKS: { pearl: { chainId: "pearl", rpcUrl: "https://selected.invalid" }, mainnet: { chainId: "gnoland-1", rpcUrl: "https://main.invalid" } }, GNO_CHAIN_ID: "pearl", GNO_RPC_URL: "https://selected.invalid" }))
vi.mock("../lib/dao/weighted", async importOriginal => ({ ...await importOriginal<typeof import("../lib/dao/weighted")>(), readWeightedSnapshot: vi.fn(), readWeightedProposal: vi.fn(), readWeightedBallot: vi.fn(), readOpenWeightedProposals: vi.fn() }))
vi.mock("../lib/dao/weightedWallet", () => ({ assertLiveWalletChain: vi.fn() }))
vi.mock("../lib/grc20", () => ({ doContractBroadcast: vi.fn() }))
vi.mock("../lib/dao/weightedAcceptance", async importOriginal => ({ ...await importOriginal<typeof import("../lib/dao/weightedAcceptance")>(), readAcceptanceStates: vi.fn(), readTargetAuthority: vi.fn() }))
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
    vi.mocked(readWeightedBallot).mockImplementation(async (_ctx, proposalId, voter) => ({ schema: "memba-weighted-host/v12", proposalId, voter, eligible: true, choice: null, votedAtHeight: null }))
    // Every open proposal: in these tests, the open ones of the snapshot's single page.
    vi.mocked(readOpenWeightedProposals).mockImplementation(async () => (await vi.mocked(readWeightedSnapshot)(ctxOf())).page.proposals
        .filter((p): p is WeightedProposal => !("unreadable" in p) && ["VOTING", "TIMELOCKED", "READY"].includes(p.status)))
    vi.mocked(assertLiveWalletChain).mockResolvedValue(undefined)
    acceptance = Object.fromEntries(APPLICATION_POLICY_KEYS.map(key => [key, { current: DAO, pending: "", failed: [] }]))
    vi.mocked(readTargetAuthority).mockImplementation(async (_ctx, key) => acceptance[key])
    vi.mocked(readAcceptanceStates).mockImplementation(async () => Object.fromEntries(APPLICATION_POLICY_KEYS.map(key => [key, stateOf(key)])))
})
const DAO = weightedDaoAddress(weightedRealm)
const ctxOf = () => ({ realmPath: weightedRealm, rpcUrl: "https://selected.invalid", chainId: "pearl" })
const PUBLISHER = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"
let acceptance: Record<string, { current: string; pending: string; failed: string[] }>
function stateOf(key: ApplicationPolicyKey): AcceptanceState {
    const r = acceptance[key]
    if (r.current === DAO) return { kind: "dao", pending: r.pending }
    if (r.pending !== DAO) return { kind: "awaiting", current: r.current, pending: r.pending }
    return r.failed.length ? { kind: "blocked", current: r.current, reasons: r.failed } : { kind: "ready", current: r.current }
}
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
    expect(screen.getByText("Target: gno.land/r/samcrew/escrow_v4")).toBeTruthy()
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
    expect(within(invalidated).getByText(/^Invalidated at block \d+: proposal #4 executed \(gno\.land\/r\/samcrew\/memba_market_config\)\.$/)).toBeTruthy()
    const accept = screen.getByRole("article", { name: "Proposal 4" })
    expect(within(accept).getByRole("heading", { name: "Market config · accept-admin" })).toBeTruthy()
    expect(within(accept).getByText("Historical vote totals are unavailable.")).toBeTruthy()
    expect(within(accept).queryByRole("note")).toBeNull()
})
it("enables only v12 acceptances, votes and execution on a test network, never role or recovery proposals", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    const data = v12Snapshot()
    render(<App network="pearl" address={data.members[1].address} />)
    expect(await screen.findByText(/Role proposals for this DAO version arrive in a later Memba release/)).toBeTruthy()
    expect(screen.getByLabelText("Member").closest("fieldset")?.disabled).toBe(true)
    expect(screen.getByLabelText("Recovery member").closest("fieldset")?.disabled).toBe(true)
    const fee = screen.getByRole("article", { name: "Proposal 17" })
    await waitFor(() => expect(within(fee).getByRole("button", { name: "Vote no" }).hasAttribute("disabled")).toBe(false))
    expect(within(fee).getByRole("button", { name: "Execute proposal" }).hasAttribute("disabled")).toBe(false)
    expect(within(screen.getByRole("article", { name: "Proposal 14" })).getByRole("button", { name: "Vote yes" }).hasAttribute("disabled")).toBe(true)
    expect(doContractBroadcast).not.toHaveBeenCalled()
})

const adapterCard = (key: ApplicationPolicyKey) => screen.getByRole("listitem", { name: `${key} adapter` })
it("shows each target's handoff state and offers acceptance only when the DAO is the pending authority", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    acceptance.marketPolicy = { current: PUBLISHER, pending: DAO, failed: [] }
    acceptance.questPolicy = { current: PUBLISHER, pending: "", failed: [] }
    acceptance.feedPolicy = { current: PUBLISHER, pending: DAO, failed: ["The current owner is still a feed moderator."] }
    acceptance.escrowPolicy = { current: DAO, pending: PUBLISHER, failed: [] }
    render(<App network="pearl" address={v12Snapshot().members[1].address} />)
    const market = await screen.findByRole("listitem", { name: "marketPolicy adapter" })
    expect(await within(market).findByText("Ready to accept")).toBeTruthy()
    expect(within(market).getByText("The proposal locks up to 2.13 GNOT of storage deposit from the proposer.")).toBeTruthy()
    expect(within(market).getByRole("button", { name: "Propose acceptance" }).hasAttribute("disabled")).toBe(false)
    expect(within(adapterCard("questPolicy")).getByText("Awaiting publisher nomination")).toBeTruthy()
    expect(within(adapterCard("questPolicy")).getByText(`The publisher must first nominate the DAO (${DAO}) as pending owner.`)).toBeTruthy()
    expect(within(adapterCard("feedPolicy")).getByText("The current owner is still a feed moderator.")).toBeTruthy()
    expect(within(adapterCard("escrowPolicy")).getByText("DAO controls")).toBeTruthy()
    expect(within(adapterCard("escrowPolicy")).getByText(`The DAO is the current admin. A return to ${PUBLISHER} is staged.`)).toBeTruthy()
    for (const key of ["questPolicy", "feedPolicy", "escrowPolicy", "badgesPolicy"] as const) expect(within(adapterCard(key)).queryByRole("button", { name: "Propose acceptance" })).toBeNull()
    expect(screen.getByText(/Hand the adapters over one at a time/)).toBeTruthy()

    fireEvent.click(within(market).getByRole("button", { name: "Propose acceptance" }))
    await screen.findByText(/Transaction submitted:/)
    const [msgs, memo, opts] = vi.mocked(doContractBroadcast).mock.calls[0]
    expect(msgs).toEqual([{ type: "vm/MsgCall", value: { caller: v12Snapshot().members[1].address, send: "", pkg_path: weightedRealm, func: "ProposeMarketAccept", args: [], max_deposit: "2130000ugnot" } }])
    expect(memo).toBe("Propose that the DAO accepts authority over gno.land/r/samcrew/memba_market_config")
    expect(opts).toMatchObject({ retry: false, gasWanted: 24_000_000 })
    // Checked once when preparing and again right before signing.
    expect(vi.mocked(readTargetAuthority).mock.calls.filter(c => c[1] === "marketPolicy")).toHaveLength(2)
})
it("refuses an acceptance whose nomination changed before signing", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    acceptance.marketPolicy = { current: PUBLISHER, pending: DAO, failed: [] }
    let check: (() => void | Promise<void>) | undefined
    vi.mocked(doContractBroadcast).mockImplementation((_msgs, _memo, opts) => { check = opts?.beforeSign; return new Promise(() => {}) })
    render(<App network="pearl" address={v12Snapshot().members[1].address} />)
    const market = await screen.findByRole("listitem", { name: "marketPolicy adapter" })
    fireEvent.click(await within(market).findByRole("button", { name: "Propose acceptance" }))
    await waitFor(() => expect(check).toBeTypeOf("function"))
    acceptance.marketPolicy = { current: PUBLISHER, pending: "", failed: [] }
    await expect(check?.()).rejects.toThrow("not ready for the DAO to accept")
})
it("keeps one acceptance open at a time", async () => {
    const data = v12Snapshot()
    const open = structuredClone(weightedProposalSchema.parse(v12Native.records.recovery_later).proposal)
    open.action = weightedProposalSchema.parse(v12Native.records.proposal_4).proposal.action
    open.id = "27"
    data.page = { ...data.page, total: "27", proposals: [open, ...data.page.proposals.slice(0, 19)] }
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => data)
    acceptance.badgesPolicy = { current: PUBLISHER, pending: DAO, failed: [] }
    render(<App network="pearl" address={data.members[1].address} />)
    const badges = await screen.findByRole("listitem", { name: "badgesPolicy adapter" })
    expect(await within(badges).findByText("Acceptance proposal #27 is still open. Propose this one after it executes or closes.")).toBeTruthy()
    expect(within(badges).getByRole("button", { name: "Propose acceptance" }).hasAttribute("disabled")).toBe(true)
})
it("renders every acceptance control disabled on mainnet and builds nothing", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    for (const key of APPLICATION_POLICY_KEYS) acceptance[key] = { current: PUBLISHER, pending: DAO, failed: [] }
    render(<App network="mainnet" address={v12Snapshot().members[1].address} />)
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Propose acceptance" })).toHaveLength(10))
    expect(screen.getByText(/Mainnet governance is read-only/)).toBeTruthy()
    expect(screen.getByText("Acceptance proposals stay disabled on mainnet until the governance write hold is lifted.")).toBeTruthy()
    for (const button of screen.getAllByRole("button", { name: /^(Propose acceptance|Vote .*|Execute proposal)$/ })) {
        expect(button.hasAttribute("disabled")).toBe(true)
        fireEvent.click(button)
    }
    expect(doContractBroadcast).not.toHaveBeenCalled()
})
it("offers a changed ballot but never the same one, and nothing to an ineligible voter", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    const voter = v12Snapshot().members[1].address
    vi.mocked(readWeightedBallot).mockImplementation(async (_ctx, proposalId, who) => proposalId === "18"
        ? { schema: "memba-weighted-host/v12", proposalId, voter: who, eligible: false, choice: null, votedAtHeight: null }
        : { schema: "memba-weighted-host/v12", proposalId, voter: who, eligible: true, choice: "yes", votedAtHeight: "77" })
    render(<App network="pearl" address={voter} />)
    const fee = await screen.findByRole("article", { name: "Proposal 17" })
    await within(fee).findByText("You voted yes (block 77).")
    const yes = within(fee).getByRole("button", { name: "Vote yes" })
    expect([yes.hasAttribute("disabled"), yes.getAttribute("aria-pressed")]).toEqual([true, "true"])
    expect(within(fee).getByText(/You can change your ballot until voting closes/)).toBeTruthy()
    for (const button of within(screen.getByRole("article", { name: "Proposal 18" })).getAllByRole("button", { name: /^Vote / })) expect(button.hasAttribute("disabled")).toBe(true)
    fireEvent.click(within(fee).getByRole("button", { name: "Vote no" }))
    await screen.findByText(/Transaction submitted:/)
    const [msgs, , opts] = vi.mocked(doContractBroadcast).mock.calls[0]
    expect(msgs[0].value).toMatchObject({ func: "Vote", args: ["17", "no"], max_deposit: "40000ugnot" })
    expect(opts).toMatchObject({ gasWanted: 24_800_000, retry: false })
})
it("refuses a repeated ballot found on chain before signing", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    render(<App network="pearl" address={v12Snapshot().members[1].address} />)
    const fee = await screen.findByRole("article", { name: "Proposal 17" })
    await waitFor(() => expect(within(fee).getByRole("button", { name: "Vote no" }).hasAttribute("disabled")).toBe(false))
    vi.mocked(readWeightedBallot).mockImplementation(async (_ctx, proposalId, who) => ({ schema: "memba-weighted-host/v12", proposalId, voter: who, eligible: true, choice: "no", votedAtHeight: "80" }))
    fireEvent.click(within(fee).getByRole("button", { name: "Vote no" }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/You already voted no/)
    expect(doContractBroadcast).not.toHaveBeenCalled()
})
it("warns which open proposals an execution invalidates before building it", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    const data = v12Snapshot()
    vi.mocked(readWeightedProposal).mockImplementation(async (_ctx, id) => data.page.proposals.find(p => p.id === id) as Awaited<ReturnType<typeof readWeightedProposal>>)
    render(<App network="pearl" address={data.members[1].address} />)
    const fee = await screen.findByRole("article", { name: "Proposal 17" })
    fireEvent.click(await within(fee).findByRole("button", { name: "Execute proposal" }))
    const confirm = within(fee).getByRole("group", { name: "Confirm execution of proposal 17" })
    const open = data.page.proposals.filter(p => !("unreadable" in p) && ["VOTING", "TIMELOCKED", "READY"].includes(p.status) && p.id !== "17").map(p => `#${p.id}`)
    expect(open.length).toBeGreaterThan(1)
    expect(within(confirm).getByText(`Executing #17 invalidates ${open.length} open proposals ${open.join(", ")}. They cannot be revived; their proposers would need to propose again.`)).toBeTruthy()
    expect(doContractBroadcast).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole("button", { name: "Keep proposals open" }))
    expect(within(fee).queryByRole("group", { name: "Confirm execution of proposal 17" })).toBeNull()
    fireEvent.click(within(fee).getByRole("button", { name: "Execute proposal" }))
    fireEvent.click(within(fee).getByRole("button", { name: "Confirm execution" }))
    await screen.findByText(/Transaction submitted:/)
    const [msgs, , opts] = vi.mocked(doContractBroadcast).mock.calls[0]
    expect(msgs[0].value).toMatchObject({ func: "Execute", args: ["17"], max_deposit: "190000ugnot" })
    expect(opts).toMatchObject({ gasWanted: 41_000_000 })
})
it("re-reads the target after executing an acceptance and reports the handoff", async () => {
    const data = v12Snapshot()
    const ready = structuredClone(weightedProposalSchema.parse(v12Native.records.recovery_later).proposal)
    ready.action = weightedProposalSchema.parse(v12Native.records.proposal_4).proposal.action
    ready.id = "27"
    data.page = { ...data.page, total: "27", proposals: [ready] }
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => data)
    vi.mocked(readWeightedProposal).mockImplementation(async () => ready as Awaited<ReturnType<typeof readWeightedProposal>>)
    acceptance.marketPolicy = { current: PUBLISHER, pending: DAO, failed: [] }
    vi.mocked(doContractBroadcast).mockImplementation(async (_msgs, _memo, opts) => { await opts?.beforeSign?.(); acceptance.marketPolicy = { current: DAO, pending: "", failed: [] }; return { hash: "b".repeat(64) } })
    render(<App network="pearl" address={data.members[1].address} />)
    const card = await screen.findByRole("article", { name: "Proposal 27" })
    fireEvent.click(await within(card).findByRole("button", { name: "Execute proposal" }))
    expect(within(card).getByText("Executing #27 invalidates every other open proposal.")).toBeTruthy()
    fireEvent.click(within(card).getByRole("button", { name: "Confirm execution" }))
    expect(await screen.findByText(`Transaction submitted: ${"b".repeat(64)}. gno.land/r/samcrew/memba_market_config now names the DAO as its admin.`)).toBeTruthy()
    expect(vi.mocked(doContractBroadcast).mock.calls[0][2]).toMatchObject({ gasWanted: 44_700_000 })
    expect(vi.mocked(doContractBroadcast).mock.calls[0][0][0].value.max_deposit).toBe("230000ugnot")
})
it("lists an unreadable proposal by ID and keeps the rest of the page", async () => {
    const data = v12Snapshot()
    data.page.proposals[2] = { id: data.page.proposals[2].id, unreadable: true }
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => data)
    render(<App network="mainnet" />)
    const item = await screen.findByRole("article", { name: "Proposal 24" })
    expect(within(item).getByRole("heading", { name: "Unreadable proposal #24" })).toBeTruthy()
    expect(within(item).queryByRole("button")).toBeNull()
    expect(screen.getAllByRole("article")).toHaveLength(20)
    expect(screen.getByRole("heading", { name: "Market config · set-fee" })).toBeTruthy()
})
it("reveals bidi and zero-width characters in realm-controlled text", async () => {
    const r = v12Native.records as unknown as Record<string, { proposal: { action: Record<string, unknown> } }>
    const reject = structuredClone(r["op:appstore:reject"])
    reject.proposal.action.path = "gno.land/r/samcrew/app\u202Egpj.exe"
    reject.proposal.action.reason = "looks\u200Bfine"
    const before = reject.proposal.action.before as { listing: Record<string, unknown> }
    before.listing.status = "pen\u2066ding"
    const room = structuredClone(r["op:channels:create-text-channel"])
    room.proposal.action.description = "room\u200Dnotes"
    const parse = (x: unknown) => weightedProposalSchema.parse(x).proposal
    const data = v12Snapshot()
    data.members[0] = { ...data.members[0], personId: "zx\u202Exma" }
    data.page = { ...data.page, proposals: [parse(reject), parse(room)] }
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => data)
    const view = render(<App network="mainnet" />)
    expect(await screen.findByText("gno.land/r/samcrew/app[U+202E]gpj.exe")).toBeTruthy()
    expect(screen.getByText("looks[U+200B]fine")).toBeTruthy()
    expect(screen.getByText("pen[U+2066]ding")).toBeTruthy()
    expect(screen.getByText("room[U+200D]notes")).toBeTruthy()
    expect(screen.getAllByText("zx[U+202E]xma").length).toBeGreaterThan(0)
    expect(view.container.textContent).not.toMatch(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/)
})

it("shows the connected member's own ballot on each v12 proposal, read-only", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    const data = v12Snapshot()
    const voter = data.members[1].address
    vi.mocked(readWeightedBallot).mockImplementation(async (_ctx, proposalId, who) => {
        if (proposalId === "17") return { schema: "memba-weighted-host/v12", proposalId, voter: who, eligible: true, choice: "yes", votedAtHeight: "123" }
        if (proposalId === "18") return { schema: "memba-weighted-host/v12", proposalId, voter: who, eligible: false, choice: null, votedAtHeight: null }
        if (proposalId === "19") throw new Error("read failed")
        return { schema: "memba-weighted-host/v12", proposalId, voter: who, eligible: true, choice: null, votedAtHeight: null }
    })
    render(<App network="mainnet" address={voter} />)
    const fee = await screen.findByRole("article", { name: "Proposal 17" })
    expect(await within(fee).findByText("You voted yes (block 123).")).toBeTruthy()
    expect(within(screen.getByRole("article", { name: "Proposal 18" })).getByText("Your address is not eligible to vote on this proposal.")).toBeTruthy()
    expect(within(screen.getByRole("article", { name: "Proposal 19" })).getByText("Your ballot could not be read.")).toBeTruthy()
    expect(within(screen.getByRole("article", { name: "Proposal 20" })).getByText("You have not voted.")).toBeTruthy()
    expect(within(screen.getByRole("article", { name: "Proposal 14" })).getByText("You did not vote.")).toBeTruthy()
    expect(vi.mocked(readWeightedBallot).mock.calls.every(c => c[2] === voter)).toBe(true)
    for (const button of screen.getAllByRole("button", { name: /^(Vote .*|Execute proposal)$/ })) expect(button.hasAttribute("disabled")).toBe(true)
})
it("reads no ballots without a connected wallet or for older contract versions", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    render(<App network="mainnet" connected={false} />)
    await screen.findByRole("article", { name: "Proposal 17" })
    expect(readWeightedBallot).not.toHaveBeenCalled()
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => snapshot())
    render(<App />)
    await screen.findByRole("article", { name: "Proposal 1" })
    expect(readWeightedBallot).not.toHaveBeenCalled()
})
it("explains a pause invalidation with the paused realm", async () => {
    const r = v12Native.records as unknown as Record<string, unknown>
    const data = v12Snapshot()
    data.page = { ...data.page, proposals: [weightedProposalSchema.parse(r.proposal_invalidated_by_pause).proposal] }
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => data)
    render(<App network="mainnet" />)
    expect(await screen.findByText(/^Invalidated at block \d+: a member paused gno\.land\/r\/samcrew\/gnobuilders_badges_v2\.$/)).toBeTruthy()
})
it("refuses to execute an acceptance whose nomination was withdrawn", async () => {
    const data = v12Snapshot()
    const ready = structuredClone(weightedProposalSchema.parse(v12Native.records.recovery_later).proposal)
    ready.action = weightedProposalSchema.parse(v12Native.records.proposal_4).proposal.action
    ready.id = "27"
    data.page = { ...data.page, total: "27", proposals: [ready] }
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => data)
    vi.mocked(readWeightedProposal).mockImplementation(async () => ready as Awaited<ReturnType<typeof readWeightedProposal>>)
    acceptance.marketPolicy = { current: PUBLISHER, pending: "", failed: [] }
    render(<App network="pearl" address={data.members[1].address} />)
    const card = await screen.findByRole("article", { name: "Proposal 27" })
    fireEvent.click(await within(card).findByRole("button", { name: "Execute proposal" }))
    fireEvent.click(within(card).getByRole("button", { name: "Confirm execution" }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/no longer names the DAO as its pending admin/)
    expect(doContractBroadcast).not.toHaveBeenCalled()
})
it("checks the wallet's live network right before signing a v12 call, and stops if it moved", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    acceptance.marketPolicy = { current: PUBLISHER, pending: DAO, failed: [] }
    vi.mocked(assertLiveWalletChain).mockRejectedValue(new Error("Your wallet is on gnoland-1, where governance writes remain on hold"))
    const voter = v12Snapshot().members[1].address
    render(<App network="pearl" address={voter} />)
    const market = await screen.findByRole("listitem", { name: "marketPolicy adapter" })
    fireEvent.click(await within(market).findByRole("button", { name: "Propose acceptance" }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/where governance writes remain on hold/)
    expect(assertLiveWalletChain).toHaveBeenCalledWith({ chainId: "pearl", address: voter })
    expect(screen.queryByText(/Transaction submitted:/)).toBeNull()
})
it("finds an open acceptance on an older page before proposing another", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    acceptance.marketPolicy = { current: PUBLISHER, pending: DAO, failed: [] }
    const older = structuredClone(weightedProposalSchema.parse(v12Native.records.recovery_later).proposal)
    older.action = weightedProposalSchema.parse(v12Native.records.proposal_5).proposal.action
    older.id = "3"
    vi.mocked(readOpenWeightedProposals).mockResolvedValue([older])
    render(<App network="pearl" address={v12Snapshot().members[1].address} />)
    const market = await screen.findByRole("listitem", { name: "marketPolicy adapter" })
    fireEvent.click(await within(market).findByRole("button", { name: "Propose acceptance" }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/Acceptance proposal #3 is still open/)
    expect(doContractBroadcast).not.toHaveBeenCalled()
})
for (const [label, read, reason] of [
    ["the DAO already controls the target", { current: "DAO", pending: "", failed: [] }, /The DAO already controls gno\.land\/r\/samcrew\/memba_market_config/],
    ["a host precondition fails", { current: PUBLISHER, pending: "DAO", failed: ["The current owner is still a feed moderator."] }, /would refuse this acceptance: The current owner is still a feed moderator\./],
] as const) it(`names the real reason an acceptance cannot execute: ${label}`, async () => {
    const data = v12Snapshot()
    const ready = structuredClone(weightedProposalSchema.parse(v12Native.records.recovery_later).proposal)
    ready.action = weightedProposalSchema.parse(v12Native.records.proposal_4).proposal.action
    ready.id = "27"
    data.page = { ...data.page, total: "27", proposals: [ready] }
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => data)
    vi.mocked(readWeightedProposal).mockImplementation(async () => ready as Awaited<ReturnType<typeof readWeightedProposal>>)
    acceptance.marketPolicy = { current: read.current === "DAO" ? DAO : read.current, pending: read.pending === "DAO" ? DAO : read.pending, failed: [...read.failed] }
    render(<App network="pearl" address={data.members[1].address} />)
    const card = await screen.findByRole("article", { name: "Proposal 27" })
    fireEvent.click(await within(card).findByRole("button", { name: "Execute proposal" }))
    fireEvent.click(within(card).getByRole("button", { name: "Confirm execution" }))
    expect((await screen.findByRole("alert")).textContent).toMatch(reason)
    expect(doContractBroadcast).not.toHaveBeenCalled()
})
