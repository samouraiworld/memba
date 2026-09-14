import type { Page } from '@playwright/test'
import { fulfillOnchainReads, mockChainStatus } from './onchain'

/** Test-only deterministic roster, never imported by application source. */
export async function fulfillProValidatorRoster(page: Page, mode: 'healthy' | 'mixed' | 'missing' | 'empty' | 'large' | 'resolved' = 'healthy') {
    const count = mode === 'empty' ? 0 : mode === 'large' ? 73 : mode === 'mixed' ? 4 : 3
    const ids = Array.from({ length: count }, (_, i) => i + 1)
    const hasSignatures = mode === 'healthy' || mode === 'large'

    const validator = (n: number, power: string) => ({
        address: `g1mockval000000000000000000000000000000${n}`,
        pub_key: { '@type': '/tm.PubKeyEd25519', value: `bW9ja3B1YmtleTAwMDAwMDAwMDAwMDAwMDAwMDA${n}=` },
        voting_power: power,
        proposer_priority: '0',
    })
    const VALIDATORS = {
        block_height: '435604',
        validators: ids.map(n => validator(n, String((count + 1 - n) * 10))),
    }
    const now = Date.now()
    const STATUS = { ...mockChainStatus(), sync_info: { latest_block_height: '435604', latest_block_time: new Date(now).toISOString(), catching_up: false } }
    const BLOCK = {
        block: {
            header: { chain_id: 'e2e-offline', height: '435594', time: new Date(now - 40_000).toISOString() },
            // tm2 commits carry `precommits`, not `signatures`.
            last_commit: {
                precommits: (hasSignatures ? ids : []).map(n => ({
                    type: 2,
                    height: '435593',
                    round: '0',
                    validator_address: `g1mockval000000000000000000000000000000${n}`,
                    validator_index: String(n - 1),
                    timestamp: '2026-07-30T11:59:40.000Z',
                })),
            },
        },
    }
    const NET_INFO = {
        listening: true,
        listeners: ['Listener(@)'],
        n_peers: '1',
        peers: [{
            node_info: {
                net_address: 'g1mockpeer0000000000000000000000000000001@203.0.113.7:26656',
                network: 'e2e-offline',
                moniker: 'e2e-peer-01',
                other: { tx_index: 'off', rpc_address: 'tcp://203.0.113.7:26657' },
            },
            is_outbound: false,
            remote_ip: '203.0.113.7',
        }],
    }

    await page.route(/monitoring\.gnolove\.world/, route => {
        const path = new URL(route.request().url()).pathname.toLowerCase()
        const rows = (mode === 'missing' ? [] : ids.filter(n => mode !== 'mixed' || n !== 4)).map(n => ({
            addr: `g1mockval000000000000000000000000000000${n}`,
            moniker: mode === 'large' ? `Validator ${String(n).padStart(3, '0')}` : ['Northstar', 'Harbor collective — international infrastructure and community operations', 'Cedar infrastructure'][n - 1],
            participationRate: 99.9, uptime: mode === 'mixed' && n === 2 ? 98 : mode === 'mixed' && n === 3 ? 80 : 99.9, operationTime: 32,
            missedBlocks: n, txContrib: 33.3,
        }))
        const incidents = mode === 'mixed' ? [2, 3].map(n => ({
            addr: `g1mockval000000000000000000000000000000${n}`,
            moniker: rows[n - 1].moniker,
            severity: n === 2 ? 'WARNING' : 'CRITICAL',
            timestamp: new Date(now - 60_000).toISOString(),
            details: n === 2 ? 'Intermittent signing detected. The operator is investigating connectivity across its infrastructure.' : 'Validator has stopped signing recent blocks.',
        })) : mode === 'resolved' ? [{ addr: rows[0].addr, moniker: rows[0].moniker, severity: 'RESOLVED', timestamp: new Date(now - 60_000).toISOString(), details: 'Normal signing resumed.' }] : []
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(path.includes('incident') ? incidents : path.includes('first_seen') ? [] : rows) })
    })
    await fulfillOnchainReads(page, ({ method }) => {
        if (method === 'validators') return VALIDATORS
        if (method === 'status') return STATUS
        if (method === 'block') return BLOCK
        if (method === 'net_info') return NET_INFO
        return null
    })
}
