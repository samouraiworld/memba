/**
 * UnifiedMarketplace.test.tsx
 *
 * W0.1 — the unified marketplace shell must render a lane's tab AND route it ONLY
 * when that lane is live (getLiveLanes()). A gated lane must be unreachable both via
 * its tab (not rendered) and via a direct URL (redirected to a live lane).
 *
 * Tab visibility is asserted by rendering the shell (synchronous — the tabs are plain
 * NavLinks). Route gating is asserted at the pure decision layer (isLaneSlugLive /
 * getDefaultLaneSlug) — the same helpers the component wires its routes + catch-all
 * redirect to — so we prove the security property deterministically without depending
 * on React.lazy/Suspense resolution inside the test (which is flaky in jsdom).
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Drive the lane predicates. Default: only NFT + Services live. ────────────
vi.mock("../lib/config", () => ({
    isMarketplaceV2Enabled: vi.fn(() => false),
    isNftEnabled: vi.fn(() => true),
    isNftMarketV3Valid: vi.fn(() => true),
    isServicesEnabled: vi.fn(() => true),
    isEscrowValid: vi.fn(() => true),
    isTokensEnabled: vi.fn(() => false),
    isTokenOtcValid: vi.fn(() => false),
    isAgentsEnabled: vi.fn(() => false),
    isAgentRegistryValid: vi.fn(() => false),
}))

// The shell reads wallet-connection state (for the connected-only "My Listings"
// tab); stub it disconnected so these lane-visibility tests stay deterministic
// and don't drag the wallet/config import chain into the mock.
vi.mock("../hooks/useAdena", () => ({
    useAdena: () => ({ connected: false, address: undefined, connect: vi.fn() }),
}))

// ── Stub the lazy lane components (no heavy chain deps). ──────────────────────
vi.mock("../components/marketplace/NftLane", () => ({ default: () => <div data-testid="nft-lane" /> }))
vi.mock("../components/marketplace/ServiceLane", () => ({ default: () => <div data-testid="service-lane" /> }))
vi.mock("../components/marketplace/AgentLane", () => ({ default: () => <div data-testid="agent-lane" /> }))
vi.mock("./TokenLane", () => ({ TokenLane: () => <div data-testid="token-lane" /> }))

import UnifiedMarketplace from "./UnifiedMarketplace"
import { isLaneSlugLive, getDefaultLaneSlug } from "../lib/marketplace/lanes"
import * as config from "../lib/config"

function mountAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/*" element={<UnifiedMarketplace />} />
            </Routes>
        </MemoryRouter>,
    )
}

function onlyNftAndServicesLive() {
    vi.mocked(config.isNftEnabled).mockReturnValue(true)
    vi.mocked(config.isNftMarketV3Valid).mockReturnValue(true)
    vi.mocked(config.isServicesEnabled).mockReturnValue(true)
    vi.mocked(config.isEscrowValid).mockReturnValue(true)
    vi.mocked(config.isTokensEnabled).mockReturnValue(false)
    vi.mocked(config.isTokenOtcValid).mockReturnValue(false)
    vi.mocked(config.isAgentsEnabled).mockReturnValue(false)
    vi.mocked(config.isAgentRegistryValid).mockReturnValue(false)
}

describe("UnifiedMarketplace — lanes gate tab visibility (W0.1)", () => {
    beforeEach(onlyNftAndServicesLive)

    it("renders tabs only for live lanes (NFT + Services), not gated ones (Tokens, Agents)", () => {
        mountAt("/nfts")
        expect(screen.getByRole("tab", { name: /NFTs/i })).toBeInTheDocument()
        expect(screen.getByRole("tab", { name: /Services/i })).toBeInTheDocument()
        expect(screen.queryByRole("tab", { name: /Tokens/i })).not.toBeInTheDocument()
        expect(screen.queryByRole("tab", { name: /Agents/i })).not.toBeInTheDocument()
    })

    it("marks the active lane tab aria-selected (tablist semantics)", () => {
        mountAt("/nfts")
        expect(screen.getByRole("tab", { name: /NFTs/i })).toHaveAttribute("aria-selected", "true")
        expect(screen.getByRole("tab", { name: /Services/i })).toHaveAttribute("aria-selected", "false")
    })

    it("shows a gated lane's tab once its flag + realm become live", () => {
        vi.mocked(config.isTokensEnabled).mockReturnValue(true)
        vi.mocked(config.isTokenOtcValid).mockReturnValue(true)
        mountAt("/nfts")
        expect(screen.getByRole("tab", { name: /Tokens/i })).toBeInTheDocument()
    })
})

describe("UnifiedMarketplace — route gating decision (W0.1)", () => {
    beforeEach(onlyNftAndServicesLive)

    it("a gated lane slug is NOT routable (direct /tokens URL cannot mount TokenLane)", () => {
        // The component registers a Route only for live lanes; a non-routable slug
        // falls through to the catch-all redirect. So gating a slug == not-live.
        expect(isLaneSlugLive("tokens")).toBe(false)
        expect(isLaneSlugLive("agents")).toBe(false)
    })

    it("a live lane slug IS routable", () => {
        expect(isLaneSlugLive("nfts")).toBe(true)
        expect(isLaneSlugLive("services")).toBe(true)
    })

    it("the catch-all redirect target is the first live lane", () => {
        expect(getDefaultLaneSlug()).toBe("nfts")
    })

    it("becomes routable only once the lane goes live (flag + realm)", () => {
        expect(isLaneSlugLive("tokens")).toBe(false)
        vi.mocked(config.isTokensEnabled).mockReturnValue(true)
        vi.mocked(config.isTokenOtcValid).mockReturnValue(true)
        expect(isLaneSlugLive("tokens")).toBe(true)
    })

    // COVERAGE NOTE: The real <Routes> wiring (mounting the actual lazy lane at a gated
    // URL and asserting the redirect) is intentionally NOT unit-tested. UnifiedMarketplace
    // renders lanes via React.lazy, and mounting a lazy component + <Suspense> + <Navigate>
    // redirect reliably HANGS under React 19 in jsdom (verified). This mirrors the codebase
    // convention — App.routes.test.tsx tests routing against stub components, never the real
    // lazy page. Here the gate is proven at two layers instead: the tab-visibility tests
    // render the real component and assert gated tabs are absent, and the helper tests pin
    // the routing decision (isLaneSlugLive / getDefaultLaneSlug) the component wires its
    // routes + catch-all redirect to. Real-browser direct-URL gating is a recommended E2E
    // follow-up (Playwright handles lazy correctly where jsdom cannot).
})

describe("UnifiedMarketplace — tablist a11y (Phase 8: roving tabindex + panel wiring)", () => {
    beforeEach(onlyNftAndServicesLive)

    it("selected tab is the only one in the tab order and points at the lane panel", () => {
        mountAt("/nfts")
        const nfts = screen.getByRole("tab", { name: /NFTs/i })
        const services = screen.getByRole("tab", { name: /Services/i })
        expect(nfts).toHaveAttribute("tabindex", "0")
        expect(services).toHaveAttribute("tabindex", "-1")
        expect(nfts).toHaveAttribute("aria-controls", "um-lane-panel")
        const panel = screen.getByRole("tabpanel")
        expect(panel).toHaveAttribute("id", "um-lane-panel")
        expect(panel).toHaveAttribute("aria-labelledby", "um-tab-nfts")
    })

    it("ArrowRight/ArrowLeft rove focus across tabs (wrapping) without navigating", () => {
        mountAt("/nfts")
        const tablist = screen.getByRole("tablist")
        const nfts = screen.getByRole("tab", { name: /NFTs/i })
        const services = screen.getByRole("tab", { name: /Services/i })
        nfts.focus()
        fireEvent.keyDown(tablist, { key: "ArrowRight" })
        expect(services).toHaveFocus()
        fireEvent.keyDown(tablist, { key: "ArrowRight" }) // wraps
        expect(nfts).toHaveFocus()
        fireEvent.keyDown(tablist, { key: "ArrowLeft" }) // wraps back
        expect(services).toHaveFocus()
        // Focus moved, selection didn't — activation stays on Enter/click.
        expect(nfts).toHaveAttribute("aria-selected", "true")
        expect(services).toHaveAttribute("aria-selected", "false")
    })

    it("Home/End jump to the first/last tab", () => {
        mountAt("/services")
        const nfts = screen.getByRole("tab", { name: /NFTs/i })
        const services = screen.getByRole("tab", { name: /Services/i })
        services.focus()
        fireEvent.keyDown(screen.getByRole("tablist"), { key: "Home" })
        expect(nfts).toHaveFocus()
        fireEvent.keyDown(screen.getByRole("tablist"), { key: "End" })
        expect(services).toHaveFocus()
    })
})
