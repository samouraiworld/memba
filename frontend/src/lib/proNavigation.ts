import { NAV, navEntryAvailable, type NavEntry } from './navManifest'

/** Presentation only: routes, icons and availability remain owned by NAV. */
export const PRO_NAV_GROUPS = [
    { label: 'Workspace', ids: ['dao', 'tokens', 'multisig', 'organizations'] },
    { label: 'Network', ids: ['validators', 'alerts'] },
    { label: 'Explore', ids: ['directory', 'appstore', 'marketplace', 'feed'] },
    { label: 'Community', ids: ['gnolove', 'quests', 'leaderboard', 'points', 'blog'] },
    { label: 'Account & help', ids: ['profile', 'settings', 'candidature', 'extensions', 'feedback', 'changelogs', 'quest-admin'] },
] as const
export const PRO_PRIMARY_IDS = ['home', 'dao', 'tokens', 'directory']

export function proEntries(ids: readonly string[], connected: boolean, admin = false): NavEntry[] {
    return ids.flatMap(id => {
        const entry = NAV.find(e => e.id === id)
        if (!entry) throw new Error(`Missing navigation entry: ${id}`)
        if (entry.requiresAuth && !connected || id === 'quest-admin' && !admin || !navEntryAvailable(entry)) return []
        return [entry]
    })
}

export function proRouteActive(pathname: string, network: string, to: string): boolean {
    const full = `/${network}${to}`
    if (to === '/') return pathname === full || pathname === `/${network}`
    return pathname === full || pathname.startsWith(`${full}/`)
}
