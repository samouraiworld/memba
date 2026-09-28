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
        await expect(store.getByRole('navigation', { name: 'App Store' })).toBeVisible()
        await expect(store.getByRole('heading', { name: 'Find your next thing.' })).toBeVisible()
        await expect(store.getByRole('button', { name: 'Details for Bubble Rumble' })).toBeVisible()
        await expect(store.getByRole('button', { name: 'Details for Adena' })).toBeVisible()
        await store.getByRole('button', { name: 'Details for Bubble Rumble' }).click()
        const detail = page.getByRole('region', { name: 'App details · App Store' })
        await expect(detail.getByText('External project', { exact: true })).toBeVisible()
        await expect(detail.getByRole('link', { name: 'Open external site ↗' })).toHaveAttribute('href', 'https://bubblerumble.net/')
        await expect(detail.getByRole('link', { name: 'Read realm source ↗' })).toHaveCount(0)
    })
}

for (const [width, device] of [[1280, 'desktop'], [375, 'phone']] as const) {
    test(`gated onchain reviews stay inside the native Store detail on ${device}`, async ({ page }) => {
        test.skip(process.env.OS_STORE_REVIEWS !== 'true', 'run with OS_STORE_REVIEWS=true, VITE_ENABLE_APP_REVIEWS=true and a test-only allowlisted reviews path')
        await fulfillOnchainReads(page, ({ method, path, arg }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (path === 'vm/qeval' && arg.includes('ListLiveJSON')) return `(${JSON.stringify(JSON.stringify(live))} string)`
            if (path === 'vm/qeval' && arg.includes('GetListingJSON')) return `(${JSON.stringify(JSON.stringify({ ...live[1], descr: 'A public forum on Gno.' }))} string)`
            if (path === 'vm/qeval' && arg.includes('GetSubjectSummaryJSON')) return `(${JSON.stringify(JSON.stringify({ count: 1, sum: 5, average: 5 }))} string)`
            if (path === 'vm/qeval' && arg.includes('GetReviewsJSON')) return `(${JSON.stringify(JSON.stringify([{ id: 7, subject: live[1].pkgPath, author: 'g1reviewer', rating: 5, body: 'A clear onchain forum', createdAt: 100, editedAt: 0, deleted: false, likes: 0, dislikes: 0, flags: 0, reputation: 0 }]))} string)`
            return null
        })
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.setViewportSize({ width, height: 800 })
        await page.goto(`${OS_ON}/os/store`)
        const store = page.getByRole('region', { name: 'App Store', exact: true })
        await store.getByRole('button', { name: 'Details for Boards' }).click()
        const detail = page.getByRole('region', { name: 'App details · App Store' })
        await expect(detail.getByRole('heading', { name: 'Reviews' })).toBeVisible()
        await expect(detail.getByText('A clear onchain forum')).toBeVisible()
        await expect(detail.getByRole('link', { name: 'Manage reviews and replies ↗' })).toHaveAttribute('href', 'https://memba.samourai.app/mainnet/apps/r/gnoland/boards2/v0')
        await expect(detail.getByRole('radiogroup', { name: 'Your rating' })).toBeVisible()
        await detail.getByRole('radio', { name: '5 stars' }).click()
        await expect(detail.getByRole('button', { name: 'Connect to review' })).toBeVisible()
        await expect(detail.getByText(/1 review/)).toBeVisible()
        await detail.getByText('A clear onchain forum').scrollIntoViewIfNeeded()
        await expect(detail.getByText('A clear onchain forum')).toBeInViewport()
    })
}

const live = [
    { id: 1, pkgPath: 'gno.land/r/gnoswap/router', name: 'GnoSwap', tagline: '', category: 'Exchange', iconCID: '', appURL: 'https://gnoswap.io/', publisher: '', status: 'live', flagCount: 0, createdAt: 0 },
    { id: 2, pkgPath: 'gno.land/r/gnoland/boards2/v0', name: 'Boards', tagline: '', category: 'Community', iconCID: '', appURL: 'https://gno.land/r/gnoland/boards2/v0', publisher: '', status: 'live', flagCount: 0, createdAt: 0 },
]

test('registry failure does not present an onchain search as a complete empty result', async ({ page }) => {
    test.skip(process.env.OS_STORE_CHAIN !== 'true', 'run with OS_STORE_CHAIN=true and VITE_ENABLE_APPSTORE=true')
    await fulfillOnchainReads(page, ({ method }) => method === 'status' ? mockAppChainStatus('gnoland-1') : null)
    await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
    await page.goto(`${OS_ON}/os/store`)
    const store = page.getByRole('region', { name: 'App Store', exact: true })
    await store.getByRole('searchbox', { name: 'Search apps and tools' }).fill('Block Party')
    await store.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(store.getByText('Onchain listings could not be read. Independent projects remain available below.')).toBeVisible()
    await expect(store.getByText('No independent projects match these filters. Onchain results are unavailable; retry the registry above.')).toBeVisible()
    await expect(store.getByText('No projects match these filters. Try another search or clear them.')).toHaveCount(0)
})

test('detail RPC failure is not presented as an absent listing', async ({ page }) => {
    test.skip(process.env.OS_STORE_CHAIN !== 'true', 'run with OS_STORE_CHAIN=true and VITE_ENABLE_APPSTORE=true')
    await fulfillOnchainReads(page, ({ method, path, arg }) => {
        if (method === 'status') return mockAppChainStatus('gnoland-1')
        if (path === 'vm/qeval' && arg.includes('ListLiveJSON')) return `(${JSON.stringify(JSON.stringify(live))} string)`
        return null
    })
    await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
    await page.goto(`${OS_ON}/os/store`)
    const store = page.getByRole('region', { name: 'App Store', exact: true })
    await store.getByRole('button', { name: 'Details for Boards' }).click()
    const detail = page.getByRole('region', { name: 'App details · App Store' })
    await expect(detail.getByText('App details could not be read from the registry.')).toBeVisible()
    await expect(detail.getByText('This app was not found in the current catalogue.')).toHaveCount(0)
})

for (const [width, device] of [[1280, 'desktop'], [375, 'phone']] as const) {
    test(`flag-on Store shows one catalogue in the OS on ${device}`, async ({ page }) => {
        test.skip(process.env.OS_STORE_CHAIN !== 'true', 'run with OS_STORE_CHAIN=true and VITE_ENABLE_APPSTORE=true')
        await fulfillOnchainReads(page, ({ method, path, arg }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (path === 'vm/qeval' && arg.includes('ListLiveJSON')) return `(${JSON.stringify(JSON.stringify(live))} string)`
            if (path === 'vm/qeval' && arg.includes('GetListingJSON')) return `(${JSON.stringify(JSON.stringify({ ...live[1], descr: 'A public forum on Gno.' }))} string)`
            if (path === 'vm/qeval' && arg.includes('GetStatsJSON')) return `(${JSON.stringify(JSON.stringify({ live: 2, total: 2, registrationFee: 1000000, paused: false }))} string)`
            return null
        })
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.setViewportSize({ width, height: 800 })
        await page.goto(`${OS_ON}/os/store`)
        const store = page.getByRole('region', { name: 'App Store', exact: true })
        await expect(store.getByRole('button', { name: 'Details for GnoSwap' })).toHaveCount(1)
        await expect(store.getByRole('button', { name: 'Details for Boards' })).toHaveCount(1)
        await expect(store.getByRole('button', { name: 'Details for Bubble Rumble' })).toBeVisible()
        await expect(store.getByRole('button', { name: 'Details for Adena' })).toBeVisible()
        await store.getByRole('searchbox', { name: 'Search apps and tools' }).fill('boards')
        await store.getByRole('button', { name: 'Search', exact: true }).click()
        await expect(store.getByRole('button', { name: 'Details for Boards' })).toHaveCount(1)
        await expect(store.getByRole('button', { name: 'Details for GnoSwap' })).toHaveCount(0)
        await store.getByRole('button', { name: 'Details for Boards' }).click()
        const detail = page.getByRole('region', { name: 'App details · App Store' })
        await expect(detail.getByRole('heading', { name: 'Boards' })).toBeVisible()
        await expect(detail.getByText('A public forum on Gno.')).toBeVisible()
        await expect(detail.getByText('Curator approved listing')).toBeVisible()
        await expect(detail.getByRole('link', { name: 'Read realm source ↗' })).toHaveAttribute('href', 'https://gno.land/r/gnoland/boards2/v0$source')
    })
}
