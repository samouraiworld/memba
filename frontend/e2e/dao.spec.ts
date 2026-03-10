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

    test('v2.12 — DAO Health Score badge visible', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        // Health Score stat card appears after proposals load (composite A/B/C/D grade)
        const healthCard = page.locator('.k-stat-card__label', { hasText: 'Health' })
        await expect(healthCard).toBeVisible({ timeout: 15000 })
    })

    test('v2.12 — more than 5 proposals render (pagination proof)', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        // Wait for proposals to actually load (stat starts at 0, updates when ABCI completes)
        // Use a polling assertion: wait until the Proposals stat card shows a value > 0
        const proposalsStat = page.locator('.k-stat-card', { hasText: 'Proposals' })
        await expect(proposalsStat).toBeVisible({ timeout: 15000 })
        // Poll until value is non-zero (proposals have loaded)
        await expect(async () => {
            const countText = await proposalsStat.locator('.k-stat-card__value').textContent()
            const count = parseInt(countText || '0', 10)
            expect(count).toBeGreaterThan(5)
        }).toPass({ timeout: 20000 })
    })

    test('v2.12 — channel sidebar visible in 2-column layout', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        // Discord-style channels sidebar lives in the overview card
        const sidebar = page.locator('.dao-channels-sidebar')
        await expect(sidebar).toBeVisible({ timeout: 15000 })
        await expect(sidebar).toContainText('general')
        await expect(sidebar).toContainText('Public Room')
    })

    test('v2.13 — GovDAO shows "Awaiting Execution" for ACCEPTED proposals', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        // Wait for proposals to load (stat card shows non-zero count)
        const proposalsStat = page.locator('.k-stat-card', { hasText: 'Proposals' })
        await expect(proposalsStat).toBeVisible({ timeout: 15000 })
        await expect(async () => {
            const countText = await proposalsStat.locator('.k-stat-card__value').textContent()
            const count = parseInt(countText || '0', 10)
            expect(count).toBeGreaterThan(0)
        }).toPass({ timeout: 20000 })
        // GovDAO ACCEPTED proposals should show in "Awaiting Execution" section
        await expect(page.locator('text=Awaiting Execution')).toBeVisible()
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
        const textBtn = page.locator('button', { hasText: 'Text / Sentiment' })
        await expect(textBtn).toBeVisible()
        await expect(textBtn).not.toBeDisabled()
    })

    test('add member type is enabled', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        const btn = page.locator('button', { hasText: 'Add Member' })
        await expect(btn).not.toBeDisabled()
    })

    test('treasury spend type is disabled', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        const btn = page.locator('button', { hasText: 'Treasury Spend' })
        await expect(btn).toBeDisabled()
    })

    test('code upgrade type is disabled', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        const btn = page.locator('button', { hasText: 'Code Upgrade' })
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
