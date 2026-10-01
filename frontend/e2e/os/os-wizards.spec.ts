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
    'GetProposalJSON(1)': wire({ ...V2_PROPOSAL, description: 'A plan for the DAO.' }),
    'GetProposalJSON(2)': wire({ ...V2_PROPOSAL, id: 2, title: 'Apply the roadmap', status: 'ACCEPTED', accepted_at: NOW - 1800, executable_at: NOW - 900, execute_by: NOW + 86400, description: 'Ready to execute.' }),
}

// ── The Create DAO path: absent until Adena signs, then live ──
const NEW_DAO_PATH = `gno.land/r/${ALICE}/gno_builders`

async function offline(page: Page) {
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
}

/** A connected member (ALICE), Adena stubbed; `window.__adenaCalls` records every DoContract. */
async function member(page: Page) {
    await page.addInitScript(({ address }) => {
        localStorage.setItem('memba_os_skip_intro', '1')
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

type AdenaCall = { messages: { type: string; value: Record<string, unknown> }[]; gasFee?: number; gasWanted?: number }
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
            if (path === 'vm/qeval' && arg.startsWith(`${V2_DAO}.`)) {
                const call = arg.slice(V2_DAO.length + 1)
                if (call === `HasVoted(1, address("${ALICE}"))`) return signed ? '(true bool)' : '(false bool)'
                if (call === 'GetVotesJSON(1, 0, 50)') return wire({ total: signed ? 1 : 0, offset: 0, votes: signed ? [{ voter: ALICE, choice: 'NO', power: 2 }] : [] })
                return V2_READS[call] ?? null
            }
            if (path === 'vm/qeval' && arg.includes('IsAuthorizedAddressForNamespace')) return arg.includes(ALICE) ? '(true bool)' : '(false bool)'
            if (path === 'params/vm:p:code_submission_policy') return '"permissionless"'
            // A deploy reads the network price for its fee, and again right before the wallet.
            if (path === 'auth/gasprice') return '{"gas":1000,"price":"1ugnot"}'
            // A deploy needs the fee and the storage deposit in the balance.
            if (path === `bank/balances/${ALICE}`) return '"50000000ugnot"'
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

    test('a 320px Create DAO member editor keeps the address usable', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 568 })
        await page.goto(`${OS_ON}/os/daos/new`)
        const wiz = win(page, 'Create a DAO')
        await wiz.getByLabel('Name').fill('Small DAO')
        await wiz.getByRole('button', { name: 'Continue' }).click()
        const address = wiz.getByLabel('Member 1 address')
        await expect(address).toBeVisible()
        const width = await address.evaluate((element) => element.getBoundingClientRect().width)
        expect(width).toBeGreaterThan(180)
        const overflow = await wiz.locator('.os-wiz').evaluate((element) => element.scrollWidth - element.clientWidth)
        expect(overflow).toBeLessThanOrEqual(0)
    })

    test('a resized desktop Create DAO window keeps the member address usable', async ({ page }) => {
        await page.goto(`${OS_ON}/os/daos/new`)
        const wiz = win(page, 'Create a DAO')
        await wiz.getByLabel('Name').fill('Narrow desktop')
        await wiz.getByRole('button', { name: 'Continue' }).click()
        const before = (await wiz.boundingBox())!
        const handle = (await wiz.getByTestId('resize').boundingBox())!
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
        await page.mouse.down()
        await page.mouse.move(handle.x + handle.width / 2 + (360 - before.width), handle.y + handle.height / 2, { steps: 8 })
        await page.mouse.up()
        await expect.poll(async () => Math.round((await wiz.boundingBox())!.width)).toBe(360)
        const addressWidth = await wiz.getByLabel('Member 1 address').evaluate((element) => element.getBoundingClientRect().width)
        expect(addressWidth).toBeGreaterThan(180)
        const overflow = await wiz.locator('.os-wiz').evaluate((element) => element.scrollWidth - element.clientWidth)
        expect(overflow).toBeLessThanOrEqual(0)
    })

    test('Create DAO draft can be discarded and preset radios use arrow keys', async ({ page }) => {
        await page.goto(`${OS_ON}/os/daos/new`)
        const wiz = win(page, 'Create a DAO')
        const basic = wiz.getByRole('radio', { name: /^Basic/ })
        await basic.focus()
        await basic.press('ArrowRight')
        await expect(basic).toHaveAttribute('aria-checked', 'false')
        await expect(wiz.getByRole('radio', { checked: true })).toBeFocused()
        await wiz.getByLabel('Name').fill('Draft to discard')
        await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('memba_os_dao_draft:')))).toBe(true)
        await wiz.getByRole('button', { name: 'Discard draft' }).click()
        await expect(wiz.getByLabel('Name')).toHaveValue('')
        expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('memba_os_dao_draft:')))).toBe(false)
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
        // Adena returned a hash but no proposal ID. A similar chain row could
        // belong to another transaction, so this draft stays in recovery.
        await expect(wiz.getByText('Outcome unknown.')).toBeVisible()
        await page.reload()
        await expect(win(page, 'New proposal · test.teamv2').getByText('Outcome unknown.')).toBeVisible()
    })

    test('a confirmed proposal cannot be submitted twice when saved draft removal fails', async ({ page }) => {
        await page.goto(`${OS_ON}/os/dao/test.teamv2/proposals/new`)
        const wiz = win(page, 'New proposal · test.teamv2')
        await wiz.getByRole('button', { name: 'Next' }).click()
        await wiz.getByLabel('Title').fill('One proposal only')
        await wiz.getByRole('button', { name: 'Next' }).click()
        await page.evaluate(() => {
            const original = Storage.prototype.removeItem
            Storage.prototype.removeItem = function (key: string) {
                if (key.includes('proposal-draft')) throw new Error('storage refused')
                return original.call(this, key)
            }
            const adena = (window as unknown as { adena: { DoContract: (tx: unknown) => Promise<{ status: string; data: { hash: string } }> } }).adena
            const send = adena.DoContract
            adena.DoContract = async (tx) => { const result = await send(tx); return { ...result, data: { ...result.data, deliverTx: { data: '(2 uint64)' } } } }
        })
        await wiz.getByRole('button', { name: 'Propose…' }).click()
        await page.getByRole('dialog', { name: 'Review · Propose' }).getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(wiz.getByText('Proposal #2 was created.')).toBeVisible()
        await expect(wiz.getByRole('button', { name: 'Propose…' })).toHaveCount(0)
        await expect(wiz.getByRole('button', { name: 'Remove saved draft' })).toBeVisible()
        expect(await adenaCalls(page)).toHaveLength(1)
        await page.reload()
        const recovered = win(page, 'New proposal · test.teamv2')
        await expect(recovered.getByText('Proposal #2 was created.')).toBeVisible()
        await expect(recovered.getByRole('button', { name: 'Propose…' })).toHaveCount(0)
        await expect(recovered.getByRole('button', { name: 'Start a new proposal' })).toBeVisible()
        await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.includes('proposal-draft')))).toBe(true)
        await win(page, 'test.teamv2 · Proposal #2').getByRole('button', { name: 'Close test.teamv2 · Proposal #2' }).click()
        await recovered.getByRole('button', { name: 'Start a new proposal' }).click()
        await expect(recovered.getByRole('radio', { name: /^Text/ })).toBeVisible()
        await recovered.getByRole('button', { name: 'Next' }).click()
        await expect(recovered.getByLabel('Title')).toHaveValue('')
        await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('memba_governance:') && key.includes('"proposal"')))).toBe(false)
    })

    test('a version-2 vote reviews its gas limit and confirms the chosen vote', async ({ page }) => {
        await page.goto(`${OS_ON}/os/dao/test.teamv2/proposals/1`)
        const proposal = win(page, 'test.teamv2 · Proposal #1')
        await proposal.getByRole('button', { name: 'Vote…' }).click()
        const review = page.getByRole('dialog', { name: 'Review · Vote' })
        const yes = review.getByRole('radio', { name: 'Yes' })
        await yes.focus()
        await yes.press('ArrowRight')
        await expect(review.getByRole('radio', { name: 'No' })).toHaveAttribute('aria-checked', 'true')
        await expect(review.getByText('Gas limit')).toBeVisible()
        // The fee is shown, rechecked and sent as shown: 15,000,000 gas at 1 ugnot per 1,000, with 20% headroom.
        await expect(review.getByText('Network fee', { exact: true })).toBeVisible()
        await expect(review.getByText('0.018 GNOT', { exact: true })).toBeVisible()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(review).toHaveCount(0)
        await expect(proposal.getByText('You voted')).toBeVisible()
        const [call] = await adenaCalls(page)
        expect(call.messages[0].value).toMatchObject({ pkg_path: V2_DAO, func: 'Vote', args: ['1', 'NO'] })
        expect([call.gasWanted, call.gasFee]).toEqual([15_000_000, 18_000])
    })

    test('a short landscape vote review keeps its actions reachable', async ({ page }) => {
        await page.setViewportSize({ width: 667, height: 320 })
        await page.goto(`${OS_ON}/os/dao/test.teamv2/proposals/1`)
        await win(page, 'test.teamv2 · Proposal #1').getByRole('button', { name: 'Vote…' }).click()
        const review = page.getByRole('dialog', { name: 'Review · Vote' })
        await expect(review.getByRole('button', { name: 'Cancel' })).toBeVisible()
        await expect(review.getByRole('button', { name: 'Sign in Adena' })).toBeVisible()
        const fit = await review.evaluate((element) => {
            const outer = element.getBoundingClientRect()
            const footer = element.querySelector('.os-rvf')!.getBoundingClientRect()
            return { height: outer.height, bottom: footer.bottom }
        })
        expect(fit.height).toBeLessThanOrEqual(288)
        expect(fit.bottom).toBeLessThanOrEqual(320)
        await review.getByRole('button', { name: 'Cancel' }).click()
    })

    test('an accepted proposal links to the working execution page', async ({ page }) => {
        await page.goto(`${OS_ON}/os/dao/test.teamv2/proposals/2`)
        const proposal = win(page, 'test.teamv2 · Proposal #2')
        const execute = proposal.getByRole('link', { name: 'Execute on the DAO page' })
        await expect(execute).toBeVisible()
        await expect(execute).toHaveAttribute('href', '/mainnet/dao/gno.land/r/test/teamv2/proposal/2')
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
        await expect(wiz.getByText('Your balance', { exact: true })).toBeVisible()
        await expect(wiz.getByText(/, taken from your balance when the package is deployed$/)).toBeVisible()
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

    test('a deploy from this browser that is not live shows in the DAOs window with what the chain answers', async ({ page }) => {
        await page.addInitScript((path) => localStorage.setItem('memba_pending_daos', JSON.stringify([{ chainId: 'gnoland-1', path, name: 'Gno Builders', txHash: 'H', reason: 'waiting', submittedAt: 1 }])), NEW_DAO_PATH)
        await page.goto(`${OS_ON}/os/daos`)
        const daos = win(page, 'DAOs')
        await expect(daos.getByRole('heading', { name: 'Deployed from this browser, not live yet' })).toBeVisible()
        await expect(daos.getByText(NEW_DAO_PATH)).toBeVisible()
        await expect(daos.getByText('Not on chain yet: check the transaction before deploying again')).toBeVisible()
    })

    test('a guest fills in the whole Create DAO wizard and is asked to connect only at Deploy', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('memba_auth_token'))
        await page.goto(`${OS_ON}/os/daos/new`)
        const wiz = win(page, 'Create a DAO')
        await wiz.getByLabel('Name').fill('Gno Builders')
        await expect(wiz.getByTestId('os-dao-path')).toHaveText('gno.land/r/‹your address›/gno_builders')
        await wiz.getByRole('button', { name: 'Continue' }).click()
        await expect(wiz.getByLabel('Member 1 address')).toHaveAttribute('placeholder', 'Your address, when you connect')
        for (let i = 0; i < 3; i++) await wiz.getByRole('button', { name: 'Continue' }).click()
        await expect(wiz.getByText(/^Connect a wallet to deploy\. The address is made from your wallet's address/)).toBeVisible()
        await expect(wiz.getByTestId('os-dao-checks')).toHaveCount(0)
        await wiz.getByRole('button', { name: 'Connect a wallet to deploy' }).click()
        await expect(page.getByRole('dialog', { name: 'Connect a wallet' })).toBeVisible()
        expect(await adenaCalls(page)).toEqual([])
    })
})
