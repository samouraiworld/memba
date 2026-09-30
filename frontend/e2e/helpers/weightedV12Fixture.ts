import type { Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { bech32Encode } from '../../src/lib/dao/realmAddress'
import { qevalWire, weightedRealm } from '../../src/lib/dao/testdata/weighted'

// Host v12 (the mainnet governing DAO): verbatim native reads, no hand-built JSON.
export const v12 = JSON.parse(readFileSync(new URL('../../src/lib/dao/testdata/weighted-v12/native.json', import.meta.url), 'utf8')).records as Record<string, unknown>
// A DAO's own package address, and each adapter target's authority getters (see weightedAcceptance.ts).
const daoAddress = (realmPath: string) => bech32Encode('g', new Uint8Array(createHash('sha256').update(`pkgPath:${realmPath}`).digest().subarray(0, 20)))
export const PUBLISHER = (v12.config as { marketPolicy: { successor: string } }).marketPolicy.successor
/** The treasury the DAO's policies name; on the fake chain, as on mainnet today, the fee-collecting targets still pay the publisher. */
export const RESERVE = (v12.config as { marketPolicy: { treasury: string } }).marketPolicy.treasury
const FEE_TARGETS = ['gno.land/r/samcrew/memba_market_config', 'gno.land/r/samcrew/memba_appstore_v3']
const AUTHORITY: Record<string, [string, string, 'address' | 'string']> = {
    'gno.land/r/samcrew/memba_market_config': ['GetAdmin', 'GetPendingAdmin', 'address'],
    'gno.land/r/samcrew/memba_reviews_v2': ['GetModerator', 'GetPendingModerator', 'string'],
    'gno.land/r/samcrew/memba_quest_attestation_v1': ['GetOwner', 'GetPendingOwner', 'string'],
    'gno.land/r/samcrew/memba_arcade_leaderboard_v1': ['GetOwner', 'GetPendingOwner', 'address'],
    'gno.land/r/samcrew/memba_appstore_v3': ['GetOwner', 'GetPendingOwner', 'address'],
    'gno.land/r/samcrew/escrow_v4': ['GetAdmin', 'GetPendingAdmin', 'string'],
    'gno.land/r/samcrew/gnobuilders_badges_v2': ['GetOwner', 'GetPendingOwner', 'address'],
    'gno.land/r/samcrew/memba_feed_v1': ['GetOwner', 'GetPendingOwner', 'address'],
    'gno.land/r/samcrew/memba_dao_channels_v2': ['GetOwner', 'GetPendingOwner', 'address'],
    'gno.land/r/samcrew/memba_feedback_v2': ['GetOwner', 'GetPendingOwner', 'address'],
}
/** Target authority on the fake chain: the market-config admin is nominated to the DAO at `realmPath`; that DAO already controls the rest. */
function targetRead(expression: string, realmPath: string): string | undefined {
    const DAO = daoAddress(realmPath)
    const realm = Object.keys(AUTHORITY).find(path => expression.startsWith(`${path}.`))
    if (!realm) return undefined
    if (expression === `${realm}.GetTreasury()` && FEE_TARGETS.includes(realm)) return `(${JSON.stringify(PUBLISHER)} .uverse.address)`
    const [current, pending, type] = AUTHORITY[realm]
    const nominated = realm.endsWith('/memba_market_config')
    const value = expression === `${realm}.${current}()` ? (nominated ? PUBLISHER : DAO) : expression === `${realm}.${pending}()` ? (nominated ? DAO : '') : undefined
    if (value === undefined) return undefined
    return type === 'string' ? `(${JSON.stringify(value)} string)` : value ? `(${JSON.stringify(value)} .uverse.address)` : '( .uverse.address)'
}
/** Ballots the fake chain has recorded, by `<proposal>:<voter>`; a spec sets one when its wallet signs a vote, and clears them before each test. */
export const castBallots = new Map<string, 'yes' | 'no' | 'abstain'>()
/** The fake chain's `vm/qeval` answer for `expression` (the DAO at `realmPath` and its adapter targets), or undefined when it has none. */
export function v12Read(expression: string, realmPath = weightedRealm): string | undefined {
    const target = targetRead(expression, realmPath)
    if (target) return target
    if (!expression.startsWith(`${realmPath}.`)) return undefined
    const call = expression.slice(realmPath.length + 1)
    const ballot = call.match(/^GetBallotJSON\("(\d+)", "(g1[0-9a-z]{38})"\)$/)
    const value = call === 'GetConfigJSON()' ? { ...(v12.config as object), realmPath } : call === 'GetMembersJSON()' ? v12.members
        : call === 'GetProposalsJSON(0, 20)' ? v12.proposals_page_1 : call === 'GetProposalsJSON(7, 20)' ? v12.proposals_page_2
        : ballot ? { schema: 'memba-weighted-host/v12', proposalId: ballot[1], voter: ballot[2], eligible: true, choice: castBallots.get(`${ballot[1]}:${ballot[2]}`) ?? null, votedAtHeight: castBallots.has(`${ballot[1]}:${ballot[2]}`) ? '450001' : null }
        : v12[`proposal_${call.match(/^GetProposalJSON\((\d+)\)$/)?.[1]}`]
    return value === undefined ? undefined : qevalWire(value)
}
/** Serve the v12 DAO's direct RPC reads; a read the fake chain has no answer for fails as a VM error. */
export async function routeV12(page: Page, network = 'gnoland-1', realmPath = weightedRealm) {
    await page.route('**/status', route => route.fulfill({ json: { result: { node_info: { network } } } }))
    await page.route('**/abci_query?**', route => {
        const params = new URL(route.request().url()).searchParams
        const expression = params.get('path') === '"vm/qeval"' ? Buffer.from(params.get('data')!.slice(2), 'hex').toString('utf8') : ''
        const data = v12Read(expression, realmPath)
        if (data === undefined) return route.fulfill({ json: { result: { response: { ResponseBase: { Data: '', Error: { '@type': '/vm.UnauthorizedUserError' }, Log: `unexpected ${expression}` } } } } })
        return route.fulfill({ json: { result: { response: { ResponseBase: { Data: Buffer.from(data).toString('base64'), Error: null } } } } })
    })
}

// A member's wallet, by default on a non-mainnet network (test13: hidden but resolvable).
// The wallet records what it is asked to sign and never reaches a chain.
export const MEMBER = (v12.members as { members: { address: string }[] }).members[1].address
export const TEST13 = { network: 'test13', chainId: 'test-13', rpcUrl: 'https://rpc.test13.testnets.gno.land:443' }
export const MAINNET = { network: 'mainnet', chainId: 'gnoland-1', rpcUrl: 'https://rpc.gno.land:443' }
export async function memberWallet(page: Page, where = TEST13) {
    await page.addInitScript(({ address, network, chainId, rpcUrl }) => {
        localStorage.setItem('memba_network', network)
        localStorage.setItem('memba_adena_connected', 'true')
        localStorage.setItem('memba_auth_token', JSON.stringify({ nonce: 'e2e', userAddress: address, expiration: '2099-01-01T00:00:00Z', chainId, serverSignature: 'invalid-test-only' }))
        localStorage.setItem(`memba_wizard_seen_${address}`, '1')
        const w = window as unknown as { __signRequests: unknown[] }
        w.__signRequests = []
        const reject = async () => { throw new Error('e2e wallet: not available') }
        Object.defineProperty(window, 'adena', { value: {
            GetAccount: async () => ({ status: 'success', data: { address, coins: '100000000ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'A6+DHJsdkWFczHKaLWvmPIIQhjIQRYHrSzqFZGsrwJfE' }, accountNumber: '1', sequence: '0', chainId } }),
            GetNetwork: async () => ({ data: { chainId, rpcUrl } }),
            On: () => () => {},
            DoContract: async (request: unknown) => { w.__signRequests.push(request); return { status: 'success', data: { hash: 'ab'.repeat(32) } } },
            Sign: reject, SignTx: reject, AddEstablish: reject,
        } })
    }, { address: MEMBER, ...where })
}
