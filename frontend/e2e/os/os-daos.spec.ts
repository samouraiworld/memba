import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
import { fulfillGovernance } from '../helpers/proGovernanceFixture'

// Day 4a: DAO windows on the GovDAO fixture (on-chain reads served locally),
// and a vote through the Memba review sheet with a stub Adena. Nothing here
// reaches a chain: DoContract is a page-level stub that records what it was asked to sign.

const MEMBER = 'g1fixturealice00000000000000000000000000'

async function offline(page: Page) {
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
}

type WalletMode = 'ok' | 'timeout'

/** A connected GovDAO member (@alice in the fixture), Adena stubbed. */
async function member(page: Page, mode: WalletMode) {
    await page.addInitScript(({ address, mode }) => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'e2e', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'e2e-only' }))
        const calls: unknown[] = []
        Object.defineProperty(window, '__adenaCalls', { value: calls })
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '5000000ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '1', sequence: '1', chainId: 'gnoland-1' } }),
            GetNetwork: async () => ({ data: { rpcUrl: 'https://rpc.gno.land' } }),
            On: () => true,
            DoContract: async (tx: unknown) => {
                calls.push(tx)
                if (mode === 'timeout') throw new Error('network timeout')
                return { status: 'success', data: { hash: 'E2EHASH0001' } }
            },
        } })
    }, { address: MEMBER, mode })
}

const win = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Review · Vote' })

test.describe('Memba OS DAOs', () => {
    test.beforeEach(async ({ page }) => {
        await offline(page)
        await fulfillGovernance(page)
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('a DAO folder opens from its link, with sections and proposals', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
        await page.goto(`${OS_ON}/os/dao/govdao`)
        const folder = win(page, 'govdao')
        await expect(folder.getByText('GovDAO', { exact: true })).toBeVisible()
        await expect(folder.getByText('gno.land/r/gov/dao')).toBeVisible()
        await folder.getByRole('tab', { name: 'Proposals' }).click()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/dao/govdao/proposals')
        await folder.getByRole('button', { name: /#4 Fund the community education programme/ }).click()
        const prop = win(page, 'govdao · Proposal #4')
        await expect(prop.getByRole('heading', { name: 'Fund the community education programme' })).toBeVisible()
        await expect(prop.getByRole('button', { name: 'Connect to vote' })).toBeVisible()
        await folder.getByRole('tab', { name: 'Treasury' }).click()
        await expect(folder.getByText('Target · contract v3')).toBeVisible()
    })

    test('a vote goes through the Memba review, and Adena gets exactly what was reviewed', async ({ page }) => {
        await member(page, 'ok')
        await page.goto(`${OS_ON}/os/dao/govdao/proposals/4`)
        const prop = win(page, 'govdao · Proposal #4')
        await prop.getByRole('button', { name: 'Vote…' }).click()
        const review = sheet(page)
        await expect(review.getByRole('heading', { name: 'Vote on #4 “Fund the community education programme”' })).toBeVisible()
        await review.getByRole('radio', { name: 'No' }).click()
        await expect(review.getByText('MustVoteOnProposalSimple')).toBeVisible()
        await expect(review.getByText('4 · NO')).toBeVisible()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(review).toHaveCount(0)
        // The classic confirmation never appears: the review sheet replaced it (D34).
        await expect(page.getByRole('dialog', { name: 'Confirm transaction' })).toHaveCount(0)
        const calls = await page.evaluate(() => (window as unknown as { __adenaCalls: { messages: { value: { func: string; args: string[] } }[] }[] }).__adenaCalls)
        expect(calls).toHaveLength(1)
        expect(calls[0].messages[0].value).toMatchObject({ func: 'MustVoteOnProposalSimple', args: ['4', 'NO'] })
        await page.getByRole('button', { name: /Notifications, 1 new/ }).click()
        await expect(page.getByText('Sent · Vote No on #4')).toBeVisible()
    })

    test('an unknown outcome locks the vote until the member checks it', async ({ page }) => {
        await member(page, 'timeout')
        await page.goto(`${OS_ON}/os/dao/govdao/proposals/4`)
        const prop = win(page, 'govdao · Proposal #4')
        await prop.getByRole('button', { name: 'Vote…' }).click()
        await sheet(page).getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(page.getByText(/Outcome unknown: Vote Yes on #4/)).toBeVisible()
        await expect(prop.getByText('Outcome unknown.')).toBeVisible()
        await expect(prop.getByRole('button', { name: 'Vote…' })).toHaveCount(0)
        // Still locked after a reload: the receipt is the classic one, kept in this browser.
        await page.reload()
        await expect(win(page, 'govdao · Proposal #4').getByText('Outcome unknown.')).toBeVisible()
        const again = win(page, 'govdao · Proposal #4')
        await expect(again.getByRole('button', { name: 'Review the vote again' })).toBeDisabled()
        await again.getByLabel('I checked the transaction and want to review this vote again.').check()
        await again.getByRole('button', { name: 'Review the vote again' }).click()
        await expect(again.getByRole('button', { name: 'Vote…' })).toBeVisible()
    })

    test('a wallet on another network is blocked in the review', async ({ page }) => {
        await member(page, 'ok')
        await page.addInitScript(() => {
            const a = (window as unknown as { adena: { GetAccount: () => Promise<{ data: { chainId: string } }> } }).adena
            const get = a.GetAccount
            a.GetAccount = async () => { const r = await get(); r.data.chainId = 'test12'; return r }
        })
        await page.goto(`${OS_ON}/os/dao/govdao/proposals/4`)
        await win(page, 'govdao · Proposal #4').getByRole('button', { name: 'Vote…' }).click()
        const review = sheet(page)
        await expect(review.getByText('Adena is on test12, but Memba is on gnoland-1.', { exact: false })).toBeVisible()
        await expect(review.getByRole('button', { name: 'Switch Adena to gnoland-1' })).toBeVisible()
        await expect(review.getByRole('button', { name: 'Sign in Adena' })).toHaveCount(0)
    })

    test('a wallet that reports no network is refused before Adena signs anything', async ({ page }) => {
        await member(page, 'ok')
        await page.addInitScript(() => {
            const a = (window as unknown as { adena: { GetAccount: () => Promise<{ data: { chainId: string } }> } }).adena
            const get = a.GetAccount
            a.GetAccount = async () => { const r = await get(); r.data.chainId = ''; return r }
        })
        await page.goto(`${OS_ON}/os/dao/govdao/proposals/4`)
        const prop = win(page, 'govdao · Proposal #4')
        await prop.getByRole('button', { name: 'Vote…' }).click()
        await sheet(page).getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(page.getByText(/Your wallet did not report its network — switch Adena to gno\.land \(gnoland-1\) and try again\./).first()).toBeVisible()
        expect(await page.evaluate(() => (window as unknown as { __adenaCalls: unknown[] }).__adenaCalls)).toHaveLength(0)
        // Nothing was sent, so the vote is not locked behind an unknown outcome.
        await expect(prop.getByText('Outcome unknown.')).toHaveCount(0)
    })
})
