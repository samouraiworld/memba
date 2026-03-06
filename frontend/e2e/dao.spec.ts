import { test, expect } from '@playwright/test'

/**
 * DAO E2E — verifies DAO Hub, GovDAO page, Create DAO, and proposal pages.
 * No wallet required — tests page structure and ABCI data rendering.
 */

test.describe('DAO Hub', () => {
    test('DAO hub shows GovDAO featured card', async ({ page }) => {
        await page.goto('/dao')
        await expect(page.locator('body')).toContainText('GovDAO')
    })

    test('Create DAO CTA visible', async ({ page }) => {
        await page.goto('/dao')
        await expect(page.locator('body')).toContainText(/Create|New DAO/)
    })

    test('connect form collapsed by default', async ({ page }) => {
        await page.goto('/dao')
        const input = page.locator('#dao-connect-input')
        await expect(input).not.toBeVisible()
    })
})

test.describe('GovDAO Page', () => {
    test('GovDAO page loads with stats', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        // Wait for config to load (shows DAO name)
        await expect(page.locator('body')).toContainText('GovDAO')
        // Stats grid should show "Members" card
        await expect(page.locator('body')).toContainText('Members')
    })

    test('back button navigates to DAO list', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        const backBtn = page.locator('#dao-back-btn')
        await expect(backBtn).toBeVisible()
        await expect(backBtn).toContainText('DAOs')
    })

    test('power distribution section visible', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        // GovDAO has tier distribution
        await expect(page.locator('body')).toContainText(/Power Distribution|T1|T2/)
    })

    test('treasury section accessible', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        await expect(page.locator('body')).toContainText('Treasury')
    })

    test('members section shows View All link', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        await expect(page.locator('body')).toContainText('View All')
    })
})

test.describe('DAO Members Page', () => {
    test('members page loads', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/members')
        // Members heading appears after ABCI data loads — allow extra time for CI
        await expect(page.locator('body')).toContainText(/Member|GovDAO|T1|Back/, { timeout: 15000 })
    })
})

test.describe('Create DAO Wizard', () => {
    test('create DAO page loads with form', async ({ page }) => {
        await page.goto('/create-dao')
        await expect(page.locator('body')).toContainText(/Create|DAO|Name/)
    })
})

test.describe('Proposal Types (ProposeDAO)', () => {
    test('text proposal type is active', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        const textBtn = page.locator('button', { hasText: '📝 Text / Sentiment' })
        await expect(textBtn).toBeVisible()
        await expect(textBtn).not.toBeDisabled()
    })

    test('add member type is enabled', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        const btn = page.locator('button', { hasText: '👥 Add Member' })
        await expect(btn).not.toBeDisabled()
    })

    test('treasury spend type is disabled', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        const btn = page.locator('button', { hasText: '💰 Treasury Spend' })
        await expect(btn).toBeDisabled()
    })

    test('code upgrade type is disabled', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        const btn = page.locator('button', { hasText: '⚙️ Code Upgrade' })
        await expect(btn).toBeDisabled()
    })
})

test.describe('DAO — Mobile (375px)', () => {
    test('DAO hub at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/dao')
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })

    test('GovDAO page at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/dao/gno.land~r~gov~dao')
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })
})
