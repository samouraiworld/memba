const CLEAR_EXACT_KEYS = [
    "memba_usernames", "memba_settings", "memba_network", "memba_network_pref", "memba_board_visits",
] as const
const USERNAME_CACHE_PREFIX = "memba_usernames::"

/** Clear Classic Settings preferences and username caches without touching drafts or send locks. */
export function clearSettingsCache(storage: Storage): void {
    const keys: string[] = [...CLEAR_EXACT_KEYS]
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index)
        if (key?.startsWith(USERNAME_CACHE_PREFIX)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
}
