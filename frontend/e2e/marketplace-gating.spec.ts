import { test, expect, type Page } from '@playwright/test'

/**
 * Marketplace lane-gating E2E — the real-browser half of W0.1 (PR #696).
 *
 * UnifiedMarketplace renders each lane via React.lazy, wrapped in <Suspense>, with a
 * catch-all <Route path="*" element={<Navigate to={defaultSlug} replace />} />. Mounting
 * that real lazy tree (lazy + Suspense + <Navigate> redirect) HANGS under React 19 in
 * jsdom, so the unit test (UnifiedMarketplace.test.tsx) can only assert the pure helpers
 * (isLaneSlugLive / getDefaultLaneSlug) and synchronous tab visibility. A real browser
 * resolves lazy fine, so this spec closes the route-wiring coverage gap end-to-end:
 * a GATED lane URL must not render its lane and must redirect to a live lane, and gated
 * lane tabs must be absent from the tab bar.
 *
 * Env (dev server, root .env): VITE_GNO_CHAIN_ID=test13, VITE_ENABLE_NFT=true,
 * VITE_ENABLE_SERVICES=true — but VITE_ENABLE_TOKENS / VITE_ENABLE_AGENTS are UNSET.
 * So the live lanes are NFTs (first → default landing lane) and Services, while Tokens
 * and Agents are gated. This asserts the tab visibility + direct-URL gating that follows.
 *
 * Deterministic UI-structure only — the shell + tab bar render without a wallet. (The
 * lazy NFT lane fetches from live test13 RPC, so its inner content is asserted leniently.)
 */

/**
 * Navigate to `/`, let the app redirect to /:network/, and return the network segment.
 * Waits for the home page to fully settle (home-root rendered) before returning so a
 * follow-up goto() doesn't race the app's still-in-flight boot redirects — which aborts
 * the next navigation in Firefox (NS_BINDING_ABORTED / NS_ERROR_FAILURE).
 */
async function resolveNetwork(page: Page): Promise<string> {
    await page.goto('/')
    await page.waitForURL(/\/\w+\/$/, { timeout: 5000 })
    await expect(page.getByTestId('home-root')).toBeVisible({ timeout: 10_000 })
    const network = new URL(page.url()).pathname.match(/^\/(\w+)\//)?.[1]
    expect(network, 'app should redirect / to a network-prefixed URL').toBeTruthy()
    return network!
}

test.describe('Marketplace lane gating (W0.1 route-wiring)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('direct-navigating to a GATED lane (tokens) redirects to a live lane (nfts)', async ({ page }) => {
        const network = await resolveNetwork(page)

        // Deep-link straight into the gated Tokens lane (VITE_ENABLE_TOKENS unset).
        // waitUntil:'domcontentloaded' — the app immediately client-side redirects, which
        // aborts a full-load goto in Firefox (NS_BINDING_ABORTED); we assert via waitForURL.
        await page.goto(`/${network}/marketplace/tokens`, { waitUntil: 'domcontentloaded' })

        // The internal catch-all <Navigate> must bounce us to the default live lane (nfts),
        // NOT leave us on a Tokens lane. This is the security property: a gated lane is
        // unreachable by direct URL. (A relative <Navigate> here would loop infinitely —
        // /marketplace/tokens/nfts/nfts/… — so the single clean redirect is the assertion.)
        await page.waitForURL(new RegExp(`/${network}/marketplace/nfts$`), { timeout: 10_000 })
        expect(page.url()).toMatch(new RegExp(`/${network}/marketplace/nfts$`))

        // And the Tokens lane must not have rendered: no Tokens tab, and the NFT hero
        // (the default landing lane) is shown rather than the Tokens hero.
        const tabbar = page.locator('.um-tabs[role="tablist"]')
        await expect(tabbar).toBeVisible()
        await expect(tabbar.locator('a[role="tab"]', { hasText: 'Tokens' })).toHaveCount(0)
        await expect(page.locator('.um-hero-title')).toHaveText('Digital Assets')
    })

    test('direct-navigating to a live lane (nfts) renders that lane', async ({ page }) => {
        const network = await resolveNetwork(page)

        await page.goto(`/${network}/marketplace/nfts`, { waitUntil: 'domcontentloaded' })

        // Stays on nfts — a live lane must not redirect away. (Give the SPA a beat to settle;
        // if it were going to bounce, this catches it rather than reading a pre-hydration URL.)
        await page.waitForURL(new RegExp(`/${network}/marketplace/nfts$`), { timeout: 10_000 })

        // The NFT tab is present and the NFT hero copy renders.
        const tabbar = page.locator('.um-tabs[role="tablist"]')
        await expect(tabbar.locator('a[role="tab"]', { hasText: 'NFTs' })).toBeVisible()
        await expect(page.locator('.um-hero-title')).toHaveText('Digital Assets')

        // The lazy NftLane actually mounted (proves lazy + Suspense resolves in a real
        // browser — the exact thing jsdom couldn't do). Content depends on live RPC, so
        // accept any of its states: loading, loaded, or a load error.
        await expect(page.locator('.um-main')).toContainText(
            /Loading collections|Trending Collections|Failed to load collections/,
            { timeout: 15_000 },
        )
    })

    test('gated lane tabs (Tokens, Agents) are absent from the tab bar', async ({ page }) => {
        const network = await resolveNetwork(page)

        await page.goto(`/${network}/marketplace/nfts`, { waitUntil: 'domcontentloaded' })

        const tabbar = page.locator('.um-tabs[role="tablist"]')
        await expect(tabbar).toBeVisible()

        // Live lanes render tabs…
        await expect(tabbar.locator('a[role="tab"]', { hasText: 'NFTs' })).toBeVisible()
        await expect(tabbar.locator('a[role="tab"]', { hasText: 'Services' })).toBeVisible()

        // …gated lanes never render a "coming soon" tab (panel finding C2).
        await expect(tabbar.locator('a[role="tab"]', { hasText: 'Tokens' })).toHaveCount(0)
        await expect(tabbar.locator('a[role="tab"]', { hasText: 'Agents' })).toHaveCount(0)
    })
})
