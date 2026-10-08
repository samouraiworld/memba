import { act, renderHook } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { AccountContext, SIGNED_OUT } from "./accountContext"
import { useMonitoringOperations } from "./monitoringOperations"
import { resetDeletionForTests } from "../os/account/deletion"
import { installTestLocks } from "./testLocks"
import type { ReactNode } from "react"

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetDeletionForTests(); installTestLocks(); vi.unstubAllGlobals() })
it("never provisions monitoring after a pending token resumes behind a deletion barrier", async () => {
    let resolve!: (value: string) => void
    const token = new Promise<string>(r => { resolve = r })
    const user = { id: "A", email: "a@example.test", fullName: "A", isAdmin: false }
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(useMonitoringOperations, { wrapper: ({ children }: { children: ReactNode }) => <AccountContext.Provider value={{ ...SIGNED_OUT, user, getToken: () => token }}>{children}</AccountContext.Provider> })
    const provision = result.current.ensureMonitoringUser("A", "a@example.test")
    localStorage.setItem("memba_account_deletion:A", JSON.stringify({ userId: "A", step: "identity", running: false }))
    await act(async () => { resolve("token-A"); await expect(provision).rejects.toThrow(/deletion/) })
    expect(fetch).not.toHaveBeenCalled()
})
