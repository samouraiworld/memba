import { expect, test } from '@playwright/test'
import { OS_FEED_ON } from '../../playwright.os.config'

for (const width of [1280, 375]) test(`an OS join link preserves an existing Feed draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.route(/memba\.v1\.|\.gno\.land|gnolove|plausible\.io|sentry\.|clerk[.-]/, route => route.abort())
    await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
    await page.goto(`${OS_FEED_ON}/os/feed`)

    const composer = page.getByRole('region', { name: 'Feed', exact: true }).getByTestId('feed-composer-input')
    await expect(composer).toBeVisible()
    await composer.fill('My unsaved draft')

    await page.evaluate(() => {
        window.history.pushState({}, '', '/os/feed?compose=join')
        window.dispatchEvent(new PopStateEvent('popstate'))
    })

    await expect(composer).toHaveValue('My unsaved draft')
    await page.getByRole('button', { name: 'Replace draft with #join template' }).click()
    await expect(composer).toHaveValue(/^#join /)
})
