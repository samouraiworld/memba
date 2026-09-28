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
            GetNetwork: async () => ({ status: 'success', data: { chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land' } }),
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
            GetNetwork: async () => ({ status: 'success', data: { chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land' } }),
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

    test('each visit offers Connect or Guest while preserving desktop windows', async ({ page }) => {
        await page.goto(`${OS_ON}/os`)
        await expect(lockScreen(page)).toBeVisible()
        // The boot plays over it first.
        await expect(page.getByTestId('os-boot')).toHaveCount(0)
        await page.getByRole('button', { name: 'Continue as guest' }).click()
        await expect(lockScreen(page)).toHaveCount(0)
        await expect(page.getByRole('region', { name: 'Welcome to Memba' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Connect wallet' }).first()).toBeVisible()

        await page.reload()
        await expect(page.getByTestId('memba-os')).toBeVisible()
        await expect(lockScreen(page)).toBeVisible()
        await lockScreen(page).getByRole('button', { name: 'Continue as guest' }).click()
        await expect(page.getByRole('banner', { name: 'Menu bar' })).toBeVisible()
        await expect(page.getByRole('region', { name: 'Welcome to Memba' })).toBeVisible()
    })

    test('returning member: Connect continues the resumed session', async ({ page }) => {
        await returningMember(page)
        await page.goto(`${OS_ON}/os`)
        await expect(lockScreen(page)).toBeVisible()
        await lockScreen(page).getByRole('button', { name: 'Connect wallet' }).click()
        // Silent reconnect may finish while the lock screen still conceals the
        // short-lived toast. The member account and unlocked desk persist.
        await expect(page.getByRole('button', { name: `Account ${ADDR}` })).toBeVisible()
        await expect(lockScreen(page)).toHaveCount(0)
        await expect(page.getByText("Your desk is empty — let's fill it.")).toBeVisible()
        await expect(page.getByRole('button', { name: 'Connect wallet' })).toHaveCount(0)
    })

    test('wallet reconnect keeps keyboard focus on the available guest action', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.addInitScript(() => {
            localStorage.setItem('memba_adena_connected', 'true')
            Object.defineProperty(window, 'adena', { value: {
                GetAccount: () => new Promise(() => {}),
                On: () => true,
            } })
        })
        await page.goto(`${OS_ON}/os`)
        const lock = lockScreen(page)
        const guest = lock.getByRole('button', { name: 'Continue as guest' })
        await expect(lock.getByRole('button', { name: 'Resuming wallet…' })).toBeDisabled()
        await expect(guest).toBeFocused()
        for (const key of ['Tab', 'Shift+Tab', 'Tab']) {
            await page.keyboard.press(key)
            await expect(guest).toBeFocused()
        }
        await page.keyboard.press('Enter')
        await expect(lock).toHaveCount(0)
        await expect(page.getByRole('main', { name: 'Desktop' })).toBeVisible()
    })

    test('repeat welcome conceals restored member windows until Connect', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await returningMember(page)
        await page.addInitScript(({ address }) => {
            localStorage.setItem(`memba_os_windows:member:gnoland-1:${address}`, JSON.stringify([
                { token: 'app.wallet', x: 80, y: 60, width: 680, height: 500, z: 2, min: false, max: false },
            ]))
        }, { address: ADDR })
        await page.goto(`${OS_ON}/os`)
        const lock = lockScreen(page)
        const walletWindow = page.locator('.os-win').first()
        await expect(lock).toBeVisible()
        await expect(walletWindow).toBeAttached()
        await expect(walletWindow).toBeHidden()
        await expect(page.locator('.os-menubar')).toBeHidden()
        await expect(page.locator('.os-dock')).toBeHidden()
        await lock.getByRole('button', { name: 'Connect wallet' }).click()
        await expect(lock).toHaveCount(0)
        await expect(walletWindow).toBeVisible()
        await expect(walletWindow).toContainText('Wallet')
    })

    test('returning member: Guest leaves the wallet session', async ({ page }) => {
        await returningMember(page)
        await page.goto(`${OS_ON}/os`)
        await expect(lockScreen(page)).toBeVisible()
        await lockScreen(page).getByRole('button', { name: 'Continue as guest' }).click()
        await expect(lockScreen(page)).toHaveCount(0)
        await expect(page.getByRole('button', { name: `Account ${ADDR}` })).toHaveCount(0)
        await expect(page.getByRole('banner', { name: 'Menu bar' }).getByRole('button', { name: 'Connect wallet' })).toBeVisible()
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

    test('shared link: the guest banner never covers the title bar of the window it opened', async ({ page }) => {
        // A page window (960 × 660) centred on a short screen used to start under the banner.
        await page.setViewportSize({ width: 1280, height: 760 })
        await page.goto(`${OS_ON}/os/validators`)
        const win = page.getByRole('region', { name: 'Validators', exact: true })
        await expect(win).toBeVisible()
        await expect(page.getByText('Browsing as guest')).toBeVisible()
        await win.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
        const covered = await win.locator('.os-tb').evaluate((bar) => {
            const r = bar.getBoundingClientRect()
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            return !bar.contains(hit)
        })
        expect(covered).toBe(false)
        const banner = (await page.locator('.os-banner').boundingBox())!
        expect((await win.boundingBox())!.y).toBeGreaterThanOrEqual(banner.y + banner.height)
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
        await page.getByRole('menuitem', { name: 'Arcade', exact: true }).click()
        await expect(page.getByRole('region', { name: 'Arcade' })).toBeVisible()
        await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Validators' }).click()
        await expect(page.getByRole('region', { name: 'Validators' })).toBeVisible()
        await bar.getByRole('button', { name: 'Window' }).click()
        await expect(page.getByRole('menuitem', { name: /Wallet/ })).toBeVisible()
    })
})
