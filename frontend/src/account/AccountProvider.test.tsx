import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AccountProvider, LOAD_TIMEOUT_MS, SESSION_MARKER } from "./AccountProvider"
import { useAccount, type AccountUser } from "./accountContext"
import type { ClerkClient } from "./loadClerk"

vi.mock("./loadClerk", () => ({ loadClerk: vi.fn() }))
const { loadClerk } = await import("./loadClerk")

const ADA: AccountUser = { id: "user_1", email: "ada@example.org", fullName: "Ada", isAdmin: false }

function fakeClient(user: AccountUser | null = null) {
    let listener: ((u: AccountUser | null) => void) | null = null
    const client: ClerkClient & { emit: (u: AccountUser | null) => void } = {
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

const renderWith = (key = "pk_test_x") => render(<AccountProvider publishableKey={key}><Probe /></AccountProvider>)

beforeEach(() => { mounts = 0; seen = []; localStorage.clear(); vi.mocked(loadClerk).mockReset() })
afterEach(() => { vi.useRealTimers() })

describe("the optional account", () => {
    it("loads nothing for a guest until they ask to sign in, then opens Clerk's sign-in without remounting the app", async () => {
        const client = fakeClient()
        vi.mocked(loadClerk).mockResolvedValue(client)
        renderWith()
        expect(screen.getByText("status: off")).toBeInTheDocument()
        expect(loadClerk).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        await screen.findByText("status: ready")
        await waitFor(() => expect(client.openSignIn).toHaveBeenCalledOnce())
        act(() => client.emit(ADA))
        expect(screen.getByText("user: ada@example.org")).toBeInTheDocument()
        expect(localStorage.getItem(SESSION_MARKER)).toBe("1")
        expect(mounts).toBe(1)
        act(() => client.emit(null))
        expect(localStorage.getItem(SESSION_MARKER)).toBeNull()
    })

    it("loads at once for a remembered session", async () => {
        localStorage.setItem(SESSION_MARKER, "1")
        vi.mocked(loadClerk).mockResolvedValue(fakeClient(ADA))
        renderWith()
        expect(await screen.findByText("user: ada@example.org")).toBeInTheDocument()
        expect(loadClerk).toHaveBeenCalledOnce()
    })

    it("is unavailable, and loads nothing, without a Clerk key", () => {
        localStorage.setItem(SESSION_MARKER, "1")
        renderWith("")
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        expect(loadClerk).not.toHaveBeenCalled()
        expect(screen.getByText("status: off")).toBeInTheDocument()
    })

    it("says failed, and keeps the app, when Clerk does not load", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        vi.mocked(loadClerk).mockRejectedValue(new Error("blocked"))
        renderWith()
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        expect(await screen.findByText("status: failed")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument()
    })

    it("tries again on the next sign-in after a failure", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const client = fakeClient()
        vi.mocked(loadClerk).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(client)
        renderWith()
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        await screen.findByText("status: failed")
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        await screen.findByText("status: ready")
        expect(loadClerk).toHaveBeenCalledTimes(2)
        await waitFor(() => expect(client.openSignIn).toHaveBeenCalledOnce())
    })

    it("is loading from the first render for a remembered session, so no sign-in prompt flashes", () => {
        localStorage.setItem(SESSION_MARKER, "1")
        vi.mocked(loadClerk).mockReturnValue(new Promise<never>(() => {}))
        renderWith()
        expect(seen[0]).toBe("loading")
    })

    it("gives up after the load timeout when Clerk never answers", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        vi.useFakeTimers()
        vi.mocked(loadClerk).mockReturnValue(new Promise<never>(() => {}))
        renderWith()
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        await act(async () => { await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1) })
        expect(screen.getByText("status: loading")).toBeInTheDocument()
        await act(async () => { await vi.advanceTimersByTimeAsync(1) })
        expect(screen.getByText("status: failed")).toBeInTheDocument()
    })
})
