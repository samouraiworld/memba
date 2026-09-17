import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const SIGNER = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const PATH = `gno.land/r/${SIGNER}/mainnet_dao`

const mocks = vi.hoisted(() => ({
    broadcast: vi.fn(),
    navigate: vi.fn(),
    save: vi.fn(),
    rpc: vi.fn(),
    caps: { create: true, channelsCompanion: false },
}))
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => mocks.navigate }))
vi.mock("react-router-dom", () => ({ useOutletContext: () => ({ adena: { address: SIGNER } }) }))
vi.mock("../lib/grc20", async (original) => ({ ...await original<typeof import("../lib/grc20")>(), doContractBroadcast: mocks.broadcast }))
vi.mock("../lib/daoSlug", () => ({ addSavedDAO: mocks.save, encodeSlug: () => "saved-dao" }))
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
import { clearPolicyCache, listPendingDAOs, waitForPackage } from "../lib/dao/packageStatus"

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

const encode = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
const decodeHex = (h: string) => new TextDecoder().decode(Uint8Array.from(h.slice(2).match(/../g) ?? [], (x) => parseInt(x, 16)))

beforeEach(() => {
    cleanup()
    localStorage.clear()
    vi.clearAllMocks()
    clearPolicyCache()
    mocks.caps = { create: true, channelsCompanion: false }
    mocks.broadcast.mockReset().mockResolvedValue({ hash: "DEPLOYHASH" })
    statuses = []
    policyReply = fixture("policy-inert")
    mocks.rpc.mockImplementation(async (_url: string, method: string, params: Record<string, string>) => {
        if (method === "status") return { node_info: { network: "gnoland-1" } }
        const path = JSON.parse(params.path) as string
        const data = params.data ? decodeHex(params.data) : ""
        let reply: string
        if (path === "vm/qeval") reply = data === `gno.land/r/sys/names.IsAuthorizedAddressForNamespace(address("${SIGNER}"), "${SIGNER}")` ? fixture("names-true") : fixture("names-false")
        else if (path === "params/vm:p:code_submission_policy") reply = policyReply
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
    render(<CreateDAO />)
    fireEvent.click(screen.getByRole("button", { name: "Resume" }))
}

const deployButton = () => screen.getByRole("button", { name: /Deploy DAO/ })
const confirm = () => fireEvent.click(screen.getByRole("checkbox", { name: /permanent contract on gno\.land/ }))

describe("Create DAO on gnoland-1", () => {
    it("is not offered while the network does not allow user DAO creation", () => {
        mocks.caps = { create: false, channelsCompanion: false }
        render(<CreateDAO />)
        expect(screen.getByText(/Creating a DAO is not available on gno\.land yet/)).toBeInTheDocument()
        expect(screen.queryByPlaceholderText("My DAO")).not.toBeInTheDocument()
    })

    it("discloses network, permanence, deposit and powers, and keeps Deploy disabled until confirmed", () => {
        resumeReview()
        const disclosure = screen.getByTestId("dao-deploy-disclosure")
        expect(disclosure).toHaveTextContent(/Storage deposit: about 6\.2 GNOT, capped at 13 GNOT/)
        // 57M gas x 1.2 at 1 ugnot per 1000 gas is below the default 1 GNOT profile fee
        expect(disclosure).toHaveTextContent(/Network fee: up to 1 GNOT \(your wallet may lower it\)\. Gas limit 57,000,000\./)
        expect(screen.getAllByText("Roles are labels; they grant no special powers.").length).toBeGreaterThan(0)
        expect(disclosure).toHaveTextContent("No member has special powers")
        expect(disclosure).toHaveTextContent("This DAO cannot hold funds")
        expect(screen.getByText("gno.land (gnoland-1)")).toBeInTheDocument()
        expect(screen.getByText(/permanent, cannot be changed or reused/)).toBeInTheDocument()
        expect(screen.getByText("3 days")).toBeInTheDocument()
        expect(deployButton()).toBeDisabled()
        confirm()
        expect(deployButton()).toBeEnabled()
    })

    it("a package enabled on the second poll is a created DAO; channels are not deployed on mainnet", async () => {
        statuses = [meta.absent(), meta.inert(), meta.live()]
        resumeReview()
        confirm()
        fireEvent.click(deployButton())
        expect(await screen.findByText("DAO deployed successfully!")).toBeInTheDocument()
        expect(mocks.broadcast).toHaveBeenCalledTimes(1)
        const [[msgs, memo, opts]] = mocks.broadcast.mock.calls
        expect(opts).toEqual({ gas: "deploy", gasWanted: 57_000_000 })
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
        fireEvent.click(deployButton())
        const pending = await screen.findByTestId("dao-approval-pending")
        expect(savedBeforePolling).toMatchObject([{ path: PATH, txHash: "DEPLOYHASH" }])
        expect(pending).toHaveTextContent("Your DAO becomes usable once gno.land enables it")
        expect(pending).toHaveTextContent("Keep the realm path and transaction hash to check it later")
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
        fireEvent.click(deployButton())
        expect(await screen.findByText("DAO deployed successfully!")).toBeInTheDocument()
        expect(urls).toContain("https://rpc.fallback.invalid")
    })

    it("replaces the signer's own parked submission, and says so", async () => {
        const ownParked = meta.inert().replace("g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt", SIGNER)
        statuses = [ownParked, meta.live()]
        resumeReview()
        confirm()
        fireEvent.click(deployButton())
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
        fireEvent.click(deployButton())
        expect(await screen.findByTestId("dao-approval-pending")).toHaveTextContent("DEPLOYHASH")
        expect(screen.queryByText("DAO deployed successfully!")).not.toBeInTheDocument()
        expect(mocks.save).not.toHaveBeenCalled()
        expect(waitForPackage).toHaveBeenCalledTimes(1)
    })

    it("with an unreadable policy a live package is still a created DAO", async () => {
        policyReply = "not json"
        statuses = [meta.absent(), meta.live()]
        resumeReview()
        confirm()
        fireEvent.click(deployButton())
        expect(await screen.findByText("DAO deployed successfully!")).toBeInTheDocument()
    })

    it("refuses a path that is already used, before any signature", async () => {
        statuses = [meta.inert()]
        resumeReview()
        confirm()
        fireEvent.click(deployButton())
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
        fireEvent.click(deployButton())
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
        fireEvent.click(deployButton())
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
        fireEvent.click(deployButton())
        await waitFor(() => expect(screen.getByTestId("deploy-error")).toHaveTextContent("DEPLOYHASH"))
    })

    it("a submission that never appears is a failure that shows the transaction", async () => {
        statuses = [meta.absent()]
        resumeReview()
        confirm()
        fireEvent.click(deployButton())
        await waitFor(() => expect(screen.getByTestId("deploy-error")).toHaveTextContent("DEPLOYHASH"))
        expect(mocks.save).not.toHaveBeenCalled()
        expect(listPendingDAOs("gnoland-1")).toEqual([])
    })
})
