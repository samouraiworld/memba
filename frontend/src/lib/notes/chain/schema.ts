import { isValidGnoAddressChecksum } from '../../dao/address'
import { decodeGoQuoted } from '../../goQuote'

export const NOTES_REALM = 'gno.land/r/samcrew/memba_notes_v1'
export const NOTES_REGISTRY = 'gno.land/r/samcrew/enckeys_v1'
export const KEY_SUITE = 'xwing-v1'
export class NotesChainError extends Error {
  constructor(readonly code: 'format' | 'network' | 'session' | 'unavailable' | 'disabled' | 'stale' | 'storage') {
    super(`Notes chain: ${code}`); this.name = 'NotesChainError'
  }
}
export function check(ok: unknown): asserts ok { if (!ok) throw new NotesChainError('format') }
export function record(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value))
  const object = value as Record<string, unknown>
  check(keys.every(key => Object.hasOwn(object, key)) && Object.keys(object).every(key => keys.includes(key) || optional.includes(key)))
  return object
}
export function decimal(value: unknown, bits = 64, positive = false): string {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value))
  const n = BigInt(value); check(n < (1n << BigInt(bits)) && (!positive || n > 0n)); return value
}
export function address(value: unknown, optional = false): string {
  check((optional && value === '') || isValidGnoAddressChecksum(value)); return value as string
}
export function id(value: unknown): string {
  check(typeof value === 'string' && /^[a-f0-9]{32}$/.test(value) && !/^0+$/.test(value)); return value
}
export function encode64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
export function blob(value: unknown, max: number): Uint8Array {
  check(typeof value === 'string' && value.length <= 4 * Math.ceil(max / 3) && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0))
  check(bytes.length <= max && encode64(bytes) === value); return bytes
}
export function cursor(value: unknown): string {
  check(typeof value === 'string' && (value === '' || /^[0-9]{20}:[a-f0-9]{32}$/.test(value)))
  if (value) { check(BigInt(value.slice(0, 20)) <= 0xffffffffffffffffn); id(value.slice(21)) }
  return value
}
export function decodeResponse(raw: string): unknown {
  check(typeof raw === 'string' && raw.length <= 400_000)
  const match = raw.match(/^\("([\s\S]*)" string\)\s*$/); check(match)
  try { return JSON.parse(decodeGoQuoted('"' + match[1] + '"')) }
  catch { throw new NotesChainError('format') }
}
export function publicText(bytes: Uint8Array, title = false): string {
  check(bytes.length <= (title ? 160 : 131072))
  let value: string
  try { value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { throw new NotesChainError('format') }
  // Go strings.TrimSpace follows Unicode White_Space, unlike JS trim (BOM/NEL differ).
  if (title) check(value.length > 0 && [...value].length <= 80 && !/^[\p{White_Space}]|[\p{White_Space}]$/u.test(value) && !/[\p{Cc}\p{Cf}]/u.test(value) && !value.includes('/'))
  return value
}
export interface ChainNote {
  id: string; owner: string; pendingOwner: string; ownerGeneration: string; mode: 0 | 1 | 2 | 3 | 4
  stateRevision: string; titleRevision: string; bodyRevision: string; epoch: string
  title: Uint8Array; body?: Uint8Array; commitment: Uint8Array; deleted: boolean; listed: boolean
  createdHeight: string; operationId: string; actor: string; height: string
  executor?: string; govWriters?: boolean; ownerListed?: boolean; moderatorHidden?: boolean
  bodyBytes?: number
}
const NOTE_KEYS = ['id', 'owner', 'pending_owner', 'owner_generation', 'mode', 'state_revision', 'title_revision', 'body_revision', 'epoch', 'title_blob', 'commitment', 'deleted', 'listed', 'created_height', 'op_id', 'actor', 'height']
export function parseNote(value: unknown, withBody = true): ChainNote {
  const v = record(value, withBody ? [...NOTE_KEYS, 'body_blob'] : NOTE_KEYS, ['executor', 'gov_writers', 'owner_listed', 'moderator_hidden', 'body_bytes'])
  check(Number.isInteger(v.mode) && Number(v.mode) >= 0 && Number(v.mode) <= 4 && typeof v.deleted === 'boolean' && typeof v.listed === 'boolean')
  const publicMode = Number(v.mode) >= 3
  const note: ChainNote = {
    id: id(v.id), owner: address(v.owner), pendingOwner: address(v.pending_owner, true), ownerGeneration: decimal(v.owner_generation, 64, true),
    mode: v.mode as ChainNote['mode'], stateRevision: decimal(v.state_revision, 64, true), titleRevision: decimal(v.title_revision, 64, true), bodyRevision: decimal(v.body_revision, 64, true), epoch: decimal(v.epoch, 32),
    title: blob(v.title_blob, publicMode ? 160 : 231), commitment: blob(v.commitment, 32), deleted: v.deleted, listed: v.listed,
    createdHeight: decimal(v.created_height, 63, true), operationId: id(v.op_id), actor: address(v.actor), height: decimal(v.height, 63, true),
    ...(withBody ? { body: blob(v.body_blob, publicMode ? 131072 : 135223) } : {}),
  }
  if (Object.hasOwn(v, 'body_bytes')) {
    note.bodyBytes = Number(decimal(v.body_bytes, 32))
    check(note.bodyBytes <= (publicMode ? 131072 : 135223) && (!withBody || note.bodyBytes === note.body?.length) && (!note.deleted || note.bodyBytes === 0))
  }
  if (Object.hasOwn(v, 'executor')) note.executor = address(v.executor, true)
  if (Object.hasOwn(v, 'gov_writers')) { check(typeof v.gov_writers === 'boolean'); note.govWriters = v.gov_writers }
  if (Object.hasOwn(v, 'owner_listed') || Object.hasOwn(v, 'moderator_hidden')) {
    check(typeof v.owner_listed === 'boolean' && typeof v.moderator_hidden === 'boolean')
    note.ownerListed = v.owner_listed; note.moderatorHidden = v.moderator_hidden
    check(note.listed === (note.ownerListed && !note.moderatorHidden) && (!note.deleted || !note.ownerListed))
  }
  check(BigInt(note.titleRevision) <= BigInt(note.stateRevision) && BigInt(note.bodyRevision) <= BigInt(note.stateRevision) && BigInt(note.height) >= BigInt(note.createdHeight))
  if (note.deleted) check(!note.listed && !note.pendingOwner && !note.title.length && !note.body?.length && !note.commitment.length)
  else if (publicMode) { check(note.commitment.length === 0); publicText(note.title, true); if (note.body) publicText(note.body) }
  else check(note.epoch !== '0' && note.commitment.length === 32 && note.title.length >= 59 && (!note.body || note.body.length >= 59))
  return note
}
export interface NotesPage { items: ChainNote[]; nextCursor: string }
export function parsePage(value: unknown, limit: number): NotesPage {
  check(Number.isInteger(limit) && limit >= 1 && limit <= 50)
  const v = record(value, ['items', 'next_cursor']); check(Array.isArray(v.items) && v.items.length <= limit)
  const items = v.items.map(item => parseNote(item, false)); check(new Set(items.map(item => item.id)).size === items.length)
  const nextCursor = cursor(v.next_cursor); check(!nextCursor || items.length === limit)
  return { items, nextCursor }
}
export interface ChainConfig { realm: string; admin: string; pendingAdmin: string; treasury: string; createFeeUgnot: string; paused: boolean }
export function parseConfig(value: unknown): ChainConfig {
  const v = record(value, ['realm', 'admin', 'pending_admin', 'treasury', 'create_fee_ugnot', 'paused'])
  check(v.realm === NOTES_REALM && typeof v.paused === 'boolean')
  return { realm: NOTES_REALM, admin: address(v.admin), pendingAdmin: address(v.pending_admin, true), treasury: address(v.treasury), createFeeUgnot: decimal(v.create_fee_ugnot, 63), paused: v.paused }
}
export interface ChainKey { address: string; generation: string; active: boolean; publicKey: Uint8Array; operationId: string; height: string }
export function parseKey(value: unknown, expectedAddress: string): ChainKey {
  const v = record(value, ['address', 'suite', 'generation', 'active', 'public_key', 'op_id', 'height'])
  check(address(v.address) === address(expectedAddress) && v.suite === KEY_SUITE && typeof v.active === 'boolean')
  const generation = decimal(v.generation), height = decimal(v.height, 63), publicKey = blob(v.public_key, 1216)
  if (generation === '0') check(!v.active && !publicKey.length && v.op_id === '' && height === '0')
  else { id(v.op_id); check(height !== '0' && publicKey.length === (v.active ? 1216 : 0)) }
  return { address: expectedAddress, generation, active: v.active, publicKey, operationId: v.op_id as string, height }
}
