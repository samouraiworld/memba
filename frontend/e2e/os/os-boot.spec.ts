import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
import { fulfillGovernance } from '../helpers/proGovernanceFixture'

// The memba.club boot (proposal A "POST check" straight into
// proposal C "CRT warm-up"): each plain visit, over the lock screen, about 2 s,
// a click or a key skips it, never under reduced motion, never on a shared link.

async function offline(page: Page) {
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (r) => {
        const u = new URL(r.request().url())
        return u.hostname === '127.0.0.1' && !/memba\.v1\./.test(u.pathname) ? r.continue() : r.abort()
    })
    await fulfillGovernance(page)
    await page.setViewportSize({ width: 1280, height: 800 })
}

const boot = (page: Page) => page.getByTestId('os-boot')
const lock = (page: Page) => page.getByRole('dialog', { name: 'Welcome to Memba' })

test.describe('Memba OS boot', () => {
    test.beforeEach(async ({ page }) => { await offline(page) })

    test('each plain visit boots over the lock screen with real facts', async ({ page }) => {
        await page.goto(`${OS_ON}/os`)
        await expect(boot(page)).toBeAttached()
        // The self-test reports what this browser knows: the network, the wallet, the desk, the apps.
        await expect(boot(page)).toContainText('gnoland-1')
        await expect(boot(page)).toContainText(/wallet \.+ none yet/)
        await expect(boot(page)).toContainText(/apps \.+ \d+ ready/)
        await expect(boot(page)).toHaveCount(0, { timeout: 4000 })
        await expect(lock(page)).toBeVisible()
        await page.reload()
        await expect(lock(page)).toBeVisible()
        await expect(boot(page)).toBeAttached()
        await expect(boot(page)).toHaveCount(0, { timeout: 4000 })
    })

    test('Settings can skip the intro on future plain visits', async ({ page }) => {
        await page.goto(`${OS_ON}/os/settings`)
        await page.getByRole('checkbox', { name: 'Skip intro automatically' }).check()
        await page.goto(`${OS_ON}/os`)
        await expect(boot(page)).toHaveCount(0)
        await expect(lock(page)).toHaveCount(0)
        await expect(page.getByRole('main', { name: 'Desktop' })).toBeVisible()
    })

    test('a click skips it; a key skips it without pressing the lock screen button underneath', async ({ page }) => {
        await page.goto(`${OS_ON}/os`)
        await boot(page).click({ position: { x: 20, y: 20 } })
        await expect(boot(page)).toHaveCount(0)
        await expect(lock(page)).toBeVisible()

        await page.reload()
        await expect(boot(page)).toBeAttached()
        // "Connect wallet" has focus on the lock screen: Enter must only end the boot.
        await page.keyboard.press('Enter')
        await expect(boot(page)).toHaveCount(0)
        await expect(lock(page)).toBeVisible()
        await expect(page.getByRole('dialog', { name: /Connect/ })).toHaveCount(0)
    })

    test('never under reduced motion, and never on a shared link', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.goto(`${OS_ON}/os`)
        await expect(lock(page)).toBeVisible()
        await expect(boot(page)).toHaveCount(0)

        await page.emulateMedia({ reducedMotion: 'no-preference' })
        await page.evaluate(() => localStorage.clear())
        await page.goto(`${OS_ON}/os/dao/govdao`)
        await expect(page.getByRole('region', { name: 'govdao', exact: true })).toBeVisible()
        await expect(boot(page)).toHaveCount(0)
    })
})
