import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const SIGNER = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const PATH = `gno.land/r/${SIGNER}/mainnet_dao`

const mocks = vi.hoisted(() => ({
    org: null as string | null,
    address: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c",
    broadcast: vi.fn(),
    navigate: vi.fn(),
    save: vi.fn(),
    saveOrg: vi.fn(),
    rpc: vi.fn(),
    caps: { create: true, channelsCompanion: false },
}))
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => mocks.navigate }))
vi.mock("react-router-dom", () => ({ useOutletContext: () => ({ adena: { address: mocks.address } }) }))
vi.mock("../lib/grc20", async (original) => ({ ...await original<typeof import("../lib/grc20")>(), doContractBroadcast: mocks.broadcast }))
vi.mock("../contexts/OrgContext", () => ({ useOrg: () => ({ activeOrgId: mocks.org }) }))
vi.mock("../lib/daoSlug", () => ({ saveDAOForRecovery: (org: string | null, path: string, name: string) => org ? mocks.saveOrg(org, path, name) : mocks.save(path, name), encodeSlug: () => "saved-dao" }))
vi.mock("../hooks/useScrollToTop", () => ({ useScrollToTop: () => {} }))
vi.mock("../lib/rpcFallback", async (original) => ({ ...await original<typeof import("../lib/rpcFallback")>(), directRpcCall: mocks.rpc }))
// gnoland-1, with user DAO creation switched on as the release step will do;
// the channels companion stays off on mainnet.
vi.mock("../lib/config", async (original) => {
    const actual = await original<typeof import("../lib/config")>()
    return {
        ...actual,
        ACTIVE_NETWORK_KEY: "mainnet",
        GNO_CHAIN_ID: "gnoland-1",
        GNO_RPC_URL: "https://rpc.selected.invalid",
        GNO_FALLBACK_RPC_URLS: ["https://rpc.fallback.invalid"],
        NETWORKS: { ...actual.NETWORKS, mainnet: { ...actual.NETWORKS.mainnet, get userDaos() { return mocks.caps } } },
    }
})
// Real status logic, polled every 10 ms instead of 3 s.
vi.mock("../lib/dao/packageStatus", async (original) => {
    const actual = await original<typeof import("../lib/dao/packageStatus")>()
    return { ...actual, waitForPackage: vi.fn((ctx: Parameters<typeof actual.waitForPackage>[0], path: string, opts = {}) => actual.waitForPackage(ctx, path, { ...opts, intervalMs: 10, timeoutMs: 2_000 })) }
})

import { CreateDAO } from "./CreateDAO"
import { __resetGasPriceCache, feeForGasWanted } from "../lib/grc20"
import { formatGnot } from "../lib/templates/dao/v2/deposit"
import { clearPolicyCache, listPendingDAOs, savePendingDAO, waitForPackage } from "../lib/dao/packageStatus"

// Real gnoland-1 answers captured read-only.
const fixture = (name: string) => readFileSync(join(import.meta.dirname, "..", "lib", "dao", "testdata", "package-status", `${name}.txt`), "utf8").trim()
const INERT_FIXTURE_PATH = "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/zdex/v1"
const meta = {
    absent: () => fixture("absent").replace("gno.land/r/nonexistent/zzz_memba_probe", PATH),
    inert: () => fixture("inert").replace(INERT_FIXTURE_PATH, PATH),
    live: () => fixture("live").replace("gno.land/r/sys/users", PATH),
}

let statuses: string[] = []
let policyReply = ""
/** The node's `auth/gasprice` answer. */
let gasPrice = ""

const encode = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
const decodeHex = (h: string) => new TextDecoder().decode(Uint8Array.from(h.slice(2).match(/../g) ?? [], (x) => parseInt(x, 16)))

beforeEach(() => {
    cleanup()
    mocks.address = SIGNER
    mocks.org = null
    localStorage.clear()
    vi.clearAllMocks()
    clearPolicyCache()
    mocks.caps = { create: true, channelsCompanion: false }
    mocks.broadcast.mockReset().mockResolvedValue({ hash: "DEPLOYHASH" })
    statuses = []
    policyReply = fixture("policy-inert")
    gasPrice = '{"gas":1000,"price":"1ugnot"}'
    __resetGasPriceCache()
    mocks.rpc.mockImplementation(async (_url: string, method: string, params: Record<string, string>) => {
        if (method === "status") return { node_info: { network: "gnoland-1" } }
        const path = JSON.parse(params.path) as string
        const data = params.data ? decodeHex(params.data) : ""
        let reply: string
        if (path === "vm/qeval") reply = data === `gno.land/r/sys/names.IsAuthorizedAddressForNamespace(address("${SIGNER}"), "${SIGNER}")` ? fixture("names-true") : fixture("names-false")
        else if (path === "params/vm:p:code_submission_policy") reply = policyReply
        else if (path === "auth/gasprice") reply = gasPrice
        else if (path === "vm/qpkgmeta_json" && data === PATH) reply = (statuses.length > 1 ? statuses.shift()! : statuses[0] ?? meta.absent())
        else return { response: { ResponseBase: { Data: null, Error: { msg: "unexpected query" } } } }
        return { response: { ResponseBase: { Data: encode(reply), Error: null } } }
    })
})

function resumeReview() {
    localStorage.setItem("memba_dao_draft", JSON.stringify({
        name: "Mainnet DAO", description: "Mainnet flow", realmPath: PATH,
        members: [{ address: SIGNER, power: 1, roles: ["admin"] }],
        threshold: 51, quorum: 0, availableRoles: ["admin", "member"], proposalCategories: ["governance"],
        selectedPreset: "basic", step: 5, enableChannels: true, channelNames: ["general"], savedAt: Date.now(),
    }))
    const view = render(<CreateDAO />)
    fireEvent.click(screen.getByRole("button", { name: "Resume" }))
    return view
}

const deployButton = () => screen.getByRole("button", { name: /Deploy DAO/ })
/** Deploy is enabled once the page has read the network price and the deploy policy. */
const deploy = async () => {
    await waitFor(() => expect(deployButton()).toBeEnabled())
    fireEvent.click(deployButton())
}
const confirm = () => fireEvent.click(screen.getByRole("checkbox", { name: /permanent contract on gno\.land/ }))

describe("Create DAO on gnoland-1", () => {
    it("records intent before signing and preserves the receipt across A → B → A", async () => {
        let finish!: (v: { hash: string }) => void
        mocks.broadcast.mockImplementationOnce(async (_msgs, _memo, opts) => {
            expect(listPendingDAOs("gnoland-1")).toMatchObject([{ path: PATH, phase: "intent", txHash: "", wallet: SIGNER }])
            opts.beforeSign()
            return await new Promise(resolve => { finish = resolve })
        })
        const view = resumeReview()
        confirm(); await deploy()
        await waitFor(() => expect(mocks.broadcast).toHaveBeenCalledTimes(1))
        mocks.address = "g1anotherwallet"
        view.rerender(<CreateDAO />)
        mocks.address = SIGNER
        view.rerender(<CreateDAO />)
        expect(screen.getByText("Submission status unknown")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Deploy DAO/ })).not.toBeInTheDocument()
        finish({ hash: "LATEHASH" })
        await waitFor(() => expect(listPendingDAOs("gnoland-1")[0].txHash).toBe("LATEHASH"))
        expect(mocks.broadcast).toHaveBeenCalledTimes(1)
        expect(mocks.save).not.toHaveBeenCalled()
        expect(localStorage.getItem(`memba_dao_draft:v2:gnoland-1:${SIGNER}`)).not.toBeNull()
    })

    it("stops before the wallet when the network fee rose since the review, then asks the wallet for the fee now shown", async () => {
        resumeReview()
        await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(expect.any(String), "abci_query", expect.objectContaining({ path: '"auth/gasprice"' }), undefined))
        gasPrice = '{"gas":1000,"price":"8ugnot"}'
        confirm(); await deploy()
        expect(await screen.findByText(/network fee increased since review/i)).toBeInTheDocument()
        expect(mocks.broadcast).not.toHaveBeenCalled()
        expect(listPendingDAOs("gnoland-1")).toEqual([])
        // The review now shows the fee at the new price.
        const risen = feeForGasWanted(48_000_000, { gas: 1000, ugnot: 8 })
        await waitFor(() => expect(screen.getByTestId("dao-deploy-disclosure")).toHaveTextContent(`Network fee: ${formatGnot(risen)}. Gas limit 48,000,000.`))

        await deploy()
        await waitFor(() => expect(mocks.broadcast).toHaveBeenCalledTimes(1))
        expect(mocks.broadcast.mock.calls[0][2]).toMatchObject({ gasWanted: 48_000_000, gasFee: risen })
    })

    it("hands the wallet the reviewed fee when the price fell, and stops when the fee cannot be confirmed", async () => {
        gasPrice = '{"gas":1000,"price":"4ugnot"}'
        resumeReview()
        await waitFor(() => expect(screen.getByTestId("dao-deploy-disclosure")).toHaveTextContent(/Network fee: 0\.230 GNOT\./))
        gasPrice = "not json"
        confirm(); await deploy()
        expect(await screen.findByText(/Couldn't confirm the current network fee/)).toBeInTheDocument()
        expect(mocks.broadcast).not.toHaveBeenCalled()

        gasPrice = '{"gas":1000,"price":"1ugnot"}'
        await deploy()
        await waitFor(() => expect(mocks.broadcast).toHaveBeenCalledTimes(1))
        // The price fell to a quarter; the wallet is still asked for the fee that was on screen.
        expect(mocks.broadcast.mock.calls[0][2]).toMatchObject({ gasWanted: 48_000_000, gasFee: 230_400 })
    })

    it("labels a fee computed without a price read as an estimate, and reads the price again on Deploy", async () => {
        gasPrice = "not json"
        resumeReview()
        const disclosure = screen.getByTestId("dao-deploy-disclosure")
        await waitFor(() => expect(disclosure).toHaveTextContent("Network fee: about 0.058 GNOT, an estimate: the network price could not be read. It is read again when you press Deploy. Gas limit 48,000,000."))
        confirm(); await deploy()
        expect(await screen.findByText(/Couldn't confirm the current network fee/)).toBeInTheDocument()
        expect(mocks.broadcast).not.toHaveBeenCalled()

        // The network answers again: the press reads the price, and the estimate covers it.
        gasPrice = '{"gas":1000,"price":"1ugnot"}'
        await deploy()
        await waitFor(() => expect(mocks.broadcast).toHaveBeenCalledTimes(1))
        expect(mocks.broadcast.mock.calls[0][2]).toMatchObject({ gasWanted: 48_000_000, gasFee: 57_600 })
    })

    it("stops for a new look when the deploy now needs more gas than the review was sized for", async () => {
        resumeReview()
        await waitFor(() => expect(screen.getByTestId("dao-deploy-disclosure")).toHaveTextContent(/Gas limit 48,000,000\./))
        clearPolicyCache()
        policyReply = fixture("policy-permissionless")
        confirm(); await deploy()
        expect(await screen.findByText(/needs a higher gas limit than the review showed/)).toBeInTheDocument()
        expect(mocks.broadcast).not.toHaveBeenCalled()
        await waitFor(() => expect(screen.getByTestId("dao-deploy-disclosure")).toHaveTextContent(/Gas limit 57,000,000\./))
    })

    it("cancels obsolete preflight before opening the wallet", async () => {
        const normalRpc = mocks.rpc.getMockImplementation()!
        let release!: () => void
        mocks.rpc.mockImplementation(async (...args) => {
            if (args[1] === "abci_query" && args[2].path === '"vm/qeval"') await new Promise<void>(r => { release = r })
            return normalRpc(...args)
        })
        const view = resumeReview()
        confirm(); await deploy()
        await waitFor(() => expect(release).toBeTypeOf("function"))
        mocks.address = "g1anotherwallet"
        view.rerender(<CreateDAO />)
        release()
        await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(expect.any(String), "abci_query", expect.objectContaining({ path: '"vm/qpkgmeta_json"' }), undefined))
        expect(mocks.broadcast).not.toHaveBeenCalled()
        expect(listPendingDAOs("gnoland-1")).toEqual([])
    })

    it.each(["network response lost", "request cancelled"])("retains uncertain wallet outcome %s", async (message) => {
        mocks.broadcast.mockImplementationOnce(async (_msgs, _memo, opts) => { opts.beforeSign(); throw new Error(message) })
        resumeReview(); confirm(); await deploy()
        expect(await screen.findByText("Submission status unknown")).toBeInTheDocument()
        expect(listPendingDAOs("gnoland-1")).toMatchObject([{ txHash: "", phase: "intent" }])
    })

    it("retains an uncertain wallet outcome and never advertises approval as known", async () => {
        mocks.broadcast.mockImplementationOnce(async (_msgs, _memo, opts) => { opts.beforeSign(); throw new Error("network response lost") })
        resumeReview(); confirm(); await deploy()
        expect(await screen.findByText("Submission status unknown")).toBeInTheDocument()
        expect(screen.queryByText("Submitted, not enabled yet")).not.toBeInTheDocument()
        expect(listPendingDAOs("gnoland-1")).toMatchObject([{ txHash: "", phase: "intent" }])
        expect(mocks.broadcast).toHaveBeenCalledTimes(1)
    })

    it("promotes recovery into the original organization after an organization switch", async () => {
        const view = resumeReview()
        savePendingDAO({ chainId: "gnoland-1", path: PATH, name: "Mainnet DAO", txHash: "ORGHASH", reason: "waiting", wallet: SIGNER, orgId: "team-a", phase: "submitted" })
        mocks.org = "team-b"
        view.rerender(<CreateDAO />)
        statuses = [meta.live()]
        fireEvent.click(screen.getByRole("button", { name: "Check status" }))
        expect(await screen.findByText("DAO deployed successfully!")).toBeInTheDocument()
        expect(mocks.saveOrg).toHaveBeenCalledWith("team-a", PATH, "Mainnet DAO")
        expect(mocks.save).not.toHaveBeenCalled()
    })

    it("offers an explicit revalidated retry for an absent abandoned intent", async () => {
        mocks.broadcast.mockImplementationOnce(async (_msgs, _memo, opts) => { opts.beforeSign(); throw new Error("insufficient funds") })
        resumeReview(); confirm(); await deploy()
        await screen.findByText("Submission status unknown")
        fireEvent.click(screen.getByRole("button", { name: "Check status" }))
        await screen.findByText("Package not found")
        const retry = screen.getByRole("button", { name: "Review another attempt" })
        expect(retry).toBeDisabled()
        fireEvent.click(screen.getByRole("checkbox", { name: /I checked the transaction/ }))
        fireEvent.click(retry)
        await screen.findByRole("button", { name: "Resume" })
        expect(mocks.broadcast).toHaveBeenCalledTimes(1)
        expect(listPendingDAOs("gnoland-1")).toEqual([])
        fireEvent.click(screen.getByRole("button", { name: "Resume" }))
        expect(deployButton()).toBeDisabled()
    })

    it("offers owned inert repair only after acknowledgement and a new ownership check", async () => {
        statuses = [meta.absent(), meta.inert().replace(/"creator":"[^"]+"/, `"creator":"${SIGNER}"`)]
        resumeReview(); confirm(); await deploy()
        await screen.findByText("Submitted, not enabled yet", {}, { timeout: 5000 })
        fireEvent.click(screen.getByRole("checkbox", { name: /I checked the transaction/ }))
        fireEvent.click(screen.getByRole("button", { name: "Review another attempt" }))
        await screen.findByRole("button", { name: "Resume" })
        expect(mocks.broadcast).toHaveBeenCalledTimes(1)
        expect(listPendingDAOs("gnoland-1")).toEqual([])
    })

    it("is not offered while the network does not allow user DAO creation", () => {
        mocks.caps = { create: false, channelsCompanion: false }
        render(<CreateDAO />)
        expect(screen.getByText(/Creating a DAO is not available on gno\.land yet/)).toBeInTheDocument()
        expect(screen.queryByPlaceholderText("My DAO")).not.toBeInTheDocument()
    })

    it("discloses network, permanence, deposit and powers, and keeps Deploy disabled until confirmed", async () => {
        resumeReview()
        const disclosure = screen.getByTestId("dao-deploy-disclosure")
        expect(disclosure).toHaveTextContent(/Storage deposit: about 6\.2 GNOT, capped at 13 GNOT/)
        // gnoland-1 is inert: the submit model (48M gas) at 1 ugnot per 1000 gas, plus 20 %
        await waitFor(() => expect(disclosure).toHaveTextContent(/Network fee: 0\.058 GNOT\. Gas limit 48,000,000\. Your wallet shows the fee it signs\./))
        expect(screen.getAllByText("Roles are labels; they grant no special powers.").length).toBeGreaterThan(0)
        expect(disclosure).toHaveTextContent("Roles grant no special powers. Voting power decides.")
        expect(disclosure).not.toHaveTextContent("No member has special powers")
        expect(disclosure).toHaveTextContent("Storage deposits for removed members are refunded to whoever executes the removal.")
        // the single founder holds all the power
        expect(screen.getByTestId("dao-single-member-warning")).toHaveTextContent(`${SIGNER} can pass proposals alone`)
        expect(disclosure).toHaveTextContent("This DAO cannot hold funds")
        expect(screen.getByText("gno.land (gnoland-1)")).toBeInTheDocument()
        expect(screen.getByText(/permanent, cannot be changed or reused/)).toBeInTheDocument()
        expect(screen.getByText("3 days")).toBeInTheDocument()
        expect(deployButton()).toBeDisabled()
        confirm()
        expect(deployButton()).toBeEnabled()
    })

    it.each([
        ["the network price", '"auth/gasprice"', '"params/vm:p:code_submission_policy"'],
        ["the deploy policy", '"params/vm:p:code_submission_policy"', '"auth/gasprice"'],
    ])("keeps Deploy disabled and shows no fee until %s has been read", async (_what, heldPath, otherPath) => {
        let answer!: () => void
        const held = new Promise<void>((resolve) => { answer = resolve })
        const rpc = mocks.rpc.getMockImplementation()!
        mocks.rpc.mockImplementation(async (url: string, method: string, params: Record<string, string>) => {
            if (method === "abci_query" && params.path === heldPath) await held
            return rpc(url, method, params)
        })
        resumeReview()
        confirm()
        const disclosure = screen.getByTestId("dao-deploy-disclosure")
        // The other read has answered by now; this one has not.
        await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(expect.any(String), "abci_query", expect.objectContaining({ path: otherPath }), undefined))
        await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(expect.any(String), "abci_query", expect.objectContaining({ path: heldPath }), undefined))
        expect(disclosure).toHaveTextContent("Network fee: reading from the network…")
        expect(deployButton()).toBeDisabled()
        fireEvent.click(deployButton())
        expect(mocks.broadcast).not.toHaveBeenCalled()
        answer()
        await waitFor(() => expect(disclosure).toHaveTextContent(/Network fee: 0\.058 GNOT\. Gas limit 48,000,000\./))
        expect(deployButton()).toBeEnabled()
    })

    it("a package enabled on the second poll is a created DAO; channels are not deployed on mainnet", async () => {
        statuses = [meta.absent(), meta.inert(), meta.live()]
        resumeReview()
        // The wallet is asked for what the review shows, so deploy once it shows the network's sizing.
        await waitFor(() => expect(screen.getByTestId("dao-deploy-disclosure")).toHaveTextContent(/Network fee: 0\.058 GNOT\. Gas limit 48,000,000\./))
        confirm()
        await deploy()
        expect(await screen.findByText("DAO deployed successfully!")).toBeInTheDocument()
        expect(mocks.broadcast).toHaveBeenCalledTimes(1)
        const [[msgs, memo, opts]] = mocks.broadcast.mock.calls
        // Exactly the review's gas limit and fee: 48,000,000 × 1.2 × 1 / 1000.
        expect(opts).toEqual({ gas: "deploy", gasWanted: 48_000_000, gasFee: 57_600, beforeSign: expect.any(Function) })
        expect(msgs[0].value.max_deposit).toBe("13000000ugnot")
        expect(msgs[0].value).not.toHaveProperty("deposit")
        expect(memo).toBe(`Deploy realm ${PATH} (storage deposit up to 13 GNOT)`)
        expect(mocks.save).toHaveBeenCalledWith(PATH, "Mainnet DAO")
        expect(listPendingDAOs("gnoland-1")).toEqual([])
    })

    it("a package still parked is pending, not success", async () => {
        statuses = [meta.absent(), meta.inert()]
        const inert = JSON.parse(meta.inert())
        let savedBeforePolling: unknown = null
        vi.mocked(waitForPackage).mockImplementationOnce(async () => {
            // the record exists before polling starts, so closing the tab keeps it
            savedBeforePolling = listPendingDAOs("gnoland-1")
            return { outcome: "pending", meta: inert, unconfirmed: false }
        })
        resumeReview()
        confirm()
        await deploy()
        const pending = await screen.findByTestId("dao-approval-pending")
        expect(savedBeforePolling).toMatchObject([{ path: PATH, txHash: "DEPLOYHASH" }])
        expect(pending).toHaveTextContent("It becomes usable only once the network enables it")
        expect(pending).toHaveTextContent("DEPLOYHASH")
        expect(pending).not.toHaveTextContent(/keep checking|My DAOs/)
        expect(pending).toHaveTextContent("waiting for a package approver to enable it")
        expect(screen.queryByText("DAO deployed successfully!")).not.toBeInTheDocument()
        expect(mocks.save).not.toHaveBeenCalled()
        expect(listPendingDAOs("gnoland-1")).toMatchObject([{ path: PATH, name: "Mainnet DAO", txHash: "DEPLOYHASH" }])
        expect(mocks.broadcast).toHaveBeenCalledTimes(1)
    })

    it("pre-sign checks use the network's fallback endpoint when the primary is down", async () => {
        statuses = [meta.absent(), meta.live()]
        const answered = mocks.rpc.getMockImplementation()!
        const urls: string[] = []
        mocks.rpc.mockImplementation(async (url: string, method: string, params: Record<string, string>) => {
            urls.push(url)
            if (url === "https://rpc.selected.invalid") throw new TypeError("Failed to fetch")
            return answered(url, method, params)
        })
        resumeReview()
        confirm()
        await deploy()
        expect(await screen.findByText("DAO deployed successfully!")).toBeInTheDocument()
        expect(urls).toContain("https://rpc.fallback.invalid")
    })

    it("replaces the signer's own parked submission, and says so", async () => {
        const ownParked = meta.inert().replace("g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt", SIGNER)
        statuses = [ownParked, meta.live()]
        resumeReview()
        confirm()
        await deploy()
        expect(await screen.findByText("DAO deployed successfully!")).toBeInTheDocument()
        expect(screen.getByTestId("dao-replaces-parked")).toHaveTextContent("Replaces your earlier submission that gno.land has not enabled")
        expect(mocks.broadcast.mock.calls[0][1]).toContain("replaces your earlier submission that gno.land has not enabled")
    })

    // Success is decided by the package status, never by the policy string.
    it.each(['"permissioned"', '"inert_v2"', '"permissionless"'])("with policy %s a package that is still parked is pending, not success", async (policy) => {
        policyReply = policy
        statuses = [meta.absent(), meta.inert()]
        vi.mocked(waitForPackage).mockImplementationOnce(async (ctx, path, opts) => {
            const actual = await vi.importActual<typeof import("../lib/dao/packageStatus")>("../lib/dao/packageStatus")
            return actual.waitForPackage(ctx, path, { ...opts, intervalMs: 5, timeoutMs: 30 })
        })
        resumeReview()
        confirm()
        await deploy()
        expect(await screen.findByTestId("dao-approval-pending")).toHaveTextContent("DEPLOYHASH")
        expect(screen.queryByText("DAO deployed successfully!")).not.toBeInTheDocument()
        expect(mocks.save).not.toHaveBeenCalled()
        expect(waitForPackage).toHaveBeenCalledTimes(1)
    })

    it("with an unreadable policy a live package is still a created DAO, sized with the full deploy model", async () => {
        policyReply = "not json"
        statuses = [meta.absent(), meta.live()]
        resumeReview()
        confirm()
        await deploy()
        expect(await screen.findByText("DAO deployed successfully!")).toBeInTheDocument()
        expect(mocks.broadcast.mock.calls[0][2]).toEqual({ gas: "deploy", gasWanted: 57_000_000, gasFee: 68_400, beforeSign: expect.any(Function) })
    })

    it("refuses a path that is already used, before any signature", async () => {
        statuses = [meta.inert()]
        resumeReview()
        confirm()
        await deploy()
        expect(await screen.findByTestId("deploy-error")).toHaveTextContent("This path is already used")
        expect(mocks.broadcast).not.toHaveBeenCalled()
    })

    it("refuses a namespace the signer does not hold, before any signature", async () => {
        localStorage.setItem("memba_dao_draft", JSON.stringify({
            name: "Other DAO", description: "", realmPath: "gno.land/r/nym-bobby123/other_dao",
            members: [{ address: SIGNER, power: 1, roles: [] }],
            threshold: 51, quorum: 0, availableRoles: ["admin", "member"], proposalCategories: ["governance"],
            selectedPreset: null, step: 5, savedAt: Date.now(),
        }))
        render(<CreateDAO />)
        fireEvent.click(screen.getByRole("button", { name: "Resume" }))
        confirm()
        await deploy()
        expect(await screen.findByTestId("deploy-error")).toHaveTextContent("You can deploy only under your own address or a name you registered")
        expect(mocks.broadcast).not.toHaveBeenCalled()
    })

    it("a confirmed deploy whose status cannot be read is pending with its transaction, not a failure", async () => {
        statuses = [meta.absent()]
        mocks.broadcast.mockImplementation(async () => {
            // after signing, every status read times out
            mocks.rpc.mockImplementation(async (_url: string, method: string, params: Record<string, string>) => {
                if (method === "status") return { node_info: { network: "gnoland-1" } }
                if (JSON.parse(params.path) === "vm/qpkgmeta_json") throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" })
                return { response: { ResponseBase: { Data: null, Error: { msg: "unexpected" } } } }
            })
            return { hash: "DEPLOYHASH" }
        })
        resumeReview()
        confirm()
        await deploy()
        const pending = await screen.findByTestId("dao-approval-pending", {}, { timeout: 5000 })
        expect(pending).toHaveTextContent("DEPLOYHASH")
        expect(pending).toHaveTextContent(PATH)
        expect(screen.queryByTestId("deploy-error")).not.toBeInTheDocument()
        expect(mocks.save).not.toHaveBeenCalled()
    })

    it("an error after a confirmed deploy keeps the transaction hash even when the message is replaced", async () => {
        vi.mocked(waitForPackage).mockResolvedValueOnce({ outcome: "failed", meta: JSON.parse(meta.absent()), error: "Failed to fetch" })
        resumeReview()
        confirm()
        await deploy()
        await waitFor(() => expect(screen.getByTestId("dao-approval-pending")).toHaveTextContent("DEPLOYHASH"))
    })

    it("an absent package retains its receipt for reconciliation", async () => {
        statuses = [meta.absent()]
        resumeReview()
        confirm()
        await deploy()
        await waitFor(() => expect(screen.getByTestId("dao-approval-pending")).toHaveTextContent("DEPLOYHASH"))
        expect(mocks.save).not.toHaveBeenCalled()
        expect(listPendingDAOs("gnoland-1")).toMatchObject([{ txHash: "DEPLOYHASH" }])
        expect(screen.getByText("Package not found")).toBeInTheDocument()
    })
})
