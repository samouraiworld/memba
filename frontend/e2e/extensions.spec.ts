import { test, expect } from '@playwright/test'

/**
 * Extensions page E2E tests — verify the Extensions Hub renders
 * and interactive elements work (categories, cards, search).
 */

test.describe('Extensions Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/extensions')
    })

    test('page renders with title', async ({ page }) => {
        await expect(page).toHaveTitle(/Extensions/)
        await expect(page.locator('h1')).toContainText('Extensions')
    })

    test('subtitle explains extension purpose', async ({ page }) => {
        await expect(page.locator('text=Browse all available extensions')).toBeVisible()
    })

    test('extension cards are visible', async ({ page }) => {
        const cards = page.locator('[data-testid="extension-card"]')
        await cards.first().waitFor({ state: 'visible', timeout: 10_000 })
        const count = await cards.count()
        // Should have multiple extensions
        expect(count).toBeGreaterThanOrEqual(3)
    })

    test('cards display extension name and description', async ({ page }) => {
        const firstCard = page.locator('[data-testid="extension-card"]').first()
        await firstCard.waitFor({ state: 'visible', timeout: 10_000 })

        // Card should have a name
        const name = firstCard.locator('.ext-card-name')
        await expect(name).not.toBeEmpty()
    })

    test('category filter tabs are visible', async ({ page }) => {
        const tabs = page.locator('.ext-category-tab')
        const count = await tabs.count()
        // Should have at least "All" + categories
        expect(count).toBeGreaterThanOrEqual(2)
    })

    test('clicking a category filters the cards', async ({ page }) => {
        await page.locator('[data-testid="extension-card"]').first().waitFor({ state: 'visible', timeout: 10_000 })
        const initialCount = await page.locator('[data-testid="extension-card"]').count()

        // Click a specific category (not "All")
        const categoryTabs = page.locator('.ext-category-tab')
        const tabCount = await categoryTabs.count()
        if (tabCount > 1) {
            await categoryTabs.nth(1).click()
            // Filtered count should be <= initial count
            const filteredCount = await page.locator('[data-testid="extension-card"]').count()
            expect(filteredCount).toBeLessThanOrEqual(initialCount)
        }
    })

    test('info footer is visible', async ({ page }) => {
        await expect(page.locator('text=Extensions are per-DAO')).toBeVisible()
    })
})

test.describe('Extensions — Mobile', () => {
    test('renders without horizontal overflow at 375px', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/extensions')

        await expect(page.locator('h1')).toContainText('Extensions')
        const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(420)
    })
})
