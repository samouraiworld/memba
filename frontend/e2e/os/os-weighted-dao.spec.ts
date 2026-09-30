import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
import { fulfillOnchainReads, mockAppChainStatus } from '../helpers/onchain'
import { MAINNET, MEMBER, memberWallet, v12Read } from '../helpers/weightedV12Fixture'

// The governing DAO (weighted host v12) in Memba OS, on the fake chain the
// classic weighted spec uses. Nothing here reaches a chain.

const win = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

test.describe('Memba OS weighted DAO', () => {
    test.beforeEach(async ({ page }) => {
        // Only other hosts are refused: the dev server's own modules must load.
        await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => {
            const url = new URL(route.request().url())
            return url.hostname === '127.0.0.1' && !/memba\.v1\./.test(url.pathname) ? route.continue() : route.abort()
        })
        await fulfillOnchainReads(page, ({ method, path, arg }) => method === 'status' ? mockAppChainStatus('gnoland-1') : path === 'vm/qeval' ? v12Read(arg) : null)
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('a guest opens the governing DAO from the DAOs app and stays in Memba OS', async ({ page }, info) => {
        await page.goto(`${OS_ON}/os/daos`)
        await win(page, 'DAOs').getByRole('button', { name: /Memba DAO/ }).click()
        const folder = win(page, 'memba_dao')
        await expect(folder.getByText('Founder · 2 points')).toBeVisible()
        await expect(folder.getByText('Core developer · 1 point')).toHaveCount(6)
        await expect(folder.getByRole('heading', { name: 'Application adapters' })).toBeVisible()
        await expect(folder.getByRole('article', { name: 'Proposal 17' }).getByRole('heading', { name: 'Market config · set-fee' })).toBeVisible()
        // A guest reads everything; nothing can be signed without a member wallet.
        await expect(folder.getByRole('article', { name: 'Proposal 17' }).getByRole('button', { name: 'Vote yes' })).toBeDisabled()
        expect(new URL(page.url()).pathname).toBe('/os/dao/memba_dao')
        // No link in the window leaves Memba OS for the classic site.
        expect(await folder.locator('a[href]').evaluateAll((links) => links.map((a) => a.getAttribute('href')).filter((href) => !href!.startsWith('/os')))).toEqual([])
        const widths = await folder.locator('.os-wbody').evaluate((body) => ({ visible: body.clientWidth, content: body.scrollWidth }))
        expect(widths.content).toBeLessThanOrEqual(widths.visible)
        await page.screenshot({ path: info.outputPath('os-weighted-dao-guest.png'), animations: 'disabled' })
    })

    test('a proposal address of the governing DAO leads to its DAO window', async ({ page }) => {
        await page.goto(`${OS_ON}/os/dao/memba_dao/proposals/17`)
        const proposal = win(page, 'memba_dao · Proposal #17')
        await expect(proposal.getByText('This DAO votes by points')).toBeVisible()
        await proposal.getByRole('button', { name: 'Open memba_dao' }).click()
        await expect(win(page, 'memba_dao').getByRole('article', { name: 'Proposal 17' })).toBeVisible()
        expect(new URL(page.url()).pathname).toBe('/os/dao/memba_dao')
    })

    test('a member proposes an acceptance from the DAO window, and the wallet gets exactly the reviewed call', async ({ page }) => {
        await memberWallet(page, MAINNET)
        await page.goto(`${OS_ON}/os/dao/memba_dao`)
        const folder = win(page, 'memba_dao')
        const market = folder.getByRole('listitem', { name: 'marketPolicy adapter' })
        await expect(market.getByText('Ready to accept')).toBeVisible()
        await market.getByRole('button', { name: 'Propose acceptance' }).click()
        const dialog = page.getByRole('dialog', { name: 'Confirm transaction' })
        await expect(dialog.getByText('ProposeMarketAccept', { exact: true })).toBeVisible()
        await expect(dialog.getByText('2.13 GNOT', { exact: true })).toBeVisible()
        await dialog.getByRole('button', { name: 'Confirm & Broadcast' }).click()
        await expect(folder.getByText(/^Transaction submitted: (ab){32}\./)).toBeVisible()
        const requests = await page.evaluate(() => (window as unknown as { __signRequests: unknown[] }).__signRequests)
        expect(requests).toHaveLength(1)
        expect(requests[0]).toMatchObject({ gasWanted: 24_000_000, messages: [{ type: '/vm.m_call', value: { caller: MEMBER, send: '', pkg_path: 'gno.land/r/samcrew/memba_dao', func: 'ProposeMarketAccept', args: [], max_deposit: '2130000ugnot' } }] })
        expect(new URL(page.url()).pathname).toBe('/os/dao/memba_dao')
    })

    test('a signature that finishes while another window is in front still reports its transaction', async ({ page }) => {
        await memberWallet(page, MAINNET)
        // The wallet answers only when the test lets it, like Adena waiting for its owner.
        await page.addInitScript(() => {
            const w = window as unknown as { adena: { DoContract: (request: unknown) => Promise<unknown> }; __releaseWallet?: () => void }
            const sign = w.adena.DoContract
            w.adena.DoContract = (request) => new Promise((resolve) => { w.__releaseWallet = () => resolve(sign(request)) })
        })
        await page.goto(`${OS_ON}/os/dao/memba_dao`)
        const folder = win(page, 'memba_dao')
        await folder.getByRole('listitem', { name: 'marketPolicy adapter' }).getByRole('button', { name: 'Propose acceptance' }).click()
        await page.getByRole('dialog', { name: 'Confirm transaction' }).getByRole('button', { name: 'Confirm & Broadcast' }).click()
        await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __releaseWallet?: () => void }).__releaseWallet)).toBe('function')
        // The address bar follows the front window: /os/dao/memba_dao becomes /os/daos.
        await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'DAOs' }).click()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/daos')
        await page.evaluate(() => (window as unknown as { __releaseWallet: () => void }).__releaseWallet())
        await expect(folder.getByText(/^Transaction submitted: (ab){32}\./)).toBeVisible()
        await expect(folder.getByText(/Wallet or page changed/)).toHaveCount(0)
    })

    test('the DAOs list keeps its Create button inside a 320 px window', async ({ page }, info) => {
        await page.addInitScript(() => {
            localStorage.setItem('memba_os_windows:guest:gnoland-1', JSON.stringify([{ token: 'app.daos', x: 40, y: 20, width: 320, height: 420, z: 1, min: false, max: false }]))
            localStorage.setItem('memba_saved_daos', JSON.stringify([{ realmPath: 'gno.land/r/a_long_namespace_name/a_team_with_a_long_realm_name', name: 'A team with a long realm name', addedAt: 1, chainId: 'gnoland-1', network: 'mainnet' }]))
        })
        await page.goto(`${OS_ON}/os`)
        const daos = win(page, 'DAOs')
        const create = daos.getByRole('button', { name: 'Create a DAO' })
        await expect(create).toBeVisible()
        await expect(daos.getByText('gno.land/r/a_long_namespace_name/a_team_with_a_long_realm_name')).toBeVisible()
        await daos.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
        expect(Math.round((await daos.boundingBox())!.width)).toBe(320)
        const body = daos.locator('.os-wbody')
        const widths = await body.evaluate((el) => ({ visible: el.clientWidth, content: el.scrollWidth }))
        expect(widths.content).toBeLessThanOrEqual(widths.visible)
        const edge = (await body.boundingBox())!
        const button = (await create.boundingBox())!
        expect(button.x + button.width).toBeLessThanOrEqual(edge.x + edge.width)
        await page.screenshot({ path: info.outputPath('os-daos-320.png'), animations: 'disabled' })
    })
})
