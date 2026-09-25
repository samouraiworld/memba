import { bech32Encode } from '../src/lib/dao/realmAddress'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { stubNetwork } from './helpers/stubNetwork'
import { suppressReleaseAnnouncement } from './helpers/releaseAnnouncement'
import { qevalWire, weightedFixture, weightedRealm } from '../src/lib/dao/testdata/weighted'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

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
// The DAO's own package address, and each adapter target's authority getters (see weightedAcceptance.ts).
const DAO = bech32Encode('g', new Uint8Array(createHash('sha256').update(`pkgPath:${weightedRealm}`).digest().subarray(0, 20)))
const PUBLISHER = (v12.config as { marketPolicy: { successor: string } }).marketPolicy.successor
const AUTHORITY: Record<string, [string, string, 'address' | 'string']> = {
    'gno.land/r/samcrew/memba_market_config': ['GetAdmin', 'GetPendingAdmin', 'address'],
    'gno.land/r/samcrew/memba_reviews_v2': ['GetModerator', 'GetPendingModerator', 'string'],
    'gno.land/r/samcrew/memba_quest_attestation_v1': ['GetOwner', 'GetPendingOwner', 'string'],
    'gno.land/r/samcrew/memba_arcade_leaderboard_v1': ['GetOwner', 'GetPendingOwner', 'address'],
    'gno.land/r/samcrew/memba_appstore_v3': ['GetOwner', 'GetPendingOwner', 'address'],
    'gno.land/r/samcrew/escrow_v4': ['GetAdmin', 'GetPendingAdmin', 'string'],
    'gno.land/r/samcrew/gnobuilders_badges_v2': ['GetOwner', 'GetPendingOwner', 'address'],
    'gno.land/r/samcrew/memba_feed_v1': ['GetOwner', 'GetPendingOwner', 'address'],
    'gno.land/r/samcrew/memba_dao_channels_v2': ['GetOwner', 'GetPendingOwner', 'address'],
    'gno.land/r/samcrew/memba_feedback_v2': ['GetOwner', 'GetPendingOwner', 'address'],
}
/** Target authority on the fake chain: the market-config admin is nominated to the DAO; the DAO already controls the rest. */
function targetRead(expression: string): string | undefined {
    const realm = Object.keys(AUTHORITY).find(path => expression.startsWith(`${path}.`))
    if (!realm) return undefined
    const [current, pending, type] = AUTHORITY[realm]
    const nominated = realm.endsWith('/memba_market_config')
    const value = expression === `${realm}.${current}()` ? (nominated ? PUBLISHER : DAO) : expression === `${realm}.${pending}()` ? (nominated ? DAO : '') : undefined
    if (value === undefined) return undefined
    return type === 'string' ? `(${JSON.stringify(value)} string)` : value ? `(${JSON.stringify(value)} .uverse.address)` : '( .uverse.address)'
}
async function routeV12(page: Page, network = 'gnoland-1', realmPath = weightedRealm) {
    await page.route('**/status', route => route.fulfill({ json: { result: { node_info: { network } } } }))
    await page.route('**/abci_query?**', route => {
        const params = new URL(route.request().url()).searchParams
        const expression = params.get('path') === '"vm/qeval"' ? Buffer.from(params.get('data')!.slice(2), 'hex').toString('utf8') : ''
        const target = targetRead(expression)
        if (target) return route.fulfill({ json: { result: { response: { ResponseBase: { Data: Buffer.from(target).toString('base64'), Error: null } } } } })
        if (!expression.startsWith(`${realmPath}.`)) return route.fulfill({ json: { result: { response: { ResponseBase: { Data: '', Error: { '@type': '/vm.UnauthorizedUserError' }, Log: `unexpected ${expression}` } } } } })
        const call = expression.slice(realmPath.length + 1)
        const ballot = call.match(/^GetBallotJSON\("(\d+)", "(g1[0-9a-z]{38})"\)$/)
        const value = call === 'GetConfigJSON()' ? { ...(v12.config as object), realmPath } : call === 'GetMembersJSON()' ? v12.members
            : call === 'GetProposalsJSON(0, 20)' ? v12.proposals_page_1 : call === 'GetProposalsJSON(7, 20)' ? v12.proposals_page_2
            : ballot ? { schema: 'memba-weighted-host/v12', proposalId: ballot[1], voter: ballot[2], eligible: true, choice: null, votedAtHeight: null }
            : v12[`proposal_${call.match(/^GetProposalJSON\((\d+)\)$/)?.[1]}`]
        if (value === undefined) return route.fulfill({ json: { result: { response: { ResponseBase: { Data: '', Error: { '@type': '/vm.UnauthorizedUserError' }, Log: `unexpected ${call}` } } } } })
        return route.fulfill({ json: { result: { response: { ResponseBase: { Data: Buffer.from(qevalWire(value)).toString('base64'), Error: null } } } } })
    })
}
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
        // memba_dao is released from the gnoland-1 hold: what disables the controls is the missing member wallet.
        await expect(workspace.getByText('Mainnet governance is read-only for this DAO in Memba.')).toHaveCount(0)
        await expect(workspace.getByText('Acceptance proposals stay disabled on mainnet until the governance write hold is lifted.')).toHaveCount(0)
        const market = workspace.getByRole('listitem', { name: 'marketPolicy adapter' })
        await expect(market.getByText('Ready to accept')).toBeVisible()
        await expect(market.getByText('Proposing requires a connected, authenticated member on the selected network.')).toBeVisible()
        await expect(market.getByRole('button', { name: 'Propose acceptance' })).toBeDisabled()
        await expect(workspace.getByRole('listitem', { name: 'escrowPolicy adapter' }).getByText('DAO controls')).toBeVisible()
        const fee = workspace.getByRole('article', { name: 'Proposal 17' })
        await expect(fee.getByRole('heading', { name: 'Market config · set-fee' })).toBeVisible()
        await expect(fee.getByText('Financial', { exact: true })).toBeVisible()
        await expect(fee.getByRole('note')).toContainText('invalidates every other outstanding proposal')
        await fee.getByText('State frozen at proposal time').click()
        await expect(fee.getByText('pendingAdmin')).toBeVisible()
        await expect(workspace.getByRole('article', { name: 'Proposal 18' }).getByText('Routine', { exact: true })).toBeVisible()
        for (const button of await workspace.getByRole('button', { name: /^(Vote .*|Execute proposal|Propose acceptance)$/ }).all()) await expect(button).toBeDisabled()
        expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
        expect((await new AxeBuilder({ page }).include('.weighted-dao').analyze()).violations).toEqual([])
        await expect(workspace.getByText('Reading governance state…')).toHaveCount(0)
        await page.screenshot({ path: info.outputPath(`weighted-dao-v12-${width}.png`), fullPage: true, animations: 'disabled' })
        await workspace.getByRole('button', { name: 'Older proposals' }).click()
        const invalidated = workspace.getByRole('article', { name: 'Proposal 2' })
        await expect(invalidated.getByText(/^Invalidated at block \d+: proposal #4 executed \(gno\.land\/r\/samcrew\/memba_market_config\)\.$/)).toBeVisible()
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
    await expect(workspace.getByRole('heading', { name: 'Market config · set-fee' })).toBeVisible()
})

// A member's wallet on a non-mainnet network (test13: hidden but resolvable).
// The wallet records what it is asked to sign and never reaches a chain.
const MEMBER = (v12.members as { members: { address: string }[] }).members[1].address
const TEST13 = { network: 'test13', chainId: 'test-13', rpcUrl: 'https://rpc.test13.testnets.gno.land:443' }
async function memberWallet(page: Page, where = TEST13) {
    await page.addInitScript(({ address, network, chainId, rpcUrl }) => {
        localStorage.setItem('memba_network', network)
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'e2e', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId, serverSignature: 'invalid-test-only' }))
        localStorage.setItem(`memba_wizard_seen_${address}`, '1')
        const w = window as unknown as { __signRequests: unknown[] }
        w.__signRequests = []
        const reject = async () => { throw new Error('e2e wallet: not available') }
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '100000000ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '1', sequence: '0', chainId } }),
            GetNetwork: async () => ({ data: { chainId, rpcUrl } }),
            On: () => () => {},
            DoContract: async (request: unknown) => { w.__signRequests.push(request); return { status: 'success', data: { hash: 'ab'.repeat(32) } } },
            Sign: reject, SignTx: reject, AddEstablish: reject,
        } })
    }, { address: MEMBER, ...where })
}
test('weighted DAO v12 on a test network proposes an adapter acceptance with its exact deposit cap', async ({ page }, info) => {
    await stubNetwork(page)
    await routeV12(page, 'test-13')
    await memberWallet(page)
    await suppressReleaseAnnouncement(page)
    await page.goto(`/test13/weighted-dao/${weightedRealm}`)
    const workspace = page.locator('.weighted-dao')
    await expect(workspace.getByText('Mainnet governance is read-only for this DAO in Memba.')).toHaveCount(0)
    const market = workspace.getByRole('listitem', { name: 'marketPolicy adapter' })
    await expect(market.getByText('Ready to accept')).toBeVisible()
    await expect(market.getByText('The proposal locks up to 2.13 GNOT of storage deposit from the proposer.')).toBeVisible()
    // Handoff order: market config is number 1 and, the others being DAO-controlled here, the next one.
    await expect(market.getByText(/^Handoff 1 of 10/)).toBeVisible()
    await expect(workspace.getByText('Next recommended')).toHaveCount(1)
    await expect(market.getByText('Next recommended')).toBeVisible()
    await expect(workspace.getByRole('listitem', { name: /adapter$/ }).last()).toHaveAttribute('aria-label', 'escrowPolicy adapter')
    await expect(workspace.getByText('At least 4 people with 6 points vote yes, then 24 hours pass. Or 5 core developers vote yes, then 72 hours pass.')).toBeVisible()
    await expect(workspace.getByRole('listitem', { name: 'questPolicy adapter' }).getByText('DAO controls')).toBeVisible()
    await expect(workspace.getByRole('listitem', { name: 'questPolicy adapter' }).getByRole('button')).toHaveCount(0)
    // Role and recovery proposals stay unavailable for this contract version.
    await expect(workspace.getByRole('button', { name: 'Review role proposal' })).toBeDisabled()
    const propose = market.getByRole('button', { name: 'Propose acceptance' })
    await expect(propose).toBeEnabled()
    expect((await new AxeBuilder({ page }).include('.weighted-dao').analyze()).violations).toEqual([])
    expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await market.screenshot({ path: info.outputPath('weighted-dao-v12-acceptance.png'), animations: 'disabled' })
    await propose.click()
    const dialog = page.getByRole('dialog', { name: 'Confirm transaction' })
    await expect(dialog.getByText('ProposeMarketAccept', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Storage deposit cap')).toBeVisible()
    await expect(dialog.getByText('2.13 GNOT', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('weighted-dao-v12-acceptance-confirm.png'), animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Confirm & Broadcast' }).click()
    await expect(workspace.getByText(/^Transaction submitted: (ab){32}\./)).toBeVisible()
    const requests = await page.evaluate(() => (window as unknown as { __signRequests: unknown[] }).__signRequests)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ gasWanted: 24_000_000, messages: [{ type: '/vm.m_call', value: { caller: MEMBER, send: '', pkg_path: weightedRealm, func: 'ProposeMarketAccept', args: [], max_deposit: '2130000ugnot' } }] })
})
test('weighted DAO v12 on a test network warns before an execution invalidates open proposals', async ({ page }, info) => {
    await stubNetwork(page)
    await routeV12(page, 'test-13')
    await memberWallet(page)
    await suppressReleaseAnnouncement(page)
    await page.goto(`/test13/weighted-dao/${weightedRealm}`)
    const fee = page.locator('.weighted-dao').getByRole('article', { name: 'Proposal 17' })
    await expect(fee.getByRole('button', { name: 'Vote yes' })).toBeEnabled()
    await fee.getByRole('button', { name: 'Execute proposal' }).click()
    const confirm = fee.getByRole('group', { name: 'Confirm execution of proposal 17' })
    await expect(confirm.getByText(/^Executing #17 invalidates \d+ open proposals #\d+(, #\d+)*\./)).toBeVisible()
    await fee.screenshot({ path: info.outputPath('weighted-dao-v12-execute-warning.png'), animations: 'disabled' })
    await confirm.getByRole('button', { name: 'Keep proposals open' }).click()
    await expect(confirm).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __signRequests: unknown[] }).__signRequests)).toHaveLength(0)
})
const MAINNET = { network: 'mainnet', chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land:443' }
test('weighted DAO v12 on mainnet lets a member of the released governing DAO propose an acceptance with its exact deposit cap', async ({ page }) => {
    await stubNetwork(page)
    await routeV12(page, 'gnoland-1')
    await memberWallet(page, MAINNET)
    await suppressReleaseAnnouncement(page)
    await page.goto(`/mainnet/weighted-dao/${weightedRealm}`)
    const workspace = page.locator('.weighted-dao')
    const market = workspace.getByRole('listitem', { name: 'marketPolicy adapter' })
    await expect(market.getByText('Ready to accept')).toBeVisible()
    await expect(workspace.getByText('Mainnet governance is read-only for this DAO in Memba.')).toHaveCount(0)
    await expect(workspace.getByRole('article', { name: 'Proposal 17' }).getByRole('button', { name: 'Vote yes' })).toBeEnabled()
    // Role and recovery proposals stay unavailable for this contract version, released or not.
    await expect(workspace.getByRole('button', { name: 'Review role proposal' })).toBeDisabled()
    const propose = market.getByRole('button', { name: 'Propose acceptance' })
    await expect(propose).toBeEnabled()
    await propose.click()
    const dialog = page.getByRole('dialog', { name: 'Confirm transaction' })
    await expect(dialog.getByText('ProposeMarketAccept', { exact: true })).toBeVisible()
    await expect(dialog.getByText('2.13 GNOT', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Confirm & Broadcast' }).click()
    await expect(workspace.getByText(/^Transaction submitted: (ab){32}\./)).toBeVisible()
    const requests = await page.evaluate(() => (window as unknown as { __signRequests: unknown[] }).__signRequests)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ gasWanted: 24_000_000, messages: [{ type: '/vm.m_call', value: { caller: MEMBER, send: '', pkg_path: 'gno.land/r/samcrew/memba_dao', func: 'ProposeMarketAccept', args: [], max_deposit: '2130000ugnot' } }] })
})
test('weighted DAO v12 on mainnet keeps every control of an unreleased DAO disabled for a connected, authenticated member', async ({ page }) => {
    const unreleased = 'gno.land/r/samcrew/memba_dao_v2'
    await stubNetwork(page)
    await routeV12(page, 'gnoland-1', unreleased)
    await memberWallet(page, MAINNET)
    await suppressReleaseAnnouncement(page)
    await page.goto(`/mainnet/weighted-dao/${unreleased}`)
    const workspace = page.locator('.weighted-dao')
    await expect(workspace.getByText('Mainnet governance is read-only for this DAO in Memba.')).toBeVisible()
    await expect(workspace.getByText('Acceptance proposals stay disabled on mainnet until the governance write hold is lifted.')).toBeVisible()
    // The member is recognised (ballots are read) and still cannot act.
    await expect(workspace.getByRole('article', { name: 'Proposal 17' }).getByText('You have not voted.')).toBeVisible()
    const controls = await workspace.getByRole('button', { name: /^(Propose acceptance|Vote .*|Execute proposal|Review role proposal)$/ }).all()
    expect(controls.length).toBeGreaterThan(20)
    for (const button of controls) await expect(button).toBeDisabled()
    expect(await page.evaluate(() => (window as unknown as { __signRequests: unknown[] }).__signRequests)).toHaveLength(0)
})
