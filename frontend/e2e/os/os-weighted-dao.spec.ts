import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { OS_ON } from '../../playwright.os.config'
import { fulfillOnchainReads, mockAppChainStatus } from '../helpers/onchain'
import { MAINNET, MEMBER, RESERVE, castBallots, memberWallet, v12Read } from '../helpers/weightedV12Fixture'

// The governing DAO (weighted host v12) in Memba OS, on the fake chain the
// classic weighted spec uses. Nothing here reaches a chain.

const win = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
/** Links in a window that would leave Memba OS. */
const linksOut = (window: ReturnType<typeof win>) => window.locator('a[href]').evaluateAll((links) => links.map((a) => a.getAttribute('href')).filter((href) => !href!.startsWith('/os')))
const fits = async (window: ReturnType<typeof win>) => {
    const widths = await window.locator('.os-wbody').evaluate((body) => ({ visible: body.clientWidth, content: body.scrollWidth }))
    expect(widths.content).toBeLessThanOrEqual(widths.visible)
}

test.describe('Memba OS weighted DAO', () => {
    test.beforeEach(async ({ page }) => {
        castBallots.clear()
        // Only other hosts are refused: the dev server's own modules must load.
        await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => {
            const url = new URL(route.request().url())
            return url.hostname === '127.0.0.1' && !/memba\.v1\./.test(url.pathname) ? route.continue() : route.abort()
        })
        await fulfillOnchainReads(page, ({ method, path, arg }) => {
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (path === 'vm/qeval') return v12Read(arg)
            // 1 ugnot per 1,000 gas, as gnoland-1 reports it.
            if (path === 'auth/gasprice') return JSON.stringify({ gas: 1000, price: '1ugnot' })
            // The Reserve holds 1.337 GNOT; every other address holds nothing.
            if (path.startsWith('bank/balances/')) return JSON.stringify(path.endsWith(RESERVE) ? '1337000ugnot' : '')
            return null
        })
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('a guest reads the governing DAO in its window: how it decides, its applications, seats, fees and proposals', async ({ page }, info) => {
        await page.goto(`${OS_ON}/os/daos`)
        await win(page, 'DAOs').getByRole('button', { name: /Memba DAO/ }).click()
        const folder = win(page, 'memba_dao')
        await expect(folder.getByText('7 seats · 8 voting points · gnoland-1')).toBeVisible()
        await expect(folder.getByText('6 points and at least 4 people, then 24 hours')).toBeVisible()
        await expect(folder.getByRole('button', { name: /#26 Feedback · Create a channel/ })).toBeVisible()
        await expect(folder.getByRole('listitem', { name: 'Market config' }).getByText('Ready to accept')).toBeVisible()
        await expect(folder.getByRole('listitem', { name: 'Escrow' }).getByText('DAO controls', { exact: true })).toBeVisible()
        await expect(folder.getByText('The DAO controls 9 of 10 today.')).toBeVisible()
        await expect(folder.getByText('12 open among the latest 20 proposals. The newest three:')).toBeVisible()
        // Each application's rules are the guest's to read too.
        const appStore = folder.getByRole('listitem', { name: 'App Store' })
        await appStore.getByText('Its rules').click()
        await expect(appStore.getByText('A fee vote can set at most 100 GNOT.')).toBeVisible()
        expect((await new AxeBuilder({ page }).include('[data-win="dao:memba_dao"]').analyze()).violations).toEqual([])
        await page.screenshot({ path: info.outputPath('os-weighted-dao-overview.png'), animations: 'disabled' })

        await folder.getByRole('tab', { name: 'Members' }).click()
        await expect(folder.getByText('Founder · 2 points')).toBeVisible()
        await expect(folder.getByText('Core developer · 1 point')).toHaveCount(6)
        await expect.poll(() => new URL(page.url()).pathname).toBe('/os/dao/memba_dao/members')

        await folder.getByRole('tab', { name: 'Treasury' }).click()
        await expect(folder.getByText('This DAO has no treasury and cannot spend funds')).toBeVisible()
        await expect(folder.getByRole('listitem').filter({ hasText: 'Market fees' })).toContainText('Paid today to g136j0m0…5cpf.')
        await expect(folder.getByRole('listitem').filter({ hasText: 'Market fees' })).toContainText('While the DAO controls Market config, a financial vote can move the fees there')
        await expect(folder.getByRole('listitem').filter({ hasText: 'Reserve wallet' })).toContainText('1.337 GNOT')
        // Nothing on the treasury can move funds.
        await expect(folder.getByRole('tabpanel').getByRole('button')).toHaveCount(0)
        await page.screenshot({ path: info.outputPath('os-weighted-dao-treasury.png'), animations: 'disabled' })

        await folder.getByRole('tab', { name: 'Proposals' }).click()
        await expect(folder.getByText('26 proposals recorded')).toBeVisible()
        // A guest reads everything; the connect prompts are at the acting steps (an application's acceptance, a proposal's window).
        await expect(folder.getByRole('button', { name: /Connect/ })).toHaveCount(0)
        await folder.getByRole('button', { name: /#17 Market config · Set a fee/ }).click()
        const proposal = win(page, 'memba_dao · Proposal #17')
        await expect(proposal.getByRole('heading', { name: '#17 Market config · Set a fee' })).toBeVisible()
        await expect(proposal.getByText('Points voting yes')).toBeVisible()
        await expect(proposal.getByRole('button', { name: 'Connect' })).toBeVisible()
        expect((await new AxeBuilder({ page }).include('[data-win="prop:memba_dao:17"]').analyze()).violations).toEqual([])
        expect(new URL(page.url()).pathname).toBe('/os/dao/memba_dao/proposals/17')
        // No link in either window leaves Memba OS for the classic site.
        expect(await linksOut(folder)).toEqual([])
        expect(await linksOut(proposal)).toEqual([])
        await fits(folder)
        await fits(proposal)
        await page.screenshot({ path: info.outputPath('os-weighted-dao-proposal.png'), animations: 'disabled' })
    })

    test('every section of the governing DAO fits a 320 px window', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('memba_os_windows:guest:gnoland-1', JSON.stringify([{ token: 'dao.memba_dao', x: 40, y: 20, width: 320, height: 520, z: 1, min: false, max: false }])))
        await page.goto(`${OS_ON}/os`)
        const folder = win(page, 'memba_dao')
        await expect(folder.getByText('The DAO controls 9 of 10 today.')).toBeVisible()
        await folder.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
        expect(Math.round((await folder.boundingBox())!.width)).toBe(320)
        await fits(folder)
        for (const [tab, sentinel] of [['Members', 'Founder · 2 points'], ['Treasury', 'The team declares it a 4-of-7 multisig.'], ['Proposals', '26 proposals recorded']] as const) {
            await folder.getByRole('tab', { name: tab }).click()
            await expect(folder.getByText(sentinel)).toBeVisible()
            await fits(folder)
        }
    })

    test('a proposal address of the governing DAO opens that proposal in its own window', async ({ page }) => {
        await page.goto(`${OS_ON}/os/dao/memba_dao/proposals/26`)
        const proposal = win(page, 'memba_dao · Proposal #26')
        await expect(proposal.getByRole('heading', { name: '#26 Feedback · Create a channel' })).toBeVisible()
        await expect(proposal.getByText('It passed. It can execute from the earliest time below.')).toBeVisible()
    })

    test('a member proposes an acceptance from the Overview through the Memba review, and the wallet gets exactly the reviewed call', async ({ page }) => {
        await memberWallet(page, MAINNET)
        await page.goto(`${OS_ON}/os/dao/memba_dao`)
        const folder = win(page, 'memba_dao')
        const market = folder.getByRole('listitem', { name: 'Market config' })
        await expect(market.getByText('Ready to accept')).toBeVisible()
        await market.getByRole('button', { name: 'Propose acceptance…' }).click()
        const review = page.getByRole('dialog', { name: 'Review · Propose' })
        await expect(review.getByRole('heading', { name: 'Propose that Memba DAO accepts the handover of Market config' })).toBeVisible()
        await expect(review.getByText('Network fee', { exact: true })).toBeVisible()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(review).toHaveCount(0)
        // The Memba review replaced the classic confirmation.
        await expect(page.getByRole('dialog', { name: 'Confirm transaction' })).toHaveCount(0)
        const requests = await page.evaluate(() => (window as unknown as { __signRequests: unknown[] }).__signRequests)
        expect(requests).toHaveLength(1)
        expect(requests[0]).toMatchObject({ gasWanted: 24_000_000, messages: [{ type: '/vm.m_call', value: { caller: MEMBER, send: '', pkg_path: 'gno.land/r/samcrew/memba_dao', func: 'ProposeMarketAccept', args: [], max_deposit: '2130000ugnot' } }] })
        // The fake chain never lists the new proposal: sent, not confirmed, and no second acceptance until the member checks it.
        await page.getByRole('button', { name: /Notifications, 1 new/ }).click()
        await expect(page.getByText('Submitted · Propose accepting Market config')).toBeVisible()
        await expect(folder.getByText('A previous proposal attempt is saved. Check its outcome before proposing an acceptance again.')).toBeVisible()
        await expect(folder.getByRole('button', { name: 'Propose acceptance…' })).toHaveCount(0)
    })

    test('a member votes in the proposal window through the Memba review, and the chain then shows the ballot', async ({ page }) => {
        await memberWallet(page, MAINNET)
        // The fake chain records the ballot once the wallet has signed the vote.
        await page.exposeFunction('__e2eSigned', (request: { messages: { value: { func: string; caller: string; args: string[] } }[] }) => {
            const { func, caller, args } = request.messages[0].value
            if (func === 'Vote') castBallots.set(`${args[0]}:${caller}`, args[1] as 'yes' | 'no' | 'abstain')
        })
        await page.addInitScript(() => {
            const w = window as unknown as { adena: { DoContract: (request: unknown) => Promise<unknown> }; __e2eSigned: (request: unknown) => Promise<void> }
            const sign = w.adena.DoContract
            w.adena.DoContract = async (request) => { const result = await sign(request); await w.__e2eSigned(request); return result }
        })
        await page.goto(`${OS_ON}/os/dao/memba_dao/proposals/17`)
        const proposal = win(page, 'memba_dao · Proposal #17')
        await expect(proposal.getByText('You have not voted.')).toBeVisible()
        await proposal.getByRole('button', { name: 'Vote…' }).click()
        const review = page.getByRole('dialog', { name: 'Review · Vote' })
        await expect(review.getByRole('heading', { name: 'Vote on #17 “Market config · Set a fee”' })).toBeVisible()
        // The fee was read from the chain, so it is shown as the fee, not as an estimate.
        await expect(review.getByText('Network fee', { exact: true })).toBeVisible()
        await review.getByRole('radio', { name: 'No' }).click()
        await review.getByRole('button', { name: 'Sign in Adena' }).click()
        await expect(review).toHaveCount(0)
        // The Memba review replaced the classic confirmation.
        await expect(page.getByRole('dialog', { name: 'Confirm transaction' })).toHaveCount(0)
        const requests = await page.evaluate(() => (window as unknown as { __signRequests: unknown[] }).__signRequests)
        expect(requests).toHaveLength(1)
        expect(requests[0]).toMatchObject({ messages: [{ type: '/vm.m_call', value: { caller: MEMBER, send: '', pkg_path: 'gno.land/r/samcrew/memba_dao', func: 'Vote', args: ['17', 'no'] } }] })
        await expect(proposal.getByText('You voted no (block 450001).')).toBeVisible()
        await page.getByRole('button', { name: /Notifications, 1 new/ }).click()
        await expect(page.getByText('Confirmed · Vote No on #17')).toBeVisible()
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
        await fits(daos)
        const edge = (await daos.locator('.os-wbody').boundingBox())!
        const button = (await create.boundingBox())!
        expect(button.x + button.width).toBeLessThanOrEqual(edge.x + edge.width)
        await page.screenshot({ path: info.outputPath('os-daos-320.png'), animations: 'disabled' })
    })
})
