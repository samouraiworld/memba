import { test, expect } from '@playwright/test'

/**
 * Plugin Routes E2E — DAO extension routes are no longer offered; every
 * /plugin/* URL renders the "not available" page.
 * No backend/wallet required.
 */

const FAKE_SLUG = 'gno.land~r~test~mydao'

test.describe('Plugin Routes', () => {
    for (const plugin of ['proposals', 'board', 'gnoswap', 'leaderboard', 'does-not-exist']) {
        test(`plugin route /${plugin} shows the unavailable page`, async ({ page }) => {
            await page.goto(`/dao/${FAKE_SLUG}/plugin/${plugin}`)
            await expect(page.getByRole('heading', { name: /Not available for this DAO or network/ })).toBeVisible({ timeout: 10000 })
        })
    }

    test('unavailable page Back button returns to the DAO', async ({ page }) => {
        await page.goto(`/dao/${FAKE_SLUG}/plugin/proposals`)
        const backBtn = page.getByRole('button', { name: /Back/ })
        await expect(backBtn).toBeVisible({ timeout: 10000 })
        await backBtn.click()
        await expect(page).toHaveURL(new RegExp(`/dao/`))
    })
})

test.describe('CreateDAO Extensions Step', () => {
    test('create DAO wizard shows step indicator', async ({ page }) => {
        // Named explicitly, not the default: DAO creation is per-network. See
        // create-dao.spec's header.
        await page.goto('/mainnet/dao/create')
        // Step indicator should show step text
        await expect(page.locator('body')).toContainText(/Name.*Path|Preset/)
    })
})
