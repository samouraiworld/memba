import { installTestLocks } from "../../account/testLocks"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, expect, it, vi } from "vitest"
import { AccountContext, SIGNED_OUT } from "../../account/accountContext"
import { AccountCard } from "./AccountCard"
import { resetDeletionForTests } from "./deletion"

vi.mock("../../lib/config", async (original) => ({ ...await original<typeof import("../../lib/config")>(), ACCOUNT_ENABLED: true }))
const user = { id: "subject-A", email: "a@example.test", fullName: "A", isAdmin: false }
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => { installTestLocks(); localStorage.clear(); sessionStorage.clear(); resetDeletionForTests(); vi.unstubAllGlobals() })

it("never dispatches a row read whose token arrives after deletion", async () => {
    const delayed = deferred<string>()
    const events: string[] = []
    const getToken = vi.fn().mockReturnValueOnce(delayed.promise).mockResolvedValue("token-A")
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
        const path = new URL(String(url), "https://test.invalid").pathname
        events.push(`${init?.method ?? "GET"} ${path}`)
        if (path.endsWith("/delete")) return new Response(null, { status: 204 })
        if (path === "/users/erase") return new Response(null, { status: 204 })
        return Response.json(path.endsWith("/topics") ? [] : { id: "account-A", email: user.email, createdAt: "2026-10-08" })
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter><AccountContext.Provider value={{ ...SIGNED_OUT, available: true, status: "ready", user, getToken, deleteUser: vi.fn(async () => {}) }}><AccountCard /></AccountContext.Provider></MemoryRouter></QueryClientProvider>)
    await waitFor(() => expect(getToken).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole("button", { name: "Delete my account…" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }))
    await screen.findByText(/Your account is deleted/)
    await act(async () => { delayed.resolve("token-A"); await delayed.promise })
    expect(events).toContain("POST /api/account/delete")
    expect(events).not.toContain("GET /api/account")
})

it("drains a dispatched request before the destructive step and discards its result", async () => {
    const { accountRequest, withDeletionLock } = await import("../../account/operations")
    const { setDeletion } = await import("./deletion")
    const response = deferred<string>()
    const sent = vi.fn(() => response.promise)
    const account = { ...SIGNED_OUT, user, getToken: async () => "token-A" }
    const read = accountRequest(account, sent).catch(error => error)
    await waitFor(() => expect(sent).toHaveBeenCalledOnce())
    setDeletion({ userId: user.id, step: "memba", running: true })
    const remove = vi.fn(async () => {})
    const deletion = withDeletionLock(user.id, remove)
    await Promise.resolve()
    expect(remove).not.toHaveBeenCalled()
    response.resolve("private data")
    expect(await read).toBeInstanceOf(Error)
    await deletion
    expect(remove).toHaveBeenCalledOnce()
})

it("checks another tab's persisted barrier before dispatch even without a storage event", async () => {
    const { accountRequest } = await import("../../account/operations")
    const delayed = deferred<string>()
    const sent = vi.fn(async () => "created")
    const pending = accountRequest({ ...SIGNED_OUT, user, getToken: () => delayed.promise }, sent)
    localStorage.setItem(`memba_account_deletion:${user.id}`, JSON.stringify({ userId: user.id, step: "identity", running: false }))
    delayed.resolve("token-A")
    await expect(pending).rejects.toThrow(/deletion/)
    expect(sent).not.toHaveBeenCalled()
})

it("blocks a pending topic mutation and export behind the same deletion barrier", async () => {
    const { accountRequest } = await import("../../account/operations")
    const { accountApi } = await import("../../lib/accountApi")
    const delayed = deferred<string>()
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const account = { ...SIGNED_OUT, user, getToken: () => delayed.promise }
    const mutation = accountRequest(account, t => accountApi.setTopic(t, "newsletter", true, "settings"))
    const download = accountRequest(account, t => accountApi.exportData(t))
    localStorage.setItem(`memba_account_deletion:${user.id}`, JSON.stringify({ userId: user.id, step: "done", running: false }))
    delayed.resolve("token-A")
    await expect(mutation).rejects.toThrow(/deletion/)
    await expect(download).rejects.toThrow(/deletion/)
    expect(fetch).not.toHaveBeenCalled()
})

it("refuses destructive work when cross-tab locking is unavailable", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined })
    const { withDeletionLock } = await import("../../account/operations")
    const remove = vi.fn()
    await expect(withDeletionLock(user.id, remove)).rejects.toThrow(/cross-tab locking/)
    expect(remove).not.toHaveBeenCalled()
})

vi.mock("../../account/loadClerk", () => ({ loadClerk: vi.fn() }))
it("stops the deletion sequence at its original subject when identity changes during the backend step", async () => {
    const { AccountProvider, SESSION_MARKER } = await import("../../account/AccountProvider")
    const { loadClerk } = await import("../../account/loadClerk")
    const backendDelete = deferred<Response>()
    let listener!: (u: typeof user) => void
    const deleteUser = vi.fn(async () => {})
    const clerk = { user, onChange: (l: typeof listener) => { listener = l; return () => {} }, getToken: async () => `token-${clerk.user.id}`, deleteUser, signOut: async () => {}, openSignIn: () => {} }
    vi.mocked(loadClerk).mockResolvedValue(clerk)
    localStorage.setItem(SESSION_MARKER, "1")
    const events: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
        const path = new URL(String(url), "https://test.invalid").pathname
        events.push(`${init?.method ?? "GET"} ${path}`)
        if (path.endsWith("/delete")) return backendDelete.promise
        return Response.json(path.endsWith("/topics") ? [] : { id: "account", email: user.email, createdAt: "2026-10-08" })
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter><AccountProvider publishableKey="pk_test_x"><AccountCard /></AccountProvider></MemoryRouter></QueryClientProvider>)
    await screen.findByText(user.email)
    fireEvent.click(screen.getByRole("button", { name: "Delete my account…" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }))
    await waitFor(() => expect(events).toContain("POST /api/account/delete"))
    await act(async () => {
        clerk.user = { ...user, id: "subject-B" }
        listener(clerk.user)
        backendDelete.resolve(new Response(null, { status: 204 }))
    })
    await waitFor(() => expect(localStorage.getItem(`memba_account_deletion:${user.id}`)).toContain('"step":"alerts"'))
    expect(events).not.toContain("POST /users/erase")
    expect(deleteUser).not.toHaveBeenCalled()
})

it("keeps completed progress when another tab starts a stale deletion attempt", async () => {
    const { beginDeletion, getDeletion, setDeletion } = await import("./deletion")
    setDeletion({ userId: user.id, step: "done", running: false })
    beginDeletion(user.id)
    expect(getDeletion(user.id)?.step).toBe("done")
})

it("reports backend contention without automatically repeating a mutation", async () => {
    const { accountApi } = await import("../../lib/accountApi")
    const fetch = vi.fn(async () => Response.json({ error: "busy" }, { status: 409, headers: { "Retry-After": "1" } }))
    vi.stubGlobal("fetch", fetch)
    await expect(accountApi.remove("test-token")).rejects.toThrow(/Another account operation is finishing/)
    expect(fetch).toHaveBeenCalledOnce()
})

it("pauses reads on a server deletion marker and resumes cleanup only on a manual action", async () => {
    const events: string[] = []
    const deleteUser = vi.fn(async () => {})
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
        const path = new URL(String(url), "https://test.invalid").pathname
        events.push(`${init?.method ?? "GET"} ${path}`)
        if (path.endsWith("/delete") || path === "/users/erase") return new Response(null, { status: 204 })
        return Response.json({ code: "account_deleted", error: "This Memba account was deleted." }, { status: 410 })
    }))
    const client = new QueryClient()
    render(<QueryClientProvider client={client}><MemoryRouter><AccountContext.Provider value={{ ...SIGNED_OUT, available: true, status: "ready", user, getToken: async () => "token-A", deleteUser }}><AccountCard /></AccountContext.Provider></MemoryRouter></QueryClientProvider>)
    await screen.findByText(/Account deletion is incomplete/)
    expect(events).toEqual(["GET /api/account"])
    expect(deleteUser).not.toHaveBeenCalled()
    await act(async () => { await client.refetchQueries({ type: "active" }) })
    expect(events).toEqual(["GET /api/account"])
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await screen.findByText(/Your account is deleted/)
    expect(events).toEqual(["GET /api/account", "POST /api/account/delete", "POST /users/erase"])
    expect(deleteUser).toHaveBeenCalledWith(user.id)
})

it("does not confuse an expired confirmation link with a deleted account", async () => {
    const { accountRequest } = await import("../../account/operations")
    const { accountApi } = await import("../../lib/accountApi")
    const { getDeletion } = await import("./deletion")
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Link expired" }, { status: 410 })))
    await expect(accountRequest({ ...SIGNED_OUT, user, getToken: async () => "token-A" }, t => accountApi.get(t))).rejects.toThrow(/Link expired/)
    expect(getDeletion(user.id)).toBeNull()
})

it.each([404, 500])("keeps monitoring erasure retryable after HTTP %i and never deletes Clerk prematurely", async status => {
    const events: string[] = []
    const deleteUser = vi.fn(async () => { events.push("Clerk delete") })
    let monitoringStatus = status
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
        const path = new URL(String(url), "https://test.invalid").pathname
        events.push(`${init?.method ?? "GET"} ${path}`)
        if (path.endsWith("/delete")) return new Response(null, { status: 204 })
        if (path === "/users/erase") return new Response(null, { status: monitoringStatus })
        return Response.json(path.endsWith("/topics") ? [] : { id: "account-A", email: user.email, createdAt: "2026-10-08" })
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ui = <QueryClientProvider client={client}><MemoryRouter><AccountContext.Provider value={{ ...SIGNED_OUT, available: true, status: "ready", user, getToken: async () => "token-A", deleteUser }}><AccountCard /></AccountContext.Provider></MemoryRouter></QueryClientProvider>
    const view = render(ui)
    await screen.findByText(user.email)
    events.length = 0
    fireEvent.click(screen.getByRole("button", { name: "Delete my account…" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }))
    const alert = await screen.findByRole("alert")
    if (status === 404) expect(alert).toHaveTextContent("Monitoring account erasure is unavailable")
    expect(events).toEqual(["POST /api/account/delete", "POST /users/erase"])
    expect(deleteUser).not.toHaveBeenCalled()
    expect(localStorage.getItem(`memba_account_deletion:${user.id}`)).toContain('"step":"alerts"')
    // A remount still pauses account reads; only a manual retry proceeds.
    view.unmount()
    render(ui)
    await screen.findByRole("button", { name: "Try again" })
    expect(events).toHaveLength(2)
    monitoringStatus = 204
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await screen.findByText(/Your account is deleted/)
    expect(events).toEqual(["POST /api/account/delete", "POST /users/erase", "POST /users/erase", "Clerk delete"])
    expect(deleteUser).toHaveBeenCalledWith(user.id)
})

it("reconfirms durable monitoring erasure before retrying Clerk from saved identity progress", async () => {
    const { setDeletion } = await import("./deletion")
    setDeletion({ userId: user.id, step: "identity", running: false })
    const events: string[] = []
    let monitoringStatus = 404
    let identityAttempts = 0
    const deleteUser = vi.fn(async () => {
        events.push("Clerk delete")
        if (++identityAttempts === 1) throw new Error("Sign-in service unavailable")
    })
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
        events.push(`${init?.method ?? "GET"} ${new URL(String(url), "https://test.invalid").pathname}`)
        return new Response(null, { status: monitoringStatus })
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter><AccountContext.Provider value={{ ...SIGNED_OUT, available: true, status: "ready", user, getToken: async () => "token-A", deleteUser }}><AccountCard /></AccountContext.Provider></MemoryRouter></QueryClientProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await screen.findByText(/Monitoring account erasure is unavailable/)
    expect(deleteUser).not.toHaveBeenCalled()
    monitoringStatus = 204
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await screen.findByText(/Sign-in service unavailable/)
    expect(localStorage.getItem(`memba_account_deletion:${user.id}`)).toContain('"step":"identity"')
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await screen.findByText(/Your account is deleted/)
    expect(events).toEqual(["POST /users/erase", "POST /users/erase", "Clerk delete", "POST /users/erase", "Clerk delete"])
    expect(deleteUser).toHaveBeenNthCalledWith(1, user.id)
    expect(deleteUser).toHaveBeenNthCalledWith(2, user.id)
})
