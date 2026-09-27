/** Only disposable UI state and preferences. Never match all memba_os_* keys:
 * that namespace also contains unsent DAO/Terminal drafts and send locks. */
export const RESET_EXACT_KEYS = [
    "memba_usernames", "memba_settings", "memba_network", "memba_network_pref", "memba_board_visits",
    "memba_os_windows", "memba_os_seen", "memba_os_booted",
    "memba_os_theme", "memba_os_wallpaper", "memba_os_icon_size",
] as const

const RESET_PREFIXES = ["memba_os_desk:", "memba_os_windows:"] as const

export function resetLocalUiData(storage: Storage): number {
    const keys = new Set<string>(RESET_EXACT_KEYS)
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index)
        if (key && RESET_PREFIXES.some((prefix) => key.startsWith(prefix))) keys.add(key)
    }
    let removed = 0
    for (const key of keys) {
        if (storage.getItem(key) === null) continue
        storage.removeItem(key)
        removed++
    }
    return removed
}
