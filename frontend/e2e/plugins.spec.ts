import { test, expect } from '@playwright/test'

/**
 * Plugin Routes E2E — verifies plugin page routing and PluginLoader behavior.
 * Uses a real DAO slug format (tilde-encoded) — plugins should render either
 * the plugin UI or "not deployed" / "not found" state.
 * No backend/wallet required.
 */

const FAKE_SLUG = 'gno.land~r~test~mydao'

test.describe('Plugin Routes', () => {
    test('plugin route renders PluginLoader for proposals', async ({ page }) => {
        await page.goto(`/dao/${FAKE_SLUG}/plugin/proposals`)
        // Should render Back to DAO button
        const backBtn = page.locator('button', { hasText: '← Back to DAO' })
        await expect(backBtn).toBeVisible({ timeout: 10000 })
        // Should not show 404
        await expect(page.locator('body')).not.toContainText('404')
    })

    test('plugin route renders PluginLoader for board', async ({ page }) => {
        await page.goto(`/dao/${FAKE_SLUG}/plugin/board`)
        const backBtn = page.locator('button', { hasText: '← Back to DAO' })
        await expect(backBtn).toBeVisible({ timeout: 10000 })
        await expect(page.locator('body')).not.toContainText('404')
    })

    test('plugin route renders PluginLoader for gnoswap', async ({ page }) => {
        await page.goto(`/dao/${FAKE_SLUG}/plugin/gnoswap`)
        const backBtn = page.locator('button', { hasText: '← Back to DAO' })
        await expect(backBtn).toBeVisible({ timeout: 10000 })
        await expect(page.locator('body')).not.toContainText('404')
    })

    test('plugin route renders PluginLoader for leaderboard', async ({ page }) => {
        await page.goto(`/dao/${FAKE_SLUG}/plugin/leaderboard`)
        const backBtn = page.locator('button', { hasText: '← Back to DAO' })
        await expect(backBtn).toBeVisible({ timeout: 10000 })
        await expect(page.locator('body')).not.toContainText('404')
    })

    test('unknown plugin shows "not found" state', async ({ page }) => {
        await page.goto(`/dao/${FAKE_SLUG}/plugin/does-not-exist`)
        const backBtn = page.locator('button', { hasText: '← Back to DAO' })
        await expect(backBtn).toBeVisible({ timeout: 10000 })
        // PluginNotFound component should render
        await expect(page.locator('[id^="plugin-not-found"]')).toBeVisible()
    })

    test('plugin Back to DAO button navigates correctly', async ({ page }) => {
        await page.goto(`/dao/${FAKE_SLUG}/plugin/proposals`)
        const backBtn = page.locator('button', { hasText: '← Back to DAO' })
        await expect(backBtn).toBeVisible({ timeout: 10000 })
        await backBtn.click()
        await expect(page).toHaveURL(new RegExp(`/dao/`))
    })
})

test.describe('CreateDAO Extensions Step', () => {
    test('create DAO wizard shows step indicator', async ({ page }) => {
        await page.goto('/dao/create')
        // Step indicator should show step text
        await expect(page.locator('body')).toContainText(/Name.*Path|Preset/)
    })
})
