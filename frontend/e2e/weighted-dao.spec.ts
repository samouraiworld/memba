import { bech32Encode } from '../src/lib/dao/realmAddress'
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { stubNetwork } from './helpers/stubNetwork'
import { suppressReleaseAnnouncement } from './helpers/releaseAnnouncement'
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
