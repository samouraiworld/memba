import { test, expect } from '@playwright/test'

test('mobile shows the bottom tab bar and hides the desktop sidebar', async ({ page }) => {
    await page.goto('/')
    // The app redirects '/' → '/:network/'; wait for the DOM to settle before
    // asserting on the shell so a cold CI runner doesn't race the redirect.
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
    await expect(page.locator('.k-sidebar')).toBeHidden()
})
