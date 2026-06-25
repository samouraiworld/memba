/**
 * ContributorsDoor.test.tsx — avatar (real image w/ initials fallback) + score-bar
 * enrichment. Name/score/empty behavior is also covered in showcaseDoors.test.tsx.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { GnoloveHighlights } from "../../../hooks/home/useGnoloveHighlights"

vi.mock("../../../hooks/home/useGnoloveHighlights", () => ({ useGnoloveHighlights: vi.fn() }))

const { useGnoloveHighlights } = await import("../../../hooks/home/useGnoloveHighlights")
const { ContributorsDoor } = await import("./ContributorsDoor")

const renderIt = () => render(<MemoryRouter><ContributorsDoor networkKey="test13" /></MemoryRouter>)
const mk = (top: { login: string; score: number; avatarUrl?: string }[]): GnoloveHighlights =>
    ({ top, contributorCount: top.length, loading: false } as unknown as GnoloveHighlights)

describe("ContributorsDoor — avatars + score bars", () => {
    it("renders a real avatar image when avatarUrl is present", () => {
        vi.mocked(useGnoloveHighlights).mockReturnValue(mk([
            { login: "moul", score: 9000, avatarUrl: "https://avatars.example/moul.png" },
        ]))
        const { container } = renderIt()
        const img = container.querySelector("img.contributors-door__avatar--img") as HTMLImageElement | null
        expect(img).not.toBeNull()
        expect(img?.getAttribute("src")).toBe("https://avatars.example/moul.png")
    })

    it("falls back to initials when no avatarUrl", () => {
        vi.mocked(useGnoloveHighlights).mockReturnValue(mk([{ login: "thehowl", score: 7000 }]))
        const { container } = renderIt()
        expect(container.querySelector("img.contributors-door__avatar--img")).toBeNull()
        expect(screen.getByText("TH")).toBeInTheDocument()
    })

    it("renders score bars with the #1 contributor at 100% and others proportional", () => {
        vi.mocked(useGnoloveHighlights).mockReturnValue(mk([
            { login: "a", score: 1000 },
            { login: "b", score: 500 },
        ]))
        const { container } = renderIt()
        const fills = [...container.querySelectorAll(".contributors-door__bar-fill")] as HTMLElement[]
        expect(fills).toHaveLength(2)
        expect(fills[0].style.width).toBe("100%")
        expect(fills[1].style.width).toBe("50%")
    })
})
