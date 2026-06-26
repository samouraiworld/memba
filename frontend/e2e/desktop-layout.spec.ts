import { test, expect } from '@playwright/test'

test('desktop keeps the sidebar and never shows the mobile tab bar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await expect(page.locator('.k-sidebar')).toBeVisible()
    await expect(page.getByTestId('mobile-tabbar')).toBeHidden()
})
