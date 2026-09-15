import type { Page } from '@playwright/test'
export const REVIEW_ADDRESS = 'g1us8428u2a5satrlxzagqqa5m6vmuze025anjljj'
/** Synthetic browser-only session. No application bypass; backend and wallet writes fail closed. */
export async function accountReviewFixture(page: Page) {
    await page.addInitScript(({ address }) => {
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'design-fixture', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId: 'pearl-1', serverSignature: 'invalid-test-only' }))
        localStorage.setItem(`memba_wizard_seen_${address}`, '1')
        const rejectWrite = async () => { throw new Error('Review fixture: wallet actions are disabled') }
        const api = {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '0ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '0', sequence: '0', chainId: 'pearl-1' } }),
            GetNetwork: async () => ({ data: { rpcUrl: 'https://rpc.pearl.gno.land' } }),
            On: () => () => {},
            Sign: rejectWrite, SignTx: rejectWrite, DoContract: rejectWrite, AddEstablish: rejectWrite,
            CreateMultisigAccount: rejectWrite, CreateMultisigTransaction: rejectWrite, SignMultisigTransaction: rejectWrite, BroadcastMultisigTransaction: rejectWrite,
        }
        Object.defineProperty(window, 'adena', { value: api })
    }, { address: REVIEW_ADDRESS })
    await page.route('**/memba.v1.MultisigService/*', route => {
        const method = new URL(route.request().url()).pathname.split('/').pop()
        const readResponses: Record<string, unknown> = {
            Multisigs: { multisigs: [{ address: REVIEW_ADDRESS, name: 'Community operations', threshold: 2, membersCount: 3, joined: true }] },
            MultisigInfo: { multisig: { address: REVIEW_ADDRESS, name: 'Community operations', threshold: 2, membersCount: 3, joined: true } },
            Transactions: { transactions: [] },
            GetTransaction: { transaction: {
                id: 7, createdAt: '2026-09-15T09:00:00Z', multisigAddress: REVIEW_ADDRESS, creatorAddress: REVIEW_ADDRESS,
                chainId: 'pearl-1', threshold: 2, membersCount: 3, memo: 'Community operations — design fixture',
                msgsJson: JSON.stringify([{ type: '/bank.MsgSend', value: { from_address: REVIEW_ADDRESS, to_address: REVIEW_ADDRESS, amount: [{ denom: 'ugnot', amount: '5000000' }] } }]),
                feeJson: JSON.stringify({ gas_wanted: '200000', gas_fee: '10000ugnot' }),
                multisigPubkeyJson: JSON.stringify({ type: 'tendermint/PubKeyMultisigThreshold', value: { threshold: '2', pubkeys: [] } }),
            } },
        }
        if (method && method in readResponses) return route.fulfill({ json: readResponses[method] })
        return route.abort()
    })
}
