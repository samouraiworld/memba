import { expect, test, type Page } from '@playwright/test'
import { OS_FLAGS_ON } from '../../playwright.os.config'
import { fulfillOnchainReads, mockAppChainStatus } from '../helpers/onchain'

// Linking GitHub from the Memba OS Profile window, round trip: the backend
// issues a state for the signed-in wallet, "GitHub" sends the browser back to
// /github/callback, the backend exchange answers, and the owner lands on their
// Profile window again. GitHub and the backend are stubs; nothing leaves the page.

const OWNER = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5'

async function signedInOwner(page: Page) {
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
    await fulfillOnchainReads(page, ({ method, path, arg }) => {
        if (method === 'status') return mockAppChainStatus('gnoland-1')
        if (method !== 'abci_query') return null
        if (path.startsWith('bank/balances/')) return '"250000000ugnot"'
        if (path === `auth/accounts/${OWNER}`) return JSON.stringify({ BaseAccount: { address: OWNER, sequence: '1', coins: '250000000ugnot' } })
        if (path === 'vm/qeval' && arg.includes('GetStringField(')) {
            const [, fallback] = /GetStringField\(address\("[^"]+"\), "[^"]+", ("(?:[^"\\]|\\.)*")\)/.exec(arg) ?? []
            return `(${fallback ?? '""'} string)`
        }
        return null
    })
    await page.addInitScript((address) => {
        localStorage.setItem('memba_os_skip_intro', '1')
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'e2e', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'gnoland-1', serverSignature: 'e2e-only' }))
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '250000000ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '1', sequence: '1', chainId: 'gnoland-1' } }),
            GetNetwork: async () => ({ status: 'success', data: { chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land' } }),
            On: () => true,
        } })
    }, OWNER)
    await page.setViewportSize({ width: 1280, height: 860 })
}

test('the owner links GitHub from the Profile window and comes back to it', async ({ page }) => {
    await signedInOwner(page)
    const exchanges: { url: string; auth: string | undefined }[] = []
    await page.route('**/github/oauth/state', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'st-e2e' }) }))
    await page.route('https://github.com/login/oauth/authorize**', (route) => {
        const url = new URL(route.request().url())
        expect(url.searchParams.get('client_id')).toBe('e2e-client')
        expect(url.searchParams.get('redirect_uri')).toBe(`${OS_FLAGS_ON}/github/callback`)
        return route.fulfill({ status: 302, headers: { location: `${url.searchParams.get('redirect_uri')}?code=c0de&state=${url.searchParams.get('state')}` } })
    })
    await page.route('**/github/oauth/exchange**', (route) => {
        exchanges.push({ url: route.request().url(), auth: route.request().headers().authorization })
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ login: 'octo-e2e', avatar_url: '', name: 'Octo' }) })
    })

    await page.goto(`${OS_FLAGS_ON}/os/profile`)
    const card = page.getByTestId('os-profile-github')
    await card.getByRole('button', { name: 'Link GitHub' }).click()

    await expect(page.getByText('@octo-e2e linked ✓')).toBeVisible()
    expect(exchanges).toHaveLength(1)
    const sent = new URL(exchanges[0].url)
    expect(sent.searchParams.get('code')).toBe('c0de')
    expect(sent.searchParams.get('state')).toBe('st-e2e')
    expect(exchanges[0].auth).toBeTruthy()

    await expect(page).toHaveURL(new RegExp(`/os/profile/${OWNER}$`), { timeout: 10_000 })
    await expect(page.getByTestId('os-profile-window')).toBeVisible()
})

test('a guest sees no GitHub card, only the way to connect', async ({ page }) => {
    await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => route.abort())
    await fulfillOnchainReads(page, ({ method }) => (method === 'status' ? mockAppChainStatus('gnoland-1') : null))
    await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
    await page.goto(`${OS_FLAGS_ON}/os/profile`)
    await expect(page.getByRole('button', { name: 'Connect to create yours' })).toBeVisible()
    await expect(page.getByTestId('os-profile-github')).toHaveCount(0)
    await page.goto(`${OS_FLAGS_ON}/os/profile/${OWNER}`)
    await expect(page.getByTestId('os-profile-window')).toBeVisible()
    await expect(page.getByTestId('os-profile-github')).toHaveCount(0)
})
