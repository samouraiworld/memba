import { afterEach, describe, expect, it } from "vitest"
import { clearSettingsCache } from "./settingsCache"

afterEach(() => localStorage.clear())

describe("Classic Settings cache reset", () => {
    it("removes legacy and network-scoped username caches while preserving unrelated local data", () => {
        const removed = [
            "memba_usernames", "memba_usernames::gnoland-1", "memba_usernames::test13",
            "memba_settings", "memba_network", "memba_network_pref", "memba_board_visits",
        ]
        const preserved = [
            "memba_os_terminal_draft:gnoland-1:guest", "memba_os_send_lock:gnoland-1:g1test",
            "memba_usernames_backup", "memba_os_recipients:gnoland-1:g1test", "memba_auth_token",
        ]
        for (const key of [...removed, ...preserved]) localStorage.setItem(key, "saved")

        clearSettingsCache(localStorage)

        for (const key of removed) expect(localStorage.getItem(key), key).toBeNull()
        for (const key of preserved) expect(localStorage.getItem(key), key).toBe("saved")
    })
})
