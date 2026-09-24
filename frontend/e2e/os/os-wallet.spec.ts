import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
import { fulfillOnchainReads, mockAppChainStatus } from '../helpers/onchain'

// Day 5b: the Wallet window and a GNOT send through the Memba review (D37),
// with a stub Adena that records what it was asked to sign. Nothing reaches a chain.

const ALICE = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5'
const BOB = 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c'

async function offline(page: Page) {
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]|monitoring\./, (route) => route.abort())
    await fulfillOnchainReads(page, ({ method, path }) => {
        if (method === 'status') return mockAppChainStatus('gnoland-1')
        // 250 GNOT
        if (method === 'abci_query' && path.startsWith('bank/balances/')) return '"250000000ugnot"'
        return null
    })
    await page.setViewportSize({ width: 1280, height: 860 })
}

async function member(page: Page, mode: 'ok' | 'timeout' = 'ok') {
    await page.addInitScript(({ address, mode }) => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'e2e', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'e2e-only' }))
        const calls: unknown[] = []
        Object.defineProperty(window, '__adenaCalls', { value: calls })
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '250000000ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '1', sequence: '1', chainId: 'gnoland-1' } }),
            GetNetwork: async () => ({ data: { rpcUrl: 'https://rpc.gno.land' } }),
            On: () => true,
            DoContract: async (tx: unknown) => {
                calls.push(tx)
                if (mode === 'timeout') throw new Error('network timeout')
                return { status: 'success', data: { hash: 'E2ESENDHASH' } }
            },
        } })
    }, { address: ALICE, mode })
}

type AdenaCall = { messages: { type: string; value: Record<string, unknown> }[]; memo: string; gasWanted: number }
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __adenaCalls: AdenaCall[] }).__adenaCalls)
const win = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

test.describe('Memba OS wallet', () => {
    test.beforeEach(async ({ page }) => { await offline(page) })

    test('a guest is asked to connect', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
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
        await expect(review.getByText('Transfer', { exact: true })).toBeVisible()
        await expect(review.getByRole('button', { name: 'Sign in Adena' })).toBeDisabled()
        await review.getByLabel(/I checked the full address with the recipient/).check()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(review).toHaveCount(0)

        const [call] = await calls(page)
        expect(call.messages).toEqual([{ type: '/bank.MsgSend', value: { from_address: ALICE, to_address: BOB, amount: '1500000ugnot' } }])
        expect(call.memo).toBe('thanks')
        await expect(win(page, 'Send')).toHaveCount(0)
        await page.getByRole('button', { name: /Notifications, 1 new/ }).click()
        await expect(page.getByText('Sent · Send 1.5 GNOT')).toBeVisible()
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
        await expect(review.getByRole('alert')).toContainText('Your wallet changed since the review')
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
})
