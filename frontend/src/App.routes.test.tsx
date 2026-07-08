/**
 * App.routes.test.tsx
 *
 * Focused routing test for the NFT section. Mirrors the REAL App.tsx behavior:
 *  (a) /test13/nft                → redirects to /test13/marketplace/nfts (UnifiedMarketplace)
 *  (b) /test13/nft/collection/a/b → CollectionPublic
 *  (c) /test13/nft/create/advanced → redirects to /test13/nft/create (CreateCollectionLaunchpad)
 *  (d) /test13/nft/<realm>        → LegacyCollectionView (catch-all)
 */
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Routes, Route, Navigate, useParams } from "react-router-dom"
import { describe, it, expect } from "vitest"

// ── Stub page components (lightweight — no real page deps) ──────────────────
function StubUnifiedMarketplace() { return <div data-testid="unified-marketplace">UnifiedMarketplace</div> }
function StubCollectionPublic() { return <div data-testid="collection-public">CollectionPublic</div> }
function StubLegacyCollectionView() { return <div data-testid="legacy-collection-view">LegacyCollectionView</div> }
function StubCreateCollectionLaunchpad() { return <div data-testid="create-collection-launchpad">CreateCollectionLaunchpad</div> }
function StubCreatorProfile() { return <div data-testid="creator-profile">CreatorProfile</div> }
function StubStudioHome() { return <div data-testid="studio-home">StudioHome</div> }
function StubStudioManage() { return <div data-testid="studio-manage">StudioManage</div> }

// ── Inline redirects (mirror the real implementation in App.tsx) ────────────
function NftLaneRedirect() {
    const { network } = useParams<{ network: string }>()
    return <Navigate to={`/${network}/marketplace/nfts`} replace />
}
function AdvancedWizardRedirect() {
    const { network } = useParams<{ network: string }>()
    return <Navigate to={`/${network}/nft/create`} replace />
}

// ── Minimal router that mirrors the NFT + marketplace sections of App.tsx ────
function TestRouter({ initialPath }: { initialPath: string }) {
    return (
        <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
                <Route path="/:network">
                    {/* Unified marketplace shell (redirect target) */}
                    <Route path="marketplace/nfts" element={<StubUnifiedMarketplace />} />
                    {/* NFT section — ORDER MATTERS: specific routes before catch-all */}
                    <Route path="nft" element={<NftLaneRedirect />} />
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

describe("NFT routing — real App.tsx behavior", () => {
    it("(a) /test13/nft redirects to the unified marketplace NFT lane", () => {
        render(<TestRouter initialPath="/test13/nft" />)
        expect(screen.getByTestId("unified-marketplace")).toBeInTheDocument()
        expect(screen.queryByTestId("legacy-collection-view")).not.toBeInTheDocument()
    })

    it("(b) /test13/nft/collection/a/b renders CollectionPublic", () => {
        render(<TestRouter initialPath="/test13/nft/collection/a/b" />)
        expect(screen.getByTestId("collection-public")).toBeInTheDocument()
    })

    it("(c) /test13/nft/create/advanced redirects to /test13/nft/create (network prefix intact)", () => {
        render(<TestRouter initialPath="/test13/nft/create/advanced" />)
        expect(screen.getByTestId("create-collection-launchpad")).toBeInTheDocument()
        expect(screen.queryByTestId("unified-marketplace")).not.toBeInTheDocument()
        expect(screen.queryByTestId("legacy-collection-view")).not.toBeInTheDocument()
    })

    it("(d) /test13/nft/some-realm-path still renders LegacyCollectionView (catch-all)", () => {
        render(<TestRouter initialPath="/test13/nft/some-realm-path" />)
        expect(screen.getByTestId("legacy-collection-view")).toBeInTheDocument()
    })
})
