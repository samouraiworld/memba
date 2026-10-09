import { check, record } from './chain/schema'
import { decodeFeaturedDesk, encodeFeaturedDesk, featuredSeedState, resetFeaturedDesk, FEATURED_MAX_CHARS } from './featuredNoteSeed'
import type { FeaturedDesk, FeaturedDeskItem, FeaturedDeskRules, FeaturedPartition } from './featuredNoteSeed'

export interface FeaturedLocks {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => T | Promise<T>): Promise<T>
}
export interface FeaturedStorageOptions {
  scope: FeaturedPartition; rules: FeaturedDeskRules
  storage: Pick<Storage, 'getItem' | 'setItem'>; locks: FeaturedLocks | null
  /** Exact account+network legacy array only; never guess an unscoped partition. */
  readLegacy(): string | null
  initial?: readonly FeaturedDeskItem[]
  isCurrent(): boolean
  getResetToken?(): string | null
}
const nextTask = () => new Promise<void>(resolve => setTimeout(resolve, 0))
const token = (value: unknown) => { check(value === null || (typeof value === 'string' && value.length <= 128)); return value as string | null }
export function createFeaturedNoteStorage(options: FeaturedStorageOptions) {
  const scope = { ...options.scope }, rules = { ...options.rules }
  const { storage, locks, readLegacy, isCurrent, getResetToken = () => null } = options
  const resetToken = token(getResetToken()), initial = resetFeaturedDesk(scope, rules, options.initial)
  const key = `memba_os_desk:v3:${scope.chainId}:${scope.wallet ?? 'guest'}`
  const previousKey = `memba_os_desk:v2:${scope.chainId}:${scope.wallet ?? 'guest'}`
  const current = () => { if (!isCurrent() || getResetToken() !== resetToken) throw new Error('Featured desk session changed.') }
  const parse = (raw: string) => { check(typeof raw === 'string' && raw.length <= FEATURED_MAX_CHARS); return JSON.parse(raw) as unknown }
  const read = (): FeaturedDesk => {
    current()
    const raw = storage.getItem(key)
    if (raw !== null) {
      const value = record(parse(raw), ['version', 'partition', 'items', 'releases', 'resetToken'])
      const { resetToken: storedToken, ...desk } = value; token(storedToken)
      // Validate before applying reset. A corrupt new record never falls back to old storage.
      const decoded = decodeFeaturedDesk(JSON.stringify(desk), scope, rules)
      return storedToken === resetToken ? decoded : resetFeaturedDesk(scope, rules, initial.items)
    }
    const previous = storage.getItem(previousKey)
    if (previous !== null) {
      const value = record(parse(previous), ['version', 'partition', 'items', 'whitepaper'], ['resetToken'])
      check(value.version === 2)
      const marker = featuredSeedState(value.whitepaper), storedToken = token(value.resetToken ?? null)
      const migrated = decodeFeaturedDesk(JSON.stringify({ version: 3, partition: value.partition, items: value.items,
        releases: { 'sushi-v1': { status: 'pending' }, 'whitepaper-v1': marker } }), scope, rules)
      return storedToken === resetToken ? migrated : resetFeaturedDesk(scope, rules, initial.items)
    }
    // A non-null reset token prohibits resurrecting unversioned pre-reset data.
    if (resetToken !== null) return resetFeaturedDesk(scope, rules, initial.items)
    const legacy = readLegacy()
    if (legacy === null) return resetFeaturedDesk(scope, rules, initial.items)
    const items = parse(legacy); check(Array.isArray(items)); return resetFeaturedDesk(scope, rules, items)
  }
  return {
    key,
    peek: (): FeaturedDesk => { const desk = read(); current(); return desk },
    mutate: async (update: (latest: FeaturedDesk) => FeaturedDesk): Promise<FeaturedDesk> => {
      current()
      if (!locks || typeof locks.request !== 'function') throw new Error('Featured desk requires exclusive Web Locks.')
      const result = await locks.request(key, { mode: 'exclusive' }, async () => {
        // Firefox checkpoints localStorage at task boundaries; keep both inside the lock.
        await nextTask(); current()
        const next = update(read()); current()
        const normalized = decodeFeaturedDesk(encodeFeaturedDesk(next, scope, rules), scope, rules)
        const raw = JSON.stringify({ ...normalized, resetToken }); check(raw.length <= FEATURED_MAX_CHARS); current()
        storage.setItem(key, raw)
        // Retain old keys untouched. Once v3 exists they are never read again.
        await nextTask(); current()
        return normalized
      })
      current(); return result
    },
  }
}
