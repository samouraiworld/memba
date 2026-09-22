import { test, expect, type Page } from '@playwright/test'

/**
 * With the on-chain App Store disabled, ecosystem discovery stays public while
 * registry details, publishing and curation remain gated. The pinned .env.e2e
 * server makes this boundary independent of developer or deployment flags.
 */

// An isolated pinned-flags server can be selected when other sessions own :5174.
test.use({ baseURL: process.env.MEMBA_GATING_BASE_URL || 'http://localhost:5174' })

async function resolveNetwork(page: Page): Promise<string> {
    await page.goto('/')
    await page.waitForURL(/\/\w+\/$/, { timeout: 5000 })
    await expect(page.getByTestId('home-root')).toBeVisible({ timeout: 10_000 })
    const network = new URL(page.url()).pathname.match(/^\/(\w+)\//)?.[1]
    expect(network, 'app should redirect / to a network-prefixed URL').toBeTruthy()
    return network!
}

test.describe('App Store gating (VITE_ENABLE_APPSTORE=false)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('the public ecosystem directory stays available while the registry is gated', async ({ page }) => {
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/apps`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('heading', { name: 'App Store', exact: true })).toBeVisible()
        for (const name of ['Adena', 'GnoSwap', 'Boards', 'Akkadia', 'GnoScan', 'Gno Playground', 'mygnoscan']) {
            await expect(page.getByRole('link', { name: `Visit ${name} (opens in a new tab)` })).toBeVisible()
        }
        await expect(page.getByTestId('appstore-root')).toHaveCount(0)
    })

    test('registry details, publishing and curation stay gated', async ({ page }) => {
        const network = await resolveNetwork(page)
        for (const path of ['r/samcrew/block_party', 'submit', 'review', 'my-submissions']) {
            await page.goto(`/${network}/apps/${path}`, { waitUntil: 'domcontentloaded' })
            await expect(page.getByTestId('coming-soon-gate')).toBeVisible({ timeout: 10_000 })
            await expect(page.getByTestId('appstore-root')).toHaveCount(0)
            await expect(page.locator('.soon-preview a, .soon-preview button, .soon-preview input')).toHaveCount(0)
        }
    })

    test('the public App Store nav entry is available without a soon badge', async ({ page }) => {
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/`, { waitUntil: 'domcontentloaded' })
        const link = page.locator(`a[href$="/apps"]`).first()
        await expect(link).toBeVisible({ timeout: 10_000 })
        await expect(link).not.toContainText('soon')
    })
})
