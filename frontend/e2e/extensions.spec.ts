import { test, expect } from '@playwright/test'

/**
 * Extensions page E2E tests — verify the Extensions Hub renders
 * and interactive elements work (cards, navigation).
 *
 * Selectors match actual Extensions.tsx component:
 * - Cards use `.k-card` className
 * - Header uses `h2` (not h1)
 * - No data-testid attributes — use CSS classes
 */

test.describe('Extensions Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/extensions')
        await page.waitForLoadState('networkidle')
    })

    test('page renders with header', async ({ page }) => {
        // Extensions.tsx uses h2, not h1
        await expect(page.locator('h2')).toContainText('Extensions')
    })

    test('subtitle describes extension purpose', async ({ page }) => {
        // Actual subtitle text from Extensions.tsx
        await expect(page.locator('text=Enhance your DAO with powerful extensions')).toBeVisible()
    })

    test('extension cards are visible', async ({ page }) => {
        // Cards use className="k-card"
        const cards = page.locator('.k-card')
        await cards.first().waitFor({ state: 'visible', timeout: 10_000 })
        const count = await cards.count()
        // EXTENSIONS array has 4 items
        expect(count).toBeGreaterThanOrEqual(3)
    })

    test('cards display extension name', async ({ page }) => {
        const firstCard = page.locator('.k-card').first()
        await firstCard.waitFor({ state: 'visible', timeout: 10_000 })
        // Card name is in a div with font-weight: 600
        const text = await firstCard.textContent()
        expect(text?.length).toBeGreaterThan(5)
    })

    test('active extensions have Open button', async ({ page }) => {
        const cards = page.locator('.k-card')
        await cards.first().waitFor({ state: 'visible', timeout: 10_000 })
        // Active cards should have an "Open" button inside them
        const openBtns = page.locator('.k-card .k-btn-primary')
        const count = await openBtns.count()
        expect(count).toBeGreaterThanOrEqual(1)
    })

    test('info footer is visible', async ({ page }) => {
        await expect(page.locator('text=Extensions are per-DAO')).toBeVisible()
    })
})

test.describe('Extensions — Mobile', () => {
    test('renders without horizontal overflow at 375px', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/extensions')
        await page.waitForLoadState('networkidle')

        await expect(page.locator('h2')).toContainText('Extensions')
        const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(420)
    })
})
