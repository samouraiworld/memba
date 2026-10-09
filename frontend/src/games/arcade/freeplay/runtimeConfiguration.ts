import { FreePlayError, validFreePlayTarget, type FreePlayGame, type FreePlayTarget } from '../../../lib/arcadeFreePlay'
import type { SnapshotStorage } from './snapshot'

/** Trusted host input only. Do not derive this from URLs, saved runs or storage.
 * The host owns lifecycle and calls the validator before creating any client.
 * A null configuration means no runtime; this module supplies no default.
 */
export interface ArcadeFreePlayConfiguration {
    readonly chainId: string
    readonly storage: SnapshotStorage
    readonly games: Readonly<Partial<Record<FreePlayGame, {
        readonly rules: string
        readonly simVersion: number
        readonly remote?: { readonly origin: string; readonly target: Readonly<FreePlayTarget> }
    }>>>
}

// Compatibility gates, not enabled games or activation configuration.
const implemented: Record<FreePlayGame, readonly [string, number]> = {
    'block-party': ['bp-free-standard-undo-v1', 1],
    'space-invaders': ['si-free-standard-v1', 1],
    barricade: ['barricade-fps-c1', 3],
}

/** Pure and fail-closed; no auth/client/storage construction or I/O. */
export function validateArcadeFreePlayConfiguration(configuration: ArcadeFreePlayConfiguration): void {
    const invalid = () => { throw new FreePlayError('invalid_runtime_configuration') }
    if (!configuration || typeof configuration.chainId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(configuration.chainId)
        || !configuration.storage || typeof configuration.storage.getItem !== 'function' || typeof configuration.storage.setItem !== 'function'
        || !configuration.games || typeof configuration.games !== 'object' || Array.isArray(configuration.games)) return invalid()
    for (const [game, config] of Object.entries(configuration.games)) {
        if (!Object.hasOwn(implemented, game) || !config) return invalid()
        const [rules, version] = implemented[game as FreePlayGame]
        if (config.rules !== rules || config.simVersion !== version) return invalid()
        if (config.remote === undefined) continue // explicitly local-only
        if (!config.remote || typeof config.remote.origin !== 'string' || !validFreePlayTarget(config.remote.target) || config.remote.target.chainId !== configuration.chainId) return invalid()
        let origin: URL
        try { origin = new URL(config.remote.origin) } catch { return invalid() }
        if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return invalid()
    }
}
