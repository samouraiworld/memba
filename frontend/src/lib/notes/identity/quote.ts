import { abciQueryText } from '../../dao/packageStatus'
import { freshFeeForGasWanted } from '../../grc20'
import { getRpcUrlsInOrder } from '../../rpcFallback'
import type { NotesReadClient } from '../chain/client'
import { check, decimal, NOTES_REALM, NOTES_REGISTRY } from '../chain/schema'
import type { IdentityQuoteProvider } from './request'

/** Product keeper measurement: ~1.01 GNOT storage and 34M gas; keep separate per-call caps. */
export const IDENTITY_CAPS = { registryUgnot: '1000000', backupUgnot: '1000000' } as const
export function identityQuote(client: NotesReadClient): IdentityQuoteProvider {
    return async input => {
        client.assertCurrent(); check(input.chainId === client.chainId && input.messages.length === 2)
        const [registry, backup] = input.messages
        check(registry.type === 'vm/MsgCall' && registry.value.pkg_path === NOTES_REGISTRY && registry.value.func === 'RegisterKey'
            && registry.value.max_deposit === '1000000ugnot' && registry.value.send === '')
        check(backup.type === 'vm/MsgCall' && backup.value.pkg_path === NOTES_REALM && backup.value.func === 'SetSeedBackup'
            && backup.value.max_deposit === '1000000ugnot' && backup.value.send === '')
        const urls = getRpcUrlsInOrder(), gasWanted = 60_000_000
        const [price, networkFeeUgnot] = await Promise.all([
            abciQueryText({ chainId: client.chainId, rpcUrl: urls[0], rpcUrls: urls }, 'params/vm:p:storage_price', ''),
            freshFeeForGasWanted(gasWanted),
        ])
        client.assertCurrent(); check(price.length < 64 && JSON.parse(price) === '100ugnot')
        return { requestDigest: input.requestDigest, chainId: input.chainId, atHeight: decimal(input.height, 63, true),
            expiresAtHeight: (BigInt(input.height) + 20n).toString(), expiresAtMs: Date.now() + 90_000,
            source: 'bounded-estimate', estimatedDepositUgnot: '1200000', maxDepositUgnot: '2000000', gasWanted, networkFeeUgnot }
    }
}
