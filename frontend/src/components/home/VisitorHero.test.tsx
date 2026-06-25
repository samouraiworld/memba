/**
 * VisitorHero.test.tsx — Tests for the visitor (logged-out) hero spine.
 *
 * Covers:
 * - Headline renders
 * - "Explore DAOs" is a link to /:network/dao (no wallet gating)
 * - When adena.installed === true → secondary CTA is a button calling adena.connect
 * - When adena.installed === false → secondary CTA is an "Install Adena" link to adena.app
 */

import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent } from "@testing-library/react"
import { renderWithProviders, mockLayoutContext } from "../../test/test-utils"
import { VisitorHero } from "./VisitorHero"
import { HERO_HEADLINES, ACTIVE_HEADLINE } from "./visitorHeroHeadlines"

// ── Mock react-router-dom useOutletContext ────────────────────────────
vi.mock("react-router-dom", async () => {
    const actual = await import("react-router-dom")
    return {
        ...actual,
        useOutletContext: vi.fn(() => mockLayoutContext()),
    }
})

// ── Mock useNetworkNav so links are deterministic ─────────────────────
vi.mock("../../hooks/useNetworkNav", () => ({
    useNetworkKey: vi.fn(() => "test13"),
    useNetworkNav: vi.fn(() => vi.fn()),
    useNetworkPath: vi.fn(() => (path: string) => `/test13/${path}`),
}))

// Resolve mocks before tests (vi.mock + await import pattern)
const routerMod = await import("react-router-dom")
const networkNavMod = await import("../../hooks/useNetworkNav")
void networkNavMod

// ── Tests ─────────────────────────────────────────────────────────────

describe("VisitorHero — HERO_HEADLINES A/B const", () => {
    it("HERO_HEADLINES defines both manifesto and atlas variants", () => {
        expect(HERO_HEADLINES.manifesto).toBeTruthy()
        expect(HERO_HEADLINES.atlas).toBeTruthy()
        expect(HERO_HEADLINES.manifesto).not.toBe(HERO_HEADLINES.atlas)
    })

    it("ACTIVE_HEADLINE defaults to manifesto (production copy must not change)", () => {
        expect(ACTIVE_HEADLINE).toBe(HERO_HEADLINES.manifesto)
    })

    it("renders ACTIVE_HEADLINE in the h1", () => {
        renderWithProviders(<VisitorHero />)
        expect(screen.getByText(ACTIVE_HEADLINE)).toBeInTheDocument()
    })
})

describe("VisitorHero — headline", () => {
    it("renders the conviction headline", () => {
        renderWithProviders(<VisitorHero />)
        expect(
            screen.getByText(/Run your DAO\. Own your stack\./i),
        ).toBeInTheDocument()
    })

    it("renders the platform breadth subtitle", () => {
        renderWithProviders(<VisitorHero />)
        expect(screen.getByText(/governance.*treasury.*tokens/i)).toBeInTheDocument()
    })
})

describe("VisitorHero — Explore DAOs CTA", () => {
    it("renders 'Explore DAOs' as a link", () => {
        renderWithProviders(<VisitorHero />)
        const link = screen.getByTestId("visitor-hero-explore")
        expect(link.tagName).toBe("A")
    })

    it("Explore DAOs href points to the dao route", () => {
        renderWithProviders(<VisitorHero />)
        const link = screen.getByTestId("visitor-hero-explore")
        expect(link.getAttribute("href")).toBe("/test13/dao")
    })

    it("Explore DAOs requires no wallet — is never gated", () => {
        // Render with completely disconnected state
        vi.mocked(routerMod.useOutletContext).mockReturnValue(
            mockLayoutContext({ adena: { installed: false, connected: false, loading: false } }),
        )
        renderWithProviders(<VisitorHero />)
        expect(screen.getByTestId("visitor-hero-explore")).toBeInTheDocument()
    })
})

describe("VisitorHero — secondary CTA when adena is installed", () => {
    it("renders a 'Connect wallet' button", () => {
        const connectFn = vi.fn().mockResolvedValue(true)
        vi.mocked(routerMod.useOutletContext).mockReturnValue(
            mockLayoutContext({ adena: { installed: true, connect: connectFn } }),
        )
        renderWithProviders(<VisitorHero />)
        const btn = screen.getByTestId("visitor-hero-connect")
        expect(btn.tagName).toBe("BUTTON")
        expect(btn.textContent).toMatch(/connect wallet/i)
    })

    it("clicking Connect wallet calls adena.connect", () => {
        const connectFn = vi.fn().mockResolvedValue(true)
        vi.mocked(routerMod.useOutletContext).mockReturnValue(
            mockLayoutContext({ adena: { installed: true, connect: connectFn } }),
        )
        renderWithProviders(<VisitorHero />)
        fireEvent.click(screen.getByTestId("visitor-hero-connect"))
        expect(connectFn).toHaveBeenCalledTimes(1)
    })

    it("does NOT render the Install Adena link when installed", () => {
        vi.mocked(routerMod.useOutletContext).mockReturnValue(
            mockLayoutContext({ adena: { installed: true } }),
        )
        renderWithProviders(<VisitorHero />)
        expect(screen.queryByTestId("visitor-hero-install")).not.toBeInTheDocument()
    })
})

describe("VisitorHero — secondary CTA when adena is NOT installed", () => {
    it("renders an 'Install Adena' link", () => {
        vi.mocked(routerMod.useOutletContext).mockReturnValue(
            mockLayoutContext({ adena: { installed: false } }),
        )
        renderWithProviders(<VisitorHero />)
        const link = screen.getByTestId("visitor-hero-install")
        expect(link.tagName).toBe("A")
        expect(link.textContent).toMatch(/install adena/i)
    })

    it("Install Adena href points to adena.app", () => {
        vi.mocked(routerMod.useOutletContext).mockReturnValue(
            mockLayoutContext({ adena: { installed: false } }),
        )
        renderWithProviders(<VisitorHero />)
        const link = screen.getByTestId("visitor-hero-install")
        expect(link.getAttribute("href")).toBe("https://adena.app")
    })

    it("does NOT render the Connect wallet button when not installed", () => {
        vi.mocked(routerMod.useOutletContext).mockReturnValue(
            mockLayoutContext({ adena: { installed: false } }),
        )
        renderWithProviders(<VisitorHero />)
        expect(screen.queryByTestId("visitor-hero-connect")).not.toBeInTheDocument()
    })
})

describe("VisitorHero — hint text", () => {
    it("shows 'no wallet needed to look around' hint", () => {
        renderWithProviders(<VisitorHero />)
        expect(screen.getByText(/no wallet needed to look around/i)).toBeInTheDocument()
    })
})

describe("VisitorHero — two distinct, accessible CTAs", () => {
    it("renders Explore DAOs and the wallet CTA as two separate accessible elements", () => {
        // Default context: adena not installed → Install Adena link visible
        renderWithProviders(<VisitorHero />)
        const explore = screen.getByRole("link", { name: /explore daos/i })
        // wallet CTA: "Install Adena" link when adena not installed (default mock)
        const wallet = screen.getByRole("link", { name: /install adena/i })
        expect(explore).toBeInTheDocument()
        expect(wallet).toBeInTheDocument()
        // They must be two separate DOM nodes, not the same run-together element
        expect(explore).not.toBe(wallet)
    })

    it("renders Explore DAOs and Connect wallet as two separate elements when adena installed", () => {
        const connectFn = vi.fn().mockResolvedValue(true)
        vi.mocked(routerMod.useOutletContext).mockReturnValue(
            mockLayoutContext({ adena: { installed: true, connect: connectFn } }),
        )
        renderWithProviders(<VisitorHero />)
        const explore = screen.getByRole("link", { name: /explore daos/i })
        const wallet = screen.getByRole("button", { name: /connect wallet/i })
        expect(explore).toBeInTheDocument()
        expect(wallet).toBeInTheDocument()
        expect(explore).not.toBe(wallet)
    })
})
