import { expect, test, type Page } from '@playwright/test'
import { OS_OFF, OS_ON } from '../../playwright.os.config'
import { fulfillOnchainReads, mockAppChainStatus } from '../helpers/onchain'

// The four entry scenarios of mockup v4, on the real shell, wallet hooks and
// login code. Adena is a page-level stub and the backend's auth calls are
// fulfilled per test; nothing here talks to a chain.

// A real, checksummed address: activation's exact-call exemption refuses a malformed caller.
const ADDR = 'g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj'
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
            // What Adena answers for an account with no key on its network.
            SignMultisigTransaction: async () => ({ status: 'failure', type: 'SIGN_MULTISIG_TRANSACTION_FAILED', data: { error: { message: 'Public key not found. This account has not sent any transactions yet.' } } }),
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
        // Adena's own app icon, served from this site and drawn at the tile's size.
        const logo = modal.getByRole('button', { name: /Adena/ }).locator('img.os-wlogo')
        await expect(logo).toHaveJSProperty('complete', true)
        expect(await logo.evaluate((img: HTMLImageElement) => [img.naturalWidth > 0, img.offsetWidth])).toEqual([true, 36])
        await modal.getByRole('button', { name: /Adena/ }).click()
        await expect(modal.getByRole('heading', { name: 'Sign the login message' })).toBeVisible()
        await modal.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(modal.getByRole('heading', { name: 'Activate your address' })).toBeVisible()
        // What it does and costs, said truly: a self-send of 0.000001 GNOT, the network fee only.
        await expect(modal.getByText('Sends 0.000001 GNOT from your address to itself')).toBeVisible()
        // What Adena renders for a bank send: the message, its type and function, never the recipient or amount.
        const adenaShows = modal.getByLabel('Adena should show')
        await expect(adenaShows.getByText('/bank.MsgSend')).toBeVisible()
        await expect(adenaShows.getByText('Memba Network Activation')).toBeVisible()
        await expect(modal.getByText(/Adena does not show a transfer’s recipient or amount/)).toBeVisible()
        await expect(modal.getByText(/Storage deposit/)).toHaveCount(0)
        // Signed-out guidance, so it can be put off.
        await modal.getByRole('button', { name: 'Later' }).click()
        await expect(connectModal(page)).toHaveCount(0)
    })

    test('activation is reviewed in its own step and signed without the classic confirmation', async ({ page }) => {
        await newWallet(page)
        // A funded, never-used address: the balance and the network price are read.
        await fulfillOnchainReads(page, ({ method, path }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (path.startsWith('bank/balances/')) return '"1000000ugnot"'
            if (path === 'auth/gasprice') return '{"gas":1000,"price":"1ugnot"}'
            return null
        })
        await page.addInitScript(() => {
            const w = window as unknown as { adena: Record<string, (...a: unknown[]) => Promise<unknown>>; __activation: unknown[] }
            w.__activation = []
            w.adena.DoContract = async (tx: unknown) => { w.__activation.push(tx); return { status: 'success', data: { hash: 'ACTIVATED' } } }
        })
        await page.goto(`${OS_ON}/os`)
        await lockScreen(page).getByRole('button', { name: 'Connect wallet' }).click()
        const modal = connectModal(page)
        await modal.getByRole('button', { name: /Adena/ }).click()
        await modal.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(modal.getByRole('heading', { name: 'Activate your address' })).toBeVisible()
        await expect(modal.getByText('0.0024 GNOT', { exact: true })).toBeVisible()
        // A double click sends one transaction: the step is left at the first click, with nothing to put it off.
        await modal.getByRole('button', { name: 'Activate in Adena' }).dblclick()
        await expect(modal.getByText('Your address is active. Sign the login message to finish.')).toBeVisible()
        // The step was the review: no classic confirmation opened over the OS.
        await expect(page.getByText('Confirm Transaction')).toHaveCount(0)
        const sent = await page.evaluate(() => (window as unknown as { __activation: { messages: { value: Record<string, unknown> }[]; gasWanted: number; gasFee: number }[] }).__activation)
        expect(sent).toHaveLength(1)
        const [tx] = sent
        expect(tx.messages).toEqual([{ type: '/bank.MsgSend', value: { from_address: ADDR, to_address: ADDR, amount: '1ugnot' } }])
        expect([tx.gasWanted, tx.gasFee]).toEqual([2_000_000, 2_400])
    })

    test('switching the account in Adena while activation checks runs sends nothing', async ({ page }) => {
        await newWallet(page)
        await fulfillOnchainReads(page, ({ method, path }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (path.startsWith('bank/balances/')) return '"1000000ugnot"'
            if (path === 'auth/gasprice') return '{"gas":1000,"price":"1ugnot"}'
            return null
        })
        await page.addInitScript(() => {
            const w = window as unknown as { adena: Record<string, (...a: unknown[]) => unknown>; __sent: number; __hold: boolean; __release: () => void; __accountChanged: () => void }
            w.__sent = 0
            w.__hold = false
            w.adena.DoContract = async () => { w.__sent++; return { status: 'success', data: { hash: 'X' } } }
            w.adena.On = (event: unknown, cb: unknown) => { if (event === 'changedAccount') w.__accountChanged = cb as () => void; return true }
            // The wallet check before signing waits here while the test switches the account.
            const read = w.adena.GetAccount
            w.adena.GetAccount = async (...a: unknown[]) => {
                if (w.__hold) await new Promise<void>((resolve) => { w.__release = resolve })
                return (read as (...b: unknown[]) => Promise<unknown>).apply(w.adena, a)
            }
        })
        await page.goto(`${OS_ON}/os`)
        await lockScreen(page).getByRole('button', { name: 'Connect wallet' }).click()
        const modal = connectModal(page)
        await modal.getByRole('button', { name: /Adena/ }).click()
        await modal.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(modal.getByRole('button', { name: 'Activate in Adena' })).toBeEnabled()
        await page.evaluate(() => { (window as unknown as { __hold: boolean }).__hold = true })
        await modal.getByRole('button', { name: 'Activate in Adena' }).click()
        await page.waitForFunction(() => typeof (window as unknown as { __release?: () => void }).__release === 'function')
        await page.evaluate(() => {
            const w = window as unknown as { __hold: boolean; __release: () => void; __accountChanged: () => void }
            w.__accountChanged()
            w.__hold = false
            w.__release()
        })
        await page.waitForTimeout(1500)
        expect(await page.evaluate(() => (window as unknown as { __sent: number }).__sent)).toBe(0)
    })

    test('after the price rose, or after Later, activation shows the network price read again', async ({ page }) => {
        await newWallet(page)
        let price = 1
        await fulfillOnchainReads(page, ({ method, path }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (path.startsWith('bank/balances/')) return '"1000000ugnot"'
            if (path === 'auth/gasprice') return `{"gas":1000,"price":"${price}ugnot"}`
            return null
        })
        await page.goto(`${OS_ON}/os`)
        await lockScreen(page).getByRole('button', { name: 'Connect wallet' }).click()
        const modal = connectModal(page)
        await modal.getByRole('button', { name: /Adena/ }).click()
        await modal.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(modal.getByText('0.0024 GNOT', { exact: true })).toBeVisible()
        // The price doubles before the click: the check before Adena refuses, and the step shows the new fee.
        price = 2
        await modal.getByRole('button', { name: 'Activate in Adena' }).click()
        await expect(modal.getByText('0.0048 GNOT', { exact: true })).toBeVisible()
        // Put off and opened again: read again too.
        price = 3
        await modal.getByRole('button', { name: 'Later' }).click()
        await lockScreen(page).getByRole('button', { name: 'Connect wallet' }).click()
        await connectModal(page).getByRole('button', { name: /Adena/ }).click()
        await expect(connectModal(page).getByText('0.0072 GNOT', { exact: true })).toBeVisible()
    })

    test('a cancel in Adena during activation says so, and nothing was sent', async ({ page }) => {
        await newWallet(page)
        await fulfillOnchainReads(page, ({ method, path }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (path.startsWith('bank/balances/')) return '"1000000ugnot"'
            if (path === 'auth/gasprice') return '{"gas":1000,"price":"1ugnot"}'
            // The account as the chain keeps it: unchanged blocks after the cancel.
            if (path.startsWith('auth/accounts/')) return JSON.stringify({ BaseAccount: { address: ADDR, coins: '1000000ugnot', public_key: null, account_number: '9', sequence: '0' } })
            return null
        })
        await page.addInitScript(() => {
            const w = window as unknown as { adena: Record<string, (...a: unknown[]) => Promise<unknown>> }
            w.adena.DoContract = async () => { throw new Error('User rejected the transaction') }
        })
        await page.goto(`${OS_ON}/os`)
        await lockScreen(page).getByRole('button', { name: 'Connect wallet' }).click()
        const modal = connectModal(page)
        await modal.getByRole('button', { name: /Adena/ }).click()
        await modal.getByRole('button', { name: 'Sign in Adena' }).click()
        await modal.getByRole('button', { name: 'Activate in Adena' }).click()
        await expect(modal.getByRole('heading', { name: 'Confirm in Adena' })).toBeVisible()
        await expect(modal.getByRole('button', { name: 'Later' })).toHaveCount(0)
        await expect(modal.getByText(/Cancelled in Adena\. Your account shows no change/)).toBeVisible({ timeout: 30_000 })
        await expect(modal.getByRole('button', { name: 'Activate in Adena' })).toBeEnabled()
    })

    test('activation waits for a balance that holds its network fee, and says how much', async ({ page }) => {
        await newWallet(page)
        await fulfillOnchainReads(page, ({ method, path }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (path.startsWith('bank/balances/')) return '"2400ugnot"'
            if (path === 'auth/gasprice') return '{"gas":1000,"price":"1ugnot"}'
            return null
        })
        await page.goto(`${OS_ON}/os`)
        await lockScreen(page).getByRole('button', { name: 'Connect wallet' }).click()
        const modal = connectModal(page)
        await modal.getByRole('button', { name: /Adena/ }).click()
        await modal.getByRole('button', { name: 'Sign in Adena' }).click()
        // 2,400 ugnot is the fee alone: the 1 ugnot sent to itself must be there too.
        await expect(modal.getByText('Activation needs at least 0.002401 GNOT here: the network fee and the 0.000001 GNOT sent to yourself. Send this address at least that much, then activate.')).toBeVisible()
        await expect(modal.getByRole('button', { name: 'Activate in Adena' })).toBeDisabled()
    })

    test('a wallet on another network: the login step offers switching Adena, says when it fails, and signs with the key Adena has after the switch', async ({ page }) => {
        await page.addInitScript(({ address, pubkey }) => {
            let chainId = 'onyx-1'
            let approved = false
            let switches = 0
            const onNetwork: Array<() => void> = []
            Object.defineProperty(window, 'adena', { value: {
                // The key is per network: this account only ever transacted on gnoland-1.
                GetAccount: async () => approved
                    ? { status: 'success', data: { address, coins: '0ugnot', publicKey: chainId === 'gnoland-1' ? { '@type': '/tm.PubKeySecp256k1', value: pubkey } : null, accountNumber: '1', sequence: '1', chainId } }
                    : { status: 'failure', type: 'NOT_CONNECTED' },
                AddEstablish: async () => { approved = true; return { status: 'success' } },
                GetNetwork: async () => ({ status: 'success', data: { chainId, rpcUrl: 'https://rpc.gno.land' } }),
                // The first switch is declined in Adena; the second goes through.
                SwitchNetwork: async (to: string) => {
                    if (switches++ === 0) return { status: 'failure', type: 'SWITCH_NETWORK_REJECTED' }
                    chainId = to; onNetwork.forEach((f) => f()); return { status: 'success' }
                },
                On: (event: string, f: () => void) => { if (event === 'changedNetwork') onNetwork.push(f); return true },
                SignMultisigTransaction: async () => ({ status: 'success', data: { signature: { signature: 'AQID', pub_key: { value: pubkey } } } }),
                DoContract: async () => { throw new Error('e2e: wallet writes disabled') },
            } })
        }, { address: ADDR, pubkey: PUBKEY })
        let challengedFor = ''
        await page.route('**/memba.v1.MultisigService/GetChallenge', (route) => {
            challengedFor = route.request().postDataJSON().userPubkeyJson
            return route.fulfill({ json: { challenge: { nonce: 'AQID', expiration: '2099-01-01T00:00:00Z', serverSignature: 'CQ==', boundPubkeyHash: '', chainId: 'gnoland-1' } } })
        })
        await page.route('**/memba.v1.MultisigService/GetToken', (route) => route.fulfill({
            json: { authToken: { nonce: 'e2e', userAddress: ADDR, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'e2e-only' } },
        }))
        await page.goto(`${OS_ON}/os`)
        await lockScreen(page).getByRole('button', { name: 'Connect wallet' }).click()
        const modal = connectModal(page)
        await modal.getByRole('button', { name: /Adena/ }).click()
        await expect(modal.getByRole('heading', { name: 'Sign the login message' })).toBeVisible()
        await expect(modal.getByRole('alert')).toHaveText('Adena is on onyx-1, but Memba is on gnoland-1. Switch Adena to gnoland-1 to sign in.')
        await expect(modal.getByRole('button', { name: 'Sign in Adena' })).toHaveCount(0)
        await modal.getByRole('button', { name: 'Switch Adena to gnoland-1' }).click()
        await expect(modal.getByRole('alert')).toHaveText("Adena didn't switch to gnoland-1. Switch it to gnoland-1 in Adena, then sign in.")
        await modal.getByRole('button', { name: 'Switch Adena to gnoland-1' }).click()
        await expect(modal.getByRole('alert')).toHaveCount(0)
        await modal.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(connectModal(page)).toHaveCount(0)
        // The challenge is bound to the key Adena has on gnoland-1, read again after the switch.
        expect(challengedFor).toBe(JSON.stringify({ type: 'tendermint/PubKeySecp256k1', value: PUBKEY }))
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
