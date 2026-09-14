import { test, expect } from '@playwright/test'
import { stubNetwork } from './helpers/stubNetwork'

test('System follows device changes; an explicit choice survives reload', async ({ page }) => {
    await stubNetwork(page)
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/pearl/settings')
    const theme = page.getByRole('combobox', { name: 'Theme', exact: true }).last()
    await expect(theme).toHaveValue('system')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await theme.selectOption('light')
    await page.reload()
    await expect(theme).toHaveValue('light')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await theme.selectOption('system')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await theme.selectOption('dark')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(theme.locator('option:checked')).toHaveText('Black')
})
