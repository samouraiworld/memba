import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'

const OS_BASE = process.env.OS_SHELL_QA_URL ?? OS_ON

async function quietExternalServices(page: Page) {
    await page.route(/memba\.v1\.|\.gno\.land|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
}

test.beforeEach(async ({ page }) => { await quietExternalServices(page) })

test('lock screen contains keyboard focus and makes the shell inert', async ({ page }) => {
    await page.goto(`${OS_BASE}/os`)
    await expect(page.getByTestId('os-boot')).toHaveCount(0)
    const lock = page.getByRole('dialog', { name: 'Welcome to Memba' })
    await expect(lock).toBeVisible()
    await expect(page.getByRole('banner', { name: 'Menu bar', includeHidden: true })).toHaveAttribute('inert', '')
    await expect(page.getByRole('navigation', { name: 'Dock', includeHidden: true })).toHaveAttribute('inert', '')
    for (let i = 0; i < 6; i++) {
        expect(await page.evaluate(() => !!document.activeElement?.closest('.os-lock'))).toBe(true)
        await page.keyboard.press('Tab')
    }
    await expect(page.getByRole('button', { name: 'Memba menu' })).toHaveCount(0)
})

test('launcher traps and restores focus', async ({ page }) => {
    await page.goto(`${OS_BASE}/os`)
    await page.getByRole('button', { name: 'Continue as guest' }).click()
    const trigger = page.getByRole('banner', { name: 'Menu bar' }).getByRole('button', { name: 'Search (⌘K)' })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Search and commands' })
    await expect(dialog).toBeVisible()
    for (let i = 0; i < 6; i++) {
        expect(await page.evaluate(() => !!document.activeElement?.closest('.os-launch'))).toBe(true)
        await page.keyboard.press('Tab')
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
})

test('connect dialog traps and restores focus', async ({ page }) => {
    await page.goto(`${OS_BASE}/os`)
    await page.getByRole('button', { name: 'Continue as guest' }).click()
    const trigger = page.getByRole('banner', { name: 'Menu bar' }).getByRole('button', { name: 'Connect wallet' })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Connect a wallet' })
    await expect(dialog).toBeVisible()
    for (let i = 0; i < 6; i++) {
        expect(await page.evaluate(() => !!document.activeElement?.closest('.os-modal'))).toBe(true)
        await page.keyboard.press('Tab')
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
})

test('Phone Home hides all prior sheets and Back reopens the last one', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`${OS_BASE}/os`)
    await page.getByRole('button', { name: 'Continue as guest' }).click()
    await expect(page.getByRole('region', { name: 'Welcome to Memba' })).toBeVisible()
    await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Feed' }).click()
    await expect(page.getByRole('region', { name: 'Feed' })).toBeVisible()
    await page.getByRole('button', { name: '‹ Home' }).click()
    await expect(page.getByRole('main', { name: 'Home' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Welcome to Memba' })).toHaveCount(0)
    await expect.poll(() => new URL(page.url()).pathname).toBe('/os')
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.goBack()
    await expect(page.getByRole('region', { name: 'Feed' })).toBeVisible()
})

test('short landscape uses a full-height sheet for Terminal', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await page.goto(`${OS_BASE}/os/terminal`)
    await expect(page.locator('.os-phone')).toBeVisible()
    const sheet = page.getByRole('region', { name: 'Terminal' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Run query' })).toBeVisible()
})

test('manual lock remains in force after reload', async ({ page }) => {
    await page.goto(`${OS_BASE}/os`)
    await page.getByRole('button', { name: 'Continue as guest' }).click()
    await page.getByRole('button', { name: 'Memba menu' }).click()
    await page.getByRole('menuitem', { name: 'Lock screen' }).click()
    await expect(page.getByRole('dialog', { name: 'Welcome to Memba' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('dialog', { name: 'Welcome to Memba' })).toBeVisible()
})

test('menu arrows and minimise action leave an actionable keyboard focus', async ({ page }) => {
    await page.goto(`${OS_BASE}/os`)
    await page.getByRole('button', { name: 'Continue as guest' }).click()
    const windowButton = page.getByRole('banner', { name: 'Menu bar' }).getByRole('button', { name: 'Window', exact: true })
    await windowButton.click()
    const menu = page.getByRole('menu', { name: 'Window' })
    await expect(menu.getByRole('menuitem', { name: 'Minimise all' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitem', { name: 'Tile two front windows' })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(menu.getByRole('menuitem', { name: 'Minimise all' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(windowButton).toBeFocused()
    await windowButton.click()
    await menu.getByRole('menuitem', { name: 'Minimise all' }).click()
    await expect(windowButton).toBeFocused()
})

test('keyboard can move and resize a window title bar', async ({ page }) => {
    await page.goto(`${OS_BASE}/os`)
    await page.getByRole('button', { name: 'Continue as guest' }).click()
    const win = page.locator('.os-win').filter({ has: page.getByRole('heading', { name: /Welcome to Memba/ }) })
    const title = win.locator('.os-tb-title')
    const before = await win.evaluate((el) => ({ left: el.style.left, width: el.style.width }))
    await title.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => win.evaluate((el) => el.style.left)).not.toBe(before.left)
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(() => win.evaluate((el) => el.style.width)).not.toBe(before.width)
})

test('invalid deep link stays in the address bar until the window closes', async ({ page }) => {
    await page.goto(`${OS_BASE}/os/unknown-audit-path`)
    await expect(page.getByRole('region', { name: 'Not found' })).toBeVisible()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/os/unknown-audit-path')
    await page.reload()
    await expect(page.getByRole('region', { name: 'Not found' })).toBeVisible()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/os/unknown-audit-path')
})

test('saved guest desk restores its front URL without rewriting stored state', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_os_windows:guest:gnoland-1', JSON.stringify([
            { token: 'app.feed', x: 60, y: 40, width: 680, height: 500, z: 2, min: false, max: false },
        ]))
    })
    await page.goto(`${OS_BASE}/os`)
    await expect(page.getByRole('region', { name: 'Feed' })).toBeVisible()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/os/feed')
})

test('disconnecting from a linked member desk preserves both saved owner layouts', async ({ page }) => {
    const address = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5'
    const guestKey = 'memba_os_windows:guest:gnoland-1'
    const memberKey = `memba_os_windows:member:gnoland-1:${address}`
    const guestLayout = JSON.stringify([{ token: 'app.feed', x: 60, y: 40, width: 680, height: 500, z: 2, min: false, max: false }])
    const memberLayout = JSON.stringify([{ token: 'app.wallet', x: 90, y: 50, width: 680, height: 500, z: 2, min: false, max: false }])
    await page.addInitScript(({ address, guestKey, memberKey, guestLayout, memberLayout }) => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'e2e', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'e2e-only' }))
        localStorage.setItem(guestKey, guestLayout)
        localStorage.setItem(memberKey, memberLayout)
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '250000000ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '1', sequence: '1', chainId: 'gnoland-1' } }),
            GetNetwork: async () => ({ status: 'success', data: { chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land' } }),
            On: () => true,
        } })
    }, { address, guestKey, memberKey, guestLayout, memberLayout })
    await page.goto(`${OS_BASE}/os/validators`)
    await expect(page.getByRole('region', { name: 'Validators' })).toBeVisible()
    await page.getByRole('button', { name: 'Memba menu' }).click()
    await page.getByRole('menuitem', { name: 'Disconnect & lock' }).click()
    await expect(page.getByRole('dialog', { name: 'Welcome to Memba' })).toBeVisible()
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), memberKey)).toBe(memberLayout)
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), guestKey)).toBe(guestLayout)
    await page.getByRole('button', { name: 'Continue as guest' }).click()
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), guestKey)).toBe(guestLayout)
})

test('connecting from a guest link does not replace the member saved desktop', async ({ page }) => {
    const address = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5'
    const memberKey = `memba_os_windows:member:gnoland-1:${address}`
    const memberLayout = JSON.stringify([{ token: 'app.wallet', x: 90, y: 50, width: 680, height: 500, z: 2, min: false, max: false }])
    await page.route('**/memba.v1.MultisigService/GetChallenge', (route) => route.fulfill({
        json: { challenge: { nonce: 'AQID', expiration: '2099-01-01T00:00:00Z', serverSignature: 'CQ==', boundPubkeyHash: '', chainId: 'gnoland-1' } },
    }))
    await page.route('**/memba.v1.MultisigService/GetToken', (route) => route.fulfill({
        json: { authToken: { nonce: 'AQID', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'CQ==' } },
    }))
    await page.addInitScript(({ address, memberKey, memberLayout }) => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem(memberKey, memberLayout)
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '250000000ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '1', sequence: '1', chainId: 'gnoland-1' } }),
            GetNetwork: async () => ({ status: 'success', data: { chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land' } }),
            SignMultisigTransaction: async () => ({ status: 'success', data: { signature: { signature: 'AQID', pub_key: { value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' } } } }),
            On: () => true,
        } })
    }, { address, memberKey, memberLayout })
    await page.goto(`${OS_BASE}/os/validators`)
    await expect(page.getByRole('region', { name: 'Validators' })).toBeVisible()
    await page.getByRole('banner', { name: 'Menu bar' }).getByRole('button', { name: 'Connect wallet' }).click()
    const dialog = page.getByRole('dialog', { name: 'Connect a wallet' })
    await dialog.getByRole('button', { name: /Adena/ }).click()
    await dialog.getByRole('button', { name: 'Sign in Adena' }).click()
    await expect(page.getByRole('button', { name: `Account ${address}` })).toBeVisible()
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), memberKey)).toBe(memberLayout)
})

test('connecting from the lock screen resumes saving later desktop changes', async ({ page }) => {
    const address = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5'
    const memberKey = `memba_os_windows:member:gnoland-1:${address}`
    await page.route('**/memba.v1.MultisigService/GetChallenge', (route) => route.fulfill({
        json: { challenge: { nonce: 'AQID', expiration: '2099-01-01T00:00:00Z', serverSignature: 'CQ==', boundPubkeyHash: '', chainId: 'gnoland-1' } },
    }))
    await page.route('**/memba.v1.MultisigService/GetToken', (route) => route.fulfill({
        json: { authToken: { nonce: 'AQID', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'CQ==' } },
    }))
    await page.addInitScript(({ address }) => {
        localStorage.setItem('memba_os_seen', '1')
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '250000000ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '1', sequence: '1', chainId: 'gnoland-1' } }),
            GetNetwork: async () => ({ status: 'success', data: { chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land' } }),
            SignMultisigTransaction: async () => ({ status: 'success', data: { signature: { signature: 'AQID', pub_key: { value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' } } } }),
            On: () => true,
        } })
    }, { address })
    await page.goto(`${OS_BASE}/os`)
    await page.getByRole('button', { name: 'Memba menu' }).click()
    await page.getByRole('menuitem', { name: 'Lock screen' }).click()
    await page.getByRole('dialog', { name: 'Welcome to Memba' }).getByRole('button', { name: 'Connect wallet' }).click()
    const dialog = page.getByRole('dialog', { name: 'Connect a wallet' })
    await dialog.getByRole('button', { name: /Adena/ }).click()
    await dialog.getByRole('button', { name: 'Sign in Adena' }).click()
    await expect(page.getByRole('button', { name: `Account ${address}` })).toBeVisible()
    await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Feed' }).click()
    await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]').some((item: { token: string }) => item.token === 'app.feed'), memberKey)).toBe(true)
    await page.goto(`${OS_BASE}/os`)
    await expect(page.getByRole('region', { name: 'Feed' })).toBeVisible()
})

test('wallet connection cancelled from lock keeps the desk locked', async ({ page }) => {
    await page.goto(`${OS_BASE}/os`)
    await page.getByRole('button', { name: 'Connect wallet' }).click()
    const dialog = page.getByRole('dialog', { name: 'Connect a wallet' })
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Welcome to Memba' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Not now' }).click()
    await expect(page.getByRole('dialog', { name: 'Welcome to Memba' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('dialog', { name: 'Welcome to Memba' })).toBeVisible()
})

test('unlocking a deep link goes to its intended app', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('memba_os_locked', '1'))
    await page.goto(`${OS_BASE}/os/terminal`)
    await expect(page.getByRole('dialog', { name: 'Welcome to Memba' })).toBeVisible()
    await page.getByRole('button', { name: 'Continue as guest' }).click()
    await expect(page.getByRole('region', { name: 'Terminal' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Welcome to Memba' })).toHaveCount(0)
})
