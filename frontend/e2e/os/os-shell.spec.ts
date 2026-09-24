import { expect, test, type Page } from '@playwright/test'
import { OS_OFF, OS_ON } from '../../playwright.os.config'

// The four entry scenarios of mockup v4, on the real shell, wallet hooks and
// login code. Adena is a page-level stub and the backend's auth calls are
// fulfilled per test; nothing here talks to a chain.

const ADDR = 'g1us8428u2a5satrlxzagqqa5m6vmuze025anjljj'
const PUBKEY = 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE'

/** Abort egress (RPC, indexer, backend) unless a test routes it first. */
async function offline(page: Page) {
    await page.route(/memba\.v1\.|\.gno\.land|samourai\.live|onbloc\.xyz|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => {
        const host = new URL(route.request().url()).hostname
        if ((host === '127.0.0.1' || host === 'localhost') && !/memba\.v1\./.test(route.request().url())) return route.continue()
        return route.abort()
    })
}

/** A returning member: wallet flag + unexpired token from an earlier visit, Adena already approved. */
async function returningMember(page: Page) {
    await page.addInitScript(({ address, pubkey }) => {
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'e2e', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'e2e-only' }))
        const deny = async () => { throw new Error('e2e: wallet writes disabled') }
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '0ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: pubkey }, accountNumber: '1', sequence: '1', chainId: 'gnoland-1' } }),
            GetNetwork: async () => ({ data: { rpcUrl: 'https://rpc.gno.land' } }),
            On: () => true,
            AddEstablish: deny, DoContract: deny, SignMultisigTransaction: deny,
        } })
    }, { address: ADDR, pubkey: PUBKEY })
}

/** A brand-new wallet: not yet approved for Memba, never transacted (no key on chain, can't sign). */
async function newWallet(page: Page) {
    await page.addInitScript(({ address }) => {
        let approved = false
        const account = () => approved
            ? { status: 'success', data: { address, coins: '0ugnot', publicKey: null, accountNumber: '0', sequence: '0', chainId: 'gnoland-1' } }
            : { status: 'failure', type: 'NOT_CONNECTED' }
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => account(),
            AddEstablish: async () => { approved = true; return { status: 'success' } },
            GetNetwork: async () => ({ data: { rpcUrl: 'https://rpc.gno.land' } }),
            SignMultisigTransaction: async () => ({ status: 'failure', type: 'NO_PUBKEY' }),
            On: () => true,
            DoContract: async () => { throw new Error('e2e: wallet writes disabled') },
        } })
    }, { address: ADDR })
    await page.route('**/memba.v1.MultisigService/GetChallenge', (route) => route.fulfill({
        json: { challenge: { nonce: 'AQID', expiration: '2099-01-01T00:00:00Z', serverSignature: 'CQ==', boundPubkeyHash: '', chainId: 'gnoland-1' } },
    }))
    // What an enforced-auth chain answers for an untransacted wallet.
    await page.route('**/memba.v1.MultisigService/GetToken', (route) => route.fulfill({
        status: 403, json: { code: 'permission_denied', message: 'AUTH-ACTIVATE-01' },
    }))
}

const lockScreen = (page: Page) => page.getByRole('dialog', { name: 'Welcome to Memba' })
const connectModal = (page: Page) => page.getByRole('dialog', { name: 'Connect a wallet' })

test.describe('Memba OS shell · entry scenarios', () => {
    test.beforeEach(async ({ page }) => { await offline(page) })

    test('first visit: lock screen once, then the guest desktop with the Welcome window', async ({ page }) => {
        await page.goto(`${OS_ON}/os`)
        await expect(lockScreen(page)).toBeVisible()
        await page.getByRole('button', { name: 'Continue as guest' }).click()
        await expect(lockScreen(page)).toHaveCount(0)
        await expect(page.getByRole('region', { name: 'Welcome to Memba' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Connect wallet' }).first()).toBeVisible()

        await page.reload()
        await expect(page.getByTestId('memba-os')).toBeVisible()
        await expect(page.getByRole('banner', { name: 'Menu bar' })).toBeVisible()
        await expect(lockScreen(page)).toHaveCount(0)
    })

    test('returning member: the session resumes without the lock screen', async ({ page }) => {
        await returningMember(page)
        await page.goto(`${OS_ON}/os`)
        await expect(page.getByRole('button', { name: `Account ${ADDR}` })).toBeVisible()
        await expect(page.getByText('Welcome back · session resumed')).toBeVisible()
        await expect(lockScreen(page)).toHaveCount(0)
        await expect(page.getByText("Your desk is empty — let's fill it.")).toBeVisible()
        await expect(page.getByRole('button', { name: 'Connect wallet' })).toHaveCount(0)
    })

    test('shared link: opens the proposal as a guest, no lock screen', async ({ page }) => {
        await page.goto(`${OS_ON}/os/dao/memba_dao/proposals/12`)
        await expect(page).toHaveURL(`${OS_ON}/os/dao/memba_dao/proposals/12`)
        await expect(page.getByRole('region', { name: 'memba_dao · Proposal #12' })).toBeVisible()
        await expect(page.getByText('Browsing as guest')).toBeVisible()
        await expect(lockScreen(page)).toHaveCount(0)
        await page.getByRole('status').getByRole('button', { name: 'Connect to vote' }).click()
        await expect(connectModal(page)).toBeVisible()
    })

    test('the root opens Memba OS when the flag is on, and stays classic when it is off', async ({ page }) => {
        await page.goto(`${OS_ON}/`)
        await expect(page).toHaveURL(`${OS_ON}/os`)
        await expect(page.getByTestId('memba-os')).toBeVisible()
        await page.goto(`${OS_OFF}/`)
        await expect(page).toHaveURL(/\/mainnet\/?$/)
        await expect(page.getByTestId('memba-os')).toHaveCount(0)
    })

    test('shared link to an app whose name is also a classic route stays in Memba OS', async ({ page }) => {
        // /:network/feed outranks a plain /os/* route; the path check in App.tsx must win.
        await page.goto(`${OS_ON}/os/feed`)
        await expect(page).toHaveURL(`${OS_ON}/os/feed`)
        await expect(page.getByRole('region', { name: 'Feed' })).toBeVisible()
    })

    test('new wallet: approve, sign, then the activation step', async ({ page }) => {
        await newWallet(page)
        await page.goto(`${OS_ON}/os`)
        await lockScreen(page).getByRole('button', { name: 'Connect wallet' }).click()
        const modal = connectModal(page)
        await expect(modal.getByRole('heading', { name: 'Connect a wallet' })).toBeVisible()
        await modal.getByRole('button', { name: /Adena/ }).click()
        await expect(modal.getByRole('heading', { name: 'Sign the login message' })).toBeVisible()
        await modal.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(modal.getByRole('heading', { name: 'Activate your address' })).toBeVisible()
        await expect(modal.getByText('≈ 0.01 GNOT')).toBeVisible()
        // Signed-out guidance, so it can be put off.
        await modal.getByRole('button', { name: 'Later' }).click()
        await expect(connectModal(page)).toHaveCount(0)
    })

    test('connect without Adena: the install step', async ({ page }) => {
        await page.goto(`${OS_ON}/os`)
        await lockScreen(page).getByRole('button', { name: 'Connect wallet' }).click()
        await connectModal(page).getByRole('button', { name: /Adena/ }).click()
        await expect(connectModal(page).getByRole('heading', { name: 'Adena isn’t installed' })).toBeVisible()
    })

    test('menu bar: mainnet without a testnet warning, start menu opens apps', async ({ page }) => {
        await page.goto(`${OS_ON}/os/wallet`)
        const bar = page.getByRole('banner', { name: 'Menu bar' })
        await expect(bar.getByRole('button', { name: 'Network: gnoland-1' })).toBeVisible()
        await expect(bar.getByText('TESTNET')).toHaveCount(0)
        await bar.getByRole('button', { name: 'Memba menu' }).click()
        await page.getByRole('menuitem', { name: 'Arcade' }).click()
        await expect(page.getByRole('region', { name: 'Arcade' })).toBeVisible()
        await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Validators' }).click()
        await expect(page.getByRole('region', { name: 'Validators' })).toBeVisible()
        await bar.getByRole('button', { name: 'Window' }).click()
        await expect(page.getByRole('menuitem', { name: /Wallet/ })).toBeVisible()
    })
})
