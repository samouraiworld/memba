import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
import { fulfillOnchainReads, mockAppChainStatus } from '../helpers/onchain'

// Day 4b: the New proposal and Create DAO wizards, on the version-2 DAO fixture
// of e2e/dao.spec.ts (on-chain reads served locally) with a stub Adena that
// records what it was asked to sign. Nothing here reaches a chain.

const ALICE = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5'
const BOB = 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c'

// ── Version-2 DAO fixture (template memba-dao/2), as in e2e/dao.spec.ts ──
const V2_DAO = 'gno.land/r/test/teamv2'
const NOW = Math.floor(Date.now() / 1000)
const wire = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`
const V2_PROPOSAL = {
    id: 1, title: 'Adopt the roadmap', category: 'governance', author: BOB,
    action: { kind: 'text', target: '', power: 0, roles: [] },
    electorate_power: 3, electorate_version: 0, created_at: NOW - 3600, voting_ends_at: NOW + 2 * 86400,
    status: 'ACTIVE', yes: 1, no: 0, abstain: 0, accepted_at: 0, executable_at: 0, execute_by: 0,
}
const V2_READS: Record<string, string> = {
    'GetTemplateVersion()': '("memba-dao/2" string)',
    'GetConfigJSON()': wire({
        template_version: 'memba-dao/2', api_version: '2.0', name: 'Team Two', description: 'A version-2 DAO',
        threshold: 60, quorum: 20, voting_period: 3 * 86400, execution_delay: 3600, execution_window: 7 * 86400,
        categories: ['governance', 'ops'], roles: ['lead', 'member'], archived: false,
        member_count: 2, total_power: 3, electorate_version: 0, proposal_count: 1,
    }),
    'GetMembersJSON(0, 50)': wire({ total: 2, offset: 0, members: [{ address: ALICE, power: 2, roles: ['lead'] }, { address: BOB, power: 1, roles: [] }] }),
    'GetProposalsJSON(0, 50)': wire({ proposals: [V2_PROPOSAL], next_before: 0 }),
    'GetProposalsJSON(0, 20)': wire({ proposals: [V2_PROPOSAL], next_before: 0 }),
}

// ── The Create DAO path: absent until Adena signs, then live ──
const NEW_DAO_PATH = `gno.land/r/${ALICE}/gno_builders`

async function offline(page: Page) {
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
}

/** A connected member (ALICE), Adena stubbed; `window.__adenaCalls` records every DoContract. */
async function member(page: Page) {
    await page.addInitScript(({ address }) => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'e2e', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'e2e-only' }))
        const calls: unknown[] = []
        Object.defineProperty(window, '__adenaCalls', { value: calls })
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '500000000ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '1', sequence: '1', chainId: 'gnoland-1' } }),
            GetNetwork: async () => ({ status: 'success', data: { chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land' } }),
            On: () => true,
            DoContract: async (tx: unknown) => {
                calls.push(tx)
                return { status: 'success', data: { hash: 'E2EHASH0002' } }
            },
        } })
    }, { address: ALICE })
}

type AdenaCall = { messages: { type: string; value: Record<string, unknown> }[] }
const adenaCalls = (page: Page) => page.evaluate(() => (window as unknown as { __adenaCalls: AdenaCall[] }).__adenaCalls)
const win = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

test.describe('Memba OS wizards', () => {
    // Flipped when the stub Adena signs: the new DAO's package is absent before, live after.
    let signed = false

    test.beforeEach(async ({ page }) => {
        await offline(page)
        await page.setViewportSize({ width: 1280, height: 860 })
        await member(page)
        await fulfillOnchainReads(page, ({ method, path, arg }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (path === 'vm/qeval' && arg.startsWith(`${V2_DAO}.`)) return V2_READS[arg.slice(V2_DAO.length + 1)] ?? null
            if (path === 'vm/qeval' && arg.includes('IsAuthorizedAddressForNamespace')) return arg.includes(ALICE) ? '(true bool)' : '(false bool)'
            if (path === 'params/vm:p:code_submission_policy') return '"permissionless"'
            if (path === 'vm/qpkgmeta_json' && arg === NEW_DAO_PATH) {
                return JSON.stringify(signed ? { path: NEW_DAO_PATH, status: 'live', creator: ALICE, height: 10 } : { path: NEW_DAO_PATH, status: 'absent' })
            }
            return null
        })
        await page.exposeFunction('__signed', () => { signed = true })
        await page.addInitScript(() => {
            const a = (window as unknown as { adena: { DoContract: (tx: unknown) => Promise<unknown> } }).adena
            const send = a.DoContract
            a.DoContract = async (tx) => { await (window as unknown as { __signed: () => Promise<void> }).__signed(); return send(tx) }
        })
        signed = false
    })

    test('a new proposal goes through the wizard and the Memba review, and Adena gets ProposeText', async ({ page }) => {
        await page.goto(`${OS_ON}/os/dao/test.teamv2/proposals/new`)
        const wiz = win(page, 'New proposal · test.teamv2')
        await wiz.getByRole('radio', { name: /^Text/ }).click()
        await wiz.getByRole('button', { name: 'Next' }).click()
        await wiz.getByLabel('Title').fill('Ship Memba OS')
        await wiz.getByLabel('Description').fill('Beta on memba.club')
        await expect(wiz.getByLabel('Preview').getByText('Ship Memba OS')).toBeVisible()
        await wiz.getByRole('button', { name: 'Next' }).click()
        await expect(wiz.getByText('Propose “Ship Memba OS”')).toBeVisible()
        await wiz.getByRole('button', { name: 'Propose…' }).click()
        const review = page.getByRole('dialog', { name: 'Review · Propose' })
        await expect(review.getByText('ProposeText')).toBeVisible()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(review).toHaveCount(0)
        await expect.poll(async () => (await adenaCalls(page)).length).toBe(1)
        const [call] = await adenaCalls(page)
        expect(call.messages[0].value).toMatchObject({ pkg_path: V2_DAO, func: 'ProposeText', args: ['Ship Memba OS', 'Beta on memba.club', 'governance'] })
    })

    test('a DAO is created through the five steps, checked, deployed and opened', async ({ page }) => {
        await page.goto(`${OS_ON}/os/daos`)
        await win(page, 'DAOs').getByRole('button', { name: 'Create a DAO' }).click()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/daos/new')
        const wiz = win(page, 'Create a DAO')

        // Basics: the name derives the permanent address.
        await wiz.getByRole('button', { name: 'Continue' }).click()
        await expect(wiz.getByRole('alert')).toContainText('DAO name is required')
        await wiz.getByLabel('Name').fill('Gno Builders')
        await expect(wiz.getByTestId('os-dao-path')).toHaveText(NEW_DAO_PATH)
        await wiz.getByRole('radio', { name: /^Basic/ }).click()
        await wiz.getByRole('button', { name: 'Continue' }).click()

        // Members: a second member; the founder alone could pass proposals.
        await wiz.getByRole('button', { name: '+ Add member' }).click()
        await wiz.getByLabel('Member 2 address').fill(BOB)
        await wiz.getByLabel('Member 1 voting power').fill('3')
        await expect(wiz.getByText(/can pass proposals alone/)).toBeVisible()
        await wiz.getByRole('button', { name: 'Continue' }).click()

        // Rules, then Extras (Treasury is a target).
        await expect(wiz.getByText('From the Basic preset', { exact: false })).toBeVisible()
        await wiz.getByRole('button', { name: 'Continue' }).click()
        await expect(wiz.getByText('Not on gnoland-1 yet')).toBeVisible()
        await wiz.getByRole('button', { name: 'Off' }).click()
        await wiz.getByRole('button', { name: 'Continue' }).click()

        // Review: the chain checks run up front.
        await expect(wiz.getByTestId('os-dao-checks')).toContainText('The address is free')
        await expect(wiz.getByText('Treasury is a target design', { exact: false })).toBeVisible()
        await wiz.getByRole('button', { name: 'Deploy with Adena…' }).click()
        await expect(wiz.getByRole('alert')).toContainText('permanent contract')
        await wiz.getByLabel(/I understand this deploys a permanent contract/).check()
        await wiz.getByRole('button', { name: 'Deploy with Adena…' }).click()

        const review = page.getByRole('dialog', { name: 'Review · Deploy DAO' })
        await expect(review.getByText('Deploy a package')).toBeVisible()
        await expect(review.getByText(NEW_DAO_PATH).first()).toBeVisible()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(review).toHaveCount(0)

        await expect(wiz.getByRole('heading', { name: 'Your DAO is live' })).toBeVisible()
        const [call] = await adenaCalls(page)
        expect(call.messages).toHaveLength(1)
        expect(call.messages[0].type).toBe('/vm.m_addpkg')
        expect(call.messages[0].value).toMatchObject({ creator: ALICE, package: { path: NEW_DAO_PATH }, max_deposit: expect.stringMatching(/^[0-9]+ugnot$/) })
        // Saved to the DAO list, the pending record and the draft gone.
        const stored = await page.evaluate(() => ({ pending: localStorage.getItem('memba_pending_daos'), draft: Object.keys(localStorage).filter((k) => k.startsWith('memba_os_dao_draft:')) }))
        expect(JSON.parse(stored.pending ?? '[]')).toEqual([])
        expect(stored.draft).toEqual([])

        await wiz.getByRole('button', { name: 'Open DAO' }).click()
        await expect(win(page, `${ALICE}.gno_builders`)).toBeVisible()
        await expect(win(page, 'Create a DAO')).toHaveCount(0)
    })

    test('a guest opening the Create DAO link is asked to connect', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('memba_auth_token'))
        await page.goto(`${OS_ON}/os/daos/new`)
        await expect(win(page, 'Create a DAO').getByText('Connect a wallet to create a DAO.')).toBeVisible()
    })
})
