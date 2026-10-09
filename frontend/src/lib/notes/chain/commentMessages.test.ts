import { describe, expect, it } from 'vitest'
import { bech32Encode } from '../../dao/realmAddress'
import { publicCommentMessage, type CommentOperation } from './commentMessages'
import { encode64, NOTES_REALM } from './schema'

const caller = bech32Encode('g', new Uint8Array(20).fill(1)), noteId = '01'.repeat(16), commentId = '02'.repeat(16), operationId = '03'.repeat(16)
const operation: CommentOperation = { caller, noteId, commentId, operationId, action: { kind: 'add', bodyRevision: '9007199254740993', epoch: '2', anchor: 'Quoted', body: 'Reply 🐱' } }
describe('public comment MsgCall builders', () => {
  it('binds exact byte-array IDs, slice payloads, uint64 strings, root parent and deposit cap', () => {
    expect(publicCommentMessage(operation, '3000000')).toEqual({ type: 'vm/MsgCall', value: {
      caller, send: '', pkg_path: NOTES_REALM, func: 'AddComment', max_deposit: '3000000ugnot',
      args: [encode64(new Uint8Array(16).fill(1)), encode64(new Uint8Array(16).fill(2)), '9007199254740993', '2', encode64(new Uint8Array(16)), btoa('Quoted'), encode64(new TextEncoder().encode('Reply 🐱')), encode64(new Uint8Array(16).fill(3))],
    } })
  })
  it('binds independent comment revisions and literal moderation booleans', () => {
    for (const [action, func, tail] of [
      [{ kind: 'delete', revision: '5' }, 'DeleteComment', []],
      [{ kind: 'resolve', revision: '5', resolved: false }, 'ResolveComment', ['false']],
      [{ kind: 'hide', revision: '5', hidden: true }, 'HideComment', ['true']],
    ] as const) {
      const message = publicCommentMessage({ ...operation, action }, '0')
      expect(message.value.func).toBe(func)
      expect(message.value.args).toEqual([encode64(new Uint8Array(16).fill(1)), encode64(new Uint8Array(16).fill(2)), '5', ...tail, encode64(new Uint8Array(16).fill(3))])
    }
  })
  it('refuses oversized, malformed Unicode, invalid parent and noncanonical integer inputs', () => {
    const add = operation.action as Extract<CommentOperation['action'], { kind: 'add' }>
    for (const patch of [{ body: '' }, { body: 'a'.repeat(1001) }, { body: '\ud800' }, { anchor: 'é'.repeat(301) }, { parent: commentId }, { parent: 'bad' }, { bodyRevision: '01' }, { epoch: '4294967296' }]) expect(() => publicCommentMessage({ ...operation, action: { ...add, ...patch } }, '0')).toThrow()
    expect(() => publicCommentMessage({ ...operation, action: { ...add, body: '🐱'.repeat(1000) } }, '3000000')).not.toThrow()
  })
})
