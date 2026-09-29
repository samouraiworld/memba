import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { OS_ON } from '../../playwright.os.config'
import { fulfillOnchainReads, mockAppChainStatus } from '../helpers/onchain'

const ADDRESS = 'g1manfred47kzduec920z88wfr64ylksmdcedlf5'
const document = JSON.stringify({
    version: 1, template: 'builder', accent: 'teal', title: 'Designer', company: 'Cooperative', cover: '',
    links: [{ label: 'Work', url: 'https://example.org/' }],
    sections: ['about', 'links', 'feed', 'daos', 'votes', 'assets', 'credentials', 'reviews'], hidden: [],
})

async function guest(page: Page) {
    await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, route => route.abort())
    await fulfillOnchainReads(page, ({ method, path, arg }) => {
        if (method === 'status') return mockAppChainStatus()
        if (method === 'abci_query' && path === 'vm/qeval' && arg.includes('ResolveName("nym-builder042")')) {
            return `(&(struct{("${ADDRESS}" .uverse.address),("nym-builder042" string),(false bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)\n(true bool)`
        }
        if (method === 'abci_query' && path === 'vm/qeval' && arg.includes('GetStringField(')) {
            const field = /GetStringField\(address\("[^"]+"\), "([^"]+)"/.exec(arg)?.[1]
            const value: Record<string, string> = { DisplayName: 'Alice on Gno', Bio: 'Building public goods', Homepage: 'https://example.org', Location: 'Paris', Avatar: '', 'memba.profile.v1': document }
            return `(${JSON.stringify(value[field ?? ''] ?? '')} string)`
        }
        if (method === 'abci_query' && path === 'vm/qrender' && arg === 'gno.land/r/' + ADDRESS + '/home:') {
            return '# Alice Home\nBuilding public goods from this personal Gno realm.'
        }
        if (method === 'abci_query' && path.startsWith('bank/balances/')) return '"2500000ugnot"'
        return null
    })
}

test.describe('Memba OS native profile', () => {
    test.beforeEach(async ({ page }) => { await guest(page) })

    test('a guest sees public on-chain fields, layout and default public modules', async ({ page }) => {
        await page.goto(`${OS_ON}/os/profile/${ADDRESS}`)
        const profile = page.getByTestId('os-profile-window')
        await expect(profile.getByRole('heading', { name: 'Alice on Gno' })).toBeVisible()
        await expect(profile.getByText('Building public goods', { exact: true })).toBeVisible()
        await expect(profile.getByText('Designer · Cooperative')).toBeVisible()
        await expect(profile.getByRole('link', { name: 'Work ↗' })).toHaveAttribute('href', 'https://example.org/')
        await expect(profile.getByRole('region', { name: 'Public assets' })).toBeVisible()
        await expect(profile.getByRole('region', { name: 'Credentials' })).toBeVisible()
        await expect(profile.getByText('2.5 GNOT')).toBeVisible()
        await expect(profile.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
        await expect(profile.getByText('On-chain Home found')).toBeVisible()
        await profile.getByRole('button', { name: 'Copy share link' }).click()
        await expect(profile).toBeVisible()
    })

    test('Home appears as a distinct owner-authored realm with a source link', async ({ page }) => {
        await page.goto(OS_ON + '/os/profile/' + ADDRESS)
        const profile = page.getByTestId('os-profile-canvas')
        await profile.getByRole('tab', { name: 'Home' }).click()
        await expect(profile.getByRole('heading', { name: 'Alice Home' })).toBeVisible()
        await expect(profile.getByText('Building public goods from this personal Gno realm.')).toBeVisible()
        await expect(profile.getByText(/Claims here are owner-authored/)).toBeVisible()
        await expect(profile.getByRole('link', { name: 'View complete Home ↗' })).toHaveAttribute('href', 'https://gno.land/r/' + ADDRESS + '/home')
        await profile.getByRole('tab', { name: 'DAOs' }).click()
        await expect(profile.getByText(/not a complete list of DAOs on Gno/)).toBeVisible()
        await profile.getByRole('tab', { name: 'Contributions' }).click()
        await expect(profile.getByRole('heading', { name: 'Published packages' })).toBeVisible()
        await profile.getByRole('tab', { name: 'Feed' }).click()
        await expect(profile.getByRole('button', { name: 'Posts' })).toHaveAttribute('aria-pressed', 'true')
        await profile.getByRole('button', { name: 'Replies' }).click()
        await expect(profile.getByRole('button', { name: 'Replies' })).toHaveAttribute('aria-pressed', 'true')
    })

    test('a registered @username opens the same address profile', async ({ page }) => {
        await page.goto(`${OS_ON}/os/profile/u/nym-builder042`)
        const profile = page.getByTestId('os-profile-window')
        await expect(profile.getByRole('heading', { name: 'Alice on Gno' })).toBeVisible()
        await expect(profile.getByText(ADDRESS)).toBeVisible()
    })

    test('a guest can try the visual editor without signing', async ({ page }) => {
        await page.goto(`${OS_ON}/os/profile`)
        await page.getByRole('region', { name: 'Profile', exact: true }).getByRole('navigation', { name: 'Profile' }).getByRole('button', { name: 'Try editor' }).click()
        const editor = page.getByTestId('os-profile-editor')
        await expect(editor).toBeVisible()
        await editor.getByRole('textbox', { name: 'Display name' }).fill('Ada Builder')
        await expect(editor.getByTestId('os-profile-canvas').getByRole('heading', { name: 'Ada Builder' })).toBeVisible()
        await editor.getByRole('button', { name: 'Phone' }).click()
        await expect(editor.locator('.os-profile-phone')).toBeVisible()
        await editor.getByRole('button', { name: 'Undo' }).click()
        await expect(editor.getByTestId('os-profile-canvas').getByRole('heading', { name: 'Your name' })).toBeVisible()
    })

    test('public profile fits a phone viewport', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 760 })
        await page.goto(`${OS_ON}/os/profile/${ADDRESS}`)
        await expect(page.getByTestId('os-profile-canvas').getByRole('heading', { name: 'Alice on Gno' })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    })

    test('the editor switches between controls and the same canvas on a phone', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 760 })
        await page.goto(`${OS_ON}/os/profile`)
        await page.getByRole('region', { name: 'Profile', exact: true }).getByRole('navigation', { name: 'Profile' }).getByRole('button', { name: 'Try editor' }).click()
        const editor = page.getByTestId('os-profile-editor')
        await editor.getByRole('textbox', { name: 'Display name' }).fill('Ada Builder')
        await editor.getByRole('group', { name: 'Editor pane' }).getByRole('button', { name: 'Preview' }).click()
        await expect(editor.getByTestId('os-profile-canvas').getByRole('heading', { name: 'Ada Builder' })).toBeVisible()
        await expect(editor.getByRole('textbox', { name: 'Display name' })).toBeHidden()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    })

    for (const scheme of ['light', 'dark'] as const) {
        test(`public profile and guest editor have no serious accessibility findings in ${scheme}`, async ({ page }) => {
            await page.emulateMedia({ colorScheme: scheme })
            await page.goto(`${OS_ON}/os/profile/${ADDRESS}`)
            await expect(page.getByTestId('os-profile-canvas').getByRole('heading', { name: 'Alice on Gno' })).toBeVisible()
            const publicScan = await new AxeBuilder({ page }).include('.os-profile').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
            expect(publicScan.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
            await page.getByRole('region', { name: 'Profile', exact: true }).getByRole('navigation', { name: 'Profile' }).getByRole('button', { name: 'Try editor' }).click()
            await expect(page.getByTestId('os-profile-editor')).toBeVisible()
            const editorScan = await new AxeBuilder({ page }).include('.os-profile').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
            expect(editorScan.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
        })
    }
})
