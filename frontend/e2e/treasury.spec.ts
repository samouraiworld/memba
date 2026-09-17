import { test, expect } from '@playwright/test'
import { abortOnchainReads } from './helpers/onchain'

/**
 * Treasury route E2E — no DAO kind Memba supports can hold or spend funds, so
 * the treasury routes render the "not available" page instead of a balance view.
 */
test.describe('Treasury routes', () => {
    test.beforeEach(async ({ page }) => {
        await abortOnchainReads(page)
    })

    for (const suffix of ['treasury', 'treasury/propose']) {
        test(`/${suffix} shows the unavailable page`, async ({ page }) => {
            await page.goto(`/dao/gno.land~r~gov~dao/${suffix}`)
            await expect(page.getByRole('heading', { name: /Not available for this DAO or network/ })).toBeVisible()
            await expect(page.getByRole('button', { name: /Back/ })).toBeVisible()
        })
    }

    test('unavailable page at 375px — no page h-scroll', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/dao/gno.land~r~gov~dao/treasury')
        await expect(page.getByRole('heading', { name: /Not available for this DAO or network/ })).toBeVisible()
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })
})
