/**
 * ValidatorsPanel.test.tsx
 *
 * Per-panel isolation contract:
 *   1. Healthy state → "Healthy" label, "14 / 14" count, view validators link
 *   2. Loading → skeleton cards render
 *   3. Error/no data → panel shows "—", NEVER throws
 */

import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../../test/test-utils"
import { ValidatorsPanel } from "./ValidatorsPanel"

// ── Module-level mocks ────────────────────────────────────────

vi.mock("../../../hooks/home/useValidatorHealth", () => ({
    useValidatorHealth: vi.fn(() => ({
        status: "healthy",
        active: 0,
        total: 0,
        avgUptime: null,
        latestIncident: null,
        loading: false,
    })),
}))

vi.mock("../../../hooks/useNetwork", () => ({
    useNetwork: vi.fn(() => ({
        networkKey: "test13",
        rpcUrl: "https://rpc.test13.gno.land",
    })),
}))

// Resolve for per-test control
const healthMod = await import("../../../hooks/home/useValidatorHealth")

// ── Tests ─────────────────────────────────────────────────────

describe("ValidatorsPanel — healthy state", () => {
    it("renders 'Healthy' status label", () => {
        vi.mocked(healthMod.useValidatorHealth).mockReturnValue({
            status: "healthy",
            active: 14,
            total: 14,
            avgUptime: 99.9,
            latestIncident: null,
            loading: false,
        })
        renderWithProviders(<ValidatorsPanel />)
        expect(screen.getByText("Healthy")).toBeInTheDocument()
    })

    it("renders '14 / 14' active/total count", () => {
        vi.mocked(healthMod.useValidatorHealth).mockReturnValue({
            status: "healthy",
            active: 14,
            total: 14,
            avgUptime: 99.9,
            latestIncident: null,
            loading: false,
        })
        renderWithProviders(<ValidatorsPanel />)
        expect(screen.getByText("14 / 14")).toBeInTheDocument()
    })

    it("renders a link to /test13/validators (view validators CTA)", () => {
        vi.mocked(healthMod.useValidatorHealth).mockReturnValue({
            status: "healthy",
            active: 14,
            total: 14,
            avgUptime: null,
            latestIncident: null,
            loading: false,
        })
        renderWithProviders(<ValidatorsPanel />)
        const links = screen.getAllByRole("link")
        const hasValidatorsLink = links.some((l) => l.getAttribute("href") === "/test13/validators")
        expect(hasValidatorsLink).toBe(true)
    })

    it("renders the panel container testid", () => {
        vi.mocked(healthMod.useValidatorHealth).mockReturnValue({
            status: "healthy",
            active: 5,
            total: 5,
            avgUptime: null,
            latestIncident: null,
            loading: false,
        })
        renderWithProviders(<ValidatorsPanel />)
        expect(screen.getByTestId("validators-panel")).toBeInTheDocument()
    })

    it("renders 'Degraded' when status is degraded", () => {
        vi.mocked(healthMod.useValidatorHealth).mockReturnValue({
            status: "degraded",
            active: 12,
            total: 14,
            avgUptime: 95.0,
            latestIncident: null,
            loading: false,
        })
        renderWithProviders(<ValidatorsPanel />)
        expect(screen.getByText("Degraded")).toBeInTheDocument()
    })

    it("renders 'Down' when status is down", () => {
        vi.mocked(healthMod.useValidatorHealth).mockReturnValue({
            status: "down",
            active: 10,
            total: 14,
            avgUptime: 85.0,
            latestIncident: { severity: "CRITICAL", moniker: "val-01", details: "offline" },
            loading: false,
        })
        renderWithProviders(<ValidatorsPanel />)
        expect(screen.getByText("Down")).toBeInTheDocument()
    })

    it("renders avg uptime when available", () => {
        vi.mocked(healthMod.useValidatorHealth).mockReturnValue({
            status: "healthy",
            active: 14,
            total: 14,
            avgUptime: 99.5,
            latestIncident: null,
            loading: false,
        })
        renderWithProviders(<ValidatorsPanel />)
        expect(screen.getByText("99.5%")).toBeInTheDocument()
    })
})

describe("ValidatorsPanel — loading", () => {
    it("shows skeleton cards while loading", () => {
        vi.mocked(healthMod.useValidatorHealth).mockReturnValue({
            status: "healthy",
            active: 0,
            total: 0,
            avgUptime: null,
            latestIncident: null,
            loading: true,
        })
        renderWithProviders(<ValidatorsPanel />)
        const skeletons = screen.getAllByTestId("action-card-skeleton")
        expect(skeletons.length).toBeGreaterThanOrEqual(1)
    })
})

describe("ValidatorsPanel — error / no data", () => {
    it("shows '—' when total is 0 (not loading)", () => {
        vi.mocked(healthMod.useValidatorHealth).mockReturnValue({
            status: "healthy",
            active: 0,
            total: 0,
            avgUptime: null,
            latestIncident: null,
            loading: false,
        })
        renderWithProviders(<ValidatorsPanel />)
        // active/total "—" and uptime "—"
        const dashes = screen.getAllByText("—")
        expect(dashes.length).toBeGreaterThanOrEqual(1)
    })

    it("does NOT throw when hook returns zero/null data", () => {
        vi.mocked(healthMod.useValidatorHealth).mockReturnValue({
            status: "healthy",
            active: 0,
            total: 0,
            avgUptime: null,
            latestIncident: null,
            loading: false,
        })
        expect(() => renderWithProviders(<ValidatorsPanel />)).not.toThrow()
    })

    it("panel container still renders when values are zero", () => {
        vi.mocked(healthMod.useValidatorHealth).mockReturnValue({
            status: "healthy",
            active: 0,
            total: 0,
            avgUptime: null,
            latestIncident: null,
            loading: false,
        })
        renderWithProviders(<ValidatorsPanel />)
        expect(screen.getByTestId("validators-panel")).toBeInTheDocument()
    })
})
