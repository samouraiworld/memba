import { test, expect } from '@playwright/test'

test('mobile shows the bottom tab bar and omits the desktop sidebar entirely', async ({ page }) => {
    await page.goto('/')
    // The app redirects '/' → '/:network/'; wait for the DOM to settle before
    // asserting on the shell so a cold CI runner doesn't race the redirect.
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
    // 2.1: MobileShell drops the Sidebar from the DOM (JS select via useIsMobile),
    // not merely CSS-hides it — so the element is absent, not just invisible.
    await expect(page.locator('.k-sidebar')).toHaveCount(0)
})

test('the bottom tab bar renders the visitor primary tabs from the nav manifest', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    const tabbar = page.getByTestId('mobile-tabbar')
    await expect(tabbar).toBeVisible()
    // Visitor route-mapped set: Home · DAOs · Tokens · Directory · More
    for (const label of ['Home', 'DAOs', 'Tokens', 'Directory', 'More']) {
        await expect(tabbar.getByText(label, { exact: true })).toBeVisible()
    }
})
