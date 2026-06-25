import { test, expect } from '@playwright/test'

test('mobile shows the bottom tab bar and hides the desktop sidebar', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
    await expect(page.locator('.k-sidebar')).toBeHidden()
})
