import { expect, test, type Page } from '@playwright/test'
import { getAddress } from 'viem'
import { OS_EVM } from '../../playwright.os.config'
import { abortOnchainReads } from '../helpers/onchain'

// Memba OS on the EVM network (Base Sepolia), flag on. A wallet is mocked the way
// real ones appear: an EIP-1193 provider announced over ERC-6963. No real chain,
// no real wallet: the Base Sepolia RPC is answered here.
const ADDR = '0xabcdef0123456789abcdef0123456789abcdef01'
const SIGNATURE = `0x${'5a'.repeat(65)}`
const SEPOLIA = '0x14a34'
const MAINNET = '0x2105'

async function onBase(page: Page, opts: { walletChain?: string } = {}) {
    await abortOnchainReads(page)
    await page.route(/sepolia\.base\.org/, async (route) => {
        const body = route.request().postDataJSON() as { id: number; method: string } | { id: number; method: string }[]
        const answer = (r: { id: number; method: string }) => ({ jsonrpc: '2.0', id: r.id, result: r.method === 'eth_chainId' ? SEPOLIA : '0x12d687' })
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)) })
    })
    await page.addInitScript(({ address, chain, signature }) => {
        localStorage.setItem('memba_os_skip_intro', '1')
        localStorage.setItem('memba_network_pref', 'base-sepolia')
        let chainId = chain
        // Like a real wallet, the site's permission outlives a reload.
        let connected = sessionStorage.getItem('e2e-wallet-connected') === '1'
        const remember = (on: boolean) => { connected = on; sessionStorage.setItem('e2e-wallet-connected', on ? '1' : '0') }
        const listeners: Record<string, ((v: unknown) => void)[]> = {}
        const emit = (event: string, value: unknown) => (listeners[event] ?? []).forEach((f) => f(value))
        const provider = {
            request: async ({ method, params }: { method: string; params?: { chainId: string }[] }) => {
                switch (method) {
                    case 'eth_requestAccounts': remember(true); return [address]
                    case 'eth_accounts': return connected ? [address] : []
                    case 'eth_chainId': return chainId
                    case 'personal_sign': return signature
                    case 'wallet_requestPermissions': remember(true); return [{ parentCapability: 'eth_accounts' }]
                    case 'wallet_getPermissions': return connected ? [{ parentCapability: 'eth_accounts' }] : []
                    case 'wallet_revokePermissions': remember(false); return null
                    case 'wallet_switchEthereumChain': chainId = params![0].chainId; emit('chainChanged', chainId); return null
                    default: throw Object.assign(new Error(`e2e wallet: ${method} unsupported`), { code: 4200 })
                }
            },
            on: (event: string, f: (v: unknown) => void) => { (listeners[event] ??= []).push(f) },
            removeListener: (event: string, f: (v: unknown) => void) => { listeners[event] = (listeners[event] ?? []).filter((x) => x !== f) },
        }
        const detail = Object.freeze({
            info: Object.freeze({ uuid: '6f2b1c0e-0000-4000-8000-000000000e2e', name: 'E2E Wallet', rdns: 'test.memba.e2e', icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E' }),
            provider,
        })
        const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))
        window.addEventListener('eip6963:requestProvider', announce)
        announce()
    }, { address: ADDR, chain: opts.walletChain ?? SEPOLIA, signature: SIGNATURE })
}

const connectModal = (page: Page) => page.getByRole('dialog', { name: 'Connect a wallet' })

test.describe('Memba OS on Base Sepolia', () => {
    // This server serves no other spec: the first visit pays for compiling all of Memba OS.
    test.describe.configure({ timeout: 120_000 })

    test('offers only the apps that run there, and sends gno.land links back to gno.land', async ({ page }) => {
        await onBase(page)
        await page.goto(`${OS_EVM}/os`)
        await expect(page.getByRole('button', { name: 'Network: Base Sepolia' })).toBeVisible()
        const dock = page.getByRole('navigation', { name: 'Dock' })
        await expect(dock.getByRole('button', { name: 'Settings' })).toBeVisible()
        await expect(dock.getByRole('button', { name: 'Validators' })).toHaveCount(0)
        await page.goto(`${OS_EVM}/os/validators`)
        await expect(page.getByText('Validators runs on gno.land')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Switch to gno.land' })).toBeVisible()
    })

    test('Settings confirms the RPC serves the selected chain', async ({ page }) => {
        await onBase(page)
        await page.goto(`${OS_EVM}/os/settings/network`)
        await expect(page.getByText('Chain 84532 confirmed · block 1,234,567')).toBeVisible()
    })

    test('connects an announced wallet and signs in with Ethereum', async ({ page }) => {
        await onBase(page)
        // The backend's SIWE RPCs, answered here; the test checks what the page sends them.
        const challenge = {
            nonce: '0123456789abcdef0123456789abcdef', chainId: 'eip155:84532', domain: new URL(OS_EVM).host, uri: OS_EVM,
            issuedAt: new Date().toISOString(), expiration: new Date(Date.now() + 600_000).toISOString(), statement: 'Sign in to Memba.', serverSignature: 'c2lnbmVk',
        }
        let tokenRequest: { challenge: unknown; message: string; signature: string } | null = null
        await page.route('**/memba.v1.MultisigService/GetSiweChallenge', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ challenge }) }))
        await page.route('**/memba.v1.MultisigService/GetSiweToken', async (route) => {
            tokenRequest = route.request().postDataJSON()
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authToken: {
                nonce: 'bm9uY2U=', expiration: new Date(Date.now() + 86_400_000).toISOString(), userAddress: ADDR, serverSignature: 'c2ln', chainId: 'eip155:84532',
            } }) })
        })
        await page.goto(`${OS_EVM}/os`)
        await page.getByRole('button', { name: 'Connect wallet' }).click()
        await connectModal(page).getByRole('button', { name: 'E2E Wallet' }).click()
        await connectModal(page).getByRole('button', { name: 'Sign in' }).click()
        await expect(connectModal(page)).toHaveCount(0)
        await expect(page.getByRole('button', { name: `Account ${getAddress(ADDR)}` })).toBeVisible()
        expect(tokenRequest!.signature).toBe(SIGNATURE)
        expect(tokenRequest!.challenge).toMatchObject({ nonce: challenge.nonce, chainId: 'eip155:84532' })
        expect(tokenRequest!.message).toContain(`${new URL(OS_EVM).host} wants you to sign in with your Ethereum account:\n${getAddress(ADDR)}`)
        expect(tokenRequest!.message).toContain(`Nonce: ${challenge.nonce}`)
        // The session survives a reload while the wallet stays connected.
        await page.reload()
        await expect(page.getByRole('button', { name: `Account ${getAddress(ADDR)}` })).toBeVisible()
    })

    test('gets a wallet on another chain onto Base Sepolia', async ({ page }) => {
        await onBase(page, { walletChain: MAINNET })
        await page.goto(`${OS_EVM}/os`)
        await page.getByRole('button', { name: 'Connect wallet' }).click()
        await connectModal(page).getByRole('button', { name: 'E2E Wallet' }).click()
        await expect(connectModal(page).getByText('Your wallet is on chain 8453. Switch it to Base Sepolia to sign in.')).toBeVisible()
        await connectModal(page).getByRole('button', { name: 'Switch wallet to Base Sepolia' }).click()
        await expect(connectModal(page).getByRole('button', { name: 'Sign in' })).toBeVisible()
    })
})
