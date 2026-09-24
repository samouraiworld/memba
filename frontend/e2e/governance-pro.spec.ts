import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { abortOnchainReads, fulfillOnchainReads, mockAppChainStatus } from './helpers/onchain'
import { stubNetwork } from './helpers/stubNetwork'
import { suppressReleaseAnnouncement } from './helpers/releaseAnnouncement'
import { fulfillGovernance } from './helpers/proGovernanceFixture'
const dao = '/mainnet/dao/gno.land/r/gov/dao'
test.beforeEach(async ({ page }) => {
    await stubNetwork(page)
    await fulfillGovernance(page)
    await suppressReleaseAnnouncement(page)
})
for (const theme of ['dark', 'light'] as const) {
    test(`desktop ${theme} overview and proposal reader`, async ({ page }, info) => {
        await page.setViewportSize({ width: 1600, height: 1100 })
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await page.goto(dao)
        await expect(page.locator('.gov-proposal-link')).toHaveCount(4)
        await expect(page.locator('.gov-summary').getByText('Open for voting')).toBeVisible()
        await expect(page.locator('.gov-member-link')).toHaveCount(3)
        await expect(page.locator('.gov-summary > div').filter({ hasText: 'Open for voting' }).locator('dd')).toHaveText('1')
        await expect(page.locator('.gov-summary > div').filter({ hasText: 'Awaiting execution' }).locator('dd')).toHaveText('1')
        await expect(page.locator('.dao-overview-card')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)')
        await page.evaluate(() => { const n = document.createElement('p'); n.textContent = 'Test fixture'; document.querySelector('.dao-overview-card')!.prepend(n) })
        await page.screenshot({ path: info.outputPath(`governance-${theme}.png`), fullPage: true })
        expect((await new AxeBuilder({ page }).include('.gov-proposals').include('.dao-overview-card').include('#dao-members-section').analyze()).violations).toEqual([])
        await page.locator('.gov-proposal-link').first().click()
        await expect(page.locator('.proposal-title')).toHaveText('Fund the community education programme')
        await expect(page.getByText('4 reported')).toBeVisible()
        await expect(page.locator('.proposal-action-body')).toContainText('PublishPolicy')
        await expect(page.getByRole('button', { name: 'Vote Yes on this proposal' })).toHaveCount(0)
        await expect(page.getByText('Connect your wallet to check your voting eligibility.')).toBeVisible()
        await page.evaluate(() => { const n = document.createElement('p'); n.textContent = 'Test fixture'; document.querySelector('.proposal-container')!.prepend(n) })
        await page.screenshot({ path: info.outputPath(`proposal-${theme}.png`), fullPage: true })
        expect((await new AxeBuilder({ page }).include('.proposal-container').analyze()).violations).toEqual([])
    })
}
test('filters, search, keyboard links and history mobile', async ({ page }) => {
    await page.goto(dao)
    await expect(page.locator('.gov-proposal-link')).toHaveCount(4)
    await page.getByRole('button', { name: /Awaiting execution/ }).click()
    await expect(page.locator('.gov-proposal-link')).toHaveCount(1)
    await page.getByRole('button', { name: /History/ }).click()
    await expect(page.locator('.gov-proposal-link')).toHaveCount(2)
    await page.getByRole('searchbox', { name: 'Search proposals' }).fill('no matches')
    await expect(page.getByText('No matching proposals')).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await page.getByRole('searchbox', { name: 'Search proposals' }).fill('4')
    await expect(page.locator('.gov-proposal-link')).toHaveCount(1)
    await page.locator('.gov-proposal-link').focus(); await page.keyboard.press('Enter')
    await expect(page).toHaveURL(`${dao}/proposal/4`)
    await page.getByRole('button', { name: 'Back to DAO', exact: true }).click()
    await expect(page.locator('.gov-proposal-link')).toHaveCount(4)
})
for (const width of [320, 390, 768, 1024, 1920]) {
    test(`reading layout fits ${width}px mobile`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto(dao)
        await expect(page.locator('.gov-proposal-link')).toHaveCount(4)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.goto(`${dao}/proposal/4`)
        await expect(page.locator('.proposal-title')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        expect(await page.locator('.proposal-action-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        if (width === 390) {
            await page.evaluate(() => { const n = document.createElement('p'); n.textContent = 'Test fixture'; document.querySelector('.proposal-container')!.prepend(n) })
            await page.screenshot({ path: info.outputPath('proposal-mobile.png'), fullPage: true })
        }
    })
}
test('empty and unavailable states have honest copy and retry mobile', async ({ page }) => {
    await fulfillGovernance(page, { empty: true, missing: true })
    await page.goto(dao)
    await expect(page.getByText('No proposals yet')).toBeVisible()
    await page.goto(`${dao}/proposal/999`)
    await expect(page.getByText('Proposal #999 is unavailable')).toBeVisible()
    await page.getByRole('button', { name: 'Retry proposal', exact: true }).click()
    await expect(page.getByText('Proposal #999 is unavailable')).toBeVisible()
})
test('signing and treasury routes retain their original presentation', async ({ page }) => {
    for (const suffix of ['/propose', '/treasury', '/members', '/channels']) {
        await page.goto(dao + suffix)
        await expect(page.locator('.k-app-layout')).toBeVisible()
        await expect(page.locator('.k-pro-governance')).toHaveCount(0)
    }
})

test('failed RPC reads do not impersonate an empty DAO mobile', async ({ page }) => {
    await abortOnchainReads(page)
    await page.goto(dao)
    await expect(page.getByRole('button', { name: 'Retry DAO data' })).toBeVisible()
    await expect(page.getByText('Could not load proposals.', { exact: true })).toBeVisible()
    await expect(page.getByText('No proposals yet', { exact: true })).toHaveCount(0)
    await expect(page.locator('.gov-summary > div').filter({ hasText: 'Total proposals' }).locator('dd')).toHaveText('—')
})

test('passed and completed proposals show the appropriate reader guidance mobile', async ({ page }) => {
    await page.goto(`${dao}/proposal/3`)
    await expect(page.getByText('Voting has passed. Execution is available to eligible DAO members.')).toBeVisible()
    await page.goto(`${dao}/proposal/2`)
    await expect(page.getByText('Voting is closed. You can review the proposal and recorded votes.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Execute proposal/ })).toHaveCount(0)
})


test('first mainnet text proposal and vote preserve receipts mobile', async ({ page }) => {
    const address = 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c'
    const realm = `gno.land/r/${address}/governance_fixture`
    let created = false
    let voted = false
    let walletCalls = 0
    const now = Math.floor(Date.now() / 1000)
    const config = { template_version: 'memba-dao/2', api_version: '2.0', name: 'Governance fixture', description: '', threshold: 60, quorum: 0, voting_period: 86400, execution_delay: 3600, execution_window: 86400, categories: ['governance'], roles: ['member'], archived: false, member_count: 1, total_power: 1, electorate_version: 0, proposal_count: 0 }
    const summary = () => ({ id: 1, title: 'First decision', category: 'governance', author: address, action: { kind: 'text', target: '', power: 0, roles: [] }, electorate_power: 1, electorate_version: 0, created_at: now - 10, voting_ends_at: now + 86400, status: voted ? 'ACCEPTED' : 'ACTIVE', yes: voted ? 1 : 0, no: 0, abstain: 0, accepted_at: voted ? now : 0, executable_at: voted ? now + 3600 : 0, execute_by: voted ? now + 90000 : 0 })
    const jsonValue = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`
    await page.exposeFunction('fixtureGovernanceWrite', (func: string) => {
        walletCalls++
        if (func === 'ProposeText') created = true
        else if (func === 'Vote') voted = true
        else throw new Error(`Unexpected fixture write ${func}`)
    })
    await page.addInitScript(({ address }) => {
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'governance-fixture', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'invalid-test-only' }))
        localStorage.setItem(`memba_wizard_seen_${address}`, '1')
        const reject = async () => { throw new Error('Unexpected fixture wallet method') }
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '0ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '0', sequence: '0', chainId: 'gnoland-1' } }),
            GetNetwork: async () => ({ status: 'success', data: { chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land' } }), On: () => () => {},
            DoContract: async ({ messages }: { messages: { value: { func: string } }[] }) => {
                const func = messages[0].value.func
                await (window as unknown as { fixtureGovernanceWrite: (func: string) => Promise<void> }).fixtureGovernanceWrite(func)
                return { status: 'success', data: { hash: (func === 'Vote' ? 'b' : 'a').repeat(64), deliver_tx: { ResponseBase: { Data: btoa('(1 uint64)') } } } }
            }, Sign: reject, SignTx: reject, AddEstablish: reject,
        } })
    }, { address })
    await fulfillOnchainReads(page, ({ method, path, arg }) => {
        if (method === 'status') return mockAppChainStatus('gnoland-1')
        if (path !== 'vm/qeval') return null
        if (arg.includes('GetTemplateVersion')) return '("memba-dao/2" string)'
        if (arg.includes('GetConfigJSON')) return jsonValue({ ...config, proposal_count: created ? 1 : 0 })
        if (arg.includes('GetMembersJSON')) return jsonValue({ total: 1, offset: 0, members: [{ address, power: 1, roles: ['member'] }] })
        if (arg.includes('GetProposalsJSON')) return jsonValue({ proposals: created ? [summary()] : [], next_before: 0 })
        if (arg.includes('GetProposalJSON')) return jsonValue({ ...summary(), description: 'Record our first decision.' })
        if (arg.includes('HasVoted')) return `(${voted} bool)`
        if (arg.includes('GetVotesJSON')) return jsonValue({ total: voted ? 1 : 0, offset: 0, votes: voted ? [{ voter: address, choice: 'YES', power: 1 }] : [] })
        return null
    })
    await page.goto(`/mainnet/dao/${realm}`)
    await page.getByRole('link', { name: 'Create the first text proposal' }).click()
    const types = page.getByRole('group', { name: 'Proposal type' })
    await types.getByRole('button', { name: 'Add member', exact: true }).click()
    await expect(types.getByRole('button', { name: 'Add member', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('New member address')).toBeEnabled()
    await types.getByRole('button', { name: 'Text', exact: true }).click()
    await page.getByLabel('Title', { exact: true }).fill('First decision')
    await page.getByLabel('Description', { exact: true }).fill('Record our first decision.')
    await expect(page.getByTestId('v2-signed-message')).toContainText('ProposeText')
    await page.getByRole('button', { name: 'Submit proposal', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm & Broadcast' }).click()
    await expect(page).toHaveURL(new RegExp('/proposal/1$'))
    await expect(page.getByRole('heading', { name: 'First decision', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Vote yes', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm YES', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm & Broadcast' }).click()
    await expect(page.getByText('Your YES vote is recorded.', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('img', { name: 'Yes 100%, No 0%, Abstain 0% of all voting power; threshold 60%' })).toBeVisible()
    await expect(page.locator('.v2p-status')).toHaveText('Accepted')
    await expect(page.getByText('Transaction ' + 'b'.repeat(64), { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Vote yes', exact: true })).toHaveCount(0)
    expect(walletCalls).toBe(2)
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('memba_governance:v1:') && !k.endsWith(':draft')).length)).toBe(2)
    for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 1000 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
})

// Synthetic wallet + RPC only: this exercises the actual confirmation provider,
// wallet boundary and reload recovery without submitting to a network.
test('DAO approval receipt survives reload without another wallet request mobile', async ({ page }) => {
    const address = 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c'
    const realmPath = `gno.land/r/${address}/recovery_fixture`
    const hash = 'c'.repeat(64)
    let submitted = false
    await page.exposeFunction('fixtureSubmitted', () => { submitted = true })
    await page.addInitScript(({ address, realmPath, hash }) => {
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem(`memba_wizard_seen_${address}`, '1')
        if (!localStorage.getItem('recovery-fixture-seeded')) {
            localStorage.setItem('recovery-fixture-seeded', '1')
            localStorage.setItem('memba_dao_draft', JSON.stringify({
                name: 'Recovery fixture', description: 'Offline browser fixture', realmPath,
                members: [{ address, power: 1, roles: ['admin'] }], threshold: 51, quorum: 0,
                availableRoles: ['admin', 'member'], proposalCategories: ['governance'],
                selectedPreset: 'basic', step: 5, enableChannels: false, channelNames: ['general'], savedAt: Date.now(),
            }))
        }
        const reject = async () => { throw new Error('Unexpected fixture wallet method') }
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '0ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '0', sequence: '0', chainId: 'gnoland-1' } }),
            GetNetwork: async () => ({ status: 'success', data: { chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land' } }), On: () => () => {},
            DoContract: async () => {
                localStorage.setItem('fixture-wallet-calls', String(Number(localStorage.getItem('fixture-wallet-calls') || 0) + 1))
                await (window as unknown as { fixtureSubmitted: () => Promise<void> }).fixtureSubmitted()
                return { status: 'success', data: { hash } }
            },
            Sign: reject, SignTx: reject, AddEstablish: reject,
        } })
    }, { address, realmPath, hash })
    await fulfillOnchainReads(page, ({ method, path, arg }) => {
        if (method === 'status') return mockAppChainStatus('gnoland-1')
        if (path === 'vm/qeval' && arg.includes('IsAuthorizedAddressForNamespace')) return '(true bool)'
        if (path === 'params/vm:p:code_submission_policy') return '"inert"'
        if (path === 'vm/qpkgmeta_json' && arg === realmPath) return JSON.stringify(submitted
            ? { path: realmPath, status: 'inert', creator: address, height: 123, max_deposit: '12000000ugnot', reason: 'waiting for a package approver to enable it', pending: true }
            : { path: realmPath, status: 'absent' })
        return null
    })
    await page.goto('/mainnet/dao/create')
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.getByRole('checkbox', { name: /permanent contract on gno.land/ }).check()
    await page.getByRole('button', { name: /Deploy DAO/ }).click()
    await page.getByRole('button', { name: 'Confirm & Broadcast' }).click()
    await expect(page.getByText('Waiting for network approval', { exact: true })).toBeVisible()
    await expect(page.getByText(new RegExp(hash))).toBeVisible()
    await page.reload()
    await expect(page.getByText('Submission status unknown', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Check status', exact: true }).click()
    await expect(page.getByText('Submitted, not enabled yet', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Deploy DAO/ })).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('fixture-wallet-calls'))).toBe('1')
    for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 1000 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
})
