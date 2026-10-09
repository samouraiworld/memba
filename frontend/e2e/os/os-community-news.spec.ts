import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { OS_ON } from '../../playwright.os.config'

const telegram = 'https://t.me/+t0xM6gipZcZhNWQ0'
async function guest(page: Page, phone = false) {
    await page.route(/memba\.v1\.|\.gno\.land|samourai\.live|https?:\/\/[^/]*gnolove|plausible\.io|sentry\.|clerk[.-]/, route => route.abort())
    await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
    await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1280, height: 800 })
    await page.clock.install()
}

for (const theme of ['light', 'dark'] as const) {
    test(`community News appears once on the desktop and remains in News/About · ${theme}`, async ({ page }, testInfo) => {
        await guest(page)
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await page.goto(`${OS_ON}/os`)
        await expect(page.getByRole('main', { name: 'Desktop' })).toBeVisible()
        const card = page.getByRole('complementary', { name: 'News announcement' })
        await expect(card).toHaveCount(0)
        await page.clock.fastForward(21_000)
        await expect(card).toBeVisible()
        await expect(card.getByRole('link', { name: /Follow on X/ })).toHaveAttribute('href', 'https://x.com/membaclub')
        await expect(card.getByRole('link', { name: /Join Telegram/ })).toHaveAttribute('href', telegram)
        const scan = await new AxeBuilder({ page }).include('.os-community-prompt').withTags(['wcag2a', 'wcag2aa']).analyze()
        expect(scan.violations).toEqual([])
        await page.screenshot({ path: testInfo.outputPath(`community-${theme}.png`) })
        // Reloading even before dismissal must not repeat the announcement.
        await page.reload()
        await expect(page.getByRole('main', { name: 'Desktop' })).toBeVisible()
        await page.clock.fastForward(30_000)
        await expect(card).toHaveCount(0)
        await page.getByRole('button', { name: /^Notifications/ }).click()
        const announcement = page.getByRole('region', { name: 'Memba community news' })
        await expect(announcement.getByRole('link', { name: /Join Telegram/ })).toHaveAttribute('href', telegram)
        await page.goto(`${OS_ON}/os/news`)
        await expect(page.getByRole('region', { name: 'Memba community news' })).toBeVisible()
        await page.goto(`${OS_ON}/os/about`)
        const community = page.getByRole('region', { name: 'Memba community', exact: true })
        await expect(community.getByRole('link', { name: /Follow on X/ })).toHaveAttribute('href', 'https://x.com/membaclub')
        await expect(community.getByRole('link', { name: /Join Telegram/ })).toHaveAttribute('href', telegram)
    })
}

test('phones keep community links in Notifications without an automatic popup', async ({ page }) => {
    await guest(page, true)
    await page.goto(`${OS_ON}/os`)
    await expect(page.getByRole('navigation', { name: 'Dock' })).toBeVisible()
    await page.clock.fastForward(30_000)
    await expect(page.getByRole('complementary', { name: 'News announcement' })).toHaveCount(0)
    await page.getByRole('button', { name: /^Notifications/ }).click()
    await expect(page.getByRole('region', { name: 'Memba community news' }).getByRole('link', { name: /Join Telegram/ })).toHaveAttribute('href', telegram)
    expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(390)
})
