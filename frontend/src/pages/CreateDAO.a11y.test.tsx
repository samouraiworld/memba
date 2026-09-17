import { beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"

const SIGNER = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"

vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => vi.fn() }))
vi.mock("react-router-dom", () => ({ useOutletContext: () => ({ adena: { address: SIGNER } }) }))
vi.mock("../hooks/useScrollToTop", () => ({ useScrollToTop: () => {} }))
vi.mock("../lib/config", async (original) => {
    const actual = await original<typeof import("../lib/config")>()
    return { ...actual, ACTIVE_NETWORK_KEY: "pearl", GNO_CHAIN_ID: "pearl-1" }
})

import { CreateDAO } from "./CreateDAO"

beforeEach(() => {
    cleanup()
    localStorage.clear()
})

function resumeAt(step: number) {
    localStorage.setItem("memba_dao_draft", JSON.stringify({
        name: "Team", description: "", realmPath: `gno.land/r/${SIGNER}/team`,
        members: [{ address: SIGNER, power: 1, roles: ["admin"] }],
        threshold: 51, quorum: 0, availableRoles: ["admin", "member"], proposalCategories: ["governance"],
        selectedPreset: "basic", step, enableChannels: false, channelNames: ["general"], savedAt: Date.now(),
    }))
    render(<CreateDAO />)
    fireEvent.click(screen.getByRole("button", { name: "Resume" }))
}

describe("Create DAO wizard accessibility", () => {
    it("labels the step indicator as buttons and the first step's fields", () => {
        render(<CreateDAO />)
        expect(screen.getByRole("heading", { name: "Create a DAO" })).toBeInTheDocument()
        const steps = within(screen.getByRole("navigation", { name: "Create DAO steps" })).getAllByRole("button")
        expect(steps).toHaveLength(5)
        expect(steps[0]).toHaveAttribute("aria-current", "step")
        expect(steps[0]).toHaveAccessibleName("Step 1: Name, Path & Preset")
        expect(steps[1]).toBeDisabled()
        expect(screen.getByLabelText("DAO Name")).toHaveAttribute("id", "dao-name-input")
        expect(screen.getByLabelText("Realm Path")).toHaveAttribute("id", "dao-path-input")
        // Preset cards are toggle buttons.
        expect(screen.getAllByRole("button", { pressed: false }).length).toBeGreaterThan(0)
    })

    it("labels member inputs and exposes role toggles as pressed buttons", () => {
        resumeAt(2)
        expect(screen.getByLabelText("Member 1 address")).toHaveValue(SIGNER)
        expect(screen.getByLabelText("Member 1 voting power")).toHaveValue(1)
        expect(screen.getByRole("button", { name: "Member 1 role admin" })).toHaveAttribute("aria-pressed", "true")
        expect(screen.getByRole("button", { name: "Member 1 role member" })).toHaveAttribute("aria-pressed", "false")
        const back = screen.getByRole("button", { name: "Step 1: Name, Path & Preset (done, go back)" })
        expect(back).toBeEnabled()
    })

    it("uses no emoji on the deploy action", () => {
        resumeAt(5)
        expect(screen.getByRole("button", { name: "Deploy DAO" })).toBeInTheDocument()
    })
})
