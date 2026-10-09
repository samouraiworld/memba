import { describe, expect, it, vi } from 'vitest'
import type { NotesReadClient } from '../chain/client'
import type { AminoMsg } from '../../grc20'
import { identityQuote } from './quote'
import { NOTES_REALM, NOTES_REGISTRY } from '../chain/schema'
const io = vi.hoisted(() => ({ price: vi.fn(async () => '"100ugnot"'), fee: vi.fn(async () => 72000) }))
vi.mock('../../dao/packageStatus', () => ({ abciQueryText: io.price }))
vi.mock('../../grc20', () => ({ freshFeeForGasWanted: io.fee }))
vi.mock('../../rpcFallback', () => ({ getRpcUrlsInOrder: () => ['https://rpc.example'] }))
describe('atomic identity budget', () => {
    it('quotes both independently capped calls and refuses price or cap drift', async () => {
        const client = { chainId: 'gnoland-1', assertCurrent: vi.fn() } as unknown as NotesReadClient
        const messages: AminoMsg[] = [
            { type: 'vm/MsgCall', value: { caller: '', send: '', pkg_path: NOTES_REGISTRY, func: 'RegisterKey', args: [], max_deposit: '1000000ugnot' } },
            { type: 'vm/MsgCall', value: { caller: '', send: '', pkg_path: NOTES_REALM, func: 'SetSeedBackup', args: [], max_deposit: '1000000ugnot' } },
        ]
        const input = { chainId: client.chainId, messages, requestDigest: 'a'.repeat(64), height: '42' }
        const quote = identityQuote(client)
        expect(await quote(input)).toMatchObject({ source: 'bounded-estimate', gasWanted: 60000000, estimatedDepositUgnot: '1200000', maxDepositUgnot: '2000000', networkFeeUgnot: 72000 })
        io.price.mockResolvedValueOnce('"101ugnot"'); await expect(quote(input)).rejects.toThrow()
        messages[1].value.max_deposit = '1000001ugnot'; await expect(quote(input)).rejects.toThrow()
    })
})
