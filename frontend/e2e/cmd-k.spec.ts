import { test, expect } from '@playwright/test'

/**
 * Command Palette (Cmd+K) E2E tests — verify the palette opens,
 * search filters work, navigation triggers, and ESC closes.
 */

test.describe('Command Palette', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/')
    })

    test('opens on Cmd+K / Ctrl+K', async ({ page }) => {
        // Press Cmd+K (macOS) / Ctrl+K (other)
        await page.keyboard.press('Meta+k')
        const palette = page.locator('[data-testid="command-palette"]')
        await expect(palette).toBeVisible({ timeout: 3_000 })
    })

    test('search input is focused when opened', async ({ page }) => {
        await page.keyboard.press('Meta+k')
        const input = page.locator('[data-testid="command-palette-input"]')
        await expect(input).toBeVisible({ timeout: 3_000 })
        await expect(input).toBeFocused()
    })

    test('shows commands list when opened', async ({ page }) => {
        await page.keyboard.press('Meta+k')
        const items = page.locator('[data-testid="command-item"]')
        await items.first().waitFor({ state: 'visible', timeout: 3_000 })
        const count = await items.count()
        // Should have multiple navigation commands
        expect(count).toBeGreaterThanOrEqual(3)
    })

    test('search filters commands', async ({ page }) => {
        await page.keyboard.press('Meta+k')
        const input = page.locator('[data-testid="command-palette-input"]')
        await input.fill('Validator')

        // Should filter to validator-related commands
        const items = page.locator('[data-testid="command-item"]')
        const count = await items.count()
        expect(count).toBeGreaterThanOrEqual(1)

        // First item should contain "Validator"
        const firstText = await items.first().textContent()
        expect(firstText?.toLowerCase()).toContain('validator')
    })

    test('non-matching search shows empty state', async ({ page }) => {
        await page.keyboard.press('Meta+k')
        const input = page.locator('[data-testid="command-palette-input"]')
        await input.fill('ZZZZNONEXISTENT')

        // Should show no results or empty state
        const items = page.locator('[data-testid="command-item"]')
        const count = await items.count()
        expect(count).toBe(0)
    })

    test('ESC closes the palette', async ({ page }) => {
        await page.keyboard.press('Meta+k')
        const palette = page.locator('[data-testid="command-palette"]')
        await expect(palette).toBeVisible({ timeout: 3_000 })

        await page.keyboard.press('Escape')
        await expect(palette).not.toBeVisible()
    })

    test('clicking overlay closes the palette', async ({ page }) => {
        await page.keyboard.press('Meta+k')
        const overlay = page.locator('[data-testid="command-palette-overlay"]')
        await expect(overlay).toBeVisible({ timeout: 3_000 })

        await overlay.click({ position: { x: 10, y: 10 } })
        await expect(overlay).not.toBeVisible()
    })
})
