/**
 * LaunchpadDoor.test.tsx — the launchpad card now shows the live token count
 * from the home snapshot when available (honest: omitted → promo fallback, never
 * a fabricated 0). Snapshot data is real once B1 is fixed (#528, merged).
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { HomeSnapshot } from "../../../lib/homeApi"

vi.mock("../../../hooks/home/useHomeSnapshot", () => ({ useHomeSnapshot: vi.fn() }))

const { useHomeSnapshot } = await import("../../../hooks/home/useHomeSnapshot")
const { LaunchpadDoor } = await import("./LaunchpadDoor")

const snap = (tokens: number) => ({ counts: { tokens } } as unknown as HomeSnapshot)
const renderIt = () => render(<MemoryRouter><LaunchpadDoor networkKey="test13" /></MemoryRouter>)

describe("LaunchpadDoor", () => {
    it("shows the live token count when the snapshot is usable", () => {
        vi.mocked(useHomeSnapshot).mockReturnValue({ snapshot: snap(12), usable: true, isLoading: false })
        renderIt()
        expect(screen.getByText("12")).toBeInTheDocument()
        expect(screen.getByText(/tokens created/i)).toBeInTheDocument()
    })

    it("singularizes for exactly one token", () => {
        vi.mocked(useHomeSnapshot).mockReturnValue({ snapshot: snap(1), usable: true, isLoading: false })
        renderIt()
        expect(screen.getByText("1")).toBeInTheDocument()
        expect(screen.getByText(/^token created$/i)).toBeInTheDocument()
    })

    it("falls back to the promo (never a fabricated 0) when the snapshot is not usable", () => {
        vi.mocked(useHomeSnapshot).mockReturnValue({ snapshot: null, usable: false, isLoading: false })
        renderIt()
        expect(screen.getByText(/launch a token in minutes/i)).toBeInTheDocument()
        expect(screen.queryByText("0")).not.toBeInTheDocument()
    })
})
