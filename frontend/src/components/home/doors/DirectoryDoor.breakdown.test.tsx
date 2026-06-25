/**
 * DirectoryDoor.breakdown.test.tsx — R2-H4b + R2-H5 composition donut + chips.
 *
 * Asserts:
 *   - the donut (ring SVG) renders when realms/packages/members counts exist,
 *   - one ring segment per non-zero count,
 *   - segments are token-colored (CSS variables, no hard-coded hex),
 *   - stat chips show the numeric counts,
 *   - zero-valued counts are omitted (no fabricated segment/chip),
 *   - when ONLY members is available (realms+packages 0) → NO donut, count kept,
 *   - the card stays a single link (the SVG adds no nested anchor).
 *
 * Mutation guard: the "only members → no donut" test fails if a one-number donut
 * is ever fabricated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { DirectoryHighlights } from "../../../hooks/home/useDirectoryHighlights"

vi.mock("../../../hooks/home/useDirectoryHighlights", () => ({ useDirectoryHighlights: vi.fn() }))

const { useDirectoryHighlights } = await import("../../../hooks/home/useDirectoryHighlights")
const { DirectoryDoor } = await import("./DirectoryDoor")

const mk = (o: Partial<DirectoryHighlights>): DirectoryHighlights => ({
    memberCount: 0, members: [], realmCount: 0, packageCount: 0, loading: false, ...o,
})
const renderIt = () => render(<MemoryRouter><DirectoryDoor networkKey="test13" /></MemoryRouter>)

describe("DirectoryDoor — composition donut + chips", () => {
    beforeEach(() => vi.clearAllMocks())

    it("renders the donut SVG with one segment per non-zero count", () => {
        vi.mocked(useDirectoryHighlights).mockReturnValue(mk({ memberCount: 50, realmCount: 11, packageCount: 15 }))
        const { container } = renderIt()
        const donut = container.querySelector("svg.directory-door__donut")
        expect(donut).not.toBeNull()
        const segs = container.querySelectorAll(".directory-door__donut-seg")
        expect(segs).toHaveLength(3)
    })

    it("colors segments with token CSS variables (no hard-coded hex)", () => {
        vi.mocked(useDirectoryHighlights).mockReturnValue(mk({ memberCount: 50, realmCount: 11, packageCount: 15 }))
        const { container } = renderIt()
        const segs = [...container.querySelectorAll(".directory-door__donut-seg")] as SVGCircleElement[]
        for (const seg of segs) {
            const stroke = seg.getAttribute("stroke") ?? ""
            expect(stroke.startsWith("var(--color-k-")).toBe(true)
        }
    })

    it("renders numeric stat chips for each present count", () => {
        vi.mocked(useDirectoryHighlights).mockReturnValue(mk({ memberCount: 50, realmCount: 11, packageCount: 15 }))
        const { container } = renderIt()
        const chips = container.querySelectorAll(".directory-door__chip")
        // members + realms + packages = 3 chips
        expect(chips).toHaveLength(3)
        const text = container.textContent ?? ""
        expect(text).toMatch(/11/)
        expect(text).toMatch(/15/)
        expect(text).toMatch(/50/)
    })

    it("omits a segment AND chip for a zero count (no fabricated zero)", () => {
        // packages = 0 → only members + realms render
        vi.mocked(useDirectoryHighlights).mockReturnValue(mk({ memberCount: 50, realmCount: 11, packageCount: 0 }))
        const { container } = renderIt()
        expect(container.querySelectorAll(".directory-door__donut-seg")).toHaveLength(2)
        expect(container.querySelectorAll(".directory-door__chip")).toHaveLength(2)
        // never a bare "0 packages"
        expect(container.textContent).not.toMatch(/0\s*packages/i)
    })

    it("when ONLY members is available, renders NO donut but keeps the count", () => {
        vi.mocked(useDirectoryHighlights).mockReturnValue(mk({ memberCount: 50, realmCount: 0, packageCount: 0 }))
        const { container, getByText } = renderIt()
        // honesty: a single number must not become a donut
        expect(container.querySelector("svg.directory-door__donut")).toBeNull()
        expect(getByText(/50 members/)).toBeInTheDocument()
    })

    it("renders nothing-extra when no counts at all (no donut, no fabricated chips)", () => {
        vi.mocked(useDirectoryHighlights).mockReturnValue(mk({ memberCount: 0, realmCount: 0, packageCount: 0 }))
        const { container } = renderIt()
        expect(container.querySelector("svg.directory-door__donut")).toBeNull()
        expect(container.querySelectorAll(".directory-door__chip")).toHaveLength(0)
        // still a usable directory link
        expect(container.querySelector("a.door")).toHaveAttribute("href", "/test13/directory")
    })

    it("keeps the whole card a single link — the donut adds no nested anchor", () => {
        vi.mocked(useDirectoryHighlights).mockReturnValue(mk({ memberCount: 50, realmCount: 11, packageCount: 15 }))
        const { container } = renderIt()
        expect(container.querySelectorAll("a").length).toBe(1)
    })

    it("does not render the donut while loading", () => {
        vi.mocked(useDirectoryHighlights).mockReturnValue(mk({ loading: true }))
        const { container } = renderIt()
        expect(container.querySelector("svg.directory-door__donut")).toBeNull()
        // Door loading skeleton instead
        expect(container.querySelectorAll(".door__sk").length).toBeGreaterThan(0)
    })
})
