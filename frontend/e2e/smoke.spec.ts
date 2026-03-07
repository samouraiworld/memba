import { test, expect } from '@playwright/test'

/**
 * Smoke tests — verify all core routes render without crash.
 * No backend required — these only check that pages load and show content.
 */

test.describe('Smoke Tests', () => {
    test('homepage loads', async ({ page }) => {
        await page.goto('/')
        await expect(page).toHaveTitle(/Memba/)
    })

    test('DAO hub loads', async ({ page }) => {
        await page.goto('/dao')
        await expect(page.locator('body')).toContainText(/DAO|Governance|Connect/)
    })

    test('tokens page loads', async ({ page }) => {
        await page.goto('/tokens')
        await expect(page.locator('body')).toContainText(/Token|Launchpad|Create/)
    })

    test('create token page loads', async ({ page }) => {
        await page.goto('/create-token')
        await expect(page.locator('body')).toContainText(/Create|Token|Name/)
    })

    test('404 page handles unknown routes', async ({ page }) => {
        await page.goto('/nonexistent-route-12345')
        // Should show the 404 page with back-to-dashboard CTA
        await expect(page.locator('body')).toContainText('404')
        await expect(page.locator('body')).toContainText('Back to Dashboard')
    })
})

/**
 * v1.4.0 UX Optimization Tests
 * Verify new UI elements render correctly without authentication.
 */

test.describe('v1.4.0 — Landing Page', () => {
    test('feature showcase cards visible (logged-out)', async ({ page }) => {
        await page.goto('/')
        // Should show feature cards for Multisig, DAO, Token
        await expect(page.locator('body')).toContainText('Multisig Wallets')
        await expect(page.locator('body')).toContainText('DAO Governance')
        await expect(page.locator('body')).toContainText('Token Factory')
    })

    test('"Built on gno.land" tag visible (single, not 3x)', async ({ page }) => {
        await page.goto('/')
        await expect(page.locator('body')).toContainText('Built on gno.land')
        // Should appear exactly once (not 3 times)
        const count = await page.locator('text=Built on gno.land').count()
        expect(count).toBe(1)
    })

    test('stat cards NOT visible when logged out', async ({ page }) => {
        await page.goto('/')
        // Old stat cards (Multisigs, Pending TX, Balance) should not show
        const statCardCount = await page.locator('.k-card .k-label').filter({ hasText: /^Multisigs$/ }).count()
        expect(statCardCount).toBe(0)
    })
})

test.describe('v1.4.0 — DAO Page', () => {
    test('DAO grid renders', async ({ page }) => {
        await page.goto('/dao')
        // GovDAO featured card should appear
        await expect(page.locator('body')).toContainText('GovDAO')
    })

    test('connect form collapsed by default', async ({ page }) => {
        await page.goto('/dao')
        // The connect input should NOT be visible initially
        const input = page.locator('#dao-connect-input')
        await expect(input).not.toBeVisible()
    })

    test('connect toggle reveals form', async ({ page }) => {
        await page.goto('/dao')
        // Click the "Connect to DAO" toggle button
        await page.locator('button', { hasText: 'Connect to DAO' }).click()
        // Now the input should be visible
        const input = page.locator('#dao-connect-input')
        await expect(input).toBeVisible()
    })
})

test.describe('v1.4.0 — CreateToken Placeholders', () => {
    test('neutral placeholders used', async ({ page }) => {
        await page.goto('/create-token')
        // Check that new placeholders are present
        const nameInput = page.locator('input[placeholder*="Your Token Name"]')
        await expect(nameInput).toBeVisible()
        const symbolInput = page.locator('input[placeholder*="$YTK"]')
        await expect(symbolInput).toBeVisible()
    })
})

test.describe('v1.4.0 — Mobile Responsive', () => {
    test('landing page at 375px — no horizontal scroll', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/')
        await expect(page).toHaveTitle(/Memba/)
        // Page width should not exceed viewport
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(375 + 5) // 5px tolerance
    })
})

test.describe('v1.4.0 — ProposeDAO', () => {
    test('proposal type selector visible with Text active', async ({ page }) => {
        // Navigate to a DAO proposal page (GovDAO)
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        // The "Text / Sentiment" type button should be visible and active
        await expect(page.locator('button', { hasText: 'Text / Sentiment' })).toBeVisible()
    })

    test('add member proposal type is enabled', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        const addMemberBtn = page.locator('button', { hasText: 'Add Member' })
        await expect(addMemberBtn).toBeVisible()
        await expect(addMemberBtn).not.toBeDisabled()
    })

    test('treasury spend and code upgrade types are disabled with tooltip', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        const spendBtn = page.locator('button', { hasText: 'Treasury Spend' })
        await expect(spendBtn).toBeDisabled()
        const upgradeBtn = page.locator('button', { hasText: 'Code Upgrade' })
        await expect(upgradeBtn).toBeDisabled()
    })
})

test.describe('v1.4.0 — Dashboard structure (logged-out)', () => {
    test('hero text includes Memba メンバー', async ({ page }) => {
        await page.goto('/')
        await expect(page.locator('body')).toContainText('Welcome to Memba')
        await expect(page.locator('body')).toContainText('メンバー')
    })

    test('CTA links to Adena wallet', async ({ page }) => {
        await page.goto('/')
        // In Playwright (no Adena extension), the CTA shows "Install Adena wallet..."
        await expect(page.locator('body')).toContainText('Adena wallet')
    })

    test('Dashboard nav hidden when logged out', async ({ page }) => {
        await page.goto('/')
        const dashboardLink = page.locator('[data-testid="sidebar"] .k-sidebar-link', { hasText: 'Dashboard' })
        await expect(dashboardLink).not.toBeVisible()
    })

    test('Dashboard page content NOT shown when logged out', async ({ page }) => {
        await page.goto('/')
        // Dashboard main-content heading should not appear for logged-out users
        const dashboardHeading = page.locator('main h2', { hasText: 'Dashboard' })
        await expect(dashboardHeading).not.toBeVisible()
    })
})

