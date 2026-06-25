import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { HomeSnapshot } from "../../lib/homeApi"

vi.mock("../../hooks/home/useHomeSnapshot", () => ({ useHomeSnapshot: vi.fn() }))

const { useHomeSnapshot } = await import("../../hooks/home/useHomeSnapshot")
const { EcosystemBand } = await import("./EcosystemBand")

const snap = (counts: Record<string, number>) => ({ counts } as unknown as HomeSnapshot)

describe("EcosystemBand", () => {
    it("renders tiles for the real counts when the snapshot is usable", () => {
        vi.mocked(useHomeSnapshot).mockReturnValue({ snapshot: snap({ tokens: 12, agents: 3, validators: 5 }), usable: true, isLoading: false })
        render(<EcosystemBand />)
        expect(screen.getByTestId("eco-tokens")).toHaveTextContent("12")
        expect(screen.getByTestId("eco-agents")).toHaveTextContent("3")
        expect(screen.getByTestId("eco-validators")).toHaveTextContent("5")
    })

    it("omits a tile whose count is 0 (never a fabricated 0)", () => {
        vi.mocked(useHomeSnapshot).mockReturnValue({ snapshot: snap({ tokens: 12, agents: 0, validators: 5 }), usable: true, isLoading: false })
        render(<EcosystemBand />)
        expect(screen.queryByTestId("eco-agents")).not.toBeInTheDocument()
        expect(screen.getByTestId("eco-tokens")).toBeInTheDocument()
    })

    it("renders nothing when the snapshot is not usable", () => {
        vi.mocked(useHomeSnapshot).mockReturnValue({ snapshot: null, usable: false, isLoading: false })
        const { container } = render(<EcosystemBand />)
        expect(container.querySelector(".ecosystem-band")).toBeNull()
    })
})
