import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
import { findHorizontalClipping, MOBILE_375 } from '../helpers/overflow'
import { fulfillGovernance } from '../helpers/proGovernanceFixture'

// Day 6: Memba OS at 375 px. The same windows and URLs, drawn as a home
// screen and one full-screen sheet at a time (mockup v4 phone). The plan's
// four scenarios: first visit, a shared link as a guest, a resumed member, a
// new member with an empty desk.

const MEMBER = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5'

async function phone(page: Page) {
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
    await fulfillGovernance(page)
    await page.setViewportSize(MOBILE_375)
}

async function member(page: Page) {
    await page.addInitScript(({ address }) => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'e2e', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'e2e-only' }))
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '7000000ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '1', sequence: '1', chainId: 'gnoland-1' } }),
            GetNetwork: async () => ({ data: { rpcUrl: 'https://rpc.gno.land' } }),
            On: () => true,
            DoContract: async () => { throw new Error('not in this test') },
        } })
    }, { address: MEMBER })
}

const path = (page: Page) => new URL(page.url()).pathname
const sheet = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

async function noOverflow(page: Page, within?: string) {
    expect(await findHorizontalClipping(page, within)).toEqual([])
    expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(MOBILE_375.width)
}

test.describe('Memba OS on a phone', () => {
    test.beforeEach(async ({ page }) => { await phone(page) })

    test('first visit: the lock screen, then the home screen as a guest', async ({ page }) => {
        await page.goto(`${OS_ON}/os`)
        const lock = page.getByRole('dialog', { name: 'Welcome to Memba' })
        await expect(lock).toBeVisible()
        await lock.getByRole('button', { name: 'Continue as guest' }).click()
        // The Welcome window opens as a sheet; Home shows the home screen.
        await expect(sheet(page, 'Welcome to Memba')).toBeVisible()
        const before = await page.evaluate(() => history.length)
        await page.getByRole('button', { name: '‹ Home' }).click()
        // Welcome has no address of its own: Home adds no history entry Back would have to skip.
        expect(await page.evaluate(() => history.length)).toBe(before)
        await expect.poll(() => path(page)).toBe('/os')
        await expect(page.getByRole('main', { name: 'Home' }).getByText('Browsing as guest')).toBeVisible()
        await noOverflow(page)
    })

    test('a shared link opens straight as a sheet; Home and back work; DAO tabs follow the address', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
        await page.goto(`${OS_ON}/os/dao/govdao/proposals/4`)
        const prop = sheet(page, 'govdao · Proposal #4')
        await expect(prop.getByRole('heading', { name: 'Fund the community education programme' })).toBeVisible()
        await expect(prop.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
        await noOverflow(page, '.os-ph-sheet')

        await page.getByRole('button', { name: '‹ Home' }).click()
        await expect.poll(() => path(page)).toBe('/os')
        // The address changes before React Router commits it (a transition): wait for the home
        // screen, as a person would, or a Back inside that gap lands in the same batched render.
        await expect(page.getByRole('main', { name: 'Home' })).toBeVisible()
        await expect(sheet(page, 'govdao · Proposal #4')).toHaveCount(0)
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
        await page.goBack()
        await expect(sheet(page, 'govdao · Proposal #4')).toBeVisible()

        await page.getByRole('button', { name: '‹ Home' }).click()
        await page.getByRole('button', { name: 'govdao' }).click()
        const folder = sheet(page, 'govdao')
        await folder.getByRole('tab', { name: 'Members' }).click()
        await expect.poll(() => path(page)).toBe('/os/dao/govdao/members')
        await noOverflow(page, '.os-ph-sheet')
    })

    test('a resumed member sees the balance widget; the dock opens apps as sheets; search works', async ({ page }) => {
        await member(page)
        await page.goto(`${OS_ON}/os`)
        const home = page.getByRole('main', { name: 'Home' })
        await expect(home.getByText(/Balance/)).toBeVisible()
        await expect(home.getByRole('button', { name: 'Send' })).toBeVisible()
        await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Wallet' }).click()
        await expect.poll(() => path(page)).toBe('/os/wallet')
        await expect(sheet(page, 'Wallet').getByRole('button', { name: 'Receive' })).toBeVisible()
        await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Search' }).click()
        const search = page.getByRole('dialog', { name: 'Search and commands' })
        await search.getByRole('combobox', { name: 'Search' }).fill('validators')
        await page.keyboard.press('Enter')
        await expect.poll(() => path(page)).toBe('/os/validators')
        await expect(sheet(page, 'Validators')).toBeVisible()
    })

    test('a new member: All apps lists every app, and opening one shows its sheet', async ({ page }) => {
        await member(page)
        await page.addInitScript(({ address }) => localStorage.setItem(`memba_os_desk:${address}`, '[]'), { address: MEMBER })
        await page.goto(`${OS_ON}/os`)
        await page.getByRole('button', { name: /All apps/ }).click()
        const apps = sheet(page, 'All apps')
        await expect(apps.getByRole('button', { name: /Multisig/ })).toBeVisible()
        await apps.getByRole('button', { name: /Multisig/ }).click()
        await expect.poll(() => path(page)).toBe('/os/multisig')
        await expect(sheet(page, 'Multisig')).toBeVisible()
        await noOverflow(page)
    })

    test('turning a phone into a desktop (rotation, a wider window) lays windows out for the real desk', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
        await page.goto(`${OS_ON}/os`)
        await expect(page.getByRole('main', { name: 'Home' })).toBeVisible()
        await page.setViewportSize({ width: 1400, height: 900 })
        await expect(page.getByRole('main', { name: 'Desktop' })).toBeVisible()
        await page.getByRole('button', { name: 'Memba menu' }).click()
        await page.getByRole('menuitem', { name: /^Settings/ }).first().click()
        await expect.poll(async () => Math.round((await page.getByRole('region', { name: 'Settings', exact: true }).boundingBox())?.width ?? 0)).toBe(960)
    })
})
