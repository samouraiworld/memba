import { test, expect } from '@playwright/test'
import { fulfillGovernance } from '../helpers/proGovernanceFixture'

const base = 'http://127.0.0.1:7493'
test('notification lab keeps the root PWA, validates addresses, and waits for explicit permission', async ({ page }) => {
    await fulfillGovernance(page)
    await page.route('https://gnotif.xyz/onyx/v1/triggers?*', route => route.fulfill({ json: [{ id: 'runtime-id', target: 'gno.land/r/nym-gfanton001/echo/v0', event: 'Echo', param: 'to', verified: true }] }))
    await page.goto(`${base}/os/settings`)
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js', { scope: '/' }); await navigator.serviceWorker.ready })
    await page.goto(`${base}/labs/gnotif/`)
    await expect(page.getByRole('status')).toHaveText(/Ready\.|Notifications are blocked/)
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => new URL(r.scope).pathname).sort())).toEqual(['/', '/labs/gnotif/'])
    await expect.poll(() => page.evaluate(() => new URL(navigator.serviceWorker.controller!.scriptURL).pathname)).toBe('/labs/gnotif/sw.js')
    const permission = await page.evaluate(() => Notification.permission)
    await page.getByLabel('Your testnet address').fill('invalid')
    await page.getByRole('button', { name: 'Enable notifications' }).click()
    await expect(page.getByRole('status')).toHaveText('Enter a valid Onyx Gno address.')
    expect(await page.evaluate(() => Notification.permission)).toBe(permission)
    await page.screenshot({ path: '/private/tmp/memba-quick-tests/gnotif-desktop.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: '/private/tmp/memba-quick-tests/gnotif-phone.png' })
    await page.goto(`${base}/os/settings`)
    await expect.poll(() => page.evaluate(() => new URL(navigator.serviceWorker.controller!.scriptURL).pathname)).toBe('/sw.js')
})
