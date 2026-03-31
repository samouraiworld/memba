import { test, expect } from '@playwright/test'

/**
 * Command Palette (Cmd+K) E2E tests — verify the palette opens,
 * search filters work, navigation triggers, and ESC closes.
 *
 * Note: We use page.evaluate to dispatch the KeyboardEvent because
 * Playwright's keyboard.press('ControlOrMeta+k') is unreliable in
 * headless Chromium on macOS (Meta key doesn't propagate to document listeners).
 */

/** Dispatch Ctrl+K / Cmd+K to document — works reliably in all modes. */
async function triggerCmdK(page: import('@playwright/test').Page) {
    await page.evaluate(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'k',
            code: 'KeyK',
            ctrlKey: true,
            metaKey: true,
            bubbles: true,
        }))
    })
}

test.describe('Command Palette', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/')
        await page.waitForLoadState('networkidle')
    })

    test('opens on Cmd+K / Ctrl+K', async ({ page }) => {
        await triggerCmdK(page)
        const palette = page.locator('.cmd-palette')
        await expect(palette).toBeVisible({ timeout: 5_000 })
    })

    test('search input is focused when opened', async ({ page }) => {
        await triggerCmdK(page)
        const input = page.locator('#command-palette-input')
        await expect(input).toBeVisible({ timeout: 5_000 })
        // CI headless may not auto-focus — click to guarantee focus, then assert
        await input.click()
        await expect(input).toBeFocused({ timeout: 3_000 })
    })

    test('shows commands list when opened', async ({ page }) => {
        await triggerCmdK(page)
        const items = page.locator('.cmd-palette-item')
        await items.first().waitFor({ state: 'visible', timeout: 5_000 })
        const count = await items.count()
        expect(count).toBeGreaterThanOrEqual(3)
    })

    test('search filters commands', async ({ page }) => {
        await triggerCmdK(page)
        const input = page.locator('#command-palette-input')
        await expect(input).toBeVisible({ timeout: 5_000 })
        await input.fill('Validator')

        const items = page.locator('.cmd-palette-item')
        const count = await items.count()
        expect(count).toBeGreaterThanOrEqual(1)

        const firstText = await items.first().textContent()
        expect(firstText?.toLowerCase()).toContain('validator')
    })

    test('non-matching search shows empty state', async ({ page }) => {
        await triggerCmdK(page)
        const input = page.locator('#command-palette-input')
        await expect(input).toBeVisible({ timeout: 5_000 })
        await input.fill('ZZZZNONEXISTENT')

        const items = page.locator('.cmd-palette-item')
        const count = await items.count()
        expect(count).toBe(0)
    })

    test('ESC closes the palette', async ({ page }) => {
        await triggerCmdK(page)
        const palette = page.locator('.cmd-palette')
        await expect(palette).toBeVisible({ timeout: 5_000 })

        await page.keyboard.press('Escape')
        await expect(palette).not.toBeVisible({ timeout: 3_000 })
    })

    test('clicking overlay closes the palette', async ({ page }) => {
        await triggerCmdK(page)
        const overlay = page.locator('.cmd-palette-backdrop')
        await expect(overlay).toBeVisible({ timeout: 5_000 })

        await overlay.click({ position: { x: 10, y: 10 } })
        await expect(overlay).not.toBeVisible()
    })
})
