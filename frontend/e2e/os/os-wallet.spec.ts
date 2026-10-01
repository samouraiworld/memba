import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
import { fulfillOnchainReads, isOnchainRead, mockAppChainStatus } from '../helpers/onchain'

// Day 5b: the Wallet window and a GNOT send through the Memba review (D37),
// with a stub Adena that records what it was asked to sign. Nothing reaches a chain.

const ALICE = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5'
const BOB = 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c'
const HASH = 'a'.repeat(64)

async function offline(page: Page) {
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
    await fulfillOnchainReads(page, ({ method, path }) => {
        if (method === 'status') return mockAppChainStatus('gnoland-1')
        if (method === 'tx') return { hash: HASH, height: '435604', tx_result: { ResponseBase: { Error: null } } }
        if (method === 'abci_query' && path === 'auth/gasprice') return '{"gas":1000,"price":"1ugnot"}'
        // 250 GNOT
        if (method === 'abci_query' && path.startsWith('bank/balances/')) return '"250000000ugnot"'
        return null
    })
    await page.setViewportSize({ width: 1280, height: 860 })
}

async function member(page: Page, mode: 'ok' | 'timeout' | 'hold-timeout' | 'empty-hash' = 'ok') {
    await page.addInitScript(({ address, mode, hash }) => {
        localStorage.setItem('memba_os_skip_intro', '1')
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'e2e', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'e2e-only' }))
        const calls: unknown[] = []
        Object.defineProperty(window, '__adenaCalls', { value: calls })
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '250000000ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '1', sequence: '1', chainId: 'gnoland-1' } }),
            GetNetwork: async () => ({ status: 'success', data: { chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land' } }),
            On: () => true,
            DoContract: async (tx: unknown) => {
                calls.push(tx)
                if (mode === 'hold-timeout') {
                    await new Promise<void>((resolve) => {
                        ;(window as unknown as { __releaseAdena?: () => void }).__releaseAdena = resolve
                    })
                    throw new Error('network timeout')
                }
                if (mode === 'timeout') {
                    throw new Error('network timeout')
                }
                return { status: 'success', data: { hash: mode === 'empty-hash' ? '' : hash } }
            },
        } })
    }, { address: ALICE, mode, hash: HASH })
}

type AdenaCall = { messages: { type: string; value: Record<string, unknown> }[]; memo: string; gasWanted: number }
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __adenaCalls: AdenaCall[] }).__adenaCalls)
const win = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

test.describe('Memba OS wallet', () => {
    test.beforeEach(async ({ page }) => { await offline(page) })

    test('a guest is asked to connect', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.goto(`${OS_ON}/os/wallet`)
        await expect(win(page, 'Wallet').getByText('No wallet connected')).toBeVisible()
    })

    test('the wallet shows the balance; a send to a new address needs the address check, and Adena gets exactly one /bank.MsgSend', async ({ page }) => {
        await member(page)
        await page.goto(`${OS_ON}/os/wallet`)
        const wallet = win(page, 'Wallet')
        await expect(wallet.getByText('250 GNOT')).toBeVisible()
        await wallet.getByRole('button', { name: 'Send' }).click()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/wallet/send')
        const send = win(page, 'Send')

        await send.getByRole('button', { name: 'Review…' }).click()
        await expect(send.getByText('Who should receive it?')).toBeVisible()
        await send.getByLabel('To', { exact: true }).fill(ALICE)
        await expect(send.getByText("That's your own address.")).toBeVisible()
        await send.getByLabel('To', { exact: true }).fill(BOB)
        await send.getByLabel('Amount', { exact: true }).fill('300')
        await expect(send.getByText(/More than you have/)).toBeVisible()
        await send.getByLabel('Amount', { exact: true }).fill('1.5')
        await send.getByLabel('Memo', { exact: true }).fill('thanks')
        await expect(send.getByText('Extra check at review: new address')).toBeVisible()
        await send.getByRole('button', { name: 'Review…' }).click()

        const review = page.getByRole('dialog', { name: 'Review · Send' })
        // What Adena shows for a bank send: the message and its type, no recipient or amount.
        const adena = review.locator('details', { hasText: 'Adena should show' })
        await expect(adena.getByText('/bank.MsgSend', { exact: true })).toBeVisible()
        await expect(adena.getByText('Transfer', { exact: true })).toHaveCount(2)
        await expect(adena.getByText(BOB)).toHaveCount(0)
        await expect(review.getByRole('button', { name: 'Sign in Adena' })).toBeDisabled()
        await review.getByLabel(/I checked the full address with the recipient/).check()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(review).toHaveCount(0)

        const [call] = await calls(page)
        expect(call.messages).toEqual([{ type: '/bank.MsgSend', value: { from_address: ALICE, to_address: BOB, amount: '1500000ugnot' } }])
        expect(call.memo).toBe('thanks')
        await expect(win(page, 'Send')).toHaveCount(0)
        await page.getByRole('button', { name: /Notifications, 1 new/ }).click()
        await expect(page.getByText('Confirmed · Send 1.5 GNOT')).toBeVisible()
    })

    test('an @name is looked up in the user registry, shown with its address, signed to that address, and checked again before Adena', async ({ page }) => {
        // r/sys/users.ResolveName answers (qeval literals); `owner` is read at request time, so it can move mid-test.
        let owner = BOB
        const record = (addr: string, name: string) => `(&(struct{("${addr}" .uverse.address),("${name}" string),(false bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)\n(true bool)`
        await fulfillOnchainReads(page, ({ method, path, arg }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (method === 'tx') return { hash: HASH, height: '435604', tx_result: { ResponseBase: { Error: null } } }
            if (method === 'abci_query' && path === 'auth/gasprice') return '{"gas":1000,"price":"1ugnot"}'
            if (method === 'abci_query' && path.startsWith('bank/balances/')) return '"250000000ugnot"'
            if (method === 'abci_query' && path === 'vm/qeval' && arg.includes('ResolveName("bob")')) return record(owner, 'bob')
            if (method === 'abci_query' && path === 'vm/qeval' && arg.includes('ResolveName(')) return '(nil *gno.land/r/sys/users.UserData)\n(false bool)'
            return null
        })
        await member(page)
        await page.goto(`${OS_ON}/os/wallet/send`)
        const send = win(page, 'Send')
        const to = send.getByLabel('To', { exact: true })
        await to.fill('@nobody')
        await expect(send.getByText('No gno.land user is named @nobody.')).toBeVisible()
        await to.fill('bob')
        await expect(send.getByText(/Start a username with @/)).toBeVisible()
        await to.fill('@Bob')
        await expect(send.getByText(`@bob is ${BOB}`)).toBeVisible()
        await send.getByLabel('Amount', { exact: true }).fill('2')
        await send.getByRole('button', { name: 'Review…' }).click()

        const review = page.getByRole('dialog', { name: 'Review · Send' })
        await expect(review.getByText(`@bob · ${BOB}`)).toBeVisible()
        await review.getByLabel(/I checked the full address/).check()
        // The name changes owner after the review: nothing is sent.
        owner = ALICE
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(review.getByRole('alert')).toContainText('@bob now points to another address')
        expect(await calls(page)).toHaveLength(0)

        // Back to Bob: the same review signs to the address it showed.
        owner = BOB
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(review).toHaveCount(0)
        const [call] = await calls(page)
        expect(call.messages).toEqual([{ type: '/bank.MsgSend', value: { from_address: ALICE, to_address: BOB, amount: '2000000ugnot' } }])
    })

    test('switching the Adena account after the review stops the send before the wallet opens', async ({ page }) => {
        await member(page)
        await page.goto(`${OS_ON}/os/wallet/send`)
        const send = win(page, 'Send')
        await send.getByLabel('To', { exact: true }).fill(BOB)
        await send.getByLabel('Amount', { exact: true }).fill('12,5')
        await expect(send.getByText('Use a dot for decimals, and no commas (12.5).')).toBeVisible()
        await send.getByLabel('Amount', { exact: true }).fill('1')
        await send.getByRole('button', { name: 'Review…' }).click()
        const review = page.getByRole('dialog', { name: 'Review · Send' })
        await review.getByLabel(/I checked the full address/).check()
        // Adena now reports another account; Memba's session still shows the reviewed one.
        await page.evaluate((other) => {
            const a = (window as unknown as { adena: { GetAccount: () => Promise<{ data: { address: string } }> } }).adena
            const get = a.GetAccount
            a.GetAccount = async () => { const r = await get(); r.data.address = other; return r }
        }, BOB)
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        // The broadcaster's live wallet check refuses first: Adena's account is not the connected one.
        await expect(review.getByRole('alert')).toContainText('Your Adena account is not the one connected to Memba')
        expect(await calls(page)).toHaveLength(0)
    })

    test('an unknown outcome locks Send until the member checks it', async ({ page }) => {
        await member(page, 'timeout')
        await page.goto(`${OS_ON}/os/wallet/send`)
        const send = win(page, 'Send')
        await send.getByLabel('To', { exact: true }).fill(BOB)
        await send.getByLabel('Amount', { exact: true }).fill('1')
        await send.getByRole('button', { name: 'Review…' }).click()
        const review = page.getByRole('dialog', { name: 'Review · Send' })
        await review.getByLabel(/I checked the full address/).check()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(send.getByText('Outcome unknown')).toBeVisible()
        await page.reload()
        const again = win(page, 'Send')
        await expect(again.getByText('Outcome unknown')).toBeVisible()
        await expect(again.getByRole('button', { name: 'Send again' })).toBeDisabled()
        await again.getByLabel('I checked the previous transaction.').check()
        await again.getByRole('button', { name: 'Send again' }).click()
        await expect(again.getByLabel('To', { exact: true })).toBeVisible()
    })

    test('a success-shaped wallet response without a transaction hash keeps Send locked', async ({ page }) => {
        await member(page, 'empty-hash')
        await page.goto(`${OS_ON}/os/wallet/send`)
        const send = win(page, 'Send')
        await send.getByLabel('To', { exact: true }).fill(BOB)
        await send.getByLabel('Amount', { exact: true }).fill('1')
        await send.getByRole('button', { name: 'Review…' }).click()
        const review = page.getByRole('dialog', { name: 'Review · Send' })
        await review.getByLabel(/I checked the full address/).check()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(send.getByText('Outcome unknown')).toBeVisible()
        await page.reload()
        await expect(win(page, 'Send').getByRole('button', { name: 'Send again' })).toBeDisabled()
    })

    test('a confirmed send recovered after reload retains its selected saved recipient', async ({ page }) => {
        await member(page)
        await page.addInitScript(({ address, to, hash }) => {
            localStorage.setItem(`memba_os_send_lock:gnoland-1:${address}`, JSON.stringify({
                id: 'recovered-attempt', label: 'Send 1 GNOT', hash, at: Date.now(), to, save: true,
            }))
        }, { address: ALICE, to: BOB, hash: HASH })
        await page.goto(`${OS_ON}/os/wallet/send`)
        const send = win(page, 'Send')
        await expect(send.getByText('Waiting for confirmation')).toBeVisible()
        await send.getByRole('button', { name: 'Check status' }).click()
        await expect(send.getByLabel('To', { exact: true })).toBeVisible()
        const records = await page.evaluate((address) => JSON.parse(localStorage.getItem(`memba_os_recipients:gnoland-1:${address}`) ?? 'null'), ALICE)
        expect(records).toEqual({ recent: [BOB], saved: [BOB] })
    })

    test('a recovered send the chain ran and refused is reported as refused, frees Send, saves no recipient, and its note never follows a new send', async ({ page }) => {
        await member(page, 'timeout')
        await page.route('**/*', (route) => {
            let method = new URL(route.request().url()).pathname.replace(/^\/+/, '')
            try { method = JSON.parse(route.request().postData() ?? '{}').method ?? method } catch { /* a GET read */ }
            if (!isOnchainRead(route.request().url()) || method !== 'tx') return route.fallback()
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { hash: HASH, height: '435604', tx_result: { ResponseBase: { Error: { msg: 'insufficient funds' } } } } }) })
        })
        await page.addInitScript(({ address, to, hash }) => {
            localStorage.setItem(`memba_os_send_lock:gnoland-1:${address}`, JSON.stringify({
                id: 'refused-attempt', label: 'Send 1 GNOT', hash, at: Date.now(), to, save: true,
            }))
        }, { address: ALICE, to: BOB, hash: HASH })
        await page.goto(`${OS_ON}/os/wallet/send`)
        const send = win(page, 'Send')
        await send.getByRole('button', { name: 'Check status' }).click()
        const refused = 'The network ran this transaction and refused it: the amount did not move, the network fee was still charged. You can prepare the send again.'
        await expect(send.getByText(refused)).toBeVisible()
        await expect(send.getByLabel('To', { exact: true })).toBeVisible()
        expect(await page.evaluate((address) => localStorage.getItem(`memba_os_recipients:gnoland-1:${address}`), ALICE)).toBeNull()

        // A new send whose outcome is unknown holds Send again: the earlier answer is not shown for it.
        await send.getByLabel('To', { exact: true }).fill(BOB)
        await send.getByLabel('Amount', { exact: true }).fill('1')
        await send.getByRole('button', { name: 'Review…' }).click()
        const review = page.getByRole('dialog', { name: 'Review · Send' })
        await review.getByLabel(/I checked the full address/).check()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(send.getByText('Outcome unknown')).toBeVisible()
        await expect(send.getByText(refused)).toHaveCount(0)
    })

    test('a second tab cannot overwrite or clear an unresolved send from the same wallet', async ({ page, context }) => {
        const second = await context.newPage()
        await offline(second)
        await member(page, 'hold-timeout')
        await member(second)
        await page.goto(`${OS_ON}/os/wallet/send`)
        await second.goto(`${OS_ON}/os/wallet/send`)
        for (const p of [page, second]) {
            const send = win(p, 'Send')
            await send.getByLabel('To', { exact: true }).fill(BOB)
            await send.getByLabel('Amount', { exact: true }).fill('1')
            await send.getByRole('button', { name: 'Review…' }).click()
            await p.getByRole('dialog', { name: 'Review · Send' }).getByLabel(/I checked the full address/).check()
        }
        const review = second.getByRole('dialog', { name: 'Review · Send' })
        const firstSign = page.getByRole('dialog', { name: 'Review · Send' }).getByRole('button', { name: 'Sign in Adena' }).click()
        await expect.poll(async () => (await calls(page)).length).toBe(1)
        const secondSign = review.getByRole('button', { name: 'Sign in Adena' }).click()
        expect(await calls(second)).toHaveLength(0)
        await page.evaluate(() => (window as unknown as { __releaseAdena?: () => void }).__releaseAdena?.())
        await secondSign
        await firstSign
        await expect(win(page, 'Send').getByText('Outcome unknown')).toBeVisible()
        await expect(review.getByRole('alert')).toContainText('Another send may still be pending')
        expect(await calls(second)).toHaveLength(0)
        await second.reload()
        await expect(win(second, 'Send').getByText('Outcome unknown')).toBeVisible()
    })

    test('a member can review a send on a 320 px phone without horizontal overflow', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 568 })
        await member(page)
        await page.goto(`${OS_ON}/os/wallet/send`)
        const send = win(page, 'Send')
        await expect(send).toBeVisible()
        await send.getByLabel('To', { exact: true }).fill(BOB)
        await send.getByLabel('Amount', { exact: true }).fill('1')
        await expect(send.getByLabel('Amount', { exact: true })).toHaveAttribute('aria-describedby', 'os-send-amount-detail')
        await send.getByRole('button', { name: 'Review…' }).click()
        await expect(page.getByRole('dialog', { name: 'Review · Send' })).toBeVisible()
        expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(320)
    })
})
