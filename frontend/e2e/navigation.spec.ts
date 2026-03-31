import { test, expect } from '@playwright/test'

/**
 * Navigation E2E — verifies sidebar, topbar, mobile tabbar, footer, and routing.
 * No backend/wallet required — pure UI structure tests.
 *
 * v2.0-ζ: Migrated from header nav → sidebar + topbar + mobile tabbar.
 */

test.describe('Sidebar Navigation (Desktop ≥1025px)', () => {
    test.beforeEach(async ({ page }) => {
        // Ensure desktop viewport for sidebar tests
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('sidebar is visible', async ({ page }) => {
        await page.goto('/')
        const sidebar = page.getByTestId('sidebar')
        await expect(sidebar).toBeVisible()
    })

    test('logo links to home', async ({ page }) => {
        await page.goto('/dao')
        const logo = page.locator('[data-testid="sidebar"] a[aria-label="Memba home"]')
        await expect(logo).toBeVisible()
        await logo.click()
        await expect(page).toHaveURL(/\/$|\/dashboard/)
    })

    test('Home nav link active on /', async ({ page }) => {
        await page.goto('/')
        const homeLink = page.locator('[data-testid="sidebar"] .k-sidebar-link', { hasText: 'Home' })
        await expect(homeLink).toBeVisible()
        await expect(homeLink).toHaveClass(/active/)
    })

    test('DAOs nav link present', async ({ page }) => {
        await page.goto('/')
        const link = page.locator('[data-testid="sidebar"] .k-sidebar-link', { hasText: 'DAOs' })
        await expect(link).toBeVisible()
    })

    test('Tokens nav link present', async ({ page }) => {
        await page.goto('/')
        const link = page.locator('[data-testid="sidebar"] .k-sidebar-link', { hasText: 'Tokens' })
        await expect(link).toBeVisible()
    })

    test('Directory nav link present', async ({ page }) => {
        await page.goto('/')
        const link = page.locator('[data-testid="sidebar"] .k-sidebar-link', { hasText: 'Directory' })
        await expect(link).toBeVisible()
    })

    test('Dashboard nav NOT visible when disconnected', async ({ page }) => {
        await page.goto('/')
        const link = page.locator('[data-testid="sidebar"] .k-sidebar-link', { hasText: 'Dashboard' })
        await expect(link).not.toBeVisible()
    })

    test('Profile nav NOT visible when disconnected', async ({ page }) => {
        await page.goto('/')
        const link = page.locator('[data-testid="sidebar"] .k-sidebar-link', { hasText: 'Profile' })
        await expect(link).not.toBeVisible()
    })

    test('Extensions link visible', async ({ page }) => {
        await page.goto('/')
        const extensionsLink = page.locator('[data-testid="sidebar"] .k-sidebar-link', { hasText: 'Extensions' })
        await expect(extensionsLink).toBeVisible()
    })

    test('Feedback link always visible', async ({ page }) => {
        await page.goto('/')
        const feedbackLink = page.locator('[data-testid="sidebar"] .k-sidebar-link', { hasText: 'Feedback' })
        await expect(feedbackLink).toBeVisible()
    })

    test('/dashboard redirects to landing when disconnected', async ({ page }) => {
        await page.goto('/dashboard')
        // Legacy redirect: /dashboard → /:network/dashboard → /:network/ (landing)
        await page.waitForURL(/\/\w+\/$/, { timeout: 5000 })
    })
})

test.describe('TopBar (Desktop)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('version badges visible in topbar', async ({ page }) => {
        await page.goto('/dao')
        const alphaBadge = page.getByTestId('alpha-badge')
        const versionBadge = page.getByTestId('version-badge')
        await expect(alphaBadge).toBeVisible({ timeout: 10000 })
        await expect(versionBadge).toBeVisible({ timeout: 10000 })
        await expect(alphaBadge).toContainText('Alpha')
        await expect(versionBadge).toContainText(/v\d+/)
    })

    test('network selector shows available networks', async ({ page }) => {
        await page.goto('/')
        const selector = page.locator('[data-testid="topbar"] select')
        await expect(selector).toBeVisible()
        await expect(selector).toContainText(/Testnet|Betanet/)
    })

    test('connect wallet button visible when disconnected', async ({ page }) => {
        await page.goto('/')
        // Should show Install Adena or Connect Wallet
        const walletArea = page.locator('[data-testid="topbar"]')
        await expect(walletArea).toContainText(/Adena|Connect Wallet/)
    })
})

test.describe('Mobile Tab Bar (≤768px)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
    })

    test('sidebar hidden on mobile', async ({ page }) => {
        await page.goto('/')
        const sidebar = page.getByTestId('sidebar')
        await expect(sidebar).not.toBeVisible()
    })

    test('mobile tab bar visible on mobile', async ({ page }) => {
        await page.goto('/')
        const tabbar = page.getByTestId('mobile-tabbar')
        await expect(tabbar).toBeVisible()
    })

    test('tab bar has 5 tabs (Home, DAOs, Tokens, Directory, More)', async ({ page }) => {
        await page.goto('/')
        const tabbar = page.getByTestId('mobile-tabbar')
        await expect(tabbar).toContainText('Home')
        await expect(tabbar).toContainText('DAOs')
        await expect(tabbar).toContainText('Tokens')
        await expect(tabbar).toContainText('Directory')
        await expect(tabbar).toContainText('More')
    })

    test('"More" opens bottom sheet', async ({ page }) => {
        await page.goto('/')
        const moreBtn = page.locator('[data-testid="mobile-tabbar"] button', { hasText: 'More' })
        await moreBtn.click()
        // The bottom sheet dialog should be open
        const sheet = page.locator('[role="dialog"]')
        await expect(sheet).toHaveClass(/open/)
    })

    test('version badges NOT visible on mobile', async ({ page }) => {
        await page.goto('/')
        const alphaBadge = page.getByTestId('alpha-badge')
        await expect(alphaBadge).not.toBeVisible()
    })
})

test.describe('Footer', () => {
    test('footer has branding and links', async ({ page }) => {
        await page.goto('/')
        const footer = page.locator('footer')
        await expect(footer).toContainText('memba')
        await expect(footer).toContainText('samourai coop')
        // Check GitHub link and support email exist
        const links = footer.locator('a')
        expect(await links.count()).toBeGreaterThanOrEqual(2)
    })
})

test.describe('404 Navigation', () => {
    test('404 page has back CTA', async ({ page }) => {
        await page.goto('/nonexistent-xyz')
        await expect(page.locator('body')).toContainText('404')
    })
})

// ── Sprint 3: Network-scoped routing (PR #194) ─────────────

test.describe('Network-Scoped Routing (/:network prefix)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('/ redirects to /:network/', async ({ page }) => {
        await page.goto('/')
        // Should redirect to a network-prefixed URL (e.g., /test12/)
        await page.waitForURL(/\/\w+\//, { timeout: 5000 })
        const url = page.url()
        expect(url).toMatch(/\/\w+\/$/)
    })

    test('/dao redirects to /:network/dao', async ({ page }) => {
        await page.goto('/dao')
        await page.waitForURL(/\/\w+\/dao/, { timeout: 5000 })
        const url = page.url()
        expect(url).toMatch(/\/\w+\/dao/)
    })

    test('/tokens redirects to /:network/tokens', async ({ page }) => {
        await page.goto('/tokens')
        await page.waitForURL(/\/\w+\/tokens/, { timeout: 5000 })
        const url = page.url()
        expect(url).toMatch(/\/\w+\/tokens/)
    })

    test('/directory redirects to /:network/directory', async ({ page }) => {
        await page.goto('/directory')
        await page.waitForURL(/\/\w+\/directory/, { timeout: 5000 })
        const url = page.url()
        expect(url).toMatch(/\/\w+\/directory/)
    })

    test('network prefix is preserved during navigation', async ({ page }) => {
        await page.goto('/')
        await page.waitForURL(/\/\w+\//, { timeout: 5000 })
        // Extract network from URL
        const url = new URL(page.url())
        const networkMatch = url.pathname.match(/^\/(\w+)\//)
        expect(networkMatch).toBeTruthy()
        const network = networkMatch![1]

        // Navigate via sidebar
        const daosLink = page.locator('[data-testid="sidebar"] .k-sidebar-link', { hasText: 'DAOs' })
        await daosLink.click()
        await page.waitForURL(`**/${network}/dao**`, { timeout: 5000 })
    })
})

// ── Sprint 3: DAO URL separator (PR #198 — / replaces ~) ───

test.describe('DAO URL Separator (/ not ~)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('DAO URLs use / separator in directory links', async ({ page }) => {
        await page.goto('/dao')
        await page.waitForLoadState('networkidle')
        // Check that no DAO links use the old ~ separator
        const links = await page.locator('a[href*="~"]').count()
        expect(links).toBe(0)
    })
})
