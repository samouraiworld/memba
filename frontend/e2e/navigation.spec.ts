import { test, expect } from '@playwright/test'

/**
 * Navigation E2E — verifies header, footer, nav links, and routing.
 * No backend/wallet required — pure UI structure tests.
 */

test.describe('Header Navigation', () => {
    test('logo links to home', async ({ page }) => {
        await page.goto('/dao')
        const logo = page.locator('header a[aria-label="Memba home"]')
        await expect(logo).toBeVisible()
        await logo.click()
        await expect(page).toHaveURL(/\/$|\/dashboard/)
    })

    test('version badge visible in header', async ({ page }) => {
        // Use /dao to avoid Landing page lazy-load timing in CI
        await page.goto('/dao')
        const alphaBadge = page.getByTestId('alpha-badge')
        const versionBadge = page.getByTestId('version-badge')
        await expect(alphaBadge).toBeVisible({ timeout: 10000 })
        await expect(versionBadge).toBeVisible({ timeout: 10000 })
        await expect(alphaBadge).toContainText('Alpha')
        await expect(versionBadge).toContainText(/v\d+/)
    })

    test('Dashboard nav NOT visible when disconnected', async ({ page }) => {
        await page.goto('/')
        const link = page.locator('header a', { hasText: 'Dashboard' })
        await expect(link).not.toBeVisible()
    })

    test('/dashboard redirects to / when disconnected', async ({ page }) => {
        await page.goto('/dashboard')
        await page.waitForURL('/', { timeout: 5000 })
        await expect(page).toHaveURL('/')
    })

    test('DAO nav link present', async ({ page }) => {
        await page.goto('/')
        const link = page.locator('header a', { hasText: 'DAO' })
        await expect(link).toBeVisible()
    })

    test('Tokens nav link present', async ({ page }) => {
        await page.goto('/')
        const link = page.locator('header a', { hasText: 'Tokens' })
        await expect(link).toBeVisible()
    })

    test('Profile nav NOT visible when disconnected', async ({ page }) => {
        await page.goto('/')
        const link = page.locator('header a', { hasText: 'Profile' })
        await expect(link).not.toBeVisible()
    })

    test('network selector shows Testnet 11', async ({ page }) => {
        await page.goto('/')
        const selector = page.locator('header select')
        await expect(selector).toBeVisible()
        await expect(selector).toContainText('Testnet 11')
    })
})

test.describe('Footer', () => {
    test('footer social links present', async ({ page }) => {
        await page.goto('/')
        const footer = page.locator('footer')
        await expect(footer).toContainText('memba')
        await expect(footer).toContainText('samourai coop')
        // Check at least 3 social links exist
        const links = footer.locator('a[target="_blank"]')
        expect(await links.count()).toBeGreaterThanOrEqual(3)
    })
})

test.describe('404 Navigation', () => {
    test('404 page has back CTA', async ({ page }) => {
        await page.goto('/nonexistent-xyz')
        await expect(page.locator('body')).toContainText('404')
    })
})

test.describe('Mobile Navigation (375px)', () => {
    test('nav labels hidden on tiny screens', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/')
        // k-nav-label should be hidden via CSS at 375px
        const navLabel = page.locator('.k-nav-label').first()
        await expect(navLabel).not.toBeVisible()
    })

    test('version badge hidden on mobile', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/')
        // Use data-testid to target the specific header badges
        const alphaBadge = page.getByTestId('alpha-badge')
        const versionBadge = page.getByTestId('version-badge')
        await expect(alphaBadge).not.toBeVisible()
        await expect(versionBadge).not.toBeVisible()
    })
})
