import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { abortOnchainReads, fulfillOnchainReads, mockAppChainStatus } from './helpers/onchain'
import { stubNetwork } from './helpers/stubNetwork'
import { suppressReleaseAnnouncement } from './helpers/releaseAnnouncement'
import { fulfillGovernance } from './helpers/proGovernanceFixture'
const dao = '/pearl/dao/gno.land/r/gov/dao'
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
            GetNetwork: async () => ({ data: { rpcUrl: 'https://rpc.gno.land' } }), On: () => () => {},
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
