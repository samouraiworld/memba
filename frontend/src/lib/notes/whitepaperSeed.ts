import { address, check, id, NOTES_REALM, record } from './chain/schema'

export const WHITEPAPER_LABEL = 'Whitepaper'
/** Structural shell-compatible type; this pure helper does not load the shell. */
export interface WhitepaperDeskItem { ty: 'app' | 'dao' | 'prop' | 'msig' | 'note'; ref: string; c: number; r: number }
export interface WhitepaperPartition { chainId: string; wallet: string | null }
/** Release review must establish this public on-chain identity before supplying it.
 * Structural validation here is not a network/publication proof. No default release exists. */
export interface VerifiedWhitepaperRelease {
  chainId: string; realm: string; version: 1; noteId: string; mode: 3 | 4; deleted: false
}
type SeedState = { status: 'pending' | 'dismissed' } | { status: 'seeded'; noteId: string }
export interface WhitepaperDesk {
  version: 1; partition: WhitepaperPartition; items: WhitepaperDeskItem[]; whitepaper: SeedState
}
export interface WhitepaperDeskRules {
  cols: number; rows: number
  /** Pass the shell's existing itemTarget validation; the helper defines no app registry. */
  validItem: (item: Pick<WhitepaperDeskItem, 'ty' | 'ref'>) => boolean
}
export interface WhitepaperSeedPlan {
  desk: WhitepaperDesk
  outcome: 'disabled' | 'pending-full' | 'seeded' | 'already-seeded' | 'dismissed'
  changed: boolean
}
const MAX_CHARS = 65_536
function partition(value: unknown): WhitepaperPartition {
  const p = record(value, ['chainId', 'wallet'])
  check(typeof p.chainId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(p.chainId))
  check(p.wallet === null || typeof p.wallet === 'string')
  return { chainId: p.chainId, wallet: p.wallet === null ? null : address(p.wallet) }
}
function items(value: unknown, rules: WhitepaperDeskRules): WhitepaperDeskItem[] {
  check(Number.isInteger(rules.cols) && rules.cols > 0 && rules.cols <= 64
    && Number.isInteger(rules.rows) && rules.rows > 0 && rules.rows <= 64 && rules.cols * rules.rows <= 512)
  check(Array.isArray(value) && value.length <= rules.cols * rules.rows)
  return value.map(raw => {
    const item = record(raw, ['ty', 'ref', 'c', 'r'])
    check(['app', 'dao', 'prop', 'msig', 'note'].includes(item.ty as string)
      && typeof item.ref === 'string' && item.ref.length > 0 && item.ref.length <= 256)
    check(Number.isInteger(item.c) && (item.c as number) >= 0 && (item.c as number) < rules.cols
      && Number.isInteger(item.r) && (item.r as number) >= 0 && (item.r as number) < rules.rows)
    const result = { ty: item.ty, ref: item.ref, c: item.c, r: item.r } as WhitepaperDeskItem
    check(rules.validItem(result)); return result
  })
}
function state(value: unknown): SeedState {
  check(value && typeof value === 'object')
  const status = (value as { status?: unknown }).status
  if (status === 'seeded') {
    const s = record(value, ['status', 'noteId']); return { status, noteId: id(s.noteId) }
  }
  record(value, ['status']); check(status === 'pending' || status === 'dismissed'); return { status }
}
function validate(value: unknown, scope: WhitepaperPartition, rules: WhitepaperDeskRules): WhitepaperDesk {
  const v = record(value, ['version', 'partition', 'items', 'whitepaper'])
  const expected = partition(scope), actual = partition(v.partition)
  check(v.version === 1 && expected.chainId === actual.chainId && expected.wallet === actual.wallet)
  return { version: 1, partition: actual, items: items(v.items, rules), whitepaper: state(v.whitepaper) }
}
/** Read only the exact partition's storage key. A legacy array carries no scope proof.
 * The future adapter must use a NEW versioned key and import legacy arrays only
 * once, while that new key is absent. Never fall back after a corrupt new record:
 * old application tabs can still rewrite the old array and lose a dismissal.
 * Invalid/cross-partition records throw; callers must not silently replace them. */
export function decodeWhitepaperDesk(raw: string | null, scope: WhitepaperPartition, rules: WhitepaperDeskRules, initial: readonly WhitepaperDeskItem[] = []): WhitepaperDesk {
  check(raw === null || (typeof raw === 'string' && raw.length <= MAX_CHARS))
  const parsed: unknown = raw === null ? [...initial] : JSON.parse(raw)
  return validate(Array.isArray(parsed)
    ? { version: 1, partition: scope, items: parsed, whitepaper: { status: 'pending' } }
    : parsed, scope, rules)
}
/** Persist this entire envelope with one setItem, never items/marker separately.
 * New tabs must coordinate read-latest + mutation + write (e.g. a partition lock).
 * This pure codec does not resolve concurrent writes from cached tab state. */
export function encodeWhitepaperDesk(desk: WhitepaperDesk, scope: WhitepaperPartition, rules: WhitepaperDeskRules): string {
  const raw = JSON.stringify(validate(desk, scope, rules)); check(raw.length <= MAX_CHARS); return raw
}
function release(value: VerifiedWhitepaperRelease, scope: WhitepaperPartition): VerifiedWhitepaperRelease {
  const r = record(value, ['chainId', 'realm', 'version', 'noteId', 'mode', 'deleted'])
  check(r.chainId === scope.chainId && r.realm === NOTES_REALM && r.version === 1
    && (r.mode === 3 || r.mode === 4) && r.deleted === false)
  return { chainId: scope.chainId, realm: NOTES_REALM, version: 1, noteId: id(r.noteId), mode: r.mode, deleted: false }
}
export function planWhitepaperSeed(input: WhitepaperDesk, scope: WhitepaperPartition, rules: WhitepaperDeskRules, reviewed: VerifiedWhitepaperRelease | null): WhitepaperSeedPlan {
  const desk = validate(input, scope, rules)
  if (reviewed === null) return { desk, outcome: 'disabled', changed: false }
  const target = release(reviewed, desk.partition)
  if (desk.whitepaper.status === 'dismissed') return { desk, outcome: 'dismissed', changed: false }
  if (desk.whitepaper.status === 'seeded') {
    // Missing a previously seeded icon counts as a removal; never resurrect it.
    const seededId = desk.whitepaper.noteId
    if (!desk.items.some(item => item.ty === 'note' && item.ref === seededId)) {
      desk.whitepaper = { status: 'dismissed' }; return { desk, outcome: 'dismissed', changed: true }
    }
    return { desk, outcome: 'already-seeded', changed: false }
  }
  if (desk.items.some(item => item.ty === 'note' && item.ref === target.noteId)) {
    desk.whitepaper = { status: 'seeded', noteId: target.noteId }
    return { desk, outcome: 'already-seeded', changed: true }
  }
  // Reject a full record list as well as occupied cells: decoding must remain lossless.
  if (desk.items.length < rules.cols * rules.rows) {
    for (let c = 0; c < rules.cols; c++) for (let r = 0; r < rules.rows; r++) {
      if (desk.items.some(item => item.c === c && item.r === r)) continue
      const candidate: WhitepaperDeskItem = { ty: 'note', ref: target.noteId, c, r }
      check(rules.validItem(candidate))
      desk.items.push(candidate); desk.whitepaper = { status: 'seeded', noteId: target.noteId }
      return { desk, outcome: 'seeded', changed: true }
    }
  }
  return { desk, outcome: 'pending-full', changed: false }
}
/** Use for the user's explicit unpin. Other removals preserve the seed decision. */
export function removeWhitepaperDeskItem(input: WhitepaperDesk, scope: WhitepaperPartition, rules: WhitepaperDeskRules, index: number): WhitepaperDesk {
  const desk = validate(input, scope, rules)
  check(Number.isInteger(index) && index >= 0 && index < desk.items.length)
  const removed = desk.items[index]
  if (desk.whitepaper.status === 'seeded' && removed.ty === 'note' && removed.ref === desk.whitepaper.noteId) desk.whitepaper = { status: 'dismissed' }
  desk.items.splice(index, 1); return desk
}
/** Explicit reset only. The adapter chooses the existing guest/member initial desk. */
export function resetWhitepaperDesk(scope: WhitepaperPartition, rules: WhitepaperDeskRules, initial: readonly WhitepaperDeskItem[] = []): WhitepaperDesk {
  return decodeWhitepaperDesk(null, scope, rules, initial)
}
/** Never reads note metadata or exposes an arbitrary/private title. */
export function whitepaperItemLabel(item: Pick<WhitepaperDeskItem, 'ty' | 'ref'>, scope: WhitepaperPartition, reviewed: VerifiedWhitepaperRelease | null): typeof WHITEPAPER_LABEL | null {
  const p = partition(scope)
  if (reviewed === null) return null
  const target = release(reviewed, p)
  return item.ty === 'note' && item.ref === target.noteId ? WHITEPAPER_LABEL : null
}
