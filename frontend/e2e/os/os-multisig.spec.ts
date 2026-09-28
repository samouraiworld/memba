import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
import { fulfillOnchainReads, mockAppChainStatus } from '../helpers/onchain'

// Day 5c: the Multisig app and a multisig window on stubbed backend answers
// (Connect JSON), with signature dots; signing opens Memba's transaction page.

const ALICE = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5'
const BOB = 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c'
const CAROL = 'g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj'
const MSIG = 'g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l'

const team = { address: MSIG, chainId: 'gnoland-1', name: 'Team treasury', joined: true, threshold: 2, membersCount: 3, usersAddresses: [ALICE, BOB, CAROL], pubkeyJson: '{}' }
const invite = { ...team, address: 'g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj', name: 'Ops', joined: false }
const send = (to: string, amount: string) => JSON.stringify([{ '@type': '/bank.MsgSend', from_address: MSIG, to_address: to, amount }])
const pending = { id: 7, multisigAddress: MSIG, chainId: 'gnoland-1', msgsJson: send(CAROL, '5000000ugnot'), feeJson: '{}', threshold: 2, membersCount: 3, memo: 'rent', finalHash: '', signatures: [{ userAddress: BOB, value: 'x' }] }
const ready = { ...pending, id: 9, memo: 'payroll', signatures: [{ userAddress: BOB, value: 'x' }, { userAddress: CAROL, value: 'z' }] }
const done = { ...pending, id: 3, memo: '', finalHash: 'ABCDEF0123456789', signatures: [{ userAddress: BOB, value: 'x' }, { userAddress: ALICE, value: 'y' }] }

async function setup(page: Page) {
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
    const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    await page.route('**/memba.v1.MultisigService/Multisigs', (route) => route.fulfill(json({ multisigs: [team, invite] })))
    await page.route('**/memba.v1.MultisigService/MultisigInfo', (route) => route.fulfill(json({ multisig: team })))
    await page.route('**/memba.v1.MultisigService/Transactions', (route) =>
        route.fulfill(json({ transactions: /EXECUTED/.test(route.request().postData() ?? '') ? [done] : [pending, ready] })))
    await fulfillOnchainReads(page, ({ method, path }) => {
        if (method === 'status') return mockAppChainStatus('gnoland-1')
        if (method === 'abci_query' && path.startsWith('bank/balances/')) return '"42000000ugnot"'
        return null
    })
    await page.addInitScript(({ address }) => {
        localStorage.setItem('memba_os_skip_intro', '1')
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'e2e', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'e2e-only' }))
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '0ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '1', sequence: '1', chainId: 'gnoland-1' } }),
            GetNetwork: async () => ({ status: 'success', data: { chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land' } }),
            On: () => true,
            DoContract: async () => { throw new Error('not in this test') },
        } })
    }, { address: ALICE })
    await page.setViewportSize({ width: 1280, height: 860 })
}

const win = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

test.describe('Memba OS multisig', () => {
    test('the Multisig app lists your multisigs and invitations; a multisig window shows members, balance and signatures', async ({ page }) => {
        await setup(page)
        await page.goto(`${OS_ON}/os/multisig`)
        const app = win(page, 'Multisig')
        await expect(app.getByText('Team treasury')).toBeVisible()
        await expect(app.getByRole('button', { name: 'Add Ops to my Memba accounts' })).toBeVisible()
        await expect(app.getByRole('button', { name: 'New multisig' })).toBeDisabled()
        await app.getByRole('button', { name: /Team treasury/ }).click()
        await expect.poll(() => new URL(page.url()).pathname).toBe(`/os/multisig/${MSIG}`)

        const account = win(page, `Multisig ${MSIG.slice(0, 8)}…${MSIG.slice(-4)}`)
        await expect(account.getByText('Requires 2 of 3 members', { exact: false }).first()).toBeVisible()
        await expect(account.getByText('42 GNOT')).toBeVisible()
        await expect(account.getByLabel('1 submitted, 0 verified, threshold 2')).toBeVisible()
        await expect(account.getByText('Legacy hash recorded')).toBeVisible()
        await expect(account.getByRole('button', { name: 'Propose transaction' })).toBeDisabled()
        // A legacy quorum cannot be broadcast from Memba.
        const nine = account.getByRole('listitem').filter({ hasText: '#9' })
        await expect(nine.getByLabel('2 submitted, 0 verified, threshold 2')).toBeVisible()
        await expect(nine.getByText('Read-only history')).toBeVisible()
        // Every row, including completed history, opens its full transaction reader.
        await expect(account.getByRole('button', { name: /View transaction #7/ })).toBeVisible()
        await account.getByRole('button', { name: /View transaction #3/ }).click()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/wallet/tx/3')
    })

    test('a guest is asked to connect', async ({ page }) => {
        await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.goto(`${OS_ON}/os/multisig/${MSIG}`)
        await expect(page.getByText('Only members of a multisig can see and sign its transactions.')).toBeVisible()
    })

    test('keeps completed history visible when pending transactions fail, then retries', async ({ page }) => {
        await setup(page)
        let failPending = true
        await page.route('**/memba.v1.MultisigService/Transactions', (route) => {
            if (/EXECUTED/.test(route.request().postData() ?? '')) {
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ transactions: [done] }) })
            }
            return failPending
                ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
                : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ transactions: [pending, ready] }) })
        })
        await page.goto(`${OS_ON}/os/multisig/${MSIG}`)
        const account = win(page, `Multisig ${MSIG.slice(0, 8)}…${MSIG.slice(-4)}`)
        await expect(account.getByText("Pending transactions couldn't be loaded.")).toBeVisible()
        await expect(account.getByRole('button', { name: /View transaction #3/ })).toBeVisible()
        failPending = false
        await account.getByRole('button', { name: 'Refresh' }).click()
        await expect(account.getByRole('button', { name: /View transaction #7/ })).toBeVisible()
        await expect(account.getByText("Pending transactions couldn't be loaded.")).toHaveCount(0)
    })

    test('keeps long account balances inside a phone-width window', async ({ page }) => {
        await setup(page)
        await page.setViewportSize({ width: 320, height: 700 })
        await fulfillOnchainReads(page, ({ method, path }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (method === 'abci_query' && path.startsWith('bank/balances/')) return '"123456789123456789000000ugnot"'
            return null
        })
        await page.goto(`${OS_ON}/os/multisig/${MSIG}`)
        const account = win(page, `Multisig ${MSIG.slice(0, 8)}…${MSIG.slice(-4)}`)
        await expect(account.getByText('123,456,789,123,456,789 GNOT')).toBeVisible()
        expect(await account.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    })

    test('direct creation and proposal URLs respect the native release hold', async ({ page }) => {
        await setup(page)
        await page.goto(`${OS_ON}/os/multisig/create`)
        await expect(page.getByRole('button', { name: 'Create Multisig' })).toBeDisabled()
        await expect(page.getByText('Native multisig registration is on hold pending release approval.')).toBeVisible()
        await page.goto(`${OS_ON}/os/multisig/${MSIG}/propose`)
        await expect(page.getByRole('button', { name: 'Propose Send' })).toBeDisabled()
        await expect(page.getByText('Native multisig proposals are on hold pending release approval. Legacy accounts remain read-only history.')).toBeVisible()
    })

    test('a shared configuration link identifies itself as unverified account data', async ({ page }) => {
        await setup(page)
        const pubkey = btoa(JSON.stringify({ type: 'tendermint/PubKeyMultisigThreshold', value: { threshold: '2', pubkeys: [{}, {}, {}] } }))
        await page.goto(`${OS_ON}/os/multisig/import?pubkey=${encodeURIComponent(pubkey)}&name=Team%20treasury`)
        await expect(page.getByText('Shared multisig configuration')).toBeVisible()
        await expect(page.getByText('This link does not grant signing rights.', { exact: false })).toBeVisible()
        await expect(page.getByText('Threshold:', { exact: false })).toContainText('2/3')
        await expect(page.getByRole('textbox', { name: 'Wallet Name (optional)' })).toHaveValue('Team treasury')
        await expect(page.getByRole('textbox', { name: 'Multisig public-key JSON' })).toBeVisible()
    })

    test('a malformed shared threshold cannot crash the import window', async ({ page }) => {
        await setup(page)
        const pubkey = btoa(JSON.stringify({ '@type': '/tm.PubKeyMultisig', threshold: { nested: 'bad' }, pubkeys: [{}, {}] }))
        await page.goto(`${OS_ON}/os/multisig/import?pubkey=${encodeURIComponent(pubkey)}`)
        await expect(page.getByText('Shared multisig configuration')).toBeVisible()
        await expect(page.getByText('Threshold:', { exact: false })).toContainText('?/2')
        await expect(page.getByRole('textbox', { name: 'Multisig public-key JSON' })).toBeVisible()
    })

    test('a direct native transaction URL explains the release hold without signing controls', async ({ page }) => {
        await setup(page)
        await page.route('**/memba.v1.MultisigService/GetTransaction', route => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({
                transaction: { ...pending, multisigPubkeyJson: '{"@type":"/tm.PubKeyMultisig"}' },
                nativeTxBytes: 'AQID',
            }),
        }))
        await page.goto(`${OS_ON}/os/wallet/tx/7`)
        await expect(page.getByText('Native signing and broadcasting are on hold pending release approval.')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Sign Transaction' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Broadcast to Chain' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Paste gnokey Sig' })).toHaveCount(0)
    })
})
