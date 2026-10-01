import { expect, test } from '@playwright/test'
import { OS_FLAGS_ON, OS_ON } from '../../playwright.os.config'
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
        await page.goto(`${OS_FLAGS_ON}/os/store`)
        const store = page.getByRole('region', { name: 'App Store', exact: true })
        await store.getByRole('button', { name: 'Details for Boards' }).click()
        const detail = page.getByRole('region', { name: 'App details · App Store' })
        await expect(detail.getByRole('heading', { name: 'Reviews' })).toBeVisible()
        await expect(detail.getByText('A clear onchain forum')).toBeVisible()
        // A guest reads the list and what its actions cost; pressing an action asks for a wallet there, and none leaves the OS.
        await expect(detail.getByRole('button', { name: 'Like — 0', exact: true })).toBeEnabled()
        await expect(detail.getByRole('button', { name: 'Flag for moderation' })).toBeVisible()
        await expect(detail.getByText(/A first like or dislike on a review locks a storage deposit of up to 0\.22 GNOT/)).toBeVisible()
        await expect(detail.getByRole('link', { name: /Manage reviews/ })).toHaveCount(0)
        // Reporting the listing is offered to a guest too, with the rule that makes reports hide it.
        await expect(detail.getByText('Reports so far: 0. Reports from 5 different accounts hide a listing from the public lists until a curator clears them.')).toBeVisible()
        await expect(detail.getByRole('button', { name: 'Report this listing' })).toBeEnabled()
        await detail.getByRole('button', { name: 'Write a review' }).click()
        await expect(detail.getByRole('radiogroup', { name: 'Your rating' })).toBeVisible()
        await expect(detail.getByText('Select a rating to post.')).toBeVisible()
        await detail.getByRole('radio', { name: '5 stars' }).click()
        await detail.getByRole('textbox', { name: /Your review/ }).fill('Clear and useful')
        await expect(detail.getByRole('button', { name: 'Connect to review' })).toBeEnabled()
        // Connecting remounts every window; a reload remounts this one the same way.
        await page.reload()
        await expect(detail.getByRole('radio', { name: '5 stars' })).toBeChecked()
        await expect(detail.getByRole('textbox', { name: /Your review/ })).toHaveValue('Clear and useful')
        await expect(detail.getByText(/1 review/)).toBeVisible()
        await detail.getByText('A clear onchain forum').scrollIntoViewIfNeeded()
        await expect(detail.getByText('A clear onchain forum')).toBeInViewport()
    })
}

test('a visitor reads the curator queue, told which listings it cannot show', async ({ page }) => {
    const pending = { id: 9, pkgPath: 'gno.land/r/alice/garden', name: 'Garden', tagline: '', category: 'Games', iconCID: '', appURL: 'https://example.org/', publisher: 'g1alicexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', status: 'pending', rejectReason: '', paidResubmitCredit: false, resubmitCount: 1, flagCount: 2, createdAt: 452_990 }
    await fulfillOnchainReads(page, ({ method, path, arg }) => {
        if (method === 'status') return mockAppChainStatus('gnoland-1')
        if (path === 'vm/qeval' && arg.includes('ListLiveJSON')) return `(${JSON.stringify(JSON.stringify(live))} string)`
        if (path === 'vm/qeval' && arg.includes('GetStatsJSON')) return `(${JSON.stringify(JSON.stringify({ total: 4, live: 2, pending: 2, rejected: 0, delisted: 0, registrationFee: 1000000, paused: false }))} string)`
        if (path === 'vm/qeval' && arg.includes('GetCuratorsJSON')) return `(${JSON.stringify(JSON.stringify(['g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf']))} string)`
        if (path === 'vm/qeval' && arg.includes('ListByStatusJSON')) return `(${JSON.stringify(JSON.stringify([pending]))} string)`
        if (path === 'vm/qeval' && arg.includes('GetListingJSON')) return `(${JSON.stringify(JSON.stringify({ ...pending, descr: 'A shared garden.', screenshotCIDs: [] }))} string)`
        return null
    })
    await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
    await page.goto(`${OS_FLAGS_ON}/os/store`)
    const store = page.getByRole('region', { name: 'App Store', exact: true })
    await store.getByRole('navigation', { name: 'App Store' }).getByRole('button', { name: 'Curator queue' }).click()
    await expect(store.getByRole('heading', { name: 'Curator queue' })).toBeVisible()
    await expect(store.getByText('g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf')).toBeVisible()
    await expect(store.getByText('Listings with 5 or more reports are not listed here: the registry has no read that lists them. 1 pending listing is hidden this way now.')).toBeVisible()
    await expect(store.getByText('Reports: 2 · Edits used: 1 of 5')).toBeVisible()
    await expect(store.getByText('Connect a wallet to use App Store.')).toHaveCount(0)
    await store.getByRole('button', { name: 'Garden' }).click()
    const detail = page.getByRole('region', { name: 'App details · App Store' })
    await expect(detail.getByRole('heading', { name: 'Garden' })).toBeVisible()
    await expect(detail.getByText('Reports so far: 2.', { exact: false })).toBeVisible()
})

const live = [
    { id: 1, pkgPath: 'gno.land/r/gnoswap/router', name: 'GnoSwap', tagline: '', category: 'Exchange', iconCID: '', appURL: 'https://gnoswap.io/', publisher: '', status: 'live', flagCount: 0, createdAt: 0 },
    { id: 2, pkgPath: 'gno.land/r/gnoland/boards2/v0', name: 'Boards', tagline: '', category: 'Community', iconCID: '', appURL: 'https://gno.land/r/gnoland/boards2/v0', publisher: '', status: 'live', flagCount: 0, createdAt: 0 },
]

test('registry failure does not present an onchain search as a complete empty result', async ({ page }) => {
    await fulfillOnchainReads(page, ({ method }) => method === 'status' ? mockAppChainStatus('gnoland-1') : null)
    await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
    await page.goto(`${OS_FLAGS_ON}/os/store`)
    const store = page.getByRole('region', { name: 'App Store', exact: true })
    await store.getByRole('searchbox', { name: 'Search apps and tools' }).fill('Block Party')
    await store.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(store.getByText('Onchain listings could not be read. Independent projects remain available below.')).toBeVisible()
    await expect(store.getByText('No independent projects match these filters. Onchain results are unavailable; retry the registry above.')).toBeVisible()
    await expect(store.getByText('No projects match these filters. Try another search or clear them.')).toHaveCount(0)
})

test('detail RPC failure is not presented as an absent listing', async ({ page }) => {
    await fulfillOnchainReads(page, ({ method, path, arg }) => {
        if (method === 'status') return mockAppChainStatus('gnoland-1')
        if (path === 'vm/qeval' && arg.includes('ListLiveJSON')) return `(${JSON.stringify(JSON.stringify(live))} string)`
        return null
    })
    await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
    await page.goto(`${OS_FLAGS_ON}/os/store`)
    const store = page.getByRole('region', { name: 'App Store', exact: true })
    await store.getByRole('button', { name: 'Details for Boards' }).click()
    const detail = page.getByRole('region', { name: 'App details · App Store' })
    await expect(detail.getByText('App details could not be read from the registry.')).toBeVisible()
    await expect(detail.getByText('This app was not found in the current catalogue.')).toHaveCount(0)
})

for (const [width, device] of [[1280, 'desktop'], [375, 'phone']] as const) {
    test(`flag-on Store shows one catalogue in the OS on ${device}`, async ({ page }) => {
        await fulfillOnchainReads(page, ({ method, path, arg }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (path === 'vm/qeval' && arg.includes('ListLiveJSON')) return `(${JSON.stringify(JSON.stringify(live))} string)`
            if (path === 'vm/qeval' && arg.includes('GetListingJSON')) return `(${JSON.stringify(JSON.stringify({ ...live[1], descr: 'A public forum on Gno.' }))} string)`
            if (path === 'vm/qeval' && arg.includes('GetStatsJSON')) return `(${JSON.stringify(JSON.stringify({ live: 2, total: 2, registrationFee: 1000000, paused: false }))} string)`
            return null
        })
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.setViewportSize({ width, height: 800 })
        await page.goto(`${OS_FLAGS_ON}/os/store`)
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
