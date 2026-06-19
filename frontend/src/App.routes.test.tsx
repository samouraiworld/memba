/**
 * App.routes.test.tsx
 *
 * Focused routing test for NFT route swaps introduced in Phase 2.
 * Uses MemoryRouter + stub components — avoids pulling the full app shell.
 *
 * Assertions:
 *  (a) /test13/nft           → MarketplaceHub
 *  (b) /test13/nft/collection/a/b → CollectionPublic
 *  (c) /test13/nft/create/advanced → redirects to /test13/nft/create (CreateCollectionLaunchpad)
 */
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Routes, Route, Navigate, useParams } from "react-router-dom"
import { describe, it, expect } from "vitest"

// ── Stub page components (lightweight — no real page deps) ──────────────────
function StubMarketplaceHub() { return <div data-testid="marketplace-hub">MarketplaceHub</div> }
function StubCollectionPublic() { return <div data-testid="collection-public">CollectionPublic</div> }
function StubLegacyCollectionView() { return <div data-testid="legacy-collection-view">LegacyCollectionView</div> }
function StubCreateCollectionLaunchpad() { return <div data-testid="create-collection-launchpad">CreateCollectionLaunchpad</div> }
function StubCreatorProfile() { return <div data-testid="creator-profile">CreatorProfile</div> }
function StubStudioHome() { return <div data-testid="studio-home">StudioHome</div> }
function StubStudioManage() { return <div data-testid="studio-manage">StudioManage</div> }

// ── Inline redirect (mirrors the real implementation in App.tsx) ────────────
function AdvancedWizardRedirect() {
    const { network } = useParams<{ network: string }>()
    return <Navigate to={`/${network}/nft/create`} replace />
}

// ── Minimal router that mirrors the NFT section of App.tsx ─────────────────
function TestRouter({ initialPath }: { initialPath: string }) {
    return (
        <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
                <Route path="/:network">
                    {/* NFT section — ORDER MATTERS: specific routes before catch-all */}
                    <Route path="nft" element={<StubMarketplaceHub />} />
                    <Route path="nft/create" element={<StubCreateCollectionLaunchpad />} />
                    <Route path="nft/create/advanced" element={<AdvancedWizardRedirect />} />
                    <Route path="nft/collection/:creator/:slug" element={<StubCollectionPublic />} />
                    <Route path="nft/creator/:address" element={<StubCreatorProfile />} />
                    <Route path="nft/creator" element={<StubCreatorProfile />} />
                    <Route path="nft/studio" element={<StubStudioHome />} />
                    <Route path="nft/studio/:creator/:slug" element={<StubStudioManage />} />
                    {/* LAST: catch-all for legacy realm paths */}
                    <Route path="nft/:realmPath" element={<StubLegacyCollectionView />} />
                </Route>
            </Routes>
        </MemoryRouter>
    )
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe("NFT routing — Phase 2 route swaps", () => {
    it("(a) /test13/nft renders MarketplaceHub", () => {
        render(<TestRouter initialPath="/test13/nft" />)
        expect(screen.getByTestId("marketplace-hub")).toBeInTheDocument()
    })

    it("(b) /test13/nft/collection/a/b renders CollectionPublic", () => {
        render(<TestRouter initialPath="/test13/nft/collection/a/b" />)
        expect(screen.getByTestId("collection-public")).toBeInTheDocument()
    })

    it("(c) /test13/nft/create/advanced redirects to /test13/nft/create (network prefix intact)", () => {
        render(<TestRouter initialPath="/test13/nft/create/advanced" />)
        // After redirect, CreateCollectionLaunchpad must render (not legacy, not hub)
        expect(screen.getByTestId("create-collection-launchpad")).toBeInTheDocument()
        // MarketplaceHub and LegacyCollectionView must NOT render
        expect(screen.queryByTestId("marketplace-hub")).not.toBeInTheDocument()
        expect(screen.queryByTestId("legacy-collection-view")).not.toBeInTheDocument()
    })

    it("(d) /test13/nft/some-realm-path still renders LegacyCollectionView (catch-all)", () => {
        render(<TestRouter initialPath="/test13/nft/some-realm-path" />)
        expect(screen.getByTestId("legacy-collection-view")).toBeInTheDocument()
    })
})
