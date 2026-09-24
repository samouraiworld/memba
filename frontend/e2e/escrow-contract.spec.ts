import { test, expect, type Page } from '@playwright/test'
import { fulfillOnchainReads, mockAppChainStatus } from './helpers/onchain'

/**
 * Escrow happy path through the UI, fully offline: hire by address → fund →
 * mark delivered → release → archive, switching between the client's and the
 * freelancer's wallet, plus the paused state.
 *
 * Runs on the :5176 server (`vite --mode e2e-marketplace-v1`: test13, the v1
 * Services lane on, the escrow realm path pinned to escrow_v3 because only it
 * is allowlisted on test13). Nothing reaches a network: every gno RPC read is
 * answered by an in-test escrow model that returns the realm's JSON views
 * (GetContractJSON, GetClientContractsJSON, GetPauseStateJSON) in the realm's
 * exact shape, and the Adena stub applies each signed MsgCall to that model
 * (the realm's guards are not re-implemented: the test drives only valid calls).
 */

test.use({ baseURL: 'http://localhost:5176' })

const CLIENT = 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c'
const FREELANCER = 'g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq'
const ESCROW = 'gno.land/r/samcrew/escrow_v3'
const HEIGHT = 435_604 // mockChainStatus's latest_block_height

type Milestone = { title: string; amount: number; status: string; fundedAt: number; completedAt: number }
type Contract = { id: string; client: string; freelancer: string; title: string; description: string; status: string; createdAt: number; milestones: Milestone[] }

/** The escrow realm, as far as this flow needs it. */
class EscrowModel {
    contracts = new Map<string, Contract>()
    nextId = 0
    paused = false
    calls: { func: string; args: string[]; send: string; caller: string }[] = []

    apply(caller: string, func: string, args: string[], send: string) {
        this.calls.push({ func, args, send, caller })
        const c = this.contracts.get(args[0])
        const m = c?.milestones[Number(args[1])]
        switch (func) {
            case 'CreateContract': {
                const [freelancer, title, description, milestones] = args
                const id = String(this.nextId++)
                this.contracts.set(id, {
                    id, client: caller, freelancer, title, description, status: 'active', createdAt: HEIGHT,
                    milestones: milestones.split(',').map((p) => {
                        const i = p.lastIndexOf(':')
                        return { title: p.slice(0, i), amount: Number(p.slice(i + 1)), status: 'pending', fundedAt: 0, completedAt: 0 }
                    }),
                })
                return
            }
            case 'FundMilestone': m!.status = 'funded'; m!.fundedAt = HEIGHT; return
            case 'CompleteMilestone': m!.status = 'completed'; m!.completedAt = HEIGHT; return
            case 'ReleaseFunds':
                m!.status = 'released'
                if (c!.milestones.every((x) => x.status === 'released')) c!.status = 'completed'
                return
            case 'ArchiveContract': this.contracts.delete(args[0]); return
        }
        throw new Error(`unexpected escrow call ${func}`)
    }

    contractJSON(id: string): string {
        const c = this.contracts.get(id)
        if (!c) return JSON.stringify({ exists: false, id })
        const h = (n: number) => (n ? String(n) : null)
        const sum = (f: (m: Milestone) => boolean) => String(c.milestones.filter(f).reduce((s, m) => s + m.amount, 0))
        const pending = c.milestones.every((m) => m.status === 'pending')
        const funded = c.milestones.map((m) => m.fundedAt).filter((n) => n > 0)
        const refunds = c.milestones.filter((m) => m.status === 'funded').map((m) => m.fundedAt + 864_000)
        return JSON.stringify({
            exists: true, id, client: c.client, freelancer: c.freelancer, title: c.title, description: c.description, status: c.status,
            createdAtHeight: String(c.createdAt), fundedAtHeight: h(funded.length ? Math.min(...funded) : 0),
            refundAt: h(refunds.length ? Math.min(...refunds) : 0),
            expireAt: h(pending && c.status === 'active' ? c.createdAt + 864_000 : 0), resolveAt: null,
            milestones: c.milestones.map((m, i) => ({
                index: String(i), title: m.title, amountUgnot: String(m.amount), status: m.status,
                fundedAtHeight: h(m.fundedAt), completedAtHeight: h(m.completedAt), disputedAtHeight: null,
                refundAt: h(m.status === 'funded' ? m.fundedAt + 864_000 : 0), resolveAt: null,
            })),
            totals: {
                amountUgnot: sum(() => true),
                escrowedUgnot: sum((m) => ['funded', 'completed', 'disputed'].includes(m.status)),
                releasedUgnot: sum((m) => m.status === 'released'),
                refundedUgnot: sum((m) => m.status === 'refunded'),
            },
        })
    }

    clientJSON(client: string, limit: number): string {
        const mine = [...this.contracts.values()].filter((c) => c.client === client).sort((a, b) => Number(b.id) - Number(a.id))
        const page = mine.slice(0, limit)
        return JSON.stringify({
            items: page.map((c) => ({ id: c.id, status: c.status, createdAtHeight: String(c.createdAt) })),
            next: mine.length > limit ? page[page.length - 1].id : null,
        })
    }

    pauseJSON(): string {
        return this.paused
            ? JSON.stringify({ paused: true, pausedAt: String(HEIGHT - 10), exitsReopenAt: String(HEIGHT - 10 + 183_273), exitsOpen: false, cooldownUntil: '0', pausedBlocks: '10' })
            : JSON.stringify({ paused: false, pausedAt: null, exitsReopenAt: null, exitsOpen: true, cooldownUntil: '0', pausedBlocks: '0' })
    }
}

/** A Gno string as vm/qeval prints it. */
const qevalString = (s: string) => `(${JSON.stringify(s)} string)`

async function setup(page: Page, escrow: EscrowModel) {
    await page.route(/memba\.v1\./, (route) => route.abort())
    await page.route(/monitoring\.gnolove\.world/, (route) => route.abort())
    await page.exposeFunction('escrowWrite', (caller: string, func: string, args: string[], send: string) => escrow.apply(caller, func, args, send))
    await page.addInitScript(({ client }) => {
        const address = localStorage.getItem('e2e-wallet') || client
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem(`memba_wizard_seen_${address}`, '1')
        const reject = async () => { throw new Error('Unexpected fixture wallet method') }
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '100000000ugnot', publicKey: null, accountNumber: '0', sequence: '0', chainId: 'test-13' } }),
            GetNetwork: async () => ({ data: { chainId: 'test-13', rpcUrl: 'https://rpc.test13.testnets.gno.land:443' } }),
            On: () => () => {},
            AddEstablish: async () => ({ status: 'success' }),
            DoContract: async ({ messages }: { messages: { value: { caller: string; func: string; args: string[]; send: string } }[] }) => {
                for (const m of messages) {
                    await (window as unknown as { escrowWrite: (...a: unknown[]) => Promise<void> }).escrowWrite(m.value.caller, m.value.func, m.value.args, m.value.send)
                }
                return { status: 'success', data: { hash: 'e'.repeat(64) } }
            },
            Sign: reject, SignTx: reject,
        } })
    }, { client: CLIENT })
    await fulfillOnchainReads(page, ({ method, path, arg }) => {
        if (method === 'status') return mockAppChainStatus('test-13')
        if (path !== 'vm/qeval' || !arg.startsWith(`${ESCROW}.`)) return null
        const expr = arg.slice(ESCROW.length + 1)
        let m: RegExpMatchArray | null
        if (expr === 'GetPauseStateJSON()') return qevalString(escrow.pauseJSON())
        if (expr === 'GetCreatedCount()') return `(${escrow.nextId} int)`
        if ((m = expr.match(/^GetClientActiveCount\("(g1\w+)"\)$/))) {
            return `(${[...escrow.contracts.values()].filter((c) => c.client === m![1] && c.status !== 'completed' && c.status !== 'cancelled').length} int)`
        }
        if ((m = expr.match(/^GetClientContractsJSON\("(g1\w+)", "", (\d+)\)$/))) return qevalString(escrow.clientJSON(m[1], Number(m[2])))
        if ((m = expr.match(/^GetContractJSON\("(\d+)"\)$/))) return qevalString(escrow.contractJSON(m[1]))
        return null
    })
}

async function confirmBroadcast(page: Page) {
    await page.getByRole('button', { name: 'Confirm & Broadcast' }).click()
}

async function asWallet(page: Page, address: string) {
    await page.evaluate((a) => localStorage.setItem('e2e-wallet', a), address)
    await page.reload()
}

test.describe('Escrow contract screens (offline fixture)', () => {
    test('hire by address, fund, deliver, release and archive', async ({ page }) => {
        // Five signed calls and two wallet switches: firefox needs about 40 s locally.
        test.setTimeout(120_000)
        const escrow = new EscrowModel()
        await setup(page, escrow)

        await page.goto('/test13/marketplace/services')
        const open = page.getByTestId('hire-by-address-open')
        await expect(open).toBeEnabled({ timeout: 15_000 })
        await open.click()
        const form = page.getByTestId('hire-by-address')
        await form.getByLabel('Freelancer address').fill(FREELANCER)
        await form.getByLabel('Title', { exact: true }).fill('Canary logo')
        await form.getByLabel('Milestone 1 title').fill('Logo')
        await form.getByLabel('Milestone 1 amount in GNOT').fill('0.001')
        await expect(form.getByTestId('hire-by-address-terms')).toContainText('at most 5 open contracts')
        await form.getByRole('button', { name: 'Review and sign' }).click()
        const sign = page.getByRole('button', { name: /sign escrow tx/i })
        await expect(sign).toBeEnabled()
        await sign.click()
        await confirmBroadcast(page)

        // Read back and routed to the new contract's shareable page.
        await expect(page).toHaveURL(/\/test13\/marketplace\/services\/contract\/0$/)
        const created = page.getByTestId('escrow-created')
        await expect(created).toContainText('Share this link with your freelancer:')
        await expect(created.getByLabel('Contract link')).toHaveValue(/\/test13\/marketplace\/services\/contract\/0$/)
        expect(escrow.calls[0]).toMatchObject({ func: 'CreateContract', caller: CLIENT, args: [FREELANCER, 'Canary logo', '', 'Logo:1000'], send: '' })

        // Client funds the milestone with exactly its amount.
        await page.getByRole('button', { name: 'Fund milestone (0.001 GNOT)' }).click()
        await confirmBroadcast(page)
        await expect(page.getByRole('status').filter({ hasText: 'is funded' })).toBeVisible()
        await expect(page.getByTestId('escrow-milestone-0')).toContainText('Funded, in escrow')
        expect(escrow.calls[1]).toMatchObject({ func: 'FundMilestone', args: ['0', '0'], send: '1000ugnot' })
        await expect(page.getByRole('button', { name: 'Mark delivered' })).toHaveCount(0)

        // The freelancer opens the shared link and marks it delivered.
        await asWallet(page, FREELANCER)
        await expect(page.getByText('Freelancer (you)')).toBeVisible({ timeout: 15_000 })
        await expect(page.getByRole('button', { name: /Fund milestone|Release payment|Cancel contract/ })).toHaveCount(0)
        await page.getByRole('button', { name: 'Mark delivered' }).click()
        await confirmBroadcast(page)
        await expect(page.getByTestId('escrow-milestone-0')).toContainText('Delivered, awaiting release')
        expect(escrow.calls[2]).toMatchObject({ func: 'CompleteMilestone', caller: FREELANCER, args: ['0', '0'], send: '' })

        // The client releases the payment, then archives the settled contract.
        await asWallet(page, CLIENT)
        await page.getByRole('button', { name: 'Release payment' }).click({ timeout: 15_000 })
        await confirmBroadcast(page)
        await expect(page.getByTestId('escrow-milestone-0')).toContainText('Released to the freelancer')
        expect(escrow.calls[3]).toMatchObject({ func: 'ReleaseFunds', caller: CLIENT, args: ['0', '0'] })
        await page.getByRole('button', { name: /Archive and reclaim deposit/ }).click()
        await confirmBroadcast(page)
        await expect(page.getByTestId('escrow-contract-missing')).toContainText('Contract 0 does not exist or has been archived.')
        expect(escrow.calls.map((c) => c.func)).toEqual(['CreateContract', 'FundMilestone', 'CompleteMilestone', 'ReleaseFunds', 'ArchiveContract'])

        for (const width of [375, 1280]) {
            await page.setViewportSize({ width, height: 900 })
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        }
    })

    test('while paused, hiring and funding are refused and other calls wait', async ({ page }) => {
        const escrow = new EscrowModel()
        escrow.apply(CLIENT, 'CreateContract', [FREELANCER, 'Paused job', '', 'Logo:1000'], '')
        escrow.paused = true
        escrow.calls = []
        await setup(page, escrow)

        await page.goto('/test13/marketplace/services')
        await expect(page.getByTestId('escrow-hiring-closed')).toContainText('paused', { timeout: 15_000 })
        await expect(page.getByTestId('hire-by-address-open')).toBeDisabled()

        await page.goto('/test13/marketplace/services/contract/0')
        await expect(page.getByTestId('escrow-pause-note')).toContainText(/reopens at block/, { timeout: 15_000 })
        const fund = page.getByTestId('escrow-fund-0')
        await expect(fund.getByRole('button')).toBeDisabled()
        await expect(fund).toContainText('Escrow is paused: funding is refused until it is unpaused.')
        await expect(page.getByTestId('escrow-cancel').getByRole('button')).toBeDisabled()
        expect(escrow.calls).toEqual([])
    })
})
