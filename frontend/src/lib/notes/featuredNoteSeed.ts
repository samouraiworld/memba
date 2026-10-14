import { address, check, id, NOTES_REALM, record } from './chain/schema'

export type FeaturedReleaseKey = 'sushi-v1'
export const FEATURED_RELEASE_KEYS = ['sushi-v1'] as const
/** Retired release keys stay readable so a stored desk keeps its items; the entry is dropped on the next write. */
const RETIRED_RELEASE_KEYS = ['whitepaper-v1']
export interface FeaturedNoteRelease {
  releaseKey: FeaturedReleaseKey; chainId: string; realm: string; version: 1
  noteId: string; mode: 4; deleted: false; owner: string
}
export interface FeaturedPartition { chainId: string; wallet: string | null }
export interface FeaturedDeskItem { ty: 'app' | 'dao' | 'prop' | 'msig' | 'note'; ref: string; c: number; r: number }
export interface FeaturedDeskRules {
  cols: number; rows: number
  validItem(item: Pick<FeaturedDeskItem, 'ty' | 'ref'>): boolean
}
export type FeaturedSeedState = { status: 'pending' | 'dismissed' } | { status: 'seeded'; noteId: string }
export interface FeaturedDesk {
  version: 3; partition: FeaturedPartition; items: FeaturedDeskItem[]
  releases: Record<FeaturedReleaseKey, FeaturedSeedState>
}
export const FEATURED_MAX_CHARS = 65_536
export function featuredNoteLabel(key: FeaturedReleaseKey): string {
  check(FEATURED_RELEASE_KEYS.includes(key)); return 'Sushi recipe'
}
export function featuredPartition(value: unknown): FeaturedPartition {
  const p = record(value, ['chainId', 'wallet'])
  check(typeof p.chainId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(p.chainId))
  return { chainId: p.chainId, wallet: p.wallet === null ? null : address(p.wallet) }
}
function deskItems(value: unknown, rules: FeaturedDeskRules): FeaturedDeskItem[] {
  check(Number.isInteger(rules.cols) && rules.cols > 0 && rules.cols <= 64
    && Number.isInteger(rules.rows) && rules.rows > 0 && rules.rows <= 64 && rules.cols * rules.rows <= 512)
  check(Array.isArray(value) && value.length <= rules.cols * rules.rows)
  return value.map(raw => {
    const item = record(raw, ['ty', 'ref', 'c', 'r'])
    check(['app', 'dao', 'prop', 'msig', 'note'].includes(item.ty as string)
      && typeof item.ref === 'string' && item.ref.length > 0 && item.ref.length <= 256)
    check(Number.isInteger(item.c) && Number(item.c) >= 0 && Number(item.c) < rules.cols
      && Number.isInteger(item.r) && Number(item.r) >= 0 && Number(item.r) < rules.rows)
    const result = { ty: item.ty, ref: item.ref, c: item.c, r: item.r } as FeaturedDeskItem
    check(rules.validItem(result)); return result
  })
}
export function featuredSeedState(value: unknown): FeaturedSeedState {
  const s = record(value, ['status'], ['noteId'])
  if (s.status === 'seeded') { record(value, ['status', 'noteId']); return { status: 'seeded', noteId: id(s.noteId) } }
  record(value, ['status']); check(s.status === 'pending' || s.status === 'dismissed'); return { status: s.status }
}
export function validateFeaturedDesk(value: unknown, scope: FeaturedPartition, rules: FeaturedDeskRules): FeaturedDesk {
  const v = record(value, ['version', 'partition', 'items', 'releases'])
  const expected = featuredPartition(scope), actual = featuredPartition(v.partition)
  check(v.version === 3 && actual.chainId === expected.chainId && actual.wallet === expected.wallet)
  const states = record(v.releases, [...FEATURED_RELEASE_KEYS], RETIRED_RELEASE_KEYS)
  return { version: 3, partition: actual, items: deskItems(v.items, rules), releases: { 'sushi-v1': featuredSeedState(states['sushi-v1']) } }
}
export function resetFeaturedDesk(scope: FeaturedPartition, rules: FeaturedDeskRules, initial: readonly FeaturedDeskItem[] = []): FeaturedDesk {
  return validateFeaturedDesk({ version: 3, partition: scope, items: initial,
    releases: { 'sushi-v1': { status: 'pending' } } }, scope, rules)
}
export function decodeFeaturedDesk(raw: string, scope: FeaturedPartition, rules: FeaturedDeskRules): FeaturedDesk {
  check(typeof raw === 'string' && raw.length <= FEATURED_MAX_CHARS)
  return validateFeaturedDesk(JSON.parse(raw), scope, rules)
}
export function encodeFeaturedDesk(desk: FeaturedDesk, scope: FeaturedPartition, rules: FeaturedDeskRules): string {
  const raw = JSON.stringify(validateFeaturedDesk(desk, scope, rules)); check(raw.length <= FEATURED_MAX_CHARS); return raw
}
/** Structural validation only: publication/owner/content evidence is reviewed separately. */
export function validateFeaturedRelease(value: unknown, chainId: string): FeaturedNoteRelease {
  const r = record(value, ['releaseKey', 'chainId', 'realm', 'version', 'noteId', 'mode', 'deleted', 'owner'])
  check(FEATURED_RELEASE_KEYS.includes(r.releaseKey as FeaturedReleaseKey) && r.chainId === chainId
    && r.realm === NOTES_REALM && r.version === 1 && r.mode === 4 && r.deleted === false)
  return { releaseKey: r.releaseKey as FeaturedReleaseKey, chainId, realm: NOTES_REALM, version: 1,
    noteId: id(r.noteId), mode: 4, deleted: false, owner: address(r.owner) }
}
export function planFeaturedNoteSeeds(input: FeaturedDesk, scope: FeaturedPartition, rules: FeaturedDeskRules, reviewed: readonly FeaturedNoteRelease[]) {
  const desk = validateFeaturedDesk(input, scope, rules)
  const releases = reviewed.map(value => validateFeaturedRelease(value, desk.partition.chainId))
  check(releases.length <= FEATURED_RELEASE_KEYS.length && new Set(releases.map(r => r.releaseKey)).size === releases.length
    && new Set(releases.map(r => r.noteId)).size === releases.length)
  for (const target of releases) for (const key of FEATURED_RELEASE_KEYS) {
    const other = desk.releases[key]
    check(key === target.releaseKey || other.status !== 'seeded' || other.noteId !== target.noteId)
  }
  const outcomes: Partial<Record<FeaturedReleaseKey, 'dismissed' | 'already-seeded' | 'seeded' | 'pending-full'>> = {}
  let changed = false
  for (const target of releases) {
    const state = desk.releases[target.releaseKey]
    if (state.status === 'dismissed') { outcomes[target.releaseKey] = 'dismissed'; continue }
    if (state.status === 'seeded') {
      // A release key denotes one immutable document; replacement needs a reviewed migration.
      check(state.noteId === target.noteId)
      if (!desk.items.some(item => item.ty === 'note' && item.ref === state.noteId)) {
        desk.releases[target.releaseKey] = { status: 'dismissed' }; changed = true
        outcomes[target.releaseKey] = 'dismissed'
      } else outcomes[target.releaseKey] = 'already-seeded'
      continue
    }
    if (desk.items.some(item => item.ty === 'note' && item.ref === target.noteId)) {
      desk.releases[target.releaseKey] = { status: 'seeded', noteId: target.noteId }; changed = true
      outcomes[target.releaseKey] = 'already-seeded'; continue
    }
    let free: { c: number; r: number } | undefined
    if (desk.items.length < rules.cols * rules.rows) {
      for (let c = 0; c < rules.cols && !free; c++) for (let r = 0; r < rules.rows; r++) {
        if (!desk.items.some(item => item.c === c && item.r === r)) { free = { c, r }; break }
      }
    }
    if (!free) { outcomes[target.releaseKey] = 'pending-full'; continue }
    const item: FeaturedDeskItem = { ty: 'note', ref: target.noteId, ...free }; check(rules.validItem(item))
    desk.items.push(item); desk.releases[target.releaseKey] = { status: 'seeded', noteId: target.noteId }
    outcomes[target.releaseKey] = 'seeded'; changed = true
  }
  return { desk, outcomes, changed }
}
export function removeFeaturedDeskItem(input: FeaturedDesk, scope: FeaturedPartition, rules: FeaturedDeskRules, index: number): FeaturedDesk {
  const desk = validateFeaturedDesk(input, scope, rules)
  check(Number.isInteger(index) && index >= 0 && index < desk.items.length)
  const removed = desk.items[index]
  for (const key of FEATURED_RELEASE_KEYS) {
    const state = desk.releases[key]
    if (state.status === 'seeded' && removed.ty === 'note' && state.noteId === removed.ref) desk.releases[key] = { status: 'dismissed' }
  }
  desk.items.splice(index, 1); return desk
}
