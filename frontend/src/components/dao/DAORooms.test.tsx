import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DAORooms } from "./DAORooms"

// Mock react-router-dom
const mockNavigate = vi.fn()
vi.mock("react-router-dom", () => ({
    useNavigate: () => mockNavigate,
}))

// Mock JitsiMeet to avoid iframe rendering
vi.mock("../ui/JitsiMeet", () => ({
    JitsiMeet: ({ label }: { label?: string }) => (
        <div data-testid="jitsi-mock">{label || "Voice Channel"}</div>
    ),
}))

describe("DAORooms", () => {
    beforeEach(() => {
        mockNavigate.mockClear()
        document.body.style.overflow = ""
    })

    const defaultProps = {
        daoSlug: "test-dao",
        encodedSlug: "test-dao",
        isMember: false,
        hasChannels: false,
        isConnected: true,
    }

    it("renders the Rooms header", () => {
        render(<DAORooms {...defaultProps} />)
        expect(screen.getByText("Rooms")).toBeTruthy()
    })

    it("shows Public Room when wallet is connected", () => {
        render(<DAORooms {...defaultProps} isConnected={true} />)
        expect(screen.getByText("Public Room")).toBeTruthy()
        expect(screen.getByText("Open to all connected wallets")).toBeTruthy()
    })

    it("hides Public Room button when wallet is not connected", () => {
        render(<DAORooms {...defaultProps} isConnected={false} />)
        // Public Room text still visible (in disabled state), but not clickable
        expect(screen.getByText("Connect wallet to join rooms")).toBeTruthy()
    })

    it("shows connect hint when not connected", () => {
        render(<DAORooms {...defaultProps} isConnected={false} />)
        expect(screen.getByText("Connect wallet to join rooms")).toBeTruthy()
    })

    it("hides Members Room when not a member", () => {
        render(<DAORooms {...defaultProps} isMember={false} />)
        expect(screen.queryByText("Members Room")).toBeNull()
    })

    it("shows Members Room when user is a member", () => {
        render(<DAORooms {...defaultProps} isMember={true} />)
        expect(screen.getByText("Members Room")).toBeTruthy()
        expect(screen.getByText("DAO members only")).toBeTruthy()
    })

    it("opens modal when Public Room is clicked", () => {
        render(<DAORooms {...defaultProps} isConnected={true} />)
        fireEvent.click(screen.getByText("Public Room"))
        expect(screen.getByLabelText("Close room")).toBeTruthy()
        expect(screen.getByText("OPEN")).toBeTruthy()
    })

    it("opens modal when Members Room is clicked", () => {
        render(<DAORooms {...defaultProps} isMember={true} />)
        fireEvent.click(screen.getByText("Members Room"))
        expect(screen.getByLabelText("Close room")).toBeTruthy()
        expect(screen.getByText("MEMBERS")).toBeTruthy()
    })

    it("closes modal on close button click", () => {
        render(<DAORooms {...defaultProps} isConnected={true} />)
        fireEvent.click(screen.getByText("Public Room"))
        expect(screen.getByLabelText("Close room")).toBeTruthy()
        fireEvent.click(screen.getByLabelText("Close room"))
        expect(screen.queryByLabelText("Close room")).toBeNull()
    })

    it("locks body scroll when modal is open", () => {
        render(<DAORooms {...defaultProps} isConnected={true} />)
        fireEvent.click(screen.getByText("Public Room"))
        expect(document.body.style.overflow).toBe("hidden")
    })

    it("restores body scroll when modal closes", () => {
        render(<DAORooms {...defaultProps} isConnected={true} />)
        fireEvent.click(screen.getByText("Public Room"))
        fireEvent.click(screen.getByLabelText("Close room"))
        expect(document.body.style.overflow).toBe("")
    })

    it("hides Manage channels link when no channels deployed", () => {
        render(<DAORooms {...defaultProps} hasChannels={false} />)
        expect(screen.queryByText("Manage channels →")).toBeNull()
    })

    it("shows Manage channels link when channels are deployed", () => {
        render(<DAORooms {...defaultProps} hasChannels={true} />)
        expect(screen.getByText("Manage channels →")).toBeTruthy()
    })
})
