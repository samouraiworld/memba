import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

// ExplorerLink imports only `isExplorerEnabled` from config; mock just that.
vi.mock("../../lib/config", () => ({ isExplorerEnabled: vi.fn() }))

import { ExplorerLink } from "./ExplorerLink"
import { isExplorerEnabled } from "../../lib/config"

const mockEnabled = vi.mocked(isExplorerEnabled)

beforeEach(() => {
    cleanup()
    mockEnabled.mockReset()
})

describe("ExplorerLink gating", () => {
    it("renders a SPA link to the explorer route when the flag is on", () => {
        mockEnabled.mockReturnValue(true)
        render(
            <MemoryRouter>
                <ExplorerLink realmPath="gno.land/r/x/y" networkKey="test13" />
            </MemoryRouter>,
        )
        expect(screen.getByRole("link")).toHaveAttribute("href", "/test13/explorer/r/x/y")
    })

    it("renders nothing when the flag is off (never links into the coming-soon gate)", () => {
        mockEnabled.mockReturnValue(false)
        const { container } = render(
            <MemoryRouter>
                <ExplorerLink realmPath="gno.land/r/x/y" networkKey="test13" />
            </MemoryRouter>,
        )
        expect(container.querySelector("a")).toBeNull()
    })

    it("renders nothing for an unusable realm path even when enabled", () => {
        mockEnabled.mockReturnValue(true)
        const { container } = render(
            <MemoryRouter>
                <ExplorerLink realmPath="gno.land/" networkKey="test13" />
            </MemoryRouter>,
        )
        expect(container.querySelector("a")).toBeNull()
    })
})
