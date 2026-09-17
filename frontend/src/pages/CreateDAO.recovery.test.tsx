import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react"

const mocks = vi.hoisted(() => ({ broadcast: vi.fn(), navigate: vi.fn(), save: vi.fn(), policy: vi.fn(), wait: vi.fn() }))
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => mocks.navigate }))
vi.mock("react-router-dom", () => ({ useOutletContext: () => ({ adena: { address: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c" } }) }))
vi.mock("../lib/grc20", async (original) => ({ ...await original<typeof import("../lib/grc20")>(), doContractBroadcast: mocks.broadcast }))
vi.mock("../lib/daoSlug", () => ({ addSavedDAO: mocks.save, encodeSlug: () => "saved-dao" }))
vi.mock("../hooks/useScrollToTop", () => ({ useScrollToTop: () => {} }))
// Pearl: user DAO creation and the channels companion are available; chain
// checks are covered by lib/dao/packageStatus.test.ts.
vi.mock("../lib/config", async (original) => ({ ...await original<typeof import("../lib/config")>(), ACTIVE_NETWORK_KEY: "pearl", GNO_CHAIN_ID: "pearl-1" }))
vi.mock("../lib/dao/namespace", () => ({ assertCanDeployTo: vi.fn(async () => {}) }))
vi.mock("../lib/dao/packageStatus", () => ({ assertPathAvailable: vi.fn(async () => {}), codeSubmissionPolicy: mocks.policy, waitForPackage: mocks.wait, savePendingDAO: vi.fn(), removePendingDAO: vi.fn() }))
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
beforeEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); mocks.broadcast.mockReset(); mocks.policy.mockResolvedValue("permissionless") })
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
    it("regenerates the realm preview when resuming the review step", () => {
        resume()
        expect(document.querySelector("code")).toHaveTextContent("package recovery")
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
        expect(localStorage.getItem("memba_dao_draft")).not.toBeNull()
    })
    it("reports a local bookmark failure without losing the confirmed DAO", async () => {
        mocks.broadcast.mockResolvedValueOnce({ hash: "confirmed-dao-hash" })
        mocks.save.mockImplementationOnce(() => { throw new Error("Storage unavailable") })
        resume({ enableChannels: false })
        deploy()
        expect(await screen.findByText(/could not be saved in this browser/)).toBeInTheDocument()
        expect(screen.getByText("DAO deployed successfully!")).toBeInTheDocument()
        expect(mocks.broadcast).toHaveBeenCalledTimes(1)
        // pearl is not inert: no approval polling and no pending record
        expect(mocks.wait).not.toHaveBeenCalled()
        expect(localStorage.getItem("memba_pending_daos")).toBeNull()
    })

})
