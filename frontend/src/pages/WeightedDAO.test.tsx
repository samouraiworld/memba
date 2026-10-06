import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from "react-router-dom"
import { useEffect } from "react"
import { beforeEach, expect, it, vi } from "vitest"
import { WeightedDAO } from "./WeightedDAO"
import { readWeightedBallot, readWeightedProposal, readWeightedSnapshot } from "../lib/dao/weighted"
import { doContractBroadcast } from "../lib/grc20"
import { WalletNetworkError } from "../lib/walletNetworkGuard"
import { V12_READ_ONLY, V12_READ_ONLY_OTHER } from "../lib/dao/weightedView"
import { bech32Encode } from "../lib/dao/realmAddress"
import { weightedFixture, weightedRealm } from "../lib/dao/testdata/weighted"
import v12Native from "../lib/dao/testdata/weighted-v12/native.json"
import { weightedConfigSchema, weightedMembersSchema, weightedPageSchema, weightedProposalSchema } from "../lib/dao/weighted"
import { readAcceptanceStates, weightedDaoAddress, type AcceptanceState } from "../lib/dao/weightedAcceptance"
import { APPLICATION_POLICY_KEYS, type ApplicationPolicyKey } from "../lib/dao/weightedApplications"
vi.mock("../lib/config", async importOriginal => ({ ...await importOriginal<typeof import("../lib/config")>(), NETWORKS: { pearl: { chainId: "pearl", rpcUrl: "https://selected.invalid" }, mainnet: { chainId: "gnoland-1", rpcUrl: "https://main.invalid" } }, GNO_CHAIN_ID: "pearl", GNO_RPC_URL: "https://selected.invalid" }))
vi.mock("../lib/dao/weighted", async importOriginal => ({ ...await importOriginal<typeof import("../lib/dao/weighted")>(), readWeightedSnapshot: vi.fn(), readWeightedProposal: vi.fn(), readWeightedBallot: vi.fn() }))
vi.mock("../lib/grc20", () => ({ doContractBroadcast: vi.fn() }))
vi.mock("../lib/dao/weightedAcceptance", async importOriginal => ({ ...await importOriginal<typeof import("../lib/dao/weightedAcceptance")>(), readAcceptanceStates: vi.fn() }))
let fixture = weightedFixture()
function snapshot() { return { config: fixture.config, members: fixture.members, page: fixture.page } as Awaited<ReturnType<typeof readWeightedSnapshot>> }
/** The router's navigate of the App last rendered, for tests that move the page itself. */
let go: (to: string) => void
function Navigator() {
    const navigate = useNavigate()
    useEffect(() => { go = navigate }, [navigate])
    return null
}
function App({ address = fixture.members[5].address, network = "pearl", connected = true, realm = weightedRealm }: { address?: string; network?: string; connected?: boolean; realm?: string }) {
    const context = { adena: { connected, address, chainId: network === "mainnet" ? "gnoland-1" : "pearl" }, auth: { isAuthenticated: true, address } }
    return <MemoryRouter initialEntries={[`/${network}/weighted-dao/${realm}`]}><Navigator /><Routes><Route element={<Outlet context={context} />}><Route path="/:network/weighted-dao/*" element={<WeightedDAO />} /></Route></Routes></MemoryRouter>
}
beforeEach(() => {
    vi.clearAllMocks(); fixture = weightedFixture()
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => snapshot())
    vi.mocked(readWeightedProposal).mockImplementation(async () => fixture.proposal as Awaited<ReturnType<typeof readWeightedProposal>>)
    vi.mocked(doContractBroadcast).mockImplementation(async (_msgs, _memo, opts) => { await opts?.beforeSign?.(); return { hash: "a".repeat(64) } })
    vi.mocked(readWeightedBallot).mockImplementation(async (_ctx, proposalId, voter) => ({ schema: "memba-weighted-host/v12", proposalId, voter, eligible: true, choice: null, votedAtHeight: null }))
    acceptance = Object.fromEntries(APPLICATION_POLICY_KEYS.map(key => [key, { current: DAO, pending: "", failed: [] }]))
    vi.mocked(readAcceptanceStates).mockImplementation(async () => Object.fromEntries(APPLICATION_POLICY_KEYS.map(key => [key, stateOf(key)])))
})
const DAO = weightedDaoAddress(weightedRealm)
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
    expect(readWeightedSnapshot).toHaveBeenCalledTimes(4)
})
it("reports the transaction when the browser address changed during signing but the page's own route did not", async () => {
    // Inside a Memba OS window the address bar follows the front window; the page stays on its route.
    const before = window.location.pathname
    vi.mocked(doContractBroadcast).mockImplementation(async (_msgs, _memo, opts) => {
        window.history.pushState({}, "", "/os/daos")
        await opts?.beforeSign?.()
        return { hash: "c".repeat(64) }
    })
    try {
        render(<App />)
        await screen.findByText(fixture.members[0].personId)
        fireEvent.click(screen.getByRole("button", { name: "Vote yes" }))
        expect(await screen.findByText(new RegExp(`^Transaction submitted: ${"c".repeat(64)}\\.`))).toBeTruthy()
        expect(screen.queryByRole("alert")).toBeNull()
    } finally { window.history.pushState({}, "", before) }
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
    expect(screen.getByText(/read-only in Memba on gnoland-1: Memba builds no governance transaction/)).toBeTruthy()
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
for (const [what, to] of [["another DAO", `/pearl/weighted-dao/${weightedRealm}_v2`], ["another network", `/mainnet/weighted-dao/${weightedRealm}`]] as const) {
    it(`rejects a prepared action if the page moves to ${what} while confirmation is open`, async () => {
        let beforeSign: (() => void | Promise<void>) | undefined
        let finish: (() => void | Promise<void>) | undefined
        vi.mocked(doContractBroadcast).mockImplementation((_msgs, _memo, opts) => new Promise((resolve, reject) => {
            beforeSign = opts?.beforeSign
            finish = async () => { try { await beforeSign?.(); resolve({ hash: "a".repeat(64) }) } catch (err) { reject(err) } }
        }))
        render(<App />)
        await screen.findByText(fixture.members[0].personId)
        fireEvent.click(screen.getByRole("button", { name: "Vote yes" }))
        await waitFor(() => expect(beforeSign).toBeTypeOf("function"))
        act(() => go(to))
        await expect(beforeSign?.()).rejects.toThrow("Wallet or page changed")
        await act(async () => finish?.())
        expect(screen.queryByText(/Transaction submitted:/)).toBeNull()
    })
}
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
it("renders the v12 adapter policies, categories, operations and frozen state read-only on mainnet when it is not the selected network", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    const data = v12Snapshot()
    render(<App network="mainnet" address={data.members[1].address} />)
    expect(await screen.findByRole("heading", { name: "Application adapters" })).toBeTruthy()
    expect(screen.getAllByRole("listitem", { name: /adapter$/ })).toHaveLength(10)
    expect(screen.getByText("Target: gno.land/r/samcrew/escrow_v4")).toBeTruthy()
    // Each adapter's rules come from the policy, in the same words as the Memba OS window.
    const escrow = screen.getByRole("listitem", { name: "escrowPolicy adapter" })
    expect(within(escrow).getByText("Financial votes cover settling disputes (refunding the client or paying the freelancer) and nominating the fallback fee recipient.")).toBeTruthy()
    expect(within(escrow).getByText("While the DAO controls it, any member can pause it at once; unpausing takes a financial vote.")).toBeTruthy()
    expect(within(escrow).getByText(`Handing it back takes a critical vote and goes only to ${data.config.schema === "memba-weighted-host/v12" ? data.config.escrowPolicy.successor : ""}, who must accept.`)).toBeTruthy()
    expect(within(screen.getByRole("listitem", { name: "appstorePolicy adapter" })).getByText("A fee vote can set at most 100 GNOT.")).toBeTruthy()
    expect(screen.getByText("7 seats · 8 voting points. The founder's seat carries 2 points; each developer's carries 1 point.")).toBeTruthy()
    const rule = (start: RegExp) => screen.getByText((_text, el) => el?.tagName === "P" && start.test(el.textContent ?? ""))
    expect(rule(/^Critical decisions \(role changes, key recoveries, authority handoffs and appointments\) pass with 6 points and at least 4 people, then 24 hours, or 5 developers, then 72 hours\.$/)).toBeTruthy()
    expect(rule(/^Financial decisions \(fees, treasuries, unpausing and escrow disputes\) pass with 5 points and at least 3 people and can execute as soon as they pass\.$/)).toBeTruthy()
    expect(rule(/^Routine decisions \(moderation\) pass with 3 points and at least 2 people and can execute as soon as they pass\.$/)).toBeTruthy()
    // Memba DAO is read-only in Memba: the page says so, once, instead of the network hold.
    expect(screen.getByText(V12_READ_ONLY)).toBeTruthy()
    expect(screen.queryByText(/Memba builds no governance transaction/)).toBeNull()
    const fee = screen.getByRole("article", { name: "Proposal 17" })
    expect(within(fee).getByRole("heading", { name: "Market config · Set a fee" })).toBeTruthy()
    expect(within(fee).getByText("Financial")).toBeTruthy()
    expect(within(fee).getByText("Ready to execute")).toBeTruthy()
    expect(within(fee).getByText("150")).toBeTruthy()
    expect(within(fee).getByText("State frozen at proposal time")).toBeTruthy()
    expect(within(fee).getByText("Pending admin")).toBeTruthy()
    expect(within(fee).getAllByText("Fee (basis points)")).toHaveLength(2)
    expect(within(fee).getByRole("note").textContent).toMatch(/invalidates every other outstanding proposal/)
    expect(within(fee).queryByRole("button")).toBeNull()
    const hide = screen.getByRole("article", { name: "Proposal 18" })
    expect(within(hide).getByText("Routine")).toBeTruthy()
    expect(within(hide).getByText(/Routine proposals can execute as soon as they pass/)).toBeTruthy()
    const room = screen.getByRole("article", { name: "Proposal 26" })
    expect(within(room).getByText("Critical")).toBeTruthy()
    expect(within(room).getByText(/Executable from \(points vote\)/)).toBeTruthy()
    expect(within(room).getByText(/Executable from \(developers' vote\)/)).toBeTruthy()
    expect(within(screen.getByRole("article", { name: "Proposal 14" })).queryByRole("note")).toBeNull()
    expect(screen.queryByRole("button", { name: /^(Vote |Execute|Propose|Review)/ })).toBeNull()
    expect(doContractBroadcast).not.toHaveBeenCalled()
})
it("says another v12 realm is read-only without claiming Memba DAO's move", async () => {
    const other = `${weightedRealm}_v2`
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => ({ ...v12Snapshot(), config: { ...v12Snapshot().config, realmPath: other } }))
    render(<App realm={other} address={v12Snapshot().members[1].address} />)
    expect(await screen.findByText(V12_READ_ONLY_OTHER)).toBeTruthy()
    expect(screen.queryByText(V12_READ_ONLY)).toBeNull()
    expect(screen.queryByRole("button", { name: /^(Vote |Execute|Propose|Review)/ })).toBeNull()
})
it("explains invalidated and executed v12 history on the older page", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot("proposals_page_2"))
    render(<App network="mainnet" />)
    const invalidated = await screen.findByRole("article", { name: "Proposal 2" })
    expect(within(invalidated).getByText(/^Invalidated at block \d+: proposal #4 executed \(gno\.land\/r\/samcrew\/memba_market_config\)\.$/)).toBeTruthy()
    const accept = screen.getByRole("article", { name: "Proposal 4" })
    expect(within(accept).getByRole("heading", { name: "Market config · Accept the handover" })).toBeTruthy()
    expect(within(accept).getByText("Historical vote totals are unavailable.")).toBeTruthy()
    expect(within(accept).queryByRole("note")).toBeNull()
})
it("builds nothing for v12 on a test network either: no proposal form, vote, execution or acceptance for a connected member", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    acceptance.marketPolicy = { current: PUBLISHER, pending: DAO, failed: [] }
    render(<App network="pearl" address={v12Snapshot().members[1].address} />)
    const fee = await screen.findByRole("article", { name: "Proposal 17" })
    expect(await within(adapterCard("marketPolicy")).findByText("Ready to accept")).toBeTruthy()
    expect(screen.getByText(V12_READ_ONLY)).toBeTruthy()
    expect(within(fee).queryByRole("button")).toBeNull()
    expect(screen.queryByLabelText("Member")).toBeNull()
    expect(screen.queryByLabelText("Recovery member")).toBeNull()
    expect(screen.getAllByRole("button").map(b => b.textContent)).toEqual(["Refresh chain state", "Older proposals"])
    expect(doContractBroadcast).not.toHaveBeenCalled()
})

const adapterCard = (key: ApplicationPolicyKey) => screen.getByRole("listitem", { name: `${key} adapter` })
it("shows each target's handoff state, and offers no acceptance even when the DAO is the pending authority", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    acceptance.marketPolicy = { current: PUBLISHER, pending: DAO, failed: [] }
    acceptance.questPolicy = { current: PUBLISHER, pending: "", failed: [] }
    acceptance.feedPolicy = { current: PUBLISHER, pending: DAO, failed: ["The current owner is still a feed moderator."] }
    acceptance.escrowPolicy = { current: DAO, pending: PUBLISHER, failed: [] }
    render(<App network="pearl" address={v12Snapshot().members[1].address} />)
    const market = await screen.findByRole("listitem", { name: "marketPolicy adapter" })
    expect(await within(market).findByText("Ready to accept")).toBeTruthy()
    expect(within(market).getByText(`The DAO is the pending admin. Current admin: ${PUBLISHER}.`)).toBeTruthy()
    expect(within(adapterCard("questPolicy")).getByText("Awaiting publisher nomination")).toBeTruthy()
    expect(within(adapterCard("questPolicy")).getByText(`The publisher must first nominate the DAO (${DAO}) as pending owner.`)).toBeTruthy()
    expect(within(adapterCard("feedPolicy")).getByText("The current owner is still a feed moderator.")).toBeTruthy()
    expect(within(adapterCard("escrowPolicy")).getByText("DAO controls")).toBeTruthy()
    expect(within(adapterCard("escrowPolicy")).getByText(`The DAO is the current admin. A handover back to ${PUBLISHER} is pending.`)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Propose acceptance" })).toBeNull()
    expect(screen.queryByText(/storage deposit|One open acceptance at a time|Next recommended/)).toBeNull()
    expect(doContractBroadcast).not.toHaveBeenCalled()
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
    expect(screen.getByRole("heading", { name: "Market config · Set a fee" })).toBeTruthy()
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
    expect(screen.queryByRole("button", { name: /^(Vote .*|Execute proposal)$/ })).toBeNull()
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
it("shows a wallet refusal as the wallet's own instruction, without the refresh-chain-state suffix", async () => {
    vi.mocked(doContractBroadcast).mockRejectedValue(new WalletNetworkError("Adena is locked — unlock it, then try again."))
    render(<App />)
    await screen.findByText(fixture.members[0].personId)
    fireEvent.click(screen.getByRole("button", { name: "Vote yes" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Adena is locked — unlock it, then try again.")
    expect(alert.textContent).not.toMatch(/Refresh chain state|No automatic retry|\.\./)
})
it("numbers the adapters in the handoff order", async () => {
    vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12Snapshot())
    render(<App network="pearl" address={v12Snapshot().members[1].address} />)
    await screen.findByRole("heading", { name: "Application adapters" })
    const cards = screen.getAllByRole("listitem", { name: /adapter$/ })
    expect(cards.map(c => c.getAttribute("aria-label"))).toEqual([
        "marketPolicy adapter", "badgesPolicy adapter", "feedPolicy adapter", "feedbackPolicy adapter", "channelsPolicy adapter",
        "reviewsPolicy adapter", "arcadePolicy adapter", "questPolicy adapter", "appstorePolicy adapter", "escrowPolicy adapter",
    ])
    expect(within(cards[0]).getByText(/^Handoff 1 of 10/)).toBeTruthy()
    expect(within(cards[9]).getByText(/^Handoff 10 of 10/)).toBeTruthy()
})
