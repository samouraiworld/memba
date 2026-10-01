import { createHash } from 'node:crypto'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { createNativeMultisig, memberAddress, nativeAddress } from '../../src/lib/nativeMultisig'
import { OS_NATIVE_MSIG, OS_ON } from '../../playwright.os.config'
import { fulfillOnchainReads, isOnchainRead, mockAppChainStatus } from '../helpers/onchain'

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

const onChain = (address: string, type: string) => JSON.stringify({ BaseAccount: { address, pub_key: { '@type': type }, account_number: '5', sequence: '1' } })

/** The tx-indexer, reached through the backend's /api/indexer proxy: no live read escapes a spec. */
const RECEIVED_HASH = Buffer.from('a'.repeat(64), 'hex').toString('base64')
const SENT_HASH_HEX = 'B'.repeat(64)
async function stubIndexer(page: Page, transfers: { hash: string; from: string; to: string; amount: string }[] = [], fail = false) {
    await page.route('**/api/indexer**', (route) => {
        if (fail) return route.fulfill({ status: 502, contentType: 'text/plain', body: 'upstream fetch failed' })
        const query = String(JSON.parse(route.request().postData() ?? '{}').query ?? '')
        const data = query.includes('latestBlockHeight') ? { latestBlockHeight: 480_000 }
            : query.includes('getBlocks') ? { getBlocks: [] }
            : { transactions: transfers.map((t, i) => ({ hash: t.hash, block_height: 476_387 + i, messages: [{ value: { __typename: 'BankMsgSend', from_address: t.from, to_address: t.to, amount: t.amount } }] })) }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) })
    })
}

async function setup(page: Page) {
    await stubIndexer(page)
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
    const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    await page.route('**/memba.v1.MultisigService/Multisigs', (route) => route.fulfill(json({ multisigs: [team, invite] })))
    await page.route('**/memba.v1.MultisigService/MultisigInfo', (route) => route.fulfill(json({ multisig: team })))
    await page.route('**/memba.v1.MultisigService/Transactions', (route) =>
        route.fulfill(json({ transactions: /EXECUTED/.test(route.request().postData() ?? '') ? [done] : [pending, ready] })))
    await fulfillOnchainReads(page, ({ method, path }) => {
        if (method === 'status') return mockAppChainStatus('gnoland-1')
        if (method === 'abci_query' && path.startsWith('bank/balances/')) return '"42000000ugnot"'
        if (method === 'abci_query' && path === 'auth/gasprice') return '{"gas":1000,"price":"1ugnot"}'
        if (method === 'abci_query' && path === `auth/accounts/${CAROL}`) return onChain(CAROL, '/tm.PubKeySecp256k1')
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

    test('a multisig window lists what it received and sent on chain, naming the proposal a send executed', async ({ page }) => {
        await setup(page)
        const executed = { ...done, finalHash: SENT_HASH_HEX }
        await page.route('**/memba.v1.MultisigService/Transactions', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ transactions: /EXECUTED/.test(route.request().postData() ?? '') ? [executed] : [] }) }))
        await stubIndexer(page, [
            { hash: RECEIVED_HASH, from: BOB, to: MSIG, amount: '1100000ugnot' },
            { hash: Buffer.from(SENT_HASH_HEX, 'hex').toString('base64'), from: MSIG, to: CAROL, amount: '5000000ugnot' },
        ])
        await page.goto(`${OS_ON}/os/multisig/${MSIG}`)
        const transfers = win(page, `Multisig ${MSIG.slice(0, 8)}…${MSIG.slice(-4)}`).getByRole('region', { name: 'Received and sent' })
        await expect(transfers.getByText('Transfers in the last 40,000 blocks, from the gno.land indexer.')).toBeVisible()
        const received = transfers.getByRole('listitem').filter({ hasText: 'Received 1.1 GNOT' })
        await expect(received.getByText(`from ${BOB}`)).toBeVisible()
        await expect(received.getByText('Block 476,387')).toBeVisible()
        await expect(received.getByRole('button', { name: /View proposal/ })).toHaveCount(0)
        await expect(received.getByRole('link', { name: 'Transaction' })).toHaveAttribute('href', `https://gnoscan.io/transactions/details?txhash=${'a'.repeat(64)}&chainId=gnoland-1`)
        const sent = transfers.getByRole('listitem').filter({ hasText: 'Sent 5 GNOT' })
        await expect(sent.getByText(`to ${CAROL}`)).toBeVisible()
        await sent.getByRole('button', { name: 'View proposal #3' }).click()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/wallet/tx/3')
    })

    test('a window says when it shows only the newest transfers, and when there are none', async ({ page }) => {
        await setup(page)
        await stubIndexer(page, Array.from({ length: 20 }, (_, i) => ({ hash: Buffer.from(String(i).padStart(64, '0'), 'hex').toString('base64'), from: BOB, to: MSIG, amount: '1ugnot' })))
        await page.goto(`${OS_ON}/os/multisig/${MSIG}`)
        const transfers = win(page, `Multisig ${MSIG.slice(0, 8)}…${MSIG.slice(-4)}`).getByRole('region', { name: 'Received and sent' })
        await expect(transfers.getByText('Showing the 20 newest transfers: older ones in that range may not appear.')).toBeVisible()
        await expect(transfers.getByRole('listitem')).toHaveCount(20)
        await stubIndexer(page, [])
        await page.reload()
        await expect(win(page, `Multisig ${MSIG.slice(0, 8)}…${MSIG.slice(-4)}`).getByRole('region', { name: 'Received and sent' }).getByText('No transfers in recent blocks.')).toBeVisible()
    })

    test('when the indexer cannot answer, the window says so and claims no transfers', async ({ page }) => {
        await setup(page)
        await stubIndexer(page, [], true)
        await page.goto(`${OS_ON}/os/multisig/${MSIG}`)
        const transfers = win(page, `Multisig ${MSIG.slice(0, 8)}…${MSIG.slice(-4)}`).getByRole('region', { name: 'Received and sent' })
        await expect(transfers.getByRole('alert')).toHaveText("Couldn't read this account's transfers: the indexer did not answer, or this account moved more than it returns at once. Try again")
        await expect(transfers.getByText('No transfers in recent blocks.')).toHaveCount(0)
    })

    test('a guest sees the Multisig app and an account’s address and balance, named by the chain, and is asked to connect only where their own data would be', async ({ page }) => {
        await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
        await stubIndexer(page, [{ hash: RECEIVED_HASH, from: BOB, to: MSIG, amount: '1100000ugnot' }])
        await fulfillOnchainReads(page, ({ method, path }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (method === 'abci_query' && path.startsWith('bank/balances/')) return '"42000000ugnot"'
            if (method === 'abci_query' && path === `auth/accounts/${MSIG}`) return onChain(MSIG, '/tm.PubKeyMultisig')
            if (method === 'abci_query' && path === `auth/accounts/${ALICE}`) return onChain(ALICE, '/tm.PubKeySecp256k1')
            return null
        })
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.goto(`${OS_ON}/os/multisig`)
        const app = win(page, 'Multisig')
        await expect(app.getByRole('button', { name: 'Import' })).toBeEnabled()
        await expect(app.getByText('Connect a wallet to see the multisigs you sign for.')).toBeVisible()
        await expect(app.getByText(/^A multisig is a shared account/)).toBeVisible()

        await page.goto(`${OS_ON}/os/multisig/${MSIG}`)
        const account = win(page, `Multisig ${MSIG.slice(0, 8)}…${MSIG.slice(-4)}`)
        await expect(account.getByText('Multisig account', { exact: true })).toBeVisible()
        await expect(account.getByText(MSIG)).toBeVisible()
        await expect(account.getByText('42 GNOT')).toBeVisible()
        await expect(account.getByRole('button', { name: 'Copy gnoland-1 deposit address' })).toBeVisible()
        await expect(account.getByText("A multisig's members see its members, threshold and transactions here. Connect a wallet to see them.")).toBeVisible()
        // Transfers are public chain data: a guest sees them too.
        await expect(account.getByRole('region', { name: 'Received and sent' }).getByText('Received 1.1 GNOT')).toBeVisible()

        // A link can carry any address: a single key is not dressed as a treasury, nor is one the chain has no key for.
        for (const [address, says] of [[ALICE, 'This address is a single-key account, not a multisig.'], [BOB, 'Not yet confirmed as a multisig on chain: nothing has been signed from this address.']]) {
            await page.goto(`${OS_ON}/os/multisig/${address}`)
            const other = win(page, `Multisig ${address.slice(0, 8)}…${address.slice(-4)}`)
            await expect(other.getByText(says)).toBeVisible()
            await expect(other.getByText('Account', { exact: true })).toBeVisible()
            await expect(other.getByText('42 GNOT')).toBeVisible()
            await expect(other.getByRole('button', { name: /deposit address/ })).toHaveCount(0)
            // Only an address that may be a multisig has members to connect for.
            await expect(other.getByText("A multisig's members see")).toHaveCount(address === ALICE ? 0 : 1)
        }

        await page.goto(`${OS_ON}/os/multisig/${MSIG}`)
        await win(page, `Multisig ${MSIG.slice(0, 8)}…${MSIG.slice(-4)}`).getByRole('button', { name: 'Connect' }).click()
        await expect(page.getByRole('dialog', { name: 'Connect a wallet' })).toBeVisible()
    })

    test('a connected member of other multisigs sees this account’s public face and is told they are not a member', async ({ page }) => {
        await setup(page)
        await page.route('**/memba.v1.MultisigService/MultisigInfo', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'permission_denied', message: 'not a member' }) }))
        await page.goto(`${OS_ON}/os/multisig/${MSIG}`)
        const account = win(page, `Multisig ${MSIG.slice(0, 8)}…${MSIG.slice(-4)}`)
        await expect(account.getByText('You are not a member of this multisig.')).toBeVisible()
        await expect(account.getByText(MSIG)).toBeVisible()
        await expect(account.getByText('42 GNOT')).toBeVisible()
        await expect(account.getByText("Couldn't load this multisig.")).toHaveCount(0)

        // A single key has no members: the chain's word stands alone.
        await page.goto(`${OS_ON}/os/multisig/${CAROL}`)
        const single = win(page, `Multisig ${CAROL.slice(0, 8)}…${CAROL.slice(-4)}`)
        await expect(single.getByText('This address is a single-key account, not a multisig.')).toBeVisible()
        await expect(single.getByText('You are not a member of this multisig.')).toHaveCount(0)
    })

    test('a guest opens the import and creation forms, each with its own connect prompt and a disabled submit', async ({ page }) => {
        await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.goto(`${OS_ON}/os/multisig/import`)
        await expect(page.getByText('Connect your wallet to import a multisig')).toBeVisible()
        await page.getByLabel('Multisig Address').fill(MSIG)
        await expect(page.getByRole('button', { name: 'Import account', exact: true })).toBeDisabled()
        await page.locator('.os-classic').getByRole('button', { name: 'Connect wallet' }).click()
        await expect(page.getByRole('dialog', { name: 'Connect a wallet' })).toBeVisible()
        await page.goto(`${OS_NATIVE_MSIG}/os/multisig/create`)
        await expect(page.getByText('Connect your wallet to create a multisig')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Create Multisig' })).toBeDisabled()
        await expect(page.locator('.os-classic').getByRole('button', { name: 'Connect wallet' })).toBeVisible()
        await page.goto(`${OS_NATIVE_MSIG}/os/multisig/${MSIG}/propose`)
        await expect(page.getByText('Connect your wallet to propose a transaction')).toBeVisible()
        await expect(page.locator('.os-classic').getByRole('button', { name: 'Connect wallet' })).toBeVisible()
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

// Native signing is off in production (VITE_ENABLE_NATIVE_GNO_MULTISIG): these run on the OS server built with it on.
// The chain answers through the stubbed RPC and the backend through Connect JSON, so every send is counted.
test.describe('Memba OS multisig · native broadcast', () => {
    const BYTES = Buffer.from([1, 2, 3])
    const HASH = createHash('sha256').update(BYTES).digest('hex').toUpperCase()
    const nativeTx = { ...ready, multisigPubkeyJson: '{"@type":"/tm.PubKeyMultisig"}', feeJson: '{"gas_wanted":"200000","gas_fee":"10000ugnot"}' }
    const connectError = (code: string, status: number) => ({ status, contentType: 'application/json', body: JSON.stringify({ code, message: code }) })

    /** `complete` answers each Complete call in turn; `broadcast` each send (default: it lands). */
    async function chainAndBackend(page: Page, opts: { complete: ('absent' | 'recorded' | 'unavailable')[]; broadcast: ('lands' | 'lost')[] }) {
        const state = { recorded: '', completeCalls: [] as string[], broadcasts: 0 }
        await page.route('**/memba.v1.MultisigService/GetTransaction', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ transaction: { ...nativeTx, finalHash: state.recorded }, nativeTxBytes: BYTES.toString('base64') }),
        }))
        await page.route('**/memba.v1.MultisigService/CompleteTransaction', (route) => {
            const hash = String(JSON.parse(route.request().postData() ?? '{}').finalHash ?? '')
            state.completeCalls.push(hash)
            const answer = opts.complete.shift() ?? 'unavailable'
            if (answer === 'absent') return route.fulfill(connectError('failed_precondition', 400))
            if (answer === 'unavailable') return route.fulfill(connectError('unavailable', 503))
            state.recorded = hash
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        })
        // Whichever RPC the build is configured with: the same hosts the shared on-chain stub serves.
        await page.route('**/*', (route) => {
            let body: { id?: unknown; method?: string; params?: { tx?: string } } = {}
            try { body = JSON.parse(route.request().postData() ?? '{}') } catch { /* not JSON-RPC */ }
            if (!isOnchainRead(route.request().url()) || body.method !== 'broadcast_tx_commit') return route.fallback()
            state.broadcasts++
            expect(body.params?.tx).toBe(BYTES.toString('base64'))
            if (opts.broadcast.shift() === 'lost') return route.abort('connectionreset')
            const ok = { ResponseBase: { Error: null, Data: null, Log: '', Info: '', Events: null } }
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { check_tx: ok, deliver_tx: ok, hash: Buffer.from(HASH, 'hex').toString('base64'), height: '1234' } }) })
        })
        return state
    }

    async function broadcast(page: Page) {
        await page.getByRole('button', { name: 'Broadcast to Chain' }).click()
        await page.getByRole('alertdialog', { name: 'Review transaction' }).getByRole('button', { name: 'Confirm & Broadcast' }).click()
    }

    test('a proposal at its threshold is checked against the chain, sent once, and recorded', async ({ page }) => {
        await setup(page)
        const state = await chainAndBackend(page, { complete: ['absent', 'recorded'], broadcast: [] })
        await page.goto(`${OS_NATIVE_MSIG}/os/wallet/tx/9`)
        await broadcast(page)
        await expect(page.getByText(HASH)).toBeVisible()
        await expect(page.getByRole('button', { name: 'Broadcast to Chain' })).toHaveCount(0)
        expect(state.broadcasts).toBe(1)
        expect(state.completeCalls).toEqual([HASH, HASH])
    })

    test('a lost reply is reported as unknown with the hash, and the next press finds it on chain and sends nothing', async ({ page }) => {
        await setup(page)
        const state = await chainAndBackend(page, { complete: ['absent', 'recorded'], broadcast: ['lost'] })
        await page.goto(`${OS_NATIVE_MSIG}/os/wallet/tx/9`)
        await broadcast(page)
        await expect(page.getByRole('alert').filter({ hasText: 'Native broadcast outcome unknown' })).toHaveText(`Native broadcast outcome unknown. Expected transaction hash ${HASH}. Press Broadcast again: Memba checks the chain first and sends only if the transaction is not there.`)
        expect(state.broadcasts).toBe(1)
        await broadcast(page)
        await expect(page.getByText('This transaction was already executed on chain. Nothing was sent; Memba recorded the result.')).toBeVisible()
        await expect(page.getByText(HASH).first()).toBeVisible()
        expect(state.broadcasts).toBe(1)
        expect(state.completeCalls).toEqual([HASH, HASH])
    })

    test('a lost reply whose transaction never reached the chain is sent exactly once more, and the warning clears', async ({ page }) => {
        await setup(page)
        const state = await chainAndBackend(page, { complete: ['absent', 'absent', 'recorded'], broadcast: ['lost', 'lands'] })
        await page.goto(`${OS_NATIVE_MSIG}/os/wallet/tx/9`)
        await broadcast(page)
        const warning = page.getByRole('alert').filter({ hasText: 'Native broadcast outcome unknown' })
        await expect(warning).toBeVisible()
        await broadcast(page)
        await expect(page.getByText(HASH)).toBeVisible()
        await expect(warning).toHaveCount(0)
        expect(state.broadcasts).toBe(2)
        expect(state.completeCalls).toEqual([HASH, HASH, HASH])
    })

    test('when the chain check cannot be answered, nothing is sent', async ({ page }) => {
        await setup(page)
        const state = await chainAndBackend(page, { complete: ['unavailable'], broadcast: [] })
        await page.goto(`${OS_NATIVE_MSIG}/os/wallet/tx/9`)
        await broadcast(page)
        await expect(page.getByText("Couldn't check whether this transaction is already on chain. Nothing was sent; try again in a moment.")).toBeVisible()
        expect(state.broadcasts).toBe(0)
        await expect(page.getByRole('button', { name: 'Broadcast to Chain' })).toBeEnabled()
    })

    test('a node a block behind records the sent transaction on its own, after asking again', async ({ page }) => {
        await setup(page)
        const state = await chainAndBackend(page, { complete: ['absent', 'absent', 'recorded'], broadcast: [] })
        await page.goto(`${OS_NATIVE_MSIG}/os/wallet/tx/9`)
        await broadcast(page)
        // Recorded: the recovery card closes and the hash stays as the transaction's.
        await expect.poll(() => state.recorded, { timeout: 15_000 }).toBe(HASH)
        await expect(page.getByRole('status').filter({ hasText: 'Broadcast receipt recovery' })).toHaveCount(0)
        await expect(page.getByText(HASH)).toBeVisible()
        expect(state.broadcasts).toBe(1)
        expect(state.completeCalls).toEqual([HASH, HASH, HASH])
    })

    test('a sent transaction whose recording failed keeps its hash, and the retry only records it', async ({ page }) => {
        await setup(page)
        // The recording is asked three times, about a block apart, before the page gives up.
        const state = await chainAndBackend(page, { complete: ['absent', 'unavailable', 'unavailable', 'unavailable', 'recorded'], broadcast: [] })
        await page.goto(`${OS_NATIVE_MSIG}/os/wallet/tx/9`)
        await broadcast(page)
        const recovery = page.getByRole('status').filter({ hasText: 'Broadcast receipt recovery' })
        await expect(recovery).toContainText(HASH)
        await expect(page.getByRole('button', { name: 'Broadcast to Chain' })).toHaveCount(0)
        await recovery.getByRole('button', { name: 'Retry receipt verification' }).click()
        await expect(recovery).toHaveCount(0)
        await expect(page.getByText(HASH)).toBeVisible()
        expect(state.broadcasts).toBe(1)
        expect(state.completeCalls).toEqual([HASH, HASH, HASH, HASH, HASH])
    })
})

// The demo path, end to end on the native server: a 2-of-3 is created from its members' published keys,
// a send is proposed at the network fee, two members sign in their own browsers, and the second broadcasts.
// The backend is a small in-memory stand-in that answers in Connect JSON; the chain is the stubbed RPC.
test.describe('Memba OS multisig · native lifecycle', () => {
    const key = (n: number) => {
        const pub = Buffer.from(secp256k1.getPublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? n : 7)), true)).toString('base64')
        return { pub, address: memberAddress(pub) }
    }
    const [A, B, C] = [key(1), key(2), key(3)]
    const MSIG_NATIVE = nativeAddress(createNativeMultisig([A, B, C].map((m) => ({ address: m.address, pubkeyValue: m.pub })), 2))
    const PAYEE = CAROL
    const BYTES = Buffer.from('native aggregate from the earliest two signatures')
    const HASH = createHash('sha256').update(BYTES).digest('hex').toUpperCase()

    type Fake = { multisig: Record<string, unknown> | null; tx: Record<string, unknown> & { signatures: { userAddress: string; value: string; verified: boolean }[]; finalHash: string } | null; onChain: boolean; broadcasts: number; lose: number; signDocs: unknown[] }

    async function memberSession(browser: Browser, me: { pub: string; address: string }, fake: Fake): Promise<Page> {
        const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage()
        await stubIndexer(page)
        await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
        const ok = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
        const req = (route: { request(): { postData(): string | null } }) => JSON.parse(route.request().postData() ?? '{}')
        await page.route('**/memba.v1.MultisigService/CreateOrJoinMultisig', (route) => {
            const r = req(route)
            fake.multisig = { address: r.expectedMultisigAddress, chainId: r.chainId, name: r.name, joined: true, threshold: 2, membersCount: 3, usersAddresses: [A, B, C].map((m) => m.address), pubkeyJson: r.multisigPubkeyJson }
            return route.fulfill(ok({ multisigAddress: r.expectedMultisigAddress }))
        })
        await page.route('**/memba.v1.MultisigService/Multisigs', (route) => route.fulfill(ok({ multisigs: fake.multisig ? [fake.multisig] : [] })))
        await page.route('**/memba.v1.MultisigService/MultisigInfo', (route) => route.fulfill(ok({ multisig: fake.multisig })))
        await page.route('**/memba.v1.MultisigService/CreateTransaction', (route) => {
            const r = req(route)
            fake.tx = { id: 1, multisigAddress: r.multisigAddress, chainId: r.chainId, msgsJson: r.msgsJson, feeJson: r.feeJson, accountNumber: r.accountNumber, sequence: r.sequence ?? 0, memo: r.memo, threshold: 2, membersCount: 3, multisigPubkeyJson: fake.multisig!.pubkeyJson, signatures: [], finalHash: '' }
            return route.fulfill(ok({ transactionId: 1 }))
        })
        await page.route('**/memba.v1.MultisigService/Transactions', (route) => route.fulfill(ok({ transactions: fake.tx && /EXECUTED/.test(route.request().postData() ?? '') === !!fake.tx.finalHash ? [fake.tx] : [] })))
        await page.route('**/memba.v1.MultisigService/GetTransaction', (route) => route.fulfill(ok({
            transaction: fake.tx, ...(fake.tx && fake.tx.signatures.length >= 2 ? { nativeTxBytes: BYTES.toString('base64') } : {}),
        })))
        await page.route('**/memba.v1.MultisigService/SignTransaction', (route) => {
            fake.tx!.signatures.push({ userAddress: me.address, value: req(route).signature, verified: true })
            return route.fulfill(ok({}))
        })
        await page.route('**/memba.v1.MultisigService/CompleteTransaction', (route) => {
            if (!fake.onChain || req(route).finalHash !== HASH) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'failed_precondition', message: 'not on chain' }) })
            fake.tx!.finalHash = HASH
            return route.fulfill(ok({}))
        })
        const account = (address: string, pub?: string) => JSON.stringify({ BaseAccount: { address, ...(pub ? { pub_key: { '@type': '/tm.PubKeySecp256k1', value: pub } } : {}), account_number: address === MSIG_NATIVE ? '77' : '1', sequence: '0' } })
        await fulfillOnchainReads(page, ({ method, path }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (method !== 'abci_query') return null
            if (path.startsWith('bank/balances/')) return '"5000000ugnot"'
            if (path === 'auth/gasprice') return '{"gas":1000,"price":"1ugnot"}'
            const member = [A, B, C].find((m) => path === `auth/accounts/${m.address}`)
            if (member) return account(member.address, member.pub)
            if (path === `auth/accounts/${MSIG_NATIVE}`) return account(MSIG_NATIVE)
            return null
        })
        await page.route('**/*', (route) => {
            let body: { id?: unknown; method?: string } = {}
            try { body = JSON.parse(route.request().postData() ?? '{}') } catch { /* not JSON-RPC */ }
            if (!isOnchainRead(route.request().url()) || body.method !== 'broadcast_tx_commit') return route.fallback()
            fake.broadcasts++
            fake.onChain = true
            if (fake.lose-- > 0) return route.abort('connectionreset')
            const done = { ResponseBase: { Error: null, Data: null, Log: '', Info: '', Events: null } }
            return route.fulfill(ok({ jsonrpc: '2.0', id: body.id, result: { check_tx: done, deliver_tx: done, hash: Buffer.from(HASH, 'hex').toString('base64'), height: '1234' } }))
        })
        await page.exposeFunction('__signed', (doc: unknown) => { fake.signDocs.push(doc) })
        await page.addInitScript(({ address, pub }) => {
            localStorage.setItem('memba_os_skip_intro', '1')
            localStorage.setItem('memba_adena_connected', 'true')
            localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'e2e', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'e2e-only' }))
            Object.defineProperty(window, 'adena', { value: {
                GetAccount: async () => ({ status: 'success', data: { address, coins: '0ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: pub }, accountNumber: '1', sequence: '0', chainId: 'gnoland-1' } }),
                GetNetwork: async () => ({ status: 'success', data: { chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land' } }),
                On: () => true,
                SignMultisigTransaction: async (doc: unknown) => {
                    await (window as unknown as { __signed(doc: unknown): Promise<void> }).__signed(doc)
                    return { status: 'success', data: { signature: { signature: btoa(`signature of ${address}`) } } }
                },
            } })
        }, me)
        return page
    }

    async function signAs(page: Page) {
        await page.goto(`${OS_NATIVE_MSIG}/os/wallet/tx/1`)
        await page.getByRole('button', { name: 'Sign Transaction' }).click()
        await page.getByRole('alertdialog', { name: 'Review transaction' }).getByRole('button', { name: 'Confirm & Sign' }).click()
        await expect(page.getByRole('button', { name: 'Already Signed' })).toBeVisible()
    }

    test('a 2-of-3 is created from published keys, a send is proposed at the network fee, two members sign, and the transaction is broadcast once even when its reply is lost', async ({ browser }) => {
        const fake: Fake = { multisig: null, tx: null, onChain: false, broadcasts: 0, lose: 1, signDocs: [] }
        const alice = await memberSession(browser, A, fake)

        // Create: three members by address, their keys read from the chain, 2 of 3.
        await alice.goto(`${OS_NATIVE_MSIG}/os/multisig/create`)
        await alice.getByLabel('Wallet Name').fill('Demo treasury')
        for (const [i, m] of [A, B, C].entries()) {
            await alice.getByLabel(`Member ${i + 1} address`).fill(m.address)
            await alice.getByRole('button', { name: `Fetch member ${i + 1} public key` }).click()
        }
        await expect(alice.getByText(MSIG_NATIVE)).toBeVisible()
        await alice.getByRole('button', { name: 'Create Multisig' }).click()
        // The new wallet opens, under the name it was given; the create window keeps only its result.
        await expect.poll(() => new URL(alice.url()).pathname).toBe(`/os/multisig/${MSIG_NATIVE}`)
        await expect(win(alice, `Multisig ${MSIG_NATIVE.slice(0, 8)}…${MSIG_NATIVE.slice(-4)}`).getByText('Demo treasury')).toBeVisible()
        await expect(alice.getByRole('button', { name: 'Create Multisig' })).toHaveCount(0)
        expect(fake.multisig?.address).toBe(MSIG_NATIVE)

        // Propose 1 GNOT at twice the network price for the gas limit: 10,000,000 gas at 1 ugnot per 1,000, times 2.
        await alice.goto(`${OS_NATIVE_MSIG}/os/multisig/${MSIG_NATIVE}/propose`)
        await alice.getByPlaceholder('g1recipient...').fill(PAYEE)
        await alice.getByPlaceholder('1.0').fill('1')
        await expect(alice.getByLabel('Native fee (ugnot)')).toHaveValue('20000')
        await alice.getByRole('button', { name: 'Propose Send' }).click()
        await expect.poll(() => fake.tx?.id).toBe(1)
        expect(JSON.parse(String(fake.tx!.feeJson))).toEqual({ gas_wanted: '10000000', gas_fee: '20000ugnot' })
        expect(String(fake.tx!.msgsJson)).toContain('1000000ugnot')
        expect(fake.tx!.accountNumber).toBe(77)

        // Two members sign, each in their own browser, the same document.
        await signAs(alice)
        const bob = await memberSession(browser, B, fake)
        await signAs(bob)
        expect(fake.tx!.signatures.map((s) => s.userAddress)).toEqual([A.address, B.address])
        expect(fake.signDocs).toHaveLength(2)
        expect(fake.signDocs[1]).toEqual(fake.signDocs[0])
        // What each member's wallet signed is the fee shown and stored.
        expect(fake.signDocs[0]).toMatchObject({ tx: { fee: { gas_wanted: '10000000', gas_fee: '20000ugnot' } } })

        // Bob broadcasts. The node's reply is lost; the next press finds it on chain and sends nothing.
        await bob.getByRole('button', { name: 'Broadcast to Chain' }).click()
        await bob.getByRole('alertdialog', { name: 'Review transaction' }).getByRole('button', { name: 'Confirm & Broadcast' }).click()
        await expect(bob.getByRole('alert').filter({ hasText: 'Native broadcast outcome unknown' })).toContainText(HASH)
        await bob.getByRole('button', { name: 'Broadcast to Chain' }).click()
        await bob.getByRole('alertdialog', { name: 'Review transaction' }).getByRole('button', { name: 'Confirm & Broadcast' }).click()
        await expect(bob.getByText('This transaction was already executed on chain. Nothing was sent; Memba recorded the result.')).toBeVisible()
        await expect(bob.getByText(HASH).first()).toBeVisible()
        expect(fake.broadcasts).toBe(1)
        expect(fake.tx!.finalHash).toBe(HASH)
        await alice.context().close()
        await bob.context().close()
    })
})
