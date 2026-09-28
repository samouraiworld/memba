import { expect, test } from '@playwright/test'
import { OS_FEED_ON } from '../../playwright.os.config'

for (const [width, label] of [[1280, 'desktop'], [375, 'phone']] as const) {
    test(`native Feed keeps honest offline and Aqua states on ${label}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 })
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.route(/memba\.v1\.|memba-backend\.fly\.dev/, route => route.fulfill({ status: 503, body: 'offline' }))
        await page.goto(`${OS_FEED_ON}/os/feed`)
        const feed = page.getByRole('region', { name: 'Feed', exact: true })
        await expect(feed.getByRole('heading', { name: 'Community posts' })).toBeVisible()
        await expect(feed.getByText('The Feed could not be loaded. Your posts remain on-chain.')).toBeVisible()
        await expect(feed.getByRole('button', { name: 'Connect to post' })).toBeDisabled()
        const themed = await feed.locator('.os-feed').evaluate(el => {
            const style = getComputedStyle(el)
            return style.getPropertyValue('--color-primary').trim() === style.getPropertyValue('--os-acc').trim()
        })
        expect(themed).toBe(true)
        expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(width)
    })
}
