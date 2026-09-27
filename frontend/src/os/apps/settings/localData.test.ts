import { afterEach, describe, expect, it } from "vitest"
import { resetLocalUiData } from "./localData"

afterEach(() => localStorage.clear())

describe("OS local data reset", () => {
    it("clears enumerated UI state while preserving drafts, recipients and send locks", () => {
        const removed = ["memba_os_windows", "memba_os_windows:guest:gnoland-1", "memba_os_windows:member:gnoland-1:g1test", "memba_os_theme", "memba_os_desk:guest", "memba_settings"]
        const preserved = ["memba_os_terminal_draft:gnoland-1:guest", "memba_os_dao_draft:gnoland-1:g1test", "memba_os_recipients:gnoland-1:g1test", "memba_os_send_lock:gnoland-1:g1test", "memba_auth_token"]
        for (const key of [...removed, ...preserved]) localStorage.setItem(key, "value")
        expect(resetLocalUiData(localStorage)).toBe(removed.length)
        for (const key of removed) expect(localStorage.getItem(key)).toBeNull()
        for (const key of preserved) expect(localStorage.getItem(key)).toBe("value")
    })
})
