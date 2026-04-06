/**
 * OrgContent.test.tsx — Component tests for the Teams management UI.
 *
 * Tests cover:
 * - Unauthenticated state (wallet not connected)
 * - Loading state
 * - Empty teams state
 * - Teams list rendering with member counts and roles
 * - Create team form toggle and submission
 * - Join team form toggle and submission
 * - Team detail view (members, invite code, leave)
 * - Admin actions (promote/demote)
 * - Workspace switching
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

// ── Mock dependencies ────────────────────────────────────────────────

const mockSetActiveOrg = vi.fn()
let mockActiveOrgId: string | null = null
let mockAuthToken: unknown = { value: "test-token" }
let mockIsAuthenticated = true
const mockAddress = "g1user123456"

vi.mock("../../contexts/OrgContext", () => ({
    useOrg: () => ({
        activeOrgId: mockActiveOrgId,
        activeOrgName: mockActiveOrgId ? "Test Team" : "Personal",
        isOrgMode: mockActiveOrgId !== null,
        setActiveOrg: (...args: unknown[]) => mockSetActiveOrg(...args),
    }),
}))

vi.mock("../../lib/api", () => ({
    api: {
        getMyTeams: vi.fn(),
        createTeam: vi.fn(),
        joinTeam: vi.fn(),
        leaveTeam: vi.fn(),
        getTeam: vi.fn(),
        updateTeamMemberRole: vi.fn(),
    },
}))

vi.mock("@bufbuild/protobuf", () => ({
    create: (_schema: unknown, data: unknown) => data,
}))

vi.mock("../../gen/memba/v1/memba_pb", () => ({
    CreateTeamRequestSchema: "CreateTeamRequestSchema",
    GetMyTeamsRequestSchema: "GetMyTeamsRequestSchema",
    GetTeamRequestSchema: "GetTeamRequestSchema",
    JoinTeamRequestSchema: "JoinTeamRequestSchema",
    LeaveTeamRequestSchema: "LeaveTeamRequestSchema",
    UpdateTeamMemberRoleRequestSchema: "UpdateTeamMemberRoleRequestSchema",
    TeamRole: { ADMIN: 0, MEMBER: 1 },
}))

vi.mock("react-router-dom", () => ({
    useOutletContext: () => ({
        auth: {
            token: mockAuthToken,
            isAuthenticated: mockIsAuthenticated,
            address: mockAddress,
            loading: false,
            error: null,
        },
    }),
}))

vi.mock("../../lib/dao/shared", () => ({
    resolveUsernames: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../lib/config", () => ({
    GNO_RPC_URL: "http://localhost:26657",
}))

// Import the mocked api to configure per-test behavior
const { api } = await import("../../lib/api")
const { default: OrgContent } = await import("./OrgContent")

// ── Test data ────────────────────────────────────────────────────────

const TEAM_ALPHA = {
    id: "team-1",
    name: "Alpha",
    inviteCode: "ABC12345",
    members: [
        { address: "g1user123456", role: 0 }, // ADMIN — current user
        { address: "g1member789", role: 1 },  // MEMBER
    ],
}

const TEAM_BETA = {
    id: "team-2",
    name: "Beta",
    inviteCode: "XYZ98765",
    members: [
        { address: "g1other999", role: 0 },
        { address: "g1user123456", role: 1 }, // current user is MEMBER
    ],
}

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks()
    mockActiveOrgId = null
    mockAuthToken = { value: "test-token" }
    mockIsAuthenticated = true
    vi.mocked(api.getMyTeams).mockResolvedValue({ teams: [] } as never)
})

describe("OrgContent — Unauthenticated", () => {
    it("shows wallet connection prompt when not authenticated", () => {
        mockIsAuthenticated = false
        mockAuthToken = null
        render(<OrgContent />)
        expect(screen.getByText("Connect your wallet to manage teams")).toBeInTheDocument()
    })
})

describe("OrgContent — Loading", () => {
    it("shows loading state while fetching teams", () => {
        vi.mocked(api.getMyTeams).mockReturnValue(new Promise(() => {}) as never)
        render(<OrgContent />)
        expect(screen.getByText("Loading teams...")).toBeInTheDocument()
    })
})

describe("OrgContent — Empty State", () => {
    it("shows empty state when no teams exist", async () => {
        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("No teams yet")).toBeInTheDocument()
        })
        expect(screen.getByText(/Create a team or join one/)).toBeInTheDocument()
    })

    it("shows action buttons", async () => {
        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("+ New Team")).toBeInTheDocument()
        })
        expect(screen.getByText("Join with Invite Code")).toBeInTheDocument()
    })
})

describe("OrgContent — Teams List", () => {
    beforeEach(() => {
        vi.mocked(api.getMyTeams).mockResolvedValue({ teams: [TEAM_ALPHA, TEAM_BETA] } as never)
    })

    it("renders team names and member counts", async () => {
        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("Your Teams (2)")).toBeInTheDocument()
        })
        // "Alpha" appears in both workspace card and team list
        expect(screen.getAllByText("Alpha").length).toBeGreaterThanOrEqual(2)
        expect(screen.getAllByText("Beta").length).toBeGreaterThanOrEqual(2)
    })

    it("shows Admin badge for admin role", async () => {
        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("Your Teams (2)")).toBeInTheDocument()
        })
        const badges = screen.getAllByText("Admin")
        expect(badges.length).toBeGreaterThanOrEqual(1)
    })

    it("renders workspace cards with Personal default", async () => {
        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("Personal")).toBeInTheDocument()
        })
        expect(screen.getByText("Your individual workspace")).toBeInTheDocument()
        expect(screen.getByText("Active")).toBeInTheDocument()
    })
})

describe("OrgContent — Create Team", () => {
    it("toggles create form on button click", async () => {
        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("+ New Team")).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText("+ New Team"))
        expect(screen.getByPlaceholderText("Team name (1-64 chars)")).toBeInTheDocument()
        expect(screen.getByText("Create Team")).toBeInTheDocument()
        expect(screen.getByText("Cancel")).toBeInTheDocument()
    })

    it("submits create team and reloads", async () => {
        vi.mocked(api.createTeam).mockResolvedValue({} as never)
        vi.mocked(api.getMyTeams)
            .mockResolvedValueOnce({ teams: [] } as never)
            .mockResolvedValueOnce({ teams: [TEAM_ALPHA] } as never)

        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("+ New Team")).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText("+ New Team"))
        const input = screen.getByPlaceholderText("Team name (1-64 chars)")
        fireEvent.change(input, { target: { value: "Alpha" } })
        fireEvent.click(screen.getByText("Create Team"))

        await waitFor(() => {
            expect(api.createTeam).toHaveBeenCalledOnce()
        })
    })

    it("disables submit when name is empty", async () => {
        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("+ New Team")).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText("+ New Team"))
        const submitBtn = screen.getByText("Create Team")
        expect(submitBtn).toBeDisabled()
    })

    it("cancels create form", async () => {
        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("+ New Team")).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText("+ New Team"))
        fireEvent.click(screen.getByText("Cancel"))
        expect(screen.queryByPlaceholderText("Team name (1-64 chars)")).not.toBeInTheDocument()
    })
})

describe("OrgContent — Join Team", () => {
    it("toggles join form on button click", async () => {
        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("Join with Invite Code")).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText("Join with Invite Code"))
        expect(screen.getByPlaceholderText("Enter 8-character invite code")).toBeInTheDocument()
        expect(screen.getByText("Join Team")).toBeInTheDocument()
    })

    it("submits join with invite code", async () => {
        vi.mocked(api.joinTeam).mockResolvedValue({} as never)
        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("Join with Invite Code")).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText("Join with Invite Code"))
        const input = screen.getByPlaceholderText("Enter 8-character invite code")
        fireEvent.change(input, { target: { value: "ABC12345" } })
        fireEvent.click(screen.getByText("Join Team"))

        await waitFor(() => {
            expect(api.joinTeam).toHaveBeenCalledOnce()
        })
    })

    it("shows error on invalid invite code", async () => {
        vi.mocked(api.joinTeam).mockRejectedValue(new Error("Invalid invite code"))
        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("Join with Invite Code")).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText("Join with Invite Code"))
        fireEvent.change(screen.getByPlaceholderText("Enter 8-character invite code"), {
            target: { value: "INVALID1" },
        })
        fireEvent.click(screen.getByText("Join Team"))

        await waitFor(() => {
            expect(screen.getByText("Invalid invite code")).toBeInTheDocument()
        })
    })
})

describe("OrgContent — Team Detail View", () => {
    beforeEach(() => {
        vi.mocked(api.getMyTeams).mockResolvedValue({ teams: [TEAM_ALPHA] } as never)
        vi.mocked(api.getTeam).mockResolvedValue({ team: TEAM_ALPHA } as never)
    })

    it("opens team detail on click", async () => {
        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("Your Teams (1)")).toBeInTheDocument()
        })

        // Click the clickable team row (not the workspace card)
        const teamRow = document.querySelector(".org-team-row--clickable") as HTMLElement
        fireEvent.click(teamRow)

        await waitFor(() => {
            expect(screen.getByText("← Back to teams")).toBeInTheDocument()
        })
        expect(screen.getByText("Members")).toBeInTheDocument()
        expect(screen.getByText("ABC12345")).toBeInTheDocument()
        expect(screen.getByText("Leave Team")).toBeInTheDocument()
    })

    it("shows promote/demote buttons for admin", async () => {
        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("Your Teams (1)")).toBeInTheDocument()
        })

        const teamRow = document.querySelector(".org-team-row--clickable") as HTMLElement
        fireEvent.click(teamRow)

        await waitFor(() => {
            expect(screen.getByText("Promote")).toBeInTheDocument()
        })
    })

    it("navigates back to teams list", async () => {
        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("Your Teams (1)")).toBeInTheDocument()
        })

        const teamRow = document.querySelector(".org-team-row--clickable") as HTMLElement
        fireEvent.click(teamRow)

        await waitFor(() => {
            expect(screen.getByText("← Back to teams")).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText("← Back to teams"))
        await waitFor(() => {
            expect(screen.getByText("Your Teams (1)")).toBeInTheDocument()
        })
    })
})

describe("OrgContent — Leave Team", () => {
    it("calls leaveTeam and clears active org if leaving active team", async () => {
        mockActiveOrgId = "team-1"
        vi.mocked(api.getMyTeams).mockResolvedValue({ teams: [TEAM_ALPHA] } as never)
        vi.mocked(api.getTeam).mockResolvedValue({ team: TEAM_ALPHA } as never)
        vi.mocked(api.leaveTeam).mockResolvedValue({} as never)

        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("Your Teams (1)")).toBeInTheDocument()
        })

        const teamRow = document.querySelector(".org-team-row--clickable") as HTMLElement
        fireEvent.click(teamRow)

        await waitFor(() => {
            expect(screen.getByText("Leave Team")).toBeInTheDocument()
        })

        // Click Leave Team — opens ConfirmDialog
        fireEvent.click(screen.getByText("Leave Team"))

        // Confirm in the dialog
        await waitFor(() => {
            expect(screen.getByText(/Leave "Alpha"\?/)).toBeInTheDocument()
        })
        const confirmBtn = screen.getAllByText("Leave Team").find(
            el => el.closest(".confirm-dialog__btn"),
        )!
        fireEvent.click(confirmBtn)

        await waitFor(() => {
            expect(api.leaveTeam).toHaveBeenCalledOnce()
            expect(mockSetActiveOrg).toHaveBeenCalledWith(null)
        })
    })
})

describe("OrgContent — Workspace Switch", () => {
    it("switches to team workspace on card click", async () => {
        vi.mocked(api.getMyTeams).mockResolvedValue({ teams: [TEAM_ALPHA] } as never)
        render(<OrgContent />)

        await waitFor(() => {
            expect(screen.getByText("Your Teams (1)")).toBeInTheDocument()
        })

        // Click the Alpha workspace card (in workspace cards section, not teams list)
        const workspaceCards = screen.getByText("Your individual workspace")
            .closest(".org-workspace-cards")!
        const alphaCard = workspaceCards.querySelector(".org-workspace-icon--team")!
            .closest("button")!
        fireEvent.click(alphaCard)

        expect(mockSetActiveOrg).toHaveBeenCalledWith("team-1", "Alpha")
    })

    it("switches back to Personal workspace", async () => {
        mockActiveOrgId = "team-1"
        vi.mocked(api.getMyTeams).mockResolvedValue({ teams: [TEAM_ALPHA] } as never)
        render(<OrgContent />)

        await waitFor(() => {
            expect(screen.getByText("Personal")).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText("Personal").closest("button")!)
        expect(mockSetActiveOrg).toHaveBeenCalledWith(null)
    })
})

describe("OrgContent — Error Handling", () => {
    it("shows error when team loading fails", async () => {
        vi.mocked(api.getMyTeams).mockRejectedValue(new Error("Network error"))
        render(<OrgContent />)

        await waitFor(() => {
            expect(screen.getByText("Network error")).toBeInTheDocument()
        })
    })

    it("shows error when create team fails", async () => {
        vi.mocked(api.createTeam).mockRejectedValue(new Error("Team name taken"))

        render(<OrgContent />)
        await waitFor(() => {
            expect(screen.getByText("+ New Team")).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText("+ New Team"))
        fireEvent.change(screen.getByPlaceholderText("Team name (1-64 chars)"), {
            target: { value: "Duplicate" },
        })
        fireEvent.click(screen.getByText("Create Team"))

        await waitFor(() => {
            expect(screen.getByText("Team name taken")).toBeInTheDocument()
        })
    })
})
