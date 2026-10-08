import { expect, test } from '@playwright/test'
import { devReportFixture } from './helpers/devReportFixture'

test('catalogue groups public repos, searches and opens a custom overview', async ({ page }) => {
    const scopes = await devReportFixture(page)
    await page.goto('/mainnet/gnolove/repositories')
    await expect(page.getByRole('heading', { name: 'Repositories', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'gnolang repositories' })).toBeVisible()
    await expect(page.getByText('67', { exact: true })).toBeVisible()
    await page.getByRole('searchbox').fill('memba')
    await expect(page.getByRole('link', { name: 'gnolang/gno', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'samouraiworld/memba', exact: true }).click()
    await expect.poll(() => scopes.at(-1)).toBe('samouraiworld/memba')
    await expect(page).toHaveURL(/repos=samouraiworld%2Fmemba/)
})

test('core and all scopes are explicit and the back button restores the scope', async ({ page }) => {
    const scopes = await devReportFixture(page)
    await page.goto('/mainnet/gnolove')
    await expect.poll(() => scopes.at(-1)).toBe('gnolang/gno')
    await page.locator('.gl-filter-btn[aria-expanded]').click()
    await page.getByRole('button', { name: 'All repositories', exact: true }).click()
    await expect.poll(() => scopes.at(-1)).toBe('gnolang/gno,samouraiworld/memba')
    await expect(page).toHaveURL(/scope=all/)
    await page.goBack()
    await expect(page.locator('.gl-filter-btn[aria-expanded]')).toBeVisible()
})

test('all scope cannot silently request core while the catalogue is down', async ({ page }) => {
    const scopes = await devReportFixture(page, true)
    await page.goto('/mainnet/gnolove?scope=all')
    await expect(page.locator('.gl-error-banner')).toBeVisible()
    expect(scopes).toEqual([])
})
