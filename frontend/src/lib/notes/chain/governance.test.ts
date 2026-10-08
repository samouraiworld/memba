import { describe, expect, it } from 'vitest'
import { bech32Encode } from '../../dao/realmAddress'
import { blob, parseNote } from './schema'
import { notesGovernanceDigest } from './governance'
import golden from './__fixtures__/gov-digest-v1.json'

describe('realm/client governance digest parity', () => {
  it('matches the exact e75 keeper golden for a governed Rename', () => {
    expect(notesGovernanceDigest(golden.chainId, parseNote(golden.note), 'Rename', blob(golden.payload_base64, 180000), golden.op_id)).toBe(golden.digest)
  })
  it('binds ownership, CAS, mode, chain, operation, payload and raw binary commitment', () => {
    const note = parseNote(golden.note), payload = blob(golden.payload_base64, 180000), other = bech32Encode('g', new Uint8Array(20).fill(9))
    for (const patch of [{ id: 'ab'.repeat(16) }, { ownerGeneration: '3' }, { stateRevision: '4' }, { epoch: '1' }, { mode: 4 as const }, { owner: other }, { pendingOwner: other }, { commitment: new Uint8Array(32).fill(255) }]) {
      expect(notesGovernanceDigest(golden.chainId, { ...note, ...patch }, 'Rename', payload, golden.op_id)).not.toBe(golden.digest)
    }
    expect(notesGovernanceDigest('other-chain', note, 'Rename', payload, golden.op_id)).not.toBe(golden.digest)
    expect(notesGovernanceDigest(golden.chainId, note, 'Commit', payload, golden.op_id)).not.toBe(golden.digest)
    expect(notesGovernanceDigest(golden.chainId, note, 'Rename', payload, 'ff'.repeat(16))).not.toBe(golden.digest)
    payload[payload.length - 1] ^= 1
    expect(notesGovernanceDigest(golden.chainId, note, 'Rename', payload, golden.op_id)).not.toBe(golden.digest)
  })
  it('rejects partial/inconsistent listing flags and unknown executor addresses', () => {
    expect(() => parseNote({ ...golden.note, listed: true, moderator_hidden: true })).toThrow()
    expect(() => parseNote({ ...golden.note, executor: 'wrong' })).toThrow()
  })
})
