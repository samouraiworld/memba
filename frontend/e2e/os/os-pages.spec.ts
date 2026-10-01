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
    await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
    await page.setViewportSize({ width: 1400, height: 900 })
}

const win = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

test.describe('Memba OS pages in windows', () => {
    test.beforeEach(async ({ page }) => { await guest(page) })

    test('an app without a native window shows its Memba page inside the window', async ({ page }) => {
        // Dev Report has no native window (the Quests hub is native now).
        await page.goto(`${OS_ON}/os/dev-report`)
        const report = win(page, 'Dev Report')
        await expect(report.locator('.os-classic')).toBeVisible()
        await expect(page.getByRole('link', { name: /in Memba$/ })).toHaveCount(0)
        // Memba's own navigation chrome stays out: the window holds the page only.
        await expect(page.locator('.os-classic nav[aria-label="Main navigation"], .os-classic .k-sidebar')).toHaveCount(0)
    })

    test('the NFT window shows its own native home instead of opening Market by itself', async ({ page }) => {
        await page.goto(`${OS_ON}/os/nft`)
        const nft = win(page, 'NFT')
        // The default network is mainnet: the home names the missing registry
        // and the build flag instead of implying NFT actions are available.
        await expect(nft.getByRole('note')).toContainText('NFT ledger is not deployed')
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/nft')
        await expect(page.getByRole('region', { name: 'Market', exact: true })).toHaveCount(0)
        await nft.getByRole('button', { name: 'Open Market' }).click()
        // Market opens on its native home; this build enables no lane, so it lists none.
        const market = win(page, 'Market')
        await expect(market.getByRole('heading', { name: 'Market lanes', exact: true })).toBeVisible()
        await expect(market.getByRole('note')).toContainText('No Market lane is available here. A lane appears only when it is enabled in this build and its realm is available on')
        await expect(market.locator('.os-scard')).toHaveCount(0)
        await expect(market.locator('.os-classic')).toHaveCount(0)
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/market')
        await expect(win(page, 'NFT')).toBeVisible()
    })

    test('the Explorer opens on its native realm directory; a tab or a realm opens the classic view in the same window', async ({ page }) => {
        await page.goto(`${OS_ON}/os/explorer`)
        const explorer = win(page, 'Explorer')
        const home = explorer.getByRole('heading', { level: 1, name: 'Realm directory' })
        await expect(home).toBeVisible()
        await expect(explorer.locator('.os-classic')).toHaveCount(0)
        // Chain reads are refused: the home says so instead of showing figures, over the curated realms.
        await expect(explorer.getByText('The chain figures could not be read from the network.')).toBeVisible({ timeout: 30_000 })
        await explorer.getByRole('button', { name: /^Packages/ }).click()
        await expect.poll(() => new URL(page.url()).search).toBe('?tab=packages')
        const tab = (name: string) => explorer.locator('.dir-tab', { hasText: name })
        await expect(tab('Packages')).toHaveAttribute('aria-selected', 'true')
        // The classic page keeps naming its tab: its default tab must not land on the native home.
        await tab('DAOs').click()
        await expect.poll(() => new URL(page.url()).search).toBe('?tab=daos')
        await tab('Packages').click()
        await expect.poll(() => new URL(page.url()).search).toBe('?tab=packages')
        await expect(explorer.locator('.os-classic')).toBeVisible()
        await explorer.getByRole('button', { name: 'Realm directory' }).click()
        await expect(home).toBeFocused()
        await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe('/os/explorer')
        await explorer.getByRole('button', { name: 'Open GovDAO, gno.land/r/gov/dao' }).click()
        await expect.poll(() => new URL(page.url()).search).toBe('?tab=explorer&realm=r%2Fgov%2Fdao')
        await expect(explorer.locator('.os-classic')).toBeVisible()
        await expect(page.getByRole('region', { name: 'Explorer', exact: true })).toHaveCount(1)
        // Opening a realm is a history entry: Back returns to the home.
        await page.goBack()
        await expect(home).toBeVisible()
        await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe('/os/explorer')
    })

    test("a window's own query (the Validators list) sits beside the other windows' key, and survives reload and a shared link", async ({ page }) => {
        // A served roster (registered after the chain-read abort, so it wins): the lists render with data.
        await fulfillProValidatorRoster(page)
        await page.goto(`${OS_ON}/os/validators?w=app.feed`)
        const list = (name: string) => win(page, 'Validators').getByRole('group', { name: 'Validator lists' }).getByRole('button', { name })
        await expect(list('Active set')).toHaveAttribute('aria-pressed', 'true')
        await list('Candidates').click()
        await expect(list('Candidates')).toHaveAttribute('aria-pressed', 'true')
        // The view's query sits beside the reserved w key; the Feed window stays open.
        await expect.poll(() => new URL(page.url()).search).toBe('?tab=candidates&w=app.feed')
        await expect(win(page, 'Feed')).toBeVisible()
        await list('Active set').click()
        await expect.poll(() => new URL(page.url()).search).toBe('?w=app.feed')
        await list('Candidates').click()
        await expect.poll(() => new URL(page.url()).search).toBe('?tab=candidates&w=app.feed')
        await page.reload()
        await expect(list('Candidates')).toHaveAttribute('aria-pressed', 'true')
        // A shared link opens straight on that list.
        await page.goto(`${OS_ON}/os/validators?tab=candidates`)
        await expect(list('Candidates')).toHaveAttribute('aria-pressed', 'true')
        // Network is still the classic page's view, in this window: a history entry, so Back returns to the list.
        const classicTab = (id: string) => win(page, 'Validators').getByTestId(id)
        await win(page, 'Validators').getByRole('button', { name: 'Network' }).click()
        await expect(classicTab('seg-network')).toHaveAttribute('aria-selected', 'true')
        await expect.poll(() => new URL(page.url()).search).toBe('?tab=network')
        await page.goBack()
        await expect(list('Candidates')).toHaveAttribute('aria-pressed', 'true')
        await page.goForward()
        // The classic page's own tabs lead back to the lists.
        await classicTab('seg-validators').click()
        await expect(list('Active set')).toHaveAttribute('aria-pressed', 'true')
    })

    test('a link inside the page stays in its window, and the address bar follows', async ({ page }) => {
        // The leaderboard is a classic page in the Quests window (the hub is native).
        await page.goto(`${OS_ON}/os/quests/leaderboard`)
        const quests = win(page, 'Quests')
        const hub = quests.getByRole('link', { name: 'View Quests' })
        await expect(hub).toHaveAttribute('href', '/os/quests')
        await hub.click()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/quests')
        await expect(page.getByRole('region', { name: 'Quests', exact: true })).toHaveCount(1)
        await expect(quests.getByRole('heading', { level: 1, name: 'Quests' })).toBeVisible()
        await page.goBack()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/quests/leaderboard')
    })

    test('a link in Settings opens another system window beside it', async ({ page }) => {
        await page.goto(`${OS_ON}/os/settings`)
        const settings = win(page, 'Settings')
        await settings.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Account' }).click()
        await expect(settings.getByRole('button', { name: 'Connect wallet' })).toBeVisible()
        await expect(settings.getByRole('button', { name: 'Open Profile' })).toHaveCount(0)
        await settings.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'About' }).click()
        await settings.getByRole('button', { name: 'Open About Memba OS' }).click()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/about')
        await expect(win(page, 'About Memba OS')).toBeVisible()
        await expect(win(page, 'Settings')).toBeVisible()
    })

    test('⌘K opens pages in the window that owns them; a guest sees the page, asked to connect where it needs a wallet', async ({ page }) => {
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
        // The import form itself, with its own prompt and a submit that needs a wallet.
        await expect(multisig.getByText('Connect your wallet to import a multisig')).toBeVisible()
        await expect(multisig.getByRole('button', { name: 'Import account', exact: true })).toBeDisabled()
        await multisig.locator('.os-classic').getByRole('button', { name: 'Connect wallet', exact: true }).click()
        await expect(page.getByRole('dialog', { name: 'Connect a wallet' })).toBeVisible()
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
        await expect(nft.getByRole('note')).toContainText('NFT ledger is not deployed')
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
