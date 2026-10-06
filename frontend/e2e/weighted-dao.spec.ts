import { bech32Encode } from '../src/lib/dao/realmAddress'
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { stubNetwork } from './helpers/stubNetwork'
import { suppressReleaseAnnouncement } from './helpers/releaseAnnouncement'
import { MAINNET, TEST13, V12_READ_ONLY, memberWallet, routeV12, v12 } from './helpers/weightedV12Fixture'
import { qevalWire, weightedFixture, weightedRealm } from '../src/lib/dao/testdata/weighted'

for (const version of [1, 2] as const) for (const width of [1280, 390]) {
    test(`weighted DAO v${version} reads remain clear at ${width}px`, async ({ page }, info) => {
        await stubNetwork(page)
        const fixture = weightedFixture(version)
        if (version === 2) fixture.proposal.action = { type: 'recover-member', personId: fixture.members[1].personId, oldAddress: fixture.members[1].address, newAddress: bech32Encode('g', new Uint8Array(20).fill(9)) }
        await page.route('**/status', route => route.fulfill({ json: { result: { node_info: { network: 'gnoland-1' } } } }))
        await page.route('**/abci_query?**', route => {
            const expression = Buffer.from(new URL(route.request().url()).searchParams.get('data')!.slice(2), 'hex').toString('utf8')
            const value = expression.includes('GetConfigJSON') ? fixture.config : expression.includes('GetMembersJSON') ? fixture.roster : fixture.page
            return route.fulfill({ json: { result: { response: { ResponseBase: { Data: Buffer.from(qevalWire(value)).toString('base64'), Error: null } } } } })
        })
        await page.setViewportSize({ width, height: 1100 })
        await suppressReleaseAnnouncement(page)
        await page.addInitScript(() => localStorage.setItem('memba_network', 'mainnet'))
        await page.goto(`/mainnet/weighted-dao/${weightedRealm}`)
        const workspace = page.locator('.weighted-dao')
        await expect(workspace.getByText('Founder · 2 points')).toBeVisible()
        await expect(workspace.getByText('Core developer · 1 point')).toHaveCount(6)
        await expect(workspace.getByText(`${version === 1 ? 'Target' : 'Old address'}: ${fixture.members[1].address}`)).toBeVisible()
        await expect(workspace.getByRole('button', { name: 'Review key recovery proposal' })).toHaveCount(version === 2 ? 1 : 0)
        await expect(workspace.getByRole('button', { name: 'Execute proposal' })).toBeDisabled()
        await expect(workspace.getByRole('button', { name: 'Vote yes' })).toBeDisabled()
        await expect(workspace.getByText('6 points and at least 4 people, then 24 hours')).toBeVisible()
        await expect(workspace.getByText('5 developers, then 72 hours')).toBeVisible()
        expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
        expect((await new AxeBuilder({ page }).include('.weighted-dao').analyze()).violations).toEqual([])
        // Auth/wallet initialization can remount the scoped workspace while
        // axe runs. Capture only after that replacement read has settled.
        await expect(workspace.getByText('Founder · 2 points')).toBeVisible()
        await expect(workspace.getByText('Reading governance state…')).toHaveCount(0)
        await page.screenshot({ path: info.outputPath(`weighted-dao-v${version}-${width}.png`), fullPage: true, animations: 'disabled' })
    })
}
test('malformed weighted contract never falls back to legacy role controls', async ({ page }) => {
    await stubNetwork(page)
    await page.route('**/status', route => route.fulfill({ json: { result: { node_info: { network: 'gnoland-1' } } } }))
    await page.route('**/abci_query?**', route => route.fulfill({ json: { result: { response: { ResponseBase: { Data: Buffer.from(qevalWire({ schema: 'unknown', kind: 'config' })).toString('base64'), Error: null } } } } }))
    await page.goto(`/mainnet/weighted-dao/${weightedRealm}`)
    await expect(page.locator('.weighted-dao [role=alert]')).toBeVisible()
    await expect(page.locator('.weighted-dao').getByRole('button', { name: 'Review role proposal' })).toHaveCount(0)
})

for (const width of [1280, 390]) {
    test(`weighted DAO v12 adapters, categories and frozen state stay read-only without a member wallet at ${width}px`, async ({ page }, info) => {
        await stubNetwork(page)
        await routeV12(page)
        await page.setViewportSize({ width, height: 1100 })
        await suppressReleaseAnnouncement(page)
        await page.addInitScript(() => localStorage.setItem('memba_network', 'mainnet'))
        await page.goto(`/mainnet/weighted-dao/${weightedRealm}`)
        const workspace = page.locator('.weighted-dao')
        await expect(workspace.getByRole('heading', { name: 'Application adapters' })).toBeVisible()
        await expect(workspace.getByRole('listitem', { name: /adapter$/ })).toHaveCount(10)
        // Memba DAO v12 is read-only in Memba: one sentence says so, in place of the network hold.
        await expect(workspace.getByText(V12_READ_ONLY)).toBeVisible()
        await expect(workspace.getByText(/Memba builds no governance transaction/)).toHaveCount(0)
        const market = workspace.getByRole('listitem', { name: 'marketPolicy adapter' })
        await expect(market.getByText('Ready to accept')).toBeVisible()
        await expect(market.getByRole('button')).toHaveCount(0)
        await expect(workspace.getByRole('listitem', { name: 'escrowPolicy adapter' }).getByText('DAO controls', { exact: true })).toBeVisible()
        const fee = workspace.getByRole('article', { name: 'Proposal 17' })
        await expect(fee.getByRole('heading', { name: 'Market config · Set a fee' })).toBeVisible()
        await expect(fee.getByText('Financial', { exact: true })).toBeVisible()
        await expect(fee.getByRole('note')).toContainText('invalidates every other outstanding proposal')
        await fee.getByText('State frozen at proposal time').click()
        await expect(fee.getByText('Pending admin')).toBeVisible()
        await expect(workspace.getByRole('article', { name: 'Proposal 18' }).getByText('Routine', { exact: true })).toBeVisible()
        await expect(workspace.getByRole('button', { name: /^(Vote .*|Execute proposal|Propose acceptance|Review .*)$/ })).toHaveCount(0)
        expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
        expect((await new AxeBuilder({ page }).include('.weighted-dao').analyze()).violations).toEqual([])
        await expect(workspace.getByText('Reading governance state…')).toHaveCount(0)
        await page.screenshot({ path: info.outputPath(`weighted-dao-v12-${width}.png`), fullPage: true, animations: 'disabled' })
        await workspace.getByRole('button', { name: 'Older proposals' }).click()
        const invalidated = workspace.getByRole('article', { name: 'Proposal 2' })
        await expect(invalidated.getByText(/^Invalidated at block \d+: proposal #4 executed \(gno\.land\/r\/samcrew\/memba_market_config\)\.$/)).toBeVisible()
        await expect(workspace.getByRole('article', { name: 'Proposal 1' }).getByText('Executed', { exact: true })).toBeVisible()
    })
}
test('unknown weighted host versions are refused, not rendered as an older contract', async ({ page }) => {
    await stubNetwork(page)
    await page.route('**/status', route => route.fulfill({ json: { result: { node_info: { network: 'gnoland-1' } } } }))
    await page.route('**/abci_query?**', route => {
        const expression = Buffer.from(new URL(route.request().url()).searchParams.get('data')!.slice(2), 'hex').toString('utf8')
        const bump = (value: unknown) => ({ ...(value as object), schema: 'memba-weighted-host/v13' })
        const value = expression.includes('GetConfigJSON') ? bump(v12.config) : expression.includes('GetMembersJSON') ? bump(v12.members) : bump(v12.proposals_page_1)
        return route.fulfill({ json: { result: { response: { ResponseBase: { Data: Buffer.from(qevalWire(value)).toString('base64'), Error: null } } } } })
    })
    await page.goto(`/mainnet/weighted-dao/${weightedRealm}`)
    await expect(page.locator('.weighted-dao [role=alert]')).toBeVisible()
    await expect(page.locator('.weighted-dao').getByRole('heading', { name: 'Application adapters' })).toHaveCount(0)
    await expect(page.locator('.weighted-dao').getByRole('article')).toHaveCount(0)
})
test('one mis-encoded weighted proposal is listed as unreadable without hiding the rest', async ({ page }) => {
    await stubNetwork(page)
    await routeV12(page)
    const firstPage = structuredClone(v12.proposals_page_1) as { proposals: { action: Record<string, unknown> }[] }
    firstPage.proposals[3].action.operation = 'grant-everything'
    await page.route('**/abci_query?**', async route => {
        const expression = Buffer.from(new URL(route.request().url()).searchParams.get('data')!.slice(2), 'hex').toString('utf8')
        if (!expression.endsWith('GetProposalsJSON(0, 20)')) return route.fallback()
        return route.fulfill({ json: { result: { response: { ResponseBase: { Data: Buffer.from(qevalWire(firstPage)).toString('base64'), Error: null } } } } })
    })
    await page.goto(`/mainnet/weighted-dao/${weightedRealm}`)
    const workspace = page.locator('.weighted-dao')
    await expect(workspace.getByRole('heading', { name: 'Unreadable proposal #23' })).toBeVisible()
    await expect(workspace.getByRole('article')).toHaveCount(20)
    await expect(workspace.getByRole('heading', { name: 'Market config · Set a fee' })).toBeVisible()
})

for (const [where, wallet] of [['a test network', TEST13], ['mainnet', MAINNET]] as const) {
    test(`weighted DAO v12 on ${where} offers a connected member nothing to sign`, async ({ page }, info) => {
        await stubNetwork(page)
        await routeV12(page, wallet.chainId)
        await memberWallet(page, wallet)
        await suppressReleaseAnnouncement(page)
        await page.goto(`/${wallet.network}/weighted-dao/${weightedRealm}`)
        const workspace = page.locator('.weighted-dao')
        const market = workspace.getByRole('listitem', { name: 'marketPolicy adapter' })
        await expect(market.getByText('Ready to accept')).toBeVisible()
        // The member is recognised (their ballots are read) and is still offered no proposal, vote or execution.
        await expect(workspace.getByRole('article', { name: 'Proposal 17' }).getByText('You have not voted.')).toBeVisible()
        await expect(workspace.getByText(V12_READ_ONLY)).toBeVisible()
        await expect(workspace.getByRole('button', { name: /^(Propose acceptance|Vote .*|Execute proposal|Review .*)$/ })).toHaveCount(0)
        await expect(workspace.getByRole('combobox')).toHaveCount(0)
        expect((await new AxeBuilder({ page }).include('.weighted-dao').analyze()).violations).toEqual([])
        expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
        await page.screenshot({ path: info.outputPath(`weighted-dao-v12-read-only-${wallet.network}.png`), animations: 'disabled' })
        expect(await page.evaluate(() => (window as unknown as { __signRequests: unknown[] }).__signRequests)).toHaveLength(0)
    })
}
