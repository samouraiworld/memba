import { expect, test, type Page } from '@playwright/test'
import { OS_FLAGS_ON } from '../../playwright.os.config'
import { fulfillOnchainReads, mockAppChainStatus } from '../helpers/onchain'

// The owner's side of Profile, on the server that has profile publishing on:
// the Memba review states the costs, a stub Adena records exactly what it was
// asked to sign, and the chain fixture only changes when that stub "lands" a
// transaction. Nothing reaches a chain.

const OWNER = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5'
const PROFILE = 'gno.land/r/demo/profile'
const REGISTRAR = 'gno.land/r/sys/namereg/v0'
type AdenaCall = { messages: { type: string; value: Record<string, unknown> }[]; memo: string; gasWanted: number; gasFee: number }
/** How the stub wallet answers: `-landed` modes put the transaction on the chain fixture before answering like the plain mode. */
type Mode = 'ok' | 'reject' | 'reject-landed' | 'timeout' | 'timeout-landed'
type Chain = { names?: Record<string, string>; gasPrice?: boolean; registerPrice?: number }

/** Signs the owner in with a stub wallet. `fields` is the profile realm's state for the owner; `names` the registry. */
async function owner(page: Page, mode: Mode, fields: Record<string, string>, { names = {}, gasPrice = true, registerPrice = 0 }: Chain = {}) {
    // A landed transaction moves the account's sequence, which is what a cancellation is checked against.
    let sequence = 1
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
    await fulfillOnchainReads(page, ({ method, path, arg }) => {
        if (method === 'status') return mockAppChainStatus('gnoland-1')
        if (method !== 'abci_query') return null
        if (path === 'auth/gasprice') return gasPrice ? '{"gas":1000,"price":"1ugnot"}' : null
        if (path.startsWith('bank/balances/')) return '"250000000ugnot"'
        if (path === `auth/accounts/${OWNER}`) return JSON.stringify({ BaseAccount: { address: OWNER, sequence: String(sequence), coins: '250000000ugnot' } })
        if (path !== 'vm/qeval') return null
        if (arg.includes('GetStringField(')) {
            // The realm answers a missing field with the default the expression passes.
            const [, field, fallback] = /GetStringField\(address\("[^"]+"\), "([^"]+)", ("(?:[^"\\]|\\.)*")\)/.exec(arg) ?? []
            return `(${JSON.stringify(field in fields ? fields[field] : JSON.parse(fallback))} string)`
        }
        if (arg === `${REGISTRAR}.registerPrice`) return `(${registerPrice} int64)`
        const name = /ResolveName\("([^"]+)"\)/.exec(arg)?.[1]
        if (name !== undefined) {
            return name in names
                ? `(&(struct{("${names[name]}" .uverse.address),("${name}" string),(false bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)\n(true bool)`
                : '(nil *gno.land/r/sys/users.UserData)\n(false bool)'
        }
        return null
    })
    // A landed transaction changes what the chain fixture answers, as the real chain would.
    await page.exposeFunction('__landTx', (messages: AdenaCall['messages']) => {
        sequence++
        for (const { value } of messages) {
            const args = value.args as string[]
            if (value.pkg_path === PROFILE && value.func === 'SetStringField') fields[args[0]] = args[1]
            if (value.pkg_path === REGISTRAR && value.func === 'Register') names[args[0]] = OWNER
        }
    })
    await page.addInitScript(({ address, mode }) => {
        localStorage.setItem('memba_os_skip_intro', '1')
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'e2e', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'e2e-only' }))
        const calls: unknown[] = []
        Object.defineProperty(window, '__adenaCalls', { value: calls })
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '250000000ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '1', sequence: '1', chainId: 'gnoland-1' } }),
            GetNetwork: async () => ({ status: 'success', data: { chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land' } }),
            On: () => true,
            DoContract: async (tx: { messages: unknown }) => {
                calls.push(tx)
                // Adena's own reply when the member refuses.
                const rejected = { status: 'failure', type: 'TRANSACTION_REJECTED', code: 4000, message: 'The transaction has been rejected by the user.', data: {} }
                if (mode === 'reject') return rejected
                if (mode === 'timeout') throw new Error('network timeout')
                await (window as unknown as { __landTx: (messages: unknown) => Promise<void> }).__landTx(tx.messages)
                if (mode === 'reject-landed') return rejected
                if (mode === 'timeout-landed') throw new Error('network timeout')
                return { status: 'success', data: { hash: 'a'.repeat(64) } }
            },
        } })
    }, { address: OWNER, mode })
    await page.setViewportSize({ width: 1280, height: 860 })
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __adenaCalls: AdenaCall[] }).__adenaCalls)
const lockKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('memba_profile_publish:')))

async function editBioAndLocation(page: Page) {
    await page.goto(`${OS_FLAGS_ON}/os/profile`)
    const profile = page.getByTestId('os-profile-window')
    await profile.getByRole('button', { name: 'Edit profile' }).click()
    const editor = page.getByTestId('os-profile-editor')
    await editor.getByRole('textbox', { name: 'Bio' }).fill('Hello')
    await editor.getByRole('textbox', { name: 'Location' }).fill('Paris')
    await editor.getByRole('button', { name: 'Review & publish 2 changes' }).click()
    return { profile, editor, review: page.getByRole('dialog', { name: 'Review · Publish profile' }) }
}

test.describe('Memba OS profile, as its owner', () => {
    test('publishing states the deposit and fee, and Adena gets capped calls with that gas limit and fee', async ({ page }) => {
        // A wallet activated before 2026-10-01 has an empty Bio, so Bio is a rewrite and Location a first write.
        await owner(page, 'ok', { DisplayName: 'Alice on Gno', Bio: '' })
        const { profile, review } = await editBioAndLocation(page)
        await expect(review.getByText('≈ 0.2274 GNOT (cap 0.47 GNOT)')).toBeVisible()
        await expect(review.getByText('0.0192 GNOT', { exact: true })).toBeVisible()
        await expect(review.getByText(/about 0\.21 GNOT per field stays locked for good/)).toBeVisible()
        await expect(review.getByRole('button', { name: 'Sign in Adena' })).toBeDisabled()
        await review.getByLabel(/these changes are public/).check()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(review).toHaveCount(0)

        const [call] = await calls(page)
        expect(call.messages).toEqual([
            { type: '/vm.m_call', value: { caller: OWNER, send: '', pkg_path: PROFILE, func: 'SetStringField', args: ['Bio', 'Hello'], max_deposit: '20000ugnot' } },
            { type: '/vm.m_call', value: { caller: OWNER, send: '', pkg_path: PROFILE, func: 'SetStringField', args: ['Location', 'Paris'], max_deposit: '450000ugnot' } },
        ])
        expect(call).toMatchObject({ gasWanted: 16_000_000, gasFee: 19_200, memo: 'Memba profile' })
        await page.getByRole('button', { name: /Notifications, 1 new/ }).click()
        await expect(page.getByText('Confirmed · Publish profile')).toBeVisible()
        await expect(profile.getByText('Hello', { exact: true })).toBeVisible()
    })

    for (const [width, height, minSheet] of [[1900, 1000, 640], [375, 812, 0]] as const) {
        test(`every review row shows its whole value inside the sheet at ${width} px`, async ({ page }) => {
            await owner(page, 'ok', { DisplayName: 'Alice on Gno', Bio: '' })
            await page.setViewportSize({ width, height })
            await page.goto(`${OS_FLAGS_ON}/os/profile`)
            await page.getByTestId('os-profile-window').getByRole('button', { name: 'Edit profile' }).click()
            const editor = page.getByTestId('os-profile-editor')
            // Long values without break opportunities: what pushed the value column off the sheet.
            await editor.getByRole('textbox', { name: 'Bio' }).fill(`${'x'.repeat(160)} and some words`)
            await editor.getByLabel('Homepage URL').fill(`https://example.org/${'a'.repeat(150)}`)
            await editor.getByRole('button', { name: /Review & publish \d changes/ }).click()
            const review = page.getByRole('dialog', { name: 'Review · Publish profile' })
            await expect(review).toBeVisible()
            const box = await review.boundingBox()
            expect(box!.x).toBeGreaterThanOrEqual(0)
            expect(box!.x + box!.width).toBeLessThanOrEqual(width)
            expect(box!.width).toBeGreaterThanOrEqual(minSheet)
            const overflow = await review.evaluate((dialog) => {
                const edge = dialog.getBoundingClientRect().right
                const body = dialog.querySelector<HTMLElement>('.os-rvb')!
                const cut = [...dialog.querySelectorAll('dd')].filter((dd) => dd.getBoundingClientRect().right > edge + 0.5 || dd.scrollWidth > dd.clientWidth + 1)
                return { sideways: body.scrollWidth > body.clientWidth + 1, cut: cut.map((dd) => dd.previousElementSibling?.textContent) }
            })
            expect(overflow).toEqual({ sideways: false, cut: [] })
        })
    }

    test('rejecting in Adena sends nothing and keeps the draft unlocked', async ({ page }) => {
        const fields = { DisplayName: 'Alice on Gno', Bio: '' }
        await owner(page, 'reject', fields)
        const { editor, review } = await editBioAndLocation(page)
        await review.getByLabel(/these changes are public/).check()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        // The signer confirms a cancellation on the account three blocks later before saying so.
        await expect(page.getByText('Cancelled in Adena. Your account shows no change three blocks later.')).toBeVisible()
        await expect(editor.getByRole('textbox', { name: 'Bio' })).toHaveValue('Hello')
        await expect(editor.getByRole('button', { name: 'Review & publish 2 changes' })).toBeEnabled()
        await expect(editor.getByText(/previous publish is pending/)).toHaveCount(0)
        expect(fields).toEqual({ DisplayName: 'Alice on Gno', Bio: '' })
        expect(await calls(page)).toHaveLength(1)
        // Nothing stays saved that would lock the owner out after a reload.
        expect(await lockKeys(page)).toEqual([])
        await page.reload()
        await page.getByTestId('os-profile-window').getByRole('button', { name: 'Edit profile' }).click()
        await expect(page.getByTestId('os-profile-editor').getByText(/previous publish is pending/)).toHaveCount(0)
    })

    test('a cancellation Adena reports but the account contradicts locks publishing instead', async ({ page }) => {
        const fields = { DisplayName: 'Alice on Gno', Bio: '' }
        await owner(page, 'reject-landed', fields)
        const { editor, review } = await editBioAndLocation(page)
        await review.getByLabel(/these changes are public/).check()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(editor.getByText(/previous publish is pending or uncertain/)).toBeVisible()
        await page.getByRole('button', { name: /Notifications, 1 new/ }).click()
        await expect(page.getByText('Adena reported a cancellation, but Memba could not confirm it on chain. Check your account before trying again.')).toBeVisible()
        await expect(editor.getByRole('button', { name: /Review & publish/ })).toHaveCount(0)
        expect(await lockKeys(page)).toHaveLength(1)
        expect(await calls(page)).toHaveLength(1)
    })

    test('an unknown outcome locks publishing until the owner checks the chain', async ({ page }) => {
        await owner(page, 'timeout', { DisplayName: 'Alice on Gno', Bio: '' })
        const { editor, review } = await editBioAndLocation(page)
        await review.getByLabel(/these changes are public/).check()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(editor.getByText(/previous publish is pending or uncertain/)).toBeVisible()
        await expect(editor.getByRole('button', { name: /Review & publish/ })).toHaveCount(0)
        expect(await calls(page)).toHaveLength(1)
        // The lock survives a reload, and the chain does not show the change.
        await page.reload()
        await page.getByTestId('os-profile-window').getByRole('button', { name: 'Edit profile' }).click()
        await page.getByTestId('os-profile-editor').getByRole('button', { name: 'Check published state' }).click()
        await expect(page.getByTestId('os-profile-editor').getByText(/not fully visible on chain yet/)).toBeVisible()
        expect(await lockKeys(page)).toHaveLength(1)
    })

    test('an unknown outcome that did land unlocks once the chain shows it', async ({ page }) => {
        await owner(page, 'timeout-landed', { DisplayName: 'Alice on Gno', Bio: '' })
        const { editor, review } = await editBioAndLocation(page)
        await review.getByLabel(/these changes are public/).check()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(editor.getByText(/previous publish is pending or uncertain/)).toBeVisible()
        await editor.getByRole('button', { name: 'Check published state' }).click()
        const profile = page.getByTestId('os-profile-window')
        await expect(profile.getByTestId('os-profile-canvas').getByText('Hello', { exact: true })).toBeVisible()
        // The canvas can show the landed value a moment before the check clears the saved lock.
        await expect.poll(() => lockKeys(page)).toEqual([])
        await profile.getByRole('button', { name: 'Edit profile' }).click()
        await expect(page.getByTestId('os-profile-editor').getByText(/previous publish is pending/)).toHaveCount(0)
    })

    test('no review opens when the chain does not report a gas price', async ({ page }) => {
        await owner(page, 'ok', { DisplayName: 'Alice on Gno', Bio: '' }, { gasPrice: false })
        await page.goto(`${OS_FLAGS_ON}/os/profile`)
        await page.getByTestId('os-profile-window').getByRole('button', { name: 'Edit profile' }).click()
        const editor = page.getByTestId('os-profile-editor')
        await editor.getByRole('textbox', { name: 'Bio' }).fill('Hello')
        await editor.getByRole('button', { name: 'Review & publish 1 change' }).click()
        await expect(editor.getByText('The network fee could not be read. Try again in a moment.')).toBeVisible()
        await expect(page.getByRole('dialog')).toHaveCount(0)
        expect(await calls(page)).toHaveLength(0)
    })

    test('the owner can replace a field stored over the limit by entering a new value', async ({ page }) => {
        await owner(page, 'ok', { DisplayName: 'Alice on Gno', Bio: 'x'.repeat(501) })
        await page.goto(`${OS_FLAGS_ON}/os/profile`)
        await page.getByTestId('os-profile-window').getByRole('button', { name: 'Edit profile' }).click()
        const editor = page.getByTestId('os-profile-editor')
        await expect(editor.getByText(/Memba cannot show what is stored on chain for Bio/)).toBeVisible()
        // A repair is opt-in: nothing is offered until the owner enters a new value.
        await expect(editor.getByRole('button', { name: /Review & publish [1-9]/ })).toHaveCount(0)
        await editor.getByRole('textbox', { name: 'Bio' }).fill('A new bio')
        await editor.getByRole('button', { name: 'Review & publish 1 change' }).click()
        const review = page.getByRole('dialog', { name: 'Review · Publish profile' })
        await expect(review.getByText(/replaces the value stored on chain, which Memba cannot show/)).toBeVisible()
        // The value Memba cannot show may be longer than the new one: the deposit is an upper bound.
        await expect(review.getByText(/^at most [\d.]+ GNOT \(cap [\d.]+ GNOT\)$/)).toBeVisible()
        const boxes = await review.getByRole('checkbox').all()
        expect(boxes).toHaveLength(2)
        for (const box of boxes) await box.check()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(review).toHaveCount(0)
        const [call] = await calls(page)
        expect(call.messages).toEqual([{ type: '/vm.m_call', value: { caller: OWNER, send: '', pkg_path: PROFILE, func: 'SetStringField', args: ['Bio', 'A new bio'], max_deposit: '20000ugnot' } }])
        await page.getByRole('button', { name: /Notifications, 1 new/ }).click()
        await expect(page.getByText('Confirmed · Publish profile')).toBeVisible()
    })

    test('username registration states every cost and sends the measured gas limit', async ({ page }) => {
        await owner(page, 'ok', { DisplayName: 'Alice on Gno' })
        await page.goto(`${OS_FLAGS_ON}/os/profile`)
        const claim = page.getByTestId('os-profile-window').getByRole('region', { name: 'Register username' })
        await claim.getByRole('textbox', { name: 'Username' }).fill('nym-builder042')
        await claim.getByRole('button', { name: 'Review registration' }).click()
        const review = page.getByRole('dialog', { name: 'Review · Register username' })
        await expect(review.getByText('Free', { exact: true })).toBeVisible()
        await expect(review.getByText('≈ 0.33 GNOT (cap 0.66 GNOT), not returned')).toBeVisible()
        await expect(review.getByText('0.108 GNOT', { exact: true })).toBeVisible()
        await expect(review.getByText(/locked permanently/)).toBeVisible()
        await review.getByLabel(/I checked the username and the costs/).check()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(review).toHaveCount(0)
        const [call] = await calls(page)
        expect(call.messages).toEqual([{ type: '/vm.m_call', value: { caller: OWNER, send: '', pkg_path: REGISTRAR, func: 'Register', args: ['nym-builder042'], max_deposit: '660000ugnot' } }])
        expect(call).toMatchObject({ gasWanted: 90_000_000, gasFee: 108_000 })
        await page.getByRole('button', { name: /Notifications, 1 new/ }).click()
        await expect(page.getByText('Confirmed · Register @nym-builder042')).toBeVisible()
    })

    test('a paid registration states the price and sends exactly that amount', async ({ page }) => {
        await owner(page, 'ok', { DisplayName: 'Alice on Gno' }, { registerPrice: 1_000_000 })
        await page.goto(`${OS_FLAGS_ON}/os/profile`)
        const claim = page.getByTestId('os-profile-window').getByRole('region', { name: 'Register username' })
        await claim.getByRole('textbox', { name: 'Username' }).fill('nym-builder042')
        await claim.getByRole('button', { name: 'Review registration' }).click()
        const review = page.getByRole('dialog', { name: 'Review · Register username' })
        // The price line and the sheet's decoded "Sends" line.
        await expect(review.getByText('1 GNOT', { exact: true })).toHaveCount(2)
        await review.getByLabel(/I checked the username and the costs/).check()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(review).toHaveCount(0)
        const [call] = await calls(page)
        expect(call.messages).toEqual([{ type: '/vm.m_call', value: { caller: OWNER, send: '1000000ugnot', pkg_path: REGISTRAR, func: 'Register', args: ['nym-builder042'], max_deposit: '660000ugnot' } }])
    })
})
