import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { OS_ON } from '../../playwright.os.config'

for (const [width, name] of [[1280, 'desktop'], [375, 'phone']] as const) {
    test(`Live keeps an indexer failure distinct from an empty sample on ${name}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 })
        await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
        await page.route(/\/api\/indexer/, route => route.fulfill({ status: 503, body: 'offline' }))
        await page.route(/memba\.v1\.|\.gno\.land|gnolove|clerk[.-]/, route => route.abort())
        await page.goto(`${OS_ON}/os/live`)

        const live = page.getByRole('region', { name: 'Live', exact: true })
        await expect(live.getByRole('heading', { name: 'Recent on-chain activity' })).toBeVisible()
        await expect(live.getByText('Could not load recent activity from the indexer.')).toBeVisible()
        await expect(live.getByRole('button', { name: 'Retry' })).toBeVisible()
        await expect(live.getByText('No transactions appeared in the recent indexed sample.')).toHaveCount(0)

        if (name === 'desktop') {
            const ticker = page.getByRole('button', { name: /Open Live activity.*Activity could not be refreshed/ })
            await expect(ticker).toHaveAttribute('data-state', 'error')
        }
        const scan = await new AxeBuilder({ page }).include('.memba-os').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
        expect(scan.violations.filter(result => result.impact === 'serious' || result.impact === 'critical')).toEqual([])
    })
}
