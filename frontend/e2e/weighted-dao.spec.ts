import { bech32Encode } from '../src/lib/dao/realmAddress'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { stubNetwork } from './helpers/stubNetwork'
import { suppressReleaseAnnouncement } from './helpers/releaseAnnouncement'
import { qevalWire, weightedFixture, weightedRealm } from '../src/lib/dao/testdata/weighted'
import { readFileSync } from 'node:fs'

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

// Host v12 (the mainnet governing DAO): verbatim native reads, no hand-built JSON.
const v12 = JSON.parse(readFileSync(new URL('../src/lib/dao/testdata/weighted-v12/native.json', import.meta.url), 'utf8')).records as Record<string, unknown>
async function routeV12(page: Page) {
    await page.route('**/status', route => route.fulfill({ json: { result: { node_info: { network: 'gnoland-1' } } } }))
    await page.route('**/abci_query?**', route => {
        const expression = Buffer.from(new URL(route.request().url()).searchParams.get('data')!.slice(2), 'hex').toString('utf8')
        const call = expression.slice(weightedRealm.length + 1)
        const value = call === 'GetConfigJSON()' ? v12.config : call === 'GetMembersJSON()' ? v12.members
            : call === 'GetProposalsJSON(0, 20)' ? v12.proposals_page_1 : call === 'GetProposalsJSON(7, 20)' ? v12.proposals_page_2 : v12[`proposal_${call.match(/^GetProposalJSON\((\d+)\)$/)?.[1]}`]
        if (value === undefined) return route.fulfill({ json: { result: { response: { ResponseBase: { Data: '', Error: { '@type': '/vm.UnauthorizedUserError' }, Log: `unexpected ${call}` } } } } })
        return route.fulfill({ json: { result: { response: { ResponseBase: { Data: Buffer.from(qevalWire(value)).toString('base64'), Error: null } } } } })
    })
}
for (const width of [1280, 390]) {
    test(`weighted DAO v12 adapters, categories and frozen state stay read-only at ${width}px`, async ({ page }, info) => {
        await stubNetwork(page)
        await routeV12(page)
        await page.setViewportSize({ width, height: 1100 })
        await suppressReleaseAnnouncement(page)
        await page.addInitScript(() => localStorage.setItem('memba_network', 'mainnet'))
        await page.goto(`/mainnet/weighted-dao/${weightedRealm}`)
        const workspace = page.locator('.weighted-dao')
        await expect(workspace.getByRole('heading', { name: 'Application adapters' })).toBeVisible()
        await expect(workspace.getByRole('listitem', { name: /adapter$/ })).toHaveCount(10)
        await expect(workspace.getByText('Mainnet governance is read-only while launch verification is unfinished.')).toBeVisible()
        const fee = workspace.getByRole('article', { name: 'Proposal 17' })
        await expect(fee.getByRole('heading', { name: 'Market config · set-fee' })).toBeVisible()
        await expect(fee.getByText('Financial', { exact: true })).toBeVisible()
        await expect(fee.getByRole('note')).toContainText('invalidates every other outstanding proposal')
        await fee.getByText('State frozen at proposal time').click()
        await expect(fee.getByText('pendingAdmin')).toBeVisible()
        await expect(workspace.getByRole('article', { name: 'Proposal 18' }).getByText('Routine', { exact: true })).toBeVisible()
        for (const button of await workspace.getByRole('button', { name: /^(Vote .*|Execute proposal)$/ }).all()) await expect(button).toBeDisabled()
        expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
        expect((await new AxeBuilder({ page }).include('.weighted-dao').analyze()).violations).toEqual([])
        await expect(workspace.getByText('Reading governance state…')).toHaveCount(0)
        await page.screenshot({ path: info.outputPath(`weighted-dao-v12-${width}.png`), fullPage: true, animations: 'disabled' })
        await workspace.getByRole('button', { name: 'Older proposals' }).click()
        const invalidated = workspace.getByRole('article', { name: 'Proposal 2' })
        await expect(invalidated.getByText(/another proposal executed, or an emergency pause ran/)).toBeVisible()
        await expect(workspace.getByRole('article', { name: 'Proposal 1' }).getByText('EXECUTED')).toBeVisible()
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
