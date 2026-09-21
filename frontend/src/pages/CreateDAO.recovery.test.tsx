import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react"

const mocks = vi.hoisted(() => ({ address: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c", broadcast: vi.fn(), navigate: vi.fn(), save: vi.fn(), policy: vi.fn(), wait: vi.fn() }))
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => mocks.navigate }))
vi.mock("react-router-dom", () => ({ useOutletContext: () => ({ adena: { address: mocks.address } }) }))
vi.mock("../lib/grc20", async (original) => ({ ...await original<typeof import("../lib/grc20")>(), doContractBroadcast: mocks.broadcast }))
vi.mock("../lib/daoSlug", () => ({ saveDAOForRecovery: (_org: unknown, path: string, name: string) => mocks.save(path, name), encodeSlug: () => "saved-dao" }))
vi.mock("../hooks/useScrollToTop", () => ({ useScrollToTop: () => {} }))
// Pearl: user DAO creation and the channels companion are available; chain
// checks are covered by lib/dao/packageStatus.test.ts.
vi.mock("../lib/config", async (original) => ({ ...await original<typeof import("../lib/config")>(), ACTIVE_NETWORK_KEY: "pearl", GNO_CHAIN_ID: "pearl-1" }))
vi.mock("../lib/dao/namespace", () => ({ assertCanDeployTo: vi.fn(async () => {}) }))
vi.mock("../lib/dao/packageStatus", () => ({ listPendingDAOs: () => [], hasVolatilePendingDAO: () => false, assertPathAvailable: vi.fn(async () => ({ replacesParked: false })), codeSubmissionPolicy: mocks.policy, waitForPackage: mocks.wait, savePendingDAO: vi.fn(), removePendingDAO: vi.fn() }))
import { draftKey, loadDraft, saveDraft, clearDraftMemory } from "../lib/dao/drafts"
import { CreateDAO } from "./CreateDAO"

const draft = (overrides: Record<string, unknown> = {}) => ({
    name: "Recovery DAO", description: "Recovery test", realmPath: "gno.land/r/test/recovery",
    members: [{ address: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c", power: 1, roles: ["admin"] }],
    threshold: 51, quorum: 0, availableRoles: ["admin", "member"], proposalCategories: ["governance"],
    selectedPreset: null, step: 5, enableChannels: true, channelNames: ["general"], savedAt: Date.now(), ...overrides,
})
function resume(overrides: Record<string, unknown> = {}) {
    localStorage.setItem("memba_dao_draft", JSON.stringify(draft(overrides)))
    render(<CreateDAO />)
    fireEvent.click(screen.getByRole("button", { name: "Resume" }))
}
beforeEach(() => { mocks.address = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"; cleanup(); localStorage.clear(); clearDraftMemory(); vi.clearAllMocks(); mocks.broadcast.mockReset(); mocks.policy.mockResolvedValue("permissionless"); mocks.wait.mockResolvedValue({ outcome: "live", meta: { path: "gno.land/r/test/recovery", status: "live" } }) })
// v2: deploying requires confirming the permanent-contract notice first.
function deploy() {
    fireEvent.click(screen.getByRole("checkbox", { name: /permanent contract/ }))
    fireEvent.click(screen.getByRole("button", { name: /Deploy DAO/ }))
}

describe("DAO creation recovery", () => {
    it.each([{ members: null }, { availableRoles: null }, { step: 6 }, { savedAt: null }])("ignores malformed drafts without crashing: %j", overrides => {
        localStorage.setItem("memba_dao_draft", JSON.stringify(draft(overrides)))
        render(<CreateDAO />)
        expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument()
    })
    it("remounts the form on wallet switches and preserves each original draft", async () => {
        const view = render(<CreateDAO />)
        fireEvent.change(screen.getByPlaceholderText("My DAO"), { target: { value: "Alice draft" } })
        const alice = mocks.address
        mocks.address = "g1anotherwallet"
        view.rerender(<CreateDAO />)
        expect(screen.getByPlaceholderText("My DAO")).toHaveValue("")
        expect(loadDraft({ chainId: "pearl-1", wallet: alice })?.data.name).toBe("Alice draft")
        fireEvent.change(screen.getByPlaceholderText("My DAO"), { target: { value: "Bob draft" } })
        expect(loadDraft({ chainId: "pearl-1", wallet: alice })?.data.name).toBe("Alice draft")
        expect(loadDraft({ chainId: "pearl-1", wallet: mocks.address })?.data.name).toBe("Bob draft")
    })
    it("requires confirmation before resetting a resumed draft", () => {
        resume()
        fireEvent.click(screen.getByRole("button", { name: "Reset draft" }))
        expect(screen.getByRole("alertdialog")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Keep draft" }))
        expect(loadDraft({ chainId: "pearl-1", wallet: mocks.address })).not.toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Reset draft" }))
        fireEvent.click(screen.getByRole("button", { name: "Confirm discard" }))
        expect(loadDraft({ chainId: "pearl-1", wallet: mocks.address })).toBeNull()
        expect(screen.getByPlaceholderText("My DAO")).toHaveValue("")
    })
    it("resumes a readable scoped draft even when autosave is unavailable", async () => {
        saveDraft({ chainId: "pearl-1", wallet: mocks.address }, draft())
        const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota") })
        render(<CreateDAO />)
        fireEvent.click(screen.getByRole("button", { name: "Resume" }))
        expect(document.querySelector("code")).toHaveTextContent("package recovery")
        expect(await screen.findByText(/Changes cannot be saved/)).toBeInTheDocument()
        write.mockRestore()
    })
    it("keeps failed autosaves in memory across wallet switches", () => {
        const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota") })
        const view = render(<CreateDAO />)
        fireEvent.change(screen.getByPlaceholderText("My DAO"), { target: { value: "Unsaved Alice" } })
        const alice = mocks.address
        mocks.address = "bob"
        view.rerender(<CreateDAO />)
        mocks.address = alice
        view.rerender(<CreateDAO />)
        fireEvent.click(screen.getByRole("button", { name: "Resume" }))
        expect(screen.getByPlaceholderText("My DAO")).toHaveValue("Unsaved Alice")
        write.mockRestore()
    })
    it("regenerates the realm preview when resuming the review step", () => {
        resume()
        expect(document.querySelector("code")).toHaveTextContent("package recovery")
    })
    it("lists the channels companion's own deposit cap and network fee on the review step", () => {
        resume()
        expect(screen.getByTestId("dao-deploy-disclosure")).toHaveTextContent(/Channels companion \(second signature\): storage deposit cap 13 GNOT, network fee up to 1 GNOT\./)
        cleanup(); localStorage.clear()
        resume({ enableChannels: false })
        expect(screen.getByTestId("dao-deploy-disclosure")).not.toHaveTextContent("Channels companion")
    })
    it("keeps an existing draft intact while the resume decision is pending", async () => {
        const saved = JSON.stringify(draft())
        localStorage.setItem("memba_dao_draft", saved)
        render(<CreateDAO />)
        fireEvent.change(screen.getByPlaceholderText("My DAO"), { target: { value: "New input" } })
        await new Promise(resolve => setTimeout(resolve, 650))
        expect(localStorage.getItem("memba_dao_draft")).toBe(saved)
    })
    it("reports companion failure while retaining DAO success and its transaction", async () => {
        mocks.broadcast.mockResolvedValueOnce({ hash: "confirmed-dao-hash" }).mockRejectedValueOnce(new Error("Wallet request rejected"))
        resume()
        deploy()
        await waitFor(() => expect(mocks.broadcast).toHaveBeenCalledTimes(2))
        expect(await screen.findByText(/Channels deployment was not confirmed/)).toBeInTheDocument()
        expect(screen.getByText("DAO deployed successfully!")).toBeInTheDocument()
        expect(mocks.save).toHaveBeenCalledWith("gno.land/r/test/recovery", "Recovery DAO")
        expect(localStorage.getItem("memba_dao_draft")).toBeNull()
        expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }))
        expect(mocks.navigate).toHaveBeenCalledWith("/dao/saved-dao")
        expect(mocks.broadcast).toHaveBeenCalledTimes(2)
    })
    it("rejects an invalid companion before publishing the DAO", async () => {
        resume({ channelNames: ["INVALID CHANNEL"] })
        deploy()
        await waitFor(() => expect(screen.getByTestId("deploy-error")).toBeInTheDocument())
        expect(mocks.broadcast).not.toHaveBeenCalled()
    })
    it("keeps the draft and never deploys Channels when the DAO transaction fails", async () => {
        mocks.broadcast.mockRejectedValueOnce(new Error("Wallet request rejected"))
        resume()
        deploy()
        expect(await screen.findByTestId("deploy-error")).toBeInTheDocument()
        expect(mocks.broadcast).toHaveBeenCalledTimes(1)
        expect(mocks.save).not.toHaveBeenCalled()
        expect(localStorage.getItem(draftKey({ chainId: "pearl-1", wallet: mocks.address }))).not.toBeNull()
    })
    it("reports a local bookmark failure without losing the confirmed DAO", async () => {
        mocks.broadcast.mockResolvedValueOnce({ hash: "confirmed-dao-hash" })
        mocks.save.mockImplementationOnce(() => { throw new Error("Storage unavailable") })
        resume({ enableChannels: false })
        deploy()
        expect(await screen.findByText(/could not be saved in this browser/)).toBeInTheDocument()
        expect(screen.getByText("DAO deployed successfully!")).toBeInTheDocument()
        expect(mocks.broadcast).toHaveBeenCalledTimes(1)
        // the package status is read once even when the policy is permissionless
        expect(mocks.wait).toHaveBeenCalledTimes(1)
        expect(localStorage.getItem("memba_pending_daos")).toBeNull()
    })

})
