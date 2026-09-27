import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
import { abortOnchainReads } from '../helpers/onchain'

async function guest(page: Page) {
    await abortOnchainReads(page)
    await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
}

test.describe('native OS Settings', () => {
    test.beforeEach(async ({ page }) => { await guest(page) })

    test('direct route opens the native seven-section window', async ({ page }) => {
        await page.goto(`${OS_ON}/os/settings`)
        const win = page.getByRole('region', { name: 'Settings', exact: true })
        const nav = win.getByRole('navigation', { name: 'Settings' })
        for (const name of ['Desktop', 'Notifications', 'Safety', 'Network', 'Transactions', 'Account', 'About']) {
            await expect(nav.getByRole('button', { name })).toBeVisible()
        }
        await expect(nav.getByRole('button', { name: 'Desktop' })).toHaveAttribute('aria-current', 'true')
        await expect(win.locator('.os-classic')).toHaveCount(0)
        await expect(win.getByRole('button', { name: 'Directory' })).toHaveCount(0)
    })

    test('appearance follows the OS preference immediately and persists', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'light' })
        await page.goto(`${OS_ON}/os/settings`)
        const win = page.getByRole('region', { name: 'Settings', exact: true })
        const os = page.getByTestId('memba-os')
        await win.getByRole('button', { name: 'Dark', exact: true }).click()
        await expect(os).toHaveAttribute('data-os-theme', 'dark')
        await expect.poll(() => page.evaluate(() => localStorage.getItem('memba_os_theme'))).toBe('dark')
        await expect.poll(() => page.evaluate(() => localStorage.getItem('memba_theme'))).toBeNull()
        await win.getByRole('button', { name: 'System', exact: true }).click()
        await expect(os).toHaveAttribute('data-os-theme', 'light')
        await page.emulateMedia({ colorScheme: 'dark' })
        await expect(os).toHaveAttribute('data-os-theme', 'dark')
        await page.reload()
        await expect(os).toHaveAttribute('data-os-theme', 'dark')
    })

    test('Live is a network hover/focus preview and the desktop widget is opt-in', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
        await page.goto(`${OS_ON}/os/settings`)
        const network = page.getByRole('button', { name: 'Network: gnoland-1' })
        const widget = page.getByRole('main', { name: 'Desktop' }).locator('.os-live-ticker')
        const preview = page.getByRole('group', { name: 'Live activity preview' })
        await expect(widget).toHaveCount(0)
        await network.hover()
        await expect(preview).toBeVisible()
        await network.click()
        await expect(page.getByRole('menu', { name: 'Network' })).toBeVisible()
        await page.keyboard.press('Escape')
        await network.focus()
        await expect(preview).toBeVisible()
        const setting = page.getByRole('checkbox', { name: 'Add the Widget' })
        await setting.check()
        await expect(widget).toBeVisible()
        await page.reload()
        await expect(widget).toBeVisible()
        await page.getByRole('checkbox', { name: 'Add the Widget' }).uncheck()
        await expect(widget).toHaveCount(0)
    })

    test('wallpaper and desktop icon size apply without reload', async ({ page }) => {
        await page.goto(`${OS_ON}/os/settings`)
        const win = page.getByRole('region', { name: 'Settings', exact: true })
        const os = page.getByTestId('memba-os')
        const originalBackground = await os.evaluate((el) => getComputedStyle(el).backgroundImage)
        const originalTileSize = await os.locator('.os-thing .os-tile').first().evaluate((el) => getComputedStyle(el).getPropertyValue('--os-ts').trim())
        await win.getByRole('button', { name: 'Lagoon wallpaper' }).click()
        await expect(os).toHaveAttribute('data-os-wallpaper', 'lagoon')
        expect(await os.evaluate((el) => getComputedStyle(el).backgroundImage)).not.toBe(originalBackground)
        await win.getByRole('button', { name: 'Large icons' }).click()
        await expect(os).toHaveAttribute('data-os-icon-size', 'large')
        expect(await os.locator('.os-thing .os-tile').first().evaluate((el) => getComputedStyle(el).getPropertyValue('--os-ts').trim())).not.toBe(originalTileSize)
        await page.reload()
        await expect(os).toHaveAttribute('data-os-wallpaper', 'lagoon')
        await expect(os).toHaveAttribute('data-os-icon-size', 'large')
    })

    test('gas defaults validate input and use the existing preference key', async ({ page }) => {
        await page.goto(`${OS_ON}/os/settings`)
        const win = page.getByRole('region', { name: 'Settings', exact: true })
        await win.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Transactions' }).click()
        await win.getByRole('spinbutton', { name: 'Gas wanted' }).fill('0')
        await win.getByRole('button', { name: 'Save gas defaults' }).click()
        await expect(win.getByRole('alert')).toContainText('positive whole numbers')
        await win.getByRole('spinbutton', { name: 'Gas wanted' }).fill(String(Number.MAX_SAFE_INTEGER))
        await win.getByRole('button', { name: 'Save gas defaults' }).click()
        await expect(win.getByRole('alert')).toContainText('deploy limit')
        await win.getByRole('spinbutton', { name: 'Gas wanted' }).fill('12000000')
        await win.getByRole('spinbutton', { name: 'Gas fee (ugnot)' }).fill('1500000')
        await win.getByRole('button', { name: 'Save gas defaults' }).click()
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('memba_settings') || '{}'))).toEqual({ gasWanted: 12000000, gasFee: 1500000 })
    })

    test('reset sheet cancels and preserves drafts and send locks on confirm', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('memba_os_terminal_draft:gnoland-1:guest', 'draft')
            localStorage.setItem('memba_os_send_lock:gnoland-1:g1test', 'lock')
        })
        await page.goto(`${OS_ON}/os/settings`)
        await expect.poll(() => page.evaluate(() => Object.keys(localStorage).find((key) => key.startsWith('memba_os_windows:')) ?? null)).not.toBeNull()
        const windowsKey = await page.evaluate(() => Object.keys(localStorage).find((key) => key.startsWith('memba_os_windows:'))!)
        const savedWindows = await page.evaluate((key) => localStorage.getItem(key), windowsKey)
        const win = page.getByRole('region', { name: 'Settings', exact: true })
        await win.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Safety' }).click()
        await win.getByRole('button', { name: 'Reset local app data' }).click()
        const sheet = page.getByRole('dialog', { name: 'Reset local app data' })
        await expect(sheet).toBeVisible()
        await sheet.getByRole('button', { name: 'Cancel' }).click()
        await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), windowsKey)).toBe(savedWindows)
        await win.getByRole('button', { name: 'Reset local app data' }).click()
        await sheet.getByRole('button', { name: 'Confirm reset' }).click()
        await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), windowsKey)).toBeNull()
        await expect.poll(() => page.evaluate(() => localStorage.getItem('memba_os_terminal_draft:gnoland-1:guest'))).toBe('draft')
        await expect.poll(() => page.evaluate(() => localStorage.getItem('memba_os_send_lock:gnoland-1:g1test'))).toBe('lock')
    })

    test('account and About remain available to guests', async ({ page }) => {
        await page.goto(`${OS_ON}/os/settings`)
        const win = page.getByRole('region', { name: 'Settings', exact: true })
        const nav = win.getByRole('navigation', { name: 'Settings' })
        await nav.getByRole('button', { name: 'Account' }).click()
        await expect(win.getByRole('button', { name: 'Connect wallet' })).toBeVisible()
        await nav.getByRole('button', { name: 'About' }).click()
        await win.getByRole('button', { name: 'Open About Memba OS' }).click()
        await expect(page.getByRole('region', { name: 'About Memba OS' })).toBeVisible()
    })

    test('phone Settings remains navigable without horizontal overflow', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto(`${OS_ON}/os/settings`)
        const sheet = page.locator('.os-ph-sheet')
        await expect(sheet.getByRole('navigation', { name: 'Settings' })).toBeVisible()
        await sheet.getByRole('button', { name: 'Safety' }).click()
        await expect(sheet.getByRole('button', { name: 'Reset local app data' })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 4)).toBe(true)
    })

    test('Settings content fits a narrow desktop window', async ({ page }) => {
        await page.goto(`${OS_ON}/os/settings`)
        const win = page.getByRole('region', { name: 'Settings', exact: true })
        await win.evaluate((el) => { (el as HTMLElement).style.width = '360px' })
        await expect(win.getByRole('button', { name: 'Lagoon wallpaper' })).toBeVisible()
        expect(await win.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    })
})
