/**
 * QuestProgress.test.tsx — Component tests for the Quest Hub widget.
 *
 * v2.29: Tests for the redesigned gamified quest panel including:
 * - Collapsed/expanded states
 * - SVG radial ring rendering
 * - Quest card grid with completion states
 * - Candidature CTA visibility
 * - ARIA/accessibility (details/summary)
 * - Compact mode backward compatibility
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QuestProgress } from "./QuestProgress"

// Mock quests module
vi.mock("../../lib/quests", () => ({
    QUESTS: [
        { id: "q1", title: "Quest Alpha", description: "First quest", xp: 10, icon: "🔐" },
        { id: "q2", title: "Quest Beta", description: "Second quest", xp: 15, icon: "🧭" },
        { id: "q3", title: "Quest Gamma", description: "Third quest", xp: 20, icon: "📋" },
    ],
    CANDIDATURE_XP_THRESHOLD: 30,
    TOTAL_POSSIBLE_XP: 45,
    loadQuestProgress: vi.fn(() => ({
        completed: [],
        totalXP: 0,
    })),
    fetchUserQuests: vi.fn(() => Promise.resolve(null)),
    canApplyForMembership: vi.fn(() => false),
}))

// Mock network hook
vi.mock("../../hooks/useNetworkNav", () => ({
    useNetworkKey: () => "test12",
}))

const questsMock = await import("../../lib/quests")

function renderWithRouter(ui: React.ReactElement) {
    return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe("QuestProgress — Collapsed State", () => {
    beforeEach(() => {
        vi.mocked(questsMock.loadQuestProgress).mockReturnValue({
            completed: [{ questId: "q1", completedAt: Date.now() }],
            totalXP: 10,
        })
        vi.mocked(questsMock.canApplyForMembership).mockReturnValue(false)
    })

    it("renders collapsed by default with summary bar", () => {
        renderWithRouter(<QuestProgress />)
        expect(screen.getByTestId("quest-hub")).toBeInTheDocument()
        expect(screen.getByTestId("quest-hub-toggle")).toBeInTheDocument()
    })

    it("shows quest count and XP in summary", () => {
        renderWithRouter(<QuestProgress />)
        expect(screen.getByText("1 / 3 Quests")).toBeInTheDocument()
        // "10 XP" appears in summary bar — may also match quest cards
        expect(screen.getAllByText("10 XP").length).toBeGreaterThanOrEqual(1)
    })

    it("renders SVG radial progress ring", () => {
        renderWithRouter(<QuestProgress />)
        const svg = document.querySelector(".quest-ring")
        expect(svg).toBeInTheDocument()
        // Check that ring text elements exist with correct percentage
        const ringTexts = document.querySelectorAll(".quest-ring__text")
        expect(ringTexts.length).toBeGreaterThan(0)
        expect(ringTexts[0].textContent).toBe("33%")
    })

    it("hides quest cards when collapsed", () => {
        renderWithRouter(<QuestProgress />)
        // details is closed by default — cards are not accessible
        const hub = screen.getByTestId("quest-hub")
        expect(hub).not.toHaveAttribute("open")
    })
})

describe("QuestProgress — Expanded State", () => {
    beforeEach(() => {
        vi.mocked(questsMock.loadQuestProgress).mockReturnValue({
            completed: [
                { questId: "q1", completedAt: Date.now() },
                { questId: "q2", completedAt: Date.now() },
            ],
            totalXP: 25,
        })
        vi.mocked(questsMock.canApplyForMembership).mockReturnValue(false)
    })

    it("expands on summary click", () => {
        renderWithRouter(<QuestProgress />)
        const toggle = screen.getByTestId("quest-hub-toggle")
        fireEvent.click(toggle)
        const hub = screen.getByTestId("quest-hub")
        expect(hub).toHaveAttribute("open")
    })

    it("shows all quest cards when expanded", () => {
        renderWithRouter(<QuestProgress />)
        fireEvent.click(screen.getByTestId("quest-hub-toggle"))
        expect(screen.getByTestId("quest-card-q1")).toBeInTheDocument()
        expect(screen.getByTestId("quest-card-q2")).toBeInTheDocument()
        expect(screen.getByTestId("quest-card-q3")).toBeInTheDocument()
    })

    it("marks completed quests with done class", () => {
        renderWithRouter(<QuestProgress />)
        fireEvent.click(screen.getByTestId("quest-hub-toggle"))
        const q1 = screen.getByTestId("quest-card-q1")
        const q3 = screen.getByTestId("quest-card-q3")
        expect(q1.classList.contains("quest-card--done")).toBe(true)
        expect(q3.classList.contains("quest-card--done")).toBe(false)
    })

    it("shows XP badges on each card", () => {
        renderWithRouter(<QuestProgress />)
        fireEvent.click(screen.getByTestId("quest-hub-toggle"))
        // XP values may appear in both summary and cards, so use getAllByText
        expect(screen.getAllByText("10 XP").length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText("15 XP").length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText("20 XP").length).toBeGreaterThanOrEqual(1)
    })
})

describe("QuestProgress — Candidature CTA", () => {
    it("shows CTA when eligible (own profile)", () => {
        vi.mocked(questsMock.loadQuestProgress).mockReturnValue({
            completed: [
                { questId: "q1", completedAt: Date.now() },
                { questId: "q2", completedAt: Date.now() },
                { questId: "q3", completedAt: Date.now() },
            ],
            totalXP: 45,
        })
        vi.mocked(questsMock.canApplyForMembership).mockReturnValue(true)

        renderWithRouter(<QuestProgress />)
        // Eligible badge should show in collapsed state
        expect(screen.getByText("✦ Eligible")).toBeInTheDocument()

        // Expand and check CandidatureUnlock component (v3.2 replacement)
        fireEvent.click(screen.getByTestId("quest-hub-toggle"))
        expect(screen.getByTestId("candidature-unlock-ready")).toBeInTheDocument()
        expect(screen.getByText("🚀 Claim Candidature →")).toBeInTheDocument()
    })

    it("shows locked state when not eligible", () => {
        vi.mocked(questsMock.loadQuestProgress).mockReturnValue({
            completed: [],
            totalXP: 0,
        })
        vi.mocked(questsMock.canApplyForMembership).mockReturnValue(false)

        renderWithRouter(<QuestProgress />)
        fireEvent.click(screen.getByTestId("quest-hub-toggle"))
        // CandidatureUnlock renders in locked state (no ready CTA)
        expect(screen.queryByTestId("candidature-unlock-ready")).not.toBeInTheDocument()
        expect(screen.getByTestId("candidature-unlock-locked")).toBeInTheDocument()
    })

    it("hides CandidatureUnlock when viewing another user's profile", () => {
        vi.mocked(questsMock.fetchUserQuests).mockResolvedValue({
            completed: [
                { questId: "q1", completedAt: Date.now() },
                { questId: "q2", completedAt: Date.now() },
                { questId: "q3", completedAt: Date.now() },
            ],
            totalXP: 45,
        })

        renderWithRouter(<QuestProgress address="g1other..." />)
        // CandidatureUnlock should not render at all for other users
        expect(screen.queryByTestId("candidature-unlock-ready")).not.toBeInTheDocument()
        expect(screen.queryByTestId("candidature-unlock-locked")).not.toBeInTheDocument()
    })
})

describe("QuestProgress — Compact Mode", () => {
    it("renders compact bar with XP label", () => {
        vi.mocked(questsMock.loadQuestProgress).mockReturnValue({
            completed: [{ questId: "q1", completedAt: Date.now() }],
            totalXP: 10,
        })

        const { container } = renderWithRouter(<QuestProgress compact />)
        expect(container.querySelector(".quest-compact")).toBeInTheDocument()
        expect(container.querySelector(".quest-compact__bar")).toBeInTheDocument()
        expect(screen.getByText("10 XP")).toBeInTheDocument()
    })

    it("does NOT render the full hub in compact mode", () => {
        renderWithRouter(<QuestProgress compact />)
        expect(screen.queryByTestId("quest-hub")).not.toBeInTheDocument()
    })
})

describe("QuestProgress — Loading State", () => {
    it("shows loading state when address is provided", () => {
        vi.mocked(questsMock.fetchUserQuests).mockReturnValue(
            new Promise(() => {}) // never resolves
        )

        renderWithRouter(<QuestProgress address="g1loading..." />)
        expect(screen.getByText("Loading quest progress...")).toBeInTheDocument()
    })
})

describe("QuestProgress — ARIA", () => {
    it("uses details/summary for keyboard accessibility", () => {
        vi.mocked(questsMock.loadQuestProgress).mockReturnValue({
            completed: [],
            totalXP: 0,
        })

        renderWithRouter(<QuestProgress />)
        const hub = screen.getByTestId("quest-hub")
        expect(hub.tagName.toLowerCase()).toBe("details")
        const toggle = screen.getByTestId("quest-hub-toggle")
        expect(toggle.tagName.toLowerCase()).toBe("summary")
    })

    it("SVG ring has aria-hidden", () => {
        renderWithRouter(<QuestProgress />)
        const svg = document.querySelector(".quest-ring")
        expect(svg).toHaveAttribute("aria-hidden", "true")
    })
})
