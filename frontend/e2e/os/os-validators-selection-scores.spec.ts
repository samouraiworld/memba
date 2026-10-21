import { expect, test, type Page } from '@playwright/test'
import { OS_LOCAL } from '../../playwright.os.config'
import { fulfillOnchainReads, mockAppChainStatus } from '../helpers/onchain'

// The dev-only local network (VITE_ENABLE_LOCAL_NETWORK) is the one network with the
// selection scores realm before its mainnet deploy. This spec stands in for gnodev at
// http://localhost:26657: the valopers registry and the realm's LatestJSON().
const LOCAL_RPC = /^http:\/\/localhost:26657(\/|$)/
const address = (c: string) => `g1${c.repeat(38)}`
const VALIDATOR = address('a')
const ORCA = { moniker: 'Orca', operator: address('c'), signing: address('d') }
const PIKE = { moniker: 'Pike', operator: address('e'), signing: address('f') }
const ACME = { moniker: 'Acme', operator: address('g'), signing: address('h') }
const OPERATORS = [ORCA, PIKE, ACME]
const EDITION = {
    number: 1, computedAt: '2026-10-13T09:00:00Z', scorecardSHA256: 'ab'.repeat(32),
    arenas: ['challenge', 'test13', 'topaz', 'sapphire', 'pearl', 'firedrill'],
    candidates: [
        { operator: PIKE.operator, moniker: 'Pike', total: 9120, rank: 1, github: 150, arenaScores: [9500, 9000, 9100, 9200, 9000, 8900] },
        { operator: ORCA.operator, moniker: 'Orca', total: 8743, rank: 3, github: 230, arenaScores: [9000, 8500, 8000, 9100, 8800, 7500] },
    ],
}
/** base64("gno.land/r/samcrew/validator_scores.LatestJSON()"): the qeval request body carries it. */
const LATEST_JSON_B64 = 'Z25vLmxhbmQvci9zYW1jcmV3L3ZhbGlkYXRvcl9zY29yZXMuTGF0ZXN0SlNPTigp'
/** What vm/qeval prints for a realm function returning this value as JSON text. */
const qeval = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`
const LIST = OPERATORS.map(o => `* [${o.moniker}](/r/gnops/valopers:${o.operator})`).join('\n')
const detail = (o: typeof ORCA) => [
    `## ${o.moniker}`, '', 'Test operator.', '',
    `- Operator Address: ${o.operator}`, `- Signing Address: ${o.signing}`, '- Signing PubKey: gpub1test', '- Server Type: cloud',
].join('\n')

async function fixture(page: Page, windowWidth: number) {
    await page.route('**/*', route => {
        const host = new URL(route.request().url()).hostname
        return host === '127.0.0.1' ? route.continue() : route.abort()
    })
    const now = Date.now()
    await fulfillOnchainReads(page, ({ method, path, arg }) => {
        if (method === 'status') return { ...mockAppChainStatus('dev'), sync_info: { latest_block_height: '120', latest_block_time: new Date(now).toISOString(), catching_up: false } }
        if (method === 'validators') return { block_height: '120', validators: [{ address: VALIDATOR, pub_key: { '@type': '/tm.PubKeyEd25519', value: 'bW9ja3B1YmtleTAwMDAwMDAwMDAwMDAwMDAwMDAx=' }, voting_power: '10', proposer_priority: '0' }] }
        if (method === 'block') return { block: { header: { chain_id: 'dev', height: '119', time: new Date(now - 5_000).toISOString() }, last_commit: { precommits: [] } } }
        if (method !== 'abci_query') return null
        if (path === 'vm/qeval' && arg === 'gno.land/r/samcrew/validator_scores.LatestJSON()') return qeval(EDITION)
        if (path !== 'vm/qrender') return null
        if (arg === 'gno.land/r/gnops/valopers:') return LIST
        const operator = OPERATORS.find(o => arg === `gno.land/r/gnops/valopers:${o.operator}`)
        return operator ? detail(operator) : null
    }, [LOCAL_RPC])
    await page.addInitScript(width => {
        localStorage.setItem('memba_network_pref', 'local')
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_os_windows:guest:dev', JSON.stringify([
            { token: 'app.validators', x: 40, y: 20, width, height: 640, z: 1, min: false, max: false },
        ]))
    }, windowWidth)
    await page.setViewportSize({ width: 1280, height: 800 })
}

async function openCandidates(page: Page) {
    await page.goto(`${OS_LOCAL}/os/validators`)
    const win = page.getByRole('region', { name: 'Validators', exact: true })
    await win.getByRole('group', { name: 'Validator lists' }).getByRole('button', { name: 'Candidates' }).click()
    return win
}

test('Candidates show the published selection score, sorted by score then name, with a dash for an operator without one', async ({ page }) => {
    await fixture(page, 960)
    const win = await openCandidates(page)
    await expect(win.getByRole('columnheader')).toHaveText(['Operator', 'Score', 'Hosting', 'Operator address'])
    await expect(win.getByRole('button', { name: /^Open operator / })).toHaveText(['Pike', 'Orca', 'Acme'])
    await expect(win.locator('tr', { hasText: 'Pike' })).toContainText('91.2 · #1')
    await expect(win.locator('tr', { hasText: 'Orca' })).toContainText('87.4 · #3')
    const acme = win.locator('tr', { hasText: 'Acme' })
    await expect(acme).toContainText('—')
    await expect(acme).not.toContainText('·')
    await expect(win.getByText(/edition 1, 13 Oct 2026/)).toBeVisible()
})

test('A 360 px window keeps the operator, its score and hosting, and fits', async ({ page }) => {
    await fixture(page, 360)
    const win = await openCandidates(page)
    await expect(win.getByRole('button', { name: 'Open operator Orca' })).toBeVisible()
    await expect(win.getByRole('columnheader')).toHaveText(['Operator', 'Score', 'Hosting'])
    const fit = await page.locator('.os-wbody').first().evaluate(body => {
        const edge = body.getBoundingClientRect().right
        return {
            spill: body.scrollWidth - body.clientWidth,
            table: [...body.querySelectorAll('.os-t')].every(el => el.getBoundingClientRect().right <= edge + 1),
        }
    })
    expect(fit.spill).toBeLessThanOrEqual(1)
    expect(fit.table).toBe(true)
})

test('A scored operator\'s page shows the Selection score (testnets) card; an operator without an entry shows none', async ({ page }) => {
    await fixture(page, 960)
    await page.goto(`${OS_LOCAL}/os/validators/${ORCA.operator}`)
    const win = page.getByRole('region', { name: 'Validators', exact: true })
    const profile = win.getByTestId('validator-profile-page')
    const card = profile.getByRole('region', { name: 'Selection score (testnets)' })
    await expect(card).toContainText('Edition 1 · computed 13 Oct 2026')
    await expect(card).toContainText('87.4')
    await expect(card).toContainText('#3')
    await expect(card).toContainText('Fire drill')
    await expect(card.getByRole('link', { name: 'View the on-chain record ↗' })).toHaveAttribute('href', 'http://localhost:8888/r/samcrew/validator_scores')

    // Wait for the scores read to be answered, so the absence below is not just "not loaded yet".
    const scoresRead = page.waitForResponse(response => LOCAL_RPC.test(response.url()) && (response.request().postData() ?? '').includes(LATEST_JSON_B64))
    await page.goto(`${OS_LOCAL}/os/validators/${ACME.operator}`)
    await expect(profile.getByRole('heading', { name: 'Acme' })).toBeVisible()
    await scoresRead
    await expect(profile.getByRole('region', { name: 'Selection score (testnets)' })).toHaveCount(0)
})
