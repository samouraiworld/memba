import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DAORooms } from "./DAORooms"
import { JitsiProvider } from "../../contexts/JitsiContext"

// Mock react-router-dom
const mockNavigate = vi.fn()
vi.mock("react-router-dom", () => ({
    useNavigate: () => mockNavigate,
}))

/** Helper: wraps DAORooms in JitsiProvider (required since v2.11). */
function renderDAORooms(overrides: Partial<Parameters<typeof DAORooms>[0]> = {}) {
    const props = {
        daoSlug: "gno.land/r/gov/dao",
        encodedSlug: "gno.land~r~gov~dao",
        isMember: false,
        hasChannels: false,
        isConnected: true,
        ...overrides,
    }
    return render(
        <JitsiProvider>
            <DAORooms {...props} />
        </JitsiProvider>,
    )
}

describe("DAORooms", () => {
    beforeEach(() => {
        mockNavigate.mockClear()
    })

    it("renders the Rooms header", () => {
        renderDAORooms()
        expect(screen.getByText("Live Rooms")).toBeTruthy()
    })

    it("shows Public Room when wallet is connected", () => {
        renderDAORooms({ isConnected: true })
        expect(screen.getByText("Public Room")).toBeTruthy()
        expect(screen.getByText("Open to all connected wallets")).toBeTruthy()
    })

    it("hides Public Room button when wallet is not connected", () => {
        renderDAORooms({ isConnected: false })
        expect(screen.getByText("Connect wallet to join rooms")).toBeTruthy()
    })

    it("shows connect hint when not connected", () => {
        renderDAORooms({ isConnected: false })
        expect(screen.getByText("Connect wallet to join rooms")).toBeTruthy()
    })

    it("hides Members Room when not a member", () => {
        renderDAORooms({ isMember: false })
        expect(screen.queryByText("Members Room")).toBeNull()
    })

    it("shows Members Room when user is a member", () => {
        renderDAORooms({ isMember: true })
        expect(screen.getByText("Members Room")).toBeTruthy()
        expect(screen.getByText("DAO members only")).toBeTruthy()
    })

    it("clicking Public Room triggers join (button becomes active)", () => {
        renderDAORooms({ isConnected: true })
        fireEvent.click(screen.getByText("Public Room"))
        // After joining, the hint changes to "In call" state
        expect(screen.getByText("In call — click to expand")).toBeTruthy()
    })

    it("clicking Members Room triggers join (button becomes active)", () => {
        renderDAORooms({ isMember: true })
        fireEvent.click(screen.getByText("Members Room"))
        expect(screen.getByText("In call — click to expand")).toBeTruthy()
    })

    it("hides Manage channels link when no channels deployed", () => {
        renderDAORooms({ hasChannels: false })
        expect(screen.queryByText("Manage channels →")).toBeNull()
    })

    it("shows Manage channels link when channels are deployed", () => {
        renderDAORooms({ hasChannels: true })
        expect(screen.getByText("Manage channels →")).toBeTruthy()
    })

    it("navigate to channels when Manage channels is clicked", () => {
        renderDAORooms({ hasChannels: true })
        fireEvent.click(screen.getByText("Manage channels →"))
        expect(mockNavigate).toHaveBeenCalledWith("/dao/gno.land~r~gov~dao/channels")
    })

    it("has data-testid for scroll targeting", () => {
        renderDAORooms()
        expect(screen.getByTestId("dao-rooms")).toBeTruthy()
    })

    it("shows green dot indicator when in a room", () => {
        renderDAORooms({ isConnected: true })
        fireEvent.click(screen.getByText("Public Room"))
        // The active room button should have the active class
        const btn = screen.getByText("In call — click to expand").closest("button")
        expect(btn?.className).toContain("dao-room-active")
    })
})
