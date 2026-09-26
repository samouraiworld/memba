import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { OS_ON } from '../../playwright.os.config'
import { abortOnchainReads } from '../helpers/onchain'
import { fulfillProValidatorRoster } from '../helpers/proValidatorsFixture'

// Day 5a: every app without a native window shows its existing Memba page
// inside the window (no "Open in Memba" links), links inside a page open the
// window that owns the target, and ⌘K finds apps, pages and commands.
// Chain reads are refused: only the pages' own frames are exercised.

async function guest(page: Page) {
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
    await abortOnchainReads(page)
    await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
    await page.setViewportSize({ width: 1400, height: 900 })
}

const win = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

test.describe('Memba OS pages in windows', () => {
    test.beforeEach(async ({ page }) => { await guest(page) })

    test('an app without a native window shows its Memba page inside the window', async ({ page }) => {
        await page.goto(`${OS_ON}/os/settings`)
        const settings = win(page, 'Settings')
        await expect(settings.getByRole('heading', { name: 'Settings', exact: true }).first()).toBeVisible()
        await expect(page.getByRole('link', { name: /in Memba$/ })).toHaveCount(0)
        // Memba's own navigation chrome stays out: the window holds the page only.
        await expect(page.locator('.os-classic nav[aria-label="Main navigation"], .os-classic .k-sidebar')).toHaveCount(0)
    })

    test('the NFT window shows its own native home instead of opening Market by itself', async ({ page }) => {
        await page.goto(`${OS_ON}/os/nft`)
        const nft = win(page, 'NFT')
        // This e2e's default network is gnoland-1 (mainnet): the NFT realms aren't
        // live there yet, so the home explains that instead of the classic page.
        await expect(nft.getByText(/isn't available yet/)).toBeVisible()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/nft')
        await expect(page.getByRole('region', { name: 'Market', exact: true })).toHaveCount(0)
        await nft.getByRole('button', { name: 'Open Market' }).click()
        await expect(win(page, 'Market').getByRole('heading', { name: 'Marketplace' }).first()).toBeVisible()
        await expect(win(page, 'NFT')).toBeVisible()
    })

    test("a page's own query (a Validators tab) works in its window, follows the address bar and survives Back and reload", async ({ page }) => {
        // A served roster (registered after the chain-read abort, so it wins): the tabs render with data.
        await fulfillProValidatorRoster(page)
        await page.goto(`${OS_ON}/os/validators?w=app.feed`)
        const val = win(page, 'Validators')
        const selected = (id: string) => val.getByTestId(id)
        await expect(selected('seg-validators')).toHaveAttribute('aria-selected', 'true')
        await selected('seg-network').click()
        await expect(selected('seg-network')).toHaveAttribute('aria-selected', 'true')
        // The page's query sits beside the reserved w key; the Feed window stays open.
        await expect.poll(() => new URL(page.url()).search).toBe('?tab=network&w=app.feed')
        await expect(win(page, 'Feed')).toBeVisible()
        await page.goBack()
        await expect(selected('seg-validators')).toHaveAttribute('aria-selected', 'true')
        await expect.poll(() => new URL(page.url()).search).toBe('?w=app.feed')
        await page.goForward()
        await expect(selected('seg-network')).toHaveAttribute('aria-selected', 'true')
        await page.reload()
        await expect(win(page, 'Validators').getByTestId('seg-network')).toHaveAttribute('aria-selected', 'true')
        // A shared link opens straight on that tab.
        await page.goto(`${OS_ON}/os/validators?tab=candidates`)
        await expect(win(page, 'Validators').getByTestId('seg-candidates')).toHaveAttribute('aria-selected', 'true')
    })

    test('a link inside the page stays in its window, and the address bar follows', async ({ page }) => {
        await page.goto(`${OS_ON}/os/quests`)
        const quests = win(page, 'Quests')
        const board = quests.getByRole('link', { name: 'View Leaderboard' })
        await expect(board).toHaveAttribute('href', '/os/quests/leaderboard')
        await board.click()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/quests/leaderboard')
        await expect(page.getByRole('region', { name: 'Quests', exact: true })).toHaveCount(1)
        await page.goBack()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/quests')
    })

    test("a page's link to another app opens that app's window beside it", async ({ page }) => {
        await page.goto(`${OS_ON}/os/settings`)
        const settings = win(page, 'Settings')
        await settings.getByRole('button', { name: /Directory/ }).first().click()
        await settings.locator('#settings-directory-btn').click()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/explorer')
        await expect(win(page, 'Explorer')).toBeVisible()
        await expect(win(page, 'Settings')).toBeVisible()
    })

    test('⌘K opens pages in the window that owns them; a wallet-only page asks a guest to connect', async ({ page }) => {
        await page.goto(`${OS_ON}/os`)
        await expect(page.getByRole('button', { name: 'Search (⌘K)' })).toBeVisible()
        await page.keyboard.press('ControlOrMeta+k')
        const search = page.getByRole('dialog', { name: 'Search and commands' })
        await search.getByRole('combobox', { name: 'Search' }).fill('import multisig')
        await expect(search.getByRole('option').first()).toContainText('Import Multisig')
        await page.keyboard.press('Enter')
        await expect(search).toHaveCount(0)
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/multisig/import')
        const multisig = win(page, 'Multisig')
        await expect(multisig.getByText('Connect a wallet to use Multisig.')).toBeVisible()
        await expect(multisig.getByRole('button', { name: 'Connect' })).toBeVisible()
    })

    test('⌘K turns a realm path into its DAO window, and Escape closes it', async ({ page }) => {
        await page.goto(`${OS_ON}/os`)
        await page.getByRole('button', { name: 'Search (⌘K)' }).click()
        const search = page.getByRole('dialog', { name: 'Search and commands' })
        await page.keyboard.type('gno.land/r/gov/dao')
        await expect(search.getByRole('option').first()).toContainText('Realm · open as a DAO')
        await page.keyboard.press('Escape')
        await expect(search).toHaveCount(0)
        await page.keyboard.press('ControlOrMeta+k')
        await page.keyboard.type('gno.land/r/gov/dao')
        await page.keyboard.press('Enter')
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/dao/govdao')
    })

    test('Send feedback opens in its own window', async ({ page }) => {
        await page.goto(`${OS_ON}/os`)
        await page.getByRole('button', { name: 'Memba menu' }).click()
        await page.getByRole('menuitem', { name: 'Send feedback…' }).click()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/feedback')
        await expect(win(page, 'Send feedback')).toBeVisible()
    })
})

for (const view of [
    { name: 'light', theme: 'light', width: 1400, height: 900 },
    { name: 'dark', theme: 'dark', width: 1400, height: 900 },
    { name: '420px', theme: 'light', width: 1400, height: 900, windowWidth: 420 },
    { name: 'phone', theme: 'light', width: 375, height: 760 },
] as const) {
    test(`NFT home accessibility and layout · ${view.name}`, async ({ page }, testInfo) => {
        await guest(page)
        await page.emulateMedia({ colorScheme: view.theme, reducedMotion: 'reduce' })
        await page.setViewportSize({ width: view.width, height: view.height })
        await page.goto(`${OS_ON}/os/nft`)
        const nft = win(page, 'NFT')
        await expect(nft.getByText(/isn't available yet/)).toBeVisible()
        if ('windowWidth' in view) {
            await nft.evaluate((el, width) => { (el as HTMLElement).style.width = `${width}px` }, view.windowWidth)
        }
        const body = nft.locator('.os-wbody')
        expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
        const results = await new AxeBuilder({ page }).include('.memba-os').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
        expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
        const screenshot = testInfo.outputPath(`nft-${view.name}.png`)
        await page.screenshot({ path: screenshot })
        await testInfo.attach(`nft-${view.name}`, { path: screenshot, contentType: 'image/png' })
    })
}
