/**
 * CandidaturePage.test.tsx — Component tests for the Candidature form.
 *
 * Tests cover:
 * - XP gate (ineligible vs eligible)
 * - Form rendering and field validation
 * - Skills preview tags
 * - Character counters
 * - Existing candidature status display
 * - Re-candidature fee display
 * - Success state after submission
 * - Wallet not connected state
 * - Candidatures list rendering
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import CandidaturePage from "./CandidaturePage"

// ── Mock dependencies ────────────────────────────────────────────────

const mockNavigate = vi.fn()

vi.mock("../hooks/useNetworkNav", () => ({
    useNetworkNav: () => mockNavigate,
}))

vi.mock("../lib/quests", () => ({
    canApplyForMembership: vi.fn(() => false),
    loadQuestProgress: vi.fn(() => ({ completed: [], totalXP: 0 })),
    CANDIDATURE_XP_THRESHOLD: 100,
    trackPageVisit: vi.fn(),
}))

vi.mock("../lib/candidatureTemplate", () => ({
    validateCandidature: vi.fn(() => null),
    parseSkills: vi.fn((s: string) =>
        s.split(",").map((x: string) => x.trim()).filter(Boolean)
    ),
    buildSubmitCandidatureMsg: vi.fn(() => ({ type: "msg" })),
    parseCandidatureList: vi.fn(() => []),
    getCandidatureSendAmount: vi.fn(() => 0n),
    MAX_NAME_LENGTH: 64,
    MAX_PHILOSOPHY_LENGTH: 1024,
    MAX_SKILLS_LENGTH: 256,
}))

vi.mock("../lib/config", () => ({
    MEMBA_DAO: { candidaturePath: "gno.land/r/samcrew/memba_dao_candidature" },
    GNO_RPC_URL: "https://rpc.test.gno.land",
}))

vi.mock("../lib/grc20", () => ({
    doContractBroadcast: vi.fn(),
}))

vi.mock("../lib/dao/shared", () => ({
    queryRender: vi.fn(() => Promise.resolve(null)),
}))

// Mock QuestProgress to avoid deep dependency chain
vi.mock("../components/ui/QuestProgress", () => ({
    QuestProgress: () => <div data-testid="quest-progress-mock">QuestProgress</div>,
}))

// Mock ErrorToast
vi.mock("../components/ui/ErrorToast", () => ({
    ErrorToast: ({ message, onDismiss }: { message: string | null; onDismiss: () => void }) =>
        message ? <div data-testid="error-toast" onClick={onDismiss}>{message}</div> : null,
}))

// Mock useOutletContext
const mockAdena = {
    connected: true,
    address: "g1testuser123",
    pubkeyJSON: "",
    chainId: "test12",
    installed: true,
    loading: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signArbitrary: vi.fn(),
}

const mockAuth = {
    token: { value: "test-token" },
    isAuthenticated: true,
    address: "g1testuser123",
    loading: false,
    error: null,
}

vi.mock("react-router-dom", () => ({
    useOutletContext: () => ({ adena: mockAdena, auth: mockAuth }),
}))

const questsMock = await import("../lib/quests")
const candidatureMock = await import("../lib/candidatureTemplate")
const daoShared = await import("../lib/dao/shared")
const grc20Mock = await import("../lib/grc20")

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(questsMock.canApplyForMembership).mockReturnValue(false)
    vi.mocked(questsMock.loadQuestProgress).mockReturnValue({ completed: [], totalXP: 0 })
    vi.mocked(candidatureMock.parseCandidatureList).mockReturnValue([])
    vi.mocked(candidatureMock.getCandidatureSendAmount).mockReturnValue(0n)
    vi.mocked(candidatureMock.validateCandidature).mockReturnValue(null)
    vi.mocked(daoShared.queryRender).mockResolvedValue(null)
    mockAdena.connected = true
    mockAuth.isAuthenticated = true
})

describe("CandidaturePage — XP Gate", () => {
    it("shows locked state when XP is below threshold", () => {
        vi.mocked(questsMock.loadQuestProgress).mockReturnValue({ completed: [], totalXP: 30 })
        render(<CandidaturePage />)

        expect(screen.getByText("🔒")).toBeInTheDocument()
        expect(screen.getByText("XP Required")).toBeInTheDocument()
        expect(screen.getByText(/You need 100 XP to apply/)).toBeInTheDocument()
        expect(screen.getByText(/You currently have 30 XP/)).toBeInTheDocument()
        expect(screen.getByTestId("quest-progress-mock")).toBeInTheDocument()
    })

    it("hides form when ineligible", () => {
        render(<CandidaturePage />)
        expect(screen.queryByText("Submit Your Application")).not.toBeInTheDocument()
    })

    it("shows form when eligible", () => {
        vi.mocked(questsMock.canApplyForMembership).mockReturnValue(true)
        render(<CandidaturePage />)

        expect(screen.getByText("Submit Your Application")).toBeInTheDocument()
        expect(screen.queryByText("XP Required")).not.toBeInTheDocument()
    })
})

describe("CandidaturePage — Form Fields", () => {
    beforeEach(() => {
        vi.mocked(questsMock.canApplyForMembership).mockReturnValue(true)
    })

    it("renders all form fields with labels", () => {
        render(<CandidaturePage />)

        expect(screen.getByLabelText("Name")).toBeInTheDocument()
        expect(screen.getByLabelText("Why Memba?")).toBeInTheDocument()
        expect(screen.getByLabelText("Skills")).toBeInTheDocument()
    })

    it("shows character counters that update", () => {
        render(<CandidaturePage />)

        expect(screen.getByText("0/64")).toBeInTheDocument()
        expect(screen.getByText("0/1024")).toBeInTheDocument()
        expect(screen.getByText("0/256")).toBeInTheDocument()

        fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Alice" } })
        expect(screen.getByText("5/64")).toBeInTheDocument()
    })

    it("shows skills preview tags", () => {
        render(<CandidaturePage />)

        fireEvent.change(screen.getByLabelText("Skills"), {
            target: { value: "rust, go, react" },
        })

        expect(screen.getByText("rust")).toBeInTheDocument()
        expect(screen.getByText("go")).toBeInTheDocument()
        expect(screen.getByText("react")).toBeInTheDocument()
    })

    it("has submit button", () => {
        render(<CandidaturePage />)
        expect(screen.getByText("Submit Candidature")).toBeInTheDocument()
    })
})

describe("CandidaturePage — Submission", () => {
    beforeEach(() => {
        vi.mocked(questsMock.canApplyForMembership).mockReturnValue(true)
    })

    it("submits candidature and shows success", async () => {
        vi.mocked(grc20Mock.doContractBroadcast).mockResolvedValue(undefined as never)
        render(<CandidaturePage />)

        fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Alice" } })
        fireEvent.change(screen.getByLabelText("Why Memba?"), {
            target: { value: "I believe in the mission" },
        })
        fireEvent.change(screen.getByLabelText("Skills"), { target: { value: "go, react" } })

        fireEvent.click(screen.getByText("Submit Candidature"))

        await waitFor(() => {
            expect(screen.getByText("Candidature Submitted!")).toBeInTheDocument()
        })
        expect(screen.getByText(/pending review/)).toBeInTheDocument()
        expect(screen.getByText("Back to Dashboard")).toBeInTheDocument()
    })

    it("shows error on submission failure", async () => {
        vi.mocked(grc20Mock.doContractBroadcast).mockRejectedValue(
            new Error("Transaction rejected")
        )
        render(<CandidaturePage />)

        fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Alice" } })
        fireEvent.change(screen.getByLabelText("Why Memba?"), {
            target: { value: "Motivation text" },
        })
        fireEvent.change(screen.getByLabelText("Skills"), { target: { value: "go" } })

        fireEvent.click(screen.getByText("Submit Candidature"))

        await waitFor(() => {
            expect(screen.getByTestId("error-toast")).toHaveTextContent("Transaction rejected")
        })
    })

    it("shows validation error from validateCandidature", async () => {
        vi.mocked(candidatureMock.validateCandidature).mockReturnValue("Name is required")
        render(<CandidaturePage />)

        fireEvent.click(screen.getByText("Submit Candidature"))

        await waitFor(() => {
            expect(screen.getByTestId("error-toast")).toHaveTextContent("Name is required")
        })
    })

    it("shows error when wallet not connected", async () => {
        // Keep adena.connected true so button isn't disabled, but auth fails
        mockAuth.isAuthenticated = false
        render(<CandidaturePage />)

        fireEvent.click(screen.getByText("Submit Candidature"))

        await waitFor(() => {
            expect(screen.getByTestId("error-toast")).toHaveTextContent("Connect your wallet first")
        })
    })

    it("navigates to dashboard on success button click", async () => {
        vi.mocked(grc20Mock.doContractBroadcast).mockResolvedValue(undefined as never)
        render(<CandidaturePage />)

        fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Alice" } })
        fireEvent.change(screen.getByLabelText("Why Memba?"), { target: { value: "Why" } })
        fireEvent.change(screen.getByLabelText("Skills"), { target: { value: "go" } })
        fireEvent.click(screen.getByText("Submit Candidature"))

        await waitFor(() => {
            expect(screen.getByText("Back to Dashboard")).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText("Back to Dashboard"))
        expect(mockNavigate).toHaveBeenCalledWith("/dashboard")
    })
})

describe("CandidaturePage — Existing Candidature", () => {
    beforeEach(() => {
        vi.mocked(questsMock.canApplyForMembership).mockReturnValue(true)
    })

    it("shows pending status for existing candidature", async () => {
        vi.mocked(daoShared.queryRender).mockResolvedValue("some render output")
        vi.mocked(candidatureMock.parseCandidatureList).mockReturnValue([
            {
                applicant: "g1testuser123",
                name: "Alice",
                philosophy: "Why Memba",
                skills: "go, react",
                status: "pending" as const,
                approvedBy: ["g1approver1"],
                createdAt: Date.now(),
            },
        ])

        render(<CandidaturePage />)

        await waitFor(() => {
            expect(screen.getByText("⏳ Candidature Pending")).toBeInTheDocument()
        })
        expect(screen.getByText("Approvals: 1/2")).toBeInTheDocument()
        // Form should NOT be shown
        expect(screen.queryByText("Submit Your Application")).not.toBeInTheDocument()
    })

    it("shows approved status", async () => {
        vi.mocked(daoShared.queryRender).mockResolvedValue("render output")
        vi.mocked(candidatureMock.parseCandidatureList).mockReturnValue([
            {
                applicant: "g1testuser123",
                name: "Alice",
                philosophy: "Why",
                skills: "go",
                status: "approved" as const,
                approvedBy: ["g1a", "g1b"],
                createdAt: Date.now(),
            },
        ])

        render(<CandidaturePage />)

        await waitFor(() => {
            expect(screen.getByText("✅ Candidature Approved")).toBeInTheDocument()
        })
    })

    it("shows rejected status", async () => {
        vi.mocked(daoShared.queryRender).mockResolvedValue("render output")
        vi.mocked(candidatureMock.parseCandidatureList).mockReturnValue([
            {
                applicant: "g1testuser123",
                name: "Alice",
                philosophy: "Why",
                skills: "go",
                status: "rejected" as const,
                approvedBy: [],
                createdAt: Date.now(),
            },
        ])

        render(<CandidaturePage />)

        await waitFor(() => {
            expect(screen.getByText("❌ Candidature Rejected")).toBeInTheDocument()
        })
    })
})

describe("CandidaturePage — Re-candidature Fee", () => {
    it("shows re-application fee when past rejections exist", async () => {
        vi.mocked(questsMock.canApplyForMembership).mockReturnValue(true)
        vi.mocked(candidatureMock.getCandidatureSendAmount).mockReturnValue(10_000_000n)
        vi.mocked(daoShared.queryRender).mockResolvedValue("render output")
        vi.mocked(candidatureMock.parseCandidatureList).mockReturnValue([])

        render(<CandidaturePage />)

        await waitFor(() => {
            expect(screen.getByText(/Re-application fee: 10 GNOT/)).toBeInTheDocument()
        })
    })
})

describe("CandidaturePage — Candidatures List", () => {
    it("renders list of all candidatures", async () => {
        vi.mocked(daoShared.queryRender).mockResolvedValue("render output")
        vi.mocked(candidatureMock.parseCandidatureList).mockReturnValue([
            {
                applicant: "g1alice12345",
                name: "Alice",
                philosophy: "Why",
                skills: "go, rust",
                status: "approved" as const,
                approvedBy: ["g1a", "g1b"],
                createdAt: Date.now(),
            },
            {
                applicant: "g1bob6789012",
                name: "Bob",
                philosophy: "Because",
                skills: "react",
                status: "pending" as const,
                approvedBy: [],
                createdAt: Date.now(),
            },
        ])

        render(<CandidaturePage />)

        await waitFor(() => {
            expect(screen.getByText("All Candidatures (2)")).toBeInTheDocument()
        })
        expect(screen.getByText("Alice")).toBeInTheDocument()
        expect(screen.getByText("Bob")).toBeInTheDocument()
        expect(screen.getByText("approved")).toBeInTheDocument()
        expect(screen.getByText("pending")).toBeInTheDocument()
    })

    it("shows empty state when no candidatures", async () => {
        render(<CandidaturePage />)

        await waitFor(() => {
            expect(screen.getByText("No candidatures yet. Be the first to apply!")).toBeInTheDocument()
        })
    })

    it("shows loading state for candidatures", () => {
        vi.mocked(daoShared.queryRender).mockReturnValue(new Promise(() => {}))
        render(<CandidaturePage />)

        expect(screen.getByText("Loading candidatures...")).toBeInTheDocument()
    })
})

describe("CandidaturePage — Page Setup", () => {
    it("sets document title", () => {
        render(<CandidaturePage />)
        expect(document.title).toBe("Candidature — Memba")
    })

    it("tracks page visit for quest system", () => {
        render(<CandidaturePage />)
        expect(questsMock.trackPageVisit).toHaveBeenCalledWith("candidature")
    })

    it("renders page title and subtitle", () => {
        render(<CandidaturePage />)
        expect(screen.getByText("Memba DAO Candidature")).toBeInTheDocument()
        expect(screen.getByText(/Apply to become a member/)).toBeInTheDocument()
    })
})
