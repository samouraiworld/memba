import { test, expect, type Page } from '@playwright/test'

/**
 * Marketplace v2 E2E — Phase 8 of the v2 rebuild (real-browser coverage the
 * jsdom unit tests cannot give: lazy lane resolution, URL-driven filters,
 * keyboard roving, mobile layout).
 *
 * Env contract — runs against the DEDICATED :5174 server (vite --mode e2e →
 * the committed root .env.e2e), which pins VITE_ENABLE_MARKETPLACE_V2=true and
 * the lane flags (NFT/Services live; Tokens/Agents gated). Prod is unaffected:
 * the flag stays off there until the owner's cutover flip.
 *
 * Determinism: the Services lane is seed-fed (foundingSupply.seed.ts) — its
 * content asserts exactly. The NFT lane reads live test13 RPC, so only its
 * SHELL (toolbar, tablist, panel wiring) is asserted, never listing content.
 */

test.use({ baseURL: 'http://localhost:5174' })

/** Same boot dance as marketplace-gating.spec.ts — let / resolve the network
 * segment and fully settle before deep-linking (Firefox aborts a goto raced
 * by the app's own boot redirect). */
async function resolveNetwork(page: Page): Promise<string> {
    await page.goto('/')
    await page.waitForURL(/\/\w+\/$/, { timeout: 5000 })
    await expect(page.getByTestId('home-root')).toBeVisible({ timeout: 10_000 })
    const network = new URL(page.url()).pathname.match(/^\/(\w+)\//)?.[1]
    expect(network, 'app should redirect / to a network-prefixed URL').toBeTruthy()
    return network!
}

async function gotoLane(page: Page, network: string, lane: string) {
    await page.goto(`/${network}/marketplace/${lane}`, { waitUntil: 'domcontentloaded' })
}

test.describe('Marketplace v2 (flag-gated shell)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('NFT lane mounts the v2 pipeline: LaneToolbar owns search, shell search is gone', async ({ page }) => {
        const network = await resolveNetwork(page)
        await gotoLane(page, network, 'nfts')

        // v2 marker: the lane-level toolbar (v1 lanes have none).
        await expect(page.locator('.lane-toolbar')).toBeVisible({ timeout: 10_000 })
        // One search box, owned by the lane — the old shell search must not render
        // beside it (both bind ?q; two boxes was the audit's dup-search bug).
        await expect(page.locator('.um-search input')).toHaveCount(0)
        await expect(page.locator('.lane-toolbar__search')).toHaveCount(1)
    })

    test('Services lane renders the Founding-Supply seed and search narrows it (URL-driven)', async ({ page }) => {
        const network = await resolveNetwork(page)
        await gotoLane(page, network, 'services')

        // Seed-fed → deterministic content.
        const cards = page.locator('.mkt-card')
        await expect(cards.first()).toBeVisible({ timeout: 10_000 })
        const all = await cards.count()
        expect(all).toBeGreaterThan(3)
        await expect(page.getByText('I will build and deploy a custom Gno realm to your testnet')).toBeVisible()

        // Honest search: narrows the grid and lands in ?q= (shareable URL).
        await page.locator('.lane-toolbar__search').fill('build and deploy')
        await expect(page.getByText('I will build and deploy a custom Gno realm to your testnet')).toBeVisible()
        await expect
            .poll(async () => cards.count(), { timeout: 5000 })
            .toBeLessThan(all)
        await expect(page).toHaveURL(/[?&]q=/)
    })

    test('tablist keyboard: arrows rove focus without navigating (WAI-ARIA tabs)', async ({ page }) => {
        const network = await resolveNetwork(page)
        await gotoLane(page, network, 'nfts')

        const nftsTab = page.getByRole('tab', { name: /NFTs/i })
        const servicesTab = page.getByRole('tab', { name: /Services/i })
        await nftsTab.focus()
        await page.keyboard.press('ArrowRight')
        await expect(servicesTab).toBeFocused()
        // Focus roved; selection (and the URL) did not change.
        await expect(nftsTab).toHaveAttribute('aria-selected', 'true')
        await expect(page).toHaveURL(new RegExp(`/${network}/marketplace/nfts`))
        // Enter activates the focused tab (NavLink navigation).
        await page.keyboard.press('Enter')
        await expect(page).toHaveURL(new RegExp(`/${network}/marketplace/services`))
    })

    test('gated lane URL still redirects to a live lane under v2 (tokens → nfts)', async ({ page }) => {
        const network = await resolveNetwork(page)
        await gotoLane(page, network, 'tokens')
        await expect(page).toHaveURL(new RegExp(`/${network}/marketplace/nfts`), { timeout: 10_000 })
        await expect(page.getByRole('tab', { name: /Tokens/i })).toHaveCount(0)
    })

    test('mobile (375px): seed lane renders cards with no horizontal page scroll', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 })
        const network = await resolveNetwork(page)
        await gotoLane(page, network, 'services')

        await expect(page.locator('.mkt-card').first()).toBeVisible({ timeout: 10_000 })
        // Page-level invariant (same rule the treasury spec pins): the BODY never
        // scrolls sideways on a phone; wide content scrolls inside its own container.
        const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(scrollWidth).toBeLessThanOrEqual(380)
    })
})
