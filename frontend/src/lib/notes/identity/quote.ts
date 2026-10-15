import { abciQueryText } from '../../dao/packageStatus'
import { freshFeeForGasWanted } from '../../grc20'
import { getRpcUrlsInOrder } from '../../rpcFallback'
import type { NotesReadClient } from '../chain/client'
import { check, decimal, NOTES_REGISTRY } from '../chain/schema'
import type { IdentityQuoteProvider } from './request'

/**
 * Key setup (RegisterKey + SetSeedBackup, one transaction), keeper-measured on the mainnet source (M0, 2026-10-15,
 * samcrew-deployer e485e2a on gno e75fef82, 100 ugnot/B): every identity after the first locks 1,412,400 ugnot
 * (registry 483,600 + backup 928,800); only the first in an empty registry locks 1,004,100. Separate per-call caps,
 * each with ~25-30 % headroom over its measured share: registry 0.6 GNOT (1.24x), backup 1.2 GNOT (1.29x).
 */
export const IDENTITY_CAPS = { registryUgnot: '600000', backupUgnot: '1200000' } as const
/** The measured 1.4124 GNOT rounded up to the next 0.05 GNOT: what the member is told it locks. */
export const IDENTITY_ESTIMATE_UGNOT = '1450000'
/** Keeper gas 34.0-39.7M, plus the ante handler's signature and fee gas: 60M stays at least 1.5x. */
export const IDENTITY_GAS_WANTED = 60_000_000
export const IDENTITY_MAX_DEPOSIT_UGNOT = (BigInt(IDENTITY_CAPS.registryUgnot) + BigInt(IDENTITY_CAPS.backupUgnot)).toString()
export function identityQuote(client: NotesReadClient): IdentityQuoteProvider {
    return async input => {
        client.assertCurrent(); check(input.chainId === client.chainId && input.messages.length === 2)
        const [registry, backup] = input.messages
        check(registry.type === 'vm/MsgCall' && registry.value.pkg_path === NOTES_REGISTRY && registry.value.func === 'RegisterKey'
            && registry.value.max_deposit === `${IDENTITY_CAPS.registryUgnot}ugnot` && registry.value.send === '')
        check(backup.type === 'vm/MsgCall' && backup.value.pkg_path === client.realm && backup.value.func === 'SetSeedBackup'
            && backup.value.max_deposit === `${IDENTITY_CAPS.backupUgnot}ugnot` && backup.value.send === '')
        const urls = getRpcUrlsInOrder(), gasWanted = IDENTITY_GAS_WANTED
        const [price, networkFeeUgnot] = await Promise.all([
            abciQueryText({ chainId: client.chainId, rpcUrl: urls[0], rpcUrls: urls }, 'params/vm:p:storage_price', ''),
            freshFeeForGasWanted(gasWanted),
        ])
        client.assertCurrent(); check(price.length < 64 && JSON.parse(price) === '100ugnot')
        return { requestDigest: input.requestDigest, chainId: input.chainId, atHeight: decimal(input.height, 63, true),
            expiresAtHeight: (BigInt(input.height) + 20n).toString(), expiresAtMs: Date.now() + 90_000,
            source: 'bounded-estimate', estimatedDepositUgnot: IDENTITY_ESTIMATE_UGNOT, maxDepositUgnot: IDENTITY_MAX_DEPOSIT_UGNOT, gasWanted, networkFeeUgnot }
    }
}
