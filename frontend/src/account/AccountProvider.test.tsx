import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AccountProvider, LOAD_TIMEOUT_MS, SESSION_MARKER } from "./AccountProvider"
import { hasAuthCallback, useAccount, type AccountApi, type AccountUser } from "./accountContext"
import type { AccountClient } from "./loadKeycloak"
import type { KeycloakSettings } from "../lib/config"

vi.mock("./loadKeycloak", () => ({ loadKeycloak: vi.fn() }))
const { loadKeycloak } = await import("./loadKeycloak")

const SETTINGS: KeycloakSettings = { url: "https://auth.kodera.io", realm: "samourai-app", clientId: "memba-web" }

const ADA: AccountUser = { id: "user_1", email: "ada@example.org", fullName: "Ada", isAdmin: false }

function fakeClient(user: AccountUser | null = null) {
    let listener: ((u: AccountUser | null) => void) | null = null
    const client: AccountClient & { emit: (u: AccountUser | null) => void } = {
        user,
        onChange: (l) => { listener = l; return () => { listener = null } },
        openSignIn: vi.fn(),
        getToken: vi.fn(async () => "jwt"),
        signOut: vi.fn(async () => {}),
        emit: (u) => listener?.(u),
    }
    return client
}

let mounts = 0
let seen: string[] = []
function Probe() {
    const account = useAccount()
    seen.push(account.status)
    useEffect(() => { mounts++ }, [])
    return <div>
        <p>status: {account.status}</p>
        <p>user: {account.user?.email ?? "none"}</p>
        <button type="button" onClick={account.openSignIn}>Sign in</button>
    </div>
}

const renderWith = (settings: KeycloakSettings | null = SETTINGS) => render(<AccountProvider settings={settings}><Probe /></AccountProvider>)

beforeEach(() => { mounts = 0; seen = []; localStorage.clear(); history.replaceState(null, "", "/"); vi.mocked(loadKeycloak).mockReset() })
afterEach(() => { vi.useRealTimers() })

describe("the optional account", () => {
    it("loads nothing for a guest until they ask to sign in, then starts sign-in without remounting the app", async () => {
        const client = fakeClient()
        vi.mocked(loadKeycloak).mockResolvedValue(client)
        renderWith()
        expect(screen.getByText("status: off")).toBeInTheDocument()
        expect(loadKeycloak).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        await screen.findByText("status: ready")
        await waitFor(() => expect(client.openSignIn).toHaveBeenCalledOnce())
        expect(localStorage.getItem(SESSION_MARKER)).toBe("1")
        act(() => client.emit(ADA))
        expect(screen.getByText("user: ada@example.org")).toBeInTheDocument()
        expect(localStorage.getItem(SESSION_MARKER)).toBe("1")
        expect(mounts).toBe(1)
        act(() => client.emit(null))
        expect(localStorage.getItem(SESSION_MARKER)).toBeNull()
    })

    it("loads at once for a remembered session", async () => {
        localStorage.setItem(SESSION_MARKER, "1")
        vi.mocked(loadKeycloak).mockResolvedValue(fakeClient(ADA))
        renderWith()
        expect(await screen.findByText("user: ada@example.org")).toBeInTheDocument()
        expect(loadKeycloak).toHaveBeenCalledOnce()
    })

    it("is unavailable, and loads nothing, without Keycloak settings", () => {
        localStorage.setItem(SESSION_MARKER, "1")
        renderWith(null)
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        expect(loadKeycloak).not.toHaveBeenCalled()
        expect(screen.getByText("status: off")).toBeInTheDocument()
    })

    it("says failed, and keeps the app, when sign-in does not load", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        vi.mocked(loadKeycloak).mockRejectedValue(new Error("blocked"))
        renderWith()
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        expect(await screen.findByText("status: failed")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument()
    })

    it("tries again on the next sign-in after a failure", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const client = fakeClient()
        vi.mocked(loadKeycloak).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(client)
        renderWith()
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        await screen.findByText("status: failed")
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        await screen.findByText("status: ready")
        expect(loadKeycloak).toHaveBeenCalledTimes(2)
        await waitFor(() => expect(client.openSignIn).toHaveBeenCalledOnce())
    })

    it("is loading from the first render for a remembered session, so no sign-in prompt flashes", () => {
        localStorage.setItem(SESSION_MARKER, "1")
        vi.mocked(loadKeycloak).mockReturnValue(new Promise<never>(() => {}))
        renderWith()
        expect(seen[0]).toBe("loading")
    })

    it("gives up after the load timeout when the sign-in never answers", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        vi.useFakeTimers()
        vi.mocked(loadKeycloak).mockReturnValue(new Promise<never>(() => {}))
        renderWith()
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        await act(async () => { await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1) })
        expect(screen.getByText("status: loading")).toBeInTheDocument()
        await act(async () => { await vi.advanceTimersByTimeAsync(1) })
        expect(screen.getByText("status: failed")).toBeInTheDocument()
    })
    it("does not redirect when the silent check already finds a session", async () => {
        const client = fakeClient(ADA); vi.mocked(loadKeycloak).mockResolvedValue(client)
        renderWith(); fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        expect(await screen.findByText("user: ada@example.org")).toBeInTheDocument()
        expect(client.openSignIn).not.toHaveBeenCalled()
    })

    it("finishes a sign-in redirect on load, even without the session marker", async () => {
        history.replaceState(null, "", "/mainnet/alerts#state=s1&session_state=x&code=c1")
        vi.mocked(loadKeycloak).mockReturnValue(new Promise<never>(() => {}))
        renderWith()
        expect(seen[0]).toBe("loading")
        await waitFor(() => expect(loadKeycloak).toHaveBeenCalledOnce())
    })

    it("hands the sign-in return to the client even when the app rewrote the URL first", async () => {
        history.replaceState(null, "", "/mainnet/alerts#state=s1&session_state=x&code=c1")
        let urlSeen = ""
        vi.mocked(loadKeycloak).mockImplementation(() => { urlSeen = window.location.pathname + window.location.hash; return new Promise<never>(() => {}) })
        renderWith()
        history.replaceState(null, "", "/os/settings") // the OS shell's own rewrite, which drops the fragment
        await waitFor(() => expect(loadKeycloak).toHaveBeenCalledOnce())
        expect(urlSeen).toBe("/os/settings#state=s1&session_state=x&code=c1")
    })

    it("never puts the sign-in return over a fragment the app set meanwhile", async () => {
        history.replaceState(null, "", "/mainnet/alerts#state=s1&session_state=x&code=c1")
        let urlSeen = ""
        vi.mocked(loadKeycloak).mockImplementation(() => { urlSeen = window.location.pathname + window.location.hash; return new Promise<never>(() => {}) })
        renderWith()
        history.replaceState(null, "", "/os/notes#k=secret")
        await waitFor(() => expect(loadKeycloak).toHaveBeenCalledOnce())
        expect(urlSeen).toBe("/os/notes#k=secret")
    })

    it("forgets a remembered session that the silent check does not find", async () => {
        localStorage.setItem(SESSION_MARKER, "1"); vi.mocked(loadKeycloak).mockResolvedValue(fakeClient(null))
        renderWith(); await screen.findByText("status: ready")
        expect(localStorage.getItem(SESSION_MARKER)).toBeNull()
    })

    it("forgets the session before leaving for the sign-out page", async () => {
        localStorage.setItem(SESSION_MARKER, "1"); const client = fakeClient(ADA)
        client.signOut = vi.fn(async () => { expect(localStorage.getItem(SESSION_MARKER)).toBeNull() })
        vi.mocked(loadKeycloak).mockResolvedValue(client)
        const grabbed: { api?: AccountApi } = {}
        function Grab() { const api = useAccount(); useEffect(() => { grabbed.api = api }); return null }
        render(<AccountProvider settings={SETTINGS}><Grab /></AccountProvider>)
        await waitFor(() => expect(grabbed.api?.user).toEqual(ADA))
        await act(async () => { await grabbed.api!.signOut() }); expect(client.signOut).toHaveBeenCalledOnce()
    })

    it("recognises a sign-in redirect's return by its fragment", () => {
        expect(hasAuthCallback("#state=s&session_state=x&code=c")).toBe(true)
        expect(hasAuthCallback("#state=s&error=login_required")).toBe(true)
        expect(hasAuthCallback("")).toBe(false)
        expect(hasAuthCallback("#section-2")).toBe(false)
        expect(hasAuthCallback("#code=c")).toBe(false)
    })
})
