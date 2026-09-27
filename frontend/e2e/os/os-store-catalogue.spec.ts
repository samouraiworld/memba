import { expect, test } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
import { fulfillGovernance } from '../helpers/proGovernanceFixture'
import { fulfillOnchainReads, mockAppChainStatus } from '../helpers/onchain'

for (const [width, device] of [[1280, 'desktop'], [375, 'phone']] as const) {
    test(`flag-off Store keeps external apps and verified realm links in the OS on ${device}`, async ({ page }) => {
        await fulfillGovernance(page)
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.setViewportSize({ width, height: 800 })
        await page.goto(`${OS_ON}/os/store`)
        const store = page.getByRole('region', { name: 'App Store', exact: true })
        const directory = store.getByRole('region', { name: 'Gno ecosystem apps' })
        await expect(directory.getByRole('heading', { level: 1, name: 'App Store' })).toBeVisible()
        await expect(directory.getByRole('link', { name: 'Visit Bubble Rumble (opens in a new tab)' })).toHaveAttribute('href', 'https://bubblerumble.net/')
        await expect(directory.getByRole('link', { name: 'Bubble Rumble mainnet realm (opens in a new tab)' })).toHaveCount(0)
        await expect(directory.getByRole('link', { name: 'Kourt mainnet realm (opens in a new tab)' })).toHaveAttribute('href', 'https://gno.land/r/g1ecsuj0q572jr0dhu29q9njtnmw03hyu7tyyvv6/kourt')
        await expect(directory.getByRole('link', { name: 'Visit Adena (opens in a new tab)' })).toBeVisible()
    })
}

const live = [
    { id: 1, pkgPath: 'gno.land/r/gnoswap/router', name: 'GnoSwap', tagline: '', category: 'Exchange', iconCID: '', appURL: 'https://gnoswap.io/', publisher: '', status: 'live', flagCount: 0, createdAt: 0 },
    { id: 2, pkgPath: 'gno.land/r/gnoland/boards2/v0', name: 'Boards', tagline: '', category: 'Community', iconCID: '', appURL: 'https://gno.land/r/gnoland/boards2/v0', publisher: '', status: 'live', flagCount: 0, createdAt: 0 },
]

for (const [width, device] of [[1280, 'desktop'], [375, 'phone']] as const) {
    test(`flag-on Store shows one catalogue in the OS on ${device}`, async ({ page }) => {
        test.skip(process.env.OS_STORE_CHAIN !== 'true', 'run with OS_STORE_CHAIN=true and VITE_ENABLE_APPSTORE=true')
        await fulfillOnchainReads(page, ({ method, path, arg }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (path === 'vm/qeval' && arg.includes('ListLiveJSON')) return `(${JSON.stringify(JSON.stringify(live))} string)`
            if (path === 'vm/qeval' && arg.includes('GetStatsJSON')) return `(${JSON.stringify(JSON.stringify({ live: 2, total: 2, registrationFee: 1000000, paused: false }))} string)`
            return null
        })
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.setViewportSize({ width, height: 800 })
        await page.goto(`${OS_ON}/os/store`)
        const store = page.getByRole('region', { name: 'App Store', exact: true })
        const directory = store.getByRole('region', { name: 'Gno ecosystem apps' })
        await expect(directory.getByRole('heading', { name: 'More from the Gno ecosystem' })).toBeVisible()
        await expect(store.getByRole('heading', { name: 'GnoSwap' })).toHaveCount(1)
        await expect(store.getByRole('button', { name: 'Boards' })).toHaveCount(1)
        await expect(directory.getByRole('link', { name: 'Visit GnoSwap (opens in a new tab)' })).toHaveCount(0)
        await expect(directory.getByRole('link', { name: 'Visit Boards (opens in a new tab)' })).toHaveCount(0)
        await expect(directory.getByRole('link', { name: 'Visit Bubble Rumble (opens in a new tab)' })).toBeVisible()
        await expect(directory.getByRole('link', { name: 'Visit Adena (opens in a new tab)' })).toBeVisible()
    })
}
