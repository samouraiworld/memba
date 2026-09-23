import { test, expect } from '@playwright/test'
import { stubNetwork } from '../helpers/stubNetwork'

test('mobile theme remains in More while network and wallet fit the narrow header', async ({ page }) => {
    await stubNetwork(page)
    await page.setViewportSize({ width: 320, height: 844 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/mainnet/validators')
    await expect(page.locator('.k-topbar')).toBeVisible()
    await expect(page.locator('.k-topbar .k-theme-toggle')).toBeHidden()
    const fits = await page.locator('.k-topbar').evaluate(el => {
        const edge = el.getBoundingClientRect().right
        return [...el.querySelectorAll('select, a, button')].filter(child => child.getClientRects().length > 0)
            .every(child => child.getBoundingClientRect().right <= edge + 1)
    })
    expect(fits).toBe(true)
    await page.getByRole('button', { name: 'More', exact: true }).click()
    const theme = page.getByRole('combobox', { name: 'Theme', exact: true })
    await expect(theme).toBeVisible()
    await theme.selectOption('dark')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(theme).toBeHidden()
})
